/**
 * End-to-end flow test (runs the API in-process, no funds needed).
 *
 *   cd api && npm run test:flow
 *
 * Proves, against the REAL server code:
 *   1. a wallet authenticates by signing the SIWE-style message
 *   2. unsigned requests are rejected
 *   3. earning coins credits the site balance
 *   4. the balance is authoritative - over-withdrawing is rejected server-side
 *   5. a withdrawal debits the balance and produces a tx hash (dry-run in dev)
 *   6. gasless accounting: the user pays 0 gas
 */
import { ethers } from 'ethers';
import { createApp } from '../src/app.js';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, condition, details = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name} ${details}`);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);

  try {
    console.log(`\n== FluxCoin end-to-end flow test (${BASE}) ==\n`);

    const wallet = ethers.Wallet.createRandom();
    console.log(`test wallet: ${wallet.address}\n`);

    // --- 1. wallet authentication ---------------------------------------------
    console.log('1) Wallet authentication');
    const nonce = await api('/api/auth/nonce', { method: 'POST', body: { address: wallet.address } });
    check('nonce issued', nonce.status === 200 && nonce.payload.message.includes(wallet.address));

    const unauthed = await api('/api/balance');
    check('requests without a session are rejected', unauthed.status === 401);

    const signature = await wallet.signMessage(nonce.payload.message);
    const verify = await api('/api/auth/verify', {
      method: 'POST',
      body: { address: wallet.address, signature }
    });
    check('signature verified, session issued', verify.status === 200 && Boolean(verify.payload.token));
    const token = verify.payload.token;

    const wrongSignature = await api('/api/auth/verify', {
      method: 'POST',
      body: { address: ethers.Wallet.createRandom().address, signature }
    });
    check('signature from another wallet is rejected', wrongSignature.status === 401);

    // --- 2. earning coins ----------------------------------------------------
    console.log('\n2) Earning coins (site faucet)');
    const earn = await api('/api/earn', { method: 'POST', token, body: { amount: '2500', source: 'forge' } });
    check('coins credited', earn.status === 200 && earn.payload.site.availableTokens === '2500.0');

    const cooldown = await api('/api/earn', { method: 'POST', token, body: { amount: '10' } });
    check('claim cooldown enforced', cooldown.status === 429 && cooldown.payload.error === 'COOLDOWN_ACTIVE');

    const tooMuchEarn = await api('/api/earn', { method: 'POST', token, body: { amount: '999999999999' } });
    check('per-claim cap enforced', tooMuchEarn.status === 400);

    // --- 3. withdrawal validation ---------------------------------------------
    console.log('\n3) Withdrawal validation (server-side)');
    const overdraw = await api('/api/withdraw', { method: 'POST', token, body: { amount: '5000' } });
    check(
      'cannot withdraw more than the site balance',
      overdraw.status === 400 && overdraw.payload.error === 'INSUFFICIENT_SITE_BALANCE',
      JSON.stringify(overdraw.payload)
    );

    const negative = await api('/api/withdraw', { method: 'POST', token, body: { amount: '-5' } });
    check('negative amounts rejected', negative.status === 400);

    const otherWallet = await api('/api/withdraw', {
      method: 'POST',
      token,
      body: { amount: '10', address: ethers.Wallet.createRandom().address }
    });
    check('withdrawing to another wallet is rejected', otherWallet.status === 403);

    // --- 4. real withdrawal ---------------------------------------------------
    console.log('\n4) Withdrawal (gasless)');
    const withdraw = await api('/api/withdraw', { method: 'POST', token, body: { amount: '1000' } });
    check('withdrawal accepted', withdraw.status === 200 && withdraw.payload.ok === true, JSON.stringify(withdraw.payload));

    if (withdraw.payload.status === 'AWAITING_USER_SIGNATURE') {
      console.log(`   mode ${withdraw.payload.mode}: the user signs typed data next (needs a paymaster key)`);
      check('gasless authorization returned', Boolean(withdraw.payload.authorization?.signature));
    } else {
      check('tx hash produced', Boolean(withdraw.payload.txHash));
      check('user gas cost is zero', withdraw.payload.userGasCost === '0');
      check('gas payer recorded', String(withdraw.payload.gasPaidBy).length > 0);
      console.log(`   mode: ${withdraw.payload.mode} | payer: ${withdraw.payload.gasPaidBy}`);
      console.log(`   tx  : ${withdraw.payload.txHash}`);
    }

    // --- 5. balance bookkeeping ----------------------------------------------
    console.log('\n5) Balance bookkeeping');
    const balance = await api('/api/balance', { token });
    check(
      'available balance debited by exactly the withdrawn amount',
      balance.payload.site.availableTokens === '1500.0',
      `available=${balance.payload.site?.availableTokens}`
    );
    check(
      'withdrawn total tracked',
      balance.payload.site.withdrawnTokens !== '0.0' || withdraw.payload.status === 'AWAITING_USER_SIGNATURE'
    );

    const history = await api('/api/withdraw/history', { token });
    check('withdrawal appears in the audit trail', history.payload.entries.length >= 1);

    const health = await api('/api/health');
    check('health endpoint reports chain status', health.status === 200 && Boolean(health.payload.chain));

    console.log(`\n== result: ${passed} passed, ${failed} failed ==`);
    console.log('(dev runs use ALLOW_DRY_RUN=true, so no real transaction is broadcast)\n');
  } finally {
    server.close();
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('flow test crashed:', error);
  process.exit(1);
});
