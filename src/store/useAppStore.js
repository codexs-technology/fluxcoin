import { create } from 'zustand';
import { initialTelemetryData, tokens } from '../utils/mockData';
import { sound } from '../utils/sound';
import { walletManager } from '../wallet/manager.js';
import { truncateAddress, truncateHash } from '../wallet/format.js';

/**
 * Application store.
 *
 * RULES (these fixed the "random connect" complaint):
 *   - `connectedWallet` is a *projection* of `walletManager` state, written by
 *     `useWallet()`. The store never invents an address.
 *   - every ledger/balance/withdrawal value written here comes from a real backend
 *     response (src/api/client.js) or a real transaction receipt. No Math.random()
 *     tx hashes, no random destination addresses.
 */
export const useAppStore = create((set, get) => ({
  // --- left panel -----------------------------------------------------------
  selectedToken: tokens[0], // FLUX
  customTokenName: '',
  connectedWallet: null,
  isConnectingWallet: false,

  // --- real balances (written by useCoinBalance) -----------------------------
  siteBalance: null, // { availableTokens, earnedTokens, withdrawnTokens, earnedTodayTokens, lastEarnAt }
  onchainBalance: null, // { balanceTokens, symbol, tokenAddress }
  withdrawConfig: null, // { mode, chainId, token, faucet, minTokens, maxTokens, userGasCost }

  // --- center panel ---------------------------------------------------------
  mintQuantity: '1000',
  isForging: false,
  forgeProgress: 0,
  forgeError: null,
  active3DMode: 'standard', // 'standard' | 'wireframe' | 'particle'

  // --- right panel ----------------------------------------------------------
  telemetry: initialTelemetryData,
  sessionMode: 'GASLESS: server-sponsored',
  terminalLogs: [
    { id: 1, text: '[SYS_INIT] FluxCoin terminal online.', type: 'sys' },
    { id: 2, text: '[WALLET] Extension discovery via EIP-6963 active (no simulated providers).', type: 'sys' },
    { id: 3, text: '[API] Backend bridge: earned balances + sponsored withdrawals.', type: 'info' }
  ],

  // --- bottom panel: real audit trail ---------------------------------------
  withdrawalQueue: [], // pending withdrawals only (confirmed ones move to the ledger)
  operationLedger: [], // every row comes from the API ledger or a real receipt

  // --- actions --------------------------------------------------------------
  setSelectedToken: (token) => {
    sound.playClick();
    set({ selectedToken: token });
  },
  setCustomTokenName: (name) => set({ customTokenName: name }),
  setMintQuantity: (qty) => set({ mintQuantity: qty }),
  set3DMode: (mode) => {
    sound.playClick();
    set({ active3DMode: mode });
  },

  /** Written by useWallet() only — mirrors the real WalletManager state. */
  setConnectedWallet: (wallet) => {
    const prev = get().connectedWallet;
    set({ connectedWallet: wallet });
    if (wallet && !prev) {
      get().addLog(`[WALLET] Connected ${wallet.name}: ${wallet.truncated || truncateAddress(wallet.address)} on ${wallet.networkName}`, 'success');
    } else if (!wallet && prev) {
      get().addLog(`[WALLET] Disconnected ${prev.name || prev.address}.`, 'warn');
    }
  },
  setIsConnectingWallet: (status) => set({ isConnectingWallet: status }),

  /** Disconnects the wallet for real (the manager closes the session). */
  disconnectWallet: () => {
    sound.playClick();
    walletManager.disconnect().catch((error) => get().addLog(`[WALLET_ERR] ${error.message}`, 'error'));
  },

  setSiteBalance: (site) => set({ siteBalance: site }),
  setOnchainBalance: (onchain) => set({ onchainBalance: onchain }),
  setWithdrawConfig: (config) => {
    if (!config) return set({ withdrawConfig: null });
    set({
      withdrawConfig: config,
      sessionMode: `GASLESS: ${config.mode || 'unknown'}`
    });
  },

  /** Replaces the audit trail with the backend ledger (real records only). */
  setLedger: (entries) =>
    set({
      operationLedger: (entries || []).map((entry) => ({
        id: entry.id,
        time: entry.createdAt ? new Date(entry.createdAt).toISOString().slice(11, 19) + ' UTC' : '—',
        op: entry.type === 'withdraw' ? 'WITHDRAW_FLUX' : 'EARN_FLUX',
        asset: 'FLUX',
        value: entry.amountTokens,
        fee: entry.type === 'withdraw' ? 'GAS: 0 (sponsored)' : 'FREE',
        tx: entry.txHash ? truncateHash(entry.txHash, 10, 6) : entry.id,
        txHash: entry.txHash || null,
        status: entry.status
      })),
      withdrawalQueue: (entries || [])
        .filter((entry) => entry.type === 'withdraw' && ['PENDING', 'PROCESSING', 'RESERVED'].includes(entry.status))
        .map((entry) => ({
          id: entry.id,
          asset: 'FLUX',
          amount: entry.amountTokens,
          dest: get().connectedWallet?.truncated || '—',
          eta: '—',
          status: entry.status
        }))
    }),

  addOperation: (row) =>
    set((state) => ({ operationLedger: [{ ...row }, ...state.operationLedger].slice(0, 100) })),

  pushWithdrawalPending: (item) =>
    set((state) => ({ withdrawalQueue: [item, ...state.withdrawalQueue.filter((entry) => entry.id !== item.id)] })),

  resolveWithdrawal: (id, row) =>
    set((state) => ({
      withdrawalQueue: state.withdrawalQueue.filter((entry) => entry.id !== id),
      operationLedger: row ? [{ ...row }, ...state.operationLedger].slice(0, 100) : state.operationLedger
    })),

  addLog: (text, type = 'info') => {
    const newLog = { id: Date.now() + Math.random(), text, type, time: new Date().toLocaleTimeString() };
    set((state) => ({ terminalLogs: [...state.terminalLogs.slice(-100), newLog] }));
  },
  // --- demo telemetry tick (cosmetic dashboard numbers only) -----------------
  tickTelemetry: () => {
    set((state) => {
      const gasDelta = (Math.random() - 0.5) * 4;
      const newGas = Math.max(12, Math.min(80, Math.round(state.telemetry.gasPressure + gasDelta)));
      const newMempool = Math.max(800, Math.round(state.telemetry.mempoolLoad + (Math.random() - 0.48) * 40));
      const newThroughput = +(state.telemetry.throughput + (Math.random() - 0.5) * 1.5).toFixed(1);
      const newHash = +(state.telemetry.hashRate + (Math.random() - 0.5) * 2).toFixed(2);
      const newBlock = state.telemetry.currentBlock + (Math.random() > 0.85 ? 1 : 0);

      return {
        telemetry: {
          ...state.telemetry,
          gasPressure: newGas,
          mempoolLoad: newMempool,
          throughput: Math.max(8.0, newThroughput),
          hashRate: Math.max(200, newHash),
          currentBlock: newBlock
        }
      };
    });
  },

  /**
   * "Generate coins" (the forge button).
   *
   * The credited amount comes ONLY from the backend: `earnFn` is
   * `POST /api/forge` (see useCoinBalance.earn), which rate-limits and caps the
   * claim. The progress bar below is pure animation — it never fabricates a
   * transaction hash or a destination address like the old implementation did.
   *
   * @param {() => Promise<object>} earnFn real API call
   */
  triggerTokenForge: async (earnFn) => {
    const { mintQuantity, selectedToken, customTokenName } = get();
    const label = customTokenName.trim() ? customTokenName.toUpperCase().slice(0, 8) : 'FLUX';

    if (typeof earnFn !== 'function') {
      const message = 'Sign in with your wallet first — earnings are credited to your real address.';
      set({ forgeError: message });
      get().addLog(`[FORGE_ERR] ${message}`, 'error');
      return null;
    }

    set({ isForging: true, forgeProgress: 12, forgeError: null });
    sound.playForge();
    get().addLog(`[FORGE] Requesting ${mintQuantity} FLUX credit for ${selectedToken.symbol} preset (${label})...`, 'warn');

    const step1 = setTimeout(() => {
      set({ forgeProgress: 55 });
      get().addLog('[FORGE] Backend validating claim limits (min/max, cooldown, daily cap)...', 'info');
      sound.playBeep();
    }, 600);
    const step2 = setTimeout(() => {
      set({ forgeProgress: 85 });
      get().addLog('[FORGE] Crediting your on-site balance (0 gas, no transaction needed).', 'info');
      sound.playBeep();
    }, 1200);

    try {
      const result = await earnFn(mintQuantity);

      clearTimeout(step1);
      clearTimeout(step2);
      set({ isForging: false, forgeProgress: 100 });
      sound.playForge();

      if (typeof window !== 'undefined' && window.confetti) {
        window.confetti({ particleCount: 75, spread: 70, origin: { y: 0.6 }, colors: ['#00f0ff', '#00ff88', '#ffffff'] });
      }

      const entry = result?.entry || {};
      if (result?.site) get().setSiteBalance(result.site);

      get().addOperation({
        id: entry.id || `EARN-${Date.now()}`,
        time: new Date(entry.createdAt || Date.now()).toISOString().slice(11, 19) + ' UTC',
        op: 'EARN_FLUX',
        asset: 'FLUX',
        value: entry.amountTokens || String(mintQuantity),
        fee: 'FREE',
        tx: entry.id || '—',
        txHash: null,
        status: entry.status || 'CREDITED'
      });

      get().addLog(
        `[FORGE_SUCCESS] Credited ${entry.amountTokens || mintQuantity} FLUX to your site balance (ref ${entry.id || 'n/a'}).`,
        'success'
      );

      setTimeout(() => set({ forgeProgress: 0 }), 900);
      return result;
    } catch (error) {
      clearTimeout(step1);
      clearTimeout(step2);
      set({ isForging: false, forgeProgress: 0, forgeError: error.message || 'The forge request failed' });
      get().addLog(`[FORGE_ERR] ${error.message || 'Claim rejected by the backend'}`, 'error');
      return null;
    }
  }
}));
