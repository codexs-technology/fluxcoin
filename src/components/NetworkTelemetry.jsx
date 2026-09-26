import React from 'react';
import { useTelemetry } from '../hooks/useTelemetry';
import { useAppStore } from '../store/useAppStore';

export function NetworkTelemetry() {
  const telemetry = useTelemetry();
  const sessionMode = useAppStore((s) => s.sessionMode);

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
        <span className="text-xs font-bold text-cyan-400/90 tracking-wider">
          NETWORK TELEMETRY
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          <span>LIVE</span>
        </span>
      </div>

      {/* Grid of Key Telemetry metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">HASH RATE</div>
          <div className="text-sm font-bold text-cyan-300 mt-0.5">
            {telemetry.hashRate} <span className="text-[10px] text-slate-400">TH/s</span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">MEMPOOL LOAD</div>
          <div className="text-sm font-bold text-slate-200 mt-0.5">
            {telemetry.mempoolLoad.toLocaleString()} <span className="text-[10px] text-slate-400">tx</span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">THROUGHPUT</div>
          <div className="text-sm font-bold text-emerald-400 mt-0.5">
            {telemetry.throughput} <span className="text-[10px] text-slate-400">TPS</span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">PEER MESH</div>
          <div className="text-sm font-bold text-cyan-300 mt-0.5">
            {telemetry.peerMesh} <span className="text-[10px] text-slate-400">peers</span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">GAS PRESSURE</div>
          <div className="text-sm font-bold text-amber-400 mt-0.5">
            {telemetry.gasPressure} <span className="text-[10px] text-slate-400">gwei</span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-900/50 border border-slate-800">
          <div className="text-[10px] text-slate-500">CURRENT BLOCK #</div>
          <div className="text-sm font-bold text-cyan-400 mt-0.5">
            #{telemetry.currentBlock}
          </div>
        </div>
      </div>

      {/* Settlement Status & Session Mode */}
      <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800 text-[11px] space-y-1">
        <div className="flex justify-between">
          <span className="text-slate-500">SETTLEMENT STATUS:</span>
          <span className="text-emerald-400 font-semibold">{telemetry.settlementStatus}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">SESSION MODE:</span>
          <span className="text-cyan-300 text-[10px]">{sessionMode}</span>
        </div>
      </div>
    </div>
  );
}
