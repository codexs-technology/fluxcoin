import { Router } from 'express';
import { ethers } from 'ethers';
import config from '../config.js';
import * as ledger from '../services/ledger.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getOnChainTokenBalance, getChainStatus } from '../services/chain.js';
import { resolveMode } from '../services/withdrawal.js';

/**
 * Balances.
 *   GET /api/balance -> { site: {...}, onchain: {...}, chain: {...} }
 *
 * The *site* balance is what the user earned (authoritative for withdrawals).
 * The *onchain* balance is the real ERC-20 FLUX held by the wallet.
 */
export const balanceRouter = Router();

function serializeAccount(account) {
  return {
    address: account.address,
    availableTokens: ethers.formatUnits(BigInt(account.available), config.decimals),
    reservedTokens: ethers.formatUnits(BigInt(account.reserved), config.decimals),
    earnedTokens: ethers.formatUnits(BigInt(account.earned), config.decimals),
    withdrawnTokens: ethers.formatUnits(BigInt(account.withdrawn), config.decimals),
    earnedTodayTokens: ethers.formatUnits(BigInt(account.earnedToday), config.decimals),
    lastEarnAt: account.lastEarnAt || null,
    lastWithdrawAt: account.lastWithdrawAt || null
  };
}

balanceRouter.get('/', requireAuth, rateLimit({ keyPrefix: 'balance', max: 120 }), async (req, res) => {
  const account = ledger.getAccount(req.address);
  const onchain = await getOnChainTokenBalance(req.address);

  res.json({
    ok: true,
    site: serializeAccount(account),
    onchain: {
      balanceTokens: onchain,
      symbol: 'FLUX',
      decimals: config.decimals,
      tokenAddress: config.chain.tokenAddress || null
    },
    chain: {
      chainId: config.chain.chainId,
      gaslessMode: resolveMode(),
      withdrawMinTokens: ethers.formatUnits(config.limits.withdrawMinWei, config.decimals),
      withdrawMaxTokens: ethers.formatUnits(config.limits.withdrawMaxWei, config.decimals),
      withdrawDailyCapTokens: ethers.formatUnits(config.limits.withdrawDailyCapWei, config.decimals)
    }
  });
});

balanceRouter.get('/account', requireAuth, (req, res) => {
  res.json({ ok: true, site: serializeAccount(ledger.getAccount(req.address)) });
});

balanceRouter.get('/status', async (_req, res) => {
  res.json({ ok: true, status: await getChainStatus(), ledger: ledger.stats() });
});
