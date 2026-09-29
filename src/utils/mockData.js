/**
 * Display-only data.
 *
 * IMPORTANT: nothing in this file is ever rendered as a wallet address, a balance
 * or a transaction. Balances/addresses come from `src/wallet/*` (real provider
 * reads) and ledger rows come from `src/api/client.js` (real backend records).
 *
 * The token presets mirror the 5 per-asset Flash contracts exactly (ids,
 * symbols and decimals must match src/contracts/assets.js).
 */

/**
 * The 5 forgeable assets — exactly five, no more, no less.
 * USDT is the default (tokens[0] = the pre-selected preset).
 */
export const tokens = [
  { id: 'usdt', name: 'Flash USDT', symbol: 'USDT', decimals: 6, type: 'ERC-20', color: '#26a17b' },
  { id: 'btc', name: 'Flash Bitcoin', symbol: 'BTC', decimals: 8, type: 'ERC-20', color: '#f7931a' },
  { id: 'eth', name: 'Flash Ethereum', symbol: 'ETH', decimals: 18, type: 'ERC-20', color: '#627eea' },
  { id: 'trx', name: 'Flash TRX', symbol: 'TRX', decimals: 6, type: 'ERC-20', color: '#ef0027' },
  { id: 'sol', name: 'Flash Solana', symbol: 'SOL', decimals: 9, type: 'ERC-20', color: '#9945ff' }
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
