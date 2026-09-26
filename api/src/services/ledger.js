import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from '../config.js';

/**
 * Site-balance ledger (the authoritative "earned coins" book).
 *
 * Why a ledger at all?
 *   The faucet website lets users generate/earn coins off-chain (instant, no gas).
 *   Only when the user WITHDRAWS do we mint real ERC-20 FLUX on-chain. The mint
 *   always originates from the backend after it validated this book, so a user
 *   can never mint more than what they earned.
 *
 * Storage: one JSON document, atomic writes + serialised write queue.
 * All amounts are 18-decimal *wei strings* so nothing is ever stored as a float.
 */

const EMPTY_DB = () => ({ version: 1, users: {}, entries: [], nonces: {} });

let db = EMPTY_DB();
let writeQueue = Promise.resolve();

const filePath = () => path.join(config.dataDir, 'ledger.json');

function ensureDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

function persist() {
  ensureDir();
  const tmp = `${filePath()}.${process.pid}.tmp`;
  const snapshot = JSON.stringify(db, null, 2);
  // Serialised writes: two snapshots can never interleave.
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(tmp, snapshot);
    fs.renameSync(tmp, filePath());
  });
  return writeQueue;
}

export function loadLedger() {
  ensureDir();
  try {
    if (fs.existsSync(filePath())) {
      db = { ...EMPTY_DB(), ...JSON.parse(fs.readFileSync(filePath(), 'utf8')) };
    } else {
      db = EMPTY_DB();
      persist();
    }
  } catch (error) {
    console.error('[ledger] failed to load, starting empty:', error.message);
    db = EMPTY_DB();
  }
  return db;
}

export function saveLedger() {
  return persist();
}

const ZERO = '0';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function userRecord(address) {
  const key = address.toLowerCase();
  if (!db.users[key]) {
    db.users[key] = {
      address,
      earned: ZERO,
      withdrawn: ZERO,
      available: ZERO,
      reserved: ZERO,
      earnDay: todayKey(),
      earnedToday: ZERO,
      lastEarnAt: 0,
      lastWithdrawAt: 0
    };
  }
  return db.users[key];
}

export function getAccount(address) {
  const record = userRecord(address);
  // Daily counters roll over lazily.
  if (record.earnDay !== todayKey()) {
    record.earnDay = todayKey();
    record.earnedToday = ZERO;
  }
  return { ...record };
}

export function listEntries(address, limit = 25) {
  const key = address?.toLowerCase();
  return db.entries.filter((entry) => !key || entry.address.toLowerCase() === key).slice(0, limit);
}

/**
 * Credits earned coins (the off-chain faucet "generate" action).
 * @returns {{account: object, entry: object}}
 */
export function creditEarn({ address, amountWei, source = 'forge', meta = {} }) {
  const record = userRecord(address);
  if (record.earnDay !== todayKey()) {
    record.earnDay = todayKey();
    record.earnedToday = ZERO;
  }

  const amount = BigInt(amountWei);
  record.earned = (BigInt(record.earned) + amount).toString();
  record.available = (BigInt(record.available) + amount).toString();
  record.earnedToday = (BigInt(record.earnedToday) + amount).toString();
  record.lastEarnAt = Date.now();

  const entry = {
    id: `ERN-${randomUUID().slice(0, 8).toUpperCase()}`,
    type: 'earn',
    address,
    amount: amount.toString(),
    source,
    status: 'CREDITED',
    createdAt: new Date().toISOString(),
    meta
  };
  db.entries.unshift(entry);
  persist();

  return { account: getAccount(address), entry };
}

/**
 * Reserves funds for a withdrawal so two concurrent requests can never
 * double-spend the same balance.
 * @returns {{ok: boolean, error?: string, reservationId?: string, entry?: object, account?: object}}
 */
export function reserveWithdrawal({ address, amountWei }) {
  const record = userRecord(address);
  const amount = BigInt(amountWei);
  const available = BigInt(record.available);

  if (amount <= 0n) return { ok: false, error: 'AMOUNT_NOT_POSITIVE' };
  if (amount > available) {
    return { ok: false, error: 'INSUFFICIENT_SITE_BALANCE', available: available.toString() };
  }

  record.available = (available - amount).toString();
  record.reserved = (BigInt(record.reserved) + amount).toString();

  const reservationId = `WDR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const entry = {
    id: reservationId,
    type: 'withdraw',
    address,
    amount: amount.toString(),
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    txHash: null,
    method: null
  };
  db.entries.unshift(entry);
  persist();

  return { ok: true, reservationId, entry, account: getAccount(address) };
}

/** Marks a reservation as mined and books it as withdrawn. */
export function settleWithdrawal({ reservationId, txHash, method, payer }) {
  const record = db.entries.find((entry) => entry.id === reservationId);
  if (!record) return null;

  const amount = BigInt(record.amount);
  const user = userRecord(record.address);
  user.reserved = (BigInt(user.reserved) - amount).toString();
  user.withdrawn = (BigInt(user.withdrawn) + amount).toString();
  user.lastWithdrawAt = Date.now();

  record.status = 'CONFIRMED';
  record.txHash = txHash || null;
  record.method = method || null;
  record.payer = payer || null;
  record.settledAt = new Date().toISOString();
  persist();

  return { entry: record, account: getAccount(record.address) };
}

/** Rolls a failed reservation back into the user's available balance. */
export function refundWithdrawal({ reservationId, reason }) {
  const record = db.entries.find((entry) => entry.id === reservationId);
  if (!record) return null;

  const amount = BigInt(record.amount);
  const user = userRecord(record.address);
  user.reserved = (BigInt(user.reserved) - amount).toString();
  user.available = (BigInt(user.available) + amount).toString();

  record.status = 'FAILED';
  record.reason = reason || 'execution-failed';
  record.settledAt = new Date().toISOString();
  persist();

  return { entry: record, account: getAccount(record.address) };
}

/** Monotonic per-user nonce consumed by FluxFaucet.claim (replay protection). */
export function nextNonce(address) {
  const key = address.toLowerCase();
  const next = Number(db.nonces[key] || 0) + 1;
  db.nonces[key] = next;
  persist();
  return next;
}

/** Lightweight health/metrics summary. */
export function stats() {
  return {
    users: Object.keys(db.users).length,
    entries: db.entries.length,
    pending: db.entries.filter((entry) => entry.status === 'PENDING').length
  };
}
