/**
 * Contract ABIs used by the frontend.
 *
 * These mirror `contracts/src/FluxCoin.sol` (standard ERC-20, 18 decimals) and
 * `contracts/src/FluxFaucet.sol` (backend-authorized gasless claims). They replace
 * the old `src/utils/contractABI.js`, which described a `flashMint()` function
 * that no longer exists in the deployed token.
 */

/** Standard ERC-20 + the FluxCoin view/mint surface. */
export const ERC20_ABI = [
  // --- standard ERC-20 (exchanges + DEXs depend on exactly these) ---
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function burn(uint256 amount)',
  'function burnFrom(address from, uint256 amount)',

  // --- FluxCoin specifics (role-gated minting owned by the website backend) ---
  'function MAX_SUPPLY() view returns (uint256)',
  'function mint(address to, uint256 amount)',
  'function mintedBy(address minter) view returns (uint256)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',

  // --- events (used to show real history in the UI) ---
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

/** FluxFaucet — redeems the backend-signed withdrawal authorization. */
export const FAUCET_ABI = [
  'function claim(address beneficiary, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
  'function maxClaim() view returns (uint256)',
  'function nonceOf(address beneficiary) view returns (uint256)',
  'function signer() view returns (address)',
  'function token() view returns (address)',
  'event Claimed(address indexed beneficiary, uint256 amount, uint256 nonce)'
];

/** Uniswap V2 / PancakeSwap V2 / QuickSwap router (LP + swaps). */
export const UNISWAP_V2_ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)'
];

/** Minimal factory ABI so the UI can show the real LP pair address. */
export const UNISWAP_V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)'
];
