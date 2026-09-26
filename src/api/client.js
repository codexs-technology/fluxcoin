/**
 * Frontend API client.
 *
 * The site's *earned* balance and the withdrawal authorizations live on the
 * backend (see /api). This module talks to it and manages the wallet session
 * token: the user proves ownership by signing a message with their real wallet,
 * nothing is ever trusted from the browser.
 */
import { walletManager } from '../wallet/manager.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const API_BASE = (env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN_KEY = 'fluxcoin.api.session.v1';

export function getSessionToken() {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || (parsed.expiresAt && parsed.expiresAt < Date.now())) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

export function getSessionAddress() {
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw).address || null : null;
  } catch {
    return null;
  }
}

function storeSession({ token, address, expiresInMs }) {
  window.localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ token, address, expiresAt: Date.now() + (expiresInMs || 24 * 60 * 60 * 1000) - 60_000 })
  );
}

export function clearApiSession() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const token = auth ? getSessionToken() : null;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `Request failed (${response.status})`);
    error.code = payload.error;
    error.status = response.status;
    error.details = payload;
    if (response.status === 401) clearApiSession();
    throw error;
  }

  return payload;
}

/**
 * Wallet login (SIWE-style) — proves ownership of the connected address.
 * The signature is produced by the user's real wallet; the backend verifies it
 * before any balance information is released.
 */
export async function loginWithWallet() {
  const address = walletManager.getAddress();
  if (!address || !walletManager.getState().evm) {
    throw new Error('Connect an EVM wallet before signing in');
  }

  const nonce = await request('/api/auth/nonce', { method: 'POST', auth: false, body: { address } });
  const signature = await walletManager.signMessage(nonce.message);
  const verified = await request('/api/auth/verify', {
    method: 'POST',
    auth: false,
    body: { address, signature }
  });

  storeSession(verified);
  return verified;
}

/** True when a stored session token exists for the currently connected wallet. */
export function hasValidSession() {
  const token = getSessionToken();
  if (!token) return false;
  const sessionAddress = getSessionAddress();
  const walletAddress = walletManager.getAddress();
  return Boolean(sessionAddress && walletAddress && sessionAddress.toLowerCase() === walletAddress.toLowerCase());
}

/** Ensures a signed session exists (signs in once, silently reuses afterwards). */
export async function ensureSession() {
  if (hasValidSession()) return { address: walletManager.getAddress(), reused: true };
  const verified = await loginWithWallet();
  return { ...verified, reused: false };
}

/** Site (earned) balance + on-chain balance. */
export function fetchBalance() {
  return request('/api/balance');
}

export function fetchLedger() {
  return request('/api/earn/history');
}

/** Credit earned coins (server-side validated, rate-limited). */
export function claimEarn(amount, meta = {}) {
  return request('/api/earn', { method: 'POST', body: { amount: String(amount), source: 'forge', meta } });
}

export function fetchWithdrawConfig() {
  return request('/api/withdraw/config', { auth: false });
}

export function fetchWithdrawHistory(limit = 25) {
  return request(`/api/withdraw/history?limit=${limit}`);
}

/** Starts a withdrawal: the backend validates the balance and picks the gasless route. */
export function requestWithdrawal(amount) {
  return request('/api/withdraw', { method: 'POST', body: { amount: String(amount) } });
}

/** Finishes a Gelato ERC-2771 withdrawal after the user signed the meta-transaction. */
export function submitRelayedWithdrawal({ reservationId, struct, userSignature }) {
  return request('/api/withdraw/relayed', {
    method: 'POST',
    body: { reservationId, struct, userSignature }
  });
}

/** ERC-4337 paymaster sponsorship proxy (keeps your Biconomy key server-side). */
export function sponsorUserOperation({ stage = 'data', userOp }) {
  return request('/api/withdraw/paymaster/sponsor', { method: 'POST', body: { stage, userOp } });
}

export { request as apiRequest };

/** Is the backend reachable? (drives the honest "offline" banner in the UI) */
export async function checkApiHealth() {
  try {
    const payload = await request('/api/health', { auth: false });
    return { online: true, ...payload };
  } catch (error) {
    return { online: false, error: error.message };
  }
}
