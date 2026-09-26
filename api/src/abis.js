/**
 * Minimal ABI fragments used by the backend.
 * Keep these in sync with contracts/src/FluxCoin.sol and contracts/src/FluxFaucet.sol.
 */

export const FLUXCOIN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function mint(address to, uint256 amount)',
  'event BackendMint(address indexed to, uint256 amount, string reason)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

export const FLUXFAUCET_ABI = [
  'function claim(address beneficiary, uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
  'function claimDigest(address beneficiary, uint256 amount, uint256 nonce, uint256 deadline) view returns (bytes32)',
  'function domainSeparator() view returns (bytes32)',
  'function nonceOf(address beneficiary) view returns (uint256)',
  'function maxClaimAmount() view returns (uint256)',
  'function totalClaimed() view returns (uint256)',
  'function WITHDRAWAL_TYPEHASH() view returns (bytes32)',
  'function trustedForwarder() view returns (address)',
  'event WithdrawalClaimed(address indexed beneficiary, uint256 amount, uint256 nonce, string method)'
];

/**
 * EIP-712 domain/type definitions shared by the API (signer) and the frontend
 * (ERC-4337 smart-account submission). MUST match FluxFaucet.sol exactly.
 */
export const FAUCET_EIP712 = {
  domainName: 'FluxCoinFaucet',
  domainVersion: '1',
  withdrawalTypes: {
    Withdrawal: [
      { name: 'beneficiary', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  }
};
