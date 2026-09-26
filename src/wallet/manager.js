import { ethers } from 'ethers';
import { ACTIVE_CHAIN, getChain, networkName, SUPPORTED_NETWORKS } from './chains.js';
import { discoverAllWallets } from './eip6963.js';
import { saveSession, loadSession, clearSession } from './session.js';
import * as wc from './walletConnectEngine.js';
import { isAppKitConfigured, initAppKit, getAppKitAccount, getAppKitEip1193Provider, disconnectAppKit, openAppKitModal, onAppKitAccountChange } from './appkit.js';

/**
 * WalletManager — the single source of truth for "which wallet is connected".
 *
 * Design rules (they fix the old random-connect bug):
 *   - the address ALWAYS comes from the wallet's `eth_requestAccounts` / `eth_accounts`
 *     response. There is no fallback, no mock address, no Math.random() anywhere.
 *   - the connector you click is the connector that gets asked (`provider.request`),
 *     never `window.ethereum` blindly.
 *   - every connection is persisted and re-validated on reload.
 */
const INITIAL_STATE = Object.freeze({
  status: 'disconnected', // disconnected | connecting | connected | error
  connectorType: null, // injected | walletconnect | appkit | solana
  connectorId: null,
  connectorName: null,
  address: null,
  chainId: null,
  networkName: null,
  nativeBalance: null,
  evm: true,
  error: null,
  lastConnectedAt: null
});

class WalletManager {
  constructor() {
    this.state = { ...INITIAL_STATE };
    this.listeners = new Set();
    this.rawProvider = null;
    this.browserProvider = null;
    this.solanaProvider = null;
    this.detected = { evm: [], solana: [], all: [] };
    this.bound = { accountsChanged: null, chainChanged: null, disconnect: null };
    this.unsubscribeAppKit = null;
    this.discoveryPromise = null;
  }

  // --- state plumbing ---------------------------------------------------------

  getState = () => this.state;

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  // --- discovery --------------------------------------------------------------

  async discover() {
    // Shared so N components mounting at once do a single EIP-6963 scan.
    if (this.discoveryPromise) return this.discoveryPromise;
    this.discoveryPromise = discoverAllWallets()
      .then((result) => {
        this.detected = result;
        return result;
      })
      .finally(() => {
        this.discoveryPromise = null;
      });
    return this.discoveryPromise;
  }

  getDetected() {
    return this.detected;
  }

  // --- internal helpers -------------------------------------------------------

  #attachProviderEvents(connectorName) {
    this.#detachProviderEvents();
    const provider = this.rawProvider;
    if (!provider?.on) return;

    this.bound.accountsChanged = async (accounts) => {
      const next = Array.isArray(accounts) ? accounts[0] : accounts?.accounts?.[0];
      if (!next) {
        this.#setState({ ...INITIAL_STATE, status: 'disconnected', error: 'Wallet returned no account' });
        clearSession();
        return;
      }
      this.#setState({ address: ethers.getAddress(next), status: 'connected' });
      this.#persist(connectorName);
      await this.refreshBalance();
    };

    this.bound.chainChanged = async (chainIdHex) => {
      const parsed = typeof chainIdHex === 'number' ? chainIdHex : Number(BigInt(chainIdHex));
      this.#setState({ chainId: parsed, networkName: networkName(parsed) });
      this.#persist(connectorName);
      await this.refreshBalance();
    };

    this.bound.disconnect = () => {
      this.#setState({ ...INITIAL_STATE, status: 'disconnected' });
      clearSession();
    };

    provider.on('accountsChanged', this.bound.accountsChanged);
    provider.on('chainChanged', this.bound.chainChanged);
    provider.on('disconnect', this.bound.disconnect);
  }

  #detachProviderEvents() {
    const provider = this.rawProvider;
    if (!provider?.removeListener) return;
    if (this.bound.accountsChanged) provider.removeListener('accountsChanged', this.bound.accountsChanged);
    if (this.bound.chainChanged) provider.removeListener('chainChanged', this.bound.chainChanged);
    if (this.bound.disconnect) provider.removeListener('disconnect', this.bound.disconnect);
    this.bound = { accountsChanged: null, chainChanged: null, disconnect: null };
  }

  #persist(connectorName) {
    saveSession({
      connectorType: this.state.connectorType,
      connectorId: this.state.connectorId,
      connectorName: connectorName || this.state.connectorName,
      address: this.state.address,
      chainId: this.state.chainId,
      evm: this.state.evm
    });
  }

  async #finalize({ address, chainId, connectorType, connectorId, connectorName, provider, evm = true }) {
    if (!address || !ethers.isAddress(address)) {
      throw new Error(
        'Wallet did not return a valid EVM address — connection aborted (a fabricated address is never used)'
      );
    }

    this.rawProvider = provider || null;
    this.browserProvider = provider ? new ethers.BrowserProvider(provider) : null;

    this.#setState({
      status: 'connected',
      connectorType,
      connectorId,
      connectorName,
      address: ethers.getAddress(address),
      chainId: Number(chainId) || null,
      networkName: networkName(Number(chainId)) || null,
      evm,
      error: null,
      lastConnectedAt: Date.now()
    });

    this.#attachProviderEvents(connectorName);
    this.#persist(connectorName);
    await this.refreshBalance();
    return this.state;
  }

  // --- public connectors ------------------------------------------------------

  /**
   * Browser extension wallet (MetaMask / Phantom EVM / Trust / Coinbase / ...).
   * `walletEntry` must come from discovery — we ask THAT provider specifically.
   */
  async connectInjected(walletEntry) {
    if (!walletEntry?.provider) {
      throw new Error('Selected wallet is not installed in this browser');
    }
    this.#setState({ status: 'connecting', error: null, connectorType: 'injected', connectorId: walletEntry.id });

    const accounts = await walletEntry.provider.request({ method: 'eth_requestAccounts' });
    const address = accounts?.[0];
    const chainIdHex = await walletEntry.provider.request({ method: 'eth_chainId' }).catch(() => null);

    return this.#finalize({
      address,
      chainId: chainIdHex ? Number(BigInt(chainIdHex)) : ACTIVE_CHAIN.chainId,
      connectorType: 'injected',
      connectorId: walletEntry.id,
      connectorName: walletEntry.name,
      provider: walletEntry.provider
    });
  }

  /**
   * Mobile wallets via WalletConnect v2 — the pairing URI is handed to the UI so
   * it can render a live QR code and deep links.
   */
  async connectWalletConnect({ onUri, chainId = ACTIVE_CHAIN.chainId } = {}) {
    this.#setState({ status: 'connecting', error: null, connectorType: 'walletconnect', connectorId: 'walletconnect' });

    const session = await wc.connectWalletConnect({ onUri, chainId });
    const provider = session.provider;

    const address = session.accounts?.[0];
    return this.#finalize({
      address,
      chainId: session.chainId || chainId,
      connectorType: 'walletconnect',
      connectorId: provider?.session?.peer?.metadata?.name || 'walletconnect',
      connectorName: provider?.session?.peer?.metadata?.name || 'WalletConnect',
      provider
    });
  }

  /** Opens the branded Reown AppKit modal (universal list + QR + deep links). */
  async connectAppKit() {
    this.#setState({ status: 'connecting', error: null, connectorType: 'appkit', connectorId: 'appkit' });
    const modal = await openAppKitModal();

    // Resolve as soon as AppKit reports a connected account (or reject on timeout).
    const account = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('AppKit modal closed before a wallet connected')), 5 * 60 * 1000);
      const unsubscribe = modal.subscribeAccount((next) => {
        if (next?.status === 'connected' && next?.address) {
          clearTimeout(timeout);
          unsubscribe?.();
          resolve(next);
        }
      });
    });

    const eip1193 = modal.getWalletProvider?.();
    const chainId = Number(account.caipNetworkId?.split(':')[1] || ACTIVE_CHAIN.chainId);

    return this.#finalize({
      address: account.address,
      chainId,
      connectorType: 'appkit',
      connectorId: account.connector?.id || 'appkit',
      connectorName: account.connector?.name || 'Reown AppKit',
      provider: eip1193
    });
  }

  /** Solana wallets (Phantom/Solflare) — real address, EVM withdrawals disabled. */
  async connectSolana(walletEntry) {
    if (!walletEntry?.provider?.connect) throw new Error('Solana wallet is not installed');
    this.#setState({ status: 'connecting', error: null, connectorType: 'solana', connectorId: walletEntry.id });

    const result = await walletEntry.provider.connect();
    const publicKey = result?.publicKey?.toString?.() || walletEntry.provider.publicKey?.toString?.();
    if (!publicKey) throw new Error('Solana wallet returned no public key');

    this.solanaProvider = walletEntry.provider;
    this.rawProvider = null;
    this.browserProvider = null;

    this.#setState({
      status: 'connected',
      connectorType: 'solana',
      connectorId: walletEntry.id,
      connectorName: walletEntry.name,
      address: publicKey,
      chainId: null,
      networkName: 'Solana Mainnet',
      evm: false,
      error: null,
      lastConnectedAt: Date.now()
    });
    this.#persist(walletEntry.name);
    return this.state;
  }

  async disconnect() {
    try {
      if (this.state.connectorType === 'walletconnect') await wc.disconnectWalletConnect();
      if (this.state.connectorType === 'appkit') await disconnectAppKit();
      if (this.state.connectorType === 'solana' && this.solanaProvider?.disconnect) {
        await this.solanaProvider.disconnect().catch(() => null);
      }
    } finally {
      this.#detachProviderEvents();
      this.rawProvider = null;
      this.browserProvider = null;
      this.solanaProvider = null;
      clearSession();
      this.#setState({ ...INITIAL_STATE });
    }
  }

  // --- chain / balance / session ---------------------------------------------

  /** Switches (or adds) the network for injected & WalletConnect sessions. */
  async switchChain(chainId) {
    const target = getChain(chainId);
    if (!target) throw new Error(`Chain ${chainId} is not in the supported list`);

    if (this.state.connectorType === 'appkit') {
      const { switchAppKitNetwork } = await import('./appkit.js');
      await switchAppKitNetwork(target.chainId);
    } else if (this.rawProvider?.request) {
      try {
        await this.rawProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: target.hex }]
        });
      } catch (error) {
        // 4902 = unknown chain -> ask the wallet to add it.
        if (error?.code === 4902 || /Unrecognized chain/i.test(error?.message || '')) {
          await this.rawProvider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: target.hex,
                chainName: target.name,
                nativeCurrency: { name: target.currency, symbol: target.currency, decimals: 18 },
                rpcUrls: [target.rpc],
                blockExplorerUrls: [target.explorer]
              }
            ]
          });
        } else {
          throw error;
        }
      }
    }

    this.#setState({ chainId: target.chainId, networkName: target.name });
    this.#persist();
    await this.refreshBalance();
    return target;
  }

  /** Real on-chain native balance for the connected address. */
  async refreshBalance() {
    if (!this.browserProvider || !this.state.address || !this.state.evm) {
      this.#setState({ nativeBalance: null });
      return null;
    }
    try {
      const balance = await this.browserProvider.getBalance(this.state.address);
      const formatted = ethers.formatEther(balance);
      this.#setState({ nativeBalance: formatted });
      return formatted;
    } catch (error) {
      console.warn('[wallet] balance refresh failed', error);
      return null;
    }
  }

  /**
   * Restores the previous session on page load:
   *   - injected wallets are re-checked with `eth_accounts` (never prompts)
   *   - WalletConnect/AppKit sessions are rehydrated from their own storage
   * The stored address is only used to *verify*; the live provider is the truth.
   */
  async restore() {
    const stored = loadSession();
    if (!stored?.address) return null;

    try {
      const { evm } = await this.discover();

      if (stored.connectorType === 'injected') {
        const entry = evm.find((wallet) => wallet.id === stored.connectorId) || evm[0];
        if (!entry) return null;
        const accounts = await entry.provider.request({ method: 'eth_accounts' });
        if (!accounts?.length) return null;
        const chainIdHex = await entry.provider.request({ method: 'eth_chainId' }).catch(() => null);
        return this.#finalize({
          address: accounts[0],
          chainId: chainIdHex ? Number(BigInt(chainIdHex)) : stored.chainId,
          connectorType: 'injected',
          connectorId: entry.id,
          connectorName: entry.name,
          provider: entry.provider
        });
      }

      if (stored.connectorType === 'walletconnect') {
        const session = await wc.restoreWalletConnectSession({ chainId: stored.chainId || ACTIVE_CHAIN.chainId });
        if (!session?.accounts?.length) return null;
        return this.#finalize({
          address: session.accounts[0],
          chainId: session.chainId,
          connectorType: 'walletconnect',
          connectorId: stored.connectorId || 'walletconnect',
          connectorName: stored.connectorName || 'WalletConnect',
          provider: session.provider
        });
      }

      if (stored.connectorType === 'appkit' && isAppKitConfigured()) {
        const modal = await initAppKit();
        const account = modal.getAccount?.('eip155');
        if (account?.status !== 'connected' || !account?.address) return null;
        return this.#finalize({
          address: account.address,
          chainId: Number(account.caipNetworkId?.split(':')[1] || stored.chainId),
          connectorType: 'appkit',
          connectorId: stored.connectorId || 'appkit',
          connectorName: stored.connectorName || 'Reown AppKit',
          provider: modal.getWalletProvider?.()
        });
      }

      return null;
    } catch (error) {
      console.warn('[wallet] session restore failed', error);
      return null;
    }
  }

  // --- signing / provider access ---------------------------------------------

  /** ethers signer for on-chain transactions (null when not an EVM session). */
  async getSigner() {
    if (!this.browserProvider) throw new Error('No EVM wallet connected');
    return this.browserProvider.getSigner(this.state.address);
  }

  getEip1193Provider() {
    return this.rawProvider || null;
  }

  getBrowserProvider() {
    return this.browserProvider;
  }

  getAddress() {
    return this.state.address;
  }

  /** Sends a sign request; also used for the SIWE-style login message. */
  async signMessage(message) {
    const signer = await this.getSigner();
    return signer.signMessage(message);
  }
}

/** Singleton used by the whole app (React hooks + non-React helpers). */
export const walletManager = new WalletManager();

export { INITIAL_STATE };
export { ACTIVE_CHAIN, getChain, SUPPORTED_NETWORKS, networkName };
export {
  isAppKitConfigured,
  openAppKitModal,
  initAppKit,
  getAppKitAccount,
  getAppKitEip1193Provider,
  disconnectAppKit,
  onAppKitAccountChange
};
export * as walletConnect from './walletConnectEngine.js';
