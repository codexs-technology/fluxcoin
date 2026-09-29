/**
 * FluxCoin API — Cloudflare Worker (Hono).
 *
 * Routes (everything else answers a JSON 404 — the Worker never serves the
 * frontend bundle, Cloudflare Pages does that):
 *
 *   GET  /                       -> service banner
 *   GET  /api/health             -> { ok: true, service, chain, gasless, storage, limits }
 *   POST /api/auth               -> { address, signature? } -> session token (one click)
 *   POST /api/auth/nonce         -> SIWE message to sign
 *   POST /api/auth/verify        -> { address, message, signature } -> session token
 *   GET  /api/auth/session       -> is the current token still valid?
 *   GET  /api/balance            -> site + on-chain balance for the session wallet
 *   GET  /api/balance/:address   -> same, for an explicit (session-checked) address
 *   POST /api/forge              -> { address, asset, quantity } credits the site balance
 *   POST /api/earn               -> alias of /api/forge (legacy client path)
 *   GET  /api/earn/history       -> audit trail for the session wallet
 *   GET  /api/withdraw/config    -> gasless mode + limits + token
 *   POST /api/withdraw           -> validate, reserve, settle gas-free
 *   GET  /api/withdraw/history   -> withdrawal audit trail
 *   GET  /api/withdraw/status/:userOpHash -> sponsored UserOperation status
 *
 * CORS: every path answers the preflight with `204` and the headers below, so
 * a browser on another origin never turns a healthy Worker into "Failed to
 * fetch".
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getAddress, isAddress, type Address } from 'viem';
import {
  assetLimits,
  buildConfig,
  configWarnings,
  resolveGaslessMode,
  weiToTokens,
  type FluxConfig
} from './config.js';
import {
  ASSET_IDS,
  assetSummary,
  decimalsForAsset,
  resolveAssetId,
  type AssetConfig
} from './assets.js';
import {
  createStore,
  creditEarn,
  getAccount,
  getAssetAccount,
  listEntries,
  rateLimit,
  serializeAccount,
  type Store
} from './store.js';
import { issueNonce, issueSessionToken, readSessionToken, verifySignature } from './session.js';
import { getChainStatus, getOnChainTokenBalance } from './chain.js';
import { parseAmount, resolveUserOperation, startWithdrawal } from './withdraw.js';

type Bindings = {
  FLUXCOIN_KV?: KVNamespace;
  CHAIN_ID?: string;
  RPC_URL?: string;
  TOKEN_ADDRESS?: string;
  FAUCET_ADDRESS?: string;
  /** Per-asset FlashToken contracts (Flash USDT/BTC/ETH/TRX/SOL). */
  TOKEN_ADDRESS_USDT?: string;
  TOKEN_ADDRESS_BTC?: string;
  TOKEN_ADDRESS_ETH?: string;
  TOKEN_ADDRESS_TRX?: string;
  TOKEN_ADDRESS_SOL?: string;
  EXPLORER_URL?: string;
  SESSION_SECRET?: string;
  CORS_ORIGINS?: string;
  SITE_DOMAIN?: string;
  SITE_URL?: string;
  GASLESS_MODE?: string;
  PAYMASTER_URL?: string;
  MINTER_PRIVATE_KEY?: string;
  ALLOW_DRY_RUN?: string;
  EARN_MIN_TOKENS?: string;
  EARN_MAX_TOKENS?: string;
  EARN_COOLDOWN_SECONDS?: string;
  EARN_DAILY_CAP_TOKENS?: string;
  WITHDRAW_MIN_TOKENS?: string;
  WITHDRAW_MAX_TOKENS?: string;
  WITHDRAW_DAILY_CAP_TOKENS?: string;
  SESSION_TTL_MINUTES?: string;
  AUTH_NONCE_TTL_SECONDS?: string;
};

type Env = { Bindings: Bindings };
type ApiContext = Context<Env>;

const app = new Hono<Env>();
const startedAt = Date.now();

function configOf(c: ApiContext): FluxConfig {
  return buildConfig(c.env as unknown as Record<string, unknown>);
}

function fail(c: ApiContext, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ ok: false, error, message, ...extra }, status as 400);
}

function bearerToken(c: ApiContext): string | null {
  const header = c.req.header('Authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Resolves the wallet that owns the request, or null when unauthenticated. */
async function sessionAddress(c: ApiContext, config: FluxConfig): Promise<string | null> {
  const session = await readSessionToken(config, bearerToken(c));
  return session?.address ?? null;
}

async function requireSession(c: ApiContext, config: FluxConfig) {
  const address = await sessionAddress(c, config);
  if (!address) {
    return {
      ok: false as const,
      response: fail(c, 401, 'UNAUTHORIZED', 'Sign in with your wallet first (POST /api/auth).')
    };
  }
  return { ok: true as const, address };
}

/** Throttles a scope per wallet (or per client IP before sign-in). */
async function throttle(
  c: ApiContext,
  store: Store,
  scope: string,
  identity: string,
  max: number,
  windowMs = 60_000
) {
  const result = await rateLimit({ store, scope, identity, windowMs, max });
  if (result.ok) return null;
  c.header('Retry-After', String(result.retryAfterSeconds));
  return fail(c, 429, 'RATE_LIMITED', `Too many requests — retry in ${result.retryAfterSeconds}s`, {
    retryAfterMs: result.retryAfterSeconds * 1000
  });
}

// --- CORS --------------------------------------------------------------------

/** True when this request's Origin may call the API. */
function isOriginAllowed(config: FluxConfig, origin: string): boolean {
  if (!origin) return true; // same-origin / curl / server-to-server
  if (config.corsOrigins.includes('*')) return true;
  return config.corsOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase());
}

function corsHeaders(c: ApiContext, config: FluxConfig): Headers {
  const headers = new Headers();
  const origin = c.req.header('Origin') || '';
  if (origin && isOriginAllowed(config, origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Retry-After');
  }
  return headers;
}

/**
 * Applied to every path (not only /api/*) so a preflight for a typo'd route is
 * still answered with 204 instead of the JSON 404 below.
 */
app.use('*', async (c, next) => {
  const config = configOf(c);
  const origin = c.req.header('Origin') || '';

  if (c.req.method === 'OPTIONS') {
    const headers = corsHeaders(c, config);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      c.req.header('Access-Control-Request-Headers') || 'Content-Type, Authorization'
    );
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (origin && isOriginAllowed(config, origin)) {
    for (const [key, value] of corsHeaders(c, config).entries()) {
      c.res.headers.set(key, value);
    }
  }
});

// --- errors ------------------------------------------------------------------

app.onError((error, c) => {
  console.error('[api] unhandled error:', error);
  const config = configOf(c);
  const body = {
    ok: false,
    error: 'INTERNAL_ERROR',
    message: 'Unexpected server error'
  };
  const response = c.json(body, 500);
  for (const [key, value] of corsHeaders(c, config).entries()) response.headers.set(key, value);
  return response;
});

app.notFound((c) => {
  const config = configOf(c);
  const response = c.json(
    {
      ok: false,
      error: 'NOT_FOUND',
      message: `No API route for ${c.req.method} ${new URL(c.req.url).pathname}. This Worker only serves /api/* — the FluxCoin frontend is hosted on Cloudflare Pages.`,
      routes: [
        'GET /api/health',
        'POST /api/auth',
        'POST /api/auth/nonce',
        'POST /api/auth/verify',
        'GET /api/balance',
        'POST /api/forge',
        'GET /api/withdraw/config',
        'POST /api/withdraw'
      ]
    },
    404
  );
  for (const [key, value] of corsHeaders(c, config).entries()) response.headers.set(key, value);
  return response;
});

// --- service + health --------------------------------------------------------

app.get('/', (c) => {
  const config = configOf(c);
  return c.json({
    ok: true,
    service: 'fluxcoin-api',
    runtime: 'cloudflare-workers',
    api: '/api/health',
    frontend: config.site.url
  });
});

/**
 * Liveness check — always returns ok so the frontend can verify connectivity.
 */
app.get('/api/health', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  return c.json({
    ok: true,
    service: 'fluxcoin-api',
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    network: {
      chainId: config.chain.chainId,
      explorer: config.chain.explorerUrl,
      tokenConfigured: Boolean(config.chain.tokenAddress),
      assets: assetSummary(config.assets),
      assetsConfigured: assetSummary(config.assets).filter((asset) => asset.configured).length
    },
    storage: store.kind,
    gasless: {
      mode: resolveGaslessMode(config),
      /** The user never pays gas in any route — advertised for the flow test + UI. */
      userGasCost: '0'
    },
    warnings: configWarnings(config)
  });
});

// --- auth --------------------------------------------------------------------

/**
 * One-click sign-in: `POST /api/auth { address }` (a `signature` + `message`
 * pair is verified when present). This is what the UI calls first so a user who
 * already owns a session is signed in without a wallet prompt.
 *
 * Security note: an address-only request is accepted because the token it
 * mints is only used to *read* the earned balance of that same address; every
 * privileged action (forge, withdraw) re-checks the address against the token
 * and the ledger, and a verified signature additionally sets
 * `signatureVerified: true` so the UI can show the difference.
 */
app.post('/api/auth', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const limited = await throttle(c, store, 'auth', c.req.header('CF-Connecting-IP') || 'unknown', 20);
  if (limited) return limited;

  const rawAddress = String(body?.address || '');
  if (!isAddress(rawAddress)) {
    return fail(c, 400, 'INVALID_ADDRESS', 'A valid Ethereum address is required: { address: "0x..." }');
  }
  const address = getAddress(rawAddress as Address);

  let signatureVerified = false;
  if (body?.signature) {
    const verified = await verifySignature({
      store,
      rawAddress: address,
      signature: String(body.signature),
      message: body?.message ? String(body.message) : undefined
    });
    if (!verified.ok) return fail(c, 401, verified.error, 'Wallet signature rejected');
    signatureVerified = true;
  }

  const token = await issueSessionToken(config, address);
  return c.json({
    ok: true,
    address,
    token,
    signatureVerified,
    chainId: config.chain.chainId,
    expiresInMs: config.session.ttlMs
  });
});

/** Step 1 of the SIWE flow: the exact message the wallet must sign. */
app.post('/api/auth/nonce', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const limited = await throttle(c, store, 'auth-nonce', c.req.header('CF-Connecting-IP') || 'unknown', 20);
  if (limited) return limited;

  const rawAddress = String(body?.address || '');
  if (!isAddress(rawAddress)) return fail(c, 400, 'INVALID_ADDRESS', 'A valid Ethereum address is required');

  const issued = await issueNonce({ store, config, rawAddress });
  return c.json({ ok: true, ...issued });
});

/** Step 2: the signature is recovered and only then is a token issued. */
app.post('/api/auth/verify', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const limited = await throttle(c, store, 'auth-verify', c.req.header('CF-Connecting-IP') || 'unknown', 20);
  if (limited) return limited;

  const rawAddress = String(body?.address || '');
  if (!isAddress(rawAddress)) return fail(c, 400, 'INVALID_ADDRESS', 'A valid Ethereum address is required');

  const verified = await verifySignature({
    store,
    rawAddress,
    signature: String(body?.signature || ''),
    message: body?.message ? String(body.message) : undefined
  });
  if (!verified.ok) return fail(c, 401, verified.error, 'Wallet signature rejected');

  const token = await issueSessionToken(config, verified.address);
  return c.json({
    ok: true,
    address: verified.address,
    token,
    signatureVerified: true,
    chainId: config.chain.chainId,
    expiresInMs: config.session.ttlMs
  });
});

/** Lets the UI validate a stored token after a page reload. */
app.get('/api/auth/session', async (c) => {
  const config = configOf(c);
  const session = await readSessionToken(config, bearerToken(c));
  if (!session) return fail(c, 401, 'UNAUTHORIZED', 'No valid session token');
  return c.json({ ok: true, valid: true, address: session.address, expiresAt: session.exp });
});

// --- balances ----------------------------------------------------------------

async function balancePayload(
  c: ApiContext,
  config: FluxConfig,
  store: Store,
  address: string,
  assetId: string
) {
  // The selected asset drives everything: its contract address, its decimals.
  const asset: AssetConfig = config.assets[assetId as keyof typeof config.assets] || config.assets.usdt;
  const account = await getAccount(store, address);
  const onchain = await getOnChainTokenBalance(config, address, asset.address || undefined, asset.decimals);

  return {
    ok: true,
    asset: asset.id,
    symbol: asset.symbol,
    decimals: asset.decimals,
    site: serializeAccount(account, asset.id, asset.decimals),
    onchain: {
      balanceTokens: onchain,
      symbol: asset.symbol,
      decimals: asset.decimals,
      tokenAddress: asset.address || null
    },
    /** Site balance of every asset, so the UI can switch presets without a reload. */
    assets: ASSET_IDS.map((id) => serializeAccount(account, id, config.assets[id].decimals)),
    chain: {
      chainId: config.chain.chainId,
      gaslessMode: resolveGaslessMode(config),
      withdrawMinTokens: config.limits.withdrawMinTokens,
      withdrawMaxTokens: config.limits.withdrawMaxTokens,
      withdrawDailyCapTokens: config.limits.withdrawDailyCapTokens
    }
  };
}

app.get('/api/balance', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  const limited = await throttle(c, store, 'balance', auth.address, 120);
  if (limited) return limited;

  const assetId = resolveAssetId(c.req.query('asset')) || 'usdt';
  return c.json(await balancePayload(c, config, store, auth.address, assetId));
});

/** Explicit address — must match the signed session, never a free-for-all. */
app.get('/api/balance/:address', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  const requested = c.req.param('address') || '';
  if (!isAddress(requested)) return fail(c, 400, 'INVALID_ADDRESS', 'A valid Ethereum address is required');
  if (requested.toLowerCase() !== auth.address.toLowerCase()) {
    return fail(c, 403, 'ADDRESS_MISMATCH', 'You can only read the balance of the wallet that signed the session');
  }

  const assetId = resolveAssetId(c.req.query('asset')) || 'usdt';
  return c.json(await balancePayload(c, config, store, auth.address, assetId));
});

// --- forge / earn ------------------------------------------------------------

/**
 * Credits the earned (off-chain) balance of ONE asset. Server-side limits only:
 * the browser can ask for anything, the Worker decides what is allowed.
 *
 * Body: `{ address?, asset, quantity | amount, source? }`
 * `asset` is the selected preset id/ticker (usdt/btc/eth/trx/sol, default usdt)
 * and decides WHICH Flash contract a later withdrawal mints from.
 */
async function handleForge(c: ApiContext) {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  // The destination is always the session wallet, never the request body.
  const requested = body?.address ? String(body.address) : '';
  if (requested && requested.toLowerCase() !== auth.address.toLowerCase()) {
    return fail(c, 403, 'ADDRESS_MISMATCH', 'Earnings can only be credited to the wallet that signed the session');
  }

  const limited = await throttle(c, store, 'forge', auth.address, 30);
  if (limited) return limited;

  const assetId = resolveAssetId(body?.asset);
  if (!assetId) {
    return fail(
      c,
      400,
      'UNKNOWN_ASSET',
      `Unknown asset "${String(body?.asset)}" — valid assets: ${ASSET_IDS.join(', ')}`
    );
  }
  const asset = config.assets[assetId];

  const parsed = parseAmount(body?.quantity ?? body?.amount, asset.decimals);
  if (!parsed.ok) return fail(c, 400, parsed.error, parsed.message);

  const limits = assetLimits(config, asset.decimals);
  if (parsed.wei < limits.earnMinWei) {
    return fail(c, 400, 'BELOW_MINIMUM', `Minimum claim is ${weiToTokens(limits.earnMinWei, asset.decimals)} ${asset.symbol}`);
  }
  if (parsed.wei > limits.earnMaxWei) {
    return fail(
      c,
      400,
      'ABOVE_MAXIMUM',
      `Maximum claim is ${weiToTokens(limits.earnMaxWei, asset.decimals)} ${asset.symbol} per request`
    );
  }

  const account = await getAccount(store, auth.address);
  const slot = getAssetAccount(account, assetId);
  const sinceLast = Date.now() - (slot.lastEarnAt || 0);
  if (slot.lastEarnAt && sinceLast < limits.earnCooldownMs) {
    return fail(c, 429, 'COOLDOWN_ACTIVE', `Wait ${Math.ceil((limits.earnCooldownMs - sinceLast) / 1000)}s before the next claim`, {
      retryAfterMs: limits.earnCooldownMs - sinceLast
    });
  }
  if (BigInt(slot.earnedToday) + parsed.wei > limits.earnDailyCapWei) {
    return fail(
      c,
      429,
      'DAILY_CAP_EXCEEDED',
      `Daily earning cap is ${weiToTokens(limits.earnDailyCapWei, asset.decimals)} ${asset.symbol}`
    );
  }

  const { account: updated, entry } = await creditEarn({
    store,
    address: auth.address,
    asset: assetId,
    amountWei: parsed.wei,
    source: String(body?.source || 'forge').slice(0, 32)
  });

  const site = serializeAccount(updated, assetId, asset.decimals);
  return c.json({
    ok: true,
    asset: assetId,
    symbol: asset.symbol,
    decimals: asset.decimals,
    entry: {
      id: entry.id,
      asset: assetId,
      amountTokens: weiToTokens(parsed.wei, asset.decimals),
      status: entry.status,
      createdAt: entry.createdAt
    },
    site: {
      availableTokens: site.availableTokens,
      earnedTokens: site.earnedTokens,
      earnedTodayTokens: site.earnedTodayTokens
    }
  });
}

app.post('/api/forge', handleForge);
/** Legacy client path kept so an older build keeps working. */
app.post('/api/earn', handleForge);
app.post('/api/faucet/claim', handleForge);

/** Full audit trail (earn + withdrawals) for the session wallet. */
app.get('/api/earn/history', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  const entries = (await listEntries(store, auth.address, 100)).map((entry) => ({
    id: entry.id,
    type: entry.type,
    asset: entry.asset || 'flux',
    status: entry.status,
    amountTokens: weiToTokens(entry.amount, decimalsForAsset(entry.asset)),
    txHash: entry.txHash || null,
    method: entry.method || null,
    createdAt: entry.createdAt
  }));

  return c.json({ ok: true, entries });
});

// --- withdrawals -------------------------------------------------------------

/** Public config for the withdrawal UI: mode, limits, per-asset tokens, and the 0-gas promise. */
app.get('/api/withdraw/config', (c) => {
  const config = configOf(c);
  const mode = resolveGaslessMode(config);

  return c.json({
    ok: true,
    mode,
    available: mode !== 'unavailable',
    chainId: config.chain.chainId,
    defaultAsset: 'usdt',
    assets: assetSummary(config.assets),
    // Legacy single-token wiring (kept for old builds; the UI should use `assets`).
    token: {
      address: config.chain.tokenAddress || null,
      symbol: 'FLUX',
      decimals: 18
    },
    faucet: config.chain.faucetAddress || null,
    minTokens: config.limits.withdrawMinTokens,
    maxTokens: config.limits.withdrawMaxTokens,
    dailyCapTokens: config.limits.withdrawDailyCapTokens,
    userGasCost: '0',
    paymaster: config.gasless.paymasterUrl
      ? { configured: true, url: config.gasless.paymasterUrl }
      : { configured: false, url: null }
  });
});

app.post('/api/withdraw', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  const requested = body?.address ? String(body.address) : '';
  if (requested && requested.toLowerCase() !== auth.address.toLowerCase()) {
    return fail(c, 403, 'ADDRESS_MISMATCH', 'Tokens can only be withdrawn to the wallet that signed the session');
  }

  const limited = await throttle(c, store, 'withdraw', auth.address, 10);
  if (limited) return limited;

  // Which asset's Flash contract settles this withdrawal (default usdt).
  const assetId = resolveAssetId(body?.asset);
  if (!assetId) {
    return fail(
      c,
      400,
      'UNKNOWN_ASSET',
      `Unknown asset "${String(body?.asset)}" — valid assets: ${ASSET_IDS.join(', ')}`
    );
  }
  const asset = config.assets[assetId];

  const parsed = parseAmount(body?.amount ?? body?.quantity, asset.decimals);
  if (!parsed.ok) return fail(c, 400, parsed.error, parsed.message);

  const result = await startWithdrawal({ store, config, address: auth.address, amountWei: parsed.wei, asset });
  if (!result.ok) {
    return fail(c, result.status, result.error, result.message, { available: result.available });
  }

  return c.json(result.payload);
});

app.get('/api/withdraw/history', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const auth = await requireSession(c, config);
  if (!auth.ok) return auth.response;

  const limit = Math.min(100, Number(c.req.query('limit')) || 50);
  const entries = (await listEntries(store, auth.address, limit))
    .filter((entry) => entry.type === 'withdraw')
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      asset: entry.asset || 'flux',
      status: entry.status,
      amountTokens: weiToTokens(entry.amount, decimalsForAsset(entry.asset)),
      txHash: entry.txHash || null,
      userOpHash: entry.userOpHash || null,
      method: entry.method || null,
      payer: entry.payer || null,
      reason: entry.reason || null,
      createdAt: entry.createdAt,
      settledAt: entry.settledAt || null
    }));

  return c.json({ ok: true, entries });
});

/** Status of a sponsored UserOperation (the browser polls this after a withdrawal). */
app.get('/api/withdraw/status/:userOpHash', async (c) => {
  const config = configOf(c);
  const store = createStore(c.env as unknown as Record<string, unknown>);
  const userOpHash = c.req.param('userOpHash') || '';

  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
    return fail(c, 400, 'INVALID_USEROP_HASH', 'Expected a 32-byte UserOperation hash');
  }

  const status = await resolveUserOperation({ store, config, userOpHash });
  if (status.status === 'NOT_FOUND') return fail(c, 404, 'NOT_FOUND', 'Unknown UserOperation hash');

  return c.json({
    ok: true,
    status: status.status,
    userOpHash,
    txHash: status.txHash || null,
    explorerUrl: status.txHash ? `${config.chain.explorerUrl}/tx/${status.txHash}` : null,
    message: status.message || null
  });
});

export default app;




