import { ethers } from 'ethers';
import { FLASH_TOKEN_ABI } from './contractABI';

export const SUPPORTED_NETWORKS = {
  1: {
    chainId: '0x1',
    name: 'Ethereum Mainnet',
    currency: 'ETH',
    explorer: 'https://etherscan.io',
    rpc: 'https://eth.llamarpc.com'
  },
  11155111: {
    chainId: '0xaa36a7',
    name: 'Sepolia Testnet',
    currency: 'ETH',
    explorer: 'https://sepolia.etherscan.io',
    rpc: 'https://rpc.sepolia.org'
  },
  137: {
    chainId: '0x89',
    name: 'Polygon PoS',
    currency: 'MATIC',
    explorer: 'https://polygonscan.com',
    rpc: 'https://polygon-rpc.com'
  },
  56: {
    chainId: '0x38',
    name: 'BNB Smart Chain',
    currency: 'BNB',
    explorer: 'https://bscscan.com',
    rpc: 'https://bsc-dataseed.binance.org'
  }
};

export const DEFAULT_TOKEN_ADDRESS =
  import.meta.env?.VITE_TOKEN_ADDRESS || '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // Default placeholder or deployed address

/**
 * Connect user's real browser Web3 wallet (MetaMask, Coinbase, Trust Wallet, etc.)
 */
export async function connectRealWallet() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No Web3 wallet extension found. Please install MetaMask or Trust Wallet.');
  }

  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    // Request account access
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const network = await provider.getNetwork();
    const balanceWei = await provider.getBalance(address);

    return {
      provider,
      signer,
      address,
      chainId: Number(network.chainId),
      networkName: SUPPORTED_NETWORKS[Number(network.chainId)]?.name || `Chain ID ${network.chainId}`,
      nativeBalance: ethers.formatEther(balanceWei)
    };
  } catch (error) {
    console.error('Wallet connection error:', error);
    throw error;
  }
}

/**
 * Switch or add network in MetaMask
 */
export async function switchNetwork(chainIdHex) {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    console.warn('Network switch error:', err);
  }
}

/**
 * Fetch live ERC20 token balance for address
 */
export async function getTokenBalance(tokenAddress, userAddress) {
  try {
    if (!tokenAddress || !userAddress || !window.ethereum) return '0.00';
    const provider = new ethers.BrowserProvider(window.ethereum);
    const contract = new ethers.Contract(tokenAddress, FLASH_TOKEN_ABI, provider);
    const decimals = await contract.decimals().catch(() => 18);
    const balance = await contract.balanceOf(userAddress);
    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    console.warn('Error fetching token balance:', error);
    return '0.00';
  }
}

/**
 * Execute real on-chain token transfer
 */
export async function transferTokens(tokenAddress, toAddress, amount, decimals = 18) {
  if (!window.ethereum) throw new Error('Web3 Wallet not available');
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const tokenContract = new ethers.Contract(tokenAddress, FLASH_TOKEN_ABI, signer);
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
  
  const tx = await tokenContract.transfer(toAddress, parsedAmount);
  return tx;
}

/**
 * Execute real Flash Mint
 */
export async function flashMintTokens(tokenAddress, recipient, amount, decimals = 18) {
  if (!window.ethereum) throw new Error('Web3 Wallet not available');
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const tokenContract = new ethers.Contract(tokenAddress, FLASH_TOKEN_ABI, signer);
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);

  const tx = await tokenContract.flashMint(recipient, parsedAmount);
  return tx;
}

/**
 * Execute token burn
 */
export async function burnTokens(tokenAddress, amount, decimals = 18) {
  if (!window.ethereum) throw new Error('Web3 Wallet not available');
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const tokenContract = new ethers.Contract(tokenAddress, FLASH_TOKEN_ABI, signer);
  const parsedAmount = ethers.parseUnits(amount.toString(), decimals);

  const tx = await tokenContract.burn(parsedAmount);
  return tx;
}
