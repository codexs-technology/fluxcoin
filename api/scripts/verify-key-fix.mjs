/**
 * Regression check for the MINTER_PRIVATE_KEY normalization (api/src/keys.ts).
 * Proves: (1) the old normalizeKey produced the production error
 * "invalid private key, expected hex or 32 bytes, got string" on dirty
 * secrets, and (2) the shared normalizer fixes every dirty-but-valid
 * representation and derives the SAME wallet address, while giving a clear
 * error for truly malformed secrets. Never prints key material.
 * Run from api/:  node scripts/verify-key-fix.mjs
 */
import { normalizePrivateKey, describePrivateKey } from '../src/keys.ts';
import { privateKeyToAccount } from 'viem/accounts';

const CLEAN = '0x' + 'a'.repeat(63) + '1'; // canonical 0x + 64 hex
const bare = 'a'.repeat(63) + '1';

/** The OLD (buggy) normalization that was in chain.ts / paymaster.ts. */
const oldNormalizeKey = (rawKey) => (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`);

const expected = privateKeyToAccount(oldNormalizeKey(CLEAN)).address;

const validVariants = {
  'clean 0x+64hex': CLEAN,
  'bare 64 hex (no 0x)': bare,
  'trailing \\n': CLEAN + '\n',
  'trailing \\r\\n (Windows echo | wrangler)': CLEAN + '\r\n',
  'trailing space': CLEAN + ' ',
  'leading space': ' ' + CLEAN,
  'double 0x': '0x' + CLEAN,
  '0X prefix': '0X' + bare,
  'BOM + 0x (notepad)': '\uFEFF' + CLEAN,
  'internal newline (line-wrapped paste)': '0x' + 'a'.repeat(32) + '\n' + 'a'.repeat(31) + '1',
  'uppercase hex (same key)': '0x' + 'A'.repeat(63) + '1'
};

let pass = 0;
let fail = 0;

for (const [name, raw] of Object.entries(validVariants)) {
  try {
    const addr = privateKeyToAccount(normalizePrivateKey(raw)).address;
    const ok = addr === expected;
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [new code] ${name} -> ${addr}`);
  } catch (e) {
    fail++;
    console.log(`FAIL [new code] ${name} -> threw: ${e.message}`);
  }
  try {
    privateKeyToAccount(oldNormalizeKey(raw));
    console.log(`       [old code] ${name} -> was already fine`);
  } catch (e) {
    console.log(`       [old code] ${name} -> "${e.message}"`);
  }
}

const invalidVariants = {
  '63 hex chars (miscounted)': '0x' + 'a'.repeat(62) + '1',
  'quotes around key': `"${CLEAN}"`,
  'non-hex char g': '0x' + 'g'.repeat(64)
};
for (const [name, raw] of Object.entries(invalidVariants)) {
  try {
    normalizePrivateKey(raw);
    fail++;
    console.log(`FAIL [invalid accepted!] ${name}`);
  } catch (e) {
    pass++;
    console.log(`PASS [clear error] ${name} -> "${e.message}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log('diagnostics(clean):        ', JSON.stringify(describePrivateKey(CLEAN)));
console.log('diagnostics(dirty \\r\\n):   ', JSON.stringify(describePrivateKey(CLEAN + '\r\n')));
console.log('diagnostics(quotes):        ', JSON.stringify(describePrivateKey(`"${CLEAN}"`)));
if (fail > 0) process.exit(1);
