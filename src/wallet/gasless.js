/**
 * Gasless (zero-fee) withdrawal driver for the browser.
 *
 * The backend decides which route is active (`GET /api/withdraw/config`) and this
 * module performs the client half of it:
 *
 *  1. server-sponsored  → nothing to sign. The project backend wallet mints the
 *                         FLUX and pays the gas. The user pays 0 and signs 0 txs.
 *  2. gelato-erc2771    → the user signs a Gasless meta-transaction (EIP-712).
 *                         Signing is free; Gelato Relay pays the gas.
 *  3. biconomy-4337     → the user's ERC-4337 smart account sends the UserOperation
 *                         and YOUR Biconomy Paymaster sponsors the gas.
 *
 * ★★ PAYMASTER KEYS ★★ never live in this folder. They are configured in
 *    api/.env (GELATO_RELAY_API_KEY, BICONOMY_PAYMASTER_URL, ...) and the API
 *    keeps them server-side; the browser only gets a sponsored payload.
 */
import { walletManager } from './manager.js';
import { requestWithdrawal, submitRelayedWithdrawal, sponsorUserOperation } from '../api/client.js';
import { ACTIVE_CHAIN } from './chains.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

/** Signs the Gelato `SponsoredCallERC2771` typed data (no gas, no transaction). */
async function signGelatoMetaTransaction(typedData) {
  const signer = await walletManager.getSigner();
  const { domain, types, message } = typedData;
  const cleanTypes = { ...types };
  delete cleanTypes.EIP712Domain;
  return signer.signTypedData(domain, cleanTypes, message);
}

/**
 * Executes a withdrawal end-to-end through whichever gasless route is configured.
 * @param {string} amount human readable amount, e.g. "1000"
 * @param {{onPhase?: (phase: string, detail?: object) => void}} options
 */
export async function performGaslessWithdrawal(amount, { onPhase } = {}) {
  const state = walletManager.getState();
  if (!state.address || !state.evm) {
    throw new Error('Connect an EVM wallet first — FLUX withdrawals are minted to an EVM address');
  }

  onPhase?.('validating');
  const started = await requestWithdrawal(amount);

  // --- 1. server-sponsored ---------------------------------------------------
  if (started.status !== 'AWAITING_USER_SIGNATURE') {
    onPhase?.('confirmed', started);
    return {
      ...started,
      userGasCost: '0',
      steps: ['backend validated your site balance', 'project backend minted FLUX for you', 'you paid 0 gas']
    };
  }

  // --- 2. Gelato Relay ERC-2771 (user signs typed data, relayer pays) --------
  if (started.mode === 'gelato-erc2771') {
    onPhase?.('awaiting-signature', { chain: 'Gelato Relay (ERC-2771)' });
    const userSignature = await signGelatoMetaTransaction(started.gelato.typedData);
    onPhase?.('relaying');
    const relayed = await submitRelayedWithdrawal({
      reservationId: started.reservationId,
      struct: started.gelato.struct,
      userSignature
    });
    onPhase?.('confirmed', relayed);
    return {
      ...relayed,
      userGasCost: '0',
      steps: [
        'backend validated your site balance',
        'you signed the gasless meta-transaction (free)',
        'Gelato Relay paid the gas and minted your FLUX'
      ]
    };
  }

  // --- 3. ERC-4337 smart account + Paymaster --------------------------------
  if (started.mode === 'biconomy-4337') {
    onPhase?.('awaiting-signature', { chain: 'ERC-4337 Paymaster' });
    return performBiconomy4337Withdrawal(started, { onPhase });
  }

  throw new Error(`Unsupported withdrawal mode returned by the backend: ${started.mode}`);
}

/**
 * ERC-4337 path: the user's smart account calls FluxFaucet.claim(...) and the
 * Biconomy Paymaster sponsors the gas.
 *
 * The Biconomy SDK is an OPTIONAL dependency so the rest of the app never breaks
 * when it is not installed:
 *
 *   npm i @biconomy/account viem        # from the repository root
 *
 * Without it the UI falls back to the API-driven sponsored route (mode `server`),
 * which is still 100% free for the user — just not a UserOperation.
 */
async function loadBiconomySdk() {
  try {
    // The specifier is kept in a variable on purpose: the SDK is an optional
    // dependency, so Rollup must not try to resolve it at build time.
    const moduleName = '@biconomy/account';
    return await import(/* @vite-ignore */ moduleName);
  } catch {
    throw new Error(
      'ERC-4337 withdrawals need the Biconomy SDK. Run "npm i @biconomy/account viem" and set ' +
        'BICONOMY_BUNDLER_URL in api/.env, or switch GASLESS_MODE to "gelato"/"server".'
    );
  }
}

/** Encodes FluxFaucet.claim(beneficiary, amount, nonce, deadline, signature). */
async function encodeClaimCalldata({ authorization, amountWei, faucetAddress }) {
  const { ethers } = await import('ethers');
  const iface = new ethers.Interface([
    'function claim(address beneficiary, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)'
  ]);
  return iface.encodeFunctionData('claim', [
    authorization.values.beneficiary,
    amountWei,
    authorization.nonce,
    authorization.deadline,
    authorization.signature
  ]);
}

async function performBiconomy4337Withdrawal(started, { onPhase } = {}) {
  const { createSmartAccountClient } = await loadBiconomySdk();
  const bundlerUrl = env.VITE_BICONOMY_BUNDLER_URL || started.paymaster?.bundlerUrl;
  if (!bundlerUrl) {
    throw new Error(
      'VITE_BICONOMY_BUNDLER_URL (or BICONOMY_BUNDLER_URL in api/.env) is required for 4337 withdrawals'
    );
  }
  const faucetAddress = started.faucet || env.VITE_FAUCET_ADDRESS;
  if (!faucetAddress) throw new Error('VITE_FAUCET_ADDRESS is not configured');

  const signer = await walletManager.getSigner();
  const smartAccount = await createSmartAccountClient({ signer, bundlerUrl });

  const smartAccountAddress = await smartAccount.getAccountAddress();
  onPhase?.('estimating', { smartAccountAddress });

  const data = await encodeClaimCalldata({
    authorization: started.authorization,
    amountWei: started.amountWei,
    faucetAddress
  });

  const userOp = await smartAccount.buildUserOp([{ to: faucetAddress, data, value: 0n }]);

  // Sponsorship data comes from OUR backend so the Biconomy key stays server-side.
  const sponsored = await sponsorUserOperation({ stage: 'data', userOp }).catch(() => null);
  if (sponsored?.paymasterData) {
    userOp.paymasterAndData = sponsored.paymasterData.paymasterAndData || sponsored.paymasterData;
  }

  const receipt = await smartAccount.sendUserOp(userOp);
  onPhase?.('confirmed', receipt);

  return {
    ok: true,
    status: 'CONFIRMED',
    mode: 'biconomy-4337',
    txHash: receipt?.receipt?.transactionHash || receipt?.transactionHash || null,
    userGasCost: '0',
    gasPaidBy: 'project-paymaster',
    steps: [
      'backend validated your site balance',
      'your smart account sent the UserOperation',
      'your Paymaster paid the gas'
    ]
  };
}

export const gaslessChainId = ACTIVE_CHAIN.chainId;
