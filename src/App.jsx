import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { TokenSelector } from './components/TokenSelector';
import { FeeTiers } from './components/FeeTiers';
import { WalletConnect } from './components/WalletConnect';
import { ForgeSequence } from './components/ForgeSequence';
import { NetworkTelemetry } from './components/NetworkTelemetry';
import { TerminalOutput } from './components/TerminalOutput';
import { ProtocolNotice } from './components/ProtocolNotice';
import { OperationLedger } from './components/OperationLedger';

export default function App() {
  useEffect(() => {
    // Expose confetti to window for triggerTokenForge hook
    window.confetti = confetti;
  }, []);

  return (
    <div className="min-h-screen bg-[#05080c] text-slate-200 p-3 sm:p-6 lg:p-8 flex flex-col justify-between font-mono">
      {/* Top Header / Cyber Bar */}
      <header className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-cyan-500/20 pb-4 gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded bg-cyan-500/10 border border-cyan-400 flex items-center justify-center text-cyan-300 font-bold shadow-glow-cyan">
            TF
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-white flex items-center space-x-2">
              <span>TOKENFORGE 3D</span>
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-normal">
                SIMULATION ENCLAVE v4.2
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Interactive 3D Token Generation & High-Throughput Settlement Terminal
            </p>
          </div>
        </div>

        {/* Global Security / System Status Pill */}
        <div className="flex items-center space-x-4 text-xs">
          <div className="flex items-center space-x-1.5 bg-slate-900/80 px-3 py-1.5 rounded border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-400">CORE STATUS:</span>
            <span className="text-emerald-400 font-bold">ONLINE</span>
          </div>
          <div className="hidden md:flex items-center space-x-1.5 bg-slate-900/80 px-3 py-1.5 rounded border border-slate-800">
            <span className="text-slate-400">NETWORK:</span>
            <span className="text-cyan-300 font-bold">SIMULATED MESH</span>
          </div>
        </div>
      </header>

      {/* Main 3-Panel Modular Grid Layout */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
        {/* Left Panel: Token selection, Fee tiers, Wallet Connect */}
        <section className="lg:col-span-3 cyber-panel p-4 rounded-lg space-y-5 flex flex-col justify-between">
          <div className="space-y-5">
            <div className="border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                CONFIGURATION MATRIX
              </span>
            </div>
            <TokenSelector />
            <FeeTiers />
          </div>
          <div className="pt-2 border-t border-slate-800/80">
            <WalletConnect />
          </div>
        </section>

        {/* Center Panel: 3D Token visualizer, Forge sequence & Activation Fee */}
        <section className="lg:col-span-5 cyber-panel p-4 rounded-lg flex flex-col justify-between">
          <div className="border-b border-slate-800/80 pb-2 mb-3">
            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
              TOKEN SYNTHESIZER // FORGE PIPELINE
            </span>
          </div>
          <ForgeSequence />
        </section>

        {/* Right Panel: Network Telemetry, Live Terminal Output, Protocol Notice */}
        <section className="lg:col-span-4 cyber-panel p-4 rounded-lg space-y-4 flex flex-col justify-between">
          <NetworkTelemetry />
          <TerminalOutput />
          <ProtocolNotice />
        </section>
      </main>

      {/* Bottom Section: Withdrawal Queue & Operation Ledger */}
      <section className="mb-4">
        <OperationLedger />
      </section>

      {/* Footer */}
      <footer className="pt-4 border-t border-slate-900 text-center text-xs text-slate-600 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          TOKENFORGE 3D SIMULATION TERMINAL // ZERO-MAINNET TRANSACTIONS
        </div>
        <div className="text-[11px] text-slate-500">
          DEVELOPED WITH REACT, VITE, THREE.JS, TAILWIND CSS & ZUSTAND
        </div>
      </footer>
    </div>
  );
}
