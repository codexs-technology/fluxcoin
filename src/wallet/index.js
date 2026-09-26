/**
 * Wallet module barrel export.
 *
 *   wallet/
 *     manager.js             - the WalletManager singleton (source of truth)
 *     eip6963.js             - installed extension discovery (EIP-6963)
 *     appkit.js              - Reown AppKit (WalletConnect v2) universal modal
 *     walletConnectEngine.js - raw WC v2 provider (in-app QR + deep links)
 *     gasless.js             - zero-fee withdrawal driver (4337 / relayer)
 *     chains.js              - supported networks + RPC + explorers
 *     session.js             - localStorage session persistence / reconnection
 *     format.js              - address + amount formatting helpers
 */
export { walletManager } from './manager.js';
export {
  ACTIVE_CHAIN,
  SUPPORTED_NETWORKS,
  CHAIN_LIST,
  getChain,
  networkName,
  explorerTxUrl,
  explorerAddressUrl
} from './chains.js';
export {
  discoverInjectedProviders,
  discoverAllWallets,
  detectSolanaProviders,
  installableWalletLinks,
  KNOWN_WALLETS
} from './eip6963.js';
export {
  isAppKitConfigured,
  initAppKit,
  openAppKitModal,
  closeAppKitModal,
  getAppKitAccount,
  getAppKitEip1193Provider,
  disconnectAppKit,
  switchAppKitNetwork,
  onAppKitAccountChange,
  PROJECT_ID
} from './appkit.js';
export {
  connectWalletConnect,
  disconnectWalletConnect,
  restoreWalletConnectSession,
  createDeepLinks,
  isWalletConnectConfigured
} from './walletConnectEngine.js';
export {
  connectWithInjected,
  connectWithWalletConnect,
  connectWithAppKit,
  connectWithSolana,
  disconnectWallet,
  switchWalletChain,
  restoreWalletSession,
  ensureEip1193Provider
} from './actions.js';
export { performGaslessWithdrawal } from './gasless.js';
export { loadSession, saveSession, clearSession } from './session.js';
export { truncateAddress, truncateHash, isEvmAddress, prettyAmount, parseTokenAmount } from './format.js';

import { walletManager } from './manager.js';
export default walletManager;
