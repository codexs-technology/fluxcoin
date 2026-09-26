/**
 * Balance card: the on-site (earned) balance next to the real on-chain FLUX
 * balance. Both values come from real sources — no placeholder numbers:
 *   - site   -> GET /api/balance (backend ledger, authoritative for withdrawals)
 *   - onchain-> ERC-20 balanceOf() read through the connected provider / RPC
 */
import React from 'react';
import { useCoinBalance } from '../hooks/useCoinBalance';
import { useWallet } from '../hooks/useWallet';
import { prettyAmount } from '../wallet/format';
import { explorerTokenUrl } from '../contracts/addresses.js';

export function CoinBalance() {
  const { isConnected } = useWallet();
  const { site, onchain, config, isSignedIn, isLoading, error, signIn, tokenSymbol, tokenAddress, tokenHint, apiOnline } =
    useCoinBalance();

  const tokenUrl = explorerTokenUrl(tokenAddress);

  return (
    <div className="space-y-2 font-mono">
      <div className="text-xs uppercase tracking-wider text-cyan-400/80 flex items-center justify-between">
        <span>00 // FLUX Balance</span>
        <span className="text-[10px] text-slate-500">{tokenAddress ? 'ERC-20 • 18d' : 'NOT DEPLOYED'}</span>
      </div>

      <div className="p-3 rounded-md bg-slate-900/60 border border-slate-800 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-slate-400 uppercase">Earned (withdrawable)</span>
          <span className="text-sm font-bold text-cyan-300">
            {site ? prettyAmount(site.availableTokens, 4) : '—'} <span className="text-[10px] text-slate-400">{tokenSymbol}</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-slate-400 uppercase">On-chain wallet balance</span>
          <span className="text-sm font-bold text-emerald-400">
            {onchain ? prettyAmount(onchain.balanceTokens, 4) : '—'}{' '}
            <span className="text-[10px] text-slate-400">{tokenSymbol}</span>
          </span>
        </div>
        {site && (
          <div className="text-[10px] text-slate-500 flex justify-between">
            <span>withdrawn: {prettyAmount(site.withdrawnTokens, 4)}</span>
            <span>today: {prettyAmount(site.earnedTodayTokens, 4)}</span>
          </div>
        )}
        <div className="text-[10px] text-slate-500 flex justify-between">
          <span>GASLESS MODE</span>
          <span className="text-cyan-400">{config?.mode || 'unknown'}</span>
        </div>
      </div>

      {!isConnected && (
        <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400">
          Connect a wallet to generate and withdraw FLUX. Your address is the destination of every withdrawal.
        </div>
      )}

      {isConnected && !isSignedIn && (
        <button
          onClick={() => signIn().catch(() => null)}
          disabled={isLoading}
          className="w-full py-2 rounded border border-cyan-500/50 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-300 text-[11px] tracking-wider disabled:opacity-50"
        >
          {isLoading ? 'WAITING FOR SIGNATURE…' : 'SIGN IN TO LOAD BALANCE'}
        </button>
      )}

      {apiOnline === false && (
        <div className="p-2 rounded bg-amber-950/30 border border-amber-500/40 text-[10px] text-amber-300 leading-snug">
          Backend offline — start it with <span className="text-amber-100">npm run dev</span> inside the api/ folder to load
          balances and withdrawals.
        </div>
      )}

      {error && (
        <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[10px] text-rose-300 leading-snug">{error}</div>
      )}

      {tokenHint && (
        <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 leading-snug">{tokenHint}</div>
      )}

      {tokenUrl && (
        <a
          href={tokenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-[10px] text-slate-500 hover:text-cyan-300 underline truncate"
        >
          Token contract: {tokenAddress} ↗
        </a>
      )}
    </div>
  );
}

export default CoinBalance;
