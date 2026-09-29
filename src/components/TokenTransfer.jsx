import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useToken } from '../hooks/useToken';
import { useAppStore } from '../store/useAppStore';
import { explorerTxUrl } from '../wallet/chains.js';
import { getFlashAsset } from '../contracts/assets.js';
import { explorerTokenUrl } from '../contracts/addresses.js';

/**
 * Real ERC-20 transfer UI for the SELECTED Flash asset (USDT/BTC/ETH/TRX/SOL).
 *
 * The previous version generated a mock transaction hash whenever no wallet was
 * connected ("TRANSFER_CONFIRMED" with a random 0x… string). Now a transfer either
 * goes on-chain through the connected wallet or reports the real error.
 */
export default function TokenTransfer() {
  const { isConnected, isEvm, chainId } = useWallet();
  const selectedToken = useAppStore((s) => s.selectedToken);
  const asset = getFlashAsset(selectedToken?.id);
  const { balance, refreshBalance, transfer } = useToken(asset.address, asset.decimals, asset.symbol);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [formError, setFormError] = useState(null);

  const handleTransfer = async (event) => {
    event.preventDefault();
    setFormError(null);
    setTxHash('');

    if (!isConnected || !isEvm) {
      setFormError(`Connect an EVM wallet before transferring ${asset.symbol}.`);
      return;
    }
    if (!asset.address) {
      setFormError(`VITE_TOKEN_ADDRESS_${asset.id.toUpperCase()} is not configured — deploy the Flash contracts first (see DEPLOYMENT.md).`);
      return;
    }
    if (!recipient || !amount || Number(amount) <= 0) {
      setFormError('Enter a valid recipient address and amount.');
      return;
    }

    setLoading(true);
    try {
      const receipt = await transfer(recipient, amount);
      setTxHash(receipt?.hash || receipt?.transactionHash || '');
      await refreshBalance();
      setAmount('');
    } catch (error) {
      setFormError(error.message || 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };
  const explorerUrl = txHash ? explorerTxUrl(txHash, chainId) : null;
  const tokenUrl = explorerTokenUrl(asset.address);

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">TRANSFER {asset.symbol} TOKENS</span>
        <span className="text-[10px] text-slate-500">
          ERC-20 / {balance === null ? '—' : balance} {asset.symbol}
        </span>
      </div>

      <form onSubmit={handleTransfer} className="space-y-2.5">
        <div>
          <label className="text-[10px] text-slate-400 uppercase block mb-1">Recipient Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value.trim())}
            className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded p-2 text-xs text-white focus:outline-none"
          />
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Amount ({asset.symbol})</span>
            <button type="button" onClick={() => setAmount(balance || '')} className="text-cyan-400 hover:text-white">
              USE MAX
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              step="any"
              placeholder="0.0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded p-2 text-xs text-white focus:outline-none font-bold"
            />
            <div className="absolute right-2 top-2 text-[10px] text-cyan-400">{asset.symbol}</div>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 uppercase block mb-1">Token Contract (from .env)</label>
          <div className="w-full bg-[#070d14] border border-slate-800 rounded p-1.5 text-[10px] text-slate-400 break-all">
            {asset.address || `not configured — run contracts/scripts/deployFlashAssets.js and set VITE_TOKEN_ADDRESS_${asset.id.toUpperCase()}`}
          </div>
        </div>

        {formError && (
          <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[10px] text-rose-300 leading-snug">
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !recipient || !amount}
          className="w-full py-2.5 rounded bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(0,240,255,0.15)]"
        >
          {loading ? 'BROADCASTING TO MEMPOOL…' : `EXECUTE ${asset.symbol} TRANSFER`}
        </button>

        <div className="text-[10px] text-slate-500 leading-snug">
          This is a normal ERC-20 transfer signed by your wallet: you pay the network gas for it (withdrawals are the
          gasless path). {tokenUrl && (
            <a href={tokenUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">
              View token contract ↗
            </a>
          )}
        </div>
      </form>

      {txHash && (
        <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center justify-between">
          <span>TX: {txHash.slice(0, 18)}…</span>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline hover:text-white">
              Explorer ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
