const { ethers } = require("hardhat");
const { utils, BigNumber } = require("ethers");
const hre = require("hardhat");
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const AddressZero = "0x0000000000000000000000000000000000000000";

/*===================================================================*/
/*===========================  SETTINGS  ============================*/

const MULTISIG_ADDRESS = "0x7a8C895E7826F66e1094532cB435Da725dc3868f"; // Multisig Address
const DAO_ADDRESS = "0x3eb3c6660835b2da6008EE2D60b3A6b484eDDDE3"; // DAO Address
const TREASURY_ADDRESS = "0x7a8C895E7826F66e1094532cB435Da725dc3868f"; // Treasury Address
const ENTROPY_ADDRESS = "0x6E7D74FA7d5c90FEF9F0512987605a6d546181Bb"; // Entropy Address
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH Address
const LP_ADDRESS = "0x0000000000000000000000000000000000000000"; // LP Address
const DONUT_ADDRESS = "0xAE4a37d554C6D6F3E398546d8566B25052e0169C"; // Donut Address
const REF_LP_ADDRESS = "0xD1DbB2E56533C55C3A637D13C53aeEf65c5D5703"; // Ref LP Address
const ADDRESS_DEAD = "0x000000000000000000000000000000000000dEaD";
const AUCTION_PERIOD = 86400; // 1 day
const PRICE_MULTIPLIER = convert("1.2", 18); // 120%
const MIN_INIT_PRICE = convert("1", 18); // 1 LP

/*===========================  END SETTINGS  ========================*/
/*===================================================================*/

// Contract Variables
let unit, rig, auction, multicall;

/*===================================================================*/
/*===========================  CONTRACT DATA  =======================*/

async function getContracts() {
  rig = await ethers.getContractAt(
    "contracts/Rig.sol:Rig",
    "0x9C8959C9675f26852Ed9E048c92C5d32C9eE7513"
  );
  unit = await ethers.getContractAt("contracts/Rig.sol:Unit", await rig.unit());
  multicall = await ethers.getContractAt(
    "contracts/Multicall.sol:Multicall",
    "0x027F9C2306f998a2994005eEc1a5F61c2259Af8D"
  );
  // auction = await ethers.getContractAt("contracts/Auction.sol:Auction", "");
  console.log("Contracts Retrieved");
}

/*===========================  END CONTRACT DATA  ===================*/
/*===================================================================*/

async function deployRig() {
  console.log("Starting Rig Deployment");
  const rigArtifact = await ethers.getContractFactory("Rig");
  const rigContract = await rigArtifact.deploy(
    "DonatardioTest",
    "DOTARD",
    WETH_ADDRESS,
    ENTROPY_ADDRESS,
    TREASURY_ADDRESS,
    {
      gasPrice: ethers.gasPrice,
    }
  );
  rig = await rigContract.deployed();
  await sleep(5000);
  console.log("Rig Deployed at:", rig.address);
}

async function verifyUnit() {
  console.log("Starting Unit Verification");
  await hre.run("verify:verify", {
    address: unit.address,
    contract: "contracts/Rig.sol:Unit",
    constructorArguments: ["DonatardioTest", "DOTARD"],
  });
  console.log("Unit Verified");
}

async function verifyRig() {
  console.log("Starting Rig Verification");
  await hre.run("verify:verify", {
    address: rig.address,
    contract: "contracts/Rig.sol:Rig",
    constructorArguments: [
      "DonatardioTest",
      "DOTARD",
      WETH_ADDRESS,
      ENTROPY_ADDRESS,
      TREASURY_ADDRESS,
    ],
  });
  console.log("Rig Verified");
}

async function deployMulticall() {
  console.log("Starting Multicall Deployment");
  const multicallArtifact = await ethers.getContractFactory("Multicall");
  const multicallContract = await multicallArtifact.deploy(rig.address, {
    gasPrice: ethers.gasPrice,
  });
  multicall = await multicallContract.deployed();
  await sleep(5000);
  console.log("Multicall Deployed at:", multicall.address);
}

async function verifyMulticall() {
  console.log("Starting Multicall Verification");
  await hre.run("verify:verify", {
    address: multicall.address,
    contract: "contracts/Multicall.sol:Multicall",
    constructorArguments: [rig.address],
  });
  console.log("Multicall Verified");
}

async function deployAuction() {
  console.log("Starting Auction Deployment");
  const auctionArtifact = await ethers.getContractFactory("Auction");
  const auctionContract = await auctionArtifact.deploy(
    MIN_INIT_PRICE,
    LP_ADDRESS,
    ADDRESS_DEAD,
    AUCTION_PERIOD,
    PRICE_MULTIPLIER,
    MIN_INIT_PRICE,
    {
      gasPrice: ethers.gasPrice,
    }
  );
  auction = await auctionContract.deployed();
  await sleep(5000);
  console.log("Auction Deployed at:", auction.address);
}

async function verifyAuction() {
  console.log("Starting Auction Verification");
  await hre.run("verify:verify", {
    address: auction.address,
    contract: "contracts/Auction.sol:Auction",
    constructorArguments: [
      MIN_INIT_PRICE,
      LP_ADDRESS,
      ADDRESS_DEAD,
      AUCTION_PERIOD,
      PRICE_MULTIPLIER,
      MIN_INIT_PRICE,
    ],
  });
  console.log("Auction Verified");
}

async function printDeployment() {
  console.log("**************************************************************");
  console.log("Unit: ", unit.address);
  console.log("Rig: ", rig.address);
  console.log("Multicall: ", multicall.address);
  // console.log("Auction: ", auction.address);
  console.log("**************************************************************");
}

async function main() {
  const [wallet] = await ethers.getSigners();
  console.log("Using wallet: ", wallet.address);

  await getContracts();

  //===================================================================
  // Deploy System
  //===================================================================

  // console.log("Starting System Deployment");
  // await deployRig();
  // await deployAuction();
  // await deployMulticall();
  await printDeployment();

  /*********** UPDATE getContracts() with new addresses *************/

  //===================================================================
  // Verify System
  //===================================================================

  // console.log("Starting System Verification");
  // await verifyUnit();
  // await sleep(5000);
  // await verifyRig();
  // await sleep(5000);
  // await verifyMulticall();
  // await sleep(5000);
  // await verifyAuction();
  // await sleep(5000);

  //===================================================================
  // Transactions
  //===================================================================

  // set odds (in basis points: 100 = 1%, 5000 = 50%)
  // Slot machine style distribution:
  // const odds = [
  //   ...Array(100).fill(100),   // 50% chance of 1%   (3x Cherry)
  //   ...Array(50).fill(200),    // 25% chance of 2%   (3x Lemon)
  //   ...Array(30).fill(500),    // 15% chance of 5%   (3x Bar)
  //   ...Array(14).fill(1000),   // 7% chance of 10%   (3x Bell)
  //   ...Array(5).fill(2500),    // 2.5% chance of 25% (3x 7)
  //   ...Array(1).fill(5000),    // 0.5% chance of 50% (3x Diamond)
  // ];
  // await rig.setOdds(odds);
  // console.log("Odds set on Rig");

  // set treasury on rig to auction
  // await rig.setTreasury(auction.address);
  // console.log("Treasury set on Rig to Auction");

  // set ownership of rig to multisig
  // await rig.transferOwnership(DAO_ADDRESS);
  // console.log("Ownership of Rig transferred to DAO");

  // console.log("Slot 0: ", await multicall.getSlot(0));
  // console.log("Slot 0: ", await rig.getSlot(0));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
