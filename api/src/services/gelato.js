import { ethers } from 'ethers';
import config from '../config.js';
import { getProvider, getFaucetContract, explorerTxUrl } from './chain.js';

/**
 * GELATO RELAY (ERC-2771 meta-transactions) — ZERO gas for the user.
 * ------------------------------------------------------------------
 * Flow implemented here:
 *   1. `prepareRelayedClaim()` builds the Gelato `SponsoredCallERC2771` typed data
 *      for a FluxFaucet.claim(...) call that already carries the backend's
 *      EIP-712 withdrawal authorization.
 *   2. The browser asks the USER to sign that typed data (eth_signTypedData_v4).
 *      Signing costs nothing — no transaction, no gas.
 *   3. `submitRelayedClaim()` posts the signature to Gelato Relay together with
 *      YOUR SPONSOR API KEY (kept server-side). Gelato's executor pays the gas
 *      and calls the faucet through its trusted forwarder, so inside the contract
 *      `_msgSender()` is the user.
 *
 * ★★★ WHERE TO PUT YOUR GELATO KEY ★★★
 *   api/.env -> GELATO_RELAY_API_KEY=...  (https://app.gelatonetwork.com -> Relay / 1Balance)
 *
 * The Relay SDK is imported dynamically so the API (and its tests) run fine when
 * you only use the ERC-4337 / server-sponsored modes. Gelato now also ships the
 * newer `@gelatocloud/gasless` package — the calls below map 1:1 if you migrate.
 */

async function loadRelaySdk() {
  const module = await import('@gelatonetwork/relay-sdk');
  return module.GelatoRelay ?? module.default?.GelatoRelay;
}

/** Gelato's 1Balance ERC-2771 relay contract — the FluxFaucet trusted forwarder. */
export const GELATO_RELAY_1BALANCE_ERC2771 = '0xd8253782c45a12053594b9deB72d8e8aB2Fca54c';

export const GELATO_DOMAIN_NAME = 'GelatoRelay1BalanceERC2771';
export const GELATO_DEFAULT_DEADLINE_GAP = 86400; // 24h

export const SPONSORED_CALL_ERC2771_TYPES = {
  SponsoredCallERC2771: [
    { name: 'chainId', type: 'uint256' },
    { name: 'target', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'user', type: 'address' },
    { name: 'userNonce', type: 'uint256' },
    { name: 'userDeadline', type: 'uint256' }
  ]
};

export function isGelatoConfigured() {
  return Boolean(config.gasless.gelatoApiKey && config.chain.faucetAddress && config.chain.rpcUrl);
}

/** On-chain sequential nonce required by Gelato for non-concurrent relay calls. */
async function getGelatoUserNonce(user) {
  const relay = new ethers.Contract(
    GELATO_RELAY_1BALANCE_ERC2771,
    ['function userNonce(address account) external view returns (uint256)'],
    getProvider()
  );
  const nonce = await relay.userNonce(user);
  return nonce.toString();
}

/**
 * Builds the typed data the USER must sign for a gasless faucet claim.
 * @param {{ address: string, amountWei: string, faucetNonce: number, signature: string, deadline: bigint }} params
 */
export async function prepareRelayedClaim({ address, amountWei, faucetNonce, signature, deadline }) {
  const faucet = getFaucetContract(getProvider());
  const data = faucet.interface.encodeFunctionData('claim', [
    address,
    amountWei,
    faucetNonce,
    deadline,
    signature
  ]);

  const chainId = config.chain.chainId;
  const userNonce = await getGelatoUserNonce(address);
  const userDeadline = Math.floor(Date.now() / 1000) + GELATO_DEFAULT_DEADLINE_GAP;

  const struct = {
    chainId,
    target: config.chain.faucetAddress,
    data,
    user: ethers.getAddress(address),
    userNonce,
    userDeadline
  };

  const typedData = {
    domain: {
      name: GELATO_DOMAIN_NAME,
      version: '1',
      chainId: String(chainId),
      verifyingContract: GELATO_RELAY_1BALANCE_ERC2771
    },
    types: SPONSORED_CALL_ERC2771_TYPES,
    primaryType: 'SponsoredCallERC2771',
    message: struct
  };

  return { struct, typedData };
}

/**
 * Verifies that the browser signed the exact struct we prepared, then hands the
 * request to Gelato Relay. The project pays the gas from its 1Balance deposit.
 */
export async function submitRelayedClaim({ struct, userSignature }) {
  if (!config.gasless.gelatoApiKey) {
    throw new Error('GELATO_RELAY_API_KEY is not configured on the server (api/.env)');
  }

  const GelatoRelay = await loadRelaySdk();
  const relay = new GelatoRelay();

  const structForChain = {
    chainId: Number(struct.chainId),
    target: ethers.getAddress(struct.target),
    data: struct.data,
    user: ethers.getAddress(struct.user),
    userNonce: BigInt(struct.userNonce),
    userDeadline: Number(struct.userDeadline)
  };

  const response = await relay.sponsoredCallERC2771WithSignature(
    structForChain,
    userSignature,
    config.gasless.gelatoApiKey
  );

  return { taskId: response?.taskId || null, raw: response };
}

/** Polls Gelato until the relayed transaction is mined (or gives up). */
export async function waitForRelayedTask(taskId, { attempts = 20, intervalMs = 3000 } = {}) {
  const GelatoRelay = await loadRelaySdk();
  const relay = new GelatoRelay();
  for (let i = 0; i < attempts; i += 1) {
    const status = await relay.getTaskStatus(taskId);
    if (status?.transactionHash) {
      return {
        txHash: status.transactionHash,
        explorerUrl: explorerTxUrl(status.transactionHash),
        state: status.taskState
      };
    }
    if (status && ['Cancelled', 'ExecReverted'].includes(String(status.taskState))) {
      throw new Error(`Gelato task ${taskId} failed with state ${status.taskState}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { txHash: null, explorerUrl: null, state: 'PENDING' };
}
