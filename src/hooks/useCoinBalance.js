/**
 * useCoinBalance — the bridge between the site's *earned* balance and the real
 * on-chain FLUX ERC-20.
 *
 * Flow implemented here (all values come from the backend, never from the browser):
 *  1. `signIn()`   -> SIWE-style signature by the connected wallet (POST /api/auth/*)
 *  2. `earn()`     -> POST /api/earn credits the on-site balance
 *  3. `withdraw()` -> POST /api/withdraw validates "never more than the site balance",
 *                     reserves it, and mints real FLUX to the connected address via
 *                     whichever GASLESS route the backend has configured (the user
 *                     pays 0 gas — see src/wallet/gasless.js and api/src/services/*).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  checkApiHealth,
  claimEarn,
  ensureSession,
  fetchBalance,
  fetchLedger,
  fetchWithdrawConfig,
  hasValidSession
} from '../api/client.js';
import { performGaslessWithdrawal } from '../wallet/gasless.js';
import { readTokenBalance } from '../wallet/token.js';
import { explorerTxUrl } from '../wallet/chains.js';
import { TOKEN_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOL, isTokenConfigured, tokenConfigHint } from '../contracts/addresses.js';

export function useCoinBalance() {
  const address = useAppStore((s) => s.connectedWallet?.address || null);
  const chainId = useAppStore((s) => s.connectedWallet?.chainId || null);
  const setSiteBalance = useAppStore((s) => s.setSiteBalance);
  const setOnchainBalance = useAppStore((s) => s.setOnchainBalance);
  const setWithdrawConfig = useAppStore((s) => s.setWithdrawConfig);
  const setLedger = useAppStore((s) => s.setLedger);
  const addOperation = useAppStore((s) => s.addOperation);
  const pushWithdrawalPending = useAppStore((s) => s.pushWithdrawalPending);
  const resolveWithdrawal = useAppStore((s) => s.resolveWithdrawal);
  const addLog = useAppStore((s) => s.addLog);

  const [apiOnline, setApiOnline] = useState(null);
  const [isSignedIn, setIsSignedIn] = useState(() => hasValidSession());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [withdrawPhase, setWithdrawPhase] = useState(null);
  const [lastWithdrawal, setLastWithdrawal] = useState(null);

  const tokenHint = useMemo(() => tokenConfigHint(), []);

  /** Real on-chain FLUX balance straight from the chain (works without signing in). */
  const refreshOnchain = useCallback(async () => {
    if (!address || !isTokenConfigured()) return null;
    try {
      const balance = await readTokenBalance(TOKEN_ADDRESS, address);
      setOnchainBalance({ balanceTokens: balance, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, tokenAddress: TOKEN_ADDRESS });
      return balance;
    } catch (readError) {
      addLog(`[FLUX] On-chain balance read failed: ${readError.message}`, 'warn');
      return null;
    }
  }, [address, addLog, setOnchainBalance]);

  /** Site balance + audit trail (needs the signed session). */
  const refresh = useCallback(async () => {
    if (!address) return null;
    setIsLoading(true);
    setError(null);
    try {
      const health = await checkApiHealth();
      setApiOnline(health.online);
      if (!health.online) {
        setError(`Backend unreachable (${health.error}). Start it with "npm run dev" inside /api.`);
        return null;
      }

      const config = await fetchWithdrawConfig().catch(() => null);
      if (config?.ok) setWithdrawConfig(config);

      const signedIn = hasValidSession();
      setIsSignedIn(signedIn);
      if (!signedIn) return null; // balances stay hidden until the wallet signs in

      const [balance, ledger] = await Promise.all([fetchBalance(), fetchLedger()]);
      setSiteBalance(balance.site);
      setOnchainBalance(balance.onchain);
      setLedger(ledger.entries);
      await refreshOnchain();
      return balance;
    } catch (requestError) {
      if (requestError.status === 401) {
        setIsSignedIn(false);
        setError('Session expired — sign in again with your wallet to load your balance.');
      } else {
        setError(requestError.message || 'Could not load your balance');
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [address, refreshOnchain, setLedger, setOnchainBalance, setSiteBalance, setWithdrawConfig]);

  /** Signs the login nonce with the connected wallet (proves address ownership). */
  const signIn = useCallback(async () => {
    if (!address) throw new Error('Connect an EVM wallet first');
    setIsLoading(true);
    setError(null);
    try {
      const session = await ensureSession();
      setIsSignedIn(true);
      addLog(`[AUTH] Signed in as ${address} (signature verified by the backend).`, 'success');
      await refresh();
      return session;
    } catch (authError) {
      setError(authError.message || 'Sign-in rejected');
      throw authError;
    } finally {
      setIsLoading(false);
    }
  }, [addLog, address, refresh]);
  /** Generates (earns) coins into the site balance. Server-side limits apply. */
  const earn = useCallback(
    async (amount) => {
      if (!address) throw new Error('Connect an EVM wallet first');
      await ensureSession();
      setIsSignedIn(true);
      try {
        const result = await claimEarn(amount, { source: 'forge' });
        if (result?.site) setSiteBalance(result.site);
        return result;
      } catch (claimError) {
        if (claimError.status === 401) setIsSignedIn(false);
        throw claimError;
      }
    },
    [address, setSiteBalance]
  );

  /**
   * Withdraws earned coins as real FLUX tokens, gas-free.
   * The amount can never exceed the site balance (checked here AND server-side).
   */
  const withdraw = useCallback(
    async (amount, { onPhase } = {}) => {
      if (!address) throw new Error('Connect an EVM wallet first');

      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Enter a withdrawal amount greater than zero');

      const available = Number(useAppStore.getState().siteBalance?.availableTokens || 0);
      if (parsed > available) {
        const message = `You cannot withdraw more than your earned site balance (${available} ${TOKEN_SYMBOL} available)`;
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
        asset: TOKEN_SYMBOL,
        amount: String(amount),
        dest: useAppStore.getState().connectedWallet?.truncated || address,
        eta: '~30s',
        status: 'AWAITING_SIGNATURE'
      });

      let succeeded = false;
      try {
        const result = await performGaslessWithdrawal(String(amount), {
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
          op: 'WITHDRAW_FLUX',
          asset: TOKEN_SYMBOL,
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
          `[WITHDRAW_OK] ${result.amount || amount} ${TOKEN_SYMBOL} minted to ${useAppStore.getState().connectedWallet?.truncated || address} — you paid 0 gas.`,
          'success'
        );
        succeeded = true;
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
    [addLog, address, pushWithdrawalPending, refresh, resolveWithdrawal, setSiteBalance]
  );

  // Load the config on mount (no session needed) and the balance whenever the
  // connected address changes. Signing in happens on demand to avoid surprising
  // signature prompts on page load.
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

    // token wiring
    tokenAddress: TOKEN_ADDRESS,
    tokenSymbol: TOKEN_SYMBOL,
    tokenDecimals: TOKEN_DECIMALS,
    isTokenConfigured: isTokenConfigured(),
    tokenHint,

    // status
    apiOnline,
    isSignedIn,
    isLoading,
    error,
    clearError,
    withdrawPhase,
    lastWithdrawal,

    // actions
    signIn,
    earn,
    withdraw,
    refresh,
    refreshOnchain
  };
}

export default useCoinBalance;
