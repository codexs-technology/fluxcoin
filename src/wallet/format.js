/**
 * Small display/format helpers shared by the wallet UI.
 * The UI never invents an address: everything below only *renders* a real one.
 */

/** 0xAb3Cd...9F2 style truncation (works for EVM and Solana addresses). */
export function truncateAddress(address, lead = 4, tail = 4) {
  if (!address || typeof address !== 'string') return '';
  if (address.length <= lead + tail + 3) return address;
  return `${address.slice(0, 2 + lead)}...${address.slice(-tail)}`;
}

export function truncateHash(hash, lead = 10, tail = 8) {
  if (!hash || typeof hash !== 'string') return '';
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}...${hash.slice(-tail)}`;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isEvmAddress(value) {
  return typeof value === 'string' && EVM_ADDRESS_RE.test(value);
}

export function isSolanaAddress(value) {
  return typeof value === 'string' && SOLANA_ADDRESS_RE.test(value) && !value.startsWith('0x');
}

/** Parses a user typed token amount into a JS number, or null when invalid. */
export function parseTokenAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trims trailing zeros of a balance string without losing precision. */
export function prettyAmount(value, maxDecimals = 6) {
  if (value === null || value === undefined || value === '') return '0';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function shortChainLabel(networkName, chainId) {
  if (networkName) return networkName;
  return chainId ? `Chain ${chainId}` : 'Unknown network';
}
