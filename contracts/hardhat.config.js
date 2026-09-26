require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config({ path: '../.env' });
require('dotenv').config();

/**
 * Hardhat configuration for the FluxCoin token suite.
 *
 * Fill the variables below in the repository root `.env` (see .env.example):
 *   RPC_URL_SEPOLIA / RPC_URL_BSC / RPC_URL_POLYGON / RPC_URL_MAINNET
 *   DEPLOYER_PRIVATE_KEY   <- wallet that pays deployment gas
 *   BACKEND_MINTER_ADDRESS <- the API server hot-wallet address (gets MINTER_ROLE)
 *   GELATO_TRUSTED_FORWARDER (optional, defaults to the Gelato Relay forwarder)
 */
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      // OpenZeppelin 5.x uses the Cancun `mcopy` opcode, so the target EVM must be
      // Cancun (supported by Ethereum, BSC and Polygon). If you deploy to a chain
      // that is not Cancun-ready yet, pin @openzeppelin/contracts@5.1.0 instead.
      evmVersion: 'cancun'
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // Allows testing the gasless relayer path locally without real funds.
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: process.env.RPC_URL_LOCAL || 'http://127.0.0.1:8545',
      chainId: 31337
    },
    sepolia: {
      url: process.env.RPC_URL_SEPOLIA || 'https://rpc.sepolia.org',
      chainId: 11155111,
      accounts
    },
    bscTestnet: {
      url: process.env.RPC_URL_BSC_TESTNET || 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      accounts
    },
    bsc: {
      url: process.env.RPC_URL_BSC || 'https://bsc-dataseed.binance.org',
      chainId: 56,
      accounts
    },
    polygon: {
      url: process.env.RPC_URL_POLYGON || 'https://polygon-rpc.com',
      chainId: 137,
      accounts
    },
    mainnet: {
      url: process.env.RPC_URL_MAINNET || 'https://eth.llamarpc.com',
      chainId: 1,
      accounts
    }
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      bsc: process.env.BSCSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || ''
    }
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  },
  mocha: { timeout: 120000 }
};
