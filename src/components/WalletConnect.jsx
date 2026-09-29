/**
 * WalletConnect panel — real wallet connection UI.
 *
 * Three connection methods, exactly as required:
 *   1. installed browser extensions (MetaMask / Phantom / Trust / Coinbase / OKX …)
 *      discovered through EIP-6963 → only installed wallets are listed, and the
 *      address shown is the one the SELECTED wallet returns.
 *   2. mobile wallets through a live WalletConnect v2 pairing QR code
 *      (WalletQrModal) — no fake "simulated connection" notice anywhere.
 *   3. the branded Reown AppKit modal, which also covers deep links on mobile.
 *
 * The previous implementation listed six hardcoded wallets from `mockData.js`,
 * sent every click to `window.ethereum` and printed a random address when no
 * provider existed — that is what made connections look "random".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { explorerAddressUrl, ACTIVE_CHAIN } from '../wallet/chains.js';
import { importAllFlashAssets } from '../wallet/watchAsset.js';
import WalletQrModal from './WalletQrModal';

function formatNative(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(4);
}

export function WalletConnect() {
  const {
    wallet,
    isConnected,
    isConnecting,
    isRestoring,
    isEvm,
    error,
    clearError,
    address,
    truncatedAddress,
    networkName,
    nativeBalance,
    chains,
    chainId,
    injectedWallets,
    solanaWallets,
    installableWallets,
    appKitAvailable,
    connectWallet,
    connectWalletConnect,
    connectAppKit,
    disconnectWallet,
    switchNetwork,
    pairingUri,
    refreshDetected
  } = useWallet();

  const [isPickerOpen, setPickerOpen] = useState(false);
  const [isQrOpen, setQrOpen] = useState(false);
  const [qrStatus, setQrStatus] = useState('waiting');
  const [qrError, setQrError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [copied, setCopied] = useState(false);
  /** One-click "add all Flash tokens to the wallet" (EIP-747 watchAsset). */
  const [importingTokens, setImportingTokens] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    if (isQrOpen && pairingUri) setQrStatus('waiting');
  }, [isQrOpen, pairingUri]);

  /**
   * Switches the wallet to the Flash network (Polygon in production) and asks it
   * to track every configured Flash token. User-initiated, so MetaMask shows its
   * own native "import token" popups — exactly the flow it trusts.
   */
  const handleImportTokens = useCallback(async () => {
    setImportingTokens(true);
    setImportResult(null);
    try {
      const result = await importAllFlashAssets();
      const parts = [];
      if (result.imported.length) parts.push(`imported: ${result.imported.join(', ')}`);
      if (result.skipped.length) parts.push(`skipped: ${result.skipped.join(', ')}`);
      if (result.failed.length) parts.push(`failed: ${result.failed.join('; ')}`);
      setImportResult(parts.join(' • ') || 'nothing to import');
    } catch (importError) {
      setImportResult(importError.message || 'Token import failed');
    } finally {
      setImportingTokens(false);
    }
  }, []);

  const handleInjectedConnect = useCallback(
    async (entry) => {
      setBusyId(entry.id);
      clearError();
      try {
        await connectWallet(entry);
        setPickerOpen(false);
      } catch {
        /* the hook surfaces the real reason (not installed, user rejected, …) */
      } finally {
        setBusyId(null);
      }
    },
    [clearError, connectWallet]
  );

  const startWalletConnect = useCallback(async () => {
    setQrError(null);
    setQrStatus('waiting');
    setQrOpen(true);
    try {
      await connectWalletConnect();
      setQrStatus('connected');
      setQrOpen(false);
      setPickerOpen(false);
    } catch (pairingError) {
      setQrStatus('error');
      setQrError(pairingError.message || 'WalletConnect pairing failed');
    }
  }, [connectWalletConnect]);

  const startAppKit = useCallback(async () => {
    try {
      await connectAppKit();
      setPickerOpen(false);
    } catch {
      /* hook error banner explains what is missing (usually the project id) */
    }
  }, [connectAppKit]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [address]);

  const onCloseQr = useCallback(() => {
    setQrOpen(false);
    setQrError(null);
  }, []);
  const activeChainInfo = chains.find((chain) => chain.chainId === chainId) || null;
  const explorerUrl = address ? explorerAddressUrl(address, chainId) : null;

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-cyan-400/80 font-mono flex items-center justify-between">
        <span>03 // Settlement Wallet</span>
        <span className="text-[10px] text-slate-500">
          {isConnected ? (isEvm ? 'EVM • EIP-1193' : 'SOLANA') : 'EIP-6963 / WC v2'}
        </span>
      </div>

      {error && (
        <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[10px] font-mono text-rose-300 flex items-start justify-between gap-2">
          <span className="leading-snug">{error}</span>
          <button onClick={clearError} className="text-rose-200 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {isConnected && wallet ? (
        <div className="p-3 rounded-md bg-cyan-950/20 border border-cyan-500/40 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#00ff88]" />
              <span className="text-xs font-mono text-cyan-300 font-semibold">{wallet.name}</span>
              <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1 rounded border border-emerald-500/40">
                {wallet.connectorType === 'injected' ? 'EXTENSION LIVE' : 'SESSION LIVE'}
              </span>
            </div>
            <button
              onClick={copyAddress}
              className="text-[10px] font-mono text-slate-400 hover:text-cyan-300 border border-slate-700 rounded px-1.5 py-0.5"
            >
              {copied ? 'COPIED' : 'COPY'}
            </button>
          </div>

          <div className="text-xs font-mono text-slate-200 break-all" title={wallet.address}>
            {truncatedAddress}
          </div>

          <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
            <span>
              {networkName} • {formatNative(nativeBalance)} {activeChainInfo?.currency || ''}
            </span>
            {explorerUrl && (
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-white underline">
                Explorer ↗
              </a>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <select
              value={chainId ? String(chainId) : ''}
              onChange={(event) => switchNetwork(Number(event.target.value)).catch(() => null)}
              className="flex-1 bg-[#070d14] border border-slate-800 rounded px-2 py-1 text-[10px] font-mono text-slate-300 focus:outline-none"
            >
              {chainId && !activeChainInfo && <option value={String(chainId)}>Chain {chainId}</option>}
              {chains.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => disconnectWallet().catch(() => null)}
              className="text-[11px] font-mono px-2 py-1 rounded bg-slate-800/80 hover:bg-red-950 hover:text-red-400 text-slate-400 border border-slate-700 transition-colors"
            >
              DISCONNECT
            </button>
          </div>

          {/* Make the minted Flash tokens visible in MetaMask & friends (EIP-747). */}
          <button
            onClick={handleImportTokens}
            disabled={importingTokens}
            className="w-full text-[10px] font-mono px-2 py-1.5 rounded bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-500/40 text-cyan-300 disabled:opacity-50 transition-colors"
          >
            {importingTokens
              ? 'IMPORTING TOKENS…'
              : `IMPORT FLASH TOKENS (${activeChainInfo?.shortName || ACTIVE_CHAIN.shortName})`}
          </button>
          {importResult && <div className="text-[9px] font-mono text-slate-500 leading-snug">{importResult}</div>}
        </div>
      ) : (
        <button
          onClick={() => {
            clearError();
            refreshDetected().catch(() => null);
            setPickerOpen(true);
          }}
          disabled={isConnecting || isRestoring}
          className="w-full py-2.5 px-3 rounded-md border border-cyan-500/50 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-300 font-mono text-xs tracking-wider flex items-center justify-center space-x-2 transition-all shadow-[0_0_12px_rgba(0,240,255,0.15)] disabled:opacity-60"
        >
          {isConnecting ? (
            <span className="animate-pulse">WAITING FOR WALLET…</span>
          ) : isRestoring ? (
            <span className="animate-pulse">RESTORING SESSION…</span>
          ) : (
            <>
              <span>CONNECT WEB3 WALLET</span>
              <span className="text-xs">⚡</span>
            </>
          )}
        </button>
      )}
      {isPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="cyber-panel p-5 rounded-lg max-w-lg w-full border border-cyan-500/30 shadow-glow-cyan max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-sm font-mono font-bold text-cyan-300 tracking-wider">SELECT WALLET CONNECTOR</span>
              <div className="flex items-center space-x-2">
                <button onClick={() => refreshDetected().catch(() => null)} className="text-[10px] font-mono text-slate-400 hover:text-cyan-300">
                  RESCAN
                </button>
                <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-white font-mono text-sm">
                  ✕
                </button>
              </div>
            </div>

            {!appKitAvailable && (
              <div className="p-2 rounded bg-amber-950/30 border border-amber-500/40 text-[10px] font-mono text-amber-300 leading-snug">
                WalletConnect / Reown AppKit is not configured yet: add
                <span className="text-amber-100"> VITE_WALLETCONNECT_PROJECT_ID</span> to the root .env (free id at
                dashboard.reown.com) and restart the dev server. Extension wallets below work without it.
              </div>
            )}

            <div>
              <div className="text-[10px] font-mono text-slate-400 uppercase mb-2">
                Installed browser extensions ({injectedWallets.length})
              </div>
              {injectedWallets.length === 0 ? (
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-[11px] font-mono text-slate-400">
                  No EVM extension wallet detected. Install one below, or use the WalletConnect QR code with your phone
                  wallet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {injectedWallets.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => handleInjectedConnect(entry)}
                      disabled={busyId === entry.id}
                      className="p-3 rounded-md bg-slate-900/80 border border-slate-800 hover:border-cyan-400 hover:bg-slate-800/60 text-left transition-all flex items-center space-x-2.5 disabled:opacity-50"
                    >
                      <span className="text-lg">{entry.icon}</span>
                      <span className="text-xs font-mono font-semibold text-slate-200">
                        {busyId === entry.id ? 'Connecting…' : entry.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-slate-400 uppercase">Mobile / hardware wallets</div>
              <button
                onClick={startWalletConnect}
                className="w-full p-2.5 rounded-md bg-slate-900/80 border border-slate-800 hover:border-cyan-400 text-left flex items-center justify-between"
              >
                <span className="flex items-center space-x-2 text-xs font-mono text-slate-200">
                  <span className="text-lg">🔗</span>
                  <span>WalletConnect v2 — scan QR code</span>
                </span>
                <span className="text-[10px] font-mono text-cyan-400">PAIR ↗</span>
              </button>
              <button
                onClick={startAppKit}
                disabled={!appKitAvailable}
                className="w-full p-2.5 rounded-md bg-slate-900/80 border border-slate-800 hover:border-cyan-400 text-left flex items-center justify-between disabled:opacity-50"
              >
                <span className="flex items-center space-x-2 text-xs font-mono text-slate-200">
                  <span className="text-lg">⚡</span>
                  <span>Reown AppKit — all wallets, QR + deep links</span>
                </span>
                <span className="text-[10px] font-mono text-cyan-400">OPEN ↗</span>
              </button>
            </div>

            {solanaWallets.length > 0 && (
              <div>
                <div className="text-[10px] font-mono text-slate-400 uppercase mb-2">
                  Solana extensions (read-only for withdrawals)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {solanaWallets.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => handleInjectedConnect(entry)}
                      disabled={busyId === entry.id}
                      className="p-3 rounded-md bg-slate-900/80 border border-slate-800 hover:border-purple-400 text-left flex items-center space-x-2.5 disabled:opacity-50"
                    >
                      <span className="text-lg">{entry.icon}</span>
                      <span className="text-xs font-mono font-semibold text-slate-200">{entry.name}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">
                  Withdrawals are minted as ERC-20 Flash tokens (USDT/BTC/ETH/TRX/SOL), so an EVM wallet is required for that step.
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] font-mono text-slate-400 uppercase mb-2">Not installed — get an extension</div>
              <div className="flex flex-wrap gap-1.5">
                {installableWallets.map((walletEntry) => (
                  <a
                    key={walletEntry.id}
                    href={walletEntry.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono px-2 py-1 rounded border border-slate-800 bg-slate-900/70 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40"
                  >
                    {walletEntry.icon} {walletEntry.name}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {isQrOpen && (
        <WalletQrModal
          uri={pairingUri}
          status={qrStatus}
          error={qrError}
          onClose={onCloseQr}
          onRetry={startWalletConnect}
        />
      )}
    </div>
  );
}

export default WalletConnect;
