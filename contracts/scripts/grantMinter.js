/**
 * Grants MINTER_ROLE on FluxCoin to the website backend hot wallet.
 * Run this once after deployment (must be executed by the token admin).
 *
 *   BACKEND_MINTER_ADDRESS=0x... TOKEN_ADDRESS=0x... npx hardhat run scripts/grantMinter.js --network sepolia
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const manifestPath = path.join(__dirname, '..', '..', '.env.contracts.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

  const tokenAddress = process.env.TOKEN_ADDRESS || manifest.FluxCoin;
  const minter = process.env.BACKEND_MINTER_ADDRESS || manifest.backendMinter;
  const alsoFaucet = process.env.FAUCET_ADDRESS || manifest.FluxFaucet;

  if (!tokenAddress || !minter) {
    throw new Error('TOKEN_ADDRESS and BACKEND_MINTER_ADDRESS are required');
  }

  const coin = await hre.ethers.getContractAt('FluxCoin', tokenAddress);
  const MINTER_ROLE = await coin.MINTER_ROLE();

  for (const target of [minter, alsoFaucet].filter(Boolean)) {
    if (await coin.hasRole(MINTER_ROLE, target)) {
      console.log(`${target} already has MINTER_ROLE`);
      continue;
    }
    const tx = await coin.grantRole(MINTER_ROLE, target);
    await tx.wait();
    console.log(`granted MINTER_ROLE -> ${target} (tx ${tx.hash})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
