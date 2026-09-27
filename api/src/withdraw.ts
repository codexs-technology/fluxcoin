/**
 * Withdrawal engine.
 *
 * The user never pays gas and never broadcasts a transaction: the Worker
 * validates the earned balance, reserves the coins, settles them through the
 * configured route and only then books the withdrawal. If anything fails after
 * the reservation, the coins are refunded so the balance can never be lost.
 */
import { parseUnits, type Address, type Hex } from 'viem';
import { explorerTxUrl, resolveGaslessMode, type FluxConfig } from './config.js';
import { settleServerSponsored } from './chain.js';
import { executeGaslessWithdrawal, getUserOpReceipt } from './paymaster.js';
import {
  getAccount,
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

/** Human amount -> wei. Rejects negatives, NaN and more than 18 decimals. */
export function parseAmount(amount: unknown): AmountParse {
  if (amount === undefined || amount === null || amount === '') {
    return { ok: false, error: 'AMOUNT_REQUIRED', message: 'Enter a withdrawal amount' };
  }

  const text = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'Enter a valid positive amount with at most 18 decimals' };
  }
  if ((text.split('.')[1] || '').length > 18) {
    return { ok: false, error: 'TOO_MANY_DECIMALS', message: 'FLUX has 18 decimals' };
  }

  try {
    const wei = parseUnits(text, 18);
    if (wei <= 0n) return { ok: false, error: 'AMOUNT_NOT_POSITIVE', message: 'Enter an amount greater than zero' };
    return { ok: true, wei, display: text };
  } catch {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'Enter a valid positive amount with at most 18 decimals' };
  }
}

function withdrawalsTodayWei(entries: Awaited<ReturnType<typeof listEntries>>): bigint {
  const today = new Date().toISOString().slice(0, 10);
  return entries
    .filter((entry) => entry.type === 'withdraw' && entry.createdAt.slice(0, 10) === today && entry.status !== 'FAILED')
    .reduce((total, entry) => total + BigInt(entry.amount), 0n);
}

/** Pure validation — the browser checks the same rules, the Worker is the authority. */
export async function validateWithdrawal({
  store,
  config,
  address,
  amountWei
}: {
  store: Store;
  config: FluxConfig;
  address: string;
  amountWei: bigint;
}): Promise<
  | { ok: true; available: string }
  | { ok: false; error: string; message: string; available?: string }
> {
  const { limits } = config;
  if (amountWei < limits.withdrawMinWei) {
    return {
      ok: false,
      error: 'BELOW_MINIMUM',
      message: `Minimum withdrawal is ${(limits.withdrawMinWei / 10n ** 18n).toString()} FLUX`
    };
  }
  if (amountWei > limits.withdrawMaxWei) {
    return {
      ok: false,
      error: 'ABOVE_MAXIMUM',
      message: `Maximum withdrawal is ${(limits.withdrawMaxWei / 10n ** 18n).toString()} FLUX per request`
    };
  }

  const account = await getAccount(store, address);
  const available = BigInt(account.available);
  if (amountWei > available) {
    return {
      ok: false,
      error: 'INSUFFICIENT_SITE_BALANCE',
      message: 'You cannot withdraw more than your earned site balance',
      available: (available / 10n ** 18n).toString()
    };
  }

  const usedToday = withdrawalsTodayWei(await listEntries(store, address, 100));
  if (usedToday + amountWei > limits.withdrawDailyCapWei) {
    return {
      ok: false,
      error: 'DAILY_CAP_EXCEEDED',
      message: 'Daily withdrawal cap reached — try again tomorrow',
      available: (usedToday / 10n ** 18n).toString()
    };
  }

  return { ok: true, available: (available / 10n ** 18n).toString() };
}

export type UserOpRecord = {
  reservationId: string;
  address: string;
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
 * Validates, reserves, settles and books a withdrawal.
 * `payload` is what the browser receives and forwards to the terminal UI.
 */
export async function startWithdrawal({
  store,
  config,
  address,
  amountWei
}: {
  store: Store;
  config: FluxConfig;
  address: string;
  amountWei: bigint;
}): Promise<WithdrawalResult> {
  const mode = resolveGaslessMode(config);
  if (mode === 'unavailable') {
    return {
      ok: false,
      error: 'WITHDRAWALS_DISABLED',
      message: 'No gasless route is configured on this Worker (set PAYMASTER_URL or MINTER_PRIVATE_KEY + TOKEN_ADDRESS)',
      status: 503
    };
  }

  const validation = await validateWithdrawal({ store, config, address, amountWei });
  if (!validation.ok) {
    return { ok: false, error: validation.error, message: validation.message, status: 400, available: validation.available };
  }

  const reservation = await reserveWithdrawal({ store, address, amountWei });
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
    amount: (amountWei / 10n ** 18n).toString(),
    amountWei: amountWei.toString(),
    mode,
    userGasCost: '0',
    chainId: config.chain.chainId
  };

  // --- 1. sponsored ERC-4337 UserOperation --------------------------------
  if (mode === 'paymaster-4337') {
    if (!config.chain.tokenAddress) {
      await refundWithdrawal({ store, reservationId: reservation.reservationId, reason: 'TOKEN_ADDRESS missing' });
      return {
        ok: false,
        error: 'TOKEN_ADDRESS_REQUIRED',
        message: 'TOKEN_ADDRESS must be set for sponsored withdrawals',
        status: 503
      };
    }

    try {
      const result = await executeGaslessWithdrawal({
        paymasterUrl: config.gasless.paymasterUrl,
        recipientAddress: address as Address,
        amountWei,
        tokenAddress: config.chain.tokenAddress as Address,
        rpcUrl: config.chain.rpcUrl,
        sponsorPrivateKey: (config.keys.minterPrivateKey || undefined) as Hex | undefined,
        chainId: config.chain.chainId
      });

      const record: UserOpRecord = {
        reservationId: reservation.reservationId,
        address,
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
      const result = await settleServerSponsored({ config, recipient: address, amountWei });
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
          balance: settled ? serializeAccount(settled.account) : null,
          steps: [
            'backend validated your earned balance',
            `project wallet ${result.method === 'mint' ? 'minted' : 'transferred'} the FLUX`,
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
      balance: settled ? serializeAccount(settled.account) : null,
      steps: [
        'backend validated your earned balance',
        'withdrawal booked as SIMULATED (no transaction was broadcast)',
        'set MINTER_PRIVATE_KEY or PAYMASTER_URL to settle real FLUX'
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


