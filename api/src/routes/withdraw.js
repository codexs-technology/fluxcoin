import { Router } from 'express';
import { ethers } from 'ethers';
import config from '../config.js';
import * as ledger from '../services/ledger.js';
import { requireAuth, requireMatchingAddress } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  parseAmountToWei,
  validateWithdrawal,
  startWithdrawal,
  completeGelatoWithdrawal,
  getHistory,
  resolveMode
} from '../services/withdrawal.js';
import { getPaymasterData, isPaymasterConfigured, publicPaymasterConfig } from '../services/paymaster.js';

/**
 * Withdrawals — the bridge from site balance to real on-chain FLUX.
 *
 *   GET  /api/withdraw/config    -> which gasless mode is active + limits
 *   POST /api/withdraw           -> validate + reserve + (mint | get authorization to sign)
 *   POST /api/withdraw/relayed   -> finish a Gelato ERC-2771 meta-transaction
 *   GET  /api/withdraw/history   -> audit trail with explorer links
 *
 * In EVERY mode the user pays 0 gas:
 *   - server-sponsored : the project backend wallet mints and pays the gas
 *   - gelato-erc2771   : the user only signs typed data; Gelato relays (project 1Balance)
 *   - biconomy-4337    : the user's smart account sends the UserOp; the paymaster pays
 */
export const withdrawRouter = Router();

withdrawRouter.get('/config', (_req, res) => {
  res.json({
    ok: true,
    mode: resolveMode(),
    chainId: config.chain.chainId,
    token: { address: config.chain.tokenAddress || null, symbol: 'FLUX', decimals: config.decimals },
    faucet: config.chain.faucetAddress || null,
    minTokens: ethers.formatUnits(config.limits.withdrawMinWei, config.decimals),
    maxTokens: ethers.formatUnits(config.limits.withdrawMaxWei, config.decimals),
    dailyCapTokens: ethers.formatUnits(config.limits.withdrawDailyCapWei, config.decimals),
    userGasCost: '0',
    paymaster: isPaymasterConfigured() ? publicPaymasterConfig() : null
  });
});

withdrawRouter.post(
  '/',
  requireAuth,
  requireMatchingAddress,
  rateLimit({ keyPrefix: 'withdraw', windowMs: 60_000, max: 10 }),
  async (req, res, next) => {
    try {
      const parsed = parseAmountToWei(req.body?.amount);
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error, message: 'Invalid withdrawal amount' });
      }

      const validation = validateWithdrawal({ address: req.address, amountWei: parsed.wei });
      if (!validation.ok) {
        return res.status(400).json({ ok: false, ...validation });
      }

      const result = await startWithdrawal({ address: req.address, amountWei: parsed.wei });
      if (!result.ok) {
        return res.status(400).json(result);
      }

      // Audit log for the terminal UI (never logs secrets).
      console.log(`[withdraw] ${req.address} -> ${result.amount} FLUX via ${result.mode} (${result.status})`);
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

withdrawRouter.post(
  '/relayed',
  requireAuth,
  rateLimit({ keyPrefix: 'withdraw-relayed', windowMs: 60_000, max: 10 }),
  async (req, res, next) => {
    try {
      const { reservationId, struct, userSignature } = req.body || {};
      if (!reservationId || !struct || !userSignature) {
        return res.status(400).json({ ok: false, error: 'MISSING_RELAY_PAYLOAD' });
      }

      const entry = ledger.listEntries(null, 1000).find((item) => item.id === reservationId);
      if (!entry || entry.address.toLowerCase() !== req.address.toLowerCase()) {
        return res.status(403).json({ ok: false, error: 'RESERVATION_MISMATCH' });
      }

      // The meta-transaction must target our faucet and the signed user must be the session wallet.
      if (String(struct.user).toLowerCase() !== req.address.toLowerCase()) {
        return res.status(403).json({ ok: false, error: 'RELAY_USER_MISMATCH' });
      }
      if (String(struct.target).toLowerCase() !== String(config.chain.faucetAddress).toLowerCase()) {
        return res.status(400).json({ ok: false, error: 'RELAY_TARGET_MISMATCH' });
      }

      const result = await completeGelatoWithdrawal({ reservationId, struct, userSignature });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

withdrawRouter.get('/history', requireAuth, (req, res) => {
  res.json({ ok: true, entries: getHistory(req.address, Number(req.query.limit) || 50) });
});

/**
 * ERC-4337 paymaster proxy: the browser builds the UserOperation, we request the
 * sponsorship data from Biconomy with OUR api key (never exposed to the client).
 */
withdrawRouter.post('/paymaster/sponsor', requireAuth, async (req, res, next) => {
  try {
    if (!isPaymasterConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'PAYMASTER_NOT_CONFIGURED',
        message: 'Set BICONOMY_PAYMASTER_URL and BICONOMY_BUNDLER_URL in api/.env to sponsor UserOperations'
      });
    }
    const { stage = 'data', userOp, entryPoint, chainId } = req.body || {};
    if (!userOp) return res.status(400).json({ ok: false, error: 'USER_OP_REQUIRED' });

    const paymasterData = await getPaymasterData({ stage, userOp, entryPoint, chainId });
    return res.json({ ok: true, stage, paymasterData });
  } catch (error) {
    return next(error);
  }
});
