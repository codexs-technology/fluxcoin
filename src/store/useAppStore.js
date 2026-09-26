import { create } from 'zustand';
import { initialTelemetryData, tokens, feeTiers } from '../utils/mockData';
import { calculateActivationFee } from '../utils/feeCalculator';
import { sound } from '../utils/sound';

export const useAppStore = create((set, get) => ({
  // Left Panel State
  selectedToken: tokens[0],
  selectedTier: feeTiers[0],
  customTokenName: '',
  connectedWallet: null,
  isConnectingWallet: false,

  // Center Panel State
  mintQuantity: '1000',
  isForging: false,
  forgeProgress: 0,
  active3DMode: 'standard', // 'standard' | 'wireframe' | 'particle'

  // Right Panel / Telemetry
  telemetry: initialTelemetryData,
  sessionMode: 'SIMULATED_TESTNET_ENCLAVE',
  terminalLogs: [
    { id: 1, text: '[SYS_INIT] Booting TokenForge kernel v4.19-arch...', type: 'sys' },
    { id: 2, text: '[SEC_ENCLAVE] Cryptographic sandbox initialized.', type: 'sys' },
    { id: 3, text: '[NET_DISCOVERY] Mesh synchronization active. 42 peers connected.', type: 'info' },
    { id: 4, text: '[TELEMETRY] Listening on RPC relay port :8545 [SIMULATION MODE].', type: 'info' },
  ],

  // Bottom Section State
  withdrawalQueue: [
    { id: 'WQ-9821', asset: 'USDT', amount: '25,000.00', dest: '0x71C...849a', eta: '02m 14s', status: 'Verifying' },
    { id: 'WQ-9822', asset: 'ETH', amount: '12.450', dest: '0x32A...09f2', eta: '06m 40s', status: 'Queued' },
    { id: 'WQ-9823', asset: 'WBTC', amount: '1.200', dest: '0x94B...e411', eta: '11m 05s', status: 'Queued' },
  ],
  operationLedger: [
    {
      id: 'OP-10492',
      time: '12:41:09 UTC',
      op: 'GENESIS_MINT',
      asset: 'USDT',
      value: '50,000.00',
      fee: '$50.00',
      tx: '0x9a8f...3d01',
      status: 'CONFIRMED'
    },
    {
      id: 'OP-10491',
      time: '12:35:22 UTC',
      op: 'BATCH_SETTLE',
      asset: 'ETH',
      value: '25.000',
      fee: '$250.00',
      tx: '0x43be...c912',
      status: 'CONFIRMED'
    }
  ],

  // Actions
  setSelectedToken: (token) => {
    sound.playClick();
    set({ selectedToken: token });
  },
  setSelectedTier: (tier) => {
    sound.playClick();
    set({ selectedTier: tier });
  },
  setCustomTokenName: (name) => set({ customTokenName: name }),
  setMintQuantity: (qty) => set({ mintQuantity: qty }),
  set3DMode: (mode) => {
    sound.playClick();
    set({ active3DMode: mode });
  },

  connectWallet: (walletName) => {
    set({ isConnectingWallet: true });
    sound.playBeep();
    setTimeout(() => {
      const randomHex = Math.random().toString(16).substring(2, 6);
      const mockAddr = `0x${randomHex}...${Math.random().toString(16).substring(2, 6).toUpperCase()}`;
      set({
        connectedWallet: { name: walletName, address: mockAddr },
        isConnectingWallet: false
      });
      get().addLog(`[WALLET] Authenticated ${walletName} (${mockAddr}) via Web3Provider.`, 'success');
      sound.playClick();
    }, 700);
  },

  disconnectWallet: () => {
    sound.playClick();
    const prev = get().connectedWallet;
    set({ connectedWallet: null });
    if (prev) {
      get().addLog(`[WALLET] Disconnected ${prev.name}.`, 'warn');
    }
  },

  addLog: (text, type = 'info') => {
    const newLog = {
      id: Date.now() + Math.random(),
      text,
      type,
      time: new Date().toLocaleTimeString()
    };
    set((state) => ({
      terminalLogs: [...state.terminalLogs.slice(-100), newLog]
    }));
  },

  // Telemetry real-time tick
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

  // Trigger Token Forge Simulation
  triggerTokenForge: () => {
    const { selectedToken, customTokenName, mintQuantity, selectedTier, telemetry } = get();
    const tokenSymbol = customTokenName.trim() ? customTokenName.toUpperCase().slice(0, 8) : selectedToken.symbol;
    const fee = calculateActivationFee(selectedTier.id, mintQuantity, telemetry.gasPressure);

    set({ isForging: true, forgeProgress: 15 });
    sound.playForge();
    get().addLog(`[MINT_STAGE_1] Initiating cryptographic forge sequence for ${mintQuantity} ${tokenSymbol}...`, 'warn');

    setTimeout(() => {
      set({ forgeProgress: 55 });
      get().addLog(`[MINT_STAGE_2] Compiling token bytecode & zero-knowledge proof...`, 'info');
      sound.playBeep();
    }, 700);

    setTimeout(() => {
      set({ forgeProgress: 85 });
      get().addLog(`[MINT_STAGE_3] Routing ${selectedTier.name} activation settlement via relay...`, 'info');
      sound.playBeep();
    }, 1400);

    setTimeout(() => {
      set({ isForging: false, forgeProgress: 100 });
      sound.playForge();

      if (typeof window !== 'undefined' && window.confetti) {
        window.confetti({
          particleCount: 75,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#00f0ff', '#00ff88', '#ffffff']
        });
      }

      const txHash = '0x' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...' + Array.from({ length: 4 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const opId = 'OP-' + Math.floor(10000 + Math.random() * 90000);
      const nowStr = new Date().toTimeString().split(' ')[0] + ' UTC';

      const newOp = {
        id: opId,
        time: nowStr,
        op: 'TOKEN_FORGE',
        asset: tokenSymbol,
        value: Number(mintQuantity || 0).toLocaleString(),
        fee: `$${fee.toFixed(2)}`,
        tx: txHash,
        status: 'CONFIRMED'
      };

      set((state) => ({
        operationLedger: [newOp, ...state.operationLedger],
        withdrawalQueue: [
          {
            id: 'WQ-' + Math.floor(1000 + Math.random() * 9000),
            asset: tokenSymbol,
            amount: Number(mintQuantity || 0).toLocaleString(),
            dest: '0x' + Math.random().toString(16).substring(2, 6) + '...' + Math.random().toString(16).substring(2, 6),
            eta: '04m 20s',
            status: 'Processing'
          },
          ...state.withdrawalQueue
        ]
      }));

      get().addLog(`[FORGE_SUCCESS] Sealed ${mintQuantity} ${tokenSymbol} at Block #${telemetry.currentBlock}. TX: ${txHash}`, 'success');

      setTimeout(() => set({ forgeProgress: 0 }), 1000);
    }, 2200);
  }
}));

