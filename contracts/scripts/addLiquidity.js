/**
 * Seeds a FLUX/<native> liquidity pool so the coin becomes tradable on a DEX.
 *
 * Works with any Uniswap-V2-compatible router:
 *   - Uniswap V2 (Ethereum/Sepolia) : 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
 *   - PancakeSwap V2 (BSC)          : 0x10ED43C718714eb63d5aA57B78B54704E256024E
 *   - QuickSwap (Polygon)           : 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
 *
 * The script approves the router, then calls addLiquidityETH with FLUX + native coin.
 *
 *   TOKEN_ADDRESS=0x... ROUTER_ADDRESS=0x... LP_TOKEN_AMOUNT=100000 LP_NATIVE_AMOUNT=0.1 \
 *     npx hardhat run scripts/addLiquidity.js --network sepolia
 */
const hre = require('hardhat');

const ROUTERS = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  11155111: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  56: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  97: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
  137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'
};

const ROUTER_ABI = [
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function factory() view returns (address)'
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  const routerAddress = process.env.ROUTER_ADDRESS || ROUTERS[chainId];
  const lpTokens = process.env.LP_TOKEN_AMOUNT || '100000';
  const nativeAmount = process.env.LP_NATIVE_AMOUNT || '0.1';
  const slippageBps = BigInt(process.env.LP_SLIPPAGE_BPS || '500'); // 5%

  if (!tokenAddress) throw new Error('TOKEN_ADDRESS is required (the deployed FluxCoin)');
  if (!routerAddress) throw new Error(`No default router for chainId ${chainId}; pass ROUTER_ADDRESS`);

  console.log(`Seeding FLUX/native LP on ${hre.network.name}`);
  console.log(`router: ${routerAddress}`);
  console.log(`token : ${tokenAddress}`);

  const token = await hre.ethers.getContractAt('FluxCoin', tokenAddress, signer);
  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, signer);

  const amountTokenDesired = hre.ethers.parseUnits(lpTokens, 18);
  const amountNativeDesired = hre.ethers.parseEther(nativeAmount);

  const amountTokenMin = (amountTokenDesired * (10000n - slippageBps)) / 10000n;
  const amountNativeMin = (amountNativeDesired * (10000n - slippageBps)) / 10000n;

  const approveTx = await token.approve(routerAddress, amountTokenDesired);
  await approveTx.wait();
  console.log(`approved router (tx ${approveTx.hash})`);

  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const tx = await router.addLiquidityETH(
    tokenAddress,
    amountTokenDesired,
    amountTokenMin,
    amountNativeMin,
    signer.address,
    deadline,
    { value: amountNativeDesired }
  );
  const receipt = await tx.wait();
  console.log(`liquidity added in block ${receipt.blockNumber} (tx ${tx.hash})`);

  const factory = await router.factory();
  console.log(`factory: ${factory}`);
  console.log('Check the pair address on the DEX UI / explorer and keep the LP NFT safe.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
