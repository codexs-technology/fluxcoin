import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { walletProviders } from '../utils/mockData';

export function WalletConnect() {
  const { connectedWallet, isConnectingWallet, connectWallet, disconnectWallet } = useWallet();
  const [isOpenModal, setIsOpenModal] = useState(false);

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-cyan-400/80 font-mono flex items-center justify-between">
        <span>03 // Settlement Wallet</span>
        <span className="text-[10px] text-slate-500">ECDSA P-256</span>
      </div>

      {connectedWallet ? (
        <div className="p-3 rounded-md bg-cyan-950/20 border border-cyan-500/40 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#00ff88]" />
              <span className="text-xs font-mono text-cyan-300 font-semibold">{connectedWallet.name}</span>
            </div>
            <div className="text-xs font-mono text-slate-400 mt-0.5">{connectedWallet.address}</div>
          </div>
          <button
            onClick={disconnectWallet}
            className="text-[11px] font-mono px-2 py-1 rounded bg-slate-800/80 hover:bg-red-950 hover:text-red-400 text-slate-400 border border-slate-700 transition-colors"
          >
            DISCONNECT
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={() => setIsOpenModal(true)}
            disabled={isConnectingWallet}
            className="w-full py-2.5 px-3 rounded-md border border-cyan-500/50 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-300 font-mono text-xs tracking-wider flex items-center justify-center space-x-2 transition-all shadow-[0_0_12px_rgba(0,240,255,0.15)]"
          >
            {isConnectingWallet ? (
              <span className="animate-pulse">CONNECTING SECURE ENCLAVE...</span>
            ) : (
              <>
                <span>CONNECT WEB3 WALLET</span>
                <span className="text-xs">⚡</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Wallet Selector Modal */}
      {isOpenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="cyber-panel p-5 rounded-lg max-w-sm w-full border border-cyan-500/30 shadow-glow-cyan">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-sm font-mono font-bold text-cyan-300 tracking-wider">
                SELECT WALLET PROVIDER
              </span>
              <button
                onClick={() => setIsOpenModal(false)}
                className="text-slate-400 hover:text-white font-mono text-sm"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {walletProviders.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    connectWallet(w.name);
                    setIsOpenModal(false);
                  }}
                  className="p-3 rounded-md bg-slate-900/80 border border-slate-800 hover:border-cyan-400 hover:bg-slate-800/60 text-left transition-all flex items-center space-x-2.5"
                >
                  <span className="text-lg">{w.icon}</span>
                  <span className="text-xs font-mono font-semibold text-slate-200">{w.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 text-[10px] text-slate-500 font-mono text-center">
              * Simulated connection. No seed phrase or actual RPC transmission required.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
