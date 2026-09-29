import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useAppStore } from '../store/useAppStore';

export default function TokenTrade() {
  const { connectedWallet } = useWallet();
  const addLog = useAppStore((s) => s.addLog);
  const [side, setSide] = useState('buy'); // 'buy' | 'sell'
  const [orderType, setOrderType] = useState('limit'); // 'limit' | 'market'
  const [price, setPrice] = useState('1.00');
  const [size, setSize] = useState('500');
  const [statusMsg, setStatusMsg] = useState('');

  const handlePlaceOrder = (e) => {
    e?.preventDefault();
    const totalCost = (parseFloat(price) * parseFloat(size)).toFixed(2);
    addLog(`[ORDER_BOOK] Placed ${orderType.toUpperCase()} ${side.toUpperCase()} for ${size} FLASH @ $${price} (Total: $${totalCost})`, 'info');
    setStatusMsg(`Order filled & registered on book: ${size} FLASH`);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
          ORDERBOOK TRADING
        </span>
        <span className="text-[10px] text-slate-500">CLOB ENGINE</span>
      </div>

      <div className="p-2 rounded bg-amber-950/30 border border-amber-500/40 text-[10px] text-amber-300 leading-snug">
        Demo orderbook UI — no orders are executed here. To trade on-chain, use the DEX swap tab (add liquidity first,
        see the README). Withdrawals of earned coins are handled in the "02 // WITHDRAW ASSETS" tab.
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-[#070d14] rounded border border-slate-800">
        <button
          onClick={() => setSide('buy')}
          className={`py-1 text-xs font-bold rounded ${
            side === 'buy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400'
          }`}
        >
          BUY FLASH
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`py-1 text-xs font-bold rounded ${
            side === 'sell' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'text-slate-400'
          }`}
        >
          SELL FLASH
        </button>
      </div>

      <div className="flex space-x-2 text-[10px]">
        {['limit', 'market'].map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={`px-2 py-0.5 rounded uppercase border ${
              orderType === t ? 'border-cyan-400 text-cyan-300 bg-cyan-950/40' : 'border-slate-800 text-slate-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <label className="text-[10px] text-slate-400 block mb-0.5">LIMIT PRICE (USD)</label>
          <input
            type="number"
            step="0.01"
            value={price}
            disabled={orderType === 'market'}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-[#070d14] border border-slate-800 rounded p-1.5 text-white focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] text-slate-400 block mb-0.5">ORDER SIZE (FLASH)</label>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="w-full bg-[#070d14] border border-slate-800 rounded p-1.5 text-white focus:outline-none"
          />
        </div>
      </div>

      <button
        onClick={handlePlaceOrder}
        className={`w-full py-2.5 rounded font-bold text-xs uppercase tracking-wider transition-all border ${
          side === 'buy'
            ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900'
            : 'bg-rose-950/70 border-rose-500/60 text-rose-300 hover:bg-rose-900'
        }`}
      >
        {side === 'buy' ? 'PLACE BUY ORDER' : 'PLACE SELL ORDER'}
      </button>

      {statusMsg && (
        <div className="p-1.5 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] text-cyan-300 text-center">
          {statusMsg}
        </div>
      )}
    </div>
  );
}
