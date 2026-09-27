/**
 * Worker configuration.
 *
 * Everything comes from Wrangler vars / secrets (`wrangler.jsonc` -> `vars`,
 * `npx wrangler secret put <NAME>`), never from the browser. The names keep the
 * ones documented in `api/.env.example` so a single list covers both.
 */
import { formatUnits, parseUnits } from 'viem';

export type FluxConfig = {
  storage: 'kv' | 'memory';
  site: { domain: string; url: string };
  corsOrigins: string[];
  chain: {
    chainId: number;
    rpcUrl: string;
    tokenAddress: string;
    faucetAddress: string;
    explorerUrl: string;
  };
  keys: { minterPrivateKey: string };
  gasless: {
    /** requested mode: 'auto' | 'paymaster' | 'server' | 'dry-run' */
    requested: string;
    paymasterUrl: string;
    rpcUrl: string;
  };
  limits: {
    earnMinWei: bigint;
    earnMaxWei: bigint;
    earnCooldownMs: number;
    earnDailyCapWei: bigint;
    withdrawMinWei: bigint;
    withdrawMaxWei: bigint;
    withdrawDailyCapWei: bigint;
  };
  session: { secret: string; ttlMs: number; nonceTtlMs: number };
  allowDryRun: boolean;
  decimals: number;
};

export const DECIMALS = 18;

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

/** Whole-token amount -> 18-decimal wei bigint. Amounts are never floats. */
export function tokensToWei(wholeTokens: number | string): bigint {
  return parseUnits(String(wholeTokens), DECIMALS);
}

/** 18-decimal wei -> human readable token string. */
export function weiToTokens(wei: bigint | string): string {
  return formatUnits(typeof wei === 'bigint' ? wei : BigInt(wei), DECIMALS);
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
  const chainId = num(env, 'CHAIN_ID', 11155111);
  const origins = str(env, 'CORS_ORIGINS', DEFAULT_CORS_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const rpcUrl = str(env, 'RPC_URL', chainId === 11155111 ? 'https://rpc.chainlist.io/sepolia' : '');

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
    keys: {
      minterPrivateKey: str(env, 'MINTER_PRIVATE_KEY', str(env, 'SPONSOR_PRIVATE_KEY', ''))
    },
    gasless: {
      requested: (str(env, 'GASLESS_MODE', 'auto') || 'auto').toLowerCase(),
      paymasterUrl: str(env, 'PAYMASTER_URL', ''),
      rpcUrl
    },
    limits: {
      earnMinWei: tokensToWei(num(env, 'EARN_MIN_TOKENS', 1)),
      earnMaxWei: tokensToWei(num(env, 'EARN_MAX_TOKENS', 100000)),
      earnCooldownMs: num(env, 'EARN_COOLDOWN_SECONDS', 20) * 1000,
      earnDailyCapWei: tokensToWei(num(env, 'EARN_DAILY_CAP_TOKENS', 500000)),
      withdrawMinWei: tokensToWei(num(env, 'WITHDRAW_MIN_TOKENS', 1)),
      withdrawMaxWei: tokensToWei(num(env, 'WITHDRAW_MAX_TOKENS', 100000)),
      withdrawDailyCapWei: tokensToWei(num(env, 'WITHDRAW_DAILY_CAP_TOKENS', 1000000))
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
  if (!config.chain.tokenAddress) {
    warnings.push('TOKEN_ADDRESS is not set — on-chain reads stay null and withdrawals run in dry-run');
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
  const hasServer = Boolean(config.keys.minterPrivateKey && config.chain.tokenAddress && config.chain.rpcUrl);

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

