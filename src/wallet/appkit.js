/**
 * Reown AppKit (formerly WalletConnect Modal / Web3Modal) v2 integration.
 *
 * This is the universal connector layer:
 *   - desktop browser extension wallets (MetaMask, Phantom, Trust, Coinbase, ...)
 *   - mobile wallets through a WalletConnect v2 PAIRING URI + live QR code
 *   - mobile deep links ("open in wallet") when the user is on a phone browser
 *
 * ★★★ WHERE TO PUT YOUR WALLETCONNECT / REOWN PROJECT ID ★★★
 *   .env (repository root) ->  VITE_WALLETCONNECT_PROJECT_ID=xxxxxxxxxxxxxxxx
 *   Free ID: https://dashboard.reown.com  (formerly cloud.walletconnect.com)
 *
 * AppKit is loaded lazily so the app still runs when the project id is not set
 * (the injected-wallet and manual WalletConnect QR paths keep working, and the
 * UI tells the user exactly which env var is missing).
 */
import { ACTIVE_CHAIN, CHAIN_LIST } from './chains.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const PROJECT_ID = String(env.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
export const APP_NAME = env.VITE_APP_NAME || 'FluxCoin';
export const APP_URL = env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://fluxcoin.app');
export const APP_ICON =
  env.VITE_APP_ICON ||
  (typeof window !== 'undefined' ? `${window.location.origin}/favicon.ico` : 'https://fluxcoin.app/favicon.ico');

export function isAppKitConfigured() {
  const hasValue = Boolean(PROJECT_ID && PROJECT_ID.length >= 8);
  const hasPlaceholder = /YOUR_|example|replace-me|demo/i.test(PROJECT_ID);
  return hasValue && !hasPlaceholder;
}

let appkitPromise = null;
let appkitInstance = null;

const accountListeners = new Set();

/** Lazily creates the single AppKit instance (safe to call many times). */
export function initAppKit() {
  if (!isAppKitConfigured()) {
    return Promise.reject(
      new Error('VITE_WALLETCONNECT_PROJECT_ID is not configured — add it to the root .env (https://dashboard.reown.com)')
    );
  }
  if (!appkitPromise) {
    appkitPromise = (async () => {
      const [{ createAppKit }, { EthersAdapter }, { mainnet, sepolia, bsc, polygon }] = await Promise.all([
        import('@reown/appkit'),
        import('@reown/appkit-adapter-ethers'),
        import('@reown/appkit/networks')
      ]);

      const availableNetworks = { 1: mainnet, 11155111: sepolia, 56: bsc, 137: polygon };
      const networks = CHAIN_LIST.map((chain) => availableNetworks[chain.chainId]).filter(Boolean);
      // Default = the build's active chain (Polygon 137). Sepolia is never an
      // implicit fallback — it is only reachable when the user picks it.
      const defaultNetwork = availableNetworks[ACTIVE_CHAIN.chainId] || availableNetworks[137] || networks[0];

      const adapter = new EthersAdapter();

      appkitInstance = createAppKit({
        adapters: [adapter],
        projectId: PROJECT_ID,
        networks,
        defaultNetwork,
        metadata: {
          name: APP_NAME,
          description: 'FluxCoin faucet — earn FLUX and withdraw gas-free.',
          url: APP_URL,
          icons: [APP_ICON]
        },
        themeMode: 'dark',
        features: { analytics: false, email: false, socials: false, swaps: false },
        enableInjected: true,
        enableEIP6963: true,
        enableWalletConnect: true,
        allWallets: 'SHOW'
      });

      appkitInstance.subscribeAccount((account) => {
        accountListeners.forEach((listener) => listener(account));
      });

      return appkitInstance;
    })().catch((error) => {
      appkitPromise = null;
      throw error;
    });
  }
  return appkitPromise;
}

export function getAppKitInstance() {
  return appkitInstance;
}

/**
 * Opens the AppKit modal. `view: 'Connect'` + namespace eip155 shows the QR /
 * WalletConnect flow with every supported wallet.
 */
export async function openAppKitModal() {
  const modal = await initAppKit();
  await modal.open({ view: 'Connect', namespace: 'eip155' });
  return modal;
}

export async function closeAppKitModal() {
  if (appkitInstance) await appkitInstance.close();
}

/** Reads the current AppKit account (address is checksummed hex, real). */
export async function getAppKitAccount() {
  const modal = await initAppKit();
  const account = modal.getAccount?.('eip155');
  return {
    address: account?.address || modal.getAddress?.('eip155') || null,
    caipNetworkId: account?.caipNetworkId || null,
    status: account?.status || null,
    connectorType: modal.getWalletProviderType?.() || null,
    connectorName: account?.embeddedWalletInfo?.authProvider || 'WalletConnect'
  };
}

/** EIP-1193 provider of the AppKit connection (used to build an ethers signer). */
export async function getAppKitEip1193Provider() {
  const modal = await initAppKit();
  return modal.getWalletProvider?.() || null;
}

export async function disconnectAppKit() {
  if (!appkitInstance) return;
  try {
    await appkitInstance.disconnect('eip155');
  } catch (error) {
    console.warn('[appkit] disconnect error', error);
  }
}

export function onAppKitAccountChange(listener) {
  accountListeners.add(listener);
  return () => accountListeners.delete(listener);
}

export async function switchAppKitNetwork(chainId) {
  const modal = await initAppKit();
  const { mainnet, sepolia, bsc, polygon } = await import('@reown/appkit/networks');
  const map = { 1: mainnet, 11155111: sepolia, 56: bsc, 137: polygon };
  const target = map[Number(chainId)];
  if (!target) throw new Error(`Chain ${chainId} is not enabled in AppKit`);
  await modal.switchNetwork(target, { throwOnFailure: true });
}
