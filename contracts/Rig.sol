// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

contract Unit is ERC20, ERC20Permit, ERC20Votes {
    address public immutable rig;

    error Unit__NotRig();

    event Unit__Minted(address account, uint256 amount);
    event Unit__Burned(address account, uint256 amount);

    constructor(string memory name, string memory symbol) ERC20(name, symbol) ERC20Permit(name) {
        rig = msg.sender;
    }

    function mint(address account, uint256 amount) external {
        if (msg.sender != rig) revert Unit__NotRig();
        _mint(account, amount);
        emit Unit__Minted(account, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Unit__Burned(msg.sender, amount);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);
    }
}

contract Rig is IEntropyConsumer, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Fee constants (basis points)
    uint256 public constant TEAM_FEE = 1_000; // 10% to team
    uint256 public constant DIVISOR = 10_000;
    uint256 public constant PRECISION = 1e18;

    // Dutch auction constants
    uint256 public constant EPOCH_PERIOD = 1 hours;
    uint256 public constant PRICE_MULTIPLIER = 2e18;
    uint256 public constant MIN_INIT_PRICE = 0.0001 ether;
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint192).max;

    // Emission constants (same as original)
    uint256 public constant INITIAL_UPS = 4 ether;
    uint256 public constant HALVING_PERIOD = 30 days;
    uint256 public constant TAIL_UPS = 0.01 ether;

    // Odds validation (basis points: 10000 = 100%)
    uint256 public constant MIN_ODDS_BPS = 100; // Minimum 1% (100 bps) payout per spin
    uint256 public constant MAX_ODDS_BPS = 10000; // Maximum 100% (10000 bps)

    // Immutables
    address public immutable unit;
    address public immutable quote;
    uint256 public immutable startTime;

    // State
    IEntropyV2 entropy;
    address public treasury;
    address public team;

    // Single slot state
    uint256 public epochId;
    uint256 public initPrice;
    uint256 public slotStartTime;

    // Track last emission mint time for prize pool accumulation
    uint256 public lastEmissionTime;

    // Odds array in basis points (e.g., [100, 100, 500, 1000] = 50% chance of 1%, 25% chance of 5%, 25% chance of 10%)
    uint256[] public odds;

    // Pending spins waiting for VRF callback
    mapping(uint64 => address) public sequence_Spinner;
    mapping(uint64 => uint256) public sequence_Epoch;

    // Errors
    error Rig__InvalidSpinner();
    error Rig__EpochIdMismatch();
    error Rig__MaxPriceExceeded();
    error Rig__Expired();
    error Rig__InsufficientFee();
    error Rig__InvalidTreasury();
    error Rig__InvalidOdds();
    error Rig__OddsTooLow();

    // Events
    event Rig__Spin(
        address indexed sender,
        address indexed spinner,
        uint256 indexed epochId,
        uint256 price
    );
    event Rig__Win(
        address indexed spinner,
        uint256 indexed epochId,
        uint256 oddsPercent,
        uint256 amount
    );
    event Rig__EntropyRequested(uint256 indexed epochId, uint64 indexed sequenceNumber);
    event Rig__TreasuryFee(address indexed treasury, uint256 indexed epochId, uint256 amount);
    event Rig__TeamFee(address indexed team, uint256 indexed epochId, uint256 amount);
    event Rig__EmissionMinted(uint256 indexed epochId, uint256 amount);
    event Rig__TreasurySet(address indexed treasury);
    event Rig__TeamSet(address indexed team);
    event Rig__OddsSet(uint256[] odds);

    constructor(
        string memory name,
        string memory symbol,
        address _quote,
        address _entropy,
        address _treasury
    ) {
        quote = _quote;
        treasury = _treasury;
        startTime = block.timestamp;
        lastEmissionTime = block.timestamp;
        slotStartTime = block.timestamp;
        unit = address(new Unit(name, symbol));
        entropy = IEntropyV2(_entropy);
    }

    function spin(
        address spinner,
        uint256 _epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external payable nonReentrant returns (uint256 price) {
        if (spinner == address(0)) revert Rig__InvalidSpinner();
        if (block.timestamp > deadline) revert Rig__Expired();
        if (_epochId != epochId) revert Rig__EpochIdMismatch();

        price = getPrice();
        if (price > maxPrice) revert Rig__MaxPriceExceeded();

        // Distribute fees from spin price
        if (price > 0) {
            uint256 teamFee = team != address(0) ? price * TEAM_FEE / DIVISOR : 0;
            uint256 treasuryFee = price - teamFee;

            IERC20(quote).safeTransferFrom(msg.sender, treasury, treasuryFee);
            emit Rig__TreasuryFee(treasury, epochId, treasuryFee);

            if (teamFee > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, team, teamFee);
                emit Rig__TeamFee(team, epochId, teamFee);
            }
        }

        // Mint accumulated emissions to prize pool (this contract)
        uint256 emissionAmount = _mintEmissions();
        if (emissionAmount > 0) {
            emit Rig__EmissionMinted(epochId, emissionAmount);
        }

        // Update Dutch auction for next epoch
        uint256 newInitPrice = price * PRICE_MULTIPLIER / PRECISION;
        if (newInitPrice > ABS_MAX_INIT_PRICE) {
            newInitPrice = ABS_MAX_INIT_PRICE;
        } else if (newInitPrice < MIN_INIT_PRICE) {
            newInitPrice = MIN_INIT_PRICE;
        }

        uint256 currentEpochId = epochId;
        unchecked {
            epochId++;
        }
        initPrice = newInitPrice;
        slotStartTime = block.timestamp;

        emit Rig__Spin(msg.sender, spinner, currentEpochId, price);

        // Request VRF for spin outcome
        uint128 fee = entropy.getFeeV2();
        if (msg.value < fee) revert Rig__InsufficientFee();
        uint64 seq = entropy.requestV2{value: fee}();
        sequence_Spinner[seq] = spinner;
        sequence_Epoch[seq] = epochId; // Store the NEW epoch (post-increment)
        emit Rig__EntropyRequested(epochId, seq);

        return price;
    }

    function entropyCallback(uint64 sequenceNumber, address, bytes32 randomNumber) internal override {
        address spinner = sequence_Spinner[sequenceNumber];
        uint256 epoch = sequence_Epoch[sequenceNumber];

        delete sequence_Spinner[sequenceNumber];
        delete sequence_Epoch[sequenceNumber];

        // Validate spinner still exists
        if (spinner == address(0)) return;

        // Draw odds and calculate winnings
        uint256 oddsBps = _drawOdds(randomNumber);
        uint256 pool = Unit(unit).balanceOf(address(this));
        uint256 winAmount = pool * oddsBps / DIVISOR;

        if (winAmount > 0) {
            IERC20(unit).safeTransfer(spinner, winAmount);
        }

        emit Rig__Win(spinner, epoch, oddsBps, winAmount);
    }

    function _drawOdds(bytes32 randomNumber) internal view returns (uint256) {
        uint256 length = odds.length;
        if (length == 0) return MIN_ODDS_BPS;
        uint256 index = uint256(randomNumber) % length;
        return odds[index];
    }

    function _mintEmissions() internal returns (uint256 amount) {
        uint256 timeElapsed = block.timestamp - lastEmissionTime;
        if (timeElapsed == 0) return 0;

        uint256 ups = _getUpsFromTime(block.timestamp);
        amount = timeElapsed * ups;

        if (amount > 0) {
            Unit(unit).mint(address(this), amount);
        }

        lastEmissionTime = block.timestamp;
        return amount;
    }

    function _getUpsFromTime(uint256 time) internal view returns (uint256 ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / HALVING_PERIOD;
        ups = INITIAL_UPS >> halvings;
        if (ups < TAIL_UPS) ups = TAIL_UPS;
        return ups;
    }

    function _validateAndSetOdds(uint256[] memory _odds) internal {
        uint256 length = _odds.length;
        if (length == 0) revert Rig__InvalidOdds();

        for (uint256 i = 0; i < length; i++) {
            if (_odds[i] < MIN_ODDS_BPS) revert Rig__OddsTooLow();
            if (_odds[i] > MAX_ODDS_BPS) revert Rig__InvalidOdds();
        }

        odds = _odds;
        emit Rig__OddsSet(_odds);
    }

    // Admin functions
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert Rig__InvalidTreasury();
        treasury = _treasury;
        emit Rig__TreasurySet(_treasury);
    }

    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit Rig__TeamSet(_team);
    }

    function setOdds(uint256[] calldata _odds) external onlyOwner {
        _validateAndSetOdds(_odds);
    }

    // View functions
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    function getEntropyFee() external view returns (uint256) {
        return entropy.getFeeV2();
    }

    function getPrice() public view returns (uint256) {
        uint256 timePassed = block.timestamp - slotStartTime;

        if (timePassed > EPOCH_PERIOD) {
            return 0;
        }

        return initPrice - initPrice * timePassed / EPOCH_PERIOD;
    }

    function getUps() external view returns (uint256) {
        return _getUpsFromTime(block.timestamp);
    }

    function getPrizePool() external view returns (uint256) {
        return Unit(unit).balanceOf(address(this));
    }

    function getPendingEmissions() external view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastEmissionTime;
        if (timeElapsed == 0) return 0;
        uint256 ups = _getUpsFromTime(block.timestamp);
        return timeElapsed * ups;
    }

    function getOdds() external view returns (uint256[] memory) {
        return odds;
    }

    function getOddsLength() external view returns (uint256) {
        return odds.length;
    }
}
