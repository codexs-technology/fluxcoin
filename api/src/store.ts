/**
 * Balance ledger + key/value store for the Worker.
 *
 * Why a ledger at all: the faucet credits coins off-chain (instant, 0 gas) and
 * only a withdrawal moves real FLUX. The mint always originates server-side
 * after this book has been validated, so a user can never withdraw more than
 * they earned.
 *
 * Storage is Cloudflare KV when `FLUXCOIN_KV` is bound, and an in-isolate Map
 * otherwise, so the Worker boots (and answers /api/health) before the namespace
 * exists. Amounts are always 18-decimal **wei strings** — never floats.
 */
import { weiToTokens } from './config.js';

export type Store = {
  kind: 'kv' | 'memory';
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
};

type MemoryRow = { value: string; expiresAt: number };
const memory = new Map<string, MemoryRow>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, row] of memory.entries()) {
    if (row.expiresAt && row.expiresAt <= now) memory.delete(key);
  }
}

export function createStore(env: Record<string, unknown>): Store {
  const kv = env.FLUXCOIN_KV as {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  } | undefined;

  if (!kv) {
    return {
      kind: 'memory',
      async get(key) {
        const row = memory.get(key);
        if (!row) return null;
        if (row.expiresAt && row.expiresAt <= Date.now()) {
          memory.delete(key);
          return null;
        }
        return row.value;
      },
      async put(key, value, ttlSeconds) {
        if (memory.size > 5000) pruneMemory();
        memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
      },
      async del(key) {
        memory.delete(key);
      }
    };
  }

  return {
    kind: 'kv',
    async get(key) {
      return kv.get(key);
    },
    async put(key, value, ttlSeconds) {
      // KV rejects expirationTtl below 60s — clamp instead of throwing.
      const ttl = ttlSeconds ? Math.max(60, Math.ceil(ttlSeconds)) : undefined;
      await kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
    },
    async del(key) {
      await kv.delete(key);
    }
  };
}

// --- accounts ----------------------------------------------------------------

export type Account = {
  address: string;
  earned: string;
  withdrawn: string;
  available: string;
  reserved: string;
  earnDay: string;
  earnedToday: string;
  lastEarnAt: number;
  lastWithdrawAt: number;
};

export type LedgerEntry = {
  id: string;
  type: 'earn' | 'withdraw';
  address: string;
  amount: string;
  status: string;
  source?: string;
  method?: string | null;
  txHash?: string | null;
  userOpHash?: string | null;
  createdAt: string;
  settledAt?: string;
  reason?: string;
  payer?: string;
};

const accountKey = (address: string) => `account:${address.toLowerCase()}`;
const entriesKey = (address: string) => `entries:${address.toLowerCase()}`;
const entryKey = (id: string) => `entry:${id}`;
const MAX_ENTRIES_PER_USER = 100;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyAccount(address: string): Account {
  return {
    address,
    earned: '0',
    withdrawn: '0',
    available: '0',
    reserved: '0',
    earnDay: todayKey(),
    earnedToday: '0',
    lastEarnAt: 0,
    lastWithdrawAt: 0
  };
}

/** Reads an account, rolling the daily earn counter over lazily. */
export async function getAccount(store: Store, address: string): Promise<Account> {
  const raw = await store.get(accountKey(address));
  const account: Account = raw ? { ...emptyAccount(address), ...JSON.parse(raw) } : emptyAccount(address);
  if (account.earnDay !== todayKey()) {
    account.earnDay = todayKey();
    account.earnedToday = '0';
    await saveAccount(store, account);
  }
  return account;
}

export async function saveAccount(store: Store, account: Account): Promise<void> {
  await store.put(accountKey(account.address), JSON.stringify(account));
}

export async function listEntries(store: Store, address: string, limit = 25): Promise<LedgerEntry[]> {
  const raw = await store.get(entriesKey(address));
  if (!raw) return [];
  const entries: LedgerEntry[] = JSON.parse(raw);
  return entries.slice(0, limit);
}

async function pushEntry(store: Store, entry: LedgerEntry): Promise<void> {
  const entries = await listEntries(store, entry.address, MAX_ENTRIES_PER_USER);
  entries.unshift(entry);
  await store.put(entriesKey(entry.address), JSON.stringify(entries.slice(0, MAX_ENTRIES_PER_USER)));
  await store.put(entryKey(entry.id), JSON.stringify(entry), 60 * 60 * 24 * 30);
}

export async function getEntry(store: Store, id: string): Promise<LedgerEntry | null> {
  const raw = await store.get(entryKey(id));
  return raw ? (JSON.parse(raw) as LedgerEntry) : null;
}

export function serializeAccount(account: Account) {
  return {
    address: account.address,
    availableTokens: weiToTokens(account.available),
    reservedTokens: weiToTokens(account.reserved),
    earnedTokens: weiToTokens(account.earned),
    withdrawnTokens: weiToTokens(account.withdrawn),
    earnedTodayTokens: weiToTokens(account.earnedToday),
    lastEarnAt: account.lastEarnAt || null,
    lastWithdrawAt: account.lastWithdrawAt || null
  };
}

// --- mutations ---------------------------------------------------------------

function randomId(prefix: string): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `${prefix}-${suffix}`;
}

/** Credits earned coins (the off-chain "generate" action). */
export async function creditEarn({
  store,
  address,
  amountWei,
  source = 'forge'
}: {
  store: Store;
  address: string;
  amountWei: bigint;
  source?: string;
}): Promise<{ account: Account; entry: LedgerEntry }> {
  const account = await getAccount(store, address);

  account.earned = (BigInt(account.earned) + amountWei).toString();
  account.available = (BigInt(account.available) + amountWei).toString();
  account.earnedToday = (BigInt(account.earnedToday) + amountWei).toString();
  account.lastEarnAt = Date.now();

  const entry: LedgerEntry = {
    id: randomId('ERN'),
    type: 'earn',
    address,
    amount: amountWei.toString(),
    source,
    status: 'CREDITED',
    createdAt: new Date().toISOString(),
    method: null,
    txHash: null
  };

  await saveAccount(store, account);
  await pushEntry(store, entry);
  return { account, entry };
}

/**
 * Reserves funds for a withdrawal so two concurrent requests cannot spend the
 * same coins twice: the amount moves available -> reserved before anything is
 * broadcast.
 */
export async function reserveWithdrawal({
  store,
  address,
  amountWei
}: {
  store: Store;
  address: string;
  amountWei: bigint;
}): Promise<{
  ok: boolean;
  error?: string;
  available?: string;
  reservationId?: string;
  account?: Account;
  entry?: LedgerEntry;
}> {
  const account = await getAccount(store, address);
  const available = BigInt(account.available);

  if (amountWei <= 0n) return { ok: false, error: 'AMOUNT_NOT_POSITIVE' };
  if (amountWei > available) {
    return { ok: false, error: 'INSUFFICIENT_SITE_BALANCE', available: available.toString() };
  }

  account.available = (available - amountWei).toString();
  account.reserved = (BigInt(account.reserved) + amountWei).toString();

  const reservationId = randomId('WDR');
  const entry: LedgerEntry = {
    id: reservationId,
    type: 'withdraw',
    address,
    amount: amountWei.toString(),
    status: 'PENDING',
    method: null,
    txHash: null,
    createdAt: new Date().toISOString()
  };

  await saveAccount(store, account);
  await pushEntry(store, entry);
  return { ok: true, reservationId, account, entry };
}

async function patchEntry(store: Store, entry: LedgerEntry, patch: Partial<LedgerEntry>): Promise<LedgerEntry> {
  const merged = { ...entry, ...patch };
  const entries = await listEntries(store, entry.address, MAX_ENTRIES_PER_USER);
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) entries[index] = merged;
  else entries.unshift(merged);
  await store.put(entriesKey(entry.address), JSON.stringify(entries.slice(0, MAX_ENTRIES_PER_USER)));
  await store.put(entryKey(entry.id), JSON.stringify(merged), 60 * 60 * 24 * 30);
  return merged;
}

/** Marks a reservation as settled and books it as withdrawn. */
export async function settleWithdrawal({
  store,
  reservationId,
  txHash,
  userOpHash,
  method,
  payer,
  simulated = false
}: {
  store: Store;
  reservationId: string;
  txHash: string | null;
  userOpHash?: string | null;
  method: string;
  payer: string;
  simulated?: boolean;
}): Promise<{ entry: LedgerEntry; account: Account } | null> {
  const entry = await getEntry(store, reservationId);
  if (!entry) return null;

  const amount = BigInt(entry.amount);
  const account = await getAccount(store, entry.address);
  account.reserved = (BigInt(account.reserved) - amount).toString();
  account.withdrawn = (BigInt(account.withdrawn) + amount).toString();
  account.lastWithdrawAt = Date.now();

  const settled = await patchEntry(store, entry, {
    status: simulated ? 'SIMULATED' : 'CONFIRMED',
    txHash: txHash || null,
    userOpHash: userOpHash || null,
    method,
    payer,
    settledAt: new Date().toISOString()
  });

  await saveAccount(store, account);
  return { entry: settled, account };
}

/** Rolls a failed reservation back into the user's available balance. */
export async function refundWithdrawal({
  store,
  reservationId,
  reason
}: {
  store: Store;
  reservationId: string;
  reason: string;
}): Promise<{ entry: LedgerEntry; account: Account } | null> {
  const entry = await getEntry(store, reservationId);
  if (!entry) return null;

  const amount = BigInt(entry.amount);
  const account = await getAccount(store, entry.address);
  account.reserved = (BigInt(account.reserved) - amount).toString();
  account.available = (BigInt(account.available) + amount).toString();

  const failed = await patchEntry(store, entry, {
    status: 'FAILED',
    reason,
    settledAt: new Date().toISOString()
  });

  await saveAccount(store, account);
  return { entry: failed, account };
}

/**
 * Sliding-window rate limit: KV-backed when a namespace is bound (best effort —
 * KV is eventually consistent, so this throttles abuse rather than being a hard
 * counter) and in-isolate memory otherwise.
 */
export async function rateLimit({
  store,
  scope,
  identity,
  windowMs = 60_000,
  max = 30
}: {
  store: Store;
  scope: string;
  identity: string;
  windowMs?: number;
  max?: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const key = `rl:${scope}:${identity}`;
  const now = Date.now();
  const windowSeconds = Math.max(60, Math.ceil(windowMs / 1000));
  const raw = await store.get(key);
  const hits: number[] = raw ? JSON.parse(raw).filter((at: number) => now - at < windowMs) : [];

  if (hits.length >= max) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }

  hits.push(now);
  await store.put(key, JSON.stringify(hits), windowSeconds);
  return { ok: true };
}

