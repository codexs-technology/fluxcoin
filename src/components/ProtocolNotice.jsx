import React from 'react';

export function ProtocolNotice() {
  return (
    <div className="p-3 rounded bg-cyan-950/20 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] space-y-1">
      <div className="flex items-center space-x-1.5 font-bold text-cyan-400 uppercase tracking-wide">
        <span>⚡ FLUXCOIN BLOCKCHAIN ENCLAVE</span>
      </div>
      <p className="text-slate-300 leading-snug">
        Real Web3 blockchain integration active. Connecting your wallet allows executing <strong className="text-emerald-300 font-semibold">real on-chain FlashToken transfers</strong>, DEX router swaps, and flash mint calls directly from your provider.
      </p>
      <p className="text-slate-400 font-medium pt-0.5">
        &gt; Always inspect gas parameters and contract approvals in your wallet before signing transactions.
      </p>
    </div>
  );
}

