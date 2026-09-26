import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { feeTiers } from '../utils/mockData';

export function FeeTiers() {
  const selectedTier = useAppStore((s) => s.selectedTier);
  const setSelectedTier = useAppStore((s) => s.setSelectedTier);

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-cyan-400/80 font-mono flex items-center justify-between">
        <span>02 // Execution Fee Tier</span>
        <span className="text-[10px] text-slate-500">RELAY PRIORITY</span>
      </div>
      <div className="space-y-2">
        {feeTiers.map((tier) => {
          const isSelected = selectedTier.id === tier.id;
          return (
            <div
              key={tier.id}
              onClick={() => setSelectedTier(tier)}
              className={`p-2.5 rounded-md border cursor-pointer transition-all ${
                isSelected
                  ? 'border-emerald-400/80 bg-emerald-950/30 text-white shadow-glow-green'
                  : 'border-slate-800/80 bg-slate-900/40 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isSelected ? 'bg-emerald-400 shadow-[0_0_8px_#00ff88]' : 'bg-slate-700'
                    }`}
                  />
                  <span className="text-sm font-semibold tracking-wide text-slate-200">
                    {tier.name}
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-emerald-400">
                  ${tier.fee.toLocaleString()} USD
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-1 font-mono flex justify-between">
                <span>{tier.desc}</span>
                <span className="text-slate-500">Min: {tier.min.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
