/**
 * FlushCoin core (FlushChain) — single implementation shared by:
 *   - the Node backend  (server/index.mjs)
 *   - the browser       (scripts/lib/backend.js -> offline devnet)
 *
 * Everything here is environment agnostic: it only uses `globalThis.crypto`
 * (WebCrypto), BigInt and plain JSON. A transaction signed in the browser
 * therefore verifies byte-for-byte on the server.
 *
 * Money rules:
 *   - every amount on the wire is a *decimal string* in the smallest unit
 *     (10^8 units = 1 coin, the satoshi idea)
 *   - all math inside is BigInt, never float
 */

export const NETWORK = {
  name: 'FlushCoin Devnet',
  chainId: 'FLUSH-1',
  symbol: 'FLUSH',
  nativeName: 'Flush Coin',
  decimals: 8,
  unit: 10n ** 8n,
  difficulty: 3, // leading zero hex nibbles in a block hash (fast, still real PoW)
  blockReward: 2n * 10n ** 8n, // 2 FLUSH per sealed block, paid from the treasury
  minFee: 100_000n, // 0.001 FLUSH
  maxFee: 10n ** 8n, // 1 FLUSH
  maxSupply: 21_000_000n * 10n ** 8n,
  // the whole supply exists from genesis inside the treasury; block rewards and
  // the faucet pay it out, so the cap can never be exceeded
  treasuryGenesis: 21_000_000n * 10n ** 8n,
  faucetAmount: 250n * 10n ** 8n,
  faucetCooldownMs: 20_000,
  swapFeeBps: 30, // 0.30% AMM fee
  historyLimit: 400,
};
export const TX_TYPES = [
  'transfer',
  'token_create',
  'token_transfer',
  'token_mint',
  'liquidity_add',
  'liquidity_remove',
  'swap',
  'order_place',
  'order_cancel',
];

/* ------------------------------------------------------------------ *
 * crypto helpers
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };

export function utf8(text) {
  return encoder.encode(text);
}

export function u8ToHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function u8FromHex(hex) {
  const clean = String(hex).replace(/^0x/, '');
  if (clean.length % 2) throw new Error('hex string must have an even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function u8ToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function u8FromB64(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(b64), 'base64'));
  const binary = atob(String(b64));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256(input) {
  const bytes = typeof input === 'string' ? utf8(input) : input;
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(input) {
  return u8ToHex(await sha256(input));
}

/** Deterministic JSON: object keys sorted, BigInt -> decimal string. */
export function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cannot canonicalize non finite number');
    return String(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  throw new Error('cannot canonicalize value of type ' + typeof value);
}

export function canonicalString(value) {
  return JSON.stringify(canonicalize(value));
}

export async function hashObject(value) {
  return sha256Hex(canonicalString(value));
}

/** address = 0x + first 20 bytes of sha256(raw public key) */
export async function deriveAddress(publicKeyB64) {
  const digest = await sha256(u8FromB64(publicKeyB64));
  return '0x' + u8ToHex(digest.subarray(0, 20));
}

export function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
}

export function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

export async function generateWallet() {
  const keyPair = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const publicKey = u8ToB64(new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey)));
  const privateKey = u8ToB64(new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey)));
  return { address: await deriveAddress(publicKey), publicKey, privateKey };
}

export async function importPrivateKey(privateKeyB64) {
  const key = await subtle.importKey('pkcs8', u8FromB64(privateKeyB64), ECDSA, true, ['sign']);
  const jwk = await subtle.exportKey('jwk', key);
  const pubKey = await subtle.importKey('jwk', {
    kty: 'EC',
    crv: 'P-256',
    x: jwk.x,
    y: jwk.y,
    key_ops: ['verify'],
    ext: true,
  }, ECDSA, true, ['verify']);
  const publicKey = u8ToB64(new Uint8Array(await subtle.exportKey('raw', pubKey)));
  return { address: await deriveAddress(publicKey), publicKey, privateKey: privateKeyB64 };
}

export async function signPayload(privateKeyB64, payload) {
  const key = await subtle.importKey('pkcs8', u8FromB64(privateKeyB64), ECDSA, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(canonicalString(payload))));
  return u8ToB64(sig);
}

export async function verifyPayload(publicKeyB64, payload, signatureB64) {
  try {
    const key = await subtle.importKey('raw', u8FromB64(publicKeyB64), ECDSA, false, ['verify']);
    const sig = u8FromB64(signatureB64);
    if (sig.length !== 64) return false;
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, utf8(canonicalString(payload)));
  } catch {
    return false;
  }
}


/* ------------------------------------------------------------------ *
 * amounts
 * ------------------------------------------------------------------ */

export function parseUnits(value, decimals = NETWORK.decimals) {
  const text = String(value ?? '').trim();
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') throw new Error(`"${value}" is not a valid number`);
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(decimals);
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * scale + BigInt(padded || '0');
}

export function formatUnits(value, decimals = NETWORK.decimals, maxFractionDigits = 6) {
  const amount = typeof value === 'bigint' ? value : BigInt(value ?? 0);
  const scale = 10n ** BigInt(decimals);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, '0').slice(0, maxFractionDigits).replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? '-' + text : text;
}

export function groupDigits(value) {
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** human readable amount from wire units */
export function formatAmount(value, decimals = NETWORK.decimals, digits = 4) {
  const text = formatUnits(value, decimals, digits);
  return groupDigits(text === '0' || text === '-0' ? '0' : text);
}

export function big(value) {
  if (typeof value === 'bigint') return value;
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(value);
}

export function str(value) {
  return big(value).toString();
}

export function minOf(a, b) {
  return a < b ? a : b;
}

/* ------------------------------------------------------------------ *
 * transactions
 * ------------------------------------------------------------------ */

/**
 * Build a signed transaction. The signed payload is everything except
 * `signature` and `hash`, canonicalised, so any tampering breaks the signature.
 */
export async function createTransaction({ digitalWallet, type, payload = {}, nonce, fee }) {
  if (!TX_TYPES.includes(type)) throw new Error('unknown transaction type: ' + type);
  const body = {
    type,
    from: digitalWallet.address,
    publicKey: digitalWallet.publicKey,
    nonce: Number(nonce),
    fee: str(fee ?? NETWORK.minFee),
    timestamp: Date.now(),
    payload,
  };
  const signature = await signPayload(digitalWallet.privateKey, body);
  const tx = { ...body, signature };
  tx.hash = await hashObject(tx);
  return tx;
}

/** Everything the signature covers (also used by the verifier). */
export function signedBody(tx) {
  return {
    type: tx.type,
    from: tx.from,
    publicKey: tx.publicKey,
    nonce: Number(tx.nonce),
    fee: str(tx.fee),
    timestamp: Number(tx.timestamp),
    payload: tx.payload ?? {},
  };
}

export async function verifyTransactionSignature(tx) {
  if (!tx || typeof tx !== 'object') return false;
  if (!isAddress(tx.from) || typeof tx.publicKey !== 'string' || typeof tx.signature !== 'string') return false;
  if ((await deriveAddress(tx.publicKey)) !== tx.from) return false;
  return verifyPayload(tx.publicKey, signedBody(tx), tx.signature);
}

export async function transactionHash(tx) {
  return hashObject({ ...signedBody(tx), signature: tx.signature });
}

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */

export const GENESIS_TREASURY = '0x9fd1c0de0000000000000000000000000000ffff';
export const GENESIS_NODE = '0x9fd1c0de00000000000000000000000000001111';

export function emptyState() {
  return {
    accounts: {},
    tokens: {},
    pools: {},
    orders: {},
    trades: [],
    prices: {},
    faucet: {},
    effects: [],
    meta: { txCount: 0, swapCount: 0, tradeCount: 0, tokenCount: 0, minted: '0' },
  };
}

export function getAccount(state, address, create = false) {
  const key = normalizeAddress(address);
  let account = state.accounts[key];
  if (!account && create) {
    account = { address: key, flush: '0', lockedFlush: '0', tokens: {}, lockedTokens: {}, lp: {}, nonce: 0, firstSeen: Date.now() };
    state.accounts[key] = account;
  }
  return account;
}

export function accountView(state, address) {
  const account = getAccount(state, address, true);
  const tokens = Object.entries(account.tokens)
    .filter(([, amount]) => big(amount) > 0n)
    .map(([symbol, amount]) => ({ symbol, amount: str(amount), meta: state.tokens[symbol] ?? null }));
  const lp = Object.entries(account.lp)
    .filter(([, shares]) => big(shares) > 0n)
    .map(([symbol, shares]) => ({ symbol, shares: str(shares) }));
  return {
    address: account.address,
    flush: str(account.flush),
    lockedFlush: str(account.lockedFlush),
    availableFlush: str(big(account.flush) - big(account.lockedFlush)),
    nonce: account.nonce,
    tokens,
    lockedTokens: { ...account.lockedTokens },
    lp,
    openOrders: Object.values(state.orders).filter(
      (order) => order.owner === account.address && (order.status === 'open' || order.status === 'partial'),
    ),
  };
}

function credit(state, address, amount) {
  const account = getAccount(state, address, true);
  account.flush = str(big(account.flush) + big(amount));
}

function debit(state, address, amount) {
  const account = getAccount(state, address, true);
  const next = big(account.flush) - big(amount);
  if (next < 0n) throw new Error('insufficient FLUSH balance');
  account.flush = str(next);
}

function creditToken(state, address, symbol, amount) {
  const account = getAccount(state, address, true);
  account.tokens[symbol] = str(big(account.tokens[symbol]) + big(amount));
}

function debitToken(state, address, symbol, amount) {
  const account = getAccount(state, address, true);
  const next = big(account.tokens[symbol]) - big(amount);
  if (next < 0n) throw new Error(`insufficient ${symbol} balance`);
  account.tokens[symbol] = str(next);
}

function lockFlush(state, address, amount) {
  const account = getAccount(state, address, true);
  account.lockedFlush = str(big(account.lockedFlush) + big(amount));
}

function unlockFlush(state, address, amount) {
  const account = getAccount(state, address, true);
  const next = big(account.lockedFlush) - big(amount);
  account.lockedFlush = str(next < 0n ? 0n : next);
}

function lockToken(state, address, symbol, amount) {
  const account = getAccount(state, address, true);
  account.lockedTokens[symbol] = str(big(account.lockedTokens[symbol]) + big(amount));
}

function unlockToken(state, address, symbol, amount) {
  const account = getAccount(state, address, true);
  const next = big(account.lockedTokens[symbol]) - big(amount);
  account.lockedTokens[symbol] = str(next < 0n ? 0n : next);
}

function recordEffect(state, effect) {
  state.effects.push(effect);
  if (state.effects.length > NETWORK.historyLimit) state.effects.splice(0, state.effects.length - NETWORK.historyLimit);
}

function recordPrice(state, symbol, price, volume) {
  const series = state.prices[symbol] ?? (state.prices[symbol] = []);
  series.push({ t: Date.now(), p: str(price), v: str(volume) });
  if (series.length > NETWORK.historyLimit) series.splice(0, series.length - NETWORK.historyLimit);
}

function recordTrade(state, trade) {
  state.trades.unshift(trade);
  if (state.trades.length > NETWORK.historyLimit) state.trades.length = NETWORK.historyLimit;
  state.meta.tradeCount += 1;
}

export function tokenMarketView(state, symbol) {
  const token = state.tokens[symbol];
  if (!token) return null;
  const pool = state.pools[symbol] ?? null;
  const series = state.prices[symbol] ?? [];
  const last = series.length ? big(series[series.length - 1].p) : 0n;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = series.filter((point) => point.t >= dayAgo);
  const volume = recent.reduce((sum, point) => sum + big(point.v), 0n);
  return {
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    emoji: token.emoji,
    color: token.color,
    creator: token.creator,
    totalSupply: token.totalSupply,
    mintable: token.mintable,
    createdAt: token.createdAt,
    holders: Object.values(state.accounts).filter((account) => big(account.tokens[symbol]) > 0n).length,
    price: str(last),
    changeBps: recent.length > 1 && big(recent[0].p) > 0n
      ? Number(((last - big(recent[0].p)) * 10_000n) / big(recent[0].p))
      : 0,
    volume24h: str(volume),
    liquidity: pool ? str(big(pool.flush)) : '0',
    pool: pool ? { flush: str(pool.flush), token: str(pool.token), shares: str(pool.totalShares), feeBps: pool.feeBps } : null,
    openOrders: Object.values(state.orders).filter((order) => order.market === symbol && (order.status === 'open' || order.status === 'partial')).length,
    priceHistory: series.slice(-120),
  };
}

/* ------------------------------------------------------------------ *
 * AMM (constant product, like Uniswap v2) — this is what makes a token
 * swappable at all times, even when an order book is empty.
 * ------------------------------------------------------------------ */

export function bigintSqrt(value) {
  if (value < 0n) throw new Error('negative sqrt');
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** price of 1 token expressed in FLUSH units, scaled by 10^decimals */
export function poolPrice(pool, decimals = NETWORK.decimals) {
  const flush = big(pool.flush);
  const token = big(pool.token);
  if (token === 0n) return 0n;
  return (flush * 10n ** BigInt(decimals)) / token;
}

/**
 * @param {object} pool  { flush, token, feeBps }
 * @param {'buy'|'sell'} direction buy = FLUSH -> token, sell = token -> FLUSH
 * @param {bigint|string} amountIn
 */
export function quoteSwap(pool, direction, amountIn, decimals = NETWORK.decimals) {
  if (!pool) throw new Error('this token has no liquidity pool yet');
  const flushReserve = big(pool.flush);
  const tokenReserve = big(pool.token);
  if (flushReserve <= 0n || tokenReserve <= 0n) throw new Error('liquidity pool is empty');
  const amount = big(amountIn);
  if (amount <= 0n) throw new Error('amount must be greater than zero');
  const feeBps = BigInt(pool.feeBps ?? NETWORK.swapFeeBps);
  const fee = (amount * feeBps) / 10_000n;
  const net = amount - fee;
  const priceBefore = poolPrice(pool, decimals);

  let amountOut;
  if (direction === 'buy') {
    amountOut = (tokenReserve * net) / (flushReserve + net);
    if (amountOut >= tokenReserve) amountOut = tokenReserve - 1n;
  } else if (direction === 'sell') {
    amountOut = (flushReserve * net) / (tokenReserve + net);
    if (amountOut >= flushReserve) amountOut = flushReserve - 1n;
  } else {
    throw new Error('direction must be "buy" or "sell"');
  }
  if (amountOut <= 0n) throw new Error('amount is too small to swap');

  const nextFlush = direction === 'buy' ? flushReserve + amount : flushReserve - amountOut;
  const nextToken = direction === 'buy' ? tokenReserve - amountOut : tokenReserve + amount;
  const priceAfter = nextToken === 0n ? 0n : (nextFlush * 10n ** BigInt(decimals)) / nextToken;
  const impact = priceBefore === 0n ? 0n : ((priceAfter - priceBefore) * 10_000n) / priceBefore;

  return {
    direction,
    amountIn: str(amount),
    amountOut: str(amountOut),
    fee: str(fee),
    priceBefore: str(priceBefore),
    priceAfter: str(priceAfter),
    impactBps: Number(impact),
    reserveFlush: str(flushReserve),
    reserveToken: str(tokenReserve),
  };
}

function applySwap(state, tx, payload) {
  const symbol = String(payload.symbol || '').toUpperCase();
  const direction = payload.direction === 'sell' ? 'sell' : 'buy';
  const pool = state.pools[symbol];
  const account = getAccount(state, tx.from, true);
  const quote = quoteSwap(pool, direction, payload.amountIn, state.tokens[symbol].decimals);
  const amountIn = big(quote.amountIn);
  const amountOut = big(quote.amountOut);
  const minOut = big(payload.minAmountOut ?? 0);
  if (amountOut < minOut) throw new Error(`slippage too high: minimum received is ${formatAmount(minOut)}`);
  if (direction === 'buy') {
    debit(state, tx.from, amountIn);
    creditToken(state, tx.from, symbol, amountOut);
    // fee goes to treasury, net goes to pool (amountIn = net + fee)
    pool.flush = str(big(pool.flush) + (amountIn - big(quote.fee)));
    pool.token = str(big(pool.token) - amountOut);
    credit(state, GENESIS_TREASURY, quote.fee);
  } else {
    debitToken(state, tx.from, symbol, amountIn);
    credit(state, tx.from, amountOut);
    pool.token = str(big(pool.token) + amountIn);
    // pool pays amountOut to seller; the fee remains inside the pool
    pool.flush = str(big(pool.flush) - amountOut);
  }
  state.meta.swapCount += 1;
  recordPrice(state, symbol, quote.priceAfter, amountIn);
  recordTrade(state, {
    id: `amm-${tx.hash ?? ''}-${state.meta.swapCount}`,
    market: symbol,
    source: 'amm',
    side: direction === 'buy' ? 'buy' : 'sell',
    price: quote.priceAfter,
    amount: str(amountOut),
    flush: str(amountIn),
    taker: account.address,
    maker: 'AMM POOL',
    timestamp: Date.now(),
    txHash: tx.hash ?? '',
  });
  recordEffect(state, {
    kind: 'swap',
    symbol,
    from: account.address,
    amountIn: str(amountIn),
    amountOut: str(amountOut),
    direction,
    timestamp: Date.now(),
  });
  return { ...quote, symbol, account: account.address };
}

/* ------------------------------------------------------------------ *
 * liquidity (makes a token swappable)
 * ------------------------------------------------------------------ */

function ensurePool(state, symbol) {
  let pool = state.pools[symbol];
  if (!pool) {
    pool = { symbol, flush: '0', token: '0', totalShares: '0', feeBps: NETWORK.swapFeeBps, createdAt: Date.now() };
    state.pools[symbol] = pool;
  }
  return pool;
}

function applyLiquidityAdd(state, tx, payload) {
  const symbol = String(payload.symbol || '').toUpperCase();
  const flushAmount = big(payload.flushAmount);
  const tokenAmount = big(payload.tokenAmount);
  if (flushAmount <= 0n || tokenAmount <= 0n) throw new Error('both FLUSH and token amounts must be greater than zero');
  const pool = ensurePool(state, symbol);
  const poolFlush = big(pool.flush);
  const poolToken = big(pool.token);
  const sharesBefore = big(pool.totalShares);

  let shares;
  if (sharesBefore === 0n) {
    shares = bigintSqrt(flushAmount * tokenAmount);
  } else {
    shares = minOf((flushAmount * sharesBefore) / poolFlush, (tokenAmount * sharesBefore) / poolToken);
  }
  if (shares <= 0n) throw new Error('liquidity amount is too small');

  debit(state, tx.from, flushAmount);
  debitToken(state, tx.from, symbol, tokenAmount);
  pool.flush = str(poolFlush + flushAmount);
  pool.token = str(poolToken + tokenAmount);
  pool.totalShares = str(sharesBefore + shares);
  const account = getAccount(state, tx.from, true);
  account.lp[symbol] = str(big(account.lp[symbol]) + shares);
  if (sharesBefore === 0n) recordPrice(state, symbol, poolPrice(pool, state.tokens[symbol].decimals), flushAmount);
  recordEffect(state, { kind: 'liquidity_add', symbol, from: tx.from, flushAmount: str(flushAmount), tokenAmount: str(tokenAmount), shares: str(shares), timestamp: Date.now() });
  return { symbol, shares: str(shares), pool: { flush: pool.flush, token: pool.token, shares: pool.totalShares } };
}

function applyLiquidityRemove(state, tx, payload) {
  const symbol = String(payload.symbol || '').toUpperCase();
  const pool = state.pools[symbol];
  if (!pool) throw new Error('no liquidity pool for this token');
  const account = getAccount(state, tx.from, true);
  const shares = big(payload.shares);
  const held = big(account.lp[symbol]);
  if (shares <= 0n) throw new Error('shares must be greater than zero');
  if (shares > held) throw new Error('you do not hold that many LP shares');
  const total = big(pool.totalShares);
  const flushOut = (shares * big(pool.flush)) / total;
  const tokenOut = (shares * big(pool.token)) / total;
  if (flushOut <= 0n || tokenOut <= 0n) throw new Error('amount too small to withdraw');
  account.lp[symbol] = str(held - shares);
  pool.totalShares = str(total - shares);
  pool.flush = str(big(pool.flush) - flushOut);
  pool.token = str(big(pool.token) - tokenOut);
  if (big(pool.totalShares) === 0n) {
    pool.flush = '0';
    pool.token = '0';
  }
  credit(state, tx.from, flushOut);
  creditToken(state, tx.from, symbol, tokenOut);
  recordEffect(state, { kind: 'liquidity_remove', symbol, from: tx.from, flushAmount: str(flushOut), tokenAmount: str(tokenOut), shares: str(shares), timestamp: Date.now() });
  return { symbol, flushAmount: str(flushOut), tokenAmount: str(tokenOut), shares: str(shares) };
}

/* ------------------------------------------------------------------ *
 * order book / matching engine (makes a token tradable)
 *
 * price is FLUSH smallest-units per whole token scaled by PRICE_SCALE, so a
 * quoted price of "5" means 5 FLUSH for 1 token.
 * cost of a fill = floor(amount * price / PRICE_SCALE)
 * ------------------------------------------------------------------ */

export const PRICE_SCALE = NETWORK.unit;

export function orderCost(price, amount) {
  return (big(amount) * big(price)) / PRICE_SCALE;
}

export function tokensForBudget(budgetFlush, price) {
  if (big(price) <= 0n) return 0n;
  return (big(budgetFlush) * PRICE_SCALE) / big(price);
}

function sortBook(orders, side) {
  const list = orders.slice();
  list.sort((a, b) => {
    const diff = side === 'sell' ? big(a.price) - big(b.price) : big(b.price) - big(a.price);
    if (diff !== 0n) return diff < 0n ? -1 : 1;
    return a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
  });
  return list;
}

export function openOrdersFor(state, market, side) {
  return sortBook(
    Object.values(state.orders).filter(
      (order) =>
        order.market === market &&
        order.side === side &&
        (order.status === 'open' || order.status === 'partial') &&
        big(order.remaining) > 0n,
    ),
    side,
  );
}

export function orderBookView(state, market, depth = 20) {
  const levels = (side) => {
    const map = new Map();
    for (const order of openOrdersFor(state, market, side)) {
      const entry = map.get(order.price) ?? { price: order.price, amount: 0n, orders: 0 };
      entry.amount += big(order.remaining);
      entry.orders += 1;
      map.set(order.price, entry);
    }
    return [...map.values()]
      .slice(0, depth)
      .map((entry) => ({ price: entry.price, amount: str(entry.amount), orders: entry.orders }));
  };
  const bids = levels('buy');
  const asks = levels('sell');
  const bestBid = bids.length ? big(bids[0].price) : 0n;
  const bestAsk = asks.length ? big(asks[0].price) : 0n;
  const amm = state.pools[market] ? poolPrice(state.pools[market]) : 0n;
  const mid = bestBid > 0n && bestAsk > 0n ? (bestBid + bestAsk) / 2n : bestBid || bestAsk || amm;
  const series = state.prices[market] ?? [];
  return {
    market,
    bids,
    asks,
    bestBid: str(bestBid),
    bestAsk: str(bestAsk),
    spread: str(bestAsk > 0n && bestBid > 0n ? bestAsk - bestBid : 0n),
    midPrice: str(mid),
    ammPrice: str(amm),
    lastPrice: series.length ? series[series.length - 1].p : '0',
  };
}

/** Move funds for a single fill between a taker order and a resting maker order. */
function executeFill(state, taker, maker, price, amount, side) {
  if (amount <= 0n) return 0n;
  const market = taker.market;
  const cost = orderCost(price, amount);
  if (cost <= 0n) return 0n;
  const takerAccount = getAccount(state, taker.owner, true);
  const makerAccount = getAccount(state, maker.owner, true);

  if (side === 'buy') {
    // taker pays FLUSH that was locked at placement, maker delivers locked tokens
    debit(state, taker.owner, cost);
    unlockFlush(state, taker.owner, cost);
    creditToken(state, taker.owner, market, amount);
    debitToken(state, maker.owner, market, amount);
    unlockToken(state, maker.owner, market, amount);
    credit(state, maker.owner, cost);
  } else {
    debitToken(state, taker.owner, market, amount);
    unlockToken(state, taker.owner, market, amount);
    credit(state, taker.owner, cost);
    debit(state, maker.owner, cost);
    unlockFlush(state, maker.owner, cost);
    creditToken(state, maker.owner, market, amount);
  }

  taker.remaining = str(big(taker.remaining) - amount);
  taker.filled = str(big(taker.filled) + amount);
  taker.spentFlush = str(big(taker.spentFlush) + cost);
  maker.remaining = str(big(maker.remaining) - amount);
  maker.filled = str(big(maker.filled) + amount);
  maker.spentFlush = str(big(maker.spentFlush) + cost);
  maker.status = big(maker.remaining) === 0n ? 'filled' : 'partial';

  state.meta.tradeCount += 1;
  const trade = {
    id: `trade-${state.meta.tradeCount}`,
    market,
    source: 'book',
    side,
    price: str(price),
    amount: str(amount),
    flush: str(cost),
    taker: taker.owner,
    maker: maker.owner,
    takerOrder: taker.id,
    makerOrder: maker.id,
    timestamp: Date.now(),
    txHash: taker.txHash ?? '',
  };
  recordTrade(state, trade);
  recordPrice(state, market, price, cost);
  recordEffect(state, {
    kind: 'trade',
    market,
    side,
    price: str(price),
    amount: str(amount),
    flush: str(cost),
    taker: taker.owner,
    maker: maker.owner,
    timestamp: Date.now(),
  });
  return cost;
}

function matchLimitOrder(state, order) {
  let guard = 0;
  while (big(order.remaining) > 0n && guard++ < 500) {
    const best = openOrdersFor(state, order.market, order.side === 'buy' ? 'sell' : 'buy')[0];
    if (!best) break;
    if (order.side === 'buy' && big(best.price) > big(order.price)) break;
    if (order.side === 'sell' && big(best.price) < big(order.price)) break;
    executeFill(state, order, best, big(best.price), minOf(big(order.remaining), big(best.remaining)), order.side);
  }
  return order;
}

/** Market orders consume the book first and route the rest to the AMM, so a
 *  market order always fills as long as there is liquidity somewhere. */
function matchMarketOrder(state, order) {
  const side = order.side;
  let budget = big(order.budget);
  let out = 0n;
  let guard = 0;
  while (budget > 0n && guard++ < 500) {
    const best = openOrdersFor(state, order.market, side === 'buy' ? 'sell' : 'buy')[0];
    if (!best) break;
    const price = big(best.price);
    if (price <= 0n) break;
    let fill = minOf(big(best.remaining), tokensForBudget(budget, price));
    let cost = orderCost(price, fill);
    while (fill > 0n && cost > budget) {
      // rounding guard: shrink the fill until it fits the remaining budget
      fill -= 1n;
      cost = orderCost(price, fill);
    }
    if (fill <= 0n || cost <= 0n) break;
    order.remaining = str(fill);
    executeFill(state, order, best, price, fill, side);
    budget -= cost;
    out += fill;
  }
  order.remaining = '0';

  // residual goes through the AMM at the current pool price
  if (budget > 0n && state.pools[order.market]) {
    const pool = state.pools[order.market];
    const quote = quoteSwap(pool, side, budget, state.tokens[order.market].decimals);
    const amountOut = big(quote.amountOut);
    const minOut = big(order.minAmountOut ?? 0);
    if (out + amountOut < minOut) throw new Error('slippage too high: market price moved');
    const account = getAccount(state, order.owner, true);
    if (side === 'buy') {
      debit(state, order.owner, budget);
      unlockFlush(state, order.owner, budget);
      creditToken(state, order.owner, order.market, amountOut);
      pool.flush = str(big(pool.flush) + (budget - big(quote.fee)));
      pool.token = str(big(pool.token) - amountOut);
      credit(state, GENESIS_TREASURY, quote.fee);
    } else {
      debitToken(state, order.owner, order.market, budget);
      unlockToken(state, order.owner, order.market, budget);
      credit(state, order.owner, amountOut);
      pool.token = str(big(pool.token) + budget);
      pool.flush = str(big(pool.flush) - amountOut);
    }
    state.meta.swapCount += 1;
    state.meta.tradeCount += 1;
    out += amountOut;
    order.filled = str(big(order.filled) + amountOut);
    order.spentFlush = str(big(order.spentFlush) + budget);
    recordPrice(state, order.market, quote.priceAfter, budget);
    recordTrade(state, {
      id: `trade-${state.meta.tradeCount}`,
      market: order.market,
      source: 'amm',
      side,
      price: quote.priceAfter,
      amount: str(amountOut),
      flush: str(budget),
      taker: order.owner,
      maker: 'AMM POOL',
      takerOrder: order.id,
      timestamp: Date.now(),
      txHash: order.txHash ?? '',
    });
    budget = 0n;
  }

  const spent = big(order.spentFlush);
  const refund = big(order.budget) > spent ? big(order.budget) - spent : 0n;
  // the input of an order is only ever *locked*, never debited up front,
  // so unlocking the remainder is exactly the refund
  if (refund > 0n) {
    if (side === 'buy') unlockFlush(state, order.owner, refund);
    else unlockToken(state, order.owner, order.market, refund);
  }
  if (out <= 0n) throw new Error('order could not be filled: no matching orders and no liquidity pool');
  order.status = 'filled';
  return { filled: str(out) };
}

function applyOrderPlace(state, tx, payload) {
  const market = String(payload.symbol || '').toUpperCase();
  if (!state.tokens[market]) throw new Error(`token ${market} does not exist`);
  const side = payload.side === 'sell' ? 'sell' : 'buy';
  const type = payload.type === 'market' ? 'market' : 'limit';
  // Deterministic order ID derived strictly from transaction hash and nonce so
  // replaying blocks reconstructs the exact same order IDs:
  const hashPrefix = (tx.hash || 'tx').replace(/^0x/, '').slice(0, 16);
  const id = `ord-${hashPrefix}-${tx.nonce}`;
  const account = getAccount(state, tx.from, true);
  const availableFlush = big(account.flush) - big(account.lockedFlush);
  const availableToken = big(account.tokens[market]) - big(account.lockedTokens[market]);

  if (type === 'market') {
    const budget = big(payload.amountIn);
    if (budget <= 0n) throw new Error('amountIn must be greater than zero');
    if (side === 'buy' && availableFlush < budget) throw new Error('insufficient available FLUSH for this market order');
    if (side === 'sell' && availableToken < budget) throw new Error(`insufficient available ${market} for this market order`);
    if (side === 'buy') lockFlush(state, tx.from, budget);
    else lockToken(state, tx.from, market, budget);
    const order = {
      id,
      market,
      owner: tx.from,
      side,
      type,
      price: '0',
      amount: str(budget),
      remaining: str(budget),
      budget: str(budget),
      minAmountOut: str(payload.minAmountOut ?? 0),
      filled: '0',
      spentFlush: '0',
      locked: str(budget),
      status: 'open',
      createdAt: Date.now(),
      txHash: tx.hash ?? '',
    };
    state.orders[id] = order;
    const result = matchMarketOrder(state, order);
    const series = state.prices[market] ?? [];
    order.price = series.length ? series[series.length - 1].p : '0';
    return {
      orderId: id,
      type,
      side,
      market,
      filled: result.filled,
      spentFlush: order.spentFlush,
      averagePrice: order.price,
      status: order.status,
    };
  }

  const price = big(payload.price);
  const amount = big(payload.amount);
  if (price <= 0n) throw new Error('limit price must be greater than zero');
  if (amount <= 0n) throw new Error('amount must be greater than zero');
  const locked = side === 'buy' ? orderCost(price, amount) : amount;
  if (locked <= 0n) throw new Error('order size is too small');
  if (side === 'buy' && availableFlush < locked) throw new Error('insufficient available FLUSH to place this buy order');
  if (side === 'sell' && availableToken < locked) throw new Error(`insufficient available ${market} to place this sell order`);
  if (side === 'buy') lockFlush(state, tx.from, locked);
  else lockToken(state, tx.from, market, locked);

  const order = {
    id,
    market,
    owner: tx.from,
    side,
    type,
    price: str(price),
    amount: str(amount),
    remaining: str(amount),
    budget: '0',
    minAmountOut: '0',
    filled: '0',
    spentFlush: '0',
    locked: str(locked),
    status: 'open',
    createdAt: Date.now(),
    txHash: tx.hash ?? '',
  };
  state.orders[id] = order;
  matchLimitOrder(state, order);
  if (big(order.remaining) === 0n) {
    order.status = 'filled';
    // If a buy order filled at better prices than its limit, refund the difference:
    if (side === 'buy') {
      const lockedVal = big(order.locked);
      const spentVal = big(order.spentFlush);
      if (lockedVal > spentVal) {
        unlockFlush(state, tx.from, lockedVal - spentVal);
        order.locked = str(spentVal);
      }
    }
  } else if (big(order.filled) > 0n) {
    order.status = 'partial';
  }
  return {
    orderId: id,
    type,
    side,
    market,
    price: order.price,
    amount: order.amount,
    remaining: order.remaining,
    filled: order.filled,
    status: order.status,
  };
}

function applyOrderCancel(state, tx, payload) {
  const order = state.orders[String(payload.orderId || '')];
  if (!order) throw new Error('order not found');
  if (order.owner !== tx.from) throw new Error('you can only cancel your own orders');
  if (order.status !== 'open' && order.status !== 'partial') throw new Error('order is already ' + order.status);
  const account = getAccount(state, tx.from, true);
  const locked = big(order.locked);
  const spent = big(order.spentFlush);
  const refund = locked > spent ? locked - spent : 0n;
  // placement only locked the funds, fills debit them, so unlocking is the refund
  if (order.side === 'buy') unlockFlush(state, tx.from, refund);
  else unlockToken(state, tx.from, order.market, refund);
  order.remaining = '0';
  order.status = 'cancelled';
  order.cancelledAt = Date.now();
  recordEffect(state, {
    kind: 'order_cancel',
    orderId: order.id,
    market: order.market,
    from: tx.from,
    refund: str(refund),
    timestamp: Date.now(),
  });
  return { orderId: order.id, status: order.status, refund: str(refund) };
}

/* ------------------------------------------------------------------ *
 * validation + state transition
 * ------------------------------------------------------------------ */

const TOKEN_SYMBOL = /^[A-Z0-9]{2,10}$/;
const RESERVED_SYMBOLS = new Set(['FLUSH', 'FLS', 'USD', 'USDT', 'USDC', 'BTC', 'ETH']);
const MAX_TOKEN_SUPPLY = 1_000_000_000n * NETWORK.unit;

function requireAmount(value, label) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number of smallest units`);
  const amount = big(text);
  if (amount < 0n) throw new Error(`${label} cannot be negative`);
  return amount;
}

function sanitizeText(value, max, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return text;
}

/**
 * Full protocol validation. `reservedNonces` holds the nonces already sitting in
 * the mempool for this sender, so a pending transaction can never be replayed.
 */
export async function validateTransaction(state, tx, reservedNonces = new Set()) {
  if (!tx || typeof tx !== 'object') throw new Error('transaction must be an object');
  if (!TX_TYPES.includes(tx.type)) throw new Error('unsupported transaction type: ' + tx.type);
  if (!isAddress(tx.from)) throw new Error('invalid sender address');
  if (typeof tx.publicKey !== 'string' || typeof tx.signature !== 'string') throw new Error('transaction is missing a public key or signature');
  if (!Number.isInteger(tx.nonce) || tx.nonce < 0) throw new Error('nonce must be a non negative integer');
  if (typeof tx.timestamp !== 'number' || !Number.isFinite(tx.timestamp)) throw new Error('timestamp must be a number');
  if (!tx.payload || typeof tx.payload !== 'object') throw new Error('payload must be an object');

  const fee = big(tx.fee);
  if (fee < NETWORK.minFee) throw new Error(`fee must be at least ${formatAmount(NETWORK.minFee)} ${NETWORK.symbol}`);
  if (fee > NETWORK.maxFee) throw new Error(`fee must be at most ${formatAmount(NETWORK.maxFee)} ${NETWORK.symbol}`);
  if (tx.hash && (await transactionHash(tx)) !== tx.hash) throw new Error('transaction hash does not match its contents');
  if (!(await verifyTransactionSignature(tx))) throw new Error('invalid signature: the sender does not own this address');

  const account = getAccount(state, tx.from, false);
  const accountNonce = account ? account.nonce : 0;
  if (tx.nonce < accountNonce) throw new Error(`nonce ${tx.nonce} is too old, expected at least ${accountNonce}`);
  if (reservedNonces.has(tx.nonce)) throw new Error(`nonce ${tx.nonce} is already pending in the mempool`);
  const available = account ? big(account.flush) - big(account.lockedFlush) : 0n;
  if (available < fee) throw new Error(`insufficient FLUSH to pay the ${formatAmount(fee)} network fee`);

  const payload = tx.payload;
  const symbolOf = (value) => String(value ?? '').toUpperCase().trim();
  const availableToken = (symbol) =>
    account ? big(account.tokens[symbol]) - big(account.lockedTokens[symbol]) : 0n;

  switch (tx.type) {
    case 'transfer': {
      const amount = requireAmount(payload.amount, 'amount');
      if (amount <= 0n) throw new Error('amount must be greater than zero');
      const to = normalizeAddress(payload.to);
      if (!isAddress(to)) throw new Error('invalid recipient address');
      if (to === normalizeAddress(tx.from)) throw new Error('you cannot send to your own address');
      if (available < amount + fee) throw new Error(`insufficient balance: ${formatAmount(available)} ${NETWORK.symbol} available`);
      break;
    }
    case 'token_create': {
      const symbol = symbolOf(payload.symbol);
      if (!TOKEN_SYMBOL.test(symbol)) throw new Error('symbol must be 2-10 letters or digits');
      if (RESERVED_SYMBOLS.has(symbol)) throw new Error(`${symbol} is reserved for the network`);
      if (state.tokens[symbol]) throw new Error(`${symbol} already exists, pick another symbol`);
      sanitizeText(payload.name, 40, 'name');
      const supply = requireAmount(payload.supply, 'supply');
      if (supply <= 0n) throw new Error('supply must be greater than zero');
      if (supply > MAX_TOKEN_SUPPLY) throw new Error(`supply is capped at ${formatAmount(MAX_TOKEN_SUPPLY)}`);
      if (payload.description && String(payload.description).length > 240) throw new Error('description is too long');
      break;
    }
    case 'token_transfer': {
      const symbol = symbolOf(payload.symbol);
      if (!state.tokens[symbol]) throw new Error(`token ${symbol} does not exist`);
      const amount = requireAmount(payload.amount, 'amount');
      if (amount <= 0n) throw new Error('amount must be greater than zero');
      const to = normalizeAddress(payload.to);
      if (!isAddress(to)) throw new Error('invalid recipient address');
      if (to === normalizeAddress(tx.from)) throw new Error('you cannot send to your own address');
      if (availableToken(symbol) < amount) throw new Error(`insufficient ${symbol}: ${formatAmount(availableToken(symbol))} available`);
      break;
    }
    case 'token_mint': {
      const symbol = symbolOf(payload.symbol);
      const token = state.tokens[symbol];
      if (!token) throw new Error(`token ${symbol} does not exist`);
      if (!token.mintable) throw new Error(`${symbol} is not mintable`);
      if (token.creator !== normalizeAddress(tx.from)) throw new Error('only the creator can mint new supply');
      const amount = requireAmount(payload.amount, 'amount');
      if (amount <= 0n) throw new Error('amount must be greater than zero');
      if (big(token.totalSupply) + amount > MAX_TOKEN_SUPPLY) throw new Error('minting would exceed the supply cap');
      break;
    }
    case 'liquidity_add': {
      const symbol = symbolOf(payload.symbol);
      if (!state.tokens[symbol]) throw new Error(`token ${symbol} does not exist`);
      const flushAmount = requireAmount(payload.flushAmount, 'flushAmount');
      const tokenAmount = requireAmount(payload.tokenAmount, 'tokenAmount');
      if (flushAmount <= 0n || tokenAmount <= 0n) throw new Error('both amounts must be greater than zero');
      if (available < flushAmount + fee) throw new Error('insufficient FLUSH for this liquidity');
      if (availableToken(symbol) < tokenAmount) throw new Error(`insufficient ${symbol} for this liquidity`);
      break;
    }
    case 'liquidity_remove': {
      const symbol = symbolOf(payload.symbol);
      if (!state.pools[symbol]) throw new Error(`there is no liquidity pool for ${symbol}`);
      const shares = requireAmount(payload.shares, 'shares');
      if (shares <= 0n) throw new Error('shares must be greater than zero');
      const held = account ? big(account.lp[symbol]) : 0n;
      if (held < shares) throw new Error('you do not hold that many LP shares');
      break;
    }
    case 'swap': {
      const symbol = symbolOf(payload.symbol);
      if (!state.tokens[symbol]) throw new Error(`token ${symbol} does not exist`);
      if (!state.pools[symbol]) throw new Error(`${symbol} has no liquidity pool yet, add liquidity first`);
      const amountIn = requireAmount(payload.amountIn, 'amountIn');
      if (amountIn <= 0n) throw new Error('amountIn must be greater than zero');
      const direction = payload.direction === 'sell' ? 'sell' : 'buy';
      if (direction === 'buy' && available < amountIn + fee) throw new Error('insufficient FLUSH for this swap');
      if (direction === 'sell' && availableToken(symbol) < amountIn) throw new Error(`insufficient ${symbol} for this swap`);
      quoteSwap(state.pools[symbol], direction, amountIn, state.tokens[symbol].decimals); // throws when unfillable
      break;
    }
    case 'order_place': {
      const symbol = symbolOf(payload.symbol);
      if (!state.tokens[symbol]) throw new Error(`token ${symbol} does not exist`);
      const side = payload.side === 'sell' ? 'sell' : 'buy';
      if (payload.type === 'market') {
        const amountIn = requireAmount(payload.amountIn, 'amountIn');
        if (amountIn <= 0n) throw new Error('amountIn must be greater than zero');
        if (side === 'buy' && available < amountIn + fee) throw new Error('insufficient FLUSH for this market buy');
        if (side === 'sell' && availableToken(symbol) < amountIn) throw new Error(`insufficient ${symbol} for this market sell`);
      } else {
        const price = requireAmount(payload.price, 'price');
        const amount = requireAmount(payload.amount, 'amount');
        if (price <= 0n) throw new Error('limit price must be greater than zero');
        if (amount <= 0n) throw new Error('amount must be greater than zero');
        if (orderCost(price, amount) <= 0n) throw new Error('order size is too small');
        if (side === 'buy' && available < orderCost(price, amount) + fee) throw new Error('insufficient FLUSH for this buy order');
        if (side === 'sell' && availableToken(symbol) < amount) throw new Error(`insufficient ${symbol} for this sell order`);
      }
      break;
    }
    case 'order_cancel': {
      const order = state.orders[String(payload.orderId ?? '')];
      if (!order) throw new Error('order not found');
      if (order.owner !== normalizeAddress(tx.from)) throw new Error('you can only cancel your own orders');
      break;
    }
    default:
      throw new Error('unsupported transaction type: ' + tx.type);
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * state transition
 * ------------------------------------------------------------------ */

/** Applies a validated user transaction. Callers must run this on a copy of the
 *  state and only commit when it does not throw (that gives atomic rollback). */
export function applyTransaction(state, tx) {
  const account = getAccount(state, tx.from, true);
  const fee = big(tx.fee ?? 0);
  let result = null;

  switch (tx.type) {
    case 'transfer': {
      const amount = big(tx.payload.amount);
      const to = normalizeAddress(tx.payload.to);
      debit(state, tx.from, amount);
      credit(state, to, amount);
      recordEffect(state, { kind: 'transfer', from: tx.from, to, amount: str(amount), timestamp: Date.now() });
      result = { to, amount: str(amount) };
      break;
    }
    case 'token_create': {
      const symbol = String(tx.payload.symbol).toUpperCase().trim();
      const supply = big(tx.payload.supply);
      state.tokens[symbol] = {
        symbol,
        name: String(tx.payload.name).trim(),
        description: tx.payload.description ? String(tx.payload.description).trim() : '',
        emoji: tx.payload.emoji ? String(tx.payload.emoji).slice(0, 4) : '🪙',
        color: /^#[0-9a-fA-F]{6}$/.test(String(tx.payload.color ?? '')) ? String(tx.payload.color) : '#38e8ff',
        decimals: NETWORK.decimals,
        symbolDecimals: NETWORK.decimals,
        totalSupply: str(supply),
        mintable: tx.payload.mintable === true,
        creator: normalizeAddress(tx.from),
        createdAt: Date.now(),
        txHash: tx.hash ?? '',
      };
      creditToken(state, tx.from, symbol, supply);
      state.meta.tokenCount += 1;
      state.meta.minted = str(big(state.meta.minted) + supply);
      recordEffect(state, { kind: 'token_create', symbol, name: state.tokens[symbol].name, supply: str(supply), creator: normalizeAddress(tx.from), timestamp: Date.now() });
      result = { symbol, supply: str(supply) };
      break;
    }
    case 'token_transfer': {
      const symbol = String(tx.payload.symbol).toUpperCase().trim();
      const amount = big(tx.payload.amount);
      const to = normalizeAddress(tx.payload.to);
      debitToken(state, tx.from, symbol, amount);
      creditToken(state, to, symbol, amount);
      recordEffect(state, { kind: 'token_transfer', symbol, from: tx.from, to, amount: str(amount), timestamp: Date.now() });
      result = { symbol, to, amount: str(amount) };
      break;
    }
    case 'token_mint': {
      const symbol = String(tx.payload.symbol).toUpperCase().trim();
      const amount = big(tx.payload.amount);
      const to = isAddress(tx.payload.to) ? normalizeAddress(tx.payload.to) : normalizeAddress(tx.from);
      const token = state.tokens[symbol];
      token.totalSupply = str(big(token.totalSupply) + amount);
      creditToken(state, to, symbol, amount);
      state.meta.minted = str(big(state.meta.minted) + amount);
      recordEffect(state, { kind: 'token_mint', symbol, to, amount: str(amount), timestamp: Date.now() });
      result = { symbol, to, amount: str(amount) };
      break;
    }
    case 'liquidity_add':
      result = applyLiquidityAdd(state, tx, tx.payload);
      break;
    case 'liquidity_remove':
      result = applyLiquidityRemove(state, tx, tx.payload);
      break;
    case 'swap':
      result = applySwap(state, tx, tx.payload);
      break;
    case 'order_place':
      result = applyOrderPlace(state, tx, tx.payload);
      break;
    case 'order_cancel':
      result = applyOrderCancel(state, tx, tx.payload);
      break;
    default:
      throw new Error('unsupported transaction type: ' + tx.type);
  }

  if (fee > 0n) {
    debit(state, tx.from, fee);
    credit(state, GENESIS_TREASURY, fee);
  }
  account.nonce = Math.max(account.nonce, Number(tx.nonce) + 1);
  state.meta.txCount += 1;
  return result;
}

/** genesis / faucet / reward transactions are created by the protocol itself. */
export function applyProtocolTransaction(state, tx) {
  switch (tx.type) {
    case 'genesis':
      credit(state, tx.to, tx.amount);
      state.meta.minted = str(big(state.meta.minted) + big(tx.amount));
      break;
    case 'faucet':
      debit(state, GENESIS_TREASURY, tx.amount);
      credit(state, tx.to, tx.amount);
      state.faucet[normalizeAddress(tx.to)] = tx.timestamp;
      break;
    case 'reward':
      debit(state, GENESIS_TREASURY, tx.amount);
      credit(state, tx.to, tx.amount);
      break;
    default:
      throw new Error('unknown protocol transaction: ' + tx.type);
  }
  recordEffect(state, { kind: tx.type, to: tx.to, amount: str(tx.amount), timestamp: tx.timestamp });
  return true;
}

export async function createProtocolTransaction({ type, to, amount, note = '' }) {
  const body = { type, from: GENESIS_TREASURY, to: normalizeAddress(to), amount: str(amount), note, timestamp: Date.now() };
  return { ...body, hash: await hashObject(body) };
}

/* ------------------------------------------------------------------ *
 * blocks
 * ------------------------------------------------------------------ */

export const PROTOCOL_TYPES = ['genesis', 'faucet', 'reward'];

export async function merkleRoot(transactions) {
  let layer = transactions.map((tx) => tx.hash ?? '');
  if (!layer.length) return sha256Hex('flushcoin-empty-block');
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(await sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

export function blockHeader(block) {
  return {
    height: block.height,
    prevHash: block.prevHash,
    timestamp: block.timestamp,
    merkleRoot: block.merkleRoot,
    difficulty: block.difficulty,
    nonce: block.nonce,
    producer: block.producer,
  };
}

export async function computeBlockHash(block) {
  return hashObject(blockHeader(block));
}

export function meetsDifficulty(hash, difficulty) {
  if (difficulty <= 0) return true;
  return hash.startsWith('0'.repeat(difficulty));
}

export async function createGenesisBlock() {
  const transaction = await createProtocolTransaction({
    type: 'genesis',
    to: GENESIS_TREASURY,
    amount: NETWORK.treasuryGenesis,
    note: `${NETWORK.nativeName} initial supply`,
  });
  const block = {
    height: 0,
    prevHash: '0'.repeat(64),
    timestamp: Date.now(),
    difficulty: 0,
    nonce: 0,
    producer: GENESIS_NODE,
    transactions: [transaction],
    merkleRoot: '',
    hash: '',
  };
  block.merkleRoot = await merkleRoot(block.transactions);
  block.hash = await computeBlockHash(block);
  return block;
}

/* ------------------------------------------------------------------ *
 * FlushNode — the whole node: mempool, block production, state and queries.
 * The Node backend and the in-browser devnet both drive this class, so both
 * behave identically.
 * ------------------------------------------------------------------ */

export class FlushNode {
  constructor(options = {}) {
    this.storage = options.storage ?? null;
    this.producer = options.producer ?? GENESIS_NODE;
    this.blocks = [];
    this.mempool = [];
    this.rejected = [];
    this.chainState = emptyState();
    this.events = [];
    this.eventId = 0;
    this.listeners = new Set();
    this.lock = Promise.resolve();
    this.startedAt = Date.now();
    this.autoSealTimer = null;
    this.mode = options.mode ?? 'node';
    this.autoSealMs = options.autoSealMs ?? 0;
  }

  static async create(options = {}) {
    const node = new FlushNode(options);
    await node.init();
    return node;
  }

  async init() {
    let stored = null;
    if (this.storage) {
      try {
        stored = await this.storage.load();
      } catch (error) {
        console.warn('[flushcore] could not read stored chain:', error.message);
      }
    }
    if (stored && Array.isArray(stored.blocks) && stored.blocks.length) {
      this.blocks = stored.blocks;
      this.mempool = Array.isArray(stored.mempool) ? stored.mempool : [];
      await this.replay();
    } else {
      this.blocks = [await createGenesisBlock()];
      this.chainState = emptyState();
      for (const tx of this.blocks[0].transactions) applyProtocolTransaction(this.chainState, tx);
      await this.save();
    }
    if (this.autoSealMs > 0) this.startAutoSeal();
    return this;
  }

  /** rebuild the ledger from the chain itself: the chain is the source of truth */
  async replay() {
    const state = emptyState();
    for (const block of this.blocks) {
      for (const tx of block.transactions) {
        if (PROTOCOL_TYPES.includes(tx.type)) applyProtocolTransaction(state, tx);
        else applyTransaction(state, tx);
      }
    }
    this.chainState = state;
    return state;
  }

  get state() {
    return this.chainState;
  }

  get height() {
    return this.blocks.length - 1;
  }

  get lastBlock() {
    return this.blocks[this.blocks.length - 1];
  }

  /** serialise mutating work so two requests can never mine at the same time */
  runExclusive(task) {
    const result = this.lock.then(task, task);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async save() {
    if (!this.storage) return;
    await this.storage.save({ version: 1, chainId: NETWORK.chainId, blocks: this.blocks, mempool: this.mempool, savedAt: Date.now() });
  }

  emit(type, data = {}) {
    const event = { id: ++this.eventId, type, data, timestamp: Date.now() };
    this.events.push(event);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a broken listener must never break the node */
      }
    }
    return event;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEvents(sinceId = 0) {
    return this.events.filter((event) => event.id > sinceId);
  }

  startAutoSeal() {
    if (this.autoSealTimer) return;
    this.autoSealTimer = setInterval(() => {
      if (this.mempool.length) this.sealBlock().catch(() => undefined);
    }, this.autoSealMs);
    if (typeof this.autoSealTimer.unref === 'function') this.autoSealTimer.unref();
  }

  stopAutoSeal() {
    if (this.autoSealTimer) clearInterval(this.autoSealTimer);
    this.autoSealTimer = null;
  }

  reservedNoncesFor(address) {
    const key = normalizeAddress(address);
    return new Set(this.mempool.filter((tx) => normalizeAddress(tx.from) === key).map((tx) => Number(tx.nonce)));
  }

  /** Simulate what the chain would look like after the pending mempool. */
  async simulatePending() {
    const draft = structuredClone(this.chainState);
    const accepted = [];
    for (const tx of this.mempool) {
      try {
        if (PROTOCOL_TYPES.includes(tx.type)) applyProtocolTransaction(draft, tx);
        else {
          await validateTransaction(draft, tx, new Set());
          applyTransaction(draft, tx);
        }
        accepted.push(tx);
      } catch {
        /* the transaction is dropped on seal, ignore it here */
      }
    }
    return { state: draft, accepted };
  }

  /**
   * Validate and queue a signed transaction. Returns the transaction hash.
   * With `seal: true` a block is produced right away so the UI updates instantly.
   */
  async submitTransaction(tx, options = {}) {
    return this.runExclusive(async () => {
      if (!tx || typeof tx !== 'object') throw new Error('transaction must be an object');
      const hash = tx.hash ?? (await transactionHash(tx));
      if (this.mempool.some((pending) => pending.hash === hash)) {
        return { hash, accepted: true, duplicate: true, queued: 0 };
      }
      if (this.mempool.length >= 400) throw new Error('mempool is full, try again in a moment');

      const { state: pendingState } = await this.simulatePending();
      await validateTransaction(pendingState, tx, this.reservedNoncesFor(tx.from));
      applyTransaction(pendingState, tx); // pre-flight: throws before we queue anything

      this.mempool.push(tx);
      this.emit('mempool', { hash, type: tx.type, from: tx.from });
      await this.save();
      const block = options.seal === false ? null : await this.sealLocked();
      return { hash, accepted: true, queued: this.mempool.length, block: block ? block.height : null };
    });
  }

  /** Testnet faucet: pays FLUSH from the treasury with a per address cooldown. */
  async faucet(address, options = {}) {
    return this.runExclusive(async () => {
      const key = normalizeAddress(address);
      if (!isAddress(key)) throw new Error('invalid address');
      const last = Number(this.chainState.faucet[key] ?? 0);
      const wait = last + NETWORK.faucetCooldownMs - Date.now();
      if (wait > 0) throw new Error(`faucet cooldown: try again in ${Math.ceil(wait / 1000)}s`);
      const treasury = getAccount(this.chainState, GENESIS_TREASURY, true);
      if (big(treasury.flush) < NETWORK.faucetAmount) throw new Error('the faucet is empty');
      const tx = await createProtocolTransaction({ type: 'faucet', to: key, amount: NETWORK.faucetAmount, note: 'testnet faucet' });
      await validateFaucet(this.chainState, tx);
      this.mempool.push(tx);
      this.emit('faucet', { address: key, amount: str(NETWORK.faucetAmount) });
      const block = options.seal === false ? null : await this.sealLocked();
      return { hash: tx.hash, address: key, amount: str(NETWORK.faucetAmount), block: block ? block.height : null };
    });
  }

  /** Seal every queued transaction into a new block (real PoW, fast difficulty). */
  async sealBlock() {
    return this.runExclusive(() => this.sealLocked());
  }

  async sealLocked() {
    if (!this.mempool.length) return null;
    const draft = structuredClone(this.chainState);
    const applied = [];
    const failed = [];
    for (const tx of this.mempool) {
      try {
        if (PROTOCOL_TYPES.includes(tx.type)) applyProtocolTransaction(draft, tx);
        else {
          await validateTransaction(draft, tx, new Set());
          applyTransaction(draft, tx);
        }
        applied.push(tx);
      } catch (error) {
        failed.push({ tx, error: error.message });
      }
    }
    if (!applied.length) {
      this.rejected.unshift(...failed.slice(0, 20));
      this.rejected.length = Math.min(this.rejected.length, 50);
      this.mempool = failed.slice(0, 100).map((entry) => entry.tx);
      await this.save();
      return null;
    }

    const treasury = getAccount(draft, GENESIS_TREASURY, true);
    if (big(treasury.flush) >= NETWORK.blockReward) {
      applied.push(await createProtocolTransaction({ type: 'reward', to: this.producer, amount: NETWORK.blockReward, note: 'block reward' }));
    }

    const previous = this.lastBlock;
    const block = {
      height: previous.height + 1,
      prevHash: previous.hash,
      timestamp: Date.now(),
      difficulty: Math.min(NETWORK.difficulty + (applied.length > 25 ? 1 : 0), 5),
      nonce: 0,
      producer: this.producer,
      transactions: applied,
      merkleRoot: await merkleRoot(applied),
      hash: '',
    };

    // proof of work: find a nonce whose block hash has the required leading zeros
    let mined = false;
    for (let nonce = 0; nonce < 3_000_000; nonce++) {
      block.nonce = nonce;
      block.hash = await computeBlockHash(block);
      if (meetsDifficulty(block.hash, block.difficulty)) {
        mined = true;
        break;
      }
    }
    if (!mined) throw new Error('could not find a valid proof of work, try again');

    this.blocks.push(block);
    this.chainState = draft;
    this.mempool = failed.slice(0, 100).map((entry) => entry.tx);
    this.rejected.unshift(...failed.slice(0, 20));
    this.rejected.length = Math.min(this.rejected.length, 50);
    await this.save();
    this.emit('block', {
      height: block.height,
      hash: block.hash,
      transactions: block.transactions.length,
      difficulty: block.difficulty,
      nonce: block.nonce,
    });
    return block;
  }

  /* ------------- queries (same shapes for the server and the browser) ------------- */

  getNetwork() {
    return {
      ...NETWORK,
      unit: undefined,
      blockReward: str(NETWORK.blockReward),
      minFee: str(NETWORK.minFee),
      maxFee: str(NETWORK.maxFee),
      maxSupply: str(NETWORK.maxSupply),
      faucetAmount: str(NETWORK.faucetAmount),
      treasuryGenesis: str(NETWORK.treasuryGenesis),
      treasuryAddress: GENESIS_TREASURY,
      producer: this.producer,
      mode: this.mode,
      height: this.height,
      startedAt: this.startedAt,
    };
  }

  getStats() {
    const state = this.chainState;
    const treasury = getAccount(state, GENESIS_TREASURY, false);
    const circulating = Object.entries(state.accounts)
      .filter(([address]) => address !== GENESIS_TREASURY)
      .reduce((sum, [, account]) => sum + big(account.flush), 0n);
    return {
      network: NETWORK.name,
      chainId: NETWORK.chainId,
      symbol: NETWORK.symbol,
      nativeName: NETWORK.nativeName,
      height: this.height,
      blocks: this.blocks.length,
      transactions: this.blocks.reduce((sum, block) => sum + block.transactions.length, 0),
      pendingTransactions: this.mempool.length,
      difficulty: this.lastBlock.difficulty,
      lastBlock: {
        height: this.lastBlock.height,
        hash: this.lastBlock.hash,
        timestamp: this.lastBlock.timestamp,
        transactions: this.lastBlock.transactions.length,
        nonce: this.lastBlock.nonce,
        difficulty: this.lastBlock.difficulty,
      },
      accounts: Object.keys(state.accounts).length,
      wallets: Object.keys(state.accounts).filter((address) => address !== GENESIS_TREASURY).length,
      tokens: Object.keys(state.tokens).length,
      pools: Object.keys(state.pools).length,
      swaps: state.meta.swapCount,
      trades: state.meta.tradeCount,
      openOrders: Object.values(state.orders).filter((order) => order.status === 'open' || order.status === 'partial').length,
      circulating: str(circulating),
      treasury: str(treasury ? big(treasury.flush) : 0n),
      totalSupply: str(NETWORK.maxSupply),
      minedSupply: state.meta.minted,
      faucetAddresses: Object.keys(state.faucet).length,
      uptimeMs: Date.now() - this.startedAt,
      mode: this.mode,
      effects: state.effects.slice(-25).reverse(),
      rejected: this.rejected.slice(0, 10).map((entry) => ({ hash: entry.tx?.hash ?? '', type: entry.tx?.type ?? '', error: entry.error })),
    };
  }

  getTokens() {
    return this.listTokens();
  }

  listTokens() {
    return Object.keys(this.chainState.tokens)
      .map((symbol) => tokenMarketView(this.chainState, symbol))
      .filter(Boolean);
  }

  getToken(symbol) {
    const upper = String(symbol ?? '').toUpperCase();
    const view = tokenMarketView(this.chainState, upper);
    if (!view) throw new Error(`token ${upper} does not exist`);
    return view;
  }

  getAccount(address) {
    if (!isAddress(address)) throw new Error('invalid address');
    return accountView(this.chainState, address);
  }

  getAccountHistory(address) {
    const key = normalizeAddress(address);
    const entries = [];
    for (const block of this.blocks) {
      for (const tx of block.transactions) {
        const involved =
          normalizeAddress(tx.from) === key ||
          normalizeAddress(tx.to) === key ||
          normalizeAddress(tx.payload?.to) === key;
        if (involved) {
          entries.push({
            hash: tx.hash,
            type: tx.type,
            from: tx.from,
            to: tx.to ?? tx.payload?.to ?? '',
            amount: tx.amount ?? tx.payload?.amount ?? '',
            symbol: tx.payload?.symbol ?? (tx.type === 'transfer' ? NETWORK.symbol : NETWORK.symbol),
            block: block.height,
            timestamp: tx.timestamp,
            fee: tx.fee ?? '0',
            payload: tx.payload ?? null,
          });
        }
      }
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp || b.block - a.block).slice(0, 100);
  }

  quote(symbol, direction, amountIn) {
    const upper = String(symbol ?? '').toUpperCase();
    if (!this.chainState.tokens[upper]) throw new Error(`token ${upper} does not exist`);
    const result = quoteSwap(this.chainState.pools[upper] ?? null, direction === 'sell' ? 'sell' : 'buy', amountIn, NETWORK.decimals);
    return { symbol: upper, ...result, price: str(poolPrice(this.chainState.pools[upper])) };
  }

  getOrderbook(symbol) {
    const upper = String(symbol ?? '').toUpperCase();
    if (!this.chainState.tokens[upper]) throw new Error(`token ${upper} does not exist`);
    return orderBookView(this.chainState, upper);
  }

  getTrades(symbol, limit = 40) {
    const upper = symbol ? String(symbol).toUpperCase() : null;
    return this.chainState.trades.filter((trade) => !upper || trade.market === upper).slice(0, limit);
  }

  getOpenOrders(market) {
    const upper = market ? String(market).toUpperCase() : null;
    return Object.values(this.chainState.orders)
      .filter((order) => (!upper || order.market === upper) && (order.status === 'open' || order.status === 'partial'))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getMarkets() {
    return this.listTokens().map((token) => ({
      symbol: token.symbol,
      name: token.name,
      emoji: token.emoji,
      color: token.color,
      price: token.price,
      changeBps: token.changeBps,
      volume24h: token.volume24h,
      liquidity: token.liquidity,
      holders: token.holders,
      openOrders: token.openOrders,
      totalSupply: token.totalSupply,
    }));
  }

  getBlocks({ limit = 25, offset = 0 } = {}) {
    const ordered = this.blocks.slice().reverse();
    return {
      total: ordered.length,
      height: this.height,
      blocks: ordered
        .slice(offset, offset + limit)
        .map((block) => ({
          height: block.height,
          hash: block.hash,
          prevHash: block.prevHash,
          timestamp: block.timestamp,
          transactions: block.transactions.length,
          difficulty: block.difficulty,
          nonce: block.nonce,
          producer: block.producer,
          merkleRoot: block.merkleRoot,
        })),
    };
  }

  getBlock(id) {
    const block =
      typeof id === 'number' || /^\d+$/.test(String(id))
        ? this.blocks[Number(id)]
        : this.blocks.find((entry) => entry.hash === String(id));
    if (!block) throw new Error('block not found');
    return {
      ...block,
      transactions: block.transactions.map((tx) => ({
        hash: tx.hash,
        type: tx.type,
        from: tx.from,
        to: tx.to ?? tx.payload?.to ?? '',
        amount: tx.amount ?? tx.payload?.amount ?? tx.payload?.amountIn ?? '',
        symbol: tx.payload?.symbol ?? NETWORK.symbol,
        fee: tx.fee ?? '0',
        timestamp: tx.timestamp,
        payload: tx.payload ?? null,
      })),
    };
  }

  getTransaction(hash) {
    for (const block of this.blocks) {
      const tx = block.transactions.find((entry) => entry.hash === String(hash));
      if (tx) {
        return { ...tx, block: block.height, blockHash: block.hash, confirmations: this.height - block.height + 1, pending: false };
      }
    }
    const pending = this.mempool.find((entry) => entry.hash === String(hash));
    if (pending) return { ...pending, block: null, blockHash: '', confirmations: 0, pending: true };
    throw new Error('transaction not found');
  }

  getMempool() {
    return this.mempool.map((tx) => ({
      hash: tx.hash,
      type: tx.type,
      from: tx.from,
      nonce: tx.nonce,
      fee: tx.fee,
      timestamp: tx.timestamp,
      payload: tx.payload ?? null,
    }));
  }

  /**
   * Independently re-verify the whole chain: block hashes, links, merkle roots,
   * proof of work, every signature and a full state replay.
   */
  async verifyChain(options = {}) {
    const errors = [];
    let transactions = 0;
    let signaturesChecked = 0;
    const started = Date.now();
    let previousHash = '0'.repeat(64);

    for (const block of this.blocks) {
      const expectedHash = await computeBlockHash(block);
      if (expectedHash !== block.hash) errors.push(`block ${block.height}: hash mismatch`);
      if (block.prevHash !== previousHash) errors.push(`block ${block.height}: previous hash is not linked`);
      if (!meetsDifficulty(block.hash, block.difficulty)) errors.push(`block ${block.height}: proof of work is not valid`);
      const expectedRoot = await merkleRoot(block.transactions);
      if (expectedRoot !== block.merkleRoot) errors.push(`block ${block.height}: merkle root mismatch`);
      for (const tx of block.transactions) {
        transactions += 1;
        if (PROTOCOL_TYPES.includes(tx.type)) continue;
        if (options.deep === false) continue;
        signaturesChecked += 1;
        if (!(await verifyTransactionSignature(tx))) errors.push(`tx ${tx.hash}: invalid signature`);
      }
      previousHash = block.hash;
    }

    let replayError = null;
    try {
      await this.replay();
    } catch (error) {
      replayError = error.message;
      errors.push('state replay failed: ' + error.message);
    }

    return {
      valid: errors.length === 0,
      blocks: this.blocks.length,
      height: this.height,
      transactions,
      signaturesChecked,
      replayError,
      errors: errors.slice(0, 25),
      checkedAt: Date.now(),
      durationMs: Date.now() - started,
      chainId: NETWORK.chainId,
      stateHash: await hashObject(this.chainState.meta),
    };
  }

  describeTransaction(tx) {
    const symbol = tx.payload?.symbol ? String(tx.payload.symbol).toUpperCase() : NETWORK.symbol;
    switch (tx.type) {
      case 'transfer':
        return `sent ${formatAmount(tx.payload.amount)} ${NETWORK.symbol}`;
      case 'token_create':
        return `minted ${formatAmount(tx.payload.supply)} ${symbol}`;
      case 'token_transfer':
        return `sent ${formatAmount(tx.payload.amount)} ${symbol}`;
      case 'token_mint':
        return `minted ${formatAmount(tx.payload.amount)} ${symbol}`;
      case 'liquidity_add':
        return `added liquidity to ${symbol}`;
      case 'liquidity_remove':
        return `removed liquidity from ${symbol}`;
      case 'swap':
        return `${tx.payload.direction === 'sell' ? 'sold' : 'bought'} ${symbol}`;
      case 'order_place':
        return `${tx.payload.side === 'sell' ? 'sell' : 'buy'} ${tx.payload.type} order on ${symbol}`;
      case 'order_cancel':
        return `cancelled an order on ${symbol}`;
      case 'faucet':
        return 'faucet payout';
      case 'reward':
        return 'block reward';
      case 'genesis':
        return 'genesis supply';
      default:
        return tx.type;
    }
  }
}

/** Protocol rule check for a faucet payout (never trusted from the outside). */
export async function validateFaucet(state, tx) {
  if (tx.type !== 'faucet') throw new Error('not a faucet transaction');
  if (!isAddress(tx.to)) throw new Error('invalid faucet address');
  if (big(tx.amount) !== NETWORK.faucetAmount) throw new Error('invalid faucet amount');
  const treasury = getAccount(state, GENESIS_TREASURY, true);
  if (big(treasury.flush) < big(tx.amount)) throw new Error('the faucet is empty');
  const body = { type: tx.type, from: tx.from, to: tx.to, amount: str(tx.amount), note: tx.note, timestamp: tx.timestamp };
  if ((await hashObject(body)) !== tx.hash) throw new Error('invalid faucet transaction hash');
  return true;
}
