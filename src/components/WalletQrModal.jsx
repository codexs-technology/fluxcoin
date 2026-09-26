/**
 * WalletConnect v2 pairing modal: renders the LIVE pairing URI as a QR code and
 * offers deep links so a phone browser can jump straight into the wallet app.
 *
 * The QR is drawn from the real `uri` emitted by the WalletConnect provider
 * (`display_uri` event) — it is never a static/placeholder image.
 */
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { createDeepLinks } from '../wallet/walletConnectEngine.js';

export default function WalletQrModal({ uri, status = 'waiting', error, onClose, onRetry }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);

  useEffect(() => {
    let active = true;
    if (!uri) {
      setQrDataUrl(null);
      return () => {
        active = false;
      };
    }
    QRCode.toDataURL(uri, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#03121a', light: '#d8f6ff' }
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [uri]);

  const deepLinks = useMemo(() => createDeepLinks(uri), [uri]);
  const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="cyber-panel p-5 rounded-lg max-w-md w-full border border-cyan-500/30 shadow-glow-cyan space-y-4">
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="text-sm font-mono font-bold text-cyan-300 tracking-wider">SCAN WITH YOUR MOBILE WALLET</div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5">WalletConnect v2 pairing session</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-mono text-sm">
            ✕
          </button>
        </div>

        {error && (
          <div className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-[11px] font-mono text-rose-300">{error}</div>
        )}

        <div className="flex flex-col items-center space-y-3">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="WalletConnect pairing QR code"
              className="w-56 h-56 rounded border border-cyan-500/40 bg-[#03121a] p-1"
            />
          ) : (
            <div className="w-56 h-56 rounded border border-slate-700 bg-slate-900/60 flex items-center justify-center text-[11px] font-mono text-slate-500 text-center px-4">
              {uri ? 'Rendering QR code…' : 'Requesting pairing URI from WalletConnect…'}
            </div>
          )}

          <div className="text-[11px] font-mono text-center">
            {status === 'waiting' && <span className="text-cyan-300 animate-pulse">WAITING FOR WALLET APPROVAL…</span>}
            {status === 'connected' && <span className="text-emerald-400">SESSION APPROVED — FINALIZING…</span>}
            {status === 'error' && <span className="text-rose-400">PAIRING FAILED</span>}
          </div>
        </div>

        {isMobile && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Open directly in …</div>
            <div className="grid grid-cols-2 gap-1.5">
              {deepLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  className="px-2 py-1.5 rounded border border-slate-700 bg-slate-900/70 hover:border-cyan-400 text-[11px] font-mono text-slate-200 flex items-center space-x-1.5"
                >
                  <span>{link.icon}</span>
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {uri && (
          <details className="text-[10px] font-mono text-slate-500">
            <summary className="cursor-pointer hover:text-cyan-400">Show raw pairing URI</summary>
            <textarea
              readOnly
              value={uri}
              rows={3}
              className="mt-1 w-full bg-[#070d14] border border-slate-800 rounded p-1.5 text-slate-400 break-all"
            />
          </details>
        )}

        <div className="flex items-center justify-between pt-1">
          <button onClick={onRetry} className="text-[11px] font-mono text-cyan-400 hover:text-white underline">
            REGENERATE PAIRING
          </button>
          <button
            onClick={onClose}
            className="text-[11px] font-mono px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
