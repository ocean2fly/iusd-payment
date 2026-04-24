import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    cabal: {
      url: process.env.CABAL_RPC_URL || "https://json-rpc.cabal-1.initia.xyz",
      chainId: 119,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    civitia: {
      url: process.env.CIVITIA_RPC_URL || "https://json-rpc.civitia-2.initia.xyz",
      chainId: 120,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

export default config;
