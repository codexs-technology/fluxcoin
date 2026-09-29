/**
 * Frontend API client.
 *
 * All transport lives in src/lib/api.js (single base URL, single error
 * classification). This module owns the *protocol*: the endpoints the FluxCoin
 * Worker exposes, the wallet sign-in handshake and the session storage.
 *
 * Session storage (localStorage):
 *   fluxcoin_session           -> HMAC session token issued by the Worker
 *   fluxcoin_session_address   -> wallet the token belongs to
 *   fluxcoin_wallet            -> last connected wallet (UI re-hydration)
 */
import { walletManager } from '../wallet/manager.js';
import {
  API_BASE,
  apiFetch,
  checkBackend,
  clearStoredSession as clearApiSession,
  describeBackendIssue,
  getStoredSessionAddress,
  getStoredToken,
  getStoredWalletAddress,
  storeSession
} from '../lib/api.js';

export { API_BASE, getStoredWalletAddress };

export function getSessionToken() {
  return getStoredToken();
}

export function getSessionAddress() {
  return getStoredSessionAddress();
}

export { clearApiSession, describeBackendIssue };

function storeApiSession(payload) {
  storeSession({ token: payload?.token, address: payload?.address || walletManager.getAddress() });
}

/** Clears the session when the Worker rejects it (401). */
export async function request(path, opts = {}) {
  try {
    return await apiFetch(path, opts);
  } catch (error) {
    if (error.status === 401) clearApiSession();
    throw error;
  }
}

/** Signs the Worker-provided login message with the *connected* provider. */
async function signLoginMessage(message) {
  const address = walletManager.getAddress();
  const provider = walletManager.getEip1193Provider();
  if (provider?.request) {
    return provider.request({ method: 'personal_sign', params: [message, address] });
  }
  return walletManager.signMessage(message);
}

/**
 * Wallet login.
 *
 * Preferred path: a SIWE-style handshake — the Worker builds the message, the
 * wallet signs it and the Worker recovers the signer before issuing a token
 * (`signatureVerified: true`).
 *
 * Fallback (only when the Wallet cannot sign at all, e.g. a locked or
 * read-only provider, or a Worker build without the SIWE routes): a one-click
 * `POST /api/auth { address }`. A *rejected or invalid signature* is never
 * downgraded to that path.
 */
export async function loginWithWallet() {
  const state = walletManager.getState();
  const address = walletManager.getAddress();
  if (!address || state.evm === false) {
    throw new Error('Connect an EVM wallet before signing in');
  }

  try {
    const issued = await request('/api/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ address })
    });
    const signature = await signLoginMessage(issued.message);
    const verified = await request('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ address, message: issued.message, signature })
    });
    storeApiSession(verified);
    return verified;
  } catch (error) {
    // 4xx from the Worker means the wallet refused or the signature was wrong:
    // surface it instead of silently continuing without a proof of ownership.
    if (error.status && error.status !== 404) throw error;
  }

  const verified = await request('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ address })
  });
  storeApiSession(verified);
  return verified;
}

/** True when a stored session token belongs to the currently connected wallet. */
export function hasValidSession() {
  const token = getStoredToken();
  if (!token) return false;
  const walletAddress = walletManager.getAddress();
  if (!walletAddress) return true; // nothing connected yet — keep the session
  const sessionAddress = getStoredSessionAddress();
  return !sessionAddress || sessionAddress.toLowerCase() === walletAddress.toLowerCase();
}

/** Ensures a session exists: reuse it, refresh it for a new wallet, or sign in. */
export async function ensureSession() {
  if (hasValidSession()) return { address: walletManager.getAddress(), reused: true };
  if (!walletManager.getAddress()) {
    throw new Error('Connect your wallet first — earnings are credited to a real address');
  }
  // The stored token belongs to another wallet: drop it before signing in again.
  clearApiSession();
  const verified = await loginWithWallet();
  return { ...verified, reused: false };
}

// --- endpoints ---------------------------------------------------------------

/**
 * Earned (site) balance + real on-chain balance for the signed-in wallet.
 * `asset` (usdt/btc/eth/trx/sol) selects which Flash contract is read; it
 * defaults to the backend's default asset when omitted.
 */
export function fetchBalance(address = null, asset = null) {
  const targetAddress = address || walletManager.getAddress();
  const query = asset ? `?asset=${encodeURIComponent(asset)}` : '';
  if (targetAddress) return request(`/api/balance/${targetAddress}${query}`);
  return request(`/api/balance${query}`);
}

/** Audit trail (credits + withdrawals) for the signed-in wallet. */
export function fetchLedger() {
  return request('/api/earn/history');
}

/**
 * Credits earned coins of the selected asset. The Worker owns the limits
 * (min/max, cooldown, daily cap) — the browser amount is only a request.
 */
export function claimEarn(amount, { asset, source } = {}) {
  return request('/api/forge', {
    method: 'POST',
    body: JSON.stringify({
      address: walletManager.getAddress(),
      quantity: String(amount),
      asset: asset || 'usdt',
      source: source || 'forge'
    })
  });
}

/** Gasless mode, limits and token metadata (no session required). */
export function fetchWithdrawConfig() {
  return request('/api/withdraw/config');
}

export function fetchWithdrawHistory(limit = 25) {
  return request(`/api/withdraw/history?limit=${limit}`);
}

/**
 * Starts a withdrawal of ONE asset: the Worker validates, reserves and settles
 * gas-free from that asset's Flash contract (usdt/btc/eth/trx/sol).
 */
export function requestWithdrawal(amount, asset = 'usdt') {
  return request('/api/withdraw', {
    method: 'POST',
    body: JSON.stringify({
      address: walletManager.getAddress(),
      amount: String(amount),
      asset
    })
  });
}

/** Status of a sponsored UserOperation (ERC-4337 route). */
export function pollWithdrawStatus(userOpHash) {
  return request(`/api/withdraw/status/${userOpHash}`);
}

export { request as apiRequest };

/** Health probe — drives the dynamic backend banner (see src/lib/api.js). */
export function checkApiHealth() {
  return checkBackend();
}

