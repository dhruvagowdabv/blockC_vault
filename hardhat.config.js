// hardhat.config.js
require("dotenv").config();
require("@nomiclabs/hardhat-ethers");

const AMOY_RPC = process.env.AMOY_RPC || "https://rpc-amoy.polygon.technology/";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.17",
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 1337
    },
    amoy: {
      url: AMOY_RPC,
      chainId: 80002,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
