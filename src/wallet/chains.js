/**
 * Supported networks + RPC configuration.
 *
 * Every RPC URL can be overridden through Vite env vars so you never ship a
 * public rate-limited endpoint to production:
 *   VITE_RPC_1, VITE_RPC_11155111, VITE_RPC_137, VITE_RPC_56, VITE_RPC_97
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const CHAIN_LIST = [
  {
    chainId: 11155111,
    hex: '0xaa36a7',
    name: 'Sepolia Testnet',
    shortName: 'Sepolia',
    currency: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    rpc: env.VITE_RPC_11155111 || 'https://rpc.sepolia.org',
    testnet: true
  },
  {
    chainId: 1,
    hex: '0x1',
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    currency: 'ETH',
    explorer: 'https://etherscan.io',
    rpc: env.VITE_RPC_1 || 'https://eth.llamarpc.com',
    testnet: false
  },
  {
    chainId: 56,
    hex: '0x38',
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    currency: 'BNB',
    explorer: 'https://bscscan.com',
    rpc: env.VITE_RPC_56 || 'https://bsc-dataseed.binance.org',
    testnet: false
  },
  {
    chainId: 137,
    hex: '0x89',
    name: 'Polygon PoS',
    shortName: 'Polygon',
    currency: 'MATIC',
    explorer: 'https://polygonscan.com',
    rpc: env.VITE_RPC_137 || 'https://polygon-bor-rpc.publicnode.com',
    testnet: false
  },
  {
    chainId: 97,
    hex: '0x61',
    name: 'BNB Testnet',
    shortName: 'BSC Testnet',
    currency: 'tBNB',
    explorer: 'https://testnet.bscscan.com',
    rpc: env.VITE_RPC_97 || 'https://data-seed-prebsc-1-s1.binance.org:8545',
    testnet: true
  }
];

export const SUPPORTED_NETWORKS = CHAIN_LIST.reduce((map, chain) => {
  map[chain.chainId] = chain;
  return map;
}, {});

/** Chain the Flash contracts live on — Polygon (137) is the production network. */
export const ACTIVE_CHAIN_ID = Number(env.VITE_NETWORK_ID || 137);

/** Fallback is Polygon (production chain), never an unrelated first entry. */
export const ACTIVE_CHAIN = SUPPORTED_NETWORKS[ACTIVE_CHAIN_ID] || SUPPORTED_NETWORKS[137];

export function getChain(chainId) {
  return SUPPORTED_NETWORKS[Number(chainId)] || null;
}

export function networkName(chainId) {
  const chain = getChain(chainId);
  return chain ? chain.name : `Chain ID ${chainId}`;
}

export function explorerTxUrl(hash, chainId = ACTIVE_CHAIN_ID) {
  const chain = getChain(chainId) || ACTIVE_CHAIN;
  return hash && chain ? `${chain.explorer}/tx/${hash}` : null;
}

export function explorerAddressUrl(address, chainId = ACTIVE_CHAIN_ID) {
  const chain = getChain(chainId) || ACTIVE_CHAIN;
  return address && chain ? `${chain.explorer}/address/${address}` : null;
}
