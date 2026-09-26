import { Router } from 'express';
import { ethers } from 'ethers';
import config from '../config.js';
import * as ledger from '../services/ledger.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseAmountToWei } from '../services/withdrawal.js';

/**
 * Earning coins (the faucet "generate" action).
 *   POST /api/earn  { amount, source } -> credits the user's SITE balance
 *
 * These coins are off-chain until the user withdraws (then they are minted as
 * real ERC-20 FLUX). Anti-abuse limits are enforced here, server-side:
 *   - per-claim bounds (EARN_MIN_TOKENS / EARN_MAX_TOKENS)
 *   - cooldown between claims (EARN_COOLDOWN_SECONDS)
 *   - daily cap per wallet (EARN_DAILY_CAP_TOKENS)
 */
export const earnRouter = Router();

earnRouter.post('/', requireAuth, rateLimit({ keyPrefix: 'earn', windowMs: 60_000, max: 30 }), (req, res) => {
  const { amount, source = 'forge', meta = {} } = req.body || {};

  const parsed = parseAmountToWei(amount);
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false,
      error: parsed.error,
      message: 'Enter a valid positive amount with at most 18 decimals'
    });
  }

  const limits = config.limits;
  if (parsed.wei < limits.earnMinWei) {
    return res.status(400).json({
      ok: false,
      error: 'BELOW_MINIMUM',
      message: `Minimum claim is ${ethers.formatUnits(limits.earnMinWei, config.decimals)} FLUX`
    });
  }
  if (parsed.wei > limits.earnMaxWei) {
    return res.status(400).json({
      ok: false,
      error: 'ABOVE_MAXIMUM',
      message: `Maximum claim is ${ethers.formatUnits(limits.earnMaxWei, config.decimals)} FLUX per request`
    });
  }

  const account = ledger.getAccount(req.address);
  const sinceLast = Date.now() - (account.lastEarnAt || 0);
  if (sinceLast < limits.earnCooldownMs) {
    return res.status(429).json({
      ok: false,
      error: 'COOLDOWN_ACTIVE',
      message: `Wait ${Math.ceil((limits.earnCooldownMs - sinceLast) / 1000)}s before the next claim`,
      retryAfterMs: limits.earnCooldownMs - sinceLast
    });
  }

  if (BigInt(account.earnedToday) + parsed.wei > limits.earnDailyCapWei) {
    return res.status(429).json({
      ok: false,
      error: 'DAILY_CAP_EXCEEDED',
      message: `Daily earning cap is ${ethers.formatUnits(limits.earnDailyCapWei, config.decimals)} FLUX`
    });
  }

  const { account: updated, entry } = ledger.creditEarn({
    address: req.address,
    amountWei: parsed.wei,
    source,
    meta: { ...meta, userAgent: req.headers['user-agent']?.slice(0, 120) }
  });

  return res.json({
    ok: true,
    entry: {
      id: entry.id,
      amountTokens: ethers.formatUnits(parsed.wei, config.decimals),
      status: entry.status,
      createdAt: entry.createdAt
    },
    site: {
      availableTokens: ethers.formatUnits(BigInt(updated.available), config.decimals),
      earnedTokens: ethers.formatUnits(BigInt(updated.earned), config.decimals),
      earnedTodayTokens: ethers.formatUnits(BigInt(updated.earnedToday), config.decimals)
    }
  });
});

/** Full ledger for the connected wallet (earn + withdrawal audit trail). */
earnRouter.get('/history', requireAuth, (req, res) => {
  const entries = ledger.listEntries(req.address, 100).map((entry) => ({
    id: entry.id,
    type: entry.type,
    status: entry.status,
    amountTokens: ethers.formatUnits(BigInt(entry.amount), config.decimals),
    txHash: entry.txHash || null,
    method: entry.method || null,
    createdAt: entry.createdAt
  }));
  res.json({ ok: true, entries });
});
