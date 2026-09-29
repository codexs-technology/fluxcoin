/**
 * Display-only data.
 *
 * IMPORTANT: nothing in this file is ever rendered as a wallet address, a balance
 * or a transaction. Balances/addresses come from `src/wallet/*` (real provider
 * reads) and ledger rows come from `src/api/client.js` (real backend records).
 *
 * The token presets are DERIVED from src/contracts/assets.js — the single
 * source of truth for asset ids/symbols/decimals — so the display list can
 * never drift from what the API calls send (`asset: id` on every request).
 */
import { FLASH_ASSETS } from '../contracts/assets.js';

/**
 * The 5 forgeable assets — exactly five, no more, no less, generated from the
 * registry (ids must match api/src/assets.ts). USDT is the default
 * (tokens[0] = the pre-selected preset).
 */
export const tokens = FLASH_ASSETS.map(({ id, name, symbol, decimals, color }) => ({
  id,
  name,
  symbol,
  decimals,
  type: 'ERC-20',
  color
}));

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
