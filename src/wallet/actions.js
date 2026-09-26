/**
 * High level wallet actions used by the React components.
 * Every function throws a *real* error when something is missing — a wallet that
 * is not installed is never silently replaced by a fake one.
 */
import { walletManager } from './manager.js';
import { discoverAllWallets } from './eip6963.js';

/** Connect an installed browser extension wallet (MetaMask, Phantom, Trust, ...). */
export async function connectWithInjected(walletEntry) {
  return walletManager.connectInjected(walletEntry);
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
