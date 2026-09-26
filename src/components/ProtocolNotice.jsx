import React from 'react';

export function ProtocolNotice() {
  return (
    <div className="p-3 rounded bg-amber-950/20 border border-amber-500/30 text-amber-300 font-mono text-[11px] space-y-1">
      <div className="flex items-center space-x-1.5 font-bold text-amber-400 uppercase tracking-wide">
        <span>⚠️ CRITICAL PROTOCOL NOTICE</span>
      </div>
      <p className="text-slate-300 leading-snug">
        This is an <strong className="text-amber-300 font-semibold">interactive 3D simulation</strong> for UI/UX demonstration purposes. <strong className="text-amber-300 font-semibold">No blockchain is touched</strong>, no real transactions are submitted to mainnet, and no cryptographic keys or funds are moved.
      </p>
      <p className="text-amber-400/90 font-medium pt-0.5">
        &gt; Never send money or enter seed phrases to an unknown terminal screen like this in the real world.
      </p>
    </div>
  );
}
