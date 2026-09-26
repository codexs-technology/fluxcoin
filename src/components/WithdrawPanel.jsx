/**
 * Withdrawal panel — the user-facing half of the "earned coins -> real token" flow.
 *
 * Steps (all server-verified):
 *   1. the connected wallet address is fixed as the destination (the API rejects a
 *      mismatch between the signed session address and the withdrawal address);
 *   2. the amount is validated against the EARNED site balance here and, again,
 *      server-side in api/src/services/withdrawal.js (`INSUFFICIENT_SITE_BALANCE`);
 *   3. the backend mints real ERC-20 FLUX to that address through a GASLESS route
 *      (server-sponsored mint, Gelato Relay ERC-2771 or a Biconomy paymaster
 *      UserOperation) — the user pays 0 gas in every mode.
 */
import React, { useState } from 'react';
import { useCoinBalance } from '../hooks/useCoinBalance';
import { useWallet } from '../hooks/useWallet';
import { prettyAmount } from '../wallet/format';

const PHASE_LABELS = {
  validating: 'Backend validating your earned balance…',
  'awaiting-signature': 'Confirm the FREE signature in your wallet…',
  estimating: 'Estimating the sponsored UserOperation…',
  relaying: 'Relayer submitting the transaction (you pay 0 gas)…',
  confirmed: 'Confirmed — FLUX minted to your wallet.'
};

export function WithdrawPanel() {
  const { isConnected, truncatedAddress, networkName, isEvm } = useWallet();
  const {
    site,
    config,
    isSignedIn,
    isLoading,
    error,
    withdrawPhase,
    lastWithdrawal,
    withdraw,
    signIn,
    tokenSymbol,
    tokenHint,
    isTokenConfigured,
    clearError
  } = useCoinBalance();

  const [amount, setAmount] = useState('');
  const [localError, setLocalError] = useState(null);

  const available = Number(site?.availableTokens || 0);
  const minTokens = Number(config?.minTokens || 0);
  const maxTokens = Number(config?.maxTokens || 0);
  const parsed = Number(amount);
  const isBusy = Boolean(withdrawPhase);

  const amountError = (() => {
    if (!amount) return null;
    if (!Number.isFinite(parsed) || parsed <= 0) return 'Enter a positive amount';
    if (parsed > available) return `Exceeds your earned balance (${prettyAmount(available, 4)} ${tokenSymbol} available)`;
    if (minTokens && parsed < minTokens) return `Minimum withdrawal is ${prettyAmount(minTokens, 4)} ${tokenSymbol}`;
    if (maxTokens && parsed > maxTokens) return `Maximum per request is ${prettyAmount(maxTokens, 4)} ${tokenSymbol}`;
    return null;
  })();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError(null);
    clearError();
    if (amountError) {
      setLocalError(amountError);
      return;
    }
    try {
      await withdraw(amount);
      setAmount('');
    } catch (submitError) {
      setLocalError(submitError.message || 'Withdrawal failed');
    }
  };
  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">WITHDRAW FLUX — ZERO GAS</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
          USER GAS: 0
        </span>
      </div>

      {!isConnected && (
        <div className="p-3 rounded bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
          Connect an EVM wallet (extension or WalletConnect QR) — your address is the only possible destination of a
          withdrawal.
        </div>
      )}

      {isConnected && !isEvm && (
        <div className="p-3 rounded bg-amber-950/30 border border-amber-500/40 text-[11px] text-amber-300">
          The connected wallet is a Solana wallet. FLUX withdrawals are minted as ERC-20 on {networkName}, so connect an
          EVM wallet to withdraw.
        </div>
      )}

      {isConnected && isEvm && (
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="p-2 rounded bg-[#070d14] border border-slate-800 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>DESTINATION (connected wallet)</span>
              <span className="text-cyan-400">FIXED</span>
            </div>
            <div className="text-xs text-slate-200">{truncatedAddress}</div>
            <div className="text-[10px] text-slate-500">Network: {networkName}</div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>AMOUNT ({tokenSymbol})</span>
            <button
              type="button"
              onClick={() => setAmount(String(Math.min(available, maxTokens || available)))}
              className="text-cyan-400 hover:text-white"
            >
              MAX {prettyAmount(available, 4)}
            </button>
          </div>
          <input
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.0"
            className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded p-2 text-sm text-white focus:outline-none font-bold"
          />

          <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 space-y-0.5">
            <div className="flex justify-between">
              <span>GASLESS MODE</span>
              <span className="text-cyan-300">{config?.mode || 'unknown'}</span>
            </div>
            <div className="flex justify-between">
              <span>NETWORK FEE FOR YOU</span>
              <span className="text-emerald-400">0.00 (project paymaster)</span>
            </div>
            <div className="flex justify-between">
              <span>WITHDRAWAL LIMITS</span>
              <span>
                {prettyAmount(minTokens, 4)} – {prettyAmount(maxTokens, 4)} {tokenSymbol}
              </span>
            </div>
          </div>

          {(amountError || localError || error) && (
            <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[10px] text-rose-300 leading-snug">
              {amountError || localError || error}
            </div>
          )}
          {withdrawPhase && (
            <div className="p-2 rounded bg-cyan-950/30 border border-cyan-500/40 text-[11px] text-cyan-300 animate-pulse">
              {PHASE_LABELS[withdrawPhase] || `Processing (${withdrawPhase})…`}
            </div>
          )}

          {lastWithdrawal && (
            <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/40 text-[10px] text-emerald-300 space-y-1">
              <div>
                {lastWithdrawal.simulated ? 'DRY-RUN (no real tx)' : 'CONFIRMED'}: {lastWithdrawal.amount} {tokenSymbol} →{' '}
                {truncatedAddress}
              </div>
              <div className="text-slate-400">
                gas paid by: {lastWithdrawal.gasPaidBy} • your cost: {lastWithdrawal.userGasCost}
              </div>
              {lastWithdrawal.explorerUrl && (
                <a
                  href={lastWithdrawal.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-white"
                >
                  View transaction ↗
                </a>
              )}
            </div>
          )}

          {!isSignedIn ? (
            <button
              type="button"
              onClick={() => signIn().catch((signError) => setLocalError(signError.message))}
              disabled={isLoading}
              className="w-full py-2.5 rounded bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs uppercase tracking-wider disabled:opacity-50"
            >
              SIGN IN WITH WALLET
            </button>
          ) : (
            <button
              type="submit"
              disabled={isBusy || isLoading || !amount || Boolean(amountError) || !isTokenConfigured}
              className="w-full py-2.5 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40"
            >
              {isBusy ? 'SETTLING GASLESS WITHDRAWAL…' : `WITHDRAW ${amount || 0} ${tokenSymbol} (0 GAS)`}
            </button>
          )}

          {tokenHint && <div className="text-[10px] text-amber-300/80 leading-snug">{tokenHint}</div>}

          <div className="text-[10px] text-slate-500 leading-snug">
            The project pays the gas: the API holds the Paymaster / Relayer credentials
            (<span className="text-slate-400">GELATO_RELAY_API_KEY</span> or{' '}
            <span className="text-slate-400">BICONOMY_PAYMASTER_URL</span> in api/.env). Nothing here can make you spend
            gas, and the backend refuses any amount above your earned balance.
          </div>
        </form>
      )}
    </div>
  );
}

export default WithdrawPanel;
