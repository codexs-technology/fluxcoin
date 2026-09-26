import { useAppStore } from '../store/useAppStore';

export function useWallet() {
  const connectedWallet = useAppStore((s) => s.connectedWallet);
  const isConnectingWallet = useAppStore((s) => s.isConnectingWallet);
  const connectWallet = useAppStore((s) => s.connectWallet);
  const disconnectWallet = useAppStore((s) => s.disconnectWallet);

  return {
    connectedWallet,
    isConnectingWallet,
    connectWallet,
    disconnectWallet,
    isConnected: !!connectedWallet
  };
}
