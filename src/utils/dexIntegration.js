import { ethers } from 'ethers';
import { UNISWAP_V2_ROUTER_ABI, FLASH_TOKEN_ABI } from './contractABI';

// Standard Uniswap V2 Router addresses on mainnet / testnets
export const UNISWAP_ROUTER_ADDRESS =
  import.meta.env?.VITE_ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// Common test/wrapped tokens
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

/**
 * Approve DEX router to spend tokens
 */
export async function approveRouter(tokenAddress, amount, decimals = 18) {
  if (!window.ethereum) throw new Error('Web3 wallet required');
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const tokenContract = new ethers.Contract(tokenAddress, FLASH_TOKEN_ABI, signer);
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
  const tx = await tokenContract.approve(UNISWAP_ROUTER_ADDRESS, parsedAmount);
  return tx;
}

/**
 * Perform token swap on DEX router
 */
export async function swapTokensOnDEX({
  tokenIn,
  tokenOut,
  amountIn,
  slippagePercent = 0.5,
  recipientAddress,
  routerAddress = UNISWAP_ROUTER_ADDRESS
}) {
  if (!window.ethereum) throw new Error('Web3 wallet required');
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const recipient = recipientAddress || (await signer.getAddress());

  const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, signer);

  const parsedAmountIn = ethers.parseUnits(amountIn.toString(), 18);
  const path = [tokenIn, tokenOut];
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 mins

  // Execute swap
  const tx = await router.swapExactTokensForTokens(
    parsedAmountIn,
    0, // slippage protection (0 or computed min for simulation/testnet)
    path,
    recipient,
    deadline
  );

  return tx;
}

/**
 * Quote expected output from DEX router
 */
export async function getExpectedSwapOutput(tokenIn, tokenOut, amountIn, routerAddress = UNISWAP_ROUTER_ADDRESS) {
  try {
    if (!window.ethereum || !amountIn || Number(amountIn) <= 0) return '0.00';
    const provider = new ethers.BrowserProvider(window.ethereum);
    const router = new ethers.Contract(routerAddress, UNISWAP_V2_ROUTER_ABI, provider);

    const parsedIn = ethers.parseUnits(amountIn.toString(), 18);
    const amounts = await router.getAmountsOut(parsedIn, [tokenIn, tokenOut]);
    return ethers.formatUnits(amounts[1], 18);
  } catch (e) {
    // Return simulated calculated quote if pool doesn't exist yet on network
    const est = (parseFloat(amountIn) * 0.995).toFixed(4);
    return est;
  }
}
