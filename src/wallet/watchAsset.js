/**
 * EIP-747 wallet_watchAsset + EIP-3085 chain switching.
 *
 * This is what makes the minted Flash tokens VISIBLE in MetaMask & friends:
 * the wallet does not auto-list unknown ERC-20s, so after a withdrawal (or on
 * demand) the app asks the wallet to track the per-asset FlashToken contract.
 *
 * Flow implemented here (all user-initiated, no hidden prompts):
 *   ensureWalletChain() -> wallet_switchEthereumChain, wallet_addEthereumChain fallback
 *   watchAsset()        -> wallet_watchAsset (the "import token" popup)
 */
import { walletManager } from './manager.js';
import { ACTIVE_CHAIN, getChain } from './chains.js';
import { flashAssets } from '../contracts/assets.js';

function chainParams(chain) {
  return {
    chainId: chain.hex,
    chainName: chain.name,
    nativeCurrency: { name: chain.currency, symbol: chain.currency, decimals: 18 },
    rpcUrls: [chain.rpc],
    blockExplorerUrls: [chain.explorer]
  };
}

/**
 * Switches (or adds) the connected wallet to `chainId` — WITHOUT overriding the
 * user's selection. When no chain is passed, the wallet's CURRENT chain wins
 * (that is what the "03 // Settlement Wallet" dropdown shows); the build default
 * (ACTIVE_CHAIN — Polygon 137) is only used when the wallet sits on a chain this
 * build does not know. Returns { switched, added, chainId }.
 */
export async function ensureWalletChain(chainId) {
  const provider = walletManager.getEip1193Provider();
  if (!provider?.request) throw new Error('No EVM wallet connected');

  const current = walletManager.getState().chainId;
  const requested =
    typeof chainId === 'number'
      ? chainId
      : getChain(current)
        ? current // the user's live selection — never stomp it with a build default
        : ACTIVE_CHAIN.chainId;
  const chain = getChain(requested) || ACTIVE_CHAIN;

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hex }] });
    return { switched: true, added: false, chainId: requested };
  } catch (error) {
    // 4902 = the wallet does not know this chain yet -> add it (EIP-3085).
    if (error?.code === 4902 || /Unrecognized chain/i.test(error?.message || '')) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [chainParams(chain)] });
      return { switched: true, added: true, chainId: requested };
    }
    if (error?.code === 4001) throw new Error('Network switch rejected in the wallet');
    throw error;
  }
}

/**
 * Asks the wallet to track one ERC-20 (the MetaMask "import token" popup).
 * A user dismissing the popup resolves to false — that is not an app error.
 */
export async function watchAsset({ address, symbol, decimals, image }) {
  const provider = walletManager.getEip1193Provider();
  if (!provider?.request) throw new Error('No EVM wallet connected');
  if (!address) throw new Error(`${symbol || 'Token'} contract address is not configured yet (VITE_TOKEN_ADDRESS_*)`);

  try {
    const ok = await provider.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address,
          // Wallets truncate longer symbols — 11 chars is the MetaMask limit.
          symbol: String(symbol || 'FLASH').slice(0, 11),
          decimals: Number(decimals || 18),
          image: image || ''
        }
      }
    });
    return Boolean(ok);
  } catch (error) {
    if (error?.code === 4001) return false;
    throw error;
  }
}

/**
 * One-click helper: imports every configured Flash token on the network the USER
 * selected (the wallet's current chain). Only an unknown/unsupported chain
 * falls back to the build default (Polygon) — importing must never move the
 * user to another network. Returns what happened so the UI can print a
 * truthful summary — never fabricates success.
 */
export async function importAllFlashAssets() {
  const result = { switched: null, imported: [], skipped: [], failed: [] };

  // The user's selection wins: keep the wallet on its CURRENT chain when it is
  // one we support; the env default (ACTIVE_CHAIN) is only a fallback.
  const current = walletManager.getState().chainId;
  const target = getChain(current) ? current : ACTIVE_CHAIN.chainId;
  result.switched = await ensureWalletChain(target);

  for (const asset of flashAssets) {
    if (!asset.configured) {
      result.skipped.push(asset.symbol);
      continue;
    }
    try {
      const ok = await watchAsset(asset);
      if (ok) result.imported.push(asset.symbol);
      else result.skipped.push(asset.symbol);
    } catch (error) {
      result.failed.push(`${asset.symbol}: ${error.message}`);
    }
  }

  console.log('[watchAsset] import summary:', result);
  return result;
}
