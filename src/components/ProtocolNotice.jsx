/**
 * Honest protocol notice: what is real, what is not.
 */
export function ProtocolNotice() {
  return (
    <div className="p-3 rounded bg-cyan-950/20 border border-cyan-500/30 text-cyan-300 font-mono text-[11px] space-y-1">
      <div className="flex items-center space-x-1.5 font-bold text-cyan-400 uppercase tracking-wide">
        <span>⚡ FLUXCOIN — REAL ON-CHAIN WIRING</span>
      </div>
      <p className="text-slate-300 leading-snug">
        Wallet connections are real (EIP-6963 extensions, WalletConnect v2 QR, Reown AppKit). Generated coins are credited
        to your <strong className="text-emerald-300 font-semibold">site balance</strong> by the Cloudflare Worker API and
        withdrawn as real ERC-20 <strong className="text-emerald-300 font-semibold">FLUX</strong> (18 decimals) to your own
        address.
      </p>
      <p className="text-slate-400 font-medium pt-0.5">
        &gt; Withdrawals are gas-sponsored by the project (sponsored ERC-4337 UserOperation or a project-wallet mint) — you
        pay 0 gas. Transfers and DEX swaps are normal signed transactions and do cost network gas.
      </p>
    </div>
  );
}

