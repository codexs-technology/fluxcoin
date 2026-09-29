/**
 * Withdrawal engine.
 *
 * The user never pays gas and never broadcasts a transaction: the Worker
 * validates the earned balance, reserves the coins, settles them through the
 * configured route and only then books the withdrawal. If anything fails after
 * the reservation, the coins are refunded so the balance can never be lost.
 */
import { parseUnits, type Address, type Hex } from 'viem';
import { assetLimits, explorerTxUrl, weiToTokens, type FluxConfig } from './config.js';
import type { AssetConfig } from './assets.js';
import { settleServerSponsored } from './chain.js';
import { executeGaslessWithdrawal, getUserOpReceipt } from './paymaster.js';
import {
  getAccount,
  getAssetAccount,
  listEntries,
  refundWithdrawal,
  reserveWithdrawal,
  serializeAccount,
  settleWithdrawal,
  type Store
} from './store.js';

export type AmountParse =
  | { ok: true; wei: bigint; display: string }
  | { ok: false; error: string; message: string };

/** Human amount -> base units of the ASSET (USDT 6d, BTC 8d, ETH 18d, …). */
export function parseAmount(amount: unknown, decimals: number = 18): AmountParse {
  if (amount === undefined || amount === null || amount === '') {
    return { ok: false, error: 'AMOUNT_REQUIRED', message: 'Enter a withdrawal amount' };
  }

  const text = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, error: 'INVALID_AMOUNT', message: `Enter a valid positive amount with at most ${decimals} decimals` };
  }
  if ((text.split('.')[1] || '').length > decimals) {
    return { ok: false, error: 'TOO_MANY_DECIMALS', message: `This asset has ${decimals} decimals` };
  }

  try {
    const wei = parseUnits(text, decimals);
    if (wei <= 0n) return { ok: false, error: 'AMOUNT_NOT_POSITIVE', message: 'Enter an amount greater than zero' };
    return { ok: true, wei, display: text };
  } catch {
    return { ok: false, error: 'INVALID_AMOUNT', message: `Enter a valid positive amount with at most ${decimals} decimals` };
  }
}

/** Today's already-withdrawn total for ONE asset (legacy entries count as 'flux'). */
function withdrawalsTodayWei(entries: Awaited<ReturnType<typeof listEntries>>, assetId: string): bigint {
  const today = new Date().toISOString().slice(0, 10);
  return entries
    .filter(
      (entry) =>
        entry.type === 'withdraw' &&
        (entry.asset || 'flux') === assetId &&
        entry.createdAt.slice(0, 10) === today &&
        entry.status !== 'FAILED'
    )
    .reduce((total, entry) => total + BigInt(entry.amount), 0n);
}

/** Pure validation — the browser checks the same rules, the Worker is the authority. */
export async function validateWithdrawal({
  store,
  config,
  address,
  amountWei,
  asset
}: {
  store: Store;
  config: FluxConfig;
  address: string;
  amountWei: bigint;
  /** The selected asset (its decimals drive the limit conversion). */
  asset: AssetConfig;
}): Promise<
  | { ok: true; available: string }
  | { ok: false; error: string; message: string; available?: string }
> {
  const limits = assetLimits(config, asset.decimals);
  if (amountWei < limits.withdrawMinWei) {
    return {
      ok: false,
      error: 'BELOW_MINIMUM',
      message: `Minimum withdrawal is ${weiToTokens(limits.withdrawMinWei, asset.decimals)} ${asset.symbol}`
    };
  }
  if (amountWei > limits.withdrawMaxWei) {
    return {
      ok: false,
      error: 'ABOVE_MAXIMUM',
      message: `Maximum withdrawal is ${weiToTokens(limits.withdrawMaxWei, asset.decimals)} ${asset.symbol} per request`
    };
  }

  const account = await getAccount(store, address);
  const slot = getAssetAccount(account, asset.id);
  const available = BigInt(slot.available);
  if (amountWei > available) {
    return {
      ok: false,
      error: 'INSUFFICIENT_SITE_BALANCE',
      message: 'You cannot withdraw more than your earned site balance',
      available: weiToTokens(available, asset.decimals)
    };
  }

  const usedToday = withdrawalsTodayWei(await listEntries(store, address, 100), asset.id);
  if (usedToday + amountWei > limits.withdrawDailyCapWei) {
    return {
      ok: false,
      error: 'DAILY_CAP_EXCEEDED',
      message: 'Daily withdrawal cap reached — try again tomorrow',
      available: weiToTokens(usedToday, asset.decimals)
    };
  }

  return { ok: true, available: weiToTokens(available, asset.decimals) };
}

export type UserOpRecord = {
  reservationId: string;
  address: string;
  asset?: string | null;
  amount: string;
  status: 'PENDING' | 'SUCCESS' | 'REVERTED';
  txHash: string | null;
  paymasterUrl: string;
  createdAt: number;
};

const userOpKey = (hash: string) => `userop:${hash.toLowerCase()}`;

export type WithdrawalResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string; message: string; status: number; available?: string };

/**
 * Validates, reserves, settles and books a withdrawal of ONE asset.
 * `payload` is what the browser receives and forwards to the terminal UI.
 *
 * The route is resolved per asset: an asset without a contract address falls
 * back to dry-run (when ALLOW_DRY_RUN=true) instead of failing, so the UI can
 * say exactly which asset is not wired yet.
 */
export async function startWithdrawal({
  store,
  config,
  address,
  amountWei,
  asset
}: {
  store: Store;
  config: FluxConfig;
  address: string;
  amountWei: bigint;
  /** The selected Flash asset (address/symbol/decimals). */
  asset: AssetConfig;
}): Promise<WithdrawalResult> {
  // --- per-asset gasless route resolution ----------------------------------
  const requested = config.gasless.requested;
  const hasPaymaster = Boolean(config.gasless.paymasterUrl);
  const hasServer = Boolean(config.keys.minterPrivateKey && config.chain.rpcUrl && asset.address);
  let mode: string;
  if (requested === 'dry-run') mode = config.allowDryRun ? 'dry-run' : 'unavailable';
  else if (requested === 'paymaster')
    mode = hasPaymaster ? 'paymaster-4337' : config.allowDryRun ? 'dry-run' : 'unavailable';
  else if (requested === 'server')
    mode = hasServer ? 'server-sponsored' : config.allowDryRun ? 'dry-run' : 'unavailable';
  else
    mode = hasPaymaster
      ? 'paymaster-4337'
      : hasServer
        ? 'server-sponsored'
        : config.allowDryRun
          ? 'dry-run'
          : 'unavailable';

  if (mode === 'unavailable') {
    return {
      ok: false,
      error: 'WITHDRAWALS_DISABLED',
      message: `No gasless route is configured for ${asset.symbol} (set PAYMASTER_URL or MINTER_PRIVATE_KEY + ${asset.envName ?? 'TOKEN_ADDRESS_' + asset.id.toUpperCase()})`,
      status: 503
    };
  }

  const validation = await validateWithdrawal({ store, config, address, amountWei, asset });
  if (!validation.ok) {
    return { ok: false, error: validation.error, message: validation.message, status: 400, available: validation.available };
  }

  const reservation = await reserveWithdrawal({ store, address, asset: asset.id, amountWei });
  if (!reservation.ok || !reservation.reservationId) {
    return {
      ok: false,
      error: reservation.error || 'RESERVATION_FAILED',
      message: 'The earned balance changed — reload and try again',
      status: 409,
      available: reservation.available
    };
  }

  const base = {
    ok: true,
    reservationId: reservation.reservationId,
    asset: asset.id,
    symbol: asset.symbol,
    decimals: asset.decimals,
    amount: weiToTokens(amountWei, asset.decimals),
    amountWei: amountWei.toString(),
    mode,
    userGasCost: '0',
    chainId: config.chain.chainId
  };

  // --- 1. sponsored ERC-4337 UserOperation --------------------------------
  if (mode === 'paymaster-4337') {
    if (!asset.address) {
      await refundWithdrawal({ store, reservationId: reservation.reservationId, reason: 'TOKEN_ADDRESS missing' });
      return {
        ok: false,
        error: 'TOKEN_ADDRESS_REQUIRED',
        message: `${asset.envName} must be set for sponsored ${asset.symbol} withdrawals`,
        status: 503
      };
    }

    try {
      const result = await executeGaslessWithdrawal({
        paymasterUrl: config.gasless.paymasterUrl,
        recipientAddress: address as Address,
        amountWei,
        tokenAddress: asset.address as Address,
        rpcUrl: config.chain.rpcUrl,
        sponsorPrivateKey: (config.keys.minterPrivateKey || undefined) as Hex | undefined,
        chainId: config.chain.chainId
      });

      const record: UserOpRecord = {
        reservationId: reservation.reservationId,
        address,
        asset: asset.id,
        amount: amountWei.toString(),
        status: 'PENDING',
        txHash: result.userOpHash || null,
        paymasterUrl: config.gasless.paymasterUrl,
        createdAt: Date.now()
      };
      await store.put(userOpKey(result.userOpHash || reservation.reservationId), JSON.stringify(record), 60 * 60 * 24 * 7);

      return {
        ok: true,
        payload: {
          ...base,
          status: 'PENDING',
          userOpHash: result.userOpHash,
          sender: result.sender,
          gasPaidBy: 'project-paymaster',
          steps: [
            'backend validated your earned balance',
            'sponsored UserOperation sent to the bundler',
            'the project paymaster pays the gas'
          ]
        }
      };
    } catch (error) {
      await refundWithdrawal({ store, reservationId: reservation.reservationId, reason: (error as Error).message });
      return {
        ok: false,
        error: 'USEROP_SUBMISSION_FAILED',
        message: (error as Error).message || 'The sponsored UserOperation could not be submitted',
        status: 502
      };
    }
  }

  // --- 2. server-sponsored mint/transfer (project pays the gas) -------------
  if (mode === 'server-sponsored') {
    try {
      const result = await settleServerSponsored({
        config,
        recipient: address,
        amountWei,
        tokenAddress: asset.address,
        symbol: asset.symbol
      });
      const settled = await settleWithdrawal({
        store,
        reservationId: reservation.reservationId,
        txHash: result.txHash,
        method: `server-${result.method}`,
        payer: result.payer
      });

      return {
        ok: true,
        payload: {
          ...base,
          status: 'CONFIRMED',
          txHash: result.txHash,
          explorerUrl: explorerTxUrl(config, result.txHash),
          gasPaidBy: result.payer,
          balance: settled ? serializeAccount(settled.account, asset.id, asset.decimals) : null,
          steps: [
            'backend validated your earned balance',
            `project wallet ${result.method === 'mint' ? 'minted' : 'transferred'} the ${asset.symbol}`,
            'the project paid the gas — your cost is 0'
          ]
        }
      };
    } catch (error) {
      await refundWithdrawal({ store, reservationId: reservation.reservationId, reason: (error as Error).message });
      return {
        ok: false,
        error: 'SPONSORED_SETTLEMENT_FAILED',
        message: (error as Error).message || 'The sponsored settlement failed on-chain',
        status: 502
      };
    }
  }

  // --- 3. dry run: booked and validated, nothing broadcast -------------------
  const settled = await settleWithdrawal({
    store,
    reservationId: reservation.reservationId,
    txHash: null,
    method: 'dry-run',
    payer: 'dry-run (ALLOW_DRY_RUN=true)',
    simulated: true
  });

  return {
    ok: true,
    payload: {
      ...base,
      status: 'SIMULATED',
      simulated: true,
      txHash: null,
      explorerUrl: null,
      gasPaidBy: 'dry-run (ALLOW_DRY_RUN=true)',
      balance: settled ? serializeAccount(settled.account, asset.id, asset.decimals) : null,
      steps: [
        'backend validated your earned balance',
        'withdrawal booked as SIMULATED (no transaction was broadcast)',
        `set MINTER_PRIVATE_KEY + ${asset.envName} to settle real ${asset.symbol}`
      ]
    }
  };
}

/** Polls the bundler for a pending sponsored withdrawal and books the result. */
export async function resolveUserOperation({
  store,
  config,
  userOpHash
}: {
  store: Store;
  config: FluxConfig;
  userOpHash: string;
}): Promise<{ ok: boolean; status: 'PENDING' | 'SUCCESS' | 'REVERTED' | 'NOT_FOUND'; txHash?: string | null; message?: string }> {
  const raw = await store.get(userOpKey(userOpHash));
  if (!raw) return { ok: false, status: 'NOT_FOUND', message: 'Unknown UserOperation hash' };

  const record = JSON.parse(raw) as UserOpRecord;
  if (record.status !== 'PENDING') {
    return { ok: true, status: record.status, txHash: record.txHash };
  }

  const poll = await getUserOpReceipt(record.paymasterUrl, userOpHash as Hex);
  if (poll.status === 'PENDING') return { ok: true, status: 'PENDING' };

  if (poll.status === 'REVERTED') {
    await refundWithdrawal({ store, reservationId: record.reservationId, reason: 'UserOperation reverted on-chain' });
    record.status = 'REVERTED';
    await store.put(userOpKey(userOpHash), JSON.stringify(record), 60 * 60 * 24 * 7);
    return { ok: true, status: 'REVERTED', message: 'The sponsored UserOperation reverted — the balance was refunded' };
  }

  const receipt = (poll.receipt || {}) as { transactionHash?: string };
  await settleWithdrawal({
    store,
    reservationId: record.reservationId,
    txHash: receipt.transactionHash || null,
    userOpHash,
    method: 'paymaster-4337',
    payer: 'project-paymaster'
  });

  record.status = 'SUCCESS';
  record.txHash = receipt.transactionHash || null;
  await store.put(userOpKey(userOpHash), JSON.stringify(record), 60 * 60 * 24 * 7);
  return { ok: true, status: 'SUCCESS', txHash: record.txHash };
}


