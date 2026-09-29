/**
 * Chain access layer for the Worker.
 *
 * Reads (balanceOf, block number, token metadata) go through a public viem
 * client. The `server-sponsored` withdrawal route additionally uses a
 * wallet client built from `MINTER_PRIVATE_KEY` — the project pays that gas,
 * the user never signs a transaction.
 *
 * Everything is lazy: when `RPC_URL` / `TOKEN_ADDRESS` are missing the helpers
 * resolve to `null` instead of throwing, so `/api/health` still answers.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient
} from 'viem';
import { bsc, bscTestnet, mainnet, polygon, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { FluxConfig } from './config.js';

const KNOWN_CHAINS: Record<number, Chain> = {
  1: mainnet,
  56: bsc,
  97: bscTestnet,
  137: polygon,
  11155111: sepolia
};

const FLUXCOIN_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to, uint256 amount)'
]);

/** ERC-20 transfer, used when the sponsor key cannot mint (no MINTER_ROLE). */
const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

export function resolveChain(config: FluxConfig): Chain {
  const known = KNOWN_CHAINS[config.chain.chainId];
  if (known && (!config.chain.rpcUrl || known.rpcUrls.default.http.includes(config.chain.rpcUrl))) {
    return known;
  }
  return {
    id: config.chain.chainId,
    name: `chain-${config.chain.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.chain.rpcUrl || 'http://127.0.0.1:8545'] } },
    blockExplorers: config.chain.explorerUrl
      ? { default: { name: 'Explorer', url: config.chain.explorerUrl } }
      : undefined
  } as Chain;
}

const clientCache = new Map<string, PublicClient>();

export function getPublicClient(config: FluxConfig): PublicClient | null {
  if (!config.chain.rpcUrl) return null;
  const cacheKey = `${config.chain.chainId}:${config.chain.rpcUrl}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = createPublicClient({ chain: resolveChain(config), transport: http(config.chain.rpcUrl) });
  clientCache.set(cacheKey, client);
  return client;
}

function normalizeKey(rawKey: string): Hex {
  return (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
}

/**
 * Live ERC-20 balance of `address`; `null` when the chain/token is unreachable.
 * `tokenAddress`/`decimals` default to the legacy FLUX wiring — the per-asset
 * routes pass the selected asset's contract + precision explicitly.
 */
export async function getOnChainTokenBalance(
  config: FluxConfig,
  address: string,
  tokenAddress: string = config.chain.tokenAddress,
  decimals: number = 18
): Promise<string | null> {
  const client = getPublicClient(config);
  if (!client || !tokenAddress) return null;

  const { formatUnits } = await import('viem');
  try {
    const raw = (await client.readContract({
      address: tokenAddress as Address,
      abi: FLUXCOIN_ABI,
      functionName: 'balanceOf',
      args: [address as Address]
    })) as bigint;
    return formatUnits(raw, decimals);
  } catch (error) {
    console.warn(`[chain] balanceOf failed for ${tokenAddress}:`, (error as Error).message);
    return null;
  }
}

/** Block number + token metadata used by `/api/health`. Never throws. */
export async function getChainStatus(config: FluxConfig) {
  const status = {
    chainId: config.chain.chainId,
    rpcConfigured: Boolean(config.chain.rpcUrl),
    tokenAddress: config.chain.tokenAddress || null,
    faucetAddress: config.chain.faucetAddress || null,
    sponsorConfigured: Boolean(config.keys.minterPrivateKey),
    paymasterConfigured: Boolean(config.gasless.paymasterUrl),
    blockNumber: null as number | null,
    connected: false,
    token: null as { symbol: string; decimals: number; totalSupply: string } | null,
    error: null as string | null
  };

  const client = getPublicClient(config);
  if (!client) return status;

  try {
    status.blockNumber = Number(await client.getBlockNumber());
    status.connected = true;

    if (config.chain.tokenAddress) {
      const address = config.chain.tokenAddress as Address;
      const [symbol, decimals, totalSupply] = await Promise.all([
        client.readContract({ address, abi: FLUXCOIN_ABI, functionName: 'symbol' }).catch(() => 'FLUX'),
        client.readContract({ address, abi: FLUXCOIN_ABI, functionName: 'decimals' }).catch(() => 18),
        client.readContract({ address, abi: FLUXCOIN_ABI, functionName: 'totalSupply' }).catch(() => 0n)
      ]);
      const { formatUnits } = await import('viem');
      status.token = {
        symbol: String(symbol),
        decimals: Number(decimals),
        totalSupply: formatUnits(totalSupply as bigint, Number(decimals))
      };
    }
  } catch (error) {
    status.error = (error as Error).message;
  }

  return status;
}

export type ServerSponsoredResult = { txHash: string; payer: string; method: 'mint' | 'transfer' };

/**
 * Settles a withdrawal with the project wallet on ONE asset's contract: it mints
 * to the user when the key holds `MINTER_ROLE`, otherwise it transfers the
 * project's own balance. Either way the gas is paid by the project, so the user
 * pays 0. `tokenAddress` is the per-asset FlashToken contract.
 */
export async function settleServerSponsored({
  config,
  recipient,
  amountWei,
  tokenAddress,
  symbol = 'token'
}: {
  config: FluxConfig;
  recipient: string;
  amountWei: bigint;
  tokenAddress: string;
  symbol?: string;
}): Promise<ServerSponsoredResult> {
  if (!tokenAddress) throw new Error(`${symbol} contract address is not set (TOKEN_ADDRESS_* in wrangler.jsonc)`);
  if (!config.chain.rpcUrl) throw new Error('RPC_URL is not set (wrangler.jsonc -> vars)');
  if (!config.keys.minterPrivateKey) throw new Error('MINTER_PRIVATE_KEY is not set (wrangler secret)');

  const account = privateKeyToAccount(normalizeKey(config.keys.minterPrivateKey));
  const token = tokenAddress as Address;
  const client = createWalletClient({
    account,
    chain: resolveChain(config),
    transport: http(config.chain.rpcUrl)
  });
  const publicClient = getPublicClient(config);

  try {
    const hash = await client.writeContract({
      address: token,
      abi: FLUXCOIN_ABI,
      functionName: 'mint',
      args: [recipient as Address, amountWei]
    });
    const receipt = await publicClient?.waitForTransactionReceipt({ hash });
    console.log(`[chain] ${symbol} minted to ${recipient}: ${receipt?.transactionHash || hash}`);
    return { txHash: receipt?.transactionHash || hash, payer: account.address, method: 'mint' };
  } catch (mintError) {
    const message = (mintError as Error).message || 'mint failed';
    console.warn(`[chain] ${symbol} mint reverted, falling back to transfer:`, message);
  }

  const hash = await client.writeContract({
    address: token,
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [recipient as Address, amountWei]
  });
  const receipt = await publicClient?.waitForTransactionReceipt({ hash });
  return { txHash: receipt?.transactionHash || hash, payer: account.address, method: 'transfer' };
}

