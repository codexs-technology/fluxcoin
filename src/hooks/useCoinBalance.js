/**
 * useCoinBalance — the bridge between the site's *earned* balance and the real
 * per-asset Flash ERC-20 contracts (Flash USDT/BTC/ETH/TRX/SOL on Polygon).
 *
 * Flow implemented here (all values come from the backend, never from the browser):
 *  1. `signIn()`   -> SIWE-style signature by the connected wallet (POST /api/auth/*)
 *                     — ALWAYS user-initiated (a button click); no auto sign-in
 *                     effect, so MetaMask never shows a surprise signature request.
 *  2. `earn()`     -> POST /api/forge credits the on-site balance of the SELECTED asset
 *  3. `withdraw()` -> POST /api/withdraw validates "never more than the site balance",
 *                     reserves it, and settles real Flash tokens to the connected
 *                     address from that asset's contract — whichever GASLESS route
 *                     the Worker resolved (the user pays 0 gas). After a successful
 *                     mint the wallet is asked to track the token (EIP-747 watchAsset).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  API_BASE,
  checkApiHealth,
  claimEarn,
  clearApiSession,
  ensureSession,
  fetchBalance,
  fetchLedger,
  fetchWithdrawConfig,
  hasValidSession
} from '../api/client.js';
import { performGaslessWithdrawal } from '../wallet/gasless.js';
import { readTokenBalance } from '../wallet/token.js';
import { explorerTxUrl } from '../wallet/chains.js';
import { watchAsset } from '../wallet/watchAsset.js';
import { getFlashAsset } from '../contracts/assets.js';

export function useCoinBalance() {
  const address = useAppStore((s) => s.connectedWallet?.address || null);
  const chainId = useAppStore((s) => s.connectedWallet?.chainId || null);
  /** The selected preset (usdt/btc/eth/trx/sol) decides WHICH Flash contract earns + mints. */
  const selectedToken = useAppStore((s) => s.selectedToken);
  const setSiteBalance = useAppStore((s) => s.setSiteBalance);
  const setOnchainBalance = useAppStore((s) => s.setOnchainBalance);
  const setWithdrawConfig = useAppStore((s) => s.setWithdrawConfig);
  const setLedger = useAppStore((s) => s.setLedger);
  const addOperation = useAppStore((s) => s.addOperation);
  const pushWithdrawalPending = useAppStore((s) => s.pushWithdrawalPending);
  const resolveWithdrawal = useAppStore((s) => s.resolveWithdrawal);
  const addLog = useAppStore((s) => s.addLog);

  const [apiOnline, setApiOnline] = useState(null);
  /** Last health probe: { online, base, latencyMs, reason, error, payload }. */
  const [backend, setBackend] = useState(null);
  const [isSignedIn, setIsSignedIn] = useState(() => hasValidSession());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [withdrawPhase, setWithdrawPhase] = useState(null);
  const [lastWithdrawal, setLastWithdrawal] = useState(null);
  /** Wallet (lowercased) that must not be auto-signed-in again (manual sign-out / refusal). */
  const autoSignInBlock = useRef(null);

  /** Resolved Flash asset for the selected preset (address/symbol/decimals/configured). */
  const activeAsset = useMemo(() => getFlashAsset(selectedToken?.id), [selectedToken]);

  const tokenHint = useMemo(
    () =>
      activeAsset.configured
        ? null
        : `${activeAsset.symbol} contract address is not set — deploy the 5 Flash contracts (contracts/scripts/deployFlashAssets.js) and fill VITE_TOKEN_ADDRESS_${activeAsset.id.toUpperCase()} in the root .env.`,
    [activeAsset]
  );

  /** Real on-chain balance of the SELECTED asset (works without signing in). */
  const refreshOnchain = useCallback(async () => {
    if (!address || !activeAsset.configured) return null;
    try {
      const balance = await readTokenBalance(activeAsset.address, address);
      setOnchainBalance({
        balanceTokens: balance,
        symbol: activeAsset.symbol,
        decimals: activeAsset.decimals,
        tokenAddress: activeAsset.address
      });
      return balance;
    } catch (readError) {
      addLog(`[${activeAsset.symbol}] On-chain balance read failed: ${readError.message}`, 'warn');
      return null;
    }
  }, [activeAsset, address, addLog, setOnchainBalance]);

  /** Site balance + audit trail (needs the signed session). */
  const refresh = useCallback(async () => {
    if (!address) return null;
    setIsLoading(true);
    setError(null);
    try {
      // Health first: this is what decides between "backend offline" and a real
      // API error, and the message shown to the user comes from src/lib/api.js.
      const health = await checkApiHealth();
      setApiOnline(health.online);
      setBackend(health);
      if (!health.online) {
        setError(health.error || `The FluxCoin API at ${health.base} is not reachable.`);
        return null;
      }

      const config = await fetchWithdrawConfig().catch(() => null);
      if (config?.ok) setWithdrawConfig(config);

      const signedIn = hasValidSession();
      setIsSignedIn(signedIn);
      if (!signedIn) return null; // balances stay hidden until the wallet signs in

      const [balance, ledger] = await Promise.all([fetchBalance(address, activeAsset.id), fetchLedger()]);
      setSiteBalance(balance.site);
      setOnchainBalance(balance.onchain);
      setLedger(ledger.entries);
      await refreshOnchain();
      return balance;
    } catch (requestError) {
      if (requestError.status === 401) {
        setIsSignedIn(false);
        setError('Session expired — sign in again with your wallet to load your balance.');
      } else if (requestError.offline || requestError.notApi) {
        setApiOnline(false);
        setBackend({ online: false, base: API_BASE, error: requestError.message, reason: requestError.notApi ? 'not-fluxcoin-api' : 'unreachable' });
        setError(requestError.message);
      } else {
        setError(requestError.message || 'Could not load your balance');
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeAsset, address, refreshOnchain, setLedger, setOnchainBalance, setSiteBalance, setWithdrawConfig]);

  /** Signs the login nonce with the connected wallet (proves address ownership). */
  const signIn = useCallback(async () => {
    if (!address) throw new Error('Connect an EVM wallet first');
    setIsLoading(true);
    setError(null);
    try {
      const session = await ensureSession();
      autoSignInBlock.current = null;
      setIsSignedIn(true);
      addLog(
        `[AUTH] Signed in as ${address}${session?.signatureVerified ? ' (signature verified by the API)' : ''}.`,
        'success'
      );
      await refresh();
      return session;
    } catch (authError) {
      setError(authError.message || 'Sign-in rejected');
      throw authError;
    } finally {
      setIsLoading(false);
    }
  }, [addLog, address, refresh]);
  /** Signs out and clears the session from localStorage. */
  const signOut = useCallback(() => {
    clearApiSession();
    autoSignInBlock.current = address ? address.toLowerCase() : null;
    setIsSignedIn(false);
    setSiteBalance(null);
    setLedger([]);
    addLog(`[AUTH] Signed out of FluxCoin.`, 'info');
  }, [addLog, address, setLedger, setSiteBalance]);

  /** Generates (earns) coins of the SELECTED asset into its site balance. Server-side limits apply. */
  const earn = useCallback(
    async (amount) => {
      if (!address) throw new Error('Connect an EVM wallet first');
      await ensureSession();
      setIsSignedIn(true);
      try {
        const result = await claimEarn(amount, { asset: activeAsset.id, source: 'forge' });
        if (result?.site) setSiteBalance(result.site);
        return result;
      } catch (claimError) {
        if (claimError.status === 401) setIsSignedIn(false);
        throw claimError;
      }
    },
    [activeAsset, address, setSiteBalance]
  );

  /**
   * Withdraws earned coins of the SELECTED asset as real Flash tokens, gas-free.
   * The amount can never exceed the site balance (checked here AND server-side).
   * After a real (non-simulated) mint the wallet is asked to track the token so
   * it shows up in MetaMask (EIP-747 wallet_watchAsset) — that prompt is the
   * user's own "import token" popup and can be dismissed safely.
   */
  const withdraw = useCallback(
    async (amount, { onPhase } = {}) => {
      if (!address) throw new Error('Connect an EVM wallet first');

      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter a withdrawal amount greater than zero');

      const available = Number(useAppStore.getState().siteBalance?.availableTokens || 0);
      if (parsed > available) {
        const message = `You cannot withdraw more than your earned site balance (${available} ${activeAsset.symbol} available)`;
        addLog(`[WITHDRAW_ERR] ${message}`, 'error');
        throw new Error(message);
      }

      await ensureSession();
      setIsSignedIn(true);
      setError(null);
      setLastWithdrawal(null);

      const localId = `local-${Date.now()}`;
      pushWithdrawalPending({
        id: localId,
        asset: activeAsset.symbol,
        amount: String(amount),
        dest: useAppStore.getState().connectedWallet?.truncated || address,
        eta: '~30s',
        status: 'AWAITING_SIGNATURE'
      });

      let succeeded = false;
      try {
        const result = await performGaslessWithdrawal(String(amount), {
          asset: activeAsset.id,
          onPhase: (phase, detail) => {
            setWithdrawPhase(phase);
            onPhase?.(phase, detail);
            addLog(`[WITHDRAW] ${phase}${detail?.smartAccountAddress ? ` (${detail.smartAccountAddress})` : ''}`, 'info');
          }
        });

        const txHash = result.txHash || result.taskId || null;
        const status = result.simulated ? 'SIMULATED' : result.status || 'CONFIRMED';
        const row = {
          id: result.reservationId || localId,
          time: new Date().toISOString().slice(11, 19) + ' UTC',
          op: `WITHDRAW_${activeAsset.symbol}`,
          asset: activeAsset.symbol,
          value: result.amount || String(amount),
          fee: 'GAS: 0 (sponsored)',
          tx: txHash ? `${txHash.slice(0, 14)}…` : status,
          txHash,
          status
        };
        resolveWithdrawal(localId, row);
        setLastWithdrawal({
          ...result,
          amount: result.amount || String(amount),
          explorerUrl: result.explorerUrl || explorerTxUrl(txHash),
          gasPaidBy: result.gasPaidBy || 'project-paymaster',
          userGasCost: '0'
        });
        addLog(
          `[WITHDRAW_OK] ${result.amount || amount} ${activeAsset.symbol} minted to ${useAppStore.getState().connectedWallet?.truncated || address} — you paid 0 gas.`,
          'success'
        );
        succeeded = true;

        // Real mint -> make the token VISIBLE in the wallet (non-fatal, user may skip).
        if (!result.simulated && activeAsset.configured) {
          watchAsset(activeAsset)
            .then((added) => {
              if (added) addLog(`[WALLET] ${activeAsset.symbol} added to your wallet token list.`, 'success');
            })
            .catch((watchError) =>
              addLog(`[WALLET] Could not add ${activeAsset.symbol} to the wallet list: ${watchError.message}`, 'warn')
            );
        }

        await refresh();
        return result;
      } catch (withdrawError) {
        resolveWithdrawal(localId, null);
        setError(withdrawError.message || 'Withdrawal failed');
        addLog(`[WITHDRAW_ERR] ${withdrawError.message || 'Withdrawal failed'}`, 'error');
        throw withdrawError;
      } finally {
        setWithdrawPhase(succeeded ? 'confirmed' : null);
      }
    },
    [activeAsset, addLog, address, pushWithdrawalPending, refresh, resolveWithdrawal, setSiteBalance]
  );

  // Load the config on mount (no session needed) and the balance whenever the
  // connected address OR the selected asset changes. Signing in happens ONLY on
  // an explicit user action (SIGN IN button / GENERATE / WITHDRAW) — there is
  // deliberately NO auto sign-in effect, because a surprise personal_sign popup
  // on page load is exactly what makes MetaMask flag a site as "high-risk".
  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  useEffect(() => {
    if (!address) return;
    refreshOnchain().catch(() => null);
  }, [address, chainId, refreshOnchain]);

  const site = useAppStore((s) => s.siteBalance);
  const onchain = useAppStore((s) => s.onchainBalance);
  const config = useAppStore((s) => s.withdrawConfig);
  const ledger = useAppStore((s) => s.operationLedger);
  const withdrawals = useAppStore((s) => s.withdrawalQueue);

  const clearError = useCallback(() => setError(null), []);

  return {
    // balances
    site,
    onchain,
    config,
    ledger,
    withdrawals,
    availableTokens: site?.availableTokens || '0',
    canWithdraw: Boolean(address && isSignedIn && Number(site?.availableTokens || 0) > 0),

    // token wiring (per selected asset)
    tokenAddress: activeAsset.address,
    tokenSymbol: activeAsset.symbol,
    tokenDecimals: activeAsset.decimals,
    isTokenConfigured: activeAsset.configured,
    tokenHint,

    // status
    apiOnline,
    /** Last health probe: { online, base, latencyMs, reason, error }. */
    backend,
    apiBase: API_BASE,
    isSignedIn,
    isLoading,
    error,
    clearError,
    withdrawPhase,
    lastWithdrawal,

    // actions
    signIn,
    signOut,
    earn,
    withdraw,
    refresh,
    refreshOnchain
  };
}

export default useCoinBalance;
