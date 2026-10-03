/**
 * Deploys the 5 per-asset FlashToken contracts and wires the Worker minter:
 *
 *   USDT (6)   BTC (8)   ETH (18)   TRX (6)   SOL (9)
 *
 * NOTE ON NAMES (locked decision): the on-chain token NAME is the plain ticker
 * ("USDT", "BTC", "ETH", "TRX", "SOL") — identical to the symbol. A token name on
 * the blockchain can NEVER be changed after deploy, so it must match what the UI
 * and wallets already show (simple tickers).
 *
 * Usage (run from the contracts/ folder):
 *   npx hardhat run scripts/deployFlashAssets.js --network polygon    # PRODUCTION (chainId 137)
 *   npx hardhat run scripts/deployFlashAssets.js --network sepolia    # testing (chainId 11155111)
 *   npx hardhat run scripts/deployFlashAssets.js --network localhost  # local node
 *
 * Required .env (repository root):
 *   DEPLOYER_PRIVATE_KEY       wallet that pays the deployment gas (needs POL/MATIC on Polygon)
 *   TOKEN_ADMIN_ADDRESS         treasury/multisig that receives admin roles (defaults to deployer)
 *   BACKEND_MINTER_ADDRESS      single Worker hot wallet -> gets MINTER_ROLE on all 5 tokens
 *                              (must be the address of MINTER_PRIVATE_KEY set as a Worker secret)
 *   BACKEND_MINTER_ADDRESSES    OPTIONAL, multiple minters: comma separated address list that
 *                              overrides the single var, e.g.
 *                              BACKEND_MINTER_ADDRESSES=0xaaa...,0xbbb...,0xccc...
 *                              Use it only when MORE than one wallet must be able to mint;
 *                              today the Worker mints with ONE hot wallet (future-proofing).
 *
 * Role wiring (why the deployer is the temporary admin):
 *   FlashToken's constructor grants DEFAULT_ADMIN_ROLE + MINTER_ROLE to its `admin`
 *   argument, and AccessControl only lets the *role admin* grant roles — so a
 *   deployer that is not TOKEN_ADMIN_ADDRESS cannot call grantRole itself (this is
 *   what made the first Sepolia run revert on the minter grant). Each contract is
 *   therefore deployed with the DEPLOYER as the initial admin, every backend minter
 *   gets MINTER_ROLE from the deployer, and when TOKEN_ADMIN_ADDRESS differs from
 *   the deployer, both admin roles are handed over to it at the end (the deployer
 *   then renounces). Final state per token:
 *     DEFAULT_ADMIN_ROLE + MINTER_ROLE -> TOKEN_ADMIN_ADDRESS
 *     MINTER_ROLE                      -> every address in BACKEND_MINTER_ADDRESS(ES)
 *     deployer                         -> no roles
 *
 * Optional per-asset overrides: FLASH_INITIAL_SUPPLY_<ID>, FLASH_MAX_SUPPLY_<ID> (whole tokens).
 *
 * Resuming a partial deployment (e.g. the run died after some contracts):
 *   FLASH_REUSE_<ID>_ADDRESS=0x...  reuse an already-deployed contract instead of
 *                                   deploying it again (ID = USDT/BTC/ETH/TRX/SOL).
 *                                   Set it in the root .env (remove it after the
 *                                   resume run) or inline in PowerShell:
 *                                   $env:FLASH_REUSE_USDT_ADDRESS="0x…"; npm run deploy:flash:polygon
 *                                   The reused contract's role wiring must be signed
 *                                   by its admin — set ADMIN_PRIVATE_KEY in the root
 *                                   .env to the TOKEN_ADMIN_ADDRESS wallet key (that
 *                                   admin wallet needs a little gas for the grant).
 *                                   ADMIN_PRIVATE_KEY is ignored for fresh deploys;
 *                                   remove it from .env once the resume run finishes.
 *
 * Crash safety / RPC flakiness:
 *   The manifest is saved after EVERY contract, so a crashed run still leaves all
 *   deployed addresses on disk. All verification reads retry 3x (2s delay) and a
 *   persistent read failure only WARNS + continues instead of crashing the run.
 *
 * Output: ../.env.flash-assets.json manifest + the exact env lines to paste into
 * the root .env (VITE_TOKEN_ADDRESS_*) and wrangler.jsonc (TOKEN_ADDRESS_*).
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

// MUST stay in sync with api/src/assets.ts and src/contracts/assets.js.
// The on-chain NAME is the plain ticker — LOCKED: token names are immutable after deploy.
const FLASH_ASSETS = [
  { id: 'usdt', name: 'USDT', symbol: 'USDT', decimals: 6, defaultMaxSupply: '1000000000' },    // 1B USDT
  { id: 'btc', name: 'BTC', symbol: 'BTC', decimals: 8, defaultMaxSupply: '21000000' },      // 21M BTC
  { id: 'eth', name: 'ETH', symbol: 'ETH', decimals: 18, defaultMaxSupply: '120000000' },   // 120M ETH
  { id: 'trx', name: 'TRX', symbol: 'TRX', decimals: 6, defaultMaxSupply: '1000000000' },        // 1B TRX
  { id: 'sol', name: 'SOL', symbol: 'SOL', decimals: 9, defaultMaxSupply: '1000000000' }       // 1B SOL
];

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// ---- RPC flakiness guards -------------------------------------------------------
// Public Polygon endpoints sometimes return empty/garbage payloads
// ("could not decode result data (value=0x)") even though the transaction went
// through. Every read below is retried 3x with a 2s delay and — for the hasRole
// verification reads — a persistent failure only WARNS and continues (all role
// writes are idempotent: OpenZeppelin 5.x duplicate grants/renounces are silent
// no-ops, so a wrong guess costs at most a little gas).

async function withRetry(label, fn, attempts = 3, delayMs = 2000) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        console.log(`  [rpc-retry] ${label} failed (${error.shortMessage || error.message}) — retry ${i}/${attempts - 1} in 2s…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

// Read that must NOT crash the deploy: retries, then warns and returns `fallback`.
async function safeRead(label, fn, fallback) {
  try {
    return await withRetry(label, fn);
  } catch (error) {
    console.log(`  [rpc-warn] ${label} unreadable after retries (${error.shortMessage || error.message}) — continuing (${fallback ? 'assuming yes' : 'assuming no'})`);
    return fallback;
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const admin = env('TOKEN_ADMIN_ADDRESS', deployer.address);

  // A2 — Multiple minter wallets (architecture ready):
  //   BACKEND_MINTER_ADDRESSES (comma separated) wins over the single
  //   BACKEND_MINTER_ADDRESS. Invalid/duplicate entries are dropped, and when
  //   nothing is set the deployer stays the minter (same default as before).
  //   Today the Worker uses ONE hot wallet — extra entries are future-proofing:
  //   every listed address can mint on all 5 contracts from day one.
  const backendMinters = [
    ...new Set(
      (env('BACKEND_MINTER_ADDRESSES', '') || env('BACKEND_MINTER_ADDRESS', ''))
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => /^0x[a-fA-F0-9]{40}$/.test(entry))
    )
  ];
  if (!backendMinters.length) {
    const raw = (process.env.BACKEND_MINTER_ADDRESSES || process.env.BACKEND_MINTER_ADDRESS || '').trim();
    if (raw) throw new Error(`No valid minter address in BACKEND_MINTER_ADDRESS(ES): "${raw}"`);
    backendMinters.push(deployer.address); // same default as before: deployer mints
  }
  const backendMinter = backendMinters[0]; // primary minter (kept for the manifest/back-compat)

  console.log(`\n== Flash asset deployment (5 per-asset contracts) ==`);
  console.log(`network        : ${hre.network.name} (chainId ${chainId})`);
  console.log(`deployer       : ${deployer.address}`);
  console.log(`admin          : ${admin}`);
  console.log(`backend minters: ${backendMinters.length > 1 ? backendMinters.join(', ') + ` (${backendMinters.length} wallets)` : backendMinters[0]}`);
  console.log(`admin handover : ${admin !== deployer.address ? `yes — deployer wires roles first, then hands over to ${admin}` : 'no — deployer keeps the admin roles'}\n`);

  const deployments = {};

  // Crash-safe manifest: written after EVERY contract (the moment its address
  // exists), so a run that dies mid-way still leaves every deployed address on
  // disk. The final save at the end drops the `partial` marker.
  const manifestPath = path.join(__dirname, '..', '..', '.env.flash-assets.json');
  const saveManifest = (partial) => {
    const manifest = {
      chainId,
      network: hre.network.name,
      assets: deployments,
      admin,
      deployedAt: new Date().toISOString(),
      note: 'Addresses are per-asset FlashToken contracts. Paste them into the root .env (VITE_TOKEN_ADDRESS_*), wrangler.jsonc / Worker secrets (TOKEN_ADDRESS_*).'
    };
    if (partial) {
      manifest.partial = true;
      manifest.note += ' PARTIAL RUN — some assets are missing: re-run with FLASH_REUSE_<ID>_ADDRESS (root .env) for the addresses already listed here.';
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  [manifest] ${partial ? `partial save (${Object.keys(deployments).length}/${FLASH_ASSETS.length} assets)` : 'saved'} -> ${manifestPath}`);
  };

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
      token = await withRetry(`attach ${asset.symbol}`, () => hre.ethers.getContractAt('FlashToken', address));
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

    // Crash-safe: persist the address the moment it exists — even if the role
    // wiring below dies on RPC flakiness, the manifest already has this contract.
    deployments[asset.id] = {
      address,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      initialSupply: initialSupply.toString(),
      maxSupply: maxSupply.toString(),
      backendMinter,
      backendMinters,
      reused: Boolean(reuse)
    };
    saveManifest(true);

    const MINTER_ROLE = await withRetry(`${asset.symbol}.MINTER_ROLE()`, () => token.MINTER_ROLE());
    const DEFAULT_ADMIN_ROLE = await withRetry(`${asset.symbol}.DEFAULT_ADMIN_ROLE()`, () => token.DEFAULT_ADMIN_ROLE());

    // Role grants must be signed by the contract's DEFAULT_ADMIN_ROLE holder:
    // fresh deploys -> the deployer (constructor admin); reused contracts ->
    // ADMIN_PRIVATE_KEY (the current admin's key), falling back to the deployer.
    let roleSigner = deployer;
    if (reuse && process.env.ADMIN_PRIVATE_KEY) {
      roleSigner = new hre.ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, hre.ethers.provider);
    }
    const signerIsAdmin = await safeRead(
      `${asset.symbol}.hasRole(admin, roleSigner)`,
      () => token.hasRole(DEFAULT_ADMIN_ROLE, roleSigner.address),
      true // unreadable RPC -> continue optimistically; a grant would revert loudly if truly unauthorized
    );
    if (!signerIsAdmin) {
      throw new Error(
        `${roleSigner.address} does not hold DEFAULT_ADMIN_ROLE on ${asset.symbol} (${address}). ` +
          (reuse
            ? `Set ADMIN_PRIVATE_KEY in the root .env to the TOKEN_ADMIN_ADDRESS wallet's private key, then retry.`
            : `Unexpected on a fresh deploy — the deployer should be the initial admin.`)
      );
    }

    // The Worker hot wallet(s) must be able to mint withdrawals server-side.
    // A2: every address in BACKEND_MINTER_ADDRESS(ES) gets MINTER_ROLE here.
    for (const minter of backendMinters) {
      const hasMinter = await safeRead(`${asset.symbol}.hasRole(minter, ${minter})`, () => token.hasRole(MINTER_ROLE, minter), false);
      if (!hasMinter) {
        const grantTx = await token.connect(roleSigner).grantRole(MINTER_ROLE, minter);
        await withRetry(`grant(minterRole->${minter.slice(0, 10)}…) receipt`, () => grantTx.wait());
        console.log(`  granted MINTER_ROLE to backend minter ${minter}`);
      } else {
        console.log(`  backend minter ${minter} already holds MINTER_ROLE`);
      }
    }

    // Hand the admin roles over to TOKEN_ADMIN_ADDRESS and let the deployer step
    // down. Idempotent: runs for fresh deploys AND reused contracts — a resumed
    // contract may have a half-finished handover (grants done, renounces pending),
    // so every step below re-checks on-chain and skips whatever is already true.
    if (admin !== deployer.address) {
      if (!(await safeRead(`${asset.symbol}.hasRole(adminRole, admin)`, () => token.hasRole(DEFAULT_ADMIN_ROLE, admin), false))) {
        const tx = await token.connect(roleSigner).grantRole(DEFAULT_ADMIN_ROLE, admin);
        await withRetry('grant(adminRole) receipt', () => tx.wait());
        console.log(`  granted DEFAULT_ADMIN_ROLE to ${admin}`);
      }
      if (!(await safeRead(`${asset.symbol}.hasRole(minterRole, admin)`, () => token.hasRole(MINTER_ROLE, admin), false))) {
        const tx = await token.connect(roleSigner).grantRole(MINTER_ROLE, admin);
        await withRetry('grant(minterRole->admin) receipt', () => tx.wait());
        console.log(`  granted MINTER_ROLE to ${admin}`);
      }
      // Renounce the deployer's roles. Attempted when confirmed held OR unreadable
      // (OZ 5.x renouncing a role that is not held is a silent no-op).
      if (await safeRead(`${asset.symbol}.hasRole(adminRole, deployer)`, () => token.hasRole(DEFAULT_ADMIN_ROLE, deployer.address), true)) {
        const tx = await token.connect(roleSigner).renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
        await withRetry('renounce(adminRole) receipt', () => tx.wait());
        console.log(`  deployer renounced DEFAULT_ADMIN_ROLE`);
      }
      if (await safeRead(`${asset.symbol}.hasRole(minterRole, deployer)`, () => token.hasRole(MINTER_ROLE, deployer.address), true)) {
        const tx = await token.connect(roleSigner).renounceRole(MINTER_ROLE, deployer.address);
        await withRetry('renounce(minterRole) receipt', () => tx.wait());
        console.log(`  deployer renounced MINTER_ROLE`);
      }
      console.log(`  admin roles handed over to ${admin} (deployer holds no roles now)`);
    }
  }

  console.log();
  saveManifest(false);

  const reusedIds = FLASH_ASSETS
    .filter((a) => deployments[a.id] && deployments[a.id].reused)
    .map((a) => a.id.toUpperCase());
  if (reusedIds.length) {
    console.log(`\nNOTE: ${reusedIds.join(', ')} reused (not re-deployed) — remove the FLASH_REUSE_* vars from .env before the next full run.`);
  }

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
  const rpcHint = chainId === 137 ? 'https://polygon-bor-rpc.publicnode.com' : env('RPC_URL_SEPOLIA', 'https://ethereum-sepolia-rpc.publicnode.com');
  console.log(`RPC_URL=${rpcHint}${chainId === 137 ? '' : '   # sepolia testnet'}\n`);

  if (chainId !== 137) {
    console.log(`NOTE: you deployed to chainId ${chainId}. Polygon mainnet is 137 — set VITE_NETWORK_ID=137 and CHAIN_ID=137 for production.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
