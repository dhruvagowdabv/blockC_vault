
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  const provider = new hre.ethers.providers.JsonRpcProvider(process.env.AMOY_RPC);
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  const addr = key.startsWith("0x") ? hre.ethers.utils.computeAddress(key) : hre.ethers.utils.computeAddress("0x"+key);
  const bal = await provider.getBalance(addr);
  console.log("Address:", addr);
  console.log("Balance (MATIC):", hre.ethers.utils.formatEther(bal));
}
main().catch(e => { console.error(e); process.exit(1); });
