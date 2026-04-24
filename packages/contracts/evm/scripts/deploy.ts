import { ethers } from "hardhat";

async function main() {
  const iUSDAddress = process.env.IUSD_TOKEN_ADDRESS;
  if (!iUSDAddress) {
    throw new Error("IUSD_TOKEN_ADDRESS environment variable is required");
  }

  console.log("Deploying IPayRouter...");
  console.log("iUSD token address:", iUSDAddress);

  const IPayRouter = await ethers.getContractFactory("IPayRouter");
  const router = await IPayRouter.deploy(iUSDAddress);
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  console.log("IPayRouter deployed to:", routerAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
