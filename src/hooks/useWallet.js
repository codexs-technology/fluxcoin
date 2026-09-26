import { useAppStore } from '../store/useAppStore';
import { connectRealWallet, switchNetwork } from '../utils/walletConnection';

export function useWallet() {
  const connectedWallet = useAppStore((s) => s.connectedWallet);
  const isConnectingWallet = useAppStore((s) => s.isConnectingWallet);
  const setConnectedWallet = useAppStore((s) => s.setConnectedWallet);
  const setIsConnectingWallet = useAppStore((s) => s.setIsConnectingWallet);
  const disconnectWalletStore = useAppStore((s) => s.disconnectWallet);
  const addLog = useAppStore((s) => s.addLog);

  const connectWallet = async (providerType = 'MetaMask') => {
    setIsConnectingWallet(true);
    addLog(`[WALLET] Connecting to ${providerType} via Web3 RPC...`, 'info');

    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const walletData = await connectRealWallet();
        setConnectedWallet({
          name: providerType,
          address: walletData.address,
          chainId: walletData.chainId,
          networkName: walletData.networkName,
          nativeBalance: walletData.nativeBalance,
          isReal: true
        });
        addLog(`[WALLET] Connected: ${walletData.address} on ${walletData.networkName}`, 'success');
      } else {
        const randomHex = Math.random().toString(16).substring(2, 6);
        const mockAddr = `0x${randomHex}...${Math.random().toString(16).substring(2, 6).toUpperCase()}`;
        setConnectedWallet({
          name: providerType,
          address: mockAddr,
          chainId: 1,
          networkName: 'Ethereum Mainnet',
          nativeBalance: '1.25',
          isReal: false
        });
        addLog(`[WALLET] No Web3 provider detected in browser. Activated local session for ${mockAddr}`, 'warn');
      }
    } catch (err) {
      addLog(`[WALLET_ERR] ${err.message || 'Connection cancelled by user'}`, 'error');
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const disconnectWallet = () => {
    disconnectWalletStore();
  };

  return {
    connectedWallet,
    isConnectingWallet,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    isConnected: !!connectedWallet
  };
}

