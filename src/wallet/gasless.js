/**
 * Gasless (zero-fee) withdrawal driver for the browser.
 *
 * The backend decides which settlement route is active
 * (`GET /api/withdraw/config`) and performs it server-side — the browser never
 * signs a transaction and never pays gas:
 *
 *  1. paymaster-4337   -> the Worker submits a sponsored ERC-4337 UserOperation
 *                         and the browser only polls /api/withdraw/status/:hash.
 *  2. server-sponsored -> the project wallet mints/transfers and pays the gas
 *                         (the response is already CONFIRMED + explorer link).
 *  3. dry-run          -> validated and booked as SIMULATED (ALLOW_DRY_RUN).
 *
 * ★★ Paymaster / sponsor keys never live in this folder ★★ — they are Worker
 *    secrets (see wrangler.jsonc + `npx wrangler secret put`).
 */
import { walletManager } from './manager.js';
import { requestWithdrawal, pollWithdrawStatus } from '../api/client.js';
import { ACTIVE_CHAIN } from './chains.js';

const USEROP_POLL_ATTEMPTS = 15;
const USEROP_POLL_INTERVAL_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a withdrawal end-to-end through whichever gasless route the Worker
 * resolved, for the SELECTED asset's Flash contract.
 *
 * @param {string} amount human readable amount, e.g. "1000"
 * @param {{asset?: string, onPhase?: (phase: string, detail?: object) => void}} options
 *   asset — one of usdt/btc/eth/trx/sol (which contract mints the tokens)
 */
export async function performGaslessWithdrawal(amount, { asset = 'usdt', onPhase } = {}) {
  const state = walletManager.getState();
  if (!state.address || state.evm === false) {
    throw new Error('Connect an EVM wallet first — Flash withdrawals are minted to an EVM address');
  }

  onPhase?.('validating');
  const started = await requestWithdrawal(amount, asset);

  // --- 1. sponsored UserOperation: poll until it is mined --------------------
  if (started.userOpHash) {
    onPhase?.('relaying', { userOpHash: started.userOpHash });

    for (let attempt = 0; attempt < USEROP_POLL_ATTEMPTS; attempt += 1) {
      await sleep(USEROP_POLL_INTERVAL_MS);
      const poll = await pollWithdrawStatus(started.userOpHash).catch(() => null);
      if (!poll) continue;
      if (poll.status === 'SUCCESS') {
        onPhase?.('confirmed', { ...started, txHash: poll.txHash || started.userOpHash });
        return {
          ...started,
          status: 'CONFIRMED',
          txHash: poll.txHash || started.userOpHash,
          explorerUrl: poll.explorerUrl || null,
          userGasCost: '0',
          steps: [
            'backend validated your site balance',
            'paymaster sponsored the UserOperation (you paid 0 gas)',
            'Flash tokens transferred to your wallet'
          ]
        };
      }
      if (poll.status === 'REVERTED') {
        throw new Error(poll.message || 'The sponsored UserOperation reverted on-chain — nothing was withdrawn');
      }
    }

    // Still pending: the withdrawal stays reserved, the user can retry the poll
    // from the terminal later. Report it as pending rather than faking success.
    onPhase?.('relaying', { userOpHash: started.userOpHash, pending: true });
    return {
      ...started,
      status: 'PENDING',
      txHash: started.userOpHash,
      userGasCost: '0',
      steps: [
        'backend validated your site balance',
        'sponsored UserOperation submitted',
        'still mining — refresh the terminal in a moment'
      ]
    };
  }

  // --- 2. server-sponsored or dry-run: already settled by the Worker ---------
  if (started.status === 'CONFIRMED' || started.status === 'SIMULATED') {
    onPhase?.('confirmed', started);
    return {
      ...started,
      userGasCost: '0',
      steps: started.steps || [
        'backend validated your site balance',
        started.simulated ? 'withdrawal booked as SIMULATED (no transaction was broadcast)' : 'FLUX sent to your wallet',
        'the project paid the gas — your cost is 0'
      ]
    };
  }

  throw new Error(
    `The API returned an unexpected withdrawal status (${started.status || 'unknown'}) for mode ${started.mode || 'n/a'}`
  );
}

export const gaslessChainId = ACTIVE_CHAIN.chainId;
