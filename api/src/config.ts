/**
 * Worker configuration.
 *
 * Everything comes from Wrangler vars / secrets (`wrangler.jsonc` -> `vars`,
 * `npx wrangler secret put <NAME>`), never from the browser.
 *
 * PRODUCTION CHAIN IS POLYGON (137) — Sepolia (11155111) is only for testing.
 * Every asset has its OWN contract (Flash USDT/BTC/ETH/TRX/SOL, see
 * api/src/assets.ts). Limits are configured in WHOLE tokens (EARN_MIN_TOKENS=1
 * means 1 USDT *or* 1 BTC) and converted per asset by `assetLimits()` using
 * that asset's decimals, so a 6-decimal USDT and an 18-decimal ETH compare
 * correctly.
 */
import { formatUnits, parseUnits } from 'viem';
import { anyAssetConfigured, buildAssets, type AssetConfig, type AssetId } from './assets.js';

export type FluxConfig = {
  storage: 'kv' | 'memory';
  site: { domain: string; url: string };
  corsOrigins: string[];
  chain: {
    chainId: number;
    rpcUrl: string;
    /** Legacy single FLUX token (optional — the per-asset `assets` are the real wiring). */
    tokenAddress: string;
    faucetAddress: string;
    explorerUrl: string;
  };
  /** Per-asset Flash tokens (Flash USDT/BTC/ETH/TRX/SOL) with their own addresses. */
  assets: Record<AssetId, AssetConfig>;
  keys: { minterPrivateKey: string };
  gasless: {
    /** requested mode: 'auto' | 'paymaster' | 'server' | 'dry-run' */
    requested: string;
    paymasterUrl: string;
    rpcUrl: string;
  };
  limits: {
    /** Whole-token limits — per-asset wei values are derived by `assetLimits()`. */
    earnMinTokens: string;
    earnMaxTokens: string;
    earnCooldownMs: number;
    earnDailyCapTokens: string;
    withdrawMinTokens: string;
    withdrawMaxTokens: string;
    withdrawDailyCapTokens: string;
  };
  session: { secret: string; ttlMs: number; nonceTtlMs: number };
  allowDryRun: boolean;
  /** Legacy default (FLUX = 18). Per-asset decimals live in `config.assets`. */
  decimals: number;
};

export const DECIMALS = 18;
/** Production chain: Polygon PoS (137). Sepolia (11155111) is for testing only. */
export const DEFAULT_CHAIN_ID = 137;

const DEFAULT_RPC: Record<number, string> = {
  137: 'https://polygon-rpc.com',
  11155111: 'https://rpc.chainlist.io/sepolia'
};

const TRUTHY = ['1', 'true', 'yes', 'on'];

function str(env: Record<string, unknown>, name: string, fallback = ''): string {
  const value = env[name];
  return value === undefined || value === null || String(value) === '' ? fallback : String(value);
}

function num(env: Record<string, unknown>, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === null || String(value) === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`[config] ${name} must be a number, got "${String(value)}"`);
  return parsed;
}

function bool(env: Record<string, unknown>, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value === null || String(value) === '') return fallback;
  return TRUTHY.includes(String(value).toLowerCase());
}

/** Whole-token amount -> base units. Amounts are never floats. */
export function tokensToWei(wholeTokens: number | string, decimals: number = DECIMALS): bigint {
  return parseUnits(String(wholeTokens), decimals);
}

/** Base units -> human readable token string (uses the asset's own decimals). */
export function weiToTokens(wei: bigint | string, decimals: number = DECIMALS): string {
  return formatUnits(typeof wei === 'bigint' ? wei : BigInt(wei), decimals);
}

/**
 * The configured whole-token limits converted to base units for ONE asset.
 * This is the heart of the per-asset contract architecture: "1" minimum means
 * 1_000_000 base units for Flash USDT (6d) but 1e18 for Flash ETH (18d).
 */
export function assetLimits(config: FluxConfig, decimals: number) {
  const toWei = (tokens: string) => parseUnits(tokens, decimals);
  const L = config.limits;
  return {
    earnMinWei: toWei(L.earnMinTokens),
    earnMaxWei: toWei(L.earnMaxTokens),
    earnCooldownMs: L.earnCooldownMs,
    earnDailyCapWei: toWei(L.earnDailyCapTokens),
    withdrawMinWei: toWei(L.withdrawMinTokens),
    withdrawMaxWei: toWei(L.withdrawMaxTokens),
    withdrawDailyCapWei: toWei(L.withdrawDailyCapTokens)
  };
}

const DEFAULT_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  56: 'https://bscscan.com',
  97: 'https://testnet.bscscan.com',
  137: 'https://polygonscan.com'
};

export const EXPLORERS = DEFAULT_EXPLORERS;

/** Frontend origins allowed to call this Worker. */
export const DEFAULT_CORS_ORIGINS = [
  'https://fluxcoin.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

export function buildConfig(env: Record<string, unknown>): FluxConfig {
  const chainId = num(env, 'CHAIN_ID', DEFAULT_CHAIN_ID);
  const origins = str(env, 'CORS_ORIGINS', DEFAULT_CORS_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const rpcUrl = str(env, 'RPC_URL', DEFAULT_RPC[chainId] || 'https://polygon-rpc.com');

  return {
    storage: env.FLUXCOIN_KV ? 'kv' : 'memory',
    site: {
      domain: str(env, 'SITE_DOMAIN', 'fluxcoin.pages.dev'),
      url: str(env, 'SITE_URL', 'https://fluxcoin.pages.dev')
    },
    corsOrigins: origins,
    chain: {
      chainId,
      rpcUrl,
      tokenAddress: str(env, 'TOKEN_ADDRESS', ''),
      faucetAddress: str(env, 'FAUCET_ADDRESS', ''),
      explorerUrl: str(env, 'EXPLORER_URL', DEFAULT_EXPLORERS[chainId] || '')
    },
    assets: buildAssets(env),
    keys: {
      minterPrivateKey: str(env, 'MINTER_PRIVATE_KEY', str(env, 'SPONSOR_PRIVATE_KEY', ''))
    },
    gasless: {
      requested: (str(env, 'GASLESS_MODE', 'auto') || 'auto').toLowerCase(),
      paymasterUrl: str(env, 'PAYMASTER_URL', ''),
      rpcUrl
    },
    limits: {
      earnMinTokens: str(env, 'EARN_MIN_TOKENS', '1'),
      earnMaxTokens: str(env, 'EARN_MAX_TOKENS', '100000'),
      earnCooldownMs: num(env, 'EARN_COOLDOWN_SECONDS', 20) * 1000,
      earnDailyCapTokens: str(env, 'EARN_DAILY_CAP_TOKENS', '500000'),
      withdrawMinTokens: str(env, 'WITHDRAW_MIN_TOKENS', '1'),
      withdrawMaxTokens: str(env, 'WITHDRAW_MAX_TOKENS', '100000'),
      withdrawDailyCapTokens: str(env, 'WITHDRAW_DAILY_CAP_TOKENS', '1000000')
    },
    session: {
      secret: str(env, 'SESSION_SECRET', 'fluxcoin-dev-session-secret-change-me'),
      ttlMs: num(env, 'SESSION_TTL_MINUTES', 60 * 24) * 60 * 1000,
      nonceTtlMs: num(env, 'AUTH_NONCE_TTL_SECONDS', 300) * 1000
    },
    allowDryRun: bool(env, 'ALLOW_DRY_RUN', true),
    decimals: DECIMALS
  };
}

/** Problems worth surfacing through /api/health so the UI can stay honest. */
export function configWarnings(config: FluxConfig): string[] {
  const warnings: string[] = [];
  if (config.storage === 'memory') {
    warnings.push('FLUXCOIN_KV is not bound: balances live in isolate memory and reset on cold start');
  }
  if (config.session.secret === 'fluxcoin-dev-session-secret-change-me') {
    warnings.push('SESSION_SECRET is the public default — set a long random secret before production');
  }

  // Per-asset wiring: an asset without a contract address can still earn/withdraw,
  // but its settlements stay dry-run (nothing is minted) until it is configured.
  const unconfigured = Object.values(config.assets).filter((asset) => !asset.configured);
  if (unconfigured.length) {
    const names = unconfigured.map((asset) => asset.envName).join(', ');
    warnings.push(`${names} not set — those assets stay in dry-run mode (validated + booked, no real mint)`);
  }
  if (!config.chain.tokenAddress && !anyAssetConfigured(config.assets)) {
    warnings.push('No token address is set at all — deploy the 5 Flash contracts and set TOKEN_ADDRESS_USDT..SOL');
  }
  if (resolveGaslessMode(config) === 'dry-run') {
    warnings.push('ALLOW_DRY_RUN=true — withdrawals are validated and booked, no transaction is broadcast');
  }
  return warnings;
}

/**
 * Which settlement route a withdrawal takes:
 *   paymaster-4337   -> sponsored UserOperation through the configured bundler
 *   server-sponsored -> project wallet mints/transfers and pays the gas
 *   dry-run          -> validated + booked, nothing broadcast (flagged in the UI)
 *   unavailable      -> nothing configured, withdrawals are refused
 */
export function resolveGaslessMode(config: FluxConfig): string {
  const requested = config.gasless.requested;
  const hasPaymaster = Boolean(config.gasless.paymasterUrl);
  const hasServer = Boolean(
    config.keys.minterPrivateKey &&
      config.chain.rpcUrl &&
      (config.chain.tokenAddress || anyAssetConfigured(config.assets))
  );

  if (requested === 'dry-run') return config.allowDryRun ? 'dry-run' : 'unavailable';
  if (requested === 'paymaster') return hasPaymaster ? 'paymaster-4337' : 'unavailable';
  if (requested === 'server') return hasServer ? 'server-sponsored' : 'unavailable';

  if (hasPaymaster) return 'paymaster-4337';
  if (hasServer) return 'server-sponsored';
  return config.allowDryRun ? 'dry-run' : 'unavailable';
}

export function explorerTxUrl(config: FluxConfig, hash: string | null): string | null {
  const base = config.chain.explorerUrl || DEFAULT_EXPLORERS[config.chain.chainId];
  return base && hash && hash.startsWith('0x') ? `${base}/tx/${hash}` : null;
}

