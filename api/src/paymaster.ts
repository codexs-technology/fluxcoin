/**
 * ERC-4337 gasless settlement.
 *
 * A *simple smart account* owned by the project signer sends the ERC-20
 * transfer while the configured bundler/paymaster sponsors the gas, so the user
 * never signs a transaction and never pays anything. This module is only
 * reached when `PAYMASTER_URL` is set (`GASLESS_MODE=paymaster`); the
 * `server-sponsored` and `dry-run` routes live in withdraw.ts / chain.ts.
 */
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex
} from 'viem';
import { bsc, bscTestnet, mainnet, polygon, sepolia } from 'viem/chains';
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { privateKeyToAccount } from 'viem/accounts';
import { normalizePrivateKey } from './keys.js';

const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

/** EntryPoint v0.7 — the version every current bundler supports. */
const ENTRY_POINT = {
  address: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address,
  version: '0.7' as const
};

const CHAINS: Record<number, Chain> = { 1: mainnet, 56: bsc, 97: bscTestnet, 137: polygon, 11155111: sepolia };

export interface SponsorWithdrawalParams {
  paymasterUrl: string;
  recipientAddress: Address;
  /** Amount in 18-decimal wei (never a float). */
  amountWei: bigint;
  tokenAddress: Address;
  rpcUrl: string;
  chainId: number;
  /** Owner key of the project smart account that performs the transfer. */
  sponsorPrivateKey?: Hex;
}

export interface SponsorWithdrawalResult {
  ok: boolean;
  userOpHash?: string;
  sender?: string;
  status: string;
  error?: string;
}

function chainFor(chainId: number, rpcUrl: string): Chain {
  return (
    CHAINS[chainId] || {
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    }
  );
}

/**
 * Submits the sponsored transfer. Throws with an actionable message when the
 * Worker is missing the pieces the bundler needs, so the withdrawal is refunded
 * instead of silently failing on-chain.
 */
export async function executeGaslessWithdrawal(
  params: SponsorWithdrawalParams
): Promise<SponsorWithdrawalResult> {
  const { paymasterUrl, recipientAddress, amountWei, tokenAddress, rpcUrl, chainId, sponsorPrivateKey } = params;

  if (!paymasterUrl) throw new Error('PAYMASTER_URL is not set on this Worker');
  if (!rpcUrl) throw new Error('RPC_URL is not set on this Worker');
  if (!sponsorPrivateKey) {
    throw new Error('MINTER_PRIVATE_KEY is required to own the smart account that sponsors withdrawals');
  }

  const chain = chainFor(chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const signer = privateKeyToAccount(normalizePrivateKey(sponsorPrivateKey));

  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: signer,
    entryPoint: ENTRY_POINT
  });

  const paymaster = createPimlicoClient({ transport: http(paymasterUrl), entryPoint: ENTRY_POINT });
  const client = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(paymasterUrl),
    paymaster,
    userOperation: { estimateFeesPerGas: async () => (await paymaster.getUserOperationGasPrice()).fast }
  });

  const userOpHash = await client.sendUserOperation({
    calls: [
      {
        to: tokenAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipientAddress, amountWei]
        })
      }
    ]
  });

  return { ok: true, userOpHash, sender: account.address, status: 'PENDING' };
}

/** Asks the bundler whether a submitted UserOperation is mined, reverted or pending. */
export async function getUserOpReceipt(
  paymasterUrl: string,
  userOpHash: Hex
): Promise<{ status: 'PENDING' | 'SUCCESS' | 'REVERTED'; receipt?: unknown }> {
  if (!paymasterUrl) return { status: 'PENDING' };

  try {
    const client = createPimlicoClient({ transport: http(paymasterUrl), entryPoint: ENTRY_POINT });
    const receipt = await client.getUserOperationReceipt({ hash: userOpHash });
    if (!receipt) return { status: 'PENDING' };
    return { status: receipt.success ? 'SUCCESS' : 'REVERTED', receipt };
  } catch (error) {
    // A bundler without the UserOp yet (or a transient RPC hiccup) is not a failure.
    console.warn('[paymaster] receipt lookup failed:', (error as Error).message);
    return { status: 'PENDING' };
  }
}

