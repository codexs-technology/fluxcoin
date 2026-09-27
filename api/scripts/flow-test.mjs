/**
 * End-to-end check of the FluxCoin API.
 *
 *   npm run build && node scripts/flow-test.mjs        # in-process Worker bundle
 *   node scripts/flow-test.mjs --url https://fluxcoin.codexstechnology.workers.dev
 *
 * In-process mode imports `dist/index.js` (the `wrangler deploy --dry-run`
 * bundle) and calls `app.fetch()` with a test environment, so health, CORS
 * preflight, auth (HMAC tokens + SIWE recovery), the ledger, forge and the
 * withdrawal routes are all exercised for real.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(here, '..', 'dist', 'index.js');

const urlArgIndex = process.argv.indexOf('--url');
const REMOTE = urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : null;

const TEST_ENV = {
  CHAIN_ID: '11155111',
  RPC_URL: '',
  TOKEN_ADDRESS: '',
  FAUCET_ADDRESS: '',
  SESSION_SECRET: 'flow-test-secret',
  CORS_ORIGINS: '*',
  SITE_DOMAIN: 'fluxcoin.pages.dev',
  SITE_URL: 'https://fluxcoin.pages.dev',
  GASLESS_MODE: 'dry-run',
  ALLOW_DRY_RUN: 'true',
  EARN_COOLDOWN_SECONDS: '0',
  EARN_MAX_TOKENS: '100000',
  WITHDRAW_MAX_TOKENS: '100000'
};

let app = null;
if (!REMOTE) {
  if (!existsSync(bundlePath)) {
    console.error('Missing api/dist/index.js — run "npm run build" first (wrangler dry-run bundle).');
    process.exit(1);
  }
  app = (await import(pathToFileURL(bundlePath).href)).default;
}

const wallet = privateKeyToAccount(generatePrivateKey());
const walletAddress = wallet.address;
const stranger = privateKeyToAccount(generatePrivateKey()).address;
let token = null;

async function call(method, route, { body, auth = true, headers = {} } = {}) {
  const init = {
    method,
    headers: {
      Origin: 'https://fluxcoin.pages.dev',
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };

  const response = REMOTE
    ? await fetch(`${REMOTE}${route}`, init)
    : await app.fetch(new Request(`https://fluxcoin.test${route}`, init), TEST_ENV, {});

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, payload, headers: response.headers };
}

let failures = 0;
const report = [];
function check(label, condition, detail = '') {
  if (!condition) failures += 1;
  const line = `${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  report.push(line);
  console.log(line);
}

// 1. health ------------------------------------------------------------------
{
  const { status, payload } = await call('GET', '/api/health', { auth: false });
  check('GET /api/health returns 200 + ok:true', status === 200 && payload?.ok === true, `status ${status}`);
  check('health advertises the service name', payload?.service === 'fluxcoin-api', String(payload?.service));
  check('health reports 0 user gas', payload?.gasless?.userGasCost === '0', JSON.stringify(payload?.gasless));
}

// 2. the Worker must not serve the frontend ----------------------------------
{
  const { status, payload } = await call('GET', '/index.html', { auth: false });
  check('non-API route answers a JSON 404 (no SPA fallback)', status === 404 && payload?.ok === false, `status ${status}`);
}

// 3. CORS preflight ----------------------------------------------------------
{
  const { status, headers } = await call('OPTIONS', '/api/forge', { auth: false, body: {} });
  check('OPTIONS preflight returns 204', status === 204, `status ${status}`);
  check('preflight echoes the Origin', headers.get('access-control-allow-origin') === 'https://fluxcoin.pages.dev', String(headers.get('access-control-allow-origin')));
  check('preflight allows the Authorization header', (headers.get('access-control-allow-headers') || '').includes('Authorization'), String(headers.get('access-control-allow-headers')));
}

// 4. auth --------------------------------------------------------------------
{
  const anonymous = await call('GET', '/api/balance', { auth: false });
  check('protected route rejects an anonymous caller', anonymous.status === 401, `status ${anonymous.status}`);

  const malformed = await call('POST', '/api/auth', { body: { address: 'not-an-address' }, auth: false });
  check('auth rejects a malformed address', malformed.status === 400, `status ${malformed.status}`);

  const signed = await call('POST', '/api/auth', { body: { address: walletAddress }, auth: false });
  check('POST /api/auth returns ok + address + token', signed.status === 200 && signed.payload?.ok === true && Boolean(signed.payload?.token), String(signed.payload?.error || ''));
  token = signed.payload?.token || null;
  check('auth echoes the connected address', String(signed.payload?.address).toLowerCase() === walletAddress.toLowerCase(), String(signed.payload?.address));
}

// 5. SIWE signature flow -----------------------------------------------------
{
  const nonce = await call('POST', '/api/auth/nonce', { body: { address: walletAddress }, auth: false });
  check('POST /api/auth/nonce returns a message to sign', nonce.status === 200 && Boolean(nonce.payload?.message), `status ${nonce.status}`);

  const signature = await wallet.signMessage({ message: nonce.payload.message });
  const tampered = await call('POST', '/api/auth/verify', {
    body: { address: walletAddress, message: `${nonce.payload.message}\nsteal everything`, signature },
    auth: false
  });
  check('auth/verify refuses a tampered message', tampered.status === 401, `status ${tampered.status}`);

  const fresh = await call('POST', '/api/auth/nonce', { body: { address: walletAddress }, auth: false });
  const goodSignature = await wallet.signMessage({ message: fresh.payload.message });
  const verified = await call('POST', '/api/auth/verify', {
    body: { address: walletAddress, message: fresh.payload.message, signature: goodSignature },
    auth: false
  });
  check('auth/verify accepts a real signature', verified.status === 200 && verified.payload?.signatureVerified === true, `status ${verified.status}`);

  const replay = await call('POST', '/api/auth/verify', {
    body: { address: walletAddress, message: fresh.payload.message, signature: goodSignature },
    auth: false
  });
  check('the nonce is single use (replay rejected)', replay.status === 401, `status ${replay.status}`);
}

// 6. balance + forge ---------------------------------------------------------
{
  const before = await call('GET', '/api/balance');
  check('GET /api/balance starts at 0', before.status === 200 && before.payload?.site?.availableTokens === '0', String(before.payload?.site?.availableTokens));

  const mismatch = await call('GET', `/api/balance/${stranger}`);
  check('balance of another wallet is refused', mismatch.status === 403, `status ${mismatch.status}`);

  const foreign = await call('POST', '/api/forge', { body: { address: stranger, quantity: '10' } });
  check('forge cannot credit a foreign address', foreign.status === 403, `status ${foreign.status}`);

  const huge = await call('POST', '/api/forge', { body: { quantity: '999999' } });
  check('forge enforces the per-claim maximum', huge.status === 400 && huge.payload?.error === 'ABOVE_MAXIMUM', String(huge.payload?.error));

  const credited = await call('POST', '/api/forge', { body: { quantity: '1000' } });
  check('POST /api/forge credits the site balance', credited.status === 200 && credited.payload?.site?.availableTokens === '1000', JSON.stringify(credited.payload?.site || credited.payload));

  const alias = await call('POST', '/api/earn', { body: { amount: '500' } });
  check('POST /api/earn alias credits too', alias.status === 200 && alias.payload?.site?.availableTokens === '1500', String(alias.payload?.site?.availableTokens));

  const history = await call('GET', '/api/earn/history');
  check('GET /api/earn/history lists both credits', history.status === 200 && history.payload?.entries?.length === 2, `entries ${history.payload?.entries?.length}`);
}

// 7. withdrawals -------------------------------------------------------------
{
  const config = await call('GET', '/api/withdraw/config', { auth: false });
  check('GET /api/withdraw/config advertises 0 user gas', config.status === 200 && config.payload?.userGasCost === '0', `status ${config.status}`);

  const tooMuch = await call('POST', '/api/withdraw', { body: { amount: '99999' } });
  check('withdraw above the earned balance is refused', tooMuch.status === 400 && tooMuch.payload?.error === 'INSUFFICIENT_SITE_BALANCE', String(tooMuch.payload?.error));

  const badAmount = await call('POST', '/api/withdraw', { body: { amount: 'abc' } });
  check('withdraw rejects a non-numeric amount', badAmount.status === 400, `status ${badAmount.status}`);

  const foreign = await call('POST', '/api/withdraw', { body: { address: stranger, amount: '1' } });
  check('withdraw cannot target a foreign address', foreign.status === 403, `status ${foreign.status}`);

  const withdrawn = await call('POST', '/api/withdraw', { body: { amount: '400' } });
  check('withdraw settles with 0 user gas', withdrawn.status === 200 && withdrawn.payload?.userGasCost === '0', JSON.stringify(withdrawn.payload || {}).slice(0, 160));
  check('withdraw reports its reservation + mode', Boolean(withdrawn.payload?.reservationId) && Boolean(withdrawn.payload?.mode), `${withdrawn.payload?.reservationId} / ${withdrawn.payload?.mode}`);

  const after = await call('GET', '/api/balance');
  check('balance drops by exactly the withdrawn amount', after.payload?.site?.availableTokens === '1100', String(after.payload?.site?.availableTokens));
  check('withdrawn amount is booked', after.payload?.site?.withdrawnTokens === '400', String(after.payload?.site?.withdrawnTokens));

  const withdrawals = await call('GET', '/api/withdraw/history');
  check('GET /api/withdraw/history returns the entry', withdrawals.payload?.entries?.length === 1, `entries ${withdrawals.payload?.entries?.length}`);

  const unknownHash = await call('GET', `/api/withdraw/status/0x${'0'.repeat(64)}`, { auth: false });
  check('unknown UserOperation hash answers 404', unknownHash.status === 404, `status ${unknownHash.status}`);

  const badHash = await call('GET', '/api/withdraw/status/0x1234', { auth: false });
  check('malformed UserOperation hash answers 400', badHash.status === 400, `status ${badHash.status}`);
}

const summary = `${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${REMOTE ? `against ${REMOTE}` : 'in-process Worker bundle'})`;
report.push('', summary);
console.log(`\n${summary}`);

const reportPath = path.join(here, '..', 'dist', 'flow-test-report.txt');
writeFileSync(reportPath, `${report.join('\n')}\n`);
console.log(`report written to ${reportPath}`);

process.exit(failures === 0 ? 0 : 1);


