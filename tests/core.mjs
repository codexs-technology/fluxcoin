/**
 * Core engine test — drives the whole FlushChain state machine without HTTP.
 * Usage: node tests/core.mjs
 */
import {
  FlushNode,
  NETWORK,
  GENESIS_TREASURY,
  createTransaction,
  generateWallet,
  big,
  str,
  parseUnits,
  formatAmount,
} from '../shared/flushcore.mjs';

let passed = 0;
let failed = 0;
const results = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    results.push(`  PASS  ${label}`);
  } else {
    failed += 1;
    results.push(`  FAIL  ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

function expectThrow(label, promise) {
  return promise.then(
    () => check(label, false, 'expected an error but it succeeded'),
    (error) => check(label, true, error.message),
  );
}

const F = (value) => parseUnits(value); // whole FLUSH -> smallest units
const sign = (wallet, type, payload, nonce, fee = NETWORK.minFee) =>
  createTransaction({ digitalWallet: wallet, type, payload, nonce, fee });

async function main() {
  console.log(`\nFlushChain core test — ${NETWORK.name} (${NETWORK.chainId})\n`);

  const node = await FlushNode.create({ mode: 'test' });
  const alice = await generateWallet();
  const bob = await generateWallet();
  const carol = await generateWallet();

  check('genesis block sealed with a real hash', node.height === 0 && node.lastBlock.hash.length === 64);
  check('treasury holds the entire supply at genesis', big(node.getAccount(GENESIS_TREASURY).flush) === NETWORK.maxSupply);

  /* ------------------------------------------------ faucet */
  const faucet = await node.faucet(alice.address);
  check('faucet pays 250 FLUSH', big(node.getAccount(alice.address).flush) === NETWORK.faucetAmount, str(node.getAccount(alice.address).flush));
  check('faucet payout is mined into a block', faucet.block === 1);
  await expectThrow('faucet cooldown blocks a second claim', node.faucet(alice.address));
  await node.faucet(bob.address);
  await node.faucet(carol.address);

  /* --------------------------------------------- transfers */
  const transfer = await sign(alice, 'transfer', { to: bob.address, amount: str(F('100')) }, 0);
  await node.submitTransaction(transfer);
  check('coin transfer credits the recipient', big(node.getAccount(bob.address).flush) === NETWORK.faucetAmount + F('100'), str(node.getAccount(bob.address).flush));
  check('coin transfer charges the network fee', big(node.getAccount(alice.address).flush) === NETWORK.faucetAmount - F('100') - NETWORK.minFee);
  await expectThrow('replaying the same transaction is rejected', node.submitTransaction(transfer));

  const forged = await sign(alice, 'transfer', { to: carol.address, amount: str(F('1')) }, 1);
  forged.from = bob.address; // pretend to be bob
  await expectThrow('a forged sender address is rejected', node.submitTransaction(forged));
  await expectThrow('spending more than the balance is rejected', sign(alice, 'transfer', { to: carol.address, amount: str(F('10000')) }, 2).then((tx) => node.submitTransaction(tx)));
  await expectThrow('a fee below the minimum is rejected', sign(alice, 'transfer', { to: carol.address, amount: str(F('1')) }, 2, 1n).then((tx) => node.submitTransaction(tx)));

  /* -------------------------------------------- token create */
  await node.submitTransaction(
    await sign(alice, 'token_create', {
      symbol: 'TESTX',
      name: 'Flush Test Token',
      supply: str(parseUnits('1000000')),
      description: 'created by the core test',
      emoji: '🧪',
      color: '#38e8ff',
      mintable: true,
    }, 2),
  );
  check('new token appears in the token list', node.getToken('TESTX').symbol === 'TESTX');
  check('creator holds the whole token supply', big(node.getAccount(alice.address).tokens.find((t) => t.symbol === 'TESTX').amount) === parseUnits('1000000'));
  await expectThrow('a duplicate symbol is rejected', sign(alice, 'token_create', { symbol: 'TESTX', name: 'again', supply: str(F('1')) }, 3).then((tx) => node.submitTransaction(tx)));
  await expectThrow('a reserved symbol is rejected', sign(alice, 'token_create', { symbol: 'FLUSH', name: 'native', supply: str(F('1')) }, 3).then((tx) => node.submitTransaction(tx)));

  await node.submitTransaction(await sign(alice, 'token_transfer', { symbol: 'TESTX', to: bob.address, amount: str(parseUnits('5000')) }, 3));
  check('token transfer moves tokens between wallets', big(node.getAccount(bob.address).tokens[0].amount) === parseUnits('5000'));

  /* ----------------------------------------------- liquidity */
  await node.submitTransaction(
    await sign(alice, 'liquidity_add', { symbol: 'TESTX', flushAmount: str(F('100')), tokenAmount: str(parseUnits('500000')) }, 4),
  );
  const token = node.getToken('TESTX');
  check('liquidity pool is funded', big(token.pool.flush) === F('100') && big(token.pool.token) === parseUnits('500000'));
  check('pool price starts at 0.0002 FLUSH per TESTX', token.price === str(parseUnits('0.0002')), token.price);
  check('liquidity provider receives LP shares', big(node.getAccount(alice.address).lp[0].shares) > 0n);

  /* ---------------------------------------------------- swap */
  const quote = node.quote('TESTX', 'buy', str(F('10')));
  check('swap quote returns an output amount', big(quote.amountOut) > 0n, str(quote.amountOut));
  check('swap quote charges the 0.3% pool fee', big(quote.fee) === (F('10') * 30n) / 10_000n);

  const aliceBefore = big(node.getAccount(alice.address).tokens.find((t) => t.symbol === 'TESTX').amount);
  await node.submitTransaction(await sign(alice, 'swap', { symbol: 'TESTX', direction: 'buy', amountIn: str(F('10')), minAmountOut: quote.amountOut }, 5));
  check('AMM buy credits exactly the quoted amount', big(node.getAccount(alice.address).tokens.find((t) => t.symbol === 'TESTX').amount) === aliceBefore + big(quote.amountOut));
  check('swaps are counted in the network stats', node.getStats().swaps === 1);

  const greedy = node.quote('TESTX', 'buy', str(F('10')));
  await expectThrow(
    'slippage protection rejects an unachievable minimum',
    sign(alice, 'swap', { symbol: 'TESTX', direction: 'buy', amountIn: str(F('10')), minAmountOut: str(big(greedy.amountOut) + 1n) }, 6).then((tx) => node.submitTransaction(tx)),
  );

  const reserveBefore = big(node.getToken('TESTX').pool.token);
  await node.submitTransaction(await sign(carol, 'swap', { symbol: 'TESTX', direction: 'buy', amountIn: str(F('50')), minAmountOut: '1' }, 0));
  const carolTokens = big(node.getAccount(carol.address).tokens.find((t) => t.symbol === 'TESTX').amount);
  const carolFlushBefore = big(node.getAccount(carol.address).flush);
  await node.submitTransaction(await sign(carol, 'swap', { symbol: 'TESTX', direction: 'sell', amountIn: str(carolTokens), minAmountOut: '1' }, 1));
  check('AMM sell returns FLUSH to the trader', big(node.getAccount(carol.address).flush) > carolFlushBefore);
  const reserveAfter = big(node.getToken('TESTX').pool.token);
  const drift = reserveAfter > reserveBefore ? reserveAfter - reserveBefore : reserveBefore - reserveAfter;
  check('AMM round trip restores token reserve within rounding precision', drift <= 1000n, `${str(reserveBefore)} -> ${str(reserveAfter)}`);

  /* -------------------------------------- order book (limit) */
  const bookPrice = node.getOrderbook('TESTX');
  check('order book exposes the AMM price reference', big(bookPrice.ammPrice) > 0n, bookPrice.ammPrice);

  const askPrice = str(parseUnits('0.0021'));
  const bidPrice = str(parseUnits('0.0025'));
  const sellOrder = await sign(bob, 'order_place', { symbol: 'TESTX', side: 'sell', type: 'limit', price: askPrice, amount: str(parseUnits('2000')) }, 1);
  await node.submitTransaction(sellOrder);
  const bookAfterAsk = node.getOrderbook('TESTX');
  check('limit sell order rests on the ask side', bookAfterAsk.asks.length === 1 && bookAfterAsk.asks[0].price === askPrice, JSON.stringify(bookAfterAsk.asks));
  check('resting sell order locks the tokens', big(node.getAccount(bob.address).lockedTokens.TESTX) === parseUnits('2000'));

  const buyOrder = await sign(alice, 'order_place', { symbol: 'TESTX', side: 'buy', type: 'limit', price: bidPrice, amount: str(parseUnits('1000')) }, 6);
  const buyResult = await node.submitTransaction(buyOrder);
  check('crossing limit order matches resting order', buyResult.accepted === true);
  const trades = node.getTrades('TESTX');
  const bookTrade = trades.find((trade) => trade.source === 'book');
  check('trade recorded at the maker price', !!bookTrade && bookTrade.price === askPrice, JSON.stringify(bookTrade ?? {}));
  const bookAfterFill = node.getOrderbook('TESTX');
  check('maker order partially filled with remainder resting', bookAfterFill.asks.length === 1 && big(bookAfterFill.asks[0].amount) === parseUnits('1000'), JSON.stringify(bookAfterFill.asks));
  const bobOpen = node.getOpenOrders('TESTX').filter((order) => order.owner === bob.address);
  check('filled order tracks remaining amount', bobOpen.length === 1 && big(bobOpen[0].remaining) === parseUnits('1000'));

  const cancel = await sign(bob, 'order_cancel', { orderId: bobOpen[0].id }, 2);
  await node.submitTransaction(cancel);
  check('cancelling order releases locked tokens', big(node.getAccount(bob.address).lockedTokens.TESTX) === 0n);
  check('cancelled order leaves book empty', node.getOrderbook('TESTX').asks.length === 0);

  /* ------------------------------------- order book (market) */
  const marketBuy = await sign(alice, 'order_place', { symbol: 'TESTX', side: 'buy', type: 'market', amountIn: str(F('5')), minAmountOut: '1' }, 7);
  const marketResult = await node.submitTransaction(marketBuy);
  check('market order fills via AMM when book is empty', marketResult.accepted === true);
  check('market order leaves no locked FLUSH behind', big(node.getAccount(alice.address).lockedFlush) === 0n);

  await expectThrow(
    'limit sell without tokens is rejected',
    sign(carol, 'order_place', { symbol: 'TESTX', side: 'sell', type: 'limit', price: str(parseUnits('1')), amount: str(parseUnits('9999999')) }, 2).then((tx) => node.submitTransaction(tx)),
  );

  /* -------------------------------------------- chain health */
  const verdict = await node.verifyChain();
  check('chain integrity passes (hashes, merkle, PoW, sigs)', verdict.valid, JSON.stringify(verdict.errors));
  check('every transaction signature was verified', verdict.signaturesChecked > 5, String(verdict.signaturesChecked));

  const accountsTotal = Object.values(node.state.accounts).reduce((sum, account) => sum + big(account.flush), 0n);
  const poolsTotal = Object.values(node.state.pools).reduce((sum, pool) => sum + big(pool.flush), 0n);
  const total = accountsTotal + poolsTotal;
  check('FLUSH total supply is conserved (accounts + AMM liquidity pools)', total === NETWORK.maxSupply, `${formatAmount(total)} vs ${formatAmount(NETWORK.maxSupply)}`);

  const replayNode = await FlushNode.create({ mode: 'test' });
  replayNode.blocks = node.blocks.slice();
  replayNode.mempool = [];
  await replayNode.replay();
  check('replay reconstructs identical balance', big(replayNode.getAccount(alice.address).flush) === big(node.getAccount(alice.address).flush));

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed — ${node.height} blocks, ${node.getStats().transactions} transactions\n`);
  if (failed) process.exitCode = 1;

}

main().catch((error) => {
  console.error('core test crashed:', error);
  process.exitCode = 1;
});
