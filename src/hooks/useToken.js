import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getTokenBalance, transferTokens, flashMintTokens, burnTokens } from '../utils/walletConnection';

export function useToken(tokenAddress) {
  const connectedWallet = useAppStore((s) => s.connectedWallet);
  const addLog = useAppStore((s) => s.addLog);
  const [balance, setBalance] = useState('0.00');
  const [loading, setLoading] = useState(false);

  const refreshBalance = async () => {
    if (!connectedWallet?.address || !tokenAddress) return;
    try {
      const bal = await getTokenBalance(tokenAddress, connectedWallet.address);
      setBalance(bal);
    } catch (e) {
      console.warn(e);
    }
  };

  useEffect(() => {
    refreshBalance();
    const interval = setInterval(refreshBalance, 12000);
    return () => clearInterval(interval);
  }, [tokenAddress, connectedWallet?.address]);

  const transfer = async (to, amount) => {
    setLoading(true);
    try {
      addLog(`[TRANSFER] Initiating on-chain transfer of ${amount} to ${to}...`, 'info');
      const tx = await transferTokens(tokenAddress, to, amount);
      addLog(`[TX_SUBMITTED] Hash: ${tx.hash}`, 'sys');
      const receipt = await tx.wait();
      addLog(`[TX_MINED] Transfer confirmed in block #${receipt.blockNumber}`, 'success');
      refreshBalance();
      return receipt;
    } finally {
      setLoading(false);
    }
  };

  const mint = async (to, amount) => {
    setLoading(true);
    try {
      addLog(`[FLASH_MINT] Requesting mint of ${amount} tokens to ${to}...`, 'info');
      const tx = await flashMintTokens(tokenAddress, to, amount);
      addLog(`[TX_SUBMITTED] Hash: ${tx.hash}`, 'sys');
      const receipt = await tx.wait();
      addLog(`[TX_MINED] Flash mint confirmed in block #${receipt.blockNumber}`, 'success');
      refreshBalance();
      return receipt;
    } finally {
      setLoading(false);
    }
  };

  const burn = async (amount) => {
    setLoading(true);
    try {
      addLog(`[BURN] Burning ${amount} tokens from supply...`, 'warn');
      const tx = await burnTokens(tokenAddress, amount);
      addLog(`[TX_SUBMITTED] Hash: ${tx.hash}`, 'sys');
      const receipt = await tx.wait();
      addLog(`[TX_MINED] Tokens burned in block #${receipt.blockNumber}`, 'success');
      refreshBalance();
      return receipt;
    } finally {
      setLoading(false);
    }
  };

  return {
    balance,
    loading,
    refreshBalance,
    transfer,
    mint,
    burn
  };
}
