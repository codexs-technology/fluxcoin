import { ethers } from 'ethers';
import config from '../config.js';
import { FAUCET_EIP712 } from '../abis.js';
import {
  getProvider,
  getMinterWallet,
  getSignerWallet,
  getTokenContract,
  explorerTxUrl,
  isContractConfigured
} from './chain.js';
import * as ledger from './ledger.js';
import { prepareRelayedClaim, isGelatoConfigured } from './gelato.js';
import { isPaymasterConfigured, publicPaymasterConfig } from './paymaster.js';

/**
 * Direct mint by the backend hot wallet (GASLESS_MODE=server / dry-run fallback).
 * The project pays the gas; the user pays nothing and signs nothing.
 */
async function mintFromBackend({ address, amountWei }) {
  const mode = resolveMode();

  if (mode === 'dry-run') {
    if (!config.allowDryRun) {
      throw new Error('Withdrawal backend is not configured: set MINTER_PRIVATE_KEY + TOKEN_ADDRESS + RPC_URL');
    }
    // Local/dev simulation: nothing is broadcast, but the ledger still moves so the
    // whole flow can be exercised without funds. Clearly flagged in the response.
    return {
      txHash: `dry-run-${ethers.hexlify(ethers.randomBytes(16)).slice(2)}`,
      simulated: true,
      payer: 'dry-run (ALLOW_DRY_RUN=true)'
    };
  }

  const wallet = getMinterWallet();
  if (!wallet) throw new Error('MINTER_PRIVATE_KEY is not configured (api/.env)');
  if (!wallet.provider) throw new Error('RPC_URL is not configured (api/.env)');

  const token = getTokenContract(wallet);
  const tx = await token.mint(ethers.getAddress(address), amountWei);
  const receipt = await tx.wait();
  return { txHash: receipt.hash || tx.hash, simulated: false, payer: wallet.address, blockNumber: receipt.blockNumber };
}

/**
 * Step 1 of a withdrawal: validate, reserve the balance and pick the gasless route.
 * @returns {Promise<object>} the client-facing withdrawal payload
 */
export async function startWithdrawal({ address, amountWei }) {
  const mode = resolveMode();
  if (mode === 'unavailable') {
    return {
      ok: false,
      error: 'WITHDRAWALS_DISABLED',
      message: 'The withdrawal backend has no funded signer/contract configured'
    };
  }

  const reservation = ledger.reserveWithdrawal({ address, amountWei });
  if (!reservation.ok) {
    return { ok: false, error: reservation.error, available: reservation.available };
  }

  try {
    if (mode === 'gelato' || mode === 'biconomy') {
      const authorization = await buildAuthorization({ address, amountWei });
      const base = {
        ok: true,
        status: 'AWAITING_USER_SIGNATURE',
        reservationId: reservation.reservationId,
        amount: ethers.formatUnits(amountWei, config.decimals),
        amountWei: amountWei.toString(),
        authorization,
        balance: reservation.account,
        chainId: config.chain.chainId,
        gasPaidBy: 'project-paymaster',
        token: { address: config.chain.tokenAddress, symbol: 'FLUX', decimals: config.decimals }
      };

      if (mode === 'gelato') {
        const { struct, typedData } = await prepareRelayedClaim({
          address,
          amountWei: amountWei.toString(),
          faucetNonce: authorization.nonce,
          signature: authorization.signature,
          deadline: authorization.deadline
        });
        return { ...base, mode: 'gelato-erc2771', gelato: { struct, typedData } };
      }

      return { ...base, mode: 'biconomy-4337', paymaster: publicPaymasterConfig() };
    }

    // mode === 'server' -> the backend mints for the user right away.
    const result = await mintFromBackend({ address, amountWei });
    const settled = ledger.settleWithdrawal({
      reservationId: reservation.reservationId,
      txHash: result.txHash,
      method: 'server-sponsored-mint',
      payer: result.payer
    });

    return {
      ok: true,
      status: result.simulated ? 'SIMULATED' : 'CONFIRMED',
      mode: 'server-sponsored',
      reservationId: reservation.reservationId,
      amount: ethers.formatUnits(amountWei, config.decimals),
      amountWei: amountWei.toString(),
      txHash: result.txHash,
      explorerUrl: result.simulated ? null : explorerTxUrl(result.txHash),
      simulated: result.simulated,
      gasPaidBy: `project-backend (${result.payer})`,
      userGasCost: '0',
      token: { address: config.chain.tokenAddress, symbol: 'FLUX', decimals: config.decimals },
      balance: settled?.account ?? reservation.account
    };
  } catch (error) {
    ledger.refundWithdrawal({ reservationId: reservation.reservationId, reason: error.message });
    return { ok: false, error: 'EXECUTION_FAILED', message: error.message };
  }
}

/** Step 2 (Gelato): the user signed the meta-transaction in the browser, relay it. */
export async function completeGelatoWithdrawal({ reservationId, struct, userSignature }) {
  const entry = ledger.listEntries(null, 500).find((item) => item.id === reservationId);
  if (!entry) return { ok: false, error: 'RESERVATION_NOT_FOUND' };
  if (entry.status !== 'PENDING') return { ok: false, error: 'RESERVATION_ALREADY_SETTLED' };

  const { submitRelayedClaim, waitForRelayedTask } = await import('./gelato.js');
  const { taskId } = await submitRelayedClaim({ struct, userSignature });
  if (!taskId) {
    ledger.refundWithdrawal({ reservationId, reason: 'gelato-relay-rejected' });
    return { ok: false, error: 'RELAY_REJECTED' };
  }

  const status = await waitForRelayedTask(taskId);
  if (!status.txHash) {
    // Still pending in the mempool — keep the reservation, the user can retry the status check.
    return { ok: true, status: 'RELAY_PENDING', taskId, reservationId };
  }

  const settled = ledger.settleWithdrawal({
    reservationId,
    txHash: status.txHash,
    method: `gelato-relay-erc2771 (task ${taskId})`,
    payer: 'Gelato 1Balance (project)'
  });

  return {
    ok: true,
    status: 'CONFIRMED',
    taskId,
    txHash: status.txHash,
    explorerUrl: status.explorerUrl,
    gasPaidBy: 'project-paymaster',
    userGasCost: '0',
    balance: settled?.account ?? null
  };
}

export function getHistory(address, limit = 50) {
  return ledger.listEntries(address, limit).map((entry) => ({
    ...entry,
    amountTokens: ethers.formatUnits(BigInt(entry.amount), config.decimals),
    explorerUrl: entry.txHash && !String(entry.txHash).startsWith('dry-run') ? explorerTxUrl(entry.txHash) : null
  }));
}

/**
 * Server-side withdrawal rules (a client can never bypass them):
 *   - the destination address must be a valid EVM address and must match the
 *     address that signed the session message;
 *   - amount > 0, >= WITHDRAW_MIN_TOKENS, <= WITHDRAW_MAX_TOKENS;
 *   - amount <= the user's site balance (see ledger) and the daily cap;
 *   - the balance is *reserved* before minting and refunded if the mint fails.
 */
export function parseAmountToWei(input) {
  if (input === undefined || input === null) return { ok: false, error: 'AMOUNT_REQUIRED' };
  const raw = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: 'AMOUNT_NOT_NUMERIC' };

  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > config.decimals) return { ok: false, error: 'TOO_MANY_DECIMALS' };

  const wei = ethers.parseUnits(raw, config.decimals);
  if (wei <= 0n) return { ok: false, error: 'AMOUNT_NOT_POSITIVE' };
  return { ok: true, wei, display: ethers.formatUnits(wei, config.decimals) };
}

function withdrawalsTodayWei(address) {
  const since = new Date().toISOString().slice(0, 10);
  return ledger
    .listEntries(address, 500)
    .filter((entry) => entry.type === 'withdraw' && entry.createdAt.slice(0, 10) === since)
    .filter((entry) => entry.status !== 'FAILED')
    .reduce((total, entry) => total + BigInt(entry.amount), 0n);
}

/** Pure validation — returns `{ ok, error, message, available }`. */
export function validateWithdrawal({ address, amountWei }) {
  if (!ethers.isAddress(address)) {
    return { ok: false, error: 'INVALID_ADDRESS', message: 'Connected wallet address is not a valid EVM address' };
  }

  const limits = config.limits;
  if (amountWei < limits.withdrawMinWei) {
    return {
      ok: false,
      error: 'BELOW_MINIMUM',
      message: `Minimum withdrawal is ${ethers.formatUnits(limits.withdrawMinWei, config.decimals)} FLUX`
    };
  }
  if (amountWei > limits.withdrawMaxWei) {
    return {
      ok: false,
      error: 'ABOVE_MAXIMUM',
      message: `Maximum withdrawal is ${ethers.formatUnits(limits.withdrawMaxWei, config.decimals)} FLUX per request`
    };
  }

  const account = ledger.getAccount(address);
  const available = BigInt(account.available);
  if (amountWei > available) {
    return {
      ok: false,
      error: 'INSUFFICIENT_SITE_BALANCE',
      message: 'You cannot withdraw more than your earned site balance',
      available: ethers.formatUnits(available, config.decimals)
    };
  }

  const today = withdrawalsTodayWei(address);
  if (today + amountWei > limits.withdrawDailyCapWei) {
    return {
      ok: false,
      error: 'DAILY_CAP_EXCEEDED',
      message: `Daily withdrawal cap is ${ethers.formatUnits(limits.withdrawDailyCapWei, config.decimals)} FLUX`,
      usedToday: ethers.formatUnits(today, config.decimals)
    };
  }

  return { ok: true, available: ethers.formatUnits(available, config.decimals) };
}

/** Which gasless strategy will be used for this request. */
export function resolveMode() {
  const mode = config.gasless.mode;
  if (mode === 'gelato' && isGelatoConfigured()) return 'gelato';
  if (mode === 'biconomy' && isPaymasterConfigured()) return 'biconomy';
  if (config.keys.minterPrivateKey && isContractConfigured()) return 'server';
  return config.allowDryRun ? 'dry-run' : 'unavailable';
}

/**
 * Backend EIP-712 authorization consumed by FluxFaucet.claim.
 * Only the server can produce this: it is what enforces "never more than the site balance".
 */
export async function buildAuthorization({ address, amountWei }) {
  const signer = getSignerWallet();
  if (!signer) throw new Error('BACKEND_SIGNER_PRIVATE_KEY is not configured (api/.env)');

  const nonce = ledger.nextNonce(address);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
  const domain = {
    name: FAUCET_EIP712.domainName,
    version: FAUCET_EIP712.domainVersion,
    chainId: config.chain.chainId,
    verifyingContract: config.chain.faucetAddress
  };
  const values = {
    beneficiary: ethers.getAddress(address),
    amount: amountWei,
    nonce,
    deadline
  };

  const signature = await signer.signTypedData(domain, FAUCET_EIP712.withdrawalTypes, values);
  return { nonce, deadline, signature, domain, types: FAUCET_EIP712.withdrawalTypes, values };
}
