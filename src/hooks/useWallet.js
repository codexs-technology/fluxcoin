/**
 * useWallet — React binding for the WalletManager singleton.
 *
 * This hook owns NO wallet state: it mirrors `walletManager` (the single source of
 * truth) and exposes the connection actions. That is the fix for the previous
 * version, which invented a `Math.random()` address whenever `window.ethereum` was
 * missing and then displayed it as if a wallet were connected.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { walletManager } from '../wallet/manager.js';
import {
  connectWithAppKit,
  connectWithInjected,
  connectWithSolana,
  connectWithWalletConnect,
  disconnectWallet as disconnectWalletAction,
  restoreWalletSession,
  switchWalletChain
} from '../wallet/actions.js';
import { installableWalletLinks } from '../wallet/eip6963.js';
import { isAppKitConfigured } from '../wallet/appkit.js';
import { truncateAddress } from '../wallet/format.js';
import { ACTIVE_CHAIN, SUPPORTED_NETWORKS } from '../wallet/chains.js';
import { useAppStore } from '../store/useAppStore';
import { checkBackend, describeBackendIssue } from '../lib/api.js';
import { loginWithWallet } from '../api/client.js';

/** Only the first mounted useWallet() instance performs the reload-restore. */
let restoreStarted = false;

/** A wallet is only "connected" when the wallet itself returned an address. */
function projectWallet(state) {
  if (state.status !== 'connected' || !state.address) return null;
  return {
    name: state.connectorName || 'Wallet',
    connectorType: state.connectorType,
    connectorId: state.connectorId,
    address: state.address,
    truncated: truncateAddress(state.address, 4, 4),
    chainId: state.chainId,
    networkName: state.networkName,
    nativeBalance: state.nativeBalance,
    evm: state.evm,
    isReal: true, // kept for older components — the address always comes from the wallet
    lastConnectedAt: state.lastConnectedAt
  };
}

export function useWallet() {
  const [state, setState] = useState(() => walletManager.getState());
  const [detected, setDetected] = useState(() => walletManager.getDetected());
  const [error, setError] = useState(null);
  const [pairingUri, setPairingUri] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true);

  const setConnectedWallet = useAppStore((s) => s.setConnectedWallet);
  const setIsConnectingWallet = useAppStore((s) => s.setIsConnectingWallet);

  // --- 1. mirror the manager (address, chain, session) into React + the store ---
  useEffect(() => {
    const sync = (next) => {
      setState(next);
      setConnectedWallet(projectWallet(next));
      setIsConnectingWallet(next.status === 'connecting');
    };
    sync(walletManager.getState());
    return walletManager.subscribe(sync);
  }, [setConnectedWallet, setIsConnectingWallet]);

  // --- 2. discover the wallets that are ACTUALLY installed (EIP-6963) ----------
  const refreshDetected = useCallback(async () => {
    const result = await walletManager.discover();
    setDetected(result);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const result = await walletManager.discover();
        if (active) setDetected(result);
      } catch (discoveryError) {
        if (active) setError(discoveryError.message);
      }
    };
    run();
    // Extensions can inject late; re-scan whenever one announces itself.
    const onAnnounce = () => run();
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    return () => {
      active = false;
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    };
  }, []);

  // --- 3. reconnect on page reload (injected eth_accounts / WC / AppKit) -------
  useEffect(() => {
    if (restoreStarted) {
      setIsRestoring(false);
      return undefined;
    }
    restoreStarted = true;
    let active = true;
    restoreWalletSession()
      .catch(() => null)
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);
  // --- actions -----------------------------------------------------------------

  /**
   * Connect an installed extension wallet. Accepts the discovered entry (preferred)
   * or a name/id string; an unknown wallet throws instead of silently connecting to
   * a different provider.
   */
  const connectWallet = useCallback(async (walletOrName) => {
    setError(null);
    try {
      const health = await checkBackend({ timeoutMs: 5000 });
      if (!health.online) {
        throw new Error(health.error || `The FluxCoin API at ${health.base} is offline.`);
      }

      let entry = walletOrName;
      if (typeof walletOrName === 'string' || !walletOrName?.provider) {
        const needle = String(walletOrName || '').toLowerCase();
        const found = (walletManager.getDetected().all || []).find(
          (wallet) =>
            wallet.id?.toLowerCase() === needle ||
            wallet.brandId?.toLowerCase() === needle ||
            wallet.name?.toLowerCase() === needle
        );
        if (!found) {
          throw new Error(
            `${walletOrName || 'That wallet'} is not installed in this browser. Install it (see the download list) or use WalletConnect / the QR code.`
          );
        }
        entry = found;
      }

      if (entry.chain === 'solana' || entry.evm === false) {
        const connected = await connectWithSolana(entry);
        if (!connected?.address) throw new Error('The selected Solana wallet did not return a valid address.');
        return connected;
      }

      const connected = await connectWithInjected(entry);
      const address = walletManager.getAddress();
      if (!address) throw new Error('Wallet connected but no address was returned by the provider.');
      try {
        await loginWithWallet();
      } catch (loginError) {
        setError(loginError.message || 'Wallet connected, but signature verification failed. Please sign the message to continue.');
        throw loginError;
      }
      return connected;
    } catch (connectError) {
      const message = connectError?.message || 'Wallet connection failed.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  /** WalletConnect v2 in-app pairing — the QR payload arrives through `pairingUri`. */
  const connectWalletConnect = useCallback(async (options = {}) => {
    setError(null);
    setPairingUri(null);
    try {
      const health = await checkBackend({ timeoutMs: 5000 });
      if (!health.online) {
        throw new Error(health.error || `The FluxCoin API at ${health.base} is offline.`);
      }

      const connected = await connectWithWalletConnect({
        ...options,
        onUri: (uri) => {
          setPairingUri(uri);
          options.onUri?.(uri);
        }
      });

      const address = walletManager.getAddress();
      if (!address) throw new Error('WalletConnect connected but no wallet address was returned.');

      try {
        await loginWithWallet();
      } catch (loginError) {
        setError(loginError.message || 'WalletConnect connected, but the signature could not be verified. Please sign the message to continue.');
        throw loginError;
      }

      return connected;
    } catch (connectError) {
      const message = connectError?.message || 'WalletConnect pairing failed.';
      setError(message);
      throw new Error(message);
    } finally {
      setPairingUri(null);
    }
  }, []);

  /** Branded Reown AppKit modal (extensions + QR + deep links in one UI). */
  const connectAppKit = useCallback(async () => {
    setError(null);
    try {
      const health = await checkBackend({ timeoutMs: 5000 });
      if (!health.online) {
        throw new Error(health.error || `The FluxCoin API at ${health.base} is offline.`);
      }

      if (!isAppKitConfigured()) {
        throw new Error('Reown AppKit is not configured: set VITE_WALLETCONNECT_PROJECT_ID in the root .env file.');
      }

      const connected = await connectWithAppKit();
      const address = walletManager.getAddress();
      if (!address) throw new Error('AppKit connected but no wallet address was returned.');

      try {
        await loginWithWallet();
      } catch (loginError) {
        setError(loginError.message || 'AppKit connected, but signature verification failed. Please sign the message to continue.');
        throw loginError;
      }

      return connected;
    } catch (connectError) {
      const message = connectError?.message || 'AppKit could not be opened.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    setPairingUri(null);
    setError(null);
    await disconnectWalletAction();
  }, []);

  const switchNetwork = useCallback(async (chainId) => {
    setError(null);
    try {
      return await switchWalletChain(chainId);
    } catch (switchError) {
      setError(switchError.message || 'Network switch failed');
      throw switchError;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const networkLabel = useMemo(
    () => state.networkName || SUPPORTED_NETWORKS[state.chainId]?.name || `Chain ${state.chainId || '—'}`,
    [state.chainId, state.networkName]
  );

  const wallet = useMemo(() => projectWallet(state), [state]);

  return {
    // --- connection state ---
    wallet,
    status: state.status,
    address: state.address,
    truncatedAddress: state.address ? truncateAddress(state.address, 4, 4) : '',
    chainId: state.chainId,
    networkName: networkLabel,
    nativeBalance: state.nativeBalance,
    connectorName: state.connectorName,
    connectorType: state.connectorType,
    isConnected: state.status === 'connected' && Boolean(state.address),
    isConnecting: state.status === 'connecting',
    isRestoring,
    isEvm: state.evm !== false,
    error: error || state.error,
    clearError,

    // --- discovery ---
    wallets: detected,
    injectedWallets: detected.evm || [],
    solanaWallets: detected.solana || [],
    hasInjectedWallet: (detected.evm || []).length > 0,
    installableWallets: installableWalletLinks(),
    appKitAvailable: isAppKitConfigured(),
    refreshDetected,

    // --- actions ---
    connectWallet,
    connectWalletConnect,
    connectAppKit,
    disconnectWallet,
    switchNetwork,

    // --- WalletConnect pairing (drives the QR modal) ---
    pairingUri,
    chains: Object.values(SUPPORTED_NETWORKS),
    activeChain: ACTIVE_CHAIN,

    // --- backwards compatible alias (old components read `connectedWallet`) ---
    connectedWallet: wallet
  };
}

export default useWallet;
