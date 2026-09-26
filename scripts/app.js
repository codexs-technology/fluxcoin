import {
  generateWallet,
  importWalletFromPrivateKey,
  createTransaction,
  formatAmount,
  parseUnits,
  str,
  big,
  NETWORK,
} from '../shared/flushcore.mjs';

// State & UI References
let currentWallet = null;
let activeMarket = '';
let markets = [];
let orderType = 'limit';
let swapDirection = 'buy';

const API = {
  async get(endpoint) {
    const res = await fetch(`/api${endpoint}`);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Request failed');
    return body.data;
  },
  async post(endpoint, data) {
    const res = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || 'Request failed');
    return body.data;
  },
};

// UI helpers
function log(msg, type = 'info') {
  const container = document.getElementById('terminalLogs');
  if (!container) return;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'term-line';
  div.innerHTML = `<span class="time">[${time}]</span> <span class="${type}">${msg}</span>`;
  container.prepend(div);
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

async function initWallet() {
  const savedKey = localStorage.getItem('flush_priv_key');
  try {
    if (savedKey) {
      currentWallet = await importWalletFromPrivateKey(savedKey);
    } else {
      currentWallet = await generateWallet();
      localStorage.setItem('flush_priv_key', currentWallet.privateKey);
    }
  } catch (err) {
    currentWallet = await generateWallet();
    localStorage.setItem('flush_priv_key', currentWallet.privateKey);
  }

  document.getElementById('walletAddress').value = currentWallet.address;
  document.getElementById('walletPrivKey').value = currentWallet.privateKey;
  log(`Wallet initialized: ${currentWallet.address}`, 'info');
  await refreshWallet();
}

async function refreshWallet() {
  if (!currentWallet) return;
  try {
    const acct = await API.get(`/account/${currentWallet.address}`);
    document.getElementById('walletFlushBal').textContent = `${formatAmount(acct.flush)} FLUSH`;
    document.getElementById('walletLockedBal').textContent = `${formatAmount(acct.lockedFlush)} FLUSH`;

    const tokensList = document.getElementById('walletTokensList');
    tokensList.innerHTML = '';
    if (acct.tokens && acct.tokens.length > 0) {
      for (const t of acct.tokens) {
        const item = document.createElement('div');
        item.style.fontSize = '12px';
        item.textContent = `${t.symbol}: ${formatAmount(t.amount)} (${formatAmount(t.locked)} locked)`;
        tokensList.appendChild(item);
      }
    } else {
      tokensList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">No custom tokens</div>';
    }
  } catch (err) {
    // account may not exist on-chain yet
  }
}

async function refreshStats() {
  try {
    const stats = await API.get('/stats');
    document.getElementById('statHeight').textContent = stats.height;
    document.getElementById('statCirculating').textContent = `${formatAmount(stats.circulating)} FLUSH`;
    document.getElementById('statTreasury').textContent = `${formatAmount(stats.treasury)} FLUSH`;
    document.getElementById('statMempool').textContent = `${stats.pendingTransactions} TXs`;
  } catch (err) {
    console.error('Failed to refresh stats', err);
  }
}

async function refreshMarkets() {
  try {
    const tokens = await API.get('/tokens');
    markets = tokens;
    const selects = ['marketSelect', 'swapMarketSelect', 'lpMarketSelect'];
    for (const id of selects) {
      const el = document.getElementById(id);
      if (!el) continue;
      const prev = el.value;
      el.innerHTML = '';
      for (const t of tokens) {
        const opt = document.createElement('option');
        opt.value = t.symbol;
        opt.textContent = `${t.symbol} - ${t.name}`;
        el.appendChild(opt);
      }
      if (prev && tokens.some(t => t.symbol === prev)) {
        el.value = prev;
      }
    }
    if (!activeMarket && tokens.length > 0) {
      activeMarket = tokens[0].symbol;
    }
    if (activeMarket) {
      const ms = document.getElementById('marketSelect');
      if (ms) ms.value = activeMarket;
    }
  } catch (err) {
    console.error('Failed to load markets', err);
  }
}

async function refreshOrderbook() {
  if (!activeMarket) return;
  try {
    document.getElementById('bookMarketName').textContent = activeMarket;
    const book = await API.get(`/orderbook/${activeMarket}`);
    document.getElementById('marketPriceRef').textContent = book.referencePrice ? `${formatAmount(book.referencePrice)} FLUSH` : '--';

    const asksBody = document.getElementById('asksBody');
    asksBody.innerHTML = '';
    const asks = (book.asks || []).slice(0, 8).reverse();
    for (const ask of asks) {
      const tr = document.createElement('tr');
      tr.className = 'ask-row';
      tr.innerHTML = `
        <td class="price">${formatAmount(ask.price)}</td>
        <td>${formatAmount(ask.amount)}</td>
        <td>${formatAmount(ask.total)}</td>
      `;
      asksBody.appendChild(tr);
    }

    const bidsBody = document.getElementById('bidsBody');
    bidsBody.innerHTML = '';
    const bids = (book.bids || []).slice(0, 8);
    for (const bid of bids) {
      const tr = document.createElement('tr');
      tr.className = 'bid-row';
      tr.innerHTML = `
        <td class="price">${formatAmount(bid.price)}</td>
        <td>${formatAmount(bid.amount)}</td>
        <td>${formatAmount(bid.total)}</td>
      `;
      bidsBody.appendChild(tr);
    }

    document.getElementById('spreadRow').textContent = book.spread ? `SPREAD: ${formatAmount(book.spread)} FLUSH (${(book.spreadBps / 100).toFixed(2)}%)` : 'SPREAD: --';

    // Refresh trades
    const trades = await API.get(`/trades/${activeMarket}?limit=15`);
    const tradesList = document.getElementById('tradesList');
    tradesList.innerHTML = '';
    for (const t of trades) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.padding = '3px 0';
      const color = t.side === 'buy' ? 'var(--accent-green)' : 'var(--accent-red)';
      row.innerHTML = `
        <span style="color: ${color}; font-weight: bold;">${t.side.toUpperCase()}</span>
        <span>${formatAmount(t.price)} FLUSH</span>
        <span>${formatAmount(t.amount)} ${t.market}</span>
      `;
      tradesList.appendChild(row);
    }

    // Refresh my open orders
    if (currentWallet) {
      const myOrders = await API.get(`/orders?symbol=${activeMarket}`);
      const filtered = myOrders.filter(o => o.owner.toLowerCase() === currentWallet.address.toLowerCase());
      const myOrdersList = document.getElementById('myOrdersList');
      myOrdersList.innerHTML = '';
      if (filtered.length === 0) {
        myOrdersList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">No open orders</div>';
      } else {
        for (const o of filtered) {
          const div = document.createElement('div');
          div.style.background = 'var(--bg-tertiary)';
          div.style.padding = '8px';
          div.style.borderRadius = '4px';
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.innerHTML = `
            <div>
              <div style="font-weight: bold; color: ${o.side === 'buy' ? 'var(--accent-green)' : 'var(--accent-red)'}">
                ${o.side.toUpperCase()} ${formatAmount(o.remaining)} @ ${o.type === 'limit' ? formatAmount(o.price) : 'MKT'}
              </div>
              <div style="font-size: 10px; color: var(--text-muted);">${o.id}</div>
            </div>
            <button class="btn btn-sm" data-cancel="${o.id}">CANCEL</button>
          `;
          div.querySelector('button').onclick = () => cancelOrder(o.id);
          myOrdersList.appendChild(div);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load orderbook', err);
  }
}

async function sendSignedTx(type, payload) {
  if (!currentWallet) throw new Error('No active wallet');
  const acct = await API.get(`/account/${currentWallet.address}`);
  const nonce = acct.nonce;
  log(`Signing & submitting ${type} (nonce: ${nonce})...`, 'info');
  const tx = await createTransaction({
    digitalWallet: currentWallet,
    type,
    payload,
    nonce,
    fee: NETWORK.minFee,
  });
  const res = await API.post('/submit', tx);
  log(`Transaction accepted! Hash: ${res.txHash.slice(0, 16)}...`, 'success');
  toast(`Tx submitted successfully!`, 'success');
  await Promise.all([refreshWallet(), refreshStats(), refreshOrderbook()]);
  return res;
}

async function cancelOrder(orderId) {
  try {
    await sendSignedTx('order_cancel', { orderId });
  } catch (err) {
    log(`Cancel order failed: ${err.message}`, 'error');
    toast(err.message, 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      btn.classList.add('active');
      const target = document.getElementById(`tab-${btn.dataset.tab}`);
      if (target) target.style.display = 'block';
    };
  });

  document.getElementById('btnClaimFaucet').onclick = async () => {
    try {
      log('Requesting 250 FLUSH from faucet...', 'info');
      await API.post('/faucet', { address: currentWallet.address });
      log('Faucet claimed successfully!', 'success');
      toast('Claimed 250 FLUSH!', 'success');
      await refreshWallet();
      await refreshStats();
    } catch (err) {
      log(`Faucet error: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  };

  document.getElementById('btnNewWallet').onclick = async () => {
    currentWallet = await generateWallet();
    localStorage.setItem('flush_priv_key', currentWallet.privateKey);
    document.getElementById('walletAddress').value = currentWallet.address;
    document.getElementById('walletPrivKey').value = currentWallet.privateKey;
    log(`Created new wallet: ${currentWallet.address}`, 'info');
    toast('Generated new wallet', 'info');
    await refreshWallet();
  };

  document.getElementById('btnSendFlush').onclick = async () => {
    try {
      const to = document.getElementById('transferTo').value.trim();
      const amount = document.getElementById('transferAmount').value.trim();
      if (!to || !amount) return toast('Address and amount required', 'error');
      await sendSignedTx('transfer', { to, amount: str(parseUnits(amount)) });
      document.getElementById('transferAmount').value = '';
    } catch (err) {
      log(`Transfer failed: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  };

  document.getElementById('btnCreateToken').onclick = async () => {
    try {
      const symbol = document.getElementById('tokenSymbol').value.trim().toUpperCase();
      const name = document.getElementById('tokenName').value.trim();
      const supply = document.getElementById('tokenSupply').value.trim();
      if (!symbol || !name || !supply) return toast('All token fields required', 'error');

      await sendSignedTx('token_create', {
        symbol,
        name,
        supply: str(parseUnits(supply)),
        description: 'Forged on FlushChain',
        emoji: '💎',
        color: '#00ffcc',
        mintable: true,
      });

      await refreshMarkets();
      toast(`Token ${symbol} forged on-chain!`, 'success');
    } catch (err) {
      log(`Token creation failed: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  };

  document.getElementById('btnAddLiquidity').onclick = async () => {
    try {
      const symbol = document.getElementById('lpMarketSelect').value;
      const flushAmt = document.getElementById('lpFlushAmount').value.trim();
      const tokenAmt = document.getElementById('lpTokenAmount').value.trim();
      if (!symbol || !flushAmt || !tokenAmt) return toast('All LP fields required', 'error');

      await sendSignedTx('liquidity_add', {
        symbol,
        flushAmount: str(parseUnits(flushAmt)),
        tokenAmount: str(parseUnits(tokenAmt)),
      });

      toast(`Liquidity added to ${symbol}/FLUSH pool!`, 'success');
      await refreshOrderbook();
    } catch (err) {
      log(`Add liquidity failed: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  };

  document.getElementById('swapBuyToggle').onclick = () => {
    swapDirection = 'buy';
    document.getElementById('swapBuyToggle').classList.add('active');
    document.getElementById('swapSellToggle').classList.remove('active');
    document.getElementById('swapInLabel').textContent = 'INPUT (FLUSH)';
  };

  document.getElementById('swapSellToggle').onclick = () => {
    swapDirection = 'sell';
    document.getElementById('swapSellToggle').classList.add('active');
    document.getElementById('swapBuyToggle').classList.remove('active');
    document.getElementById('swapInLabel').textContent = 'INPUT (TOKEN)';
  };

  document.getElementById('btnExecuteSwap').onclick = async () => {
    try {
      const symbol = document.getElementById('swapMarketSelect').value;
      const amountIn = document.getElementById('swapAmountIn').value.trim();
      if (!symbol || !amountIn) return toast('Amount required', 'error');

      await sendSignedTx('swap', {
        symbol,
        direction: swapDirection,
        amountIn: str(parseUnits(amountIn)),
        minAmountOut: '1',
      });

      toast('Swap executed!', 'success');
      await refreshOrderbook();
    } catch (err) {
      log(`Swap failed: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  };

  document.getElementById('typeLimit').onclick = () => {
    orderType = 'limit';
    document.getElementById('typeLimit').classList.add('active');
    document.getElementById('typeMarket').classList.remove('active');
    document.getElementById('groupPrice').style.display = 'flex';
  };

  document.getElementById('typeMarket').onclick = () => {
    orderType = 'market';
    document.getElementById('typeMarket').classList.add('active');
    document.getElementById('typeLimit').classList.remove('active');
    document.getElementById('groupPrice').style.display = 'none';
  };

  document.getElementById('marketSelect').onchange = (e) => {
    activeMarket = e.target.value;
    refreshOrderbook();
  };

  async function placeOrder(side) {
    try {
      const symbol = document.getElementById('marketSelect').value;
      const price = document.getElementById('orderPrice').value.trim();
      const amount = document.getElementById('orderAmount').value.trim();

      if (!symbol || !amount) return toast('Market and amount required', 'error');
      if (orderType === 'limit' && !price) return toast('Price required for limit order', 'error');

      const payload = {
        symbol,
        side,
        type: orderType,
        price: orderType === 'limit' ? str(parseUnits(price)) : '0',
        amount: orderType === 'limit' ? str(parseUnits(amount)) : undefined,
        amountIn: orderType === 'market' ? str(parseUnits(amount)) : undefined,
        minAmountOut: orderType === 'market' ? '1' : undefined,
      };

      await sendSignedTx('order_place', payload);
      toast(`${orderType.toUpperCase()} ${side.toUpperCase()} order submitted!`, 'success');
      await refreshOrderbook();
    } catch (err) {
      log(`Order placement failed: ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  }

  document.getElementById('btnBuy').onclick = () => placeOrder('buy');
  document.getElementById('btnSell').onclick = () => placeOrder('sell');
}

// Initial Boot
async function startApp() {
  log('Starting FlushCoin client terminal...', 'info');
  bindEvents();
  await initWallet();
  await refreshStats();
  await refreshMarkets();
  await refreshOrderbook();

  setInterval(async () => {
    await refreshStats();
    await refreshOrderbook();
    await refreshWallet();
  }, 3000);
}

startApp().catch(console.error);





