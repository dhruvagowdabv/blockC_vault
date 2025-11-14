require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

module.exports = {
  defaultNetwork: "localhost",

  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },

    amoy: {
      url: "https://rpc-amoy.polygon.technology/",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 80002
    }
  },

  solidity: {
    version: "0.8.21",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  }
};
