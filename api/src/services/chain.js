import { ethers } from 'ethers';
import config from '../config.js';
import { FLUXCOIN_ABI, FLUXFAUCET_ABI } from '../abis.js';

/**
 * Chain access layer: providers, backend wallets and contract handles.
 * Everything is lazy so the API can boot (and be tested) without an RPC/key.
 */

export const EXPLORERS = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  56: 'https://bscscan.com',
  97: 'https://testnet.bscscan.com',
  137: 'https://polygonscan.com',
  31337: null // local hardhat node
};

export function explorerTxUrl(hash, chainId = config.chain.chainId) {
  const base = config.chain.explorerUrl || EXPLORERS[chainId];
  return base && hash ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(address, chainId = config.chain.chainId) {
  const base = config.chain.explorerUrl || EXPLORERS[chainId];
  return base && address ? `${base}/address/${address}` : null;
}

let provider;
export function getProvider() {
  if (!config.chain.rpcUrl) return null;
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.chain.rpcUrl, config.chain.chainId, {
      staticNetwork: ethers.Network.from(config.chain.chainId)
    });
  }
  return provider;
}

/** Hot wallet holding MINTER_ROLE on FluxCoin (pays gas in GASLESS_MODE=server). */
export function getMinterWallet() {
  if (!config.keys.minterPrivateKey) return null;
  return new ethers.Wallet(config.keys.minterPrivateKey, getProvider() ?? undefined);
}

/** Holder of SIGNER_ROLE on FluxFaucet (signs EIP-712 withdrawal authorizations). */
export function getSignerWallet() {
  if (!config.keys.signerPrivateKey) return null;
  return new ethers.Wallet(config.keys.signerPrivateKey, getProvider() ?? undefined);
}

export function isContractConfigured() {
  return Boolean(config.chain.tokenAddress && config.chain.faucetAddress);
}

export function getTokenContract(runner) {
  if (!config.chain.tokenAddress) throw new Error('TOKEN_ADDRESS is not configured');
  return new ethers.Contract(config.chain.tokenAddress, FLUXCOIN_ABI, runner);
}

export function getFaucetContract(runner) {
  if (!config.chain.faucetAddress) throw new Error('FAUCET_ADDRESS is not configured');
  return new ethers.Contract(config.chain.faucetAddress, FLUXFAUCET_ABI, runner);
}

/** Live on-chain FLUX balance (returns null when the chain is not reachable). */
export async function getOnChainTokenBalance(address) {
  if (!address || !config.chain.tokenAddress) return null;
  try {
    const contract = getTokenContract(getProvider());
    const raw = await contract.balanceOf(address);
    return ethers.formatUnits(raw, config.decimals);
  } catch (error) {
    console.warn('[chain] balanceOf failed:', error.message);
    return null;
  }
}

export async function getChainStatus() {
  const status = {
    chainId: config.chain.chainId,
    rpcConfigured: Boolean(config.chain.rpcUrl),
    tokenAddress: config.chain.tokenAddress || null,
    faucetAddress: config.chain.faucetAddress || null,
    minterConfigured: Boolean(config.keys.minterPrivateKey),
    signerConfigured: Boolean(config.keys.signerPrivateKey),
    gaslessMode: config.gasless.mode,
    dryRun: config.allowDryRun,
    blockNumber: null,
    connected: false,
    token: null
  };

  const rpc = getProvider();
  if (!rpc) return status;

  try {
    status.blockNumber = await rpc.getBlockNumber();
    status.connected = true;
    if (config.chain.tokenAddress) {
      const token = getTokenContract(rpc);
      const [symbol, decimals, totalSupply] = await Promise.all([
        token.symbol().catch(() => 'FLUX'),
        token.decimals().catch(() => config.decimals),
        token.totalSupply().catch(() => 0n)
      ]);
      status.token = {
        symbol,
        decimals: Number(decimals),
        totalSupply: ethers.formatUnits(totalSupply, Number(decimals))
      };
    }
  } catch (error) {
    status.error = error.message;
  }

  return status;
}
