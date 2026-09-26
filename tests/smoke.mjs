import { createFlushServer } from '../server/index.mjs';
import { generateWallet, createTransaction, parseUnits, str, big, NETWORK } from '../shared/flushcore.mjs';

let passed = 0;
let failed = 0;

function check(title, condition, details = '') {
  if (condition) {
    console.log(`  \x1b[32mPASS\x1b[0m  ${title}`);
    passed += 1;
  } else {
    console.error(`  \x1b[31mFAIL\x1b[0m  ${title}${details ? ` -> ${details}` : ''}`);
    failed += 1;
  }
}

async function request(baseUrl, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

console.log('FlushCoin server smoke test — zero-dependency HTTP API');

// Boot server on ephemeral port 0:
const { server, node, port } = await createFlushServer({ port: 0, dbPath: ':memory:' });
await new Promise((resolve) => server.listen(0, resolve));
const actualPort = server.address().port;
const BASE = `http://localhost:${actualPort}`;

try {
  // 1. Network endpoint
  const netRes = await request(BASE, '/api/network');
  check('GET /api/network returns 200', netRes.status === 200 && netRes.json.ok);
  check('Network matches Devnet symbol', netRes.json.data.symbol === NETWORK.symbol);

  // 2. Stats endpoint
  const statsRes = await request(BASE, '/api/stats');
  check('GET /api/stats returns circulating supply', statsRes.status === 200 && statsRes.json.data.totalSupply);

  // 3. Faucet claim
  const alice = await generateWallet();
  const faucetRes = await request(BASE, '/api/faucet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: alice.address }),
  });
  check('POST /api/faucet succeeds', faucetRes.status === 200 && faucetRes.json.ok);

  // 4. Verify account balance updated
  const acctRes = await request(BASE, `/api/account/${alice.address}`);
  check('GET /api/account/:address has 250 FLUSH', acctRes.status === 200 && big(acctRes.json.data.flush) === NETWORK.faucetAmount);

  // 5. Submit signed transaction (token create)
  const txCreate = await createTransaction({
    digitalWallet: alice,
    type: 'token_create',
    payload: {
      symbol: 'MEME',
      name: 'Meme Token',
      supply: str(parseUnits('1000000')),
      description: 'The finest meme',
      emoji: '🚀',
      color: '#ffaa00',
      mintable: true,
    },
    nonce: 0,
    fee: NETWORK.minFee,
  });

  const subRes = await request(BASE, '/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txCreate),
  });
  check('POST /api/submit token_create succeeds', subRes.status === 200 && subRes.json.ok);

  // 6. Verify token appears in tokens list
  const tokensRes = await request(BASE, '/api/tokens');
  check('GET /api/tokens includes created MEME', tokensRes.json.data.some((t) => t.symbol === 'MEME'));

  // 7. Verify chain integrity through server
  const verifyRes = await request(BASE, '/api/verify');
  check('GET /api/verify reports valid chain', verifyRes.status === 200 && verifyRes.json.data.valid === true);

} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
