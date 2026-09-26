import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { tokens } from '../utils/mockData';

export function TokenSelector() {
  const selectedToken = useAppStore((s) => s.selectedToken);
  const setSelectedToken = useAppStore((s) => s.setSelectedToken);
  const customTokenName = useAppStore((s) => s.customTokenName);
  const setCustomTokenName = useAppStore((s) => s.setCustomTokenName);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wider text-cyan-400/80 font-mono mb-2 flex items-center justify-between">
          <span>01 // Select Asset Preset</span>
          <span className="text-[10px] text-slate-500">STANDARDS</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {tokens.map((token) => {
            const isSelected = selectedToken.id === token.id;
            return (
              <button
                key={token.id}
                onClick={() => setSelectedToken(token)}
                className={`p-3 rounded-md text-left border transition-all duration-200 flex flex-col justify-between ${
                  isSelected
                    ? 'border-cyan-400 bg-cyan-950/40 shadow-glow-cyan text-white'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-sm tracking-wide text-white">{token.symbol}</span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: token.color }}
                  />
                </div>
                <div className="text-[10px] text-slate-400 mt-2 font-mono flex justify-between">
                  <span>{token.type}</span>
                  <span className="text-cyan-400/80">{token.decimals}d</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wider text-cyan-400/80 font-mono mb-1.5 flex items-center justify-between">
          <span>Custom Token Name</span>
          <span className="text-[10px] text-slate-500">OPTIONAL OVERRIDE</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={customTokenName}
            onChange={(e) => setCustomTokenName(e.target.value)}
            placeholder={`Override: e.g. "Cyber ${selectedToken.name}"`}
            maxLength={32}
            className="w-full bg-[#070d14] border border-slate-800 focus:border-cyan-400 rounded-md py-2 px-3 text-sm text-cyan-300 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-all placeholder:text-slate-600"
          />
          {customTokenName && (
            <button
              onClick={() => setCustomTokenName('')}
              className="absolute right-2.5 top-2.5 text-xs text-slate-500 hover:text-cyan-400 font-mono"
            >
              CLEAR
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
