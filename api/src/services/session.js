import crypto from 'node:crypto';
import { ethers } from 'ethers';
import config from '../config.js';

/**
 * Wallet-proven sessions.
 *
 * The site never trusts an address sent by the browser: the user must sign a
 * SIWE-style message with their connected wallet (EIP-191 personal_sign). We
 * verify the signature server-side and hand back an HMAC-signed session token.
 *
 * Nonces are single-use and expire after 5 minutes.
 */

const nonces = new Map(); // address(lowercase) -> { nonce, message, expiresAt }

export const DOMAIN = process.env.SITE_DOMAIN || 'fluxcoin.local';

export function issueNonce(address) {
  const checksummed = ethers.getAddress(address);
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + config.session.nonceTtlMs;

  const message = [
    `${DOMAIN} wants you to sign in with your Ethereum account:`,
    checksummed,
    '',
    'Sign this message to prove wallet ownership for FluxCoin withdrawals.',
    'No gas is required and no transaction will be sent.',
    '',
    `URI: ${process.env.SITE_URL || `http://localhost:${config.port}`}`,
    'Version: 1',
    `Chain ID: ${config.chain.chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${new Date(expiresAt).toISOString()}`
  ].join('\n');

  nonces.set(address.toLowerCase(), { nonce, message, expiresAt });
  return { address: checksummed, nonce, message, expiresAt };
}

export function verifySignature({ address, signature }) {
  const key = String(address).toLowerCase();
  const stored = nonces.get(key);
  if (!stored) return { ok: false, error: 'NONCE_NOT_FOUND' };
  if (Date.now() > stored.expiresAt) {
    nonces.delete(key);
    return { ok: false, error: 'NONCE_EXPIRED' };
  }

  let recovered;
  try {
    recovered = ethers.verifyMessage(stored.message, signature);
  } catch {
    return { ok: false, error: 'INVALID_SIGNATURE' };
  }

  if (recovered.toLowerCase() !== key) {
    return { ok: false, error: 'SIGNATURE_ADDRESS_MISMATCH' };
  }

  nonces.delete(key); // single use
  return { ok: true, address: ethers.getAddress(recovered) };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(payload) {
  const secret = config.session.secret || 'fluxcoin-dev-secret-do-not-use-in-production';
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSessionToken(address) {
  const payload = base64url(
    JSON.stringify({
      sub: ethers.getAddress(address),
      exp: Date.now() + config.session.ttlMs,
      iat: Date.now()
    })
  );
  return `${payload}.${hmac(payload)}`;
}

export function readSessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return { address: ethers.getAddress(data.sub), exp: data.exp };
  } catch {
    return null;
  }
}

export function purgeExpiredNonces() {
  const now = Date.now();
  for (const [key, value] of nonces.entries()) {
    if (now > value.expiresAt) nonces.delete(key);
  }
}
