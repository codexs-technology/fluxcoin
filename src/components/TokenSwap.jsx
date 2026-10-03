import React, { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWallet } from '../hooks/useWallet';
import { useToken } from '../hooks/useToken';
import { useAppStore } from '../store/useAppStore';
import {
  approveRouter,
  getWrappedNative,
  quote,
  swapExactNativeForTokens,
  swapExactTokensForNative
} from '../wallet/dex.js';
import { getPairAddress, getReadProvider } from '../wallet/token.js';
import { explorerTxUrl, explorerAddressUrl } from '../wallet/chains.js';
import { ROUTER_ADDRESS, ROUTER_LABEL } from '../contracts/addresses.js';
import { getFlashAsset } from '../contracts/assets.js';

/**
 * DEX swap (Uniswap V2 / PancakeSwap V2 / QuickSwap compatible) for the
 * SELECTED Flash asset. Everything is quoted by the router for real: the old
 * implementation returned `amountIn * 0.995` as a "simulated quote" whenever
 * the pair did not exist, which quietly invented a price. Here a missing pool is
 * reported as exactly that.
 */
export default function TokenSwap() {
  const { isConnected, isEvm, chainId, activeChain } = useWallet();
  const selectedToken = useAppStore((s) => s.selectedToken);
  const asset = getFlashAsset(selectedToken?.id);
  const { balance, refreshBalance } = useToken(asset.address, asset.decimals, asset.symbol);

  // Shorthand wiring for the selected asset (address/decimals/symbol).
  const tokenAddress = asset.address;
  const tokenDecimals = asset.decimals;
  const tokenSymbol = asset.symbol;

  const [direction, setDirection] = useState('buy'); // buy = native -> asset, sell = asset -> native
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState(null);
  const [slippage, setSlippage] = useState('1');
  const [wrappedNative, setWrappedNative] = useState('');
  const [pairAddress, setPairAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [formError, setFormError] = useState(null);

  const nativeSymbol = activeChain?.currency || 'ETH';
  const inSymbol = direction === 'buy' ? nativeSymbol : tokenSymbol;
  const outSymbol = direction === 'buy' ? tokenSymbol : nativeSymbol;

  // Resolve the router's wrapped-native address (needed for the swap path).
  useEffect(() => {
    let active = true;
    if (!ROUTER_ADDRESS) return () => { active = false; };
    getWrappedNative(ROUTER_ADDRESS)
      .then((address) => { if (active) setWrappedNative(address); })
      .catch(() => { if (active) setWrappedNative(''); });
    return () => { active = false; };
  }, []);

  // Show the real LP pair when it exists (null = no pool yet, see README).
  useEffect(() => {
    let active = true;
    if (!ROUTER_ADDRESS || !wrappedNative || !tokenAddress) return () => { active = false; };
    (async () => {
      try {
        const router = new ethers.Contract(
          ROUTER_ADDRESS,
          ['function factory() view returns (address)'],
          getReadProvider()
        );
        const factoryAddress = await router.factory();
        const pair = await getPairAddress(factoryAddress, tokenAddress, wrappedNative);
        if (active) setPairAddress(pair);
      } catch {
        if (active) setPairAddress(null);
      }
    })();
    return () => { active = false; };
  }, [wrappedNative, tokenAddress]);

  const refreshQuote = useCallback(async () => {
    setQuoteError(null);
    setAmountOut(null);
    if (!amountIn || Number(amountIn) <= 0 || !ROUTER_ADDRESS || !wrappedNative || !tokenAddress) return;
    try {
      const result = await quote({
        routerAddress: ROUTER_ADDRESS,
        tokenIn: direction === 'buy' ? wrappedNative : tokenAddress,
        tokenOut: direction === 'buy' ? tokenAddress : wrappedNative,
        amountIn,
        // The quote must respect the per-asset precision (USDT 6d, BTC 8d, …).
        decimalsIn: direction === 'buy' ? 18 : tokenDecimals,
        decimalsOut: direction === 'buy' ? tokenDecimals : 18
      });
      setAmountOut(result);
    } catch {
      setQuoteError(`No ${tokenSymbol}/native liquidity pool found for this amount on this network. Add liquidity first (see README → "Add liquidity").`);
    }
  }, [amountIn, direction, wrappedNative, tokenAddress, tokenDecimals, tokenSymbol]);

  useEffect(() => {
    const timer = setTimeout(refreshQuote, 350);
    return () => clearTimeout(timer);
  }, [refreshQuote]);
  const handleSwap = async (event) => {
    event.preventDefault();
    setFormError(null);
    setTxHash('');

    if (!isConnected || !isEvm) {
      setFormError('Connect an EVM wallet to swap.');
      return;
    }
    if (!ROUTER_ADDRESS) {
      setFormError('No DEX router configured for this network (VITE_ROUTER_ADDRESS).');
      return;
    }
    if (!amountIn || Number(amountIn) <= 0) {
      setFormError('Enter an amount to swap.');
      return;
    }

    const slippageBps = BigInt(Math.round(Number(slippage) * 100)) || 100n;
    setLoading(true);
    try {
      let tx;
      if (direction === 'buy') {
        tx = await swapExactNativeForTokens({
          routerAddress: ROUTER_ADDRESS,
          tokenOut: tokenAddress,
          nativeAmount: amountIn,
          slippageBps
        });
      } else {
        // Selling the asset requires a real approval for the router first
        // (exact amount, per-asset decimals — never a blanket MaxUint256).
        await approveRouter({ routerAddress: ROUTER_ADDRESS, tokenAddress, amount: amountIn, decimals: tokenDecimals });
        tx = await swapExactTokensForNative({
          routerAddress: ROUTER_ADDRESS,
          tokenIn: tokenAddress,
          amountIn,
          slippageBps,
          decimalsIn: tokenDecimals
        });
      }
      setTxHash(tx.hash);
      await tx.wait();
      await refreshBalance();
      await refreshQuote();
      setAmountIn('');
    } catch (error) {
      setFormError(error.reason || error.shortMessage || error.message || 'Swap failed');
    } finally {
      setLoading(false);
    }
  };

  const explorerUrl = txHash ? explorerTxUrl(txHash, chainId) : null;
  const pairUrl = pairAddress ? explorerAddressUrl(pairAddress, chainId) : null;

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">DEX SWAP</span>
        <span className="text-[10px] text-slate-500">{ROUTER_LABEL} ROUTER {ROUTER_ADDRESS ? '• LIVE' : '• UNCONFIGURED'}</span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-[#070d14] rounded border border-slate-800">
        <button
          onClick={() => setDirection('buy')}
          className={`py-1 text-[11px] font-bold rounded ${
            direction === 'buy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400'
          }`}
        >
          BUY {tokenSymbol} ({nativeSymbol})
        </button>
        <button
          onClick={() => setDirection('sell')}
          className={`py-1 text-[11px] font-bold rounded ${
            direction === 'sell' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'text-slate-400'
          }`}
        >
          SELL {tokenSymbol} → {nativeSymbol}
        </button>
      </div>

      <div className="p-2 rounded bg-[#070d14] border border-slate-800 space-y-1">
        <div className="flex justify-between items-center text-[10px] text-slate-400">
          <span>PAY ({inSymbol})</span>
          {direction === 'sell' && <span>balance: {balance === null ? '—' : balance}</span>}
        </div>
        <input
          type="number"
          step="any"
          value={amountIn}
          onChange={(event) => setAmountIn(event.target.value)}
          placeholder="0.0"
          className="w-full bg-transparent text-base text-white font-bold focus:outline-none"
        />
      </div>

      <div className="p-2 rounded bg-[#070d14] border border-slate-800 space-y-1">
        <div className="flex justify-between items-center text-[10px] text-slate-400">
          <span>RECEIVE (EST. {outSymbol})</span>
          <span>slippage {slippage}%</span>
        </div>
        <div className="text-base text-emerald-400 font-bold">{amountOut ?? '—'}</div>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={slippage}
          onChange={(event) => setSlippage(event.target.value)}
          className="w-full"
        />
      </div>

      {quoteError && (
        <div className="p-2 rounded bg-amber-950/30 border border-amber-500/40 text-[10px] text-amber-300 leading-snug">
          {quoteError}
        </div>
      )}
      {formError && (
        <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[10px] text-rose-300 leading-snug">{formError}</div>
      )}

      <button
        onClick={handleSwap}
        disabled={loading || !amountIn || Number(amountIn) <= 0 || !amountOut || !isConnected}
        className="w-full py-2.5 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40"
      >
        {loading ? 'SWAPPING ON DEX…' : `SWAP ${inSymbol} → ${outSymbol}`}
      </button>

      {txHash && (
        <div className="p-2 rounded bg-cyan-950/30 border border-cyan-500/40 text-[10px] text-cyan-300 flex items-center justify-between">
          <span>TX: {txHash.slice(0, 18)}…</span>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
              Explorer ↗
            </a>
          )}
        </div>
      )}

      <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-500 space-y-0.5 leading-snug">
        <div>
          LP pair: {pairAddress ? (
            <a href={pairUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">
              {pairAddress} ↗
            </a>
          ) : (
            'not created yet — add liquidity (README → "Add liquidity / make the token tradable")'
          )}
        </div>
        <div>Swaps are normal signed transactions (you pay the network gas). Only withdrawals are gasless.</div>
      </div>
    </div>
  );
}
