export const tokens = [
  { id: 'usdt', name: 'USDT', symbol: 'USDT', decimals: 6, type: 'ERC-20', color: '#26a17b' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', decimals: 18, type: 'Native', color: '#627eea' },
  { id: 'wbtc', name: 'Bitcoin Wrapped', symbol: 'WBTC', decimals: 8, type: 'BRC-20', color: '#f7931a' }
];

export const feeTiers = [
  { id: 'retail', name: 'Retail', fee: 50, min: 1000, desc: 'Standard mempool prioritization' },
  { id: 'pro', name: 'Pro', fee: 250, min: 5000, desc: 'Accelerated flashbots relay routing' },
  { id: 'institutional', name: 'Institutional', fee: 12000, min: 100000, desc: 'Private validator enclave bypass' }
];

export const initialTelemetryData = {
  hashRate: 245.67,
  mempoolLoad: 1245,
  throughput: 15.8,
  peerMesh: 42,
  gasPressure: 25,
  currentBlock: 18245672,
  settlementStatus: 'Idle'
};

export const walletProviders = [
  { id: 'metamask', name: 'MetaMask', icon: '🦊' },
  { id: 'trust', name: 'Trust Wallet', icon: '🛡️' },
  { id: 'binance', name: 'Binance Wallet', icon: '🟡' },
  { id: 'walletconnect', name: 'WalletConnect', icon: '⚡' },
  { id: 'coinbase', name: 'Coinbase', icon: '🔵' },
  { id: 'phantom', name: 'Phantom', icon: '👻' },
];
