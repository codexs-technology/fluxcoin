/**
 * Display-only data.
 *
 * IMPORTANT: nothing in this file is ever rendered as a wallet address, a balance
 * or a transaction. Balances/addresses come from `src/wallet/*` (real provider
 * reads) and ledger rows come from `src/api/client.js` (real backend records).
 *
 * The old `walletProviders` array (a hardcoded list that made every button connect
 * the same random provider) is gone — installed wallets are discovered via
 * EIP-6963 in `src/wallet/eip6963.js`.
 */

/** Visual presets for the forge animation. FLUX is the real, withdrawable coin. */
export const tokens = [
  { id: 'flux', name: 'FluxCoin', symbol: 'FLUX', decimals: 18, type: 'ERC-20', color: '#00f0ff', live: true },
  { id: 'usdt', name: 'Tether USD', symbol: 'USDT', decimals: 6, type: 'ERC-20', color: '#26a17b', live: false },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', decimals: 18, type: 'Native', color: '#627eea', live: false },
  { id: 'wbtc', name: 'Wrapped BTC', symbol: 'WBTC', decimals: 8, type: 'ERC-20', color: '#f7931a', live: false }
];

/**
 * Demo telemetry. These numbers are simulated for the dashboard look and are
 * labelled as such in the UI (`NetworkTelemetry.jsx`) — block height and balances
 * shown elsewhere come from the real chain/API.
 */
export const initialTelemetryData = {
  hashRate: 245.67,
  mempoolLoad: 1245,
  throughput: 15.8,
  peerMesh: 42,
  gasPressure: 25,
  currentBlock: 18245672,
  settlementStatus: 'Idle'
};
