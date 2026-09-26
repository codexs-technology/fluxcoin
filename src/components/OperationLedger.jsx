import React from 'react';
import { useAppStore } from '../store/useAppStore';

export function OperationLedger() {
  const withdrawalQueue = useAppStore((s) => s.withdrawalQueue);
  const operationLedger = useAppStore((s) => s.operationLedger);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 font-mono text-xs">
      {/* Left 1/3: Withdrawal Queue */}
      <div className="cyber-panel p-4 rounded-lg flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
            <span className="font-bold text-cyan-400 uppercase tracking-wide">
              WITHDRAWAL QUEUE
            </span>
            <span className="text-[10px] text-slate-500">{withdrawalQueue.length} PENDING</span>
          </div>
          <div className="space-y-2">
            {withdrawalQueue.map((item) => (
              <div
                key={item.id}
                className="p-2 rounded bg-slate-900/60 border border-slate-800/80 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{item.asset}</span>
                    <span className="text-cyan-300 font-semibold">{item.amount}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Dest: {item.dest}</div>
                </div>
                <div className="text-right">
                  <div className="text-amber-400 font-bold">{item.eta}</div>
                  <span className="text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-800">
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 pt-2 border-t border-slate-800/60 text-[10px] text-slate-500 text-center">
          AUTO-SETTLING DISPERSE PIPELINE
        </div>
      </div>

      {/* Right 2/3: Operation Ledger Table */}
      <div className="cyber-panel p-4 rounded-lg lg:col-span-2 overflow-x-auto">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
          <span className="font-bold text-cyan-400 uppercase tracking-wide">
            OPERATION LEDGER // AUDIT TRAIL
          </span>
          <span className="text-[10px] text-emerald-400 font-bold">SHA-256 SYNCHRONIZED</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 text-[11px]">
                <th className="pb-2 font-normal">TIME (UTC)</th>
                <th className="pb-2 font-normal">OPERATION</th>
                <th className="pb-2 font-normal">ASSET</th>
                <th className="pb-2 font-normal text-right">VALUE</th>
                <th className="pb-2 font-normal text-right">FEE</th>
                <th className="pb-2 font-normal">TX HASH</th>
                <th className="pb-2 font-normal text-right">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/80">
              {operationLedger.map((row) => (
                <tr key={row.id} className="hover:bg-cyan-950/20 transition-colors">
                  <td className="py-2.5 text-slate-400 text-[11px]">{row.time}</td>
                  <td className="py-2.5 font-bold text-cyan-300">{row.op}</td>
                  <td className="py-2.5 text-slate-200">{row.asset}</td>
                  <td className="py-2.5 text-right font-bold text-white">{row.value}</td>
                  <td className="py-2.5 text-right text-emerald-400">{row.fee}</td>
                  <td className="py-2.5 text-slate-400 font-mono text-[11px]">{row.tx}</td>
                  <td className="py-2.5 text-right">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
