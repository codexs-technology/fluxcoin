/**
 * Decodes the EXACT constructor arguments of the 5 deployed FlashToken
 * contracts directly from their on-chain creation transactions.
 *
 * How: a contract's creation tx `input` = compiler creation bytecode +
 * abi-encoded constructor args. We have the same artifact locally
 * (contracts/artifacts/src/FlashToken.sol/FlashToken.json), so the args
 * are simply input.slice(bytecode.length) — then ABI-decoded.
 *
 * Usage (from contracts/):  node scripts/decode-flash-constructor-args.cjs
 * No API key needed: Polygonscan getcontractcreation (keyless) + public RPC.
 */
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');

const RPC_URL = 'https://polygon-bor-rpc.publicnode.com';
const CONTRACTS = [
  { id: 'USDT', address: '0x3b4b2157997C28a645601a83ECC685815127Bb5C' },
  { id: 'BTC', address: '0x13C5D77a7a2B04055f835Af0603D1BD9ae5c0d9C' },
  { id: 'ETH', address: '0x91e7C005F5a68D837AD57aa7c8A4cA0DC1537a73' },
  { id: 'TRX', address: '0x789bFfe3360dacc18aD3296F5E0ED434621414B1' },
  { id: 'SOL', address: '0x806e446e5f9b368DF810a86bA03eeaa7857e064C' }
];

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function getCreations() {
  // Blockscout (keyless): list deployer txs, creation txs expose created_contract.
  const deployer = process.env.FLASH_DEPLOYER || '0x2DA543190bEFE31c2183c1ba286362A9eDE208B5';
  const wanted = new Set(CONTRACTS.map((c) => c.address.toLowerCase()));
  const found = [];
  let url = `https://polygon.blockscout.com/api/v2/addresses/${deployer}/transactions?filter=from`;
  for (let page = 0; page < 10; page++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`blockscout: HTTP ${res.status}`);
    const json = await res.json();
    for (const tx of json.items || []) {
      const created = tx.created_contract?.hash?.toLowerCase();
      if (created && wanted.has(created)) {
        found.push({ contractAddress: created, contractCreator: deployer, txHash: tx.hash });
      }
    }
    if (!json.next_page_params) break;
    const q = new URLSearchParams(json.next_page_params).toString();
    url = `https://polygon.blockscout.com/api/v2/addresses/${deployer}/transactions?filter=from&${q}`;
  }
  if (!found.length) throw new Error('no creation txs found via blockscout');
  return found;
}

function decodeArgs(inputHex, creationCode) {
  const input = inputHex.toLowerCase();
  const code = creationCode.toLowerCase();
  if (!input.startsWith(code.slice(0, 200))) throw new Error('input does not start with local creation code');
  const argsHex = '0x' + input.slice(code.length);
  const types = ['string', 'string', 'uint8', 'address', 'uint256', 'uint256'];
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(types, argsHex);
  return {
    name: decoded[0],
    symbol: decoded[1],
    decimals: Number(decoded[2]),
    admin: decoded[3],
    initialSupply: decoded[4].toString(),
    maxSupplyCap: decoded[5].toString()
  };
}

async function main() {
  // Deployer wallet address from the root .env (address only — key never printed).
  let envDeployer = null;
  try {
    const envText = fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8');
    const m = envText.match(/^DEPLOYER_PRIVATE_KEY\s*=\s*([0-9a-fA-Fx]+)/m);
    if (m) envDeployer = new ethers.Wallet(m[1]).address;
  } catch { /* optional */ }

  const artifact = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'src', 'FlashToken.sol', 'FlashToken.json'), 'utf8')
  );
  const creationCode = artifact.bytecode;

  console.log(`deployer (from root .env DEPLOYER_PRIVATE_KEY): ${envDeployer}\n`);

  const creations = await getCreations();
  const byAddr = new Map(creations.map((c) => [c.contractAddress.toLowerCase(), c]));

  console.log('=== EXACT on-chain constructor arguments ===\n');
  for (const c of CONTRACTS) {
    const info = byAddr.get(c.address.toLowerCase());
    if (!info) { console.log(`${c.id}: creation info not found`); continue; }
    const tx = await rpc('eth_getTransactionByHash', [info.txHash]);
    const args = decodeArgs(tx.input, creationCode);
    console.log(`${c.id}  ${c.address}`);
    console.log(`  creator tx : ${info.txHash}`);
    console.log(`  creator   : ${info.contractCreator}`);
    console.log(`  name      : "${args.name}"`);
    console.log(`  symbol    : "${args.symbol}"`);
    console.log(`  decimals  : ${args.decimals}`);
    console.log(`  admin     : ${args.admin}`);
    console.log(`  initial   : ${args.initialSupply}`);
    console.log(`  maxCap    : ${args.maxSupplyCap}`);
    console.log('');
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
