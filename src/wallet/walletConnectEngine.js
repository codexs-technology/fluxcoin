/**
 * WalletConnect v2 engine (the protocol Reown AppKit is built on).
 *
 * Used for the IN-APP experience required by the spec:
 *   - a live pairing QR code rendered inside our own modal
 *   - a deep link so a phone browser can jump straight into the wallet app
 *
 * It is intentionally separate from AppKit: AppKit gives the branded universal
 * modal, this engine gives us direct access to the pairing URI. Both speak the
 * same WalletConnect v2 protocol and share the same project id.
 */
import { PROJECT_ID, APP_NAME, APP_URL, APP_ICON, isAppKitConfigured } from './appkit.js';
import { ACTIVE_CHAIN, CHAIN_LIST } from './chains.js';

let providerInstance = null;
let currentUri = null;

export function isWalletConnectConfigured() {
  return isAppKitConfigured();
}

function rpcMap() {
  return CHAIN_LIST.reduce((map, chain) => {
    map[chain.chainId] = chain.rpc;
    return map;
  }, {});
}

/**
 * Trust Wallet WalletConnect deep link — opens the Trust mobile app directly on
 * the pairing approval screen (https://link.trustwallet.com/wc?uri=...).
 */
export function trustWalletDeepLink(uri) {
  return uri ? `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` : null;
}

function deepLinks(uri) {
  const encoded = encodeURIComponent(uri);
  return [
    { id: 'trust', label: 'Trust Wallet', icon: '🛡️', url: trustWalletDeepLink(uri) },
    { id: 'metamask', label: 'MetaMask', icon: '🦊', url: `https://metamask.app.link/wc?uri=${encoded}` },
    { id: 'rainbow', label: 'Rainbow', icon: '🌈', url: `https://rnbwapp.com/wc?uri=${encoded}` },
    { id: 'phantom', label: 'Phantom', icon: '👻', url: `https://phantom.app/ul/wc?uri=${encoded}` },
    { id: 'coinbase', label: 'Coinbase Wallet', icon: '🔵', url: `https://go.cb-w.com/wc?uri=${encoded}` },
    { id: 'generic', label: 'Other WalletConnect wallet', icon: '🔗', url: `https://walletconnect.com/wc?uri=${encoded}` }
  ];
}

/**
 * Creates (or reuses) the WalletConnect v2 provider and starts pairing.
 * @param {(uri: string) => void} onUri called with the live WC pairing URI (QR + deep links)
 */
export async function connectWalletConnect({ onUri, chainId = ACTIVE_CHAIN.chainId, onDisplayUri } = {}) {
  if (!isWalletConnectConfigured()) {
    throw new Error('WalletConnect is unavailable: set VITE_WALLETCONNECT_PROJECT_ID in the root .env');
  }

  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  if (!providerInstance) {
    providerInstance = await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [chainId],
      optionalChains: CHAIN_LIST.map((chain) => chain.chainId),
      showQrModal: false, // we render our own QR modal
      rpcMap: rpcMap(),
      metadata: {
        name: APP_NAME,
        description: 'FluxCoin faucet — earn FLUX and withdraw gas-free.',
        url: APP_URL,
        icons: [APP_ICON]
      }
    });
    providerInstance.on('display_uri', (uri) => {
      currentUri = uri;
      onDisplayUri?.(uri);
    });
  } else if (providerInstance.chainId && providerInstance.chainId !== chainId) {
    await providerInstance.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }]
    });
  }

  // `connect()` resolves once the QR has been scanned and the session approved.
  const connectPromise = providerInstance.connect({
    chains: [chainId],
    optionalChains: CHAIN_LIST.map((chain) => chain.chainId),
    rpcMap: rpcMap()
  });

  // Emit the pairing URI as soon as it exists so the UI can show the QR.
  if (providerInstance.uri) {
    currentUri = providerInstance.uri;
    onUri?.(providerInstance.uri);
  } else {
    const waitForUri = () => new Promise((resolve) => {
      const handler = (uri) => {
        providerInstance.off?.('display_uri', handler);
        resolve(uri);
      };
      providerInstance.on('display_uri', handler);
      setTimeout(() => resolve(null), 4000);
    });
    const uri = await waitForUri();
    if (uri) {
      currentUri = uri;
      onUri?.(uri);
    }
  }

  const accounts = await connectPromise;
  return {
    provider: providerInstance,
    accounts,
    chainId: providerInstance.chainId || chainId,
    uri: currentUri,
    deepLinks: currentUri ? deepLinks(currentUri) : []
  };
}

export function getWalletConnectProvider() {
  return providerInstance;
}

export function getPairingUri() {
  return currentUri;
}

export function createDeepLinks(uri = currentUri) {
  return uri ? deepLinks(uri) : [];
}

export async function disconnectWalletConnect() {
  if (!providerInstance) return;
  try {
    await providerInstance.disconnect();
  } catch (error) {
    console.warn('[walletconnect] disconnect error', error);
  } finally {
    providerInstance = null;
    currentUri = null;
  }
}

/**
 * Silently restores an existing WalletConnect v2 session after a page reload.
 * Returns null when there is no stored session (the user must connect again).
 */
export async function restoreWalletConnectSession({ chainId = ACTIVE_CHAIN.chainId } = {}) {
  if (!isWalletConnectConfigured()) return null;
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');

  if (!providerInstance) {
    providerInstance = await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [chainId],
      optionalChains: CHAIN_LIST.map((chain) => chain.chainId),
      showQrModal: false,
      rpcMap: rpcMap(),
      metadata: {
        name: APP_NAME,
        description: 'FluxCoin faucet — earn FLUX and withdraw gas-free.',
        url: APP_URL,
        icons: [APP_ICON]
      }
    });
  }

  if (!providerInstance.session) return null;

  try {
    // `enable()` re-uses the stored session without showing a QR code.
    const accounts = await providerInstance.enable();
    return { provider: providerInstance, accounts, chainId: providerInstance.chainId };
  } catch (error) {
    console.warn('[walletconnect] session restore failed', error);
    return null;
  }
}
