/**
 * ERC-20 helpers for the real FLUX token (src/wallet layer).
 *
 * Replaces the old `src/utils/walletConnection.js`, which always talked to
 * `window.ethereum` (whatever extension happened to win the injection race) and
 * fell back to a hardcoded placeholder token address. Here the provider comes
 * from the WalletManager, i.e. from the wallet the user actually connected.
 */
import { ethers } from 'ethers';
import { walletManager } from './manager.js';
import { ACTIVE_CHAIN } from './chains.js';
import { ERC20_ABI, UNISWAP_V2_FACTORY_ABI } from '../contracts/abis.js';

let publicProvider = null;

/** Read-only provider: the connected wallet when available, else a plain RPC. */
export function getReadProvider() {
  const browserProvider = walletManager.getBrowserProvider();
  if (browserProvider) return browserProvider;
  if (!publicProvider) publicProvider = new ethers.JsonRpcProvider(ACTIVE_CHAIN.rpc);
  return publicProvider;
}

function requireAddress(address, label = 'token address') {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid ${label}: "${address}". Set VITE_TOKEN_ADDRESS in the root .env (see README).`);
  }
  return ethers.getAddress(address);
}

const metadataCache = new Map();

/** name/symbol/decimals — cached because they never change for a token. */
export async function readTokenMetadata(tokenAddress) {
  const address = requireAddress(tokenAddress);
  const cached = metadataCache.get(address);
  if (cached) return cached;

  const contract = new ethers.Contract(address, ERC20_ABI, getReadProvider());
  const [name, symbol, decimals] = await Promise.all([
    contract.name().catch(() => null),
    contract.symbol().catch(() => null),
    contract.decimals().catch(() => 18)
  ]);
  const result = { address, name, symbol, decimals: Number(decimals) };
  metadataCache.set(address, result);
  return result;
}

/** Real on-chain balance, formatted with the token decimals. */
export async function readTokenBalance(tokenAddress, owner) {
  const address = requireAddress(tokenAddress);
  if (!ethers.isAddress(owner)) return null;
  const contract = new ethers.Contract(address, ERC20_ABI, getReadProvider());
  const decimals = await contract.decimals().catch(() => 18);
  const balance = await contract.balanceOf(owner);
  return ethers.formatUnits(balance, Number(decimals));
}

export async function readAllowance(tokenAddress, owner, spender) {
  const address = requireAddress(tokenAddress);
  const contract = new ethers.Contract(address, ERC20_ABI, getReadProvider());
  const allowance = await contract.allowance(owner, requireAddress(spender, 'spender address'));
  return allowance;
}

export async function readTotalSupply(tokenAddress) {
  const address = requireAddress(tokenAddress);
  const contract = new ethers.Contract(address, ERC20_ABI, getReadProvider());
  return contract.totalSupply();
}

async function writeContract(tokenAddress) {
  const signer = await walletManager.getSigner();
  return new ethers.Contract(requireAddress(tokenAddress), ERC20_ABI, signer);
}

/** ERC-20 transfer signed by the connected wallet. Throws when disconnected. */
export async function transferToken(tokenAddress, to, amount, decimals = 18) {
  if (!ethers.isAddress(to)) throw new Error(`Recipient "${to}" is not a valid address`);
  const contract = await writeContract(tokenAddress);
  const parsed = ethers.parseUnits(String(amount), decimals);
  if (parsed <= 0n) throw new Error('Transfer amount must be greater than zero');
  return contract.transfer(ethers.getAddress(to), parsed);
}

export async function approveToken(tokenAddress, spender, amount, decimals = 18) {
  const contract = await writeContract(tokenAddress);
  const parsed = amount === 'max' ? ethers.MaxUint256 : ethers.parseUnits(String(amount), decimals);
  return contract.approve(requireAddress(spender, 'spender address'), parsed);
}

export async function burnToken(tokenAddress, amount, decimals = 18) {
  const contract = await writeContract(tokenAddress);
  return contract.burn(ethers.parseUnits(String(amount), decimals));
}

/** Address of the FLUX/<quote> liquidity pair, or null when no pool exists yet. */
export async function getPairAddress(factoryAddress, tokenA, tokenB) {
  if (!ethers.isAddress(factoryAddress)) return null;
  const factory = new ethers.Contract(factoryAddress, UNISWAP_V2_FACTORY_ABI, getReadProvider());
  const pair = await factory.getPair(requireAddress(tokenA), requireAddress(tokenB, 'quote token address'));
  return /^0x0{40}$/i.test(pair) ? null : pair;
}
