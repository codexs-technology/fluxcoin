# 🚀 Flush Coin — POLYGON MAINNET GO-LIVE (Master Checklist)

> **Yeh aapki single source of truth hai** launch ke liye — PART A (contracts deploy) → PART B (liquidity + swap) → PART C (env switch + go live) → launch-day discipline.
> Har step **copy-paste ready** hai. Kahin phas jao to niche **Troubleshooting** table dekho.
> Related files: `DEPLOYMENT.md` (detail guide), `MAINNET-DEPLOY-CHECKLIST.md` (purana checklist).

## 🔒 Locked decisions (launch se pehle change MAT karna)

| Decision | Value |
|---|---|
| Chain | **Polygon mainnet** (chainId **137**) |
| On-chain token NAMES (immutable!) | `USDT`, `BTC`, `ETH`, `TRX`, `SOL` — plain tickers, symbol ke barabar |
| Decimals (per asset) | USDT **6**, BTC **8**, ETH **18**, TRX **6**, SOL **9** |
| Primary liquidity route | **Flash USDT ↔ USDC (native)** pool on **QuickSwap** |
| QuickSwap V2 router (verified) | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` |
| USDC — native (Circle) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDC.e — bridged (opt-in) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| User cash-out route | Website se withdraw → **Flash USDT** → QuickSwap se **real USDC/USDT** swap → **Binance deposit** (network: Polygon) |
| Minter (Worker hot wallet) | `0xaB80a82E80a460bA282dDFcb0815E3660ad3AE02` (abhi single; multi-minter ready) |
| Admin / treasury | `0x79cf2b4Da248251Ffbed567a886f127e1962B97B` |
| Funds (already in place) | Deployer ~10 POL, Minter ~20 POL |

---

## ✅ PRE-FLIGHT — Code changes jo HO CHUKE hain (sirf review karo)

| Part | Kya hua | File |
|---|---|---|
| **A1** | On-chain names plain tickers set (`USDT`/`BTC`/`ETH`/`TRX`/`SOL`), decimals same | `contracts/scripts/deployFlashAssets.js` + `api/src/assets.ts` + `src/contracts/assets.js` + tests |
| **A2** | Multi-minter support: `BACKEND_MINTER_ADDRESSES` (comma separated) — har address ko MINTER_ROLE milta hai. Abhi single minter use ho raha hai | `contracts/scripts/deployFlashAssets.js` + `.env.example` |
| **A3** | Polygonscan verify prep: `POLYGONSCAN_API_KEY` var + verify commands ready (niche Step A5) | `contracts/hardhat.config.js` (pehle se wired) |
| **B1** | `addLiquidity.js` rewrite: per-asset FlashToken + per-asset decimals + **USDC pair (primary)** + native pair (optional) | `contracts/scripts/addLiquidity.js` |
| **B2** | QuickSwap router verified on Polygonscan (address upar table me) | — |
| **B3** | Swap → Binance user guide (niche PART B me) | is file me |
| **B4** | Frontend "04 // DEX SWAP" tab ab chain ke hisaab se label dikhata hai (Polygon = `QUICKSWAP V2 ROUTER`) | `src/contracts/addresses.js` + `src/components/TokenSwap.jsx` |

> ⚠️ **Deploy se PEHLE .env check karo** (root): `DEPLOYER_PRIVATE_KEY`, `TOKEN_ADMIN_ADDRESS`, `BACKEND_MINTER_ADDRESS` teeno set hone chahiye. `BACKEND_MINTER_ADDRESSES` commented hai — single minter hai to wahi rehne do.

---

## 🅰️ PART A — Contracts deploy (Polygon mainnet)

### A1. Final pre-checks (30 sec)

```powershell
cd "e:\Flush Coin\contracts"
npm run compile          # zero errors chahiye (pehle ek baar test bhi chala sakte ho: npm test)
```

- Root `.env` me `RPC_URL_POLYGON=https://polygon-bor-rpc.publicnode.com` set hai ✓ (⚠️ `polygon-rpc.com` abhi down hai — "API key disabled"; `polygon-boron-...` bhi galat URL tha — sahi hai `polygon-bor-rpc.publicnode.com`)
- Deployer wallet (`DEPLOYER_PRIVATE_KEY`) me **~10 POL** hai ✓ (gas ke liye 1 POL bhi kaafi hai)
- `TOKEN_ADMIN_ADDRESS` = treasury wallet ✓ (roles isko milenge)
- `BACKEND_MINTER_ADDRESS` = `0xaB80…AE02` ✓ (Worker ka MINTER_PRIVATE_KEY isi ka hai)

### A2. DEPLOY (yeh step tum khud chalao)

```powershell
cd "e:\Flush Coin\contracts"
npm run deploy:flash:polygon
```

**Expected output (5 contracts):** har asset ke liye —
```
Deploying USDT (USDT, 6 decimals)…
  deployed at 0x…  (tx 0x…)
  granted MINTER_ROLE to backend minter 0xaB80…AE02
  admin handover to 0x79cf…B97B done / not needed
```
End me script **`.env.flash-assets.json`** manifest likhta hai + exact env lines print karta hai (`VITE_TOKEN_ADDRESS_*` root .env ke liye, `TOKEN_ADDRESS_*` wrangler.jsonc ke liye).

**Ye 5 addresses kahin save karo** (manifest me bhi save hote hain).

### A3. Sanity check (2 min)

Har address Polygonscan pe kholo (`https://polygonscan.com/address/<ADDR>`):
| Check | Expected |
|---|---|
| Token name | `USDT` / `BTC` / `ETH` / `TRX` / `SOL` (plain tickers) |
| Decimals | 6 / 8 / 18 / 6 / 9 |
| Max supply | 1B / 21M / 120M / 1B / 1B |
| `MINTER_ROLE` holder | `0xaB80…AE02` (Polygonscan pe Contract → Read → hasRole ya Roles tab) |
| Admin | `0x79cf…B97B` |
| Deployer | koi role NAHI (renounced) |

### A4. Multi-minter (optional — abhi skip karo)

Agar kabhi **ek se zyada** minting wallets chahiye, `.env` me:
```
BACKEND_MINTER_ADDRESSES=0xaB80a82E80a460bA282dDFcb0815E3660ad3AE02,0x<WALLET2>,0x<WALLET3>
```
(comma separated, no spaces). Deploy script har ek ko MINTER_ROLE dega. **Note:** yeh sirf **deploy time** pe apply hota hai — baad me add karna ho to naye address ko admin wallet se `grantRole(MINTER_ROLE, addr)` karna hoga (ya re-deploy).

### A5. Polygonscan verification (recommended, free)

1. https://polygonscan.com/apis pe jao → free API key banao
2. Root `.env` me: `POLYGONSCAN_API_KEY=<key>`
3. Verify (deploy script ne jo addresses diye):

```powershell
cd "e:\Flush Coin\contracts"
npx hardhat verify --network polygon <USDT_ADDRESS> "USDT" "USDT" 6 <DEPLOYER_ADDRESS> 0 1000000000
npx hardhat verify --network polygon <BTC_ADDRESS>  "BTC"  "BTC"  8 <DEPLOYER_ADDRESS> 0 21000000
npx hardhat verify --network polygon <ETH_ADDRESS>  "ETH"  "ETH"  18 <DEPLOYER_ADDRESS> 0 120000000
npx hardhat verify --network polygon <TRX_ADDRESS>  "TRX"  "TRX"  6 <DEPLOYER_ADDRESS> 0 1000000000
npx hardhat verify --network polygon <SOL_ADDRESS>  "SOL"  "SOL"  9 <DEPLOYER_ADDRESS> 0 1000000000
```

(IMPORTANT: 4th arg = `<DEPLOYER_ADDRESS>` = `0x2DA543190bEFE31c2183c1ba286362A9eDE208B5` — the deploy script passes the DEPLOYER as the constructor's initial admin and hands the roles over to the treasury AFTER deploy, so verify ke liye constructor args mein deployer hi aata hai, TOKEN_ADMIN nahi.) Verify hone ke baad Polygonscan pe contract ka poora source code dikhega — users ka trust badhta hai.

---

## 🅱️ PART B — Liquidity seeding + swap route

### B1. Primary pool seed karo: Flash USDT ↔ USDC (QuickSwap)

**Is wallet se chalao jisme hai:** (a) Flash USDT tokens, (b) USDC, (c) thoda POL gas ke liye.
Deployer hi hai to pehle admin/minter se us wallet me tokens mint/transfer karo, ya khud ko `mint()` — sabse easy: Worker se ek chhota test withdraw khud ke wallet pe (PART C ke baad), YA admin wallet se manual mint (Polygonscan → Write Contract → mint).

1. Root `.env` me liquidity section bharo:
```
ASSET_ID=usdt
LP_PAIR=usdc
LP_TOKEN_AMOUNT=50000        # kitne Flash USDT seed karne hain
LP_USDC_AMOUNT=50            # kitne real USDC uske against
```
   > **Ratio = price.** 50,000 Flash USDT + 50 USDC → 1 USDC ≈ 1,000 Flash USDT. Ratio apni strategy se chuno — yahi pool users ko "kyunki Flash USDT ki kya value hai" batata hai.

2. Run:
```powershell
cd "e:\Flush Coin\contracts"
npm run liquidity:dex
```

> 💡 Token address khud resolve hota hai: pehle `.env` ka `TOKEN_ADDRESS` / `TOKEN_ADDRESS_USDT`, warna deploy waale `.env.flash-assets.json` manifest se (chainId match hone par) — PART A ke baad kuch paste karne ki zaroorat nahi.

**Expected output:**
```
Seeding USDT liquidity on polygon (chainId 137, pair mode: usdc)
router: 0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff
token : 0x… (USDT, 6 decimals)
quote : 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (USDC, 6 decimals)
seed  : 50000 USDT + 50 USDC
approved token for router (tx 0x…)
approved quote for router (tx 0x…)
liquidity added in block 12345678 (tx 0x…)
pair   : 0x…
```
Script pehle **balance check** karta hai — balance kam hoga to gas kharch hue bina clear error dega.

**Doosre assets** (optional, baad me kabhi bhi): `ASSET_ID=btc LP_TOKEN_AMOUNT=100 LP_USDC_AMOUNT=…` waise hi.
**Native (POL) pair** (optional legacy mode): `LP_PAIR=native LP_NATIVE_AMOUNT=1`.

### B2. QuickSwap pe pool confirm karo

1. https://polygonscan.com/address/<PAIR_ADDRESS> kholo (script ne `pair:` me print kiya)
2. Ya https://quickswap.exchange pe "Pool" tab me apna LP position dekho

### B3. User guide — Website tokens → Binance cash (users ko yeh flow milega)

> Yehi flow website ke FAQ/announcement me bhi daal sakte ho.

1. **Website pe** coins mine/forge karo → **Withdraw** → MetaMask (Polygon network) me **Flash USDT** aate hain
2. **QuickSwap** kholo: https://quickswap.exchange → wallet connect (Polygon network)
3. Token import: swap box me "Flash USDT" contract address paste karo → token dikhega
4. Swap: **Flash USDT → USDC** (ya USDT) — amount daalo, quote check karo, confirm. QuickSwap khud best route nikalega (humara Flash USDT/USDC pool + deep USDC/USDT pools)
5. **Binance** → Deposit → **USDC** (ya USDT) → **Network: Polygon (PoS)** select karo → deposit address pe apne wallet se USDC bhejo
6. Binance balance me USDC aa jayega → sell/withdraw karke cash karo

> ⚠️ Binance deposit me **network Polygon** hi select karna — galat network pe bheja to recovery mushkil hai.
> QuickSwap pe pehla swap **chhota amount** me test kar lena (e.g. 100 Flash USDT).

### B4. Frontend DEX tab (already fixed)

Website ke "04 // DEX SWAP" tab ka router `VITE_NETWORK_ID` follow karta hai — Polygon pe automatically **QuickSwap V2 router** (`0xa5E0829CaCEd…78ff`) use hota hai aur label `QUICKSWAP V2 ROUTER • LIVE` dikhata hai. PART C ke frontend rebuild ke baad live dikhega.
Website ke "04 // DEX SWAP" tab ka router `VITE_NETWORK_ID` follow karta hai — Polygon pe automatically **QuickSwap V2 router** (`0xa5E0829CaCEd…78ff`) use hota hai aur label `QUICKSWAP V2 ROUTER • LIVE` dikhata hai. PART C ke frontend rebuild ke baad live dikhega.

---

## 🅲 PART C — Env switch + GO LIVE

### C1. Root `.env` switch karo (frontend wiring)

```
VITE_NETWORK_ID=137
VITE_TOKEN_ADDRESS_USDT=<naya address>   # deploy script ne print kiya
VITE_TOKEN_ADDRESS_BTC=<naya address>
VITE_TOKEN_ADDRESS_ETH=<naya address>
VITE_TOKEN_ADDRESS_TRX=<naya address>
VITE_TOKEN_ADDRESS_SOL=<naya address>
```
(`VITE_API_URL` wahi rahega — Worker ka URL change nahi hota.)

### C2. `wrangler.jsonc` switch karo (Worker wiring)

```jsonc
"CHAIN_ID": "137",
"RPC_URL": "https://polygon-bor-rpc.publicnode.com",
"TOKEN_ADDRESS_USDT": "<naya address>",
"TOKEN_ADDRESS_BTC": "<naya address>",
"TOKEN_ADDRESS_ETH": "<naya address>",
"TOKEN_ADDRESS_TRX": "<naya address>",
"TOKEN_ADDRESS_SOL": "<naya address>",
"ALLOW_DRY_RUN": "false",          // ★ ab real mints honge
```
> **MINTER_PRIVATE_KEY secret:** minter wallet wahi hai (`0xaB80…AE02`) jo Sepolia pe thi — secret **wahi kaam karega**, dobara put karne ki zaroorat NAHI. Naya minter hota to: `npx wrangler secret put MINTER_PRIVATE_KEY --config wrangler.jsonc`.

### C3. Build + deploy (GO LIVE 🎉)

```powershell
cd "e:\Flush Coin"
npm run build                          # frontend build + api checks
npx wrangler deploy --config wrangler.jsonc    # Worker live (naye addresses + mainnet)
npx wrangler pages deploy dist --project-name fluxcoin   # frontend live
```

### C4. Health check (MUST)

```powershell
curl https://fluxcoin.codexstechnology.workers.dev/api/health
```
**Expected:** `"chainId": 137`, `"assetsConfigured": 5`, `"storage": "kv"`, `"sponsorKey"` me problem `null`, `"warnings": []`. Agar `assetsConfigured < 5` → wrangler.jsonc ke `TOKEN_ADDRESS_*` miss hain.

### C5. E2E test (chhote amount me, 5 min)

1. Website kholo → wallet connect (Polygon) → USDT select
2. Thode coins forge karo → **Withdraw** chhota amount (e.g. 100)
3. MetaMask me Polygon network pe Flash USDT aaye? ✓ (Polygonscan pe bhi tx dikhni chahiye — Worker minter `0xaB80…AE02` se mint hogi)
4. QuickSwap pe Flash USDT → USDC ka **chhota swap test** (B3 flow) ✓
5. Sab pass → **LIVE hai!** 🎉

---

## 💰 POL cost estimate (gas)

| Step | Approx gas | Approx POL (30–100 gwei) |
|---|---|---|
| 5 contracts deploy + roles | ~7–8M gas total | ~0.25–0.8 POL |
| Verify (free, sirf API calls) | — | 0 |
| LP seeding (2 approve + addLiquidity) | ~400k gas | ~0.02–0.05 POL |
| Per-user mint (Worker pays) | ~70k gas | ~0.003–0.01 POL |
| **Deployer me chahiye** | | **~1 POL (10 hai ✓)** |
| **Minter me chahiye** | | **~20–50 POL for 1000s of mints (20 hai ✓ — users badhne pe top-up karna)** |

## 🩺 Troubleshooting

| Problem | Matlab / Fix |
|---|---|
| `insufficient funds for gas` (deploy) | Deployer wallet me POL nahi — 1 POL bhejo |
| `No valid minter address in BACKEND_MINTER_ADDRESS(ES)` | .env me address typo — `0x` + 40 hex chars, comma separated |
| Verify: `Already verified` | Fine hai — skip karo |
| Verify: `Api key cannot be found` | `POLYGONSCAN_API_KEY` root .env me nahi / galat |
| addLiquidity: `Signer holds X but LP_TOKEN_AMOUNT is Y` | Wallet me Flash tokens kam hain — mint/transfer karo |
| addLiquidity: `reports 18 decimals (expected 6)` | `TOKEN_ADDRESS` galat asset ka hai — `ASSET_ID` match karo |
| Swap pe `INSUFFICIENT_LIQUIDITY` | Pool me ratio kharab / amount bahut bada — LP ratio check karo |
| Worker `/api/withdraw` → `NOT_MINTER` / mint fail | Worker ka `MINTER_PRIVATE_KEY` `0xaB80…AE02` ka nahi hai — secret re-put karo |
| Health me `assetsConfigured: 0` | wrangler.jsonc addresses miss → C2 dobara + redeploy |
| MetaMask me tokens nahi dikh rahe | Polygon network + token address import karo |
| Binance deposit pending | Network Polygon select kiya tha na? Binance → Deposit history check karo |

## 🔐 Mint discipline (launch ke baad)

- `MINTER_PRIVATE_KEY` **sirf** Worker secret me rahe — kabhi .env commit/GitHub pe mat chhodo (leak = koi bhi unlimited mint kar sakta hai jab tak maxSupply nahi hota)
- `WITHDRAW_DAILY_CAP` (wrangler.jsonc) confirm karo — per-user daily cap hai hi
- `MAX_SUPPLY` per asset immutable hai (1B/21M/120M/1B/1B) — infinite mint possible nahi
- Har hafte `/api/health` + Polygonscan pe minter wallet ki tx history skim karo
- Minter wallet ka POL 5+ rahe — warna user withdrawals fail hongi

## 🎁 Optional — Holders ko initial distribution

Website ke naye users/holders ko shuruat me tokens dene ke 2 tareeke (koi code change NAHI chahiye):
1. **Admin se manual mint:** Polygonscan → Flash USDT contract → Write Contract → admin wallet se connect → `mint(to, amount, reason)` — direct unke wallet me (decimals yaad rakhna: USDT = 6, so 1000 tokens = `1000000000`)
2. **Website se:** unhone coins forge kiye honge to normal withdraw hi hai

Bade distribution ke liye baad me ek chhota airdrop script ban sakti hai (loop + `mint`) — abhi zaroori nahi.

## ✅ Launch-day order (TL;DR)

1. `npm run deploy:flash:polygon` (PART A) → addresses save
2. Verify commands (A5, optional)
3. `.env` + `wrangler.jsonc` switch (C1, C2)
4. `npm run build` → `wrangler deploy` → `wrangler pages deploy` (C3)
5. `/api/health` check (C4) → E2E test (C5)
6. USDC wallet me lao → `npm run liquidity:dex` (B1)
7. QuickSwap pe chhota swap test (B3)
8. Announcement 🚀

**Minter top-up reminder:** users aane pe `0xaB80…AE02` wallet me POL >= 5 rakho.


