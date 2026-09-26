import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { Token3DCanvas } from './Token3DCanvas';
import { calculateActivationFee } from '../utils/feeCalculator';

export function ForgeSequence() {
  const {
    selectedToken,
    customTokenName,
    mintQuantity,
    setMintQuantity,
    selectedTier,
    telemetry,
    isForging,
    forgeProgress,
    triggerTokenForge
  } = useAppStore();

  const tokenSymbol = customTokenName.trim()
    ? customTokenName.toUpperCase().slice(0, 8)
    : selectedToken.symbol;

  const fee = calculateActivationFee(selectedTier.id, mintQuantity, telemetry.gasPressure);

  return (
    <div className="space-y-4">
      {/* 3D Visualizer Canvas */}
      <Token3DCanvas />

      {/* Mint Quantity Input */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono text-cyan-400/80">
          <span>FORGE ALLOCATION QUANTITY</span>
          <span className="text-[10px] text-slate-500">MAX: 100,000,000</span>
        </div>
        <div className="relative">
          <input
            type="number"
            min="1"
            max="100000000"
            value={mintQuantity}
            onChange={(e) => setMintQuantity(e.target.value)}
            disabled={isForging}
            className="w-full bg-[#070d14] border border-cyan-500/30 focus:border-cyan-400 rounded-md py-2.5 px-3 text-lg text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50 tracking-wider"
          />
          <div className="absolute right-3 top-3 text-xs font-mono text-cyan-400 font-bold">
            {tokenSymbol}
          </div>
        </div>

        {/* Quick presets */}
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {['1000', '10000', '100000', '1000000'].map((preset) => (
            <button
              key={preset}
              onClick={() => setMintQuantity(preset)}
              disabled={isForging}
              className="py-1 text-[10px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 rounded border border-slate-800 hover:border-cyan-500/40 transition-colors"
            >
              +{Number(preset).toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {/* Activation Fee Breakdown */}
      <div className="p-3 rounded-md bg-slate-900/60 border border-slate-800 space-y-1.5 text-xs font-mono">
        <div className="flex justify-between text-slate-400">
          <span>TIER BASE ({selectedTier.name})</span>
          <span className="text-slate-200">${selectedTier.fee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>DYNAMIC GAS ADJ ({telemetry.gasPressure} Gwei)</span>
          <span className="text-slate-200">
            +${((telemetry.gasPressure / 25) * (selectedTier.fee * 0.08)).toFixed(2)}
          </span>
        </div>
        <div className="border-t border-slate-800 pt-1.5 flex justify-between font-bold text-sm">
          <span className="text-cyan-300">TOTAL ACTIVATION FEE</span>
          <span className="text-emerald-400 font-bold">${fee.toFixed(2)} USD</span>
        </div>
      </div>

      {/* Progress Bar (Visible during forge) */}
      {isForging && (
        <div className="space-y-1 animate-fadeIn">
          <div className="flex justify-between text-[11px] font-mono text-cyan-400">
            <span>SEALING MERKLE ENCLAVE...</span>
            <span>{forgeProgress}%</span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-400 to-emerald-400 h-full transition-all duration-300 shadow-[0_0_10px_#00f0ff]"
              style={{ width: `${forgeProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Generate Tokens Action Button */}
      <button
        onClick={triggerTokenForge}
        disabled={isForging || !mintQuantity || Number(mintQuantity) <= 0}
        className={`w-full py-3.5 px-4 rounded-md font-mono font-bold text-sm tracking-wider uppercase transition-all duration-200 shadow-glow-cyan ${
          isForging
            ? 'bg-cyan-900/50 text-cyan-200 cursor-not-allowed border border-cyan-400/50 animate-pulse'
            : 'bg-gradient-to-r from-cyan-500/20 via-cyan-400/30 to-emerald-500/20 hover:from-cyan-500/30 hover:to-emerald-500/30 text-white border border-cyan-400 hover:shadow-[0_0_25px_rgba(0,240,255,0.4)]'
        }`}
      >
        {isForging ? 'COMPUTING SIMULATION MINT...' : `GENERATE ${tokenSymbol} TOKENS`}
      </button>

      <div className="text-[10px] text-center font-mono text-slate-500">
        * Non-functional simulation. Generates mock ledger cryptographic receipts.
      </div>
    </div>
  );
}
