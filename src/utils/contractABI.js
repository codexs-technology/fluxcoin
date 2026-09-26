export const FLASH_TOKEN_ABI = [
  // Standard ERC20
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  
  // FlashToken Custom Methods
  'function flashMint(address to, uint256 amount) external',
  'function flashMintFee() view returns (uint256)',
  'function authorizedMinters(address) view returns (bool)',
  'function setFlashMintFee(uint256 newFee) external',
  'function addAuthorizedMinter(address minter) external',
  'function removeAuthorizedMinter(address minter) external',
  'function burn(uint256 amount) external',
  'function owner() view returns (address)',

  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event FlashMint(address indexed to, uint256 amount)',
  'event TokensBurned(address indexed burner, uint256 amount)'
];

export const UNISWAP_V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function WETH() external pure returns (address)'
];
