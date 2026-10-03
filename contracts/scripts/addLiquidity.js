/**
 * Seeds liquidity for a per-asset FlashToken on any Uniswap-V2-compatible DEX.
 *
 * PRIMARY mode (LP_PAIR=usdc, default) — the LOCKED launch route:
 *   Flash USDT <-> USDC on QuickSwap (Polygon, chainId 137)
 *     - QuickSwap V2 router (verified on Polygonscan): 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
 *     - USDC  (native, Circle): 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (6 decimals)
 *     - USDC.e (bridged)     : 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 (6 decimals, opt-in via LP_QUOTE_ADDRESS)
 *
 * OPTIONAL mode (LP_PAIR=native) — Flash asset <-> native coin via addLiquidityETH.
 *
 * Routers by chain (defaults; override with ROUTER_ADDRESS):
 *   - Uniswap V2 (Ethereum/Sepolia) : 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
 *   - PancakeSwap V2 (BSC)           : 0x10ED43C718714eb63d5aA57B78B54704E256024E
 *   - QuickSwap (Polygon)            : 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
 *
 * Usage (run from contracts/ — the root .env is loaded by hardhat.config, so the
 * TOKEN_ADDRESS_<ID> vars and any LP_* values can simply live there):
 *   # PRIMARY: Flash USDT <-> USDC on QuickSwap (Polygon mainnet)
 *   ASSET_ID=usdt LP_TOKEN_AMOUNT=50000 LP_USDC_AMOUNT=50 npx hardhat run scripts/addLiquidity.js --network polygon
 *
 *   # OPTIONAL: Flash BTC <-> POL (native pair)
 *   ASSET_ID=btc LP_PAIR=native LP_TOKEN_AMOUNT=100 LP_NATIVE_AMOUNT=5 npx hardhat run scripts/addLiquidity.js --network polygon
 *
 * Env vars:
 *   ASSET_ID           usdt | btc | eth | trx | sol            (default: usdt)
 *   TOKEN_ADDRESS      explicit token override                  (default: TOKEN_ADDRESS_<ID> from the root .env)
 *   LP_PAIR            usdc (default, PRIMARY route) | native
 *   LP_TOKEN_AMOUNT    whole Flash tokens to seed               (per-asset decimals applied automatically)
 *   LP_USDC_AMOUNT     whole USDC to seed                       [required for LP_PAIR=usdc]
 *   LP_QUOTE_ADDRESS    USDC variant override                   (default: native USDC on Polygon)
 *   LP_NATIVE_AMOUNT   native coin to seed                      [LP_PAIR=native]
 *   ROUTER_ADDRESS     router override                           (default: per-chain)
 *   LP_SLIPPAGE_BPS    slippage for the minimum amounts         (default: 500 = 5%)
 */
const hre = require('hardhat');

// MUST stay in sync with scripts/deployFlashAssets.js — decimals are PER ASSET
// (USDT 6, BTC 8, ETH 18, TRX 6, SOL 9). Never assume 18 here.
const ASSETS = {
  usdt: { symbol: 'USDT', decimals: 6, envName: 'TOKEN_ADDRESS_USDT' },
  btc: { symbol: 'BTC', decimals: 8, envName: 'TOKEN_ADDRESS_BTC' },
  eth: { symbol: 'ETH', decimals: 18, envName: 'TOKEN_ADDRESS_ETH' },
  trx: { symbol: 'TRX', decimals: 6, envName: 'TOKEN_ADDRESS_TRX' },
  sol: { symbol: 'SOL', decimals: 9, envName: 'TOKEN_ADDRESS_SOL' }
};

const ROUTERS = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 (Ethereum)
  11155111: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 (Sepolia)
  56: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 (BSC)
  97: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // PancakeSwap V2 (BSC testnet)
  137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' // QuickSwap V2 (Polygon)
};

// Quote tokens for LP_PAIR=usdc (Polygon 137; other chains must pass LP_QUOTE_ADDRESS).
const QUOTES = {
  137: {
    // Native USDC (Circle) — PRIMARY quote for the locked Flash USDT <-> USDC route.
    USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', decimals: 6 },
    // Bridged USDC.e — opt-in via LP_QUOTE_ADDRESS if you prefer the deeper bridge pool.
    'USDC.e': { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', decimals: 6 }
  }
};

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const ROUTER_ABI = [
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function factory() view returns (address)',
  'function WETH() view returns (address)'
];

const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address)'];

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// Fallback: the deploy script saves all addresses in .env.flash-assets.json (repo root).
// If TOKEN_ADDRESS / TOKEN_ADDRESS_<ID> are not in the .env, read the manifest —
// but ONLY when its chainId matches the network this script is running against.
function manifestAddress(chainId, assetId) {
  try {
    const fs = require('fs');
    const path = require('path');
    const manifestPath = path.join(__dirname, '..', '..', '.env.flash-assets.json');
    if (!fs.existsSync(manifestPath)) return '';
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Number(manifest.chainId) !== Number(chainId)) return '';
    const asset = manifest.assets && manifest.assets[assetId];
    return asset ? asset.address : '';
  } catch {
    return '';
  }
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  // ---- resolve the Flash asset (per-asset contract + per-asset decimals) ----
  const assetId = env('ASSET_ID', 'usdt').toLowerCase();
  const asset = ASSETS[assetId];
  if (!asset) throw new Error(`Unknown ASSET_ID "${assetId}" — valid ids: ${Object.keys(ASSETS).join(', ')}`);
  const tokenAddress = env('TOKEN_ADDRESS', env(asset.envName, manifestAddress(chainId, assetId)));
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    throw new Error(`No ${asset.symbol} address — set TOKEN_ADDRESS (or ${asset.envName} in the root .env), or run the deploy first (its .env.flash-assets.json manifest is used automatically)`);
  }
  const routerAddress = env('ROUTER_ADDRESS', ROUTERS[chainId] || '');
  if (!routerAddress) throw new Error(`No default router for chainId ${chainId}; pass ROUTER_ADDRESS`);

  const pairMode = env('LP_PAIR', 'usdc').toLowerCase(); // usdc = PRIMARY route, native = optional
  if (!['usdc', 'native'].includes(pairMode)) {
    throw new Error(`LP_PAIR must be "usdc" or "native" (got "${pairMode}")`);
  }

  const lpTokens = env('LP_TOKEN_AMOUNT', '100000');
  const lpUsdc = env('LP_USDC_AMOUNT', '');
  const lpNative = env('LP_NATIVE_AMOUNT', '0.1');
  const slippageBps = BigInt(env('LP_SLIPPAGE_BPS', '500')); // 5%

  // ---- contracts + sanity check the decimals against the registry ----
  const token = await hre.ethers.getContractAt('FlashToken', tokenAddress, signer);
  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, signer);

  const onChainDecimals = Number(await token.decimals());
  if (onChainDecimals !== asset.decimals) {
    throw new Error(
      `${asset.symbol} at ${tokenAddress} reports ${onChainDecimals} decimals (expected ${asset.decimals}) — wrong TOKEN_ADDRESS for ASSET_ID=${assetId}?`
    );
  }

  const amountTokenDesired = hre.ethers.parseUnits(lpTokens, asset.decimals);
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const withSlippage = (amount) => (amount * (10000n - slippageBps)) / 10000n;

  console.log(`Seeding ${asset.symbol} liquidity on ${hre.network.name} (chainId ${chainId}, pair mode: ${pairMode})`);
  console.log(`router: ${routerAddress}`);
  console.log(`token : ${tokenAddress} (${asset.symbol}, ${asset.decimals} decimals)`);

  // Balance pre-checks fail BEFORE any gas is spent on approvals.
  const tokenBalance = await token.balanceOf(signer.address);
  if (tokenBalance < amountTokenDesired) {
    throw new Error(
      `Signer ${signer.address} holds ${hre.ethers.formatUnits(tokenBalance, asset.decimals)} ${asset.symbol} but LP_TOKEN_AMOUNT is ${lpTokens} — mint/transfer tokens to this wallet first`
    );
  }

  let quoteAddress = ''; // used for the pair lookup at the end

  if (pairMode === 'usdc') {
    // ---- PRIMARY: Flash asset <-> USDC (e.g. Flash USDT <-> USDC on QuickSwap) ----
    const quote = QUOTES[chainId]?.USDC;
    quoteAddress = env('LP_QUOTE_ADDRESS', quote?.address || '');
    if (!/^0x[a-fA-F0-9]{40}$/.test(quoteAddress)) {
      throw new Error(`No USDC default for chainId ${chainId} — pass LP_QUOTE_ADDRESS`);
    }
    if (!lpUsdc) throw new Error('LP_USDC_AMOUNT is required for LP_PAIR=usdc — whole USDC units, e.g. 50');

    const quoteContract = new hre.ethers.Contract(quoteAddress, ERC20_ABI, signer);
    const quoteDecimals = Number(await quoteContract.decimals()); // USDC/USDC.e = 6, read anyway to be safe
    const quoteSymbol = await quoteContract.symbol();
    const amountQuoteDesired = hre.ethers.parseUnits(lpUsdc, quoteDecimals);

    const quoteBalance = await quoteContract.balanceOf(signer.address);
    if (quoteBalance < amountQuoteDesired) {
      throw new Error(
        `Signer ${signer.address} holds ${hre.ethers.formatUnits(quoteBalance, quoteDecimals)} ${quoteSymbol} but LP_USDC_AMOUNT is ${lpUsdc} — send USDC to this wallet first`
      );
    }

    console.log(`quote : ${quoteAddress} (${quoteSymbol}, ${quoteDecimals} decimals)`);
    console.log(`seed  : ${lpTokens} ${asset.symbol} + ${lpUsdc} ${quoteSymbol}`);

    // Approve whichever side needs it (token + quote).
    const sides = [
      { label: 'token', contract: token, amount: amountTokenDesired },
      { label: 'quote', contract: quoteContract, amount: amountQuoteDesired }
    ];
    for (const side of sides) {
      const allowance = await side.contract.allowance(signer.address, routerAddress);
      if (allowance < side.amount) {
        const approveTx = await side.contract.approve(routerAddress, side.amount);
        await approveTx.wait();
        console.log(`approved ${side.label} for router (tx ${approveTx.hash})`);
      } else {
        console.log(`${side.label} allowance already sufficient — skip approve`);
      }
    }

    const tx = await router.addLiquidity(
      tokenAddress,
      quoteAddress,
      amountTokenDesired,
      amountQuoteDesired,
      withSlippage(amountTokenDesired),
      withSlippage(amountQuoteDesired),
      signer.address,
      deadline
    );
    const receipt = await tx.wait();
    console.log(`liquidity added in block ${receipt.blockNumber} (tx ${tx.hash})`);
  } else {
    // ---- OPTIONAL: Flash asset <-> native coin (addLiquidityETH) ----
    const amountNativeDesired = hre.ethers.parseEther(lpNative);
    const nativeBalance = await hre.ethers.provider.getBalance(signer.address);
    if (nativeBalance < amountNativeDesired) {
      throw new Error(
        `Signer ${signer.address} holds ${hre.ethers.formatEther(nativeBalance)} native coin but LP_NATIVE_AMOUNT is ${lpNative}`
      );
    }
    console.log(`seed  : ${lpTokens} ${asset.symbol} + ${lpNative} native`);

    const allowance = await token.allowance(signer.address, routerAddress);
    if (allowance < amountTokenDesired) {
      const approveTx = await token.approve(routerAddress, amountTokenDesired);
      await approveTx.wait();
      console.log(`approved router (tx ${approveTx.hash})`);
    } else {
      console.log('token allowance already sufficient — skip approve');
    }

    const tx = await router.addLiquidityETH(
      tokenAddress,
      amountTokenDesired,
      withSlippage(amountTokenDesired),
      withSlippage(amountNativeDesired),
      signer.address,
      deadline,
      { value: amountNativeDesired }
    );
    const receipt = await tx.wait();
    console.log(`liquidity added in block ${receipt.blockNumber} (tx ${tx.hash})`);
    quoteAddress = await router.WETH();
  }

  // Pair address — bookmark it: the LP tokens are the only way to withdraw this liquidity later.
  const factoryAddress = await router.factory();
  const factory = new hre.ethers.Contract(factoryAddress, FACTORY_ABI, signer);
  const pair = await factory.getPair(tokenAddress, quoteAddress);
  console.log(`factory: ${factoryAddress}`);
  console.log(`pair   : ${pair}${pair === hre.ethers.ZeroAddress ? ' (not found — check the tx receipt above)' : ''}`);
  console.log('Keep the LP tokens safe — they are the only way to withdraw this liquidity.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
