import { readSessionToken } from '../services/session.js';

/**
 * Wallet-session guard.
 * The address used for withdrawals always comes from the signed session token —
 * never from the request body — so a user cannot withdraw someone else's coins.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = readSessionToken(token);

  if (!session) {
    return res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Connect your wallet and sign the login message first'
    });
  }

  req.session = session;
  req.address = session.address;
  return next();
}

/** Ensures the body address (if provided) matches the signed session address. */
export function requireMatchingAddress(req, res, next) {
  const requested = req.body?.address;
  if (requested && String(requested).toLowerCase() !== String(req.address).toLowerCase()) {
    return res.status(403).json({
      ok: false,
      error: 'ADDRESS_MISMATCH',
      message: 'Withdrawals must target the wallet that signed the session'
    });
  }
  return next();
}
