/**
 * Wallet session persistence.
 *
 * The session is written after every successful connect and re-read on page
 * load so the UI can restore (and silently re-validate) the connection instead
 * of asking the user to connect again.
 *
 * Nothing secret is stored here — only the public address, the chain and which
 * connector was used.
 */
const STORAGE_KEY = 'fluxcoin.wallet.session.v2';
/** Plain mirror of the connected address (quick reads + UI re-hydration). */
const WALLET_ADDRESS_KEY = 'fluxcoin_wallet';

export function saveSession(session) {
  try {
    const payload = {
      ...session,
      savedAt: Date.now()
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (payload.address) window.localStorage.setItem(WALLET_ADDRESS_KEY, payload.address);
    return payload;
  } catch (error) {
    console.warn('[wallet] could not persist session', error);
    return null;
  }
}

export function loadSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.address) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(WALLET_ADDRESS_KEY);
  } catch (error) {
    console.warn('[wallet] could not clear session', error);
  }
}

/** Last connected address, or null. Read without parsing the whole session. */
export function loadStoredAddress() {
  try {
    return window.localStorage.getItem(WALLET_ADDRESS_KEY) || loadSession()?.address || null;
  } catch {
    return null;
  }
}

export const SESSION_STORAGE_KEY = STORAGE_KEY;
export const WALLET_ADDRESS_STORAGE_KEY = WALLET_ADDRESS_KEY;
