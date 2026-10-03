/**
 * Deployment wiring for the FluxCoin contracts (frontend side).
 *
 * The addresses are NEVER hardcoded to a random/placeholder token: each asset's
 * contract (USDT/BTC/ETH/TRX/SOL) comes from the deploy manifest that
 * `contracts/scripts/deployFlashAssets.js` prints, via the per-asset env vars
 * in the repository root `.env`:
 *
 *   VITE_TOKEN_ADDRESS_USDT=0x...   (see src/contracts/assets.js for all 5)
 *   VITE_NETWORK_ID=137              <- chain the contracts live on
 *   VITE_ROUTER_ADDRESS=0x...       <- optional DEX router override
 *
 * The legacy single-token vars (VITE_TOKEN_ADDRESS / VITE_TOKEN_SYMBOL /
 * VITE_TOKEN_DECIMALS) are only fallbacks for the legacy `useToken()` defaults
 * and default to the default asset (USDT) — the FLUX token was removed.
 *
 * When they are missing the app says so instead of pretending to be connected to
 * a token (this replaced the old `0x6B1754...` DAI placeholder).
 */
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID, explorerAddressUrl } from '../wallet/chains.js';
import { flashAssets } from './assets.js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

/** Uniswap-V2 compatible routers (used for LP seeding + swaps — see README). */
export const DEX_ROUTERS = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 (Ethereum)
  11155111: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 (Sepolia)
  56: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 (BSC)
  97: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // PancakeSwap V2 (BSC testnet)
  137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' // QuickSwap (Polygon)
};

/** Human label matching DEX_ROUTERS, shown in the UI ("04 // DEX SWAP" tab). */
export const DEX_ROUTER_LABELS = {
  1: 'UNISWAP V2',
  11155111: 'UNISWAP V2',
  56: 'PANCAKESWAP V2',
  97: 'PANCAKESWAP V2',
  137: 'QUICKSWAP V2'
};

/** Wrapped native token per chain (needed for token/WETH style routing). */
export const WRAPPED_NATIVE = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  11155111: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  97: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export const TOKEN_ADDRESS = EVM_ADDRESS_RE.test(env.VITE_TOKEN_ADDRESS || '') ? env.VITE_TOKEN_ADDRESS : '';
export const FAUCET_ADDRESS = EVM_ADDRESS_RE.test(env.VITE_FAUCET_ADDRESS || '') ? env.VITE_FAUCET_ADDRESS : '';
export const ROUTER_ADDRESS =
  (EVM_ADDRESS_RE.test(env.VITE_ROUTER_ADDRESS || '') && env.VITE_ROUTER_ADDRESS) ||
  DEX_ROUTERS[ACTIVE_CHAIN_ID] ||
  '';

/** Legacy single-token defaults — mirror the DEFAULT asset (USDT) from the registry. */
const DEFAULT_ASSET = flashAssets[0];
export const TOKEN_SYMBOL = env.VITE_TOKEN_SYMBOL || DEFAULT_ASSET.symbol;
/** Contract precision of the default asset (matches src/contracts/assets.js). */
export const TOKEN_DECIMALS = DEFAULT_ASSET.decimals;

export const WRAPPED_NATIVE_ADDRESS = WRAPPED_NATIVE[ACTIVE_CHAIN_ID] || '';

/** Label of the active chain's router (shown in the "04 // DEX SWAP" tab). */
export const ROUTER_LABEL = DEX_ROUTER_LABELS[ACTIVE_CHAIN_ID] || 'DEX';

/** True when this build knows where the selected asset's token lives on the active chain. */
export function isTokenConfigured() {
  return Boolean(TOKEN_ADDRESS);
}

/** Human readable reason for the UI when the token is not wired yet. */
export function tokenConfigHint() {
  if (isTokenConfigured()) return null;
  return `VITE_TOKEN_ADDRESS_USDT is not set — deploy the contracts (contracts/scripts/deployFlashAssets.js) and add the printed addresses to the root .env (chain ${ACTIVE_CHAIN_ID} / ${ACTIVE_CHAIN.name})`;
}

export function explorerTokenUrl(address = TOKEN_ADDRESS) {
  if (!address) return null;
  return explorerAddressUrl(address, ACTIVE_CHAIN_ID);
}

export { ACTIVE_CHAIN, ACTIVE_CHAIN_ID };
