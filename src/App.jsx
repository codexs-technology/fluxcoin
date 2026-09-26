import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { TokenSelector } from './components/TokenSelector';
import { FeeTiers } from './components/FeeTiers';
import { WalletConnect } from './components/WalletConnect';
import { ForgeSequence } from './components/ForgeSequence';
import { NetworkTelemetry } from './components/NetworkTelemetry';
import { TerminalOutput } from './components/TerminalOutput';
import { ProtocolNotice } from './components/ProtocolNotice';
import { OperationLedger } from './components/OperationLedger';
import TokenTransfer from './components/TokenTransfer';
import TokenSwap from './components/TokenSwap';
import TokenTrade from './components/TokenTrade';
import { useWallet } from './hooks/useWallet';

export default function App() {
  const [activeTab, setActiveTab] = useState('forge');
  const { connectedWallet } = useWallet();

  useEffect(() => {
    window.confetti = confetti;
  }, []);

  return (
    <div className="min-h-screen bg-[#05080c] text-slate-200 p-3 sm:p-6 lg:p-8 flex flex-col justify-between font-mono">
      {/* Top Header */}
      <header className="mb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-cyan-500/20 pb-4 gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded bg-cyan-500/10 border border-cyan-400 flex items-center justify-center text-cyan-300 font-bold text-lg shadow-glow-cyan">
            ⚡
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-white flex items-center space-x-2">
              <span>FLUXCOIN</span>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-normal">
                FLASH TOKEN PLATFORM
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Real Blockchain Enclave // Transferable, Swappable & Tradable Flash Tokens
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1.5 bg-slate-900/80 px-3 py-1.5 rounded border border-slate-800">
            <span className={`w-2 h-2 rounded-full ${connectedWallet?.isReal ? 'bg-emerald-400' : 'bg-cyan-400'} animate-pulse`} />
            <span className="text-slate-400">NODE:</span>
            <span className="text-white font-bold">{connectedWallet?.networkName || 'Ethereum Web3'}</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-2 mb-5 overflow-x-auto pb-1">
        {[
          { id: 'forge', label: '01 // FLASH FORGE & 3D' },
          { id: 'transfer', label: '02 // FLASH TRANSFER' },
          { id: 'swap', label: '03 // DEX SWAP' },
          { id: 'trade', label: '04 // ORDERBOOK TRADE' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded text-xs font-bold tracking-wide transition-all uppercase whitespace-nowrap border ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-glow-cyan'
                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main 3-Panel Layout */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
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

        {/* Center Panel */}
        <section className="lg:col-span-5 cyber-panel p-4 rounded-lg flex flex-col justify-between">
          <div className="border-b border-slate-800/80 pb-2 mb-3 flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
              {activeTab === 'forge' && 'TOKEN SYNTHESIZER // FORGE PIPELINE'}
              {activeTab === 'transfer' && 'ON-CHAIN TRANSFER ENGINE'}
              {activeTab === 'swap' && 'DEFI AMM SWAP ROUTER'}
              {activeTab === 'trade' && 'LIMIT & MARKET ORDERBOOK'}
            </span>
            <span className="text-[10px] text-emerald-400">STATUS: READY</span>
          </div>

          {activeTab === 'forge' && <ForgeSequence />}
          {activeTab === 'transfer' && <TokenTransfer />}
          {activeTab === 'swap' && <TokenSwap />}
          {activeTab === 'trade' && <TokenTrade />}
        </section>

        {/* Right Panel */}
        <section className="lg:col-span-4 cyber-panel p-4 rounded-lg space-y-4 flex flex-col justify-between">
          <NetworkTelemetry />
          <TerminalOutput />
          <ProtocolNotice />
        </section>
      </main>

      <section className="mb-4">
        <OperationLedger />
      </section>

      <footer className="pt-4 border-t border-slate-900 text-center text-xs text-slate-600 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>FLUXCOIN FLASH TOKEN PROTOCOL // DEPLOYABLE ON ETHEREUM / POLYGON / BSC</div>
        <div className="text-[11px] text-slate-500">POWERED BY ETHERS.JS, UNISWAP V2 ROUTER & THREE.JS</div>
      </footer>
    </div>
  );
}

