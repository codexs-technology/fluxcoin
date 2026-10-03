/**
 * Per-asset Flash token registry (frontend side).
 *
 * Each asset has its OWN contract — USDT / BTC / ETH / TRX / SOL (on-chain names
 * are the plain tickers, locked — immutable after deploy) — all
 * deployed from contracts/scripts/deployFlashAssets.js. The addresses come
 * from the root .env via VITE_TOKEN_ADDRESS_<ID> and are validated before use,
 * so an unset slot never becomes a random placeholder address.
 *
 * KEEP IN SYNC with:
 *   - api/src/assets.ts (the Worker mirror)
 *   - contracts/scripts/deployFlashAssets.js (the deploy source of truth)
 */
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** The 5 asset presets — name/symbol/decimals must match the deployed contracts exactly. */
export const FLASH_ASSETS = [
  { id: 'usdt', name: 'USDT', symbol: 'USDT', decimals: 6, color: '#26a17b', envVar: 'VITE_TOKEN_ADDRESS_USDT' },
  { id: 'btc', name: 'BTC', symbol: 'BTC', decimals: 8, color: '#f7931a', envVar: 'VITE_TOKEN_ADDRESS_BTC' },
  { id: 'eth', name: 'ETH', symbol: 'ETH', decimals: 18, color: '#627eea', envVar: 'VITE_TOKEN_ADDRESS_ETH' },
  { id: 'trx', name: 'TRX', symbol: 'TRX', decimals: 6, color: '#ef0027', envVar: 'VITE_TOKEN_ADDRESS_TRX' },
  { id: 'sol', name: 'SOL', symbol: 'SOL', decimals: 9, color: '#9945ff', envVar: 'VITE_TOKEN_ADDRESS_SOL' }
];

/** Registry with the .env addresses resolved + validated. */
export const flashAssets = FLASH_ASSETS.map((asset) => {
  const raw = env[asset.envVar];
  const address = typeof raw === 'string' && EVM_ADDRESS_RE.test(raw.trim()) ? raw.trim() : '';
  return { ...asset, address, configured: Boolean(address) };
});

/** Default asset when nothing is selected (the tokens[0] preset = USDT). */
export const DEFAULT_ASSET_ID = 'usdt';

/** Resolves a preset id or ticker ("usdt" / "USDT") to the flash asset (falls back to USDT). */
export function getFlashAsset(idOrSymbol) {
  if (!idOrSymbol) return flashAssets[0];
  const key = String(idOrSymbol).toLowerCase();
  return flashAssets.find((asset) => asset.id === key || asset.symbol.toLowerCase() === key) || flashAssets[0];
}

/** Assets whose contract address is wired in this build. */
export function configuredFlashAssets() {
  return flashAssets.filter((asset) => asset.configured);
}

/** Human readable hint for the UI when contracts are not wired yet. */
export function flashAssetHint() {
  const missing = flashAssets.filter((asset) => !asset.configured);
  if (!missing.length) return null;
  const names = missing.map((asset) => asset.envVar).join(', ');
  return `Missing contract addresses: ${names} — run contracts/scripts/deployFlashAssets.js and fill the VITE_TOKEN_ADDRESS_* values in the root .env (chain 137 = Polygon).`;
}
