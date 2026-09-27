/**
 * src/lib/api.js — the single source of truth for "where is the backend?".
 *
 * Every API call goes through `apiFetch()` here, so there is exactly one base
 * URL to configure and one place that can explain a connection error.
 *
 * Base URL resolution (first match wins):
 *   1. `VITE_API_URL` from .env.development / .env.production / .env
 *   2. `http://localhost:8787`   (dev: `npm run dev` inside api/)
 *   3. `https://fluxcoin.codexstechnology.workers.dev` (production Worker)
 *
 * Step 3 matters: a production build with an unset/placeholder VITE_API_URL used
 * to fall back to `''`, so `/api/health` was requested from the Pages origin,
 * returned the SPA HTML and surfaced as "Failed to fetch" -> "Backend offline".
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const API_BASE = String(env.VITE_API_URL || '').trim().replace(/\/+$/, '');

/** localStorage keys shared by the whole app. */
export const SESSION_KEY = 'fluxcoin_session';
export const SESSION_ADDRESS_KEY = 'fluxcoin_session_address';
export const WALLET_KEY = 'fluxcoin_wallet';

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — the session simply does not persist */
  }
}

function dropStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getStoredToken() {
  return readStorage(SESSION_KEY);
}

export function getStoredSessionAddress() {
  return readStorage(SESSION_ADDRESS_KEY);
}

/** Last connected wallet address (used to re-hydrate the UI on reload). */
export function getStoredWalletAddress() {
  return readStorage(WALLET_KEY);
}

export function storeSession({ token, address }) {
  if (token) writeStorage(SESSION_KEY, token);
  if (address) {
    writeStorage(SESSION_ADDRESS_KEY, address);
    writeStorage(WALLET_KEY, address);
  }
}

export function clearStoredSession() {
  dropStorage(SESSION_KEY);
  dropStorage(SESSION_ADDRESS_KEY);
}

/**
 * Performs an API call: attaches the session token, uses CORS-safe headers and
 * turns every failure mode into a typed error so the UI can explain what
 * actually went wrong instead of printing "Failed to fetch".
 */
export async function apiFetch(path, opts = {}) {
  const { headers: optionHeaders, body, signal, ...rest } = opts;
  const token = getStoredToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...optionHeaders
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      body,
      headers,
      cache: 'no-store',
      signal
    });
  } catch (networkError) {
    const error = new Error(
      `Could not reach the FluxCoin API at ${API_BASE} (${networkError.message || 'network error'})`
    );
    error.offline = true;
    error.base = API_BASE;
    throw error;
  }

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A 200 with HTML means we are talking to a static site, not to the API.
      const error = new Error(
        `${API_BASE} answered ${response.status} with HTML instead of JSON — the API base URL points at a static site`
      );
      error.status = response.status;
      error.notApi = true;
      error.base = API_BASE;
      throw error;
    }
  }

  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `API ${response.status}`);
    error.status = response.status;
    error.code = payload.error || 'HTTP_ERROR';
    error.payload = payload;
    throw error;
  }

  return payload;
}

/** Human readable explanation for a failed `apiFetch`, used by the UI banner. */
export function describeBackendIssue(error) {
  if (!error) return `The API at ${API_BASE} could not be reached.`;
  if (error.offline || error.notApi) return error.message;
  if (error.status === 401) return 'Your session expired — sign in again with your wallet.';
  if (error.status === 403) return error.message || 'The API refused this request for the connected wallet.';
  if (error.status === 404) return `The API at ${API_BASE} has no route for this request (404).`;
  if (error.status === 429) return error.message || 'Too many requests — wait a moment and retry.';
  if (error.status >= 500) return `The API responded ${error.status}: ${error.message}`;
  return error.message || `The API at ${API_BASE} could not be reached.`;
}

/**
 * Health probe used by the balance card. Verifies that the response really
 * comes from the FluxCoin Worker (`ok: true` + `service: "fluxcoin-api"`) so a
 * cached SPA page can never be mistaken for a healthy backend.
 */
export async function checkBackend({ timeoutMs = 8000 } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = await apiFetch('/api/health', { signal: controller.signal });
    if (payload?.ok !== true || payload?.service !== 'fluxcoin-api') {
      return {
        online: false,
        base: API_BASE,
        latencyMs: Date.now() - startedAt,
        reason: 'not-fluxcoin-api',
        error: `${API_BASE} is reachable but is not the FluxCoin API (service: ${payload?.service || 'unknown'})`
      };
    }
    return { online: true, base: API_BASE, latencyMs: Date.now() - startedAt, payload, error: null, reason: null };
  } catch (error) {
    return {
      online: false,
      base: API_BASE,
      latencyMs: Date.now() - startedAt,
      reason: error.notApi ? 'not-fluxcoin-api' : 'unreachable',
      error: describeBackendIssue(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

