/**
 * Persisted network selection (the "03 // Settlement Wallet" dropdown).
 *
 * The wallet's LIVE chain is always the truth (`walletManager.state.chainId`,
 * updated by `chainChanged` events). This preference only remembers the last
 * chain the user (or the connected wallet) had selected, so a page refresh can
 * put the wallet back on it and so actions like "IMPORT FLASH TOKENS" know
 * which chain must NOT be overridden.
 *
 * Rules (network-selection bug fix):
 *   - the USER's selection always wins for every wallet action (import /
 *     withdraw / generate / swap) — no action may stomp it;
 *   - the preference survives page refreshes (localStorage);
 *   - the build default (VITE_NETWORK_ID / Polygon 137) is used ONLY when the
 *     user never selected anything or the wallet sits on an unknown chain;
 *   - Sepolia (11155111) is NEVER an implicit fallback — it is only reachable
 *     when the user explicitly picks it.
 */
import { SUPPORTED_NETWORKS } from './chains.js';

const STORAGE_KEY = 'fluxcoin.networkPreference.v1';

/** Last chain the user selected (number) or null when never set / unknown. */
export function getPreferredNetworkId() {
  try {
    const parsed = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(parsed) && SUPPORTED_NETWORKS[parsed] ? parsed : null;
  } catch {
    return null;
  }
}

/** Remembers a chain selection. Unsupported/unknown chains are ignored. */
export function setPreferredNetworkId(chainId) {
  const parsed = Number(chainId);
  if (!Number.isInteger(parsed) || !SUPPORTED_NETWORKS[parsed]) return null;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(parsed));
    return parsed;
  } catch {
    return null;
  }
}

export function clearPreferredNetworkId() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the preference is best-effort anyway */
  }
}
