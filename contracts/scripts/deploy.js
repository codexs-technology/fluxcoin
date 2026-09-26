/**
 * Deploys the full FluxCoin suite:
 *   1. FluxCoin         (standard ERC-20, 18 decimals, role-gated minting)
 *   2. FluxFaucet       (redeems backend-signed withdrawals, ERC-2771/Gelato aware)
 *
 * Usage (see README for the full walk-through):
 *   npx hardhat run scripts/deploy.js --network sepolia
 *
 * Writes the resulting addresses to ../.env.contracts so the API + frontend can pick them up.
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const GELATO_TRUSTED_FORWARDER = '0xd8253782c45a12053594b9deB72d8e8aB2Fca54c';

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  // ---- Configurable deployment parameters -------------------------------------
  const admin = env('TOKEN_ADMIN_ADDRESS', deployer.address); // treasury / multisig
  const backendMinter = env('BACKEND_MINTER_ADDRESS', deployer.address); // API hot wallet
  const initialSupply = BigInt(env('INITIAL_SUPPLY', '100000000')); // 100M FLUX to treasury
  const maxSupply = BigInt(env('MAX_SUPPLY', '1000000000')); // 1B FLUX hard cap
  const maxClaim = BigInt(env('MAX_CLAIM_TOKENS', '100000')); // per-withdrawal cap (whole tokens)
  const trustedForwarder = env('GELATO_TRUSTED_FORWARDER', GELATO_TRUSTED_FORWARDER);
  const decimals = 18n;

  console.log(`\n== FluxCoin deployment ==`);
  console.log(`network       : ${hre.network.name} (chainId ${chainId})`);
  console.log(`deployer      : ${deployer.address}`);
  console.log(`admin         : ${admin}`);
  console.log(`backend minter: ${backendMinter}`);
  console.log(`trusted fwd   : ${trustedForwarder}\n`);

  const FluxCoin = await hre.ethers.getContractFactory('FluxCoin');
  const fluxCoin = await FluxCoin.deploy(admin, initialSupply, maxSupply);
  await fluxCoin.waitForDeployment();
  const coinAddress = await fluxCoin.getAddress();
  console.log(`FluxCoin      : ${coinAddress}`);

  const FluxFaucet = await hre.ethers.getContractFactory('FluxFaucet');
  const faucet = await FluxFaucet.deploy(
    admin,
    coinAddress,
    trustedForwarder,
    maxClaim * 10n ** decimals
  );
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  console.log(`FluxFaucet    : ${faucetAddress}`);

  // The faucet mints FLUX on claim => it needs MINTER_ROLE on the token.
  const MINTER_ROLE = await fluxCoin.MINTER_ROLE();
  if (await fluxCoin.hasRole(MINTER_ROLE, faucetAddress)) {
    console.log('faucet already holds MINTER_ROLE');
  } else {
    const tx = await fluxCoin.grantRole(MINTER_ROLE, faucetAddress);
    await tx.wait();
    console.log('granted MINTER_ROLE to FluxFaucet');
  }

  // Grant MINTER_ROLE to the backend hot wallet (server-side direct mint fallback).
  if (backendMinter.toLowerCase() !== admin.toLowerCase() && !(await fluxCoin.hasRole(MINTER_ROLE, backendMinter))) {
    const tx = await fluxCoin.grantRole(MINTER_ROLE, backendMinter);
    await tx.wait();
    console.log(`granted MINTER_ROLE to backend minter ${backendMinter}`);
  }

  // The wallet that signs the EIP-712 withdrawal authorizations needs SIGNER_ROLE on
  // the faucet (the admin holds it after deployment, but the signer is usually a
  // separate key — BACKEND_SIGNER_ADDRESS in .env).
  const SIGNER_ROLE = await faucet.SIGNER_ROLE();
  const backendSigner = env('BACKEND_SIGNER_ADDRESS', deployer.address);
  if (!(await faucet.hasRole(SIGNER_ROLE, backendSigner))) {
    const tx = await faucet.grantRole(SIGNER_ROLE, backendSigner);
    await tx.wait();
    console.log(`granted SIGNER_ROLE to backend signer ${backendSigner}`);
  } else {
    console.log(`backend signer ${backendSigner} already holds SIGNER_ROLE`);
  }

  const out = {
    chainId,
    network: hre.network.name,
    FluxCoin: coinAddress,
    FluxFaucet: faucetAddress,
    admin,
    backendMinter,
    backendSigner,
    trustedForwarder,
    maxClaimTokens: maxClaim.toString(),
    deployedAt: new Date().toISOString()
  };

  const target = path.join(__dirname, '..', '..', '.env.contracts.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nSaved deployment manifest -> ${target}`);

  console.log(`\nAdd these to your root .env:`);
  console.log(`VITE_TOKEN_ADDRESS=${coinAddress}`);
  console.log(`VITE_FAUCET_ADDRESS=${faucetAddress}`);
  console.log(`VITE_NETWORK_ID=${chainId}`);
  console.log(`TOKEN_ADDRESS=${coinAddress}`);
  console.log(`FAUCET_ADDRESS=${faucetAddress}`);
  console.log(`CHAIN_ID=${chainId}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
