import { Router } from 'express';
import { ethers } from 'ethers';
import { issueNonce, verifySignature, issueSessionToken, readSessionToken } from '../services/session.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import config from '../config.js';

/**
 * Wallet authentication.
 *   POST /api/auth/nonce  { address }              -> message to sign (SIWE-style)
 *   POST /api/auth/verify { address, signature }   -> session token
 *   GET  /api/auth/session                         -> is my token still valid?
 */
export const authRouter = Router();

authRouter.post(
  '/nonce',
  rateLimit({ keyPrefix: 'auth-nonce', windowMs: 60_000, max: 20 }),
  (req, res) => {
    const { address } = req.body || {};
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ ok: false, error: 'INVALID_ADDRESS' });
    }
    return res.json({ ok: true, ...issueNonce(address) });
  }
);

authRouter.post(
  '/verify',
  rateLimit({ keyPrefix: 'auth-verify', windowMs: 60_000, max: 20 }),
  (req, res) => {
    const { address, signature } = req.body || {};
    if (!address || !signature) {
      return res.status(400).json({ ok: false, error: 'ADDRESS_AND_SIGNATURE_REQUIRED' });
    }

    const result = verifySignature({ address, signature });
    if (!result.ok) {
      return res.status(401).json({ ok: false, error: result.error, message: 'Wallet signature rejected' });
    }

    const token = issueSessionToken(result.address);
    return res.json({
      ok: true,
      address: result.address,
      token,
      chainId: config.chain.chainId,
      expiresInMs: config.session.ttlMs
    });
  }
);

authRouter.get('/session', requireAuth, (req, res) => {
  res.json({ ok: true, address: req.address, valid: Boolean(readSessionToken(req.headers.authorization?.slice(7))) });
});
