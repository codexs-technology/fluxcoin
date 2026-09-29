/**
 * useToken — ERC-20 helpers bound to the REAL connected wallet.
 *
 * `tokenAddress`/`decimals`/`symbol` now describe the SELECTED Flash asset
 * (USDT 6d, BTC 8d, ETH 18d, TRX 6d, SOL 9d) — the decimals parameter is what
 * makes a 6-decimal USDT transfer parse correctly instead of 1e12 too many.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { burnToken, readTokenBalance, transferToken } from '../wallet/token.js';
import { TOKEN_ADDRESS, TOKEN_DECIMALS, TOKEN_SYMBOL } from '../contracts/addresses.js';

export function useToken(tokenAddress = TOKEN_ADDRESS, decimals = TOKEN_DECIMALS, symbol = TOKEN_SYMBOL) {
  const address = useAppStore((s) => s.connectedWallet?.address || null);
  const addLog = useAppStore((s) => s.addLog);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!address || !tokenAddress) {
      setBalance(null);
      return null;
    }
    try {
      const next = await readTokenBalance(tokenAddress, address);
      setBalance(next);
      return next;
    } catch (error) {
      addLog(`[TOKEN] Balance read failed: ${error.message}`, 'warn');
      return null;
    }
  }, [addLog, address, tokenAddress]);

  useEffect(() => {
    refreshBalance();
    const interval = setInterval(refreshBalance, 15000);
    return () => clearInterval(interval);
  }, [refreshBalance]);

  const transfer = async (to, amount) => {
    setLoading(true);
    try {
      addLog(`[TRANSFER] Submitting on-chain transfer of ${amount} ${symbol} to ${to}…`, 'info');
      const tx = await transferToken(tokenAddress, to, amount, decimals);
      addLog(`[TX_SUBMITTED] Hash: ${tx.hash}`, 'sys');
      const receipt = await tx.wait();
      addLog(`[TX_MINED] Transfer confirmed in block #${receipt.blockNumber}`, 'success');
      await refreshBalance();
      return receipt;
    } finally {
      setLoading(false);
    }
  };

  const burn = async (amount) => {
    setLoading(true);
    try {
      addLog(`[BURN] Burning ${amount} ${symbol} from supply…`, 'warn');
      const tx = await burnToken(tokenAddress, amount, decimals);
      addLog(`[TX_SUBMITTED] Hash: ${tx.hash}`, 'sys');
      const receipt = await tx.wait();
      addLog(`[TX_MINED] Burn confirmed in block #${receipt.blockNumber}`, 'success');
      await refreshBalance();
      return receipt;
    } finally {
      setLoading(false);
    }
  };

  return { balance, loading, refreshBalance, transfer, burn };
}

export default useToken;
