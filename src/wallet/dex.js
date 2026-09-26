/**
 * DEX helpers (Uniswap V2 / PancakeSwap V2 / QuickSwap compatible).
 *
 * Replaces `src/utils/dexIntegration.js`, which fabricated a swap quote
 * (`amountIn * 0.995`) whenever the real call failed and used `window.ethereum`
 * directly. Everything here uses the connected wallet from the WalletManager and
 * returns REAL on-chain values — a failing quote is surfaced as an error, never
 * invented.
 */
import { ethers } from 'ethers';
import { walletManager } from './manager.js';
import { approveToken, getReadProvider } from './token.js';
import { UNISWAP_V2_ROUTER_ABI } from '../contracts/abis.js';

export const DEFAULT_SLIPPAGE_BPS = 100n; // 1%

function routerContract(address, runner) {
  if (!ethers.isAddress(address)) {
    throw new Error(`No DEX router configured for this network ("${address}")`);
  }
  return new ethers.Contract(ethers.getAddress(address), UNISWAP_V2_ROUTER_ABI, runner);
}

/** Real quote from the router. Throws (with the pool reason) when it fails. */
export async function getExpectedSwapOutput({ routerAddress, tokenIn, tokenOut, amountIn, decimalsIn = 18, decimalsOut = 18 }) {
  if (!amountIn || Number(amountIn) <= 0) return '0';
  const router = routerContract(routerAddress, getReadProvider());
  const amounts = await router.getAmountsOut(
    ethers.parseUnits(String(amountIn), decimalsIn),
    [ethers.getAddress(tokenIn), ethers.getAddress(tokenOut)]
  );
  return ethers.formatUnits(amounts[1], decimalsOut);
}

/** Approves the router to spend `amount` of the token (required before a swap). */
export async function approveRouter({ routerAddress, tokenAddress, amount, decimals = 18 }) {
  await walletManager.getSigner(); // throws with a clear message when not connected
  return approveToken(tokenAddress, routerAddress, amount, decimals);
}

/**
 * Executes the swap with REAL slippage protection.
 * @param {object} params
 * @param {number|string} [params.slippageBps=100] 1% default
 */
export async function swapExactTokensForTokens({
  routerAddress,
  tokenIn,
  tokenOut,
  amountIn,
  recipientAddress,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  decimalsIn = 18,
  decimalsOut = 18
}) {
  const signer = await walletManager.getSigner();
  const router = routerContract(routerAddress, signer);
  const recipient = recipientAddress || (await signer.getAddress());

  const amount = ethers.parseUnits(String(amountIn), decimalsIn);
  const path = [ethers.getAddress(tokenIn), ethers.getAddress(tokenOut)];
  const quoted = await router.getAmountsOut(amount, path);
  const amountOutMin = (quoted[1] * (10000n - BigInt(slippageBps))) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  return router.swapExactTokensForTokens(amount, amountOutMin, path, ethers.getAddress(recipient), deadline);
}

/** Swaps native gas coin (ETH/BNB/MATIC) for FLUX. */
export async function swapExactNativeForTokens({ routerAddress, tokenOut, nativeAmount, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
  const signer = await walletManager.getSigner();
  const router = routerContract(routerAddress, signer);
  const wrapped = await router.WETH();
  const value = ethers.parseEther(String(nativeAmount));
  const path = [wrapped, ethers.getAddress(tokenOut)];
  const quoted = await router.getAmountsOut(value, path);
  const amountOutMin = (quoted[1] * (10000n - BigInt(slippageBps))) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  return router.swapExactETHForTokens(amountOutMin, path, await signer.getAddress(), deadline, { value });
}


/** Swaps FLUX back to the chain's native gas coin (ETH/BNB/MATIC). */
export async function swapExactTokensForNative({ routerAddress, tokenIn, amountIn, slippageBps = DEFAULT_SLIPPAGE_BPS, decimalsIn = 18 }) {
  const signer = await walletManager.getSigner();
  const router = routerContract(routerAddress, signer);
  const wrapped = await router.WETH();
  const amount = ethers.parseUnits(String(amountIn), decimalsIn);
  const path = [ethers.getAddress(tokenIn), wrapped];
  const quoted = await router.getAmountsOut(amount, path);
  const amountOutMin = (quoted[1] * (10000n - BigInt(slippageBps))) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  return router.swapExactTokensForETH(amount, amountOutMin, path, await signer.getAddress(), deadline);
}

/** Wrapped native address used by the router (needed to quote FLUX/native pools). */
export async function getWrappedNative(routerAddress) {
  const router = routerContract(routerAddress, getReadProvider());
  return router.WETH();
}

/** Real quote expressed in the target token decimals. */
export async function quote({ routerAddress, tokenIn, tokenOut, amountIn, decimalsIn = 18, decimalsOut = 18 }) {
  const router = routerContract(routerAddress, getReadProvider());
  const amounts = await router.getAmountsOut(ethers.parseUnits(String(amountIn), decimalsIn), [
    ethers.getAddress(tokenIn),
    ethers.getAddress(tokenOut)
  ]);
  return ethers.formatUnits(amounts[1], decimalsOut);
}
