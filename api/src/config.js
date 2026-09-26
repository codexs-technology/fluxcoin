import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`[config] ${name} must be a number, got "${value}"`);
  return parsed;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/** Whole-token amounts are stored as 18-decimal wei strings (never floats). */
function tokensToWei(wholeTokens) {
  const [whole, fraction = ''] = String(wholeTokens).split('.');
  const paddedFraction = (fraction + '0'.repeat(18)).slice(0, 18);
  return BigInt(`${whole || '0'}${paddedFraction}`.replace(/^0+(?=\d)/, ''));
}

const DECIMALS = 18;

export const config = {
  port: num('PORT', 8787),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  chain: {
    chainId: num('CHAIN_ID', 11155111),
    rpcUrl: str('RPC_URL', ''),
    tokenAddress: str('TOKEN_ADDRESS', ''),
    faucetAddress: str('FAUCET_ADDRESS', ''),
    explorerUrl: str('EXPLORER_URL', '')
  },

  keys: {
    // Hot wallet with MINTER_ROLE on FluxCoin (pays gas in GASLESS_MODE=server).
    minterPrivateKey: str('MINTER_PRIVATE_KEY', ''),
    // Holder of SIGNER_ROLE on FluxFaucet (signs EIP-712 withdrawal authorizations).
    signerPrivateKey: str('BACKEND_SIGNER_PRIVATE_KEY', str('MINTER_PRIVATE_KEY', ''))
  },

  gasless: {
    mode: (str('GASLESS_MODE', 'server') || 'server').toLowerCase(),
    // ★ Gelato Relay / 1Balance API key goes here (server-side only!)
    gelatoApiKey: str('GELATO_RELAY_API_KEY', str('GELATO_SPONSOR_API_KEY', '')),
    // ★ Biconomy Paymaster credentials go here (server-side only!)
    biconomyPaymasterApiKey: str('BICONOMY_PAYMASTER_API_KEY', ''),
    biconomyPaymasterUrl: str('BICONOMY_PAYMASTER_URL', ''),
    biconomyBundlerUrl: str('BICONOMY_BUNDLER_URL', '')
  },

  limits: {
    earnMinWei: tokensToWei(num('EARN_MIN_TOKENS', 1)),
    earnMaxWei: tokensToWei(num('EARN_MAX_TOKENS', 100000)),
    earnCooldownMs: num('EARN_COOLDOWN_SECONDS', 20) * 1000,
    earnDailyCapWei: tokensToWei(num('EARN_DAILY_CAP_TOKENS', 500000)),

    withdrawMinWei: tokensToWei(num('WITHDRAW_MIN_TOKENS', 1)),
    withdrawMaxWei: tokensToWei(num('WITHDRAW_MAX_TOKENS', 100000)),
    withdrawDailyCapWei: tokensToWei(num('WITHDRAW_DAILY_CAP_TOKENS', 1000000))
  },

  session: {
    secret: str('SESSION_SECRET', ''),
    ttlMs: num('SESSION_TTL_MINUTES', 60 * 24) * 60 * 1000,
    nonceTtlMs: 5 * 60 * 1000
  },

  allowDryRun: bool('ALLOW_DRY_RUN', true),
  decimals: DECIMALS,
  dataDir: path.join(__dirname, '..', 'data')
};

/** Fails fast with actionable messages when the deployment is half-configured. */
export function validateConfig() {
  const problems = [];
  if (config.session.secret.length < 16 && !config.allowDryRun) {
    problems.push('SESSION_SECRET must be at least 16 characters (or set ALLOW_DRY_RUN=true for local testing)');
  }
  if (config.gasless.mode === 'gelato' && !config.gasless.gelatoApiKey) {
    problems.push('GASLESS_MODE=gelato requires GELATO_RELAY_API_KEY (https://app.gelato.network)');
  }
  if (config.gasless.mode === 'biconomy' && !config.gasless.biconomyPaymasterUrl) {
    problems.push('GASLESS_MODE=biconomy requires BICONOMY_PAYMASTER_URL (+ BICONOMY_BUNDLER_URL)');
  }
  if (!config.allowDryRun) {
    if (!config.chain.rpcUrl) problems.push('RPC_URL is required when ALLOW_DRY_RUN=false');
    if (!config.chain.tokenAddress) problems.push('TOKEN_ADDRESS is required when ALLOW_DRY_RUN=false');
    if (!config.keys.minterPrivateKey) problems.push('MINTER_PRIVATE_KEY is required when ALLOW_DRY_RUN=false');
  }
  return problems;
}

export { tokensToWei, DECIMALS };
export default config;
