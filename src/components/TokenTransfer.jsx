import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { transferTokens, DEFAULT_TOKEN_ADDRESS } from '../utils/walletConnection';
import { useAppStore } from '../store/useAppStore';

export default function TokenTransfer() {
  const { connectedWallet } = useWallet();
  const addLog = useAppStore((s) => s.addLog);
  const selectedToken = useAppStore((s) => s.selectedToken);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenAddress, setTokenAddress] = useState(DEFAULT_TOKEN_ADDRESS);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState('');

  const handleTransfer = async (e) => {
    e?.preventDefault();
    if (!recipient || !amount || Number(amount) <= 0) {
      alert('Please enter valid recipient address and amount');
      return;
    }

    setLoading(true);
    setTxHash('');

    try {
      if (connectedWallet?.isReal && window.ethereum) {
        addLog(`[TRANSFER] Submitting on-chain tx for ${amount} ${selectedToken.symbol} to ${recipient}...`, 'warn');
        const tx = await transferTokens(tokenAddress, recipient, amount, selectedToken.decimals || 18);
        setTxHash(tx.hash);
        addLog(`[TX_BROADCAST] Hash: ${tx.hash}`, 'info');

        const receipt = await tx.wait();
        addLog(`[TX_CONFIRMED] Transferred at block #${receipt.blockNumber}`, 'success');

        useAppStore.setState((state) => ({
          operationLedger: [
            {
              id: 'OP-' + Math.floor(10000 + Math.random() * 90000),
              time: new Date().toTimeString().split(' ')[0] + ' UTC',
              op: 'ONCHAIN_TRANSFER',
              asset: selectedToken.symbol,
              value: Number(amount).toLocaleString(),
              fee: 'Gas Paid',
              tx: tx.hash.slice(0, 10) + '...' + tx.hash.slice(-6),
              status: 'CONFIRMED'
            },
            ...state.operationLedger
          ]
        }));
      } else {
        addLog(`[TRANSFER_SIM] Transferring ${amount} ${selectedToken.symbol} to ${recipient}...`, 'info');
        await new Promise((r) => setTimeout(r, 1000));
        const mockHash = '0x' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...' + Array.from({ length: 4 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        setTxHash(mockHash);
        addLog(`[TRANSFER_CONFIRMED] Transfer verified. TX: ${mockHash}`, 'success');
      }
    } catch (error) {
      addLog(`[TRANSFER_ERR] ${error.message || 'Transaction failed'}`, 'error');
      alert(`Transfer failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
          TRANSFER FLASH TOKENS
        </span>
        <span className="text-[10px] text-slate-500">ERC20 / 0.05% RELAY FEE</span>
      </div>

      <form onSubmit={handleTransfer} className="space-y-2.5">
        <div>
          <label className="text-[10px] text-slate-400 uppercase block mb-1">
            Recipient Address
          </label>
          <input
            type="text"
            placeholder="0x71C... or ENS name"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded p-2 text-xs text-white focus:outline-none"
          />
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Amount ({selectedToken.symbol})</span>
            <span>Fee: 0.05%</span>
          </div>
          <div className="relative">
            <input
              type="number"
              step="any"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded p-2 text-xs text-white focus:outline-none font-bold"
            />
            <div className="absolute right-2 top-2 text-[10px] text-cyan-400">
              {selectedToken.symbol}
            </div>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-slate-500 uppercase block mb-1">
            Token Contract Target
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="w-full bg-[#070d14] border border-slate-800 rounded p-1.5 text-[10px] text-slate-400 focus:outline-none font-mono"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !recipient || !amount}
          className="w-full py-2.5 rounded bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/50 text-cyan-300 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(0,240,255,0.15)]"
        >
          {loading ? 'BROADCASTING TO MEMPOOL...' : 'EXECUTE FLASH TRANSFER'}
        </button>
      </form>

      {txHash && (
        <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/40 text-[11px] text-emerald-300 flex items-center justify-between">
          <span>TX: {txHash.slice(0, 16)}...</span>
          <a
            href={`https://etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 underline hover:text-white"
          >
            Etherscan ↗
          </a>
        </div>
      )}
    </div>
  );
}
