const { config } = require("dotenv");

require("@nomiclabs/hardhat-waffle");
require("@nomicfoundation/hardhat-verify");
require("solidity-coverage");

const CHAIN_ID = 8453; // base chain id

config();
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const SCAN_API_KEY = process.env.SCAN_API_KEY || "";
const RPC_URL = process.env.RPC_URL || "";

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    mainnet: {
      url: RPC_URL,
      chainId: CHAIN_ID,
      accounts: [PRIVATE_KEY],
    },
    hardhat: {},
  },
  etherscan: {
    apiKey: SCAN_API_KEY,
    customChains: [
      {
        network: "mainnet",
        chainId: 8453,
        urls: {
          // apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          // browserURL: "https://sepolia.basescan.org/",
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org/",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 300000,
  },
};
