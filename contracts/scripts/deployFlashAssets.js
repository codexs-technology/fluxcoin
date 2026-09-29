/**
 * Deploys the 5 per-asset FlashToken contracts and wires the Worker minter:
 *
 *   Flash USDT (USDT, 6)   Flash Bitcoin (BTC, 8)   Flash Ethereum (ETH, 18)
 *   Flash TRX (TRX, 6)     Flash Solana (SOL, 9)
 *
 * Usage (run from the contracts/ folder):
 *   npx hardhat run scripts/deployFlashAssets.js --network polygon    # PRODUCTION (chainId 137)
 *   npx hardhat run scripts/deployFlashAssets.js --network sepolia    # testing (chainId 11155111)
 *   npx hardhat run scripts/deployFlashAssets.js --network localhost  # local node
 *
 * Required .env (repository root):
 *   DEPLOYER_PRIVATE_KEY    wallet that pays the deployment gas (needs POL/MATIC on Polygon)
 *   TOKEN_ADMIN_ADDRESS     treasury/multisig that receives admin roles (defaults to deployer)
 *   BACKEND_MINTER_ADDRESS  Worker hot wallet address -> gets MINTER_ROLE on all 5 tokens
 *                           (must be the address of MINTER_PRIVATE_KEY set as a Worker secret)
 *
 * Optional per-asset overrides: FLASH_INITIAL_SUPPLY_<ID>, FLASH_MAX_SUPPLY_<ID> (whole tokens).
 *
 * Output: ../.env.flash-assets.json manifest + the exact env lines to paste into
 * the root .env (VITE_TOKEN_ADDRESS_*) and wrangler.jsonc (TOKEN_ADDRESS_*).
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

// MUST stay in sync with api/src/assets.ts and src/contracts/assets.js.
const FLASH_ASSETS = [
  { id: 'usdt', name: 'Flash USDT', symbol: 'USDT', decimals: 6, defaultMaxSupply: '1000000000' },    // 1B USDT
  { id: 'btc', name: 'Flash Bitcoin', symbol: 'BTC', decimals: 8, defaultMaxSupply: '21000000' },      // 21M BTC
  { id: 'eth', name: 'Flash Ethereum', symbol: 'ETH', decimals: 18, defaultMaxSupply: '120000000' },   // 120M ETH
  { id: 'trx', name: 'Flash TRX', symbol: 'TRX', decimals: 6, defaultMaxSupply: '1000000000' },        // 1B TRX
  { id: 'sol', name: 'Flash Solana', symbol: 'SOL', decimals: 9, defaultMaxSupply: '1000000000' }       // 1B SOL
];

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const admin = env('TOKEN_ADMIN_ADDRESS', deployer.address);
  const backendMinter = env('BACKEND_MINTER_ADDRESS', deployer.address);

  console.log(`\n== Flash asset deployment (5 per-asset contracts) ==`);
  console.log(`network        : ${hre.network.name} (chainId ${chainId})`);
  console.log(`deployer       : ${deployer.address}`);
  console.log(`admin          : ${admin}`);
  console.log(`backend minter : ${backendMinter}\n`);

  const deployments = {};

  for (const asset of FLASH_ASSETS) {
    const upper = asset.id.toUpperCase();
    const initialSupply = BigInt(env(`FLASH_INITIAL_SUPPLY_${upper}`, '0')); // 0 = mint on demand
    const maxSupply = BigInt(env(`FLASH_MAX_SUPPLY_${upper}`, asset.defaultMaxSupply));

    console.log(`Deploying ${asset.name} (${asset.symbol}, ${asset.decimals} decimals)…`);
    const FlashToken = await hre.ethers.getContractFactory('FlashToken');
    const token = await FlashToken.deploy(
      asset.name,
      asset.symbol,
      asset.decimals,
      admin,
      initialSupply,
      maxSupply
    );
    await token.waitForDeployment();
    const address = await token.getAddress();
    console.log(`  ${asset.symbol.padEnd(5)} -> ${address}`);

    // The Worker hot wallet must be able to mint withdrawals server-side.
    const MINTER_ROLE = await token.MINTER_ROLE();
    if (!(await token.hasRole(MINTER_ROLE, backendMinter))) {
      const grantTx = await token.grantRole(MINTER_ROLE, backendMinter);
      await grantTx.wait();
      console.log(`  granted MINTER_ROLE to backend minter ${backendMinter}`);
    } else {
      console.log(`  backend minter already holds MINTER_ROLE`);
    }

    deployments[asset.id] = {
      address,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      initialSupply: initialSupply.toString(),
      maxSupply: maxSupply.toString(),
      backendMinter
    };
  }

  const manifest = {
    chainId,
    network: hre.network.name,
    assets: deployments,
    admin,
    deployedAt: new Date().toISOString(),
    note: 'Addresses are per-asset FlashToken contracts. Paste them into the root .env (VITE_TOKEN_ADDRESS_*), wrangler.jsonc / Worker secrets (TOKEN_ADDRESS_*).'
  };

  const target = path.join(__dirname, '..', '..', '.env.flash-assets.json');
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved deployment manifest -> ${target}`);

  console.log(`\n=== Paste into the repository root .env ===`);
  for (const asset of FLASH_ASSETS) {
    console.log(`VITE_TOKEN_ADDRESS_${asset.id.toUpperCase()}=${deployments[asset.id].address}`);
  }
  console.log(`VITE_NETWORK_ID=${chainId}`);

  console.log(`\n=== Paste into wrangler.jsonc "vars" (or: npx wrangler secret put) ===`);
  for (const asset of FLASH_ASSETS) {
    console.log(`TOKEN_ADDRESS_${asset.id.toUpperCase()}=${deployments[asset.id].address}`);
  }
  console.log(`CHAIN_ID=${chainId}`);
  console.log(`RPC_URL=https://polygon-rpc.com   # when chainId is 137\n`);

  if (chainId !== 137) {
    console.log(`NOTE: you deployed to chainId ${chainId}. Polygon mainnet is 137 — set VITE_NETWORK_ID=137 and CHAIN_ID=137 for production.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
