const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

let owner, multisig, treasury, team, user0, user1, user2, user3, entropyProvider;
let weth, unit, rig, entropy;

describe("Rig Tests", function () {
  before("Initial set up", async function () {
    console.log("Begin Initialization");

    [owner, multisig, treasury, team, user0, user1, user2, user3, entropyProvider] =
      await ethers.getSigners();

    const wethArtifact = await ethers.getContractFactory("Base");
    weth = await wethArtifact.deploy();
    console.log("- WETH Initialized");

    const entropyArtifact = await ethers.getContractFactory("TestMockEntropy");
    entropy = await entropyArtifact.deploy(entropyProvider.address);
    console.log("- Entropy Initialized");

    const rigArtifact = await ethers.getContractFactory("Rig");
    rig = await rigArtifact.deploy(
      "Luck",
      "LUCK",
      weth.address,
      entropy.address,
      treasury.address
    );
    console.log("- Rig Initialized");

    // Set team and odds after deployment
    await rig.setTeam(team.address);
    console.log("- Team set");

    // Default odds in basis points: 89% chance of 1% (100 bps), 10% chance of 5% (500 bps), 1% chance of 50% (5000 bps)
    const defaultOdds = [
      ...Array(89).fill(100),   // 1% = 100 bps
      ...Array(10).fill(500),   // 5% = 500 bps
      ...Array(1).fill(5000),   // 50% = 5000 bps
    ];
    await rig.setOdds(defaultOdds);
    console.log("- Odds set");

    unit = await ethers.getContractAt(
      "contracts/Rig.sol:Unit",
      await rig.unit()
    );
    console.log("- Unit (LUCK) Initialized");

    await rig.transferOwnership(multisig.address);
    console.log("- Ownership transferred to multisig");

    // Fund users with WETH
    await weth.connect(user0).deposit({ value: convert("100", 18) });
    await weth.connect(user1).deposit({ value: convert("100", 18) });
    await weth.connect(user2).deposit({ value: convert("100", 18) });
    await weth.connect(user3).deposit({ value: convert("100", 18) });
    console.log("- Users funded with WETH");

    // Approve rig
    await weth.connect(user0).approve(rig.address, ethers.constants.MaxUint256);
    await weth.connect(user1).approve(rig.address, ethers.constants.MaxUint256);
    await weth.connect(user2).approve(rig.address, ethers.constants.MaxUint256);
    await weth.connect(user3).approve(rig.address, ethers.constants.MaxUint256);
    console.log("- Users approved Rig");

    console.log("Initialization Complete\n");
  });

  it("Initial State", async function () {
    console.log("******************************************************");
    console.log("Epoch ID:", (await rig.epochId()).toString());
    console.log("Init Price:", divDec(await rig.initPrice()));
    console.log("Current Price:", divDec(await rig.getPrice()));
    console.log("Prize Pool:", divDec(await rig.getPrizePool()));
    console.log("Pending Emissions:", divDec(await rig.getPendingEmissions()));
    console.log("UPS:", divDec(await rig.getUps()));
    console.log("Odds Length:", (await rig.getOddsLength()).toString());
  });

  it("User0 spins first (free spin)", async function () {
    console.log("******************************************************");
    const epochId = await rig.epochId();
    const price = await rig.getPrice();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;
    const entropyFee = await rig.getEntropyFee();

    console.log("Price (should be 0):", divDec(price));
    console.log("Entropy Fee:", divDec(entropyFee));

    await rig
      .connect(user0)
      .spin(user0.address, epochId, deadline, price, { value: entropyFee });

    console.log("- User0 spun the slot machine");
    console.log("New Epoch ID:", (await rig.epochId()).toString());
    console.log("New Init Price:", divDec(await rig.initPrice()));
  });

  it("Forward time 30 minutes", async function () {
    console.log("******************************************************");
    await ethers.provider.send("evm_increaseTime", [1800]);
    await ethers.provider.send("evm_mine", []);
    console.log("- Time forwarded 30 minutes");
    console.log("Pending Emissions:", divDec(await rig.getPendingEmissions()));
  });

  it("User1 spins", async function () {
    console.log("******************************************************");
    const epochId = await rig.epochId();
    const price = await rig.getPrice();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;
    const entropyFee = await rig.getEntropyFee();

    console.log("Price:", divDec(price));

    const treasuryBalBefore = await weth.balanceOf(treasury.address);
    const teamBalBefore = await weth.balanceOf(team.address);

    await rig
      .connect(user1)
      .spin(user1.address, epochId, deadline, price, { value: entropyFee });

    const treasuryBalAfter = await weth.balanceOf(treasury.address);
    const teamBalAfter = await weth.balanceOf(team.address);

    console.log("- User1 spun the slot machine");
    console.log("Treasury received (90%):", divDec(treasuryBalAfter.sub(treasuryBalBefore)));
    console.log("Team received (10%):", divDec(teamBalAfter.sub(teamBalBefore)));
    console.log("Prize Pool:", divDec(await rig.getPrizePool()));
  });

  it("Trigger VRF callback for user0", async function () {
    console.log("******************************************************");
    // The mock entropy needs to be triggered manually via mockReveal
    // Sequence number 1 is for user0's spin
    const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random1"));

    await entropy.mockReveal(
      entropyProvider.address,
      1, // sequence number
      randomNumber
    );

    console.log("- VRF callback triggered for user0");
    console.log("User0 LUCK balance:", divDec(await unit.balanceOf(user0.address)));
  });

  it("Trigger VRF callback for user1", async function () {
    console.log("******************************************************");
    const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random2"));

    await entropy.mockReveal(
      entropyProvider.address,
      2, // sequence number
      randomNumber
    );

    console.log("- VRF callback triggered for user1");
    console.log("User1 LUCK balance:", divDec(await unit.balanceOf(user1.address)));
    console.log("Prize Pool remaining:", divDec(await rig.getPrizePool()));
  });

  it("Multiple spins over time", async function () {
    console.log("******************************************************");
    const iterations = 10;
    let seqNum = 3;

    for (let i = 0; i < iterations; i++) {
      // Random time skip 10-40 minutes
      const timeSkip = Math.floor(Math.random() * 1800) + 600;
      await ethers.provider.send("evm_increaseTime", [timeSkip]);
      await ethers.provider.send("evm_mine", []);

      const user = [user0, user1, user2, user3][i % 4];
      const epochId = await rig.epochId();
      const price = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await rig
        .connect(user)
        .spin(user.address, epochId, deadline, price, { value: entropyFee });

      // Trigger callback via mockReveal
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`random${seqNum}`));
      await entropy.mockReveal(
        entropyProvider.address,
        seqNum++,
        randomNumber
      );

      console.log(`Spin ${i + 1}: Price=${divDec(price).toFixed(6)}, Pool=${divDec(await rig.getPrizePool()).toFixed(2)}`);
    }
  });

  it("User balances after spins", async function () {
    console.log("******************************************************");
    console.log("User0 LUCK:", divDec(await unit.balanceOf(user0.address)));
    console.log("User1 LUCK:", divDec(await unit.balanceOf(user1.address)));
    console.log("User2 LUCK:", divDec(await unit.balanceOf(user2.address)));
    console.log("User3 LUCK:", divDec(await unit.balanceOf(user3.address)));
    console.log("Prize Pool:", divDec(await rig.getPrizePool()));
  });

  it("Forward time 1 hour (price should be 0)", async function () {
    console.log("******************************************************");
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    console.log("Current Price:", divDec(await rig.getPrice()));
    console.log("Pending Emissions:", divDec(await rig.getPendingEmissions()));
  });

  it("User2 spins at price 0", async function () {
    console.log("******************************************************");
    const epochId = await rig.epochId();
    const price = await rig.getPrice();
    const entropyFee = await rig.getEntropyFee();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;

    console.log("Price:", divDec(price));

    await rig
      .connect(user2)
      .spin(user2.address, epochId, deadline, price, { value: entropyFee });

    console.log("- User2 spun at price 0");
    console.log("New Init Price:", divDec(await rig.initPrice()));
    console.log("Prize Pool:", divDec(await rig.getPrizePool()));
  });

  it("Set new odds (50% for 1%, 30% for 2%, 20% for 5%)", async function () {
    console.log("******************************************************");
    const newOdds = [
      ...Array(50).fill(100),   // 1% = 100 bps
      ...Array(30).fill(200),   // 2% = 200 bps
      ...Array(20).fill(500),   // 5% = 500 bps
    ];

    await rig.connect(multisig).setOdds(newOdds);
    console.log("- Odds updated");
    console.log("New odds length:", (await rig.getOddsLength()).toString());
  });

  it("Cannot set odds below minimum (1% = 100 bps)", async function () {
    console.log("******************************************************");
    const badOdds = [50, 100, 200]; // 50 bps = 0.5%, below MIN_ODDS_BPS
    await expect(
      rig.connect(multisig).setOdds(badOdds)
    ).to.be.revertedWith("Rig__OddsTooLow");
    console.log("- Correctly rejected odds below minimum");
  });

  it("Cannot set odds over 100% (10000 bps)", async function () {
    console.log("******************************************************");
    const badOdds = [10001, 100, 200]; // 10001 bps > 100%
    await expect(
      rig.connect(multisig).setOdds(badOdds)
    ).to.be.revertedWith("Rig__InvalidOdds");
    console.log("- Correctly rejected odds over 100%");
  });

  it("Forward time 30 days (halving)", async function () {
    console.log("******************************************************");
    console.log("UPS before:", divDec(await rig.getUps()));
    await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
    await ethers.provider.send("evm_mine", []);
    console.log("UPS after 30 days:", divDec(await rig.getUps()));
    console.log("Pending Emissions:", divDec(await rig.getPendingEmissions()));
  });

  it("More spins after halving", async function () {
    console.log("******************************************************");
    const iterations = 5;
    let seqNum = 14;

    for (let i = 0; i < iterations; i++) {
      const timeSkip = Math.floor(Math.random() * 1800) + 600;
      await ethers.provider.send("evm_increaseTime", [timeSkip]);
      await ethers.provider.send("evm_mine", []);

      const user = [user0, user1, user2, user3][i % 4];
      const epochId = await rig.epochId();
      const price = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await rig
        .connect(user)
        .spin(user.address, epochId, deadline, price, { value: entropyFee });

      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`random${seqNum}`));
      await entropy.mockReveal(
        entropyProvider.address,
        seqNum++,
        randomNumber
      );

      console.log(`Spin ${i + 1}: Pool=${divDec(await rig.getPrizePool()).toFixed(2)}`);
    }
  });

  it("Final state", async function () {
    console.log("******************************************************");
    console.log("=== Final State ===");
    console.log("Epoch ID:", (await rig.epochId()).toString());
    console.log("Prize Pool:", divDec(await rig.getPrizePool()));
    console.log("UPS:", divDec(await rig.getUps()));
    console.log("\n=== User Balances ===");
    console.log("User0 LUCK:", divDec(await unit.balanceOf(user0.address)));
    console.log("User1 LUCK:", divDec(await unit.balanceOf(user1.address)));
    console.log("User2 LUCK:", divDec(await unit.balanceOf(user2.address)));
    console.log("User3 LUCK:", divDec(await unit.balanceOf(user3.address)));
    console.log("\n=== WETH Balances ===");
    console.log("Treasury WETH:", divDec(await weth.balanceOf(treasury.address)));
    console.log("Team WETH:", divDec(await weth.balanceOf(team.address)));
  });

  it("Test no team fee scenario", async function () {
    console.log("******************************************************");
    // Set team to address(0)
    await rig.connect(multisig).setTeam(AddressZero);
    console.log("- Team set to address(0)");

    // Fast forward and spin
    await ethers.provider.send("evm_increaseTime", [1800]);
    await ethers.provider.send("evm_mine", []);

    const epochId = await rig.epochId();
    const price = await rig.getPrice();
    const latest = await ethers.provider.getBlock("latest");
    const deadline = latest.timestamp + 3600;
    const entropyFee = await rig.getEntropyFee();

    const treasuryBalBefore = await weth.balanceOf(treasury.address);

    await rig
      .connect(user0)
      .spin(user0.address, epochId, deadline, price, { value: entropyFee });

    const treasuryBalAfter = await weth.balanceOf(treasury.address);

    console.log("Price paid:", divDec(price));
    console.log("Treasury received (100%):", divDec(treasuryBalAfter.sub(treasuryBalBefore)));
  });

  // ============================================
  // Business Logic Tests
  // ============================================

  describe("Dutch Auction Mechanics", function () {
    it("Price decays linearly over 1 hour", async function () {
      console.log("******************************************************");
      // Get current state after previous tests
      const initPrice = await rig.initPrice();
      const slotStartTime = await rig.slotStartTime();

      // Price at start should equal initPrice
      const priceAtStart = await rig.getPrice();

      // Forward 30 minutes (half epoch)
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const priceAtHalf = await rig.getPrice();
      const expectedHalfPrice = initPrice.div(2);

      // Allow small rounding difference
      expect(priceAtHalf).to.be.closeTo(expectedHalfPrice, expectedHalfPrice.div(100));
      console.log("Price at half epoch:", divDec(priceAtHalf));
      console.log("Expected half price:", divDec(expectedHalfPrice));

      // Forward another 30 minutes (full epoch)
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const priceAtEnd = await rig.getPrice();
      expect(priceAtEnd).to.equal(0);
      console.log("Price at end of epoch:", divDec(priceAtEnd));
    });

    it("Price resets to MIN_INIT_PRICE when spinning at price 0", async function () {
      console.log("******************************************************");
      const MIN_INIT_PRICE = ethers.utils.parseEther("0.0001");

      // Price should be 0 after full epoch
      const priceBefore = await rig.getPrice();
      expect(priceBefore).to.equal(0);

      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await rig.connect(user0).spin(user0.address, epochId, deadline, 0, { value: entropyFee });

      const newInitPrice = await rig.initPrice();
      expect(newInitPrice).to.equal(MIN_INIT_PRICE);
      console.log("New init price after 0 spin:", divDec(newInitPrice));
    });

    it("Price doubles after each spin (up to max)", async function () {
      console.log("******************************************************");
      const initPriceBefore = await rig.initPrice();

      // Fast forward 30 min to get a price
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const epochId = await rig.epochId();
      const price = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await rig.connect(user0).spin(user0.address, epochId, deadline, price, { value: entropyFee });

      const initPriceAfter = await rig.initPrice();
      const expectedNewInit = price.mul(2);

      console.log("Price paid:", divDec(price));
      console.log("New init price:", divDec(initPriceAfter));
      console.log("Expected (price * 2):", divDec(expectedNewInit));

      // New init should be price * 2 (or MIN if too low)
      const MIN_INIT_PRICE = ethers.utils.parseEther("0.0001");
      if (expectedNewInit.lt(MIN_INIT_PRICE)) {
        expect(initPriceAfter).to.equal(MIN_INIT_PRICE);
      } else {
        expect(initPriceAfter).to.equal(expectedNewInit);
      }
    });
  });

  describe("Fee Distribution", function () {
    it("Correctly splits 90/10 when team is set", async function () {
      console.log("******************************************************");
      // Reset team address
      await rig.connect(multisig).setTeam(team.address);

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();
      const maxPrice = await rig.getPrice();

      const treasuryBefore = await weth.balanceOf(treasury.address);
      const teamBefore = await weth.balanceOf(team.address);

      const tx = await rig.connect(user1).spin(user1.address, epochId, deadline, maxPrice, { value: entropyFee });
      const receipt = await tx.wait();

      // Get actual price from event
      const spinEvent = receipt.events.find(e => e.event === "Rig__Spin");
      const actualPrice = spinEvent.args.price;

      const treasuryAfter = await weth.balanceOf(treasury.address);
      const teamAfter = await weth.balanceOf(team.address);

      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const totalReceived = treasuryReceived.add(teamReceived);

      console.log("Actual Price:", divDec(actualPrice));
      console.log("Treasury received:", divDec(treasuryReceived));
      console.log("Team received:", divDec(teamReceived));

      // Verify 90/10 split
      expect(totalReceived).to.equal(actualPrice);
      expect(teamReceived).to.equal(actualPrice.mul(1000).div(10000)); // 10%
      expect(treasuryReceived).to.equal(actualPrice.sub(teamReceived)); // 90%
    });

    it("Treasury gets 100% when team is address(0)", async function () {
      console.log("******************************************************");
      await rig.connect(multisig).setTeam(AddressZero);

      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();
      const maxPrice = await rig.getPrice();

      const treasuryBefore = await weth.balanceOf(treasury.address);

      const tx = await rig.connect(user1).spin(user1.address, epochId, deadline, maxPrice, { value: entropyFee });
      const receipt = await tx.wait();

      // Get actual price from event
      const spinEvent = receipt.events.find(e => e.event === "Rig__Spin");
      const actualPrice = spinEvent.args.price;

      const treasuryAfter = await weth.balanceOf(treasury.address);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);

      console.log("Actual Price:", divDec(actualPrice));
      console.log("Treasury received:", divDec(treasuryReceived));

      expect(treasuryReceived).to.equal(actualPrice);
    });

    it("No fees collected when price is 0", async function () {
      console.log("******************************************************");
      // Forward past epoch end
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const price = await rig.getPrice();
      expect(price).to.equal(0);

      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      const treasuryBefore = await weth.balanceOf(treasury.address);

      await rig.connect(user1).spin(user1.address, epochId, deadline, 0, { value: entropyFee });

      const treasuryAfter = await weth.balanceOf(treasury.address);

      expect(treasuryAfter).to.equal(treasuryBefore);
      console.log("- No fees collected at price 0");
    });
  });

  describe("Emission Mechanics", function () {
    it("Emissions accumulate based on time elapsed", async function () {
      console.log("******************************************************");
      const ups = await rig.getUps();
      const pendingBefore = await rig.getPendingEmissions();

      // Forward 1 hour
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);

      const pendingAfter = await rig.getPendingEmissions();
      const expectedIncrease = ups.mul(3600);

      console.log("UPS:", divDec(ups));
      console.log("Pending before:", divDec(pendingBefore));
      console.log("Pending after:", divDec(pendingAfter));
      console.log("Expected increase:", divDec(expectedIncrease));

      // Pending should increase by UPS * 3600
      expect(pendingAfter.sub(pendingBefore)).to.be.closeTo(expectedIncrease, expectedIncrease.div(100));
    });

    it("Emissions are minted to prize pool on spin", async function () {
      console.log("******************************************************");
      const poolBefore = await rig.getPrizePool();
      const pendingEmissions = await rig.getPendingEmissions();

      const epochId = await rig.epochId();
      const price = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await rig.connect(user0).spin(user0.address, epochId, deadline, price, { value: entropyFee });

      const poolAfter = await rig.getPrizePool();

      console.log("Pool before:", divDec(poolBefore));
      console.log("Pending emissions:", divDec(pendingEmissions));
      console.log("Pool after:", divDec(poolAfter));

      // Pool should increase by pending emissions (minus any winnings paid out, but callback not triggered yet)
      expect(poolAfter.sub(poolBefore)).to.be.closeTo(pendingEmissions, pendingEmissions.div(100));
    });

    it("Halving occurs every 30 days", async function () {
      console.log("******************************************************");
      const upsBefore = await rig.getUps();

      // Forward 30 days
      await ethers.provider.send("evm_increaseTime", [3600 * 24 * 30]);
      await ethers.provider.send("evm_mine", []);

      const upsAfter = await rig.getUps();

      console.log("UPS before:", divDec(upsBefore));
      console.log("UPS after 30 days:", divDec(upsAfter));

      // UPS should be halved
      expect(upsAfter).to.equal(upsBefore.div(2));
    });

    it("Tail emissions kick in at minimum", async function () {
      console.log("******************************************************");
      const TAIL_UPS = ethers.utils.parseEther("0.01");

      // Forward many years to reach tail emissions
      await ethers.provider.send("evm_increaseTime", [3600 * 24 * 365 * 10]);
      await ethers.provider.send("evm_mine", []);

      const ups = await rig.getUps();

      console.log("UPS after 10 years:", divDec(ups));
      console.log("Tail UPS:", divDec(TAIL_UPS));

      expect(ups).to.equal(TAIL_UPS);
    });
  });

  describe("Odds and VRF", function () {
    it("Win amount is percentage of pool based on odds (basis points)", async function () {
      console.log("******************************************************");
      // Set simple odds: 100% chance of winning 10% (1000 bps)
      await rig.connect(multisig).setOdds([1000]);

      // Spin to build up pool
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine", []);

      const epochId = await rig.epochId();
      const maxPrice = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      const tx = await rig.connect(user2).spin(user2.address, epochId, deadline, maxPrice, { value: entropyFee });
      const receipt = await tx.wait();

      // Get sequence number from EntropyRequested event
      const entropyEvent = receipt.events.find(e => e.event === "Rig__EntropyRequested");
      const seqNum = entropyEvent.args.sequenceNumber;

      const poolBefore = await rig.getPrizePool();
      const user2BalBefore = await unit.balanceOf(user2.address);

      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test_odds"));

      await entropy.mockReveal(entropyProvider.address, seqNum, randomNumber);

      const poolAfter = await rig.getPrizePool();
      const user2BalAfter = await unit.balanceOf(user2.address);
      const winnings = user2BalAfter.sub(user2BalBefore);

      console.log("Pool before callback:", divDec(poolBefore));
      console.log("Pool after callback:", divDec(poolAfter));
      console.log("User2 winnings:", divDec(winnings));

      // Should win 10% of pool (1000 bps / 10000 = 10%)
      const expectedWin = poolBefore.mul(1000).div(10000);
      expect(winnings).to.equal(expectedWin);
    });

    it("Cannot set empty odds array", async function () {
      console.log("******************************************************");
      await expect(
        rig.connect(multisig).setOdds([])
      ).to.be.revertedWith("Rig__InvalidOdds");
      console.log("- Correctly rejected empty odds");
    });
  });

  describe("Access Control", function () {
    it("Only owner can set treasury", async function () {
      console.log("******************************************************");
      await expect(
        rig.connect(user0).setTreasury(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      console.log("- Non-owner cannot set treasury");
    });

    it("Only owner can set team", async function () {
      console.log("******************************************************");
      await expect(
        rig.connect(user0).setTeam(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      console.log("- Non-owner cannot set team");
    });

    it("Only owner can set odds", async function () {
      console.log("******************************************************");
      await expect(
        rig.connect(user0).setOdds([1, 2, 3])
      ).to.be.revertedWith("Ownable: caller is not the owner");
      console.log("- Non-owner cannot set odds");
    });

    it("Cannot set treasury to address(0)", async function () {
      console.log("******************************************************");
      await expect(
        rig.connect(multisig).setTreasury(AddressZero)
      ).to.be.revertedWith("Rig__InvalidTreasury");
      console.log("- Cannot set treasury to zero address");
    });
  });

  describe("Spin Validation", function () {
    it("Cannot spin with wrong epochId", async function () {
      console.log("******************************************************");
      const epochId = await rig.epochId();
      const wrongEpochId = epochId.add(1);
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(user0.address, wrongEpochId, deadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__EpochIdMismatch");
      console.log("- Correctly rejected wrong epochId");
    });

    it("Cannot spin with expired deadline", async function () {
      console.log("******************************************************");
      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const expiredDeadline = latest.timestamp - 1;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(user0.address, epochId, expiredDeadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__Expired");
      console.log("- Correctly rejected expired deadline");
    });

    it("Cannot spin with spinner as address(0)", async function () {
      console.log("******************************************************");
      const epochId = await rig.epochId();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      await expect(
        rig.connect(user0).spin(AddressZero, epochId, deadline, 0, { value: entropyFee })
      ).to.be.revertedWith("Rig__InvalidSpinner");
      console.log("- Correctly rejected zero address spinner");
    });

    it("Cannot spin if price exceeds maxPrice", async function () {
      console.log("******************************************************");
      // The initPrice is set to MIN_INIT_PRICE (0.0001 ether) at start of each epoch
      // Setting maxPrice to 0 should fail since any price > 0 would exceed it

      const epochId = await rig.epochId();
      const price = await rig.getPrice();
      const latest = await ethers.provider.getBlock("latest");
      const deadline = latest.timestamp + 3600;
      const entropyFee = await rig.getEntropyFee();

      // Only test if price is > 0, otherwise skip
      if (price.gt(0)) {
        let reverted = false;
        try {
          // Set maxPrice to 0, which should fail since actual price > 0
          await rig.connect(user0).spin(user0.address, epochId, deadline, 0, { value: entropyFee });
        } catch (e) {
          reverted = true;
          expect(e.message).to.include("Rig__MaxPriceExceeded");
        }
        expect(reverted).to.be.true;
        console.log("- Correctly rejected price exceeding maxPrice");
      } else {
        // If price is 0, spin to create a new epoch with non-zero initPrice, then test
        await rig.connect(user0).spin(user0.address, epochId, deadline, 0, { value: entropyFee });

        // Now there's a new epoch with initPrice = MIN_INIT_PRICE
        const newEpochId = await rig.epochId();
        const newPrice = await rig.getPrice();
        const newLatest = await ethers.provider.getBlock("latest");
        const newDeadline = newLatest.timestamp + 3600;

        expect(newPrice).to.be.gt(0);

        let reverted = false;
        try {
          await rig.connect(user0).spin(user0.address, newEpochId, newDeadline, 0, { value: entropyFee });
        } catch (e) {
          reverted = true;
          expect(e.message).to.include("Rig__MaxPriceExceeded");
        }
        expect(reverted).to.be.true;
        console.log("- Correctly rejected price exceeding maxPrice");
      }
    });
  });
});
