import React from 'react';
import { useTerminal } from '../hooks/useTerminal';

export function TerminalOutput() {
  const { terminalLogs, bottomRef } = useTerminal();

  return (
    <div className="space-y-1.5 font-mono">
      <div className="flex items-center justify-between text-xs text-cyan-400/90 pb-1 border-b border-slate-800">
        <span>LIVE TERMINAL OUTPUT</span>
        <span className="text-[10px] text-slate-500">STDOUT // VTY1</span>
      </div>

      <div className="bg-[#030609] border border-slate-800/80 rounded p-2.5 h-44 overflow-y-auto text-[11px] space-y-1 select-text">
        {terminalLogs.map((log) => {
          let color = 'text-slate-400';
          if (log.type === 'sys') color = 'text-cyan-400';
          if (log.type === 'success') color = 'text-emerald-400';
          if (log.type === 'warn') color = 'text-amber-400';
          if (log.type === 'error') color = 'text-rose-400';

          return (
            <div key={log.id} className="leading-relaxed flex items-start space-x-1.5">
              <span className="text-slate-600 select-none">&gt;</span>
              <span className={`${color} break-all`}>{log.text}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
