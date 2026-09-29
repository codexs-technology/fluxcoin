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
 * Role wiring (why the deployer is the temporary admin):
 *   FlashToken's constructor grants DEFAULT_ADMIN_ROLE + MINTER_ROLE to its `admin`
 *   argument, and AccessControl only lets the *role admin* grant roles — so a
 *   deployer that is not TOKEN_ADMIN_ADDRESS cannot call grantRole itself (this is
 *   what made the first Sepolia run revert on the minter grant). Each contract is
 *   therefore deployed with the DEPLOYER as the initial admin, the backend minter
 *   gets MINTER_ROLE from the deployer, and when TOKEN_ADMIN_ADDRESS differs from
 *   the deployer, both admin roles are handed over to it at the end (the deployer
 *   then renounces). Final state per token:
 *     DEFAULT_ADMIN_ROLE + MINTER_ROLE -> TOKEN_ADMIN_ADDRESS
 *     MINTER_ROLE                      -> BACKEND_MINTER_ADDRESS
 *     deployer                         -> no roles
 *
 * Optional per-asset overrides: FLASH_INITIAL_SUPPLY_<ID>, FLASH_MAX_SUPPLY_<ID> (whole tokens).
 *
 * Resuming a partial deployment (e.g. the run died after some contracts):
 *   FLASH_REUSE_<ID>_ADDRESS=0x...  reuse an already-deployed contract instead of
 *                                   deploying it again (ID = USDT/BTC/ETH/TRX/SOL).
 *                                   The reused contract's role wiring must be signed
 *                                   by its admin — set ADMIN_PRIVATE_KEY in the root
 *                                   .env to the TOKEN_ADMIN_ADDRESS wallet key (that
 *                                   admin wallet needs a little gas for the grant).
 *                                   ADMIN_PRIVATE_KEY is ignored for fresh deploys;
 *                                   remove it from .env once the resume run finishes.
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
  console.log(`backend minter : ${backendMinter}`);
  console.log(`admin handover : ${admin !== deployer.address ? `yes — deployer wires roles first, then hands over to ${admin}` : 'no — deployer keeps the admin roles'}\n`);

  const deployments = {};

  for (const asset of FLASH_ASSETS) {
    const upper = asset.id.toUpperCase();
    const initialSupply = BigInt(env(`FLASH_INITIAL_SUPPLY_${upper}`, '0')); // 0 = mint on demand
    const maxSupply = BigInt(env(`FLASH_MAX_SUPPLY_${upper}`, asset.defaultMaxSupply));
    const reuse = env(`FLASH_REUSE_${upper}_ADDRESS`, '');

    let token;
    let address;
    if (reuse) {
      console.log(`Reusing ${asset.name} (${asset.symbol}) at ${reuse} — no new deploy`);
      address = reuse;
      token = await hre.ethers.getContractAt('FlashToken', address);
    } else {
      console.log(`Deploying ${asset.name} (${asset.symbol}, ${asset.decimals} decimals)…`);
      const FlashToken = await hre.ethers.getContractFactory('FlashToken');
      // The DEPLOYER is passed as the initial admin so it can grant MINTER_ROLE right
      // after the constructor (AccessControl only lets the role admin grant roles).
      // When TOKEN_ADMIN_ADDRESS differs, its roles are handed over below.
      token = await FlashToken.deploy(
        asset.name,
        asset.symbol,
        asset.decimals,
        deployer.address,
        initialSupply,
        maxSupply
      );
      await token.waitForDeployment();
      address = await token.getAddress();
      console.log(`  ${asset.symbol.padEnd(5)} -> ${address}`);
    }

    const MINTER_ROLE = await token.MINTER_ROLE();
    const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();

    // Role grants must be signed by the contract's DEFAULT_ADMIN_ROLE holder:
    // fresh deploys -> the deployer (constructor admin); reused contracts ->
    // ADMIN_PRIVATE_KEY (the current admin's key), falling back to the deployer.
    let roleSigner = deployer;
    if (reuse && process.env.ADMIN_PRIVATE_KEY) {
      roleSigner = new hre.ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, hre.ethers.provider);
    }
    if (!(await token.hasRole(DEFAULT_ADMIN_ROLE, roleSigner.address))) {
      throw new Error(
        `${roleSigner.address} does not hold DEFAULT_ADMIN_ROLE on ${asset.symbol} (${address}). ` +
          (reuse
            ? `Set ADMIN_PRIVATE_KEY in the root .env to the TOKEN_ADMIN_ADDRESS wallet's private key, then retry.`
            : `Unexpected on a fresh deploy — the deployer should be the initial admin.`)
      );
    }

    // The Worker hot wallet must be able to mint withdrawals server-side.
    if (!(await token.hasRole(MINTER_ROLE, backendMinter))) {
      const grantTx = await token.connect(roleSigner).grantRole(MINTER_ROLE, backendMinter);
      await grantTx.wait();
      console.log(`  granted MINTER_ROLE to backend minter ${backendMinter}`);
    } else {
      console.log(`  backend minter already holds MINTER_ROLE`);
    }

    // Hand the admin roles over to TOKEN_ADMIN_ADDRESS and let the deployer step
    // down (fresh deploys only — reused contracts already have their admin).
    if (!reuse && admin !== deployer.address) {
      if (!(await token.hasRole(DEFAULT_ADMIN_ROLE, admin))) {
        const tx = await token.grantRole(DEFAULT_ADMIN_ROLE, admin);
        await tx.wait();
        console.log(`  granted DEFAULT_ADMIN_ROLE to ${admin}`);
      }
      if (!(await token.hasRole(MINTER_ROLE, admin))) {
        const tx = await token.grantRole(MINTER_ROLE, admin);
        await tx.wait();
        console.log(`  granted MINTER_ROLE to ${admin}`);
      }
      if (await token.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) {
        const tx = await token.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
        await tx.wait();
      }
      if (await token.hasRole(MINTER_ROLE, deployer.address)) {
        const tx = await token.renounceRole(MINTER_ROLE, deployer.address);
        await tx.wait();
      }
      console.log(`  admin roles handed over to ${admin} (deployer holds no roles now)`);
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
  const rpcHint = chainId === 137 ? 'https://polygon-rpc.com' : env('RPC_URL_SEPOLIA', 'https://ethereum-sepolia-rpc.publicnode.com');
  console.log(`RPC_URL=${rpcHint}${chainId === 137 ? '' : '   # sepolia testnet'}\n`);

  if (chainId !== 137) {
    console.log(`NOTE: you deployed to chainId ${chainId}. Polygon mainnet is 137 — set VITE_NETWORK_ID=137 and CHAIN_ID=137 for production.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
