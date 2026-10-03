/**
 * High level wallet actions used by the React components.
 * Every function throws a *real* error when something is missing — a wallet that
 * is not installed is never silently replaced by a fake one.
 */
import { walletManager } from './manager.js';
import { discoverAllWallets, findTrustWalletEntry } from './eip6963.js';

/** Connect an installed browser extension wallet (MetaMask, Phantom, Trust, ...). */
export async function connectWithInjected(walletEntry) {
  return walletManager.connectInjected(walletEntry);
}

/**
 * Manual "Trust Wallet" connect — used by the pinned button in the wallet
 * picker. Works even when the EIP-6963 announcement was missed or the
 * extension uses an unexpected rdns: every discovered Trust build matches, and
 * the documented `window.trustwallet` injection point is checked directly.
 * Throws an error with code `TRUST_WALLET_NOT_FOUND` when nothing is installed
 * so the UI can fall back to the WalletConnect QR / Trust deep link.
 */
export async function connectTrustWallet() {
  const discovered = await discoverAllWallets();
  const entry = findTrustWalletEntry(discovered);
  if (!entry) {
    const error = new Error(
      'Trust Wallet was not detected in this browser. Install the extension from trustwallet.com/download and reload, or use the WalletConnect QR code with the Trust mobile app.'
    );
    error.code = 'TRUST_WALLET_NOT_FOUND';
    throw error;
  }
  return walletManager.connectInjected(entry);
}

/** Connect a mobile wallet through WalletConnect v2 (QR + deep link). */
export async function connectWithWalletConnect(options) {
  return walletManager.connectWalletConnect(options);
}

/** Open the branded Reown AppKit modal (all wallets, QR codes, deep links). */
export async function connectWithAppKit() {
  return walletManager.connectAppKit();
}

/** Connect Phantom/Solflare on Solana (display only — EVM is required to withdraw). */
export async function connectWithSolana(walletEntry) {
  return walletManager.connectSolana(walletEntry);
}

export async function disconnectWallet() {
  return walletManager.disconnect();
}

export async function switchWalletChain(chainId) {
  return walletManager.switchChain(chainId);
}

/** Reconnect on page reload (injected `eth_accounts`, WC session, AppKit session). */
export async function restoreWalletSession() {
  await walletManager.discover();
  return walletManager.restore();
}

/** Ethereum provider usable by ethers (throws instead of pretending). */
export async function ensureEip1193Provider() {
  return walletManager.getEip1193Provider();
}

export { discoverAllWallets };
