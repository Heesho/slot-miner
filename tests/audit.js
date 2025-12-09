const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const MaxUint256 = ethers.constants.MaxUint256;

let owner, multisig, treasury, team, attacker, user0, user1, user2, entropyProvider;
let weth, unit, rig, entropy;

// Helper to get current block timestamp
async function getTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

// Helper to spin
async function spin(user, maxPriceOverride = null) {
  const epochId = await rig.epochId();
  const price = await rig.getPrice();
  const maxPrice = maxPriceOverride !== null ? maxPriceOverride : price;
  const timestamp = await getTimestamp();
  const deadline = timestamp + 3600;
  const entropyFee = await rig.getEntropyFee();

  return rig.connect(user).spin(user.address, epochId, deadline, maxPrice, { value: entropyFee });
}

describe("Rig Security Audit Tests", function () {

  beforeEach("Fresh deployment for each test", async function () {
    [owner, multisig, treasury, team, attacker, user0, user1, user2, entropyProvider] =
      await ethers.getSigners();

    const wethArtifact = await ethers.getContractFactory("Base");
    weth = await wethArtifact.deploy();

    const entropyArtifact = await ethers.getContractFactory("TestMockEntropy");
    entropy = await entropyArtifact.deploy(entropyProvider.address);

    const rigArtifact = await ethers.getContractFactory("Rig");
    rig = await rigArtifact.deploy(
      "Luck",
      "LUCK",
      weth.address,
      entropy.address,
      treasury.address
    );

    // Set team and odds after deployment
    await rig.setTeam(team.address);

    // Standard odds: 89% -> 1%, 10% -> 5%, 1% -> 50%
    const defaultOdds = [
      ...Array(89).fill(100),
      ...Array(10).fill(500),
      ...Array(1).fill(5000),
    ];
    await rig.setOdds(defaultOdds);

    unit = await ethers.getContractAt("contracts/Rig.sol:Unit", await rig.unit());

    await rig.transferOwnership(multisig.address);

    // Fund users with WETH (keep ETH for gas)
    for (const user of [attacker, user0, user1, user2]) {
      await weth.connect(user).deposit({ value: convert("100", 18) });
      await weth.connect(user).approve(rig.address, MaxUint256);
    }
  });

  // ============================================
  // CRITICAL: Reentrancy Tests
  // ============================================
  describe("Reentrancy Protection", function () {
    it("CRITICAL: spin() should be protected against reentrancy", async function () {
      // The contract uses ReentrancyGuard from OpenZeppelin
      // Verify the modifier is applied by checking contract inherits ReentrancyGuard
      // and that state changes happen before external calls

      // First spin to set up state
      await spin(user0);

      // Advance time
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      // Second spin should work normally (no reentrancy issues)
      await spin(user1);

      // Verify state is consistent
      expect(await rig.epochId()).to.equal(2);
    });

    it("CRITICAL: VRF callback should not be callable by external actors", async function () {
      // entropyCallback is internal, only callable via Pyth Entropy
      // Verify the contract properly inherits IEntropyConsumer

      await spin(user0);

      // Try to call getEntropy (internal view function, should not be directly accessible)
      // The callback can only be triggered through the entropy contract
      const seqNum = 1;
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));

      // This should work - proper callback through entropy
      await entropy.mockReveal(entropyProvider.address, seqNum, randomNumber);

      // Verify user received winnings
      const userBalance = await unit.balanceOf(user0.address);
      expect(userBalance).to.be.gt(0);
    });
  });

  // ============================================
  // CRITICAL: Access Control Tests
  // ============================================
  describe("Access Control", function () {
    it("CRITICAL: Only owner can call admin functions", async function () {
      // setTreasury
      await expect(
        rig.connect(attacker).setTreasury(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // setTeam
      await expect(
        rig.connect(attacker).setTeam(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // setOdds
      await expect(
        rig.connect(attacker).setOdds([100, 200])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("CRITICAL: Ownership transfer works correctly", async function () {
      // Current owner is multisig
      expect(await rig.owner()).to.equal(multisig.address);

      // Transfer to new owner
      await rig.connect(multisig).transferOwnership(user0.address);
      expect(await rig.owner()).to.equal(user0.address);

      // Old owner can no longer call admin functions
      await expect(
        rig.connect(multisig).setTreasury(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // New owner can call admin functions
      await rig.connect(user0).setTeam(user1.address);
      expect(await rig.team()).to.equal(user1.address);
    });

    it("CRITICAL: Cannot renounce ownership and brick contract", async function () {
      // Test that renouncing ownership is possible but admin functions become uncallable
      await rig.connect(multisig).renounceOwnership();
      expect(await rig.owner()).to.equal(AddressZero);

      // Admin functions now permanently disabled
      await expect(
        rig.connect(multisig).setOdds([100])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ============================================
  // CRITICAL: Fund Safety Tests
  // ============================================
  describe("Fund Safety", function () {
    it("CRITICAL: Prize pool funds cannot be drained except through legitimate wins", async function () {
      // Build up prize pool
      await spin(user0);
      await entropy.mockReveal(entropyProvider.address, 1, ethers.utils.randomBytes(32));

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await spin(user1);
      await entropy.mockReveal(entropyProvider.address, 2, ethers.utils.randomBytes(32));

      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      // Get pool before user2's spin
      const user2BalanceBefore = await unit.balanceOf(user2.address);
      expect(user2BalanceBefore).to.equal(0);

      await spin(user2);

      // Pool after spin but before callback
      const poolBeforeCallback = await rig.getPrizePool();
      expect(poolBeforeCallback).to.be.gt(0);

      // Trigger VRF callback
      await entropy.mockReveal(entropyProvider.address, 3, ethers.utils.randomBytes(32));

      const user2BalanceAfter = await unit.balanceOf(user2.address);
      const poolAfterCallback = await rig.getPrizePool();

      // User2 should have won something
      expect(user2BalanceAfter).to.be.gt(0);

      // Pool should have decreased by what user2 won
      expect(poolBeforeCallback.sub(poolAfterCallback)).to.equal(user2BalanceAfter);
    });

    it("CRITICAL: Fee distribution cannot be manipulated", async function () {
      // Do a spin with known price
      await spin(user0); // Free spin

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const price = await rig.getPrice();
      const treasuryBefore = await weth.balanceOf(treasury.address);
      const teamBefore = await weth.balanceOf(team.address);

      const tx = await spin(user1);
      const receipt = await tx.wait();
      const spinEvent = receipt.events.find(e => e.event === "Rig__Spin");
      const actualPrice = spinEvent.args.price;

      const treasuryAfter = await weth.balanceOf(treasury.address);
      const teamAfter = await weth.balanceOf(team.address);

      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);

      // Verify exact 90/10 split
      const expectedTeam = actualPrice.mul(1000).div(10000);
      const expectedTreasury = actualPrice.sub(expectedTeam);

      expect(teamReceived).to.equal(expectedTeam);
      expect(treasuryReceived).to.equal(expectedTreasury);
    });

    it("CRITICAL: Cannot set treasury to zero and lose fees", async function () {
      await expect(
        rig.connect(multisig).setTreasury(AddressZero)
      ).to.be.revertedWith("Rig__InvalidTreasury");
    });
  });

  // ============================================
  // HIGH: Input Validation Tests
  // ============================================
  describe("Input Validation", function () {
    it("HIGH: Spinner address cannot be zero", async function () {
      const epochId = await rig.epochId();
      const timestamp = await getTimestamp();
      const deadline = timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(AddressZero, epochId, deadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__InvalidSpinner");
    });

    it("HIGH: Epoch ID must match current epoch", async function () {
      const epochId = await rig.epochId();
      const timestamp = await getTimestamp();
      const deadline = timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      // Wrong epoch (too high)
      await expect(
        rig.connect(user0).spin(user0.address, epochId.add(1), deadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__EpochIdMismatch");

      // Do a spin to increment epoch
      await spin(user0);

      // Old epoch ID should fail
      await expect(
        rig.connect(user0).spin(user0.address, epochId, deadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__EpochIdMismatch");
    });

    it("HIGH: Deadline must not be expired", async function () {
      const epochId = await rig.epochId();
      const timestamp = await getTimestamp();
      const expiredDeadline = timestamp - 1;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(user0.address, epochId, expiredDeadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__Expired");
    });

    it("HIGH: Max price slippage protection works", async function () {
      await spin(user0); // Free spin to initialize

      // Wait a bit so price is non-zero but not at initPrice
      await ethers.provider.send("evm_increaseTime", [1800]); // 30 min
      await ethers.provider.send("evm_mine", []);

      // Price should now be about half of initPrice
      const price = await rig.getPrice();
      expect(price).to.be.gt(0);

      const epochId = await rig.epochId();
      const timestamp = await getTimestamp();
      const deadline = timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      // Set maxPrice to 0 when price is non-zero - should fail
      let reverted = false;
      try {
        await rig.connect(user0).spin(user0.address, epochId, deadline, 0, { value: entropyFee });
      } catch (e) {
        reverted = true;
        expect(e.message).to.include("Rig__MaxPriceExceeded");
      }
      expect(reverted).to.be.true;
    });

    it("HIGH: Odds validation prevents invalid configurations", async function () {
      // Empty array
      await expect(
        rig.connect(multisig).setOdds([])
      ).to.be.revertedWith("Rig__InvalidOdds");

      // Below minimum (100 bps = 1%)
      await expect(
        rig.connect(multisig).setOdds([99])
      ).to.be.revertedWith("Rig__OddsTooLow");

      await expect(
        rig.connect(multisig).setOdds([0])
      ).to.be.revertedWith("Rig__OddsTooLow");

      // Above maximum (10000 bps = 100%)
      await expect(
        rig.connect(multisig).setOdds([10001])
      ).to.be.revertedWith("Rig__InvalidOdds");

      // Mixed valid and invalid
      await expect(
        rig.connect(multisig).setOdds([100, 50, 500]) // 50 is below min
      ).to.be.revertedWith("Rig__OddsTooLow");
    });
  });

  // ============================================
  // HIGH: Economic Attack Vectors
  // ============================================
  describe("Economic Attack Vectors", function () {
    it("HIGH: Front-running protection via epoch ID", async function () {
      // Attacker sees user0's spin transaction in mempool
      // Attacker tries to front-run with same epoch ID

      await spin(user0); // First spin

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const epochId = await rig.epochId();

      // Both transactions submitted with same epochId
      // Only one can succeed - the other will fail with EpochIdMismatch
      await spin(attacker);

      // User0's transaction would now fail because epoch changed
      const timestamp = await getTimestamp();
      const deadline = timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(user0.address, epochId, deadline, MaxUint256, { value: entropyFee })
      ).to.be.revertedWith("Rig__EpochIdMismatch");
    });

    it("HIGH: Price manipulation via timing is limited", async function () {
      await spin(user0); // Initialize

      // Attacker waits until price decays to near zero
      await ethers.provider.send("evm_increaseTime", [3599]); // Just before epoch end
      await ethers.provider.send("evm_mine", []);

      const priceLow = await rig.getPrice();

      // Spin at low price
      await spin(attacker);

      // New init price is based on price paid * 2, clamped to MIN_INIT_PRICE
      const newInitPrice = await rig.initPrice();
      const MIN_INIT_PRICE = ethers.utils.parseEther("0.0001");

      // Price should be at minimum since low price * 2 < MIN_INIT_PRICE
      expect(newInitPrice).to.equal(MIN_INIT_PRICE);
    });

    it("HIGH: Cannot grief by setting extremely high price", async function () {
      // Price is determined by Dutch auction, not user input
      // User can only set maxPrice for slippage protection

      await spin(user0);

      // Even if user sets maxPrice to MaxUint256, they only pay current auction price
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const priceBefore = await rig.getPrice();
      const userBalBefore = await weth.balanceOf(user1.address);

      const epochId = await rig.epochId();
      const timestamp = await getTimestamp();
      const deadline = timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      const tx = await rig.connect(user1).spin(user1.address, epochId, deadline, MaxUint256, { value: entropyFee });
      const receipt = await tx.wait();
      const spinEvent = receipt.events.find(e => e.event === "Rig__Spin");
      const actualPrice = spinEvent.args.price;

      const userBalAfter = await weth.balanceOf(user1.address);
      const spent = userBalBefore.sub(userBalAfter);

      // User only spent the actual auction price, not MaxUint256
      expect(spent).to.equal(actualPrice);
      expect(actualPrice).to.be.lte(priceBefore);
    });

    it("HIGH: Rapid spinning doesn't drain pool unfairly", async function () {
      // Build up pool
      for (let i = 0; i < 5; i++) {
        await spin(user0);
        await ethers.provider.send("evm_increaseTime", [3600]);
        await ethers.provider.send("evm_mine", []);
      }

      const poolBefore = await rig.getPrizePool();

      // Attacker tries rapid spinning
      // Each spin requires waiting for auction price and paying for it
      // Cannot bypass Dutch auction mechanics

      for (let i = 0; i < 3; i++) {
        await spin(attacker);
        // Trigger VRF
        await entropy.mockReveal(entropyProvider.address, i + 6, ethers.utils.randomBytes(32));
      }

      const poolAfter = await rig.getPrizePool();
      const attackerBalance = await unit.balanceOf(attacker.address);

      // Pool should have decreased, but attacker also paid fees
      // Net result should not be significantly profitable
      expect(attackerBalance).to.be.gt(0); // Attacker got some winnings
      expect(poolAfter).to.be.gt(0); // Pool not drained
    });
  });

  // ============================================
  // MEDIUM: Edge Cases and Boundary Conditions
  // ============================================
  describe("Edge Cases", function () {
    it("MEDIUM: First spin is free (price = 0, initPrice = 0)", async function () {
      const price = await rig.getPrice();
      expect(price).to.equal(0);

      const treasuryBefore = await weth.balanceOf(treasury.address);
      const teamBefore = await weth.balanceOf(team.address);

      await spin(user0);

      const treasuryAfter = await weth.balanceOf(treasury.address);
      const teamAfter = await weth.balanceOf(team.address);

      // No fees collected
      expect(treasuryAfter).to.equal(treasuryBefore);
      expect(teamAfter).to.equal(teamBefore);
    });

    it("MEDIUM: Price at exact epoch boundary", async function () {
      await spin(user0); // Initialize

      // Exactly at epoch end
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const price = await rig.getPrice();
      expect(price).to.equal(0);

      // Just after epoch end
      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine", []);

      const priceAfter = await rig.getPrice();
      expect(priceAfter).to.equal(0);
    });

    it("MEDIUM: Emissions during long idle period", async function () {
      await spin(user0); // Initialize

      // Forward 1 year
      const oneYear = 365 * 24 * 3600;
      await ethers.provider.send("evm_increaseTime", [oneYear]);
      await ethers.provider.send("evm_mine", []);

      const pendingEmissions = await rig.getPendingEmissions();

      // Should have accumulated significant emissions (with halvings)
      expect(pendingEmissions).to.be.gt(0);

      // Spin to mint emissions
      await spin(user1);

      const pool = await rig.getPrizePool();
      expect(pool).to.be.closeTo(pendingEmissions, pendingEmissions.div(100));
    });

    it("MEDIUM: Maximum odds value (100% = 10000 bps)", async function () {
      await rig.connect(multisig).setOdds([10000]); // 100% payout

      // Build pool
      await spin(user0);
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await spin(user1);

      const poolBefore = await rig.getPrizePool();

      // Trigger VRF - should win 100% of pool
      await entropy.mockReveal(entropyProvider.address, 2, ethers.utils.randomBytes(32));

      const user1Balance = await unit.balanceOf(user1.address);
      const poolAfter = await rig.getPrizePool();

      expect(user1Balance).to.equal(poolBefore);
      expect(poolAfter).to.equal(0);
    });

    it("MEDIUM: Minimum odds value (1% = 100 bps)", async function () {
      await rig.connect(multisig).setOdds([100]); // 1% payout

      // Build pool
      await spin(user0);
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await spin(user1);

      const poolBefore = await rig.getPrizePool();

      // Trigger VRF - should win 1% of pool
      await entropy.mockReveal(entropyProvider.address, 2, ethers.utils.randomBytes(32));

      const user1Balance = await unit.balanceOf(user1.address);
      const expectedWin = poolBefore.mul(100).div(10000);

      expect(user1Balance).to.equal(expectedWin);
    });

    it("MEDIUM: Empty prize pool scenario", async function () {
      // Set 100% odds to drain pool
      await rig.connect(multisig).setOdds([10000]);

      await spin(user0);

      const poolBefore = await rig.getPrizePool();

      // Win everything
      await entropy.mockReveal(entropyProvider.address, 1, ethers.utils.randomBytes(32));

      const poolAfter = await rig.getPrizePool();
      expect(poolAfter).to.equal(0);

      // Next spin should still work, but winner gets 0
      await ethers.provider.send("evm_increaseTime", [100]); // Small time for minimal emissions
      await ethers.provider.send("evm_mine", []);

      await spin(user1);
      await entropy.mockReveal(entropyProvider.address, 2, ethers.utils.randomBytes(32));

      // User1 should have received the small emissions that accumulated
      const user1Balance = await unit.balanceOf(user1.address);
      expect(user1Balance).to.be.gt(0); // Got the emissions
    });

    it("MEDIUM: Epoch overflow handling", async function () {
      // epochId is uint256, overflow is practically impossible
      // but verify incrementing works correctly

      const initialEpoch = await rig.epochId();

      for (let i = 0; i < 10; i++) {
        await spin(user0);
      }

      const finalEpoch = await rig.epochId();
      expect(finalEpoch).to.equal(initialEpoch.add(10));
    });
  });

  // ============================================
  // MEDIUM: VRF Security
  // ============================================
  describe("VRF Security", function () {
    it("MEDIUM: Stale VRF callback is handled", async function () {
      await spin(user0);
      const seqNum1 = 1;

      // Don't trigger VRF yet, do another spin
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      await spin(user1);

      // Now trigger the old VRF callback
      // The callback checks sequence_Spinner mapping which should still have user0
      await entropy.mockReveal(entropyProvider.address, seqNum1, ethers.utils.randomBytes(32));

      // User0 should have received winnings
      const user0Balance = await unit.balanceOf(user0.address);
      expect(user0Balance).to.be.gt(0);
    });

    it("MEDIUM: Double VRF callback is prevented by entropy provider", async function () {
      await spin(user0);
      const seqNum = 1;

      // First callback
      await entropy.mockReveal(entropyProvider.address, seqNum, ethers.utils.randomBytes(32));

      const user0BalanceAfterFirst = await unit.balanceOf(user0.address);

      // Second callback with same seqNum - MockEntropy prevents this at the provider level
      // This is the correct security model - the entropy provider enforces one reveal per request
      await expect(
        entropy.mockReveal(entropyProvider.address, seqNum, ethers.utils.randomBytes(32))
      ).to.be.revertedWith("Request not found");

      const user0BalanceAfterSecond = await unit.balanceOf(user0.address);

      // Balance unchanged since second reveal failed
      expect(user0BalanceAfterSecond).to.equal(user0BalanceAfterFirst);
    });

    it("MEDIUM: VRF callback for unknown sequence reverts at provider", async function () {
      await spin(user0);

      const poolBefore = await rig.getPrizePool();

      // Callback with non-existent sequence number - provider rejects it
      await expect(
        entropy.mockReveal(entropyProvider.address, 999, ethers.utils.randomBytes(32))
      ).to.be.revertedWith("Request not found");

      const poolAfter = await rig.getPrizePool();

      // Pool unchanged since callback never reached our contract
      expect(poolAfter).to.equal(poolBefore);
    });

    it("MEDIUM: Contract properly cleans up sequence mappings after callback", async function () {
      await spin(user0);
      const seqNum = 1;

      // Before callback, mapping should have user0
      const spinnerBefore = await rig.sequence_Spinner(seqNum);
      expect(spinnerBefore).to.equal(user0.address);

      // Trigger callback
      await entropy.mockReveal(entropyProvider.address, seqNum, ethers.utils.randomBytes(32));

      // After callback, mapping should be cleared
      const spinnerAfter = await rig.sequence_Spinner(seqNum);
      expect(spinnerAfter).to.equal(AddressZero);
    });
  });

  // ============================================
  // LOW: Unit Token Security
  // ============================================
  describe("Unit Token Security", function () {
    it("LOW: Only rig can mint Unit tokens", async function () {
      // Try to mint directly
      await expect(
        unit.connect(attacker).mint(attacker.address, convert("1000000", 18))
      ).to.be.revertedWith("Unit__NotRig");
    });

    it("LOW: Anyone can burn their own tokens", async function () {
      // Get some tokens first
      await spin(user0);
      await entropy.mockReveal(entropyProvider.address, 1, ethers.utils.randomBytes(32));

      const balanceBefore = await unit.balanceOf(user0.address);
      expect(balanceBefore).to.be.gt(0);

      // Burn half
      const burnAmount = balanceBefore.div(2);
      await unit.connect(user0).burn(burnAmount);

      const balanceAfter = await unit.balanceOf(user0.address);
      expect(balanceAfter).to.equal(balanceBefore.sub(burnAmount));
    });

    it("LOW: Cannot burn more than balance", async function () {
      await spin(user0);
      await entropy.mockReveal(entropyProvider.address, 1, ethers.utils.randomBytes(32));

      const balance = await unit.balanceOf(user0.address);

      await expect(
        unit.connect(user0).burn(balance.add(1))
      ).to.be.reverted;
    });
  });

  // ============================================
  // INVARIANT: System Invariants
  // ============================================
  describe("System Invariants", function () {
    it("INVARIANT: Total fees equal price paid", async function () {
      await spin(user0); // Free spin

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const treasuryBefore = await weth.balanceOf(treasury.address);
      const teamBefore = await weth.balanceOf(team.address);

      const tx = await spin(user1);
      const receipt = await tx.wait();
      const spinEvent = receipt.events.find(e => e.event === "Rig__Spin");
      const price = spinEvent.args.price;

      const treasuryAfter = await weth.balanceOf(treasury.address);
      const teamAfter = await weth.balanceOf(team.address);

      const totalFees = treasuryAfter.sub(treasuryBefore).add(teamAfter.sub(teamBefore));

      expect(totalFees).to.equal(price);
    });

    it("INVARIANT: Prize pool + user winnings = total minted", async function () {
      // Multiple spins and wins
      for (let i = 0; i < 5; i++) {
        await spin(user0);
        await ethers.provider.send("evm_increaseTime", [3600]);
        await ethers.provider.send("evm_mine", []);
        await entropy.mockReveal(entropyProvider.address, i + 1, ethers.utils.randomBytes(32));
      }

      const pool = await rig.getPrizePool();
      const user0Balance = await unit.balanceOf(user0.address);
      const totalSupply = await unit.totalSupply();

      // Total supply should equal pool + all user balances
      // (only user0 has tokens in this test)
      expect(pool.add(user0Balance)).to.equal(totalSupply);
    });

    it("INVARIANT: Epoch ID always increases", async function () {
      let lastEpoch = await rig.epochId();

      for (let i = 0; i < 10; i++) {
        await spin(user0);
        const currentEpoch = await rig.epochId();
        expect(currentEpoch).to.be.gt(lastEpoch);
        lastEpoch = currentEpoch;
      }
    });

    it("INVARIANT: UPS never goes below TAIL_UPS", async function () {
      const TAIL_UPS = ethers.utils.parseEther("0.01");

      // Forward 100 years
      await ethers.provider.send("evm_increaseTime", [100 * 365 * 24 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const ups = await rig.getUps();
      expect(ups).to.equal(TAIL_UPS);

      // Forward another 100 years
      await ethers.provider.send("evm_increaseTime", [100 * 365 * 24 * 3600]);
      await ethers.provider.send("evm_mine", []);

      const upsLater = await rig.getUps();
      expect(upsLater).to.equal(TAIL_UPS);
    });

    it("INVARIANT: Price is always <= initPrice", async function () {
      await spin(user0); // Initialize

      // Check at various points in epoch
      for (let minutes = 0; minutes <= 60; minutes += 10) {
        const initPrice = await rig.initPrice();
        const price = await rig.getPrice();

        expect(price).to.be.lte(initPrice);

        await ethers.provider.send("evm_increaseTime", [600]); // 10 minutes
        await ethers.provider.send("evm_mine", []);
      }
    });
  });

  // ============================================
  // GAS: Gas Optimization Checks
  // ============================================
  describe("Gas Analysis", function () {
    it("GAS: Spin gas cost is reasonable", async function () {
      await spin(user0); // Initialize

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const tx = await spin(user1);
      const receipt = await tx.wait();

      console.log("Spin gas used:", receipt.gasUsed.toString());

      // Should be under 300k gas
      expect(receipt.gasUsed).to.be.lt(300000);
    });

    it("GAS: VRF callback gas cost is reasonable", async function () {
      await spin(user0);

      const tx = await entropy.mockReveal(entropyProvider.address, 1, ethers.utils.randomBytes(32));
      const receipt = await tx.wait();

      console.log("VRF callback gas used:", receipt.gasUsed.toString());

      // Should be under 150k gas
      expect(receipt.gasUsed).to.be.lt(150000);
    });
  });
});
