/**
 * Wallet-proven sessions.
 *
 * The Worker never trusts an address sent by the browser for anything
 * privileged: the user signs a SIWE-style message with their connected wallet
 * (EIP-191 personal_sign), the signature is recovered server-side, and the
 * caller receives an HMAC-signed stateless session token. Because the token is
 * verified with `SESSION_SECRET` it survives isolate restarts and works in every
 * Cloudflare region without extra storage.
 */
import { getAddress, isAddress, recoverMessageAddress, type Address } from 'viem';
import type { FluxConfig } from './config.js';
import type { Store } from './store.js';

export type NonceRecord = { nonce: string; message: string; issuedAt: string; expiresAt: number };

const nonceKey = (address: string) => `nonce:${address.toLowerCase()}`;

function randomHex(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utf8ToBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

/** SIWE-shaped message the browser signs with `personal_sign`. */
export function buildSignInMessage({
  config,
  address,
  nonce,
  issuedAt
}: {
  config: FluxConfig;
  address: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    `${config.site.domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to FluxCoin to load your earned balance and withdraw your tokens with 0 gas.',
    'No transaction is sent and no gas is required.',
    '',
    `URI: ${config.site.url}`,
    'Version: 1',
    `Chain ID: ${config.chain.chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${new Date(Date.now() + config.session.nonceTtlMs).toISOString()}`
  ].join('\n');
}

export async function issueNonce({
  store,
  config,
  rawAddress
}: {
  store: Store;
  config: FluxConfig;
  rawAddress: string;
}): Promise<NonceRecord & { address: string }> {
  const address = getAddress(rawAddress as Address);
  const nonce = randomHex(16);
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + config.session.nonceTtlMs;
  const message = buildSignInMessage({ config, address, nonce, issuedAt });

  await store.put(
    nonceKey(address),
    JSON.stringify({ nonce, message, issuedAt, expiresAt }),
    Math.ceil(config.session.nonceTtlMs / 1000)
  );
  return { address, nonce, message, issuedAt, expiresAt };
}

/**
 * Verifies a signature against the nonce this Worker issued (single use). When
 * the client echoes a `message` it must be byte-identical to ours, so a hostile
 * client cannot sign a weaker payload.
 */
export async function verifySignature({
  store,
  rawAddress,
  signature,
  message: providedMessage
}: {
  store: Store;
  rawAddress: string;
  signature: string;
  message?: string;
}): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  if (!rawAddress || !isAddress(rawAddress)) return { ok: false, error: 'INVALID_ADDRESS' };
  if (!signature) return { ok: false, error: 'SIGNATURE_REQUIRED' };

  const key = rawAddress.toLowerCase();
  const raw = await store.get(nonceKey(key));
  if (!raw) return { ok: false, error: 'NONCE_NOT_FOUND' };

  const record = JSON.parse(raw) as NonceRecord;
  if (Date.now() > record.expiresAt) {
    await store.del(nonceKey(key));
    return { ok: false, error: 'NONCE_EXPIRED' };
  }
  if (providedMessage && providedMessage !== record.message) {
    return { ok: false, error: 'MESSAGE_MISMATCH' };
  }

  // The recovered signer must be the address that asked for the nonce.
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: record.message,
      signature: signature as `0x${string}`
    });
  } catch {
    return { ok: false, error: 'INVALID_SIGNATURE' };
  }

  if (recovered.toLowerCase() !== key) return { ok: false, error: 'SIGNATURE_ADDRESS_MISMATCH' };

  await store.del(nonceKey(key));
  return { ok: true, address: getAddress(recovered as Address) };
}

export async function issueSessionToken(config: FluxConfig, address: string): Promise<string> {
  const payload = utf8ToBase64Url(
    JSON.stringify({ sub: getAddress(address as Address), iat: Date.now(), exp: Date.now() + config.session.ttlMs })
  );
  return `${payload}.${await hmac(config.session.secret, payload)}`;
}

export async function readSessionToken(
  config: FluxConfig,
  token: string | null | undefined
): Promise<{ address: string; exp: number } | null> {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  if (!safeEqual(signature, await hmac(config.session.secret, payload))) return null;

  try {
    const data = JSON.parse(base64UrlToUtf8(payload)) as { sub?: string; exp?: number };
    if (!data.sub || !data.exp || Date.now() > data.exp) return null;
    if (!isAddress(data.sub)) return null;
    return { address: getAddress(data.sub as Address), exp: data.exp };
  } catch {
    return null;
  }
}

