/**
 * Private-key hygiene for the sponsor (minter) wallet.
 *
 * Why this exists: viem's `privateKeyToAccount` ALWAYS strips the first two
 * characters (`privateKey.slice(2)` — it assumes a `0x` prefix) before
 * handing the rest to @noble/curves, which then requires exactly 64 hex
 * characters. A secret that is anything but `0x` + 64 hex — a bare key, a
 * double `0x0x…`, a trailing newline from a piped `wrangler secret put`, a
 * stray space, a BOM pasted from notepad — therefore explodes at withdrawal
 * time as the cryptic
 * "invalid private key, expected hex or 32 bytes, got string"
 * (thrown by @noble/curves `normPrivateKeyToScalar`).
 *
 * Everything here is defensive: any reasonable representation of the SAME key is
 * reduced to the one canonical form, and when that is impossible we throw a
 * message that says WHAT is wrong (length / prefix / hex-ness) without ever
 * printing the key material itself.
 */
import type { Hex } from 'viem';

/** Safe to log and to return from /api/health — contains NO key material. */
export type PrivateKeyDiagnostics = {
  /** Character length of the raw secret exactly as the Worker received it. */
  length: number;
  /** True when the raw secret starts with `0x` (after BOM/whitespace strip). */
  startsWith0x: boolean;
  /** True when the cleaned value (no whitespace/prefixes) is hex-only. */
  isHex: boolean;
  /** Character length after cleaning — must be 64 for a valid key. */
  cleanedLength: number;
};

/** BOM, surrounding/inner whitespace and every `0x`/`0X` prefix go away. */
function cleanPrivateKey(rawKey: string): string {
  return String(rawKey)
    .replace(/^\uFEFF/, '') // UTF-8 BOM (notepad paste)
    .trim() // trailing \r\n / \n / spaces (piped `wrangler secret put`)
    .replace(/\s+/g, '') // stray internal whitespace (line-wrapped paste)
    .replace(/^(0[xX])+/, ''); // none, one or repeated `0x` / `0X` prefixes
}

/** Diagnostics only — never throws, never leaks the key. */
export function describePrivateKey(rawKey: string): PrivateKeyDiagnostics {
  const cleaned = cleanPrivateKey(rawKey);
  return {
    length: rawKey.length,
    startsWith0x: /^0x/i.test(String(rawKey).replace(/^\uFEFF/, '').trim()),
    isHex: /^[0-9a-fA-F]*$/.test(cleaned),
    cleanedLength: cleaned.length
  };
}

/**
 * Canonical `0x` + 64 lowercase hex chars — the only form viem accepts.
 * Throws a descriptive (key-free) error when the value can never be a valid
 * secp256k1 private key.
 */
export function normalizePrivateKey(rawKey: string, envName = 'MINTER_PRIVATE_KEY'): Hex {
  const cleaned = cleanPrivateKey(rawKey);
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    const d = describePrivateKey(rawKey);
    throw new Error(
      `${envName} is malformed: expected 0x + 64 hex characters (66 chars total), ` +
        `got rawLength=${d.length} startsWith0x=${d.startsWith0x} hexOnly=${d.isHex} cleanedLength=${d.cleanedLength}. ` +
        `Re-set the secret with: npx wrangler secret put ${envName}`
    );
  }
  return `0x${cleaned.toLowerCase()}` as Hex;
}
