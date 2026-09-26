import React, { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { swapTokensOnDEX, getExpectedSwapOutput, WETH_ADDRESS, USDT_ADDRESS } from '../utils/dexIntegration';
import { DEFAULT_TOKEN_ADDRESS } from '../utils/walletConnection';
import { useAppStore } from '../store/useAppStore';

export default function TokenSwap() {
  const { connectedWallet } = useWallet();
  const addLog = useAppStore((s) => s.addLog);

  const [fromToken, setFromToken] = useState('FLASH');
  const [toToken, setToToken] = useState('USDT');
  const [amountIn, setAmountIn] = useState('100');
  const [amountOut, setAmountOut] = useState('99.50');
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState('');

  const tokenAddresses = {
    FLASH: DEFAULT_TOKEN_ADDRESS,
    WETH: WETH_ADDRESS,
    USDT: USDT_ADDRESS
  };

  useEffect(() => {
    let active = true;
    async function updateQuote() {
      if (!amountIn || Number(amountIn) <= 0) {
        setAmountOut('0.00');
        return;
      }
      const quote = await getExpectedSwapOutput(
        tokenAddresses[fromToken] || DEFAULT_TOKEN_ADDRESS,
        tokenAddresses[toToken] || USDT_ADDRESS,
        amountIn
      );
      if (active) setAmountOut(quote);
    }
    updateQuote();
    return () => { active = false; };
  }, [amountIn, fromToken, toToken]);

  const handleSwap = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setTxHash('');

    try {
      if (connectedWallet?.isReal && window.ethereum) {
        addLog(`[DEX_SWAP] Routing swap of ${amountIn} ${fromToken}...`, 'warn');
        const tx = await swapTokensOnDEX({
          tokenIn: tokenAddresses[fromToken],
          tokenOut: tokenAddresses[toToken],
          amountIn
        });
        setTxHash(tx.hash);
        const receipt = await tx.wait();
        addLog(`[SWAP_SUCCESS] Block #${receipt.blockNumber}`, 'success');
      } else {
        addLog(`[SWAP_SIM] Swapping ${amountIn} ${fromToken}...`, 'info');
        await new Promise((r) => setTimeout(r, 800));
        const mockHash = '0x' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...';
        setTxHash(mockHash);
        addLog(`[SWAP_CONFIRMED] TX: ${mockHash}`, 'success');
      }
    } catch (err) {
      addLog(`[SWAP_ERR] ${err.message || 'Failed'}`, 'error');
      alert(`Swap error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">DEX SWAP</span>
        <span className="text-[10px] text-slate-500">UNISWAP V2</span>
      </div>

      <div className="p-2 rounded bg-[#070d14] border border-slate-800 space-y-1">
        <div className="flex justify-between items-center text-[10px] text-slate-400">
          <span>PAY</span>
          <select
            value={fromToken}
            onChange={(e) => setFromToken(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-cyan-300 rounded px-1.5 py-0.5"
          >
            <option value="FLASH">FLASH</option>
            <option value="WETH">WETH</option>
            <option value="USDT">USDT</option>
          </select>
        </div>
        <input
          type="number"
          step="any"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          className="w-full bg-transparent text-base text-white font-bold focus:outline-none"
        />
      </div>

      <div className="p-2 rounded bg-[#070d14] border border-slate-800 space-y-1">
        <div className="flex justify-between items-center text-[10px] text-slate-400">
          <span>RECEIVE (EST.)</span>
          <select
            value={toToken}
            onChange={(e) => setToToken(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-xs text-emerald-300 rounded px-1.5 py-0.5"
          >
            <option value="USDT">USDT</option>
            <option value="FLASH">FLASH</option>
            <option value="WETH">WETH</option>
          </select>
        </div>
        <div className="text-base text-emerald-400 font-bold">{amountOut}</div>
      </div>

      <button
        onClick={handleSwap}
        disabled={loading || !amountIn || Number(amountIn) <= 0}
        className="w-full py-2.5 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40"
      >
        {loading ? 'SWAPPING ON DEX...' : `SWAP ${fromToken} ➔ ${toToken}`}
      </button>

      {txHash && (
        <div className="p-2 rounded bg-cyan-950/30 border border-cyan-500/40 text-[10px] text-cyan-300 flex items-center justify-between">
          <span>TX: {txHash}</span>
        </div>
      )}
    </div>
  );
}
