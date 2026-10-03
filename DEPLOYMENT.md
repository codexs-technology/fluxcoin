# FluxCoin — Flash Assets Deployment Guide (5 per-asset contracts, Polygon 137)

Yeh guide 5 alag Flash token contracts (USDT / BTC / ETH / TRX / SOL — on-chain names plain tickers hain), Cloudflare Worker, aur frontend ko **Polygon mainnet (chainId 137)** pe production-ready deploy karne ke liye hai. Sepolia sirf testing ke liye hai (Step 9).

> 🚀 **Beginner-friendly ordered checklist** (copy-paste ready commands): [`MAINNET-DEPLOY-CHECKLIST.md`](MAINNET-DEPLOY-CHECKLIST.md) — yeh detail guide ka step-by-step companion hai.

**Architecture (per-asset contracts):**

| Asset | Contract name | Symbol | Decimals | Env var (Worker) | Env var (frontend) |
|-------|--------------|--------|----------|------------------|--------------------|
| USDT (default) | USDT | USDT | 6 | `TOKEN_ADDRESS_USDT` | `VITE_TOKEN_ADDRESS_USDT` |
| BTC | BTC | BTC | 8 | `TOKEN_ADDRESS_BTC` | `VITE_TOKEN_ADDRESS_BTC` |
| ETH | ETH | ETH | 18 | `TOKEN_ADDRESS_ETH` | `VITE_TOKEN_ADDRESS_ETH` |
| TRX | TRX | TRX | 6 | `TOKEN_ADDRESS_TRX` | `VITE_TOKEN_ADDRESS_TRX` |
| SOL | SOL | SOL | 9 | `TOKEN_ADDRESS_SOL` | `VITE_TOKEN_ADDRESS_SOL` |

Jab user USDT select karega → earn site-balance pe credit hoga → withdraw pe **USDT contract se mint** hoga. BTC select → BTC contract se. Har asset ka apna balance, apna cooldown, apna daily cap hai.

---

## Step 0 — Prerequisites

- Node.js 18+ installed, repo root me `npm install`, `contracts/` me `npm install` (agar nahi kiya).
- PolygonPoS RPC access (default `https://polygon-rpc.com` free hai; production ke liye Alchemy/Infura/Ankr ka personal RPC recommended).
- Cloudflare account (Worker + Pages already bane hue hain: `fluxcoin` worker + `fluxcoin` Pages project).

## Step 1 — Wallets banao (3 alag roles)

| Wallet | Kaam | Kaise banaye |
|--------|------|--------------|
| **Deployer** | 5 contracts deploy karega (gas deta hai) | MetaMask me naya account |
| **Admin / Treasury** | `DEFAULT_ADMIN_ROLE` + `MINTER_ROLE` receive karega | Alag account (yeh cold/secure hona chahiye) |
| **Backend Minter** | Worker isse se mint karega (`MINTER_PRIVATE_KEY`) | Alag hot-wallet account — iska **private key** Worker secret banega |

> ⚠️ **Security:** `DEPLOYER_PRIVATE_KEY` aur `MINTER_PRIVATE_KEY` kabhi commit mat karna. Minter key sirf Worker secret (`wrangler secret`) me jayegi. Admin key kisi env file me nahi jati — sirf deploy command me address use hoti hai.

## Step 2 — Kitna POL/MATIC chahiye? (gas budget)

Polygon pe gas POL (MATIC) me lagta hai. Current typical gas price ~30–100 gwei ke hisaab se:

| Wallet | Recommended minimum | Kyun |
|--------|---------------------|------|
| **Deployer** | **3 POL** | 5 × FlashToken deploy ≈ 0.5–2 POL + 5 role-grant txs |
| **Backend Minter** | **10 POL** | Har withdrawal mint ~70k gas ≈ 0.005–0.01 POL → ~1000+ withdrawals ka buffer |
| Admin | 0 (sirf roles receive karta hai) | — |

POL kharidna: kisi bhi exchange (Binance/Coinbase/OKX) se Polygon network pe withdraw karo, ya bridge use karo. 5–10 POL ka buffer rakho.

## Step 3 — Root `.env` bharo

Repo root `.env` me yeh values set karo:

```env
# Deploy gas dene wali wallet (funded with POL)
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY

# Roles receive karne wale addresses
TOKEN_ADMIN_ADDRESS=0xYOUR_ADMIN_ADDRESS
BACKEND_MINTER_ADDRESS=0xYOUR_MINTER_WALLET_ADDRESS

# Polygon RPC (personal RPC recommended for reliability)
RPC_URL_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

# Contract verification (optional but recommended)
POLYGONSCAN_API_KEY=YOUR_POLYGONSCAN_API_KEY
```

## Step 4 — 5 Flash contracts deploy karo (Polygon mainnet)

`contracts/` folder se:

```powershell
cd contracts
npm run deploy:flash:polygon
# ya: npx hardhat run scripts/deployFlashAssets.js --network polygon
```

Script yeh karega:
1. Har asset ka **FlashToken** deploy karega (name, symbol, decimals registry ke saath synced).
2. Har contract pe `BACKEND_MINTER_ADDRESS` ko `MINTER_ROLE` grant karega (yahi wallet Worker se mint karega).
3. `.env.flash-assets.json` manifest likhega + console pe **exact env lines** print karega (VITE_TOKEN_ADDRESS_* aur TOKEN_ADDRESS_*).

Output example:

```
VITE_TOKEN_ADDRESS_USDT=0xAbC...   <- root .env me paste karo
VITE_TOKEN_ADDRESS_BTC=0xDef...
VITE_TOKEN_ADDRESS_ETH=0x123...
VITE_TOKEN_ADDRESS_TRX=0x456...
VITE_TOKEN_ADDRESS_SOL=0x789...
VITE_NETWORK_ID=137

TOKEN_ADDRESS_USDT=0xAbC...        <- wrangler.jsonc me paste karo
TOKEN_ADDRESS_BTC=0xDef...
...
```

**Yeh 5 addresses root `.env` ke `VITE_TOKEN_ADDRESS_*` slots me paste karo** (slots already bane hue hain wahan).

Optional per-asset supply overrides (whole tokens; default: initial 0, max 1B):

```env
FLASH_INITIAL_SUPPLY_USDT=0
FLASH_MAX_SUPPLY_USDT=1000000000
FLASH_MAX_SUPPLY_BTC=21000000
FLASH_MAX_SUPPLY_ETH=120000000
```

> Initial supply 0 rehne do — Worker user ki earned balance ke hisaab se mint karega, supply clean rahega.

## Step 5 — Contracts verify karo (Polygonscan) — optional but recommended

```powershell
npx hardhat verify --network polygon <USDT_ADDRESS> "USDT" "USDT" 6 <DEPLOYER_ADDRESS> 0 1000000000
npx hardhat verify --network polygon <BTC_ADDRESS>  "BTC"  "BTC"  8 <DEPLOYER_ADDRESS> 0 21000000
npx hardhat verify --network polygon <ETH_ADDRESS>  "ETH"  "ETH"  18 <DEPLOYER_ADDRESS> 0 120000000
npx hardhat verify --network polygon <TRX_ADDRESS>  "TRX"  "TRX"  6 <DEPLOYER_ADDRESS> 0 1000000000
npx hardhat verify --network polygon <SOL_ADDRESS>  "SOL"  "SOL"  9 <DEPLOYER_ADDRESS> 0 1000000000
```

(4th arg = `<DEPLOYER_ADDRESS>` = deployer wallet address — deploy script constructor mein DEPLOYER ko initial admin banata hai, roles baad mein TOKEN_ADMIN ko hand over hote hain. Har contract ke liye uske address + params repeat karo. `initialSupply=0`, `maxSupplyCap` jo deploy script ne print kiya.)

## Step 6 — Cloudflare Worker config + secrets

### 6a. `wrangler.jsonc` (repo root) me 5 addresses paste karo

```jsonc
"CHAIN_ID": "137",
"RPC_URL": "https://polygon-rpc.com",
"TOKEN_ADDRESS_USDT": "0xAbC...",
"TOKEN_ADDRESS_BTC": "0xDef...",
"TOKEN_ADDRESS_ETH": "0x123...",
"TOKEN_ADDRESS_TRX": "0x456...",
"TOKEN_ADDRESS_SOL": "0x789...",
```

### 6b. Secrets set karo (repo root se):

```powershell
# Minter wallet ka private key (BACKEND_MINTER_ADDRESS wali wallet)
npx wrangler secret put MINTER_PRIVATE_KEY --config wrangler.jsonc
# prompt me: 0xYOUR_MINTER_PRIVATE_KEY

# Session signing secret (long random string)
npx wrangler secret put SESSION_SECRET --config wrangler.jsonc
```

> `MINTER_PRIVATE_KEY` set hote hi withdrawals **real mint** ho jayengi. Isse pehle (`ALLOW_DRY_RUN=true`) sab SIMULATED book hota tha.

### 6c. Production me dry-run band karna (jab sab confirm ho jaye):

```jsonc
"ALLOW_DRY_RUN": "false"
```

### 6d. KV namespace (balances persist hon — zaroori hai!)

Bina KV ke balances isolate-memory me rehti hain — Worker cold-start pe **sab reset ho jayega**:

```powershell
npx wrangler kv namespace create FLUXCOIN_KV --config wrangler.jsonc
# output me id copy karo, phir wrangler.jsonc me add karo:
```

```jsonc
"kv_namespaces": [
  { "binding": "FLUXCOIN_KV", "id": "<PRINTED_ID>" }
]
```

### 6e. Worker deploy:

```powershell
npx wrangler deploy --config wrangler.jsonc
```

Verify: `https://fluxcoin.codexstechnology.workers.dev/api/health` — `chain.chainId` **137** hona chahiye, `assets` array me 5o assets `configured: true`, aur `warnings` me na `FLUXCOIN_KV is not bound` ho na minter warning.

## Step 7 — Frontend deploy (Cloudflare Pages)

Root `.env` me `VITE_NETWORK_ID=137` + 5 `VITE_TOKEN_ADDRESS_*` (Step 4 se) hone chahiye.

**Pages project settings me environment variables** (Cloudflare dashboard → Pages → fluxcoin → Settings → Environment variables → Production):

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://fluxcoin.codexstechnology.workers.dev` |
| `VITE_NETWORK_ID` | `137` |
| `VITE_TOKEN_ADDRESS_USDT` | `<address>` |
| `VITE_TOKEN_ADDRESS_BTC` | `<address>` |
| `VITE_TOKEN_ADDRESS_ETH` | `<address>` |
| `VITE_TOKEN_ADDRESS_TRX` | `<address>` |
| `VITE_TOKEN_ADDRESS_SOL` | `<address>` |
| `VITE_WALLETCONNECT_PROJECT_ID` | (agar QR/AppKit chahiye) |

Phir deploy (ya git push — Pages build command `npm run build` already configured hai):

```powershell
npm run build   # local verify
npx wrangler pages deploy dist --project-name fluxcoin   # manual deploy
```

> ⚠️ VITE_* values build-time pe bundle me bake hoti hain — badalne ke baad **rebuild + redeploy** zaroori hai.

**Network selection priority (network-revert bug fix):**

| Priority | Source | Kab use hota hai |
|----------|--------|------------------|
| 1 | **UI dropdown (`03 // Settlement Wallet`)** — user ki live selection | Hamesha. Har action (import / withdraw / generate / swap) yahi chain use karta hai — koi action selection ko override NAHI karta. |
| 2 | **localStorage preference** (`fluxcoin.networkPreference.v1`) | Page refresh / reconnect pe wallet ko wapas isi chain pe laane ke liye (injected wallets, silently). |
| 3 | **`VITE_NETWORK_ID`** (build default) | SIRF jab user ne kabhi kuch select na kiya ho YA wallet kisi unknown chain pe ho. Code ka fallback bhi 137 (Polygon) hai. |

- Root `.env` git me commit NAHI hoti, isliye Cloudflare Pages build me `VITE_NETWORK_ID` tabhi milega jab dashboard me Environment Variable set ho — **isliye Pages settings me `VITE_NETWORK_ID=137` zaroor set karo** (nahi to code ka hardcoded fallback 137 hi chalega, jo theek hai, par explicit better hai).
- Sepolia (11155111) kabhi implicit default NAHI hai — sirf tab jab user khud dropdown se Sepolia select kare.
- "IMPORT FLASH TOKENS" ab user ki current chain pe hi watchAsset chalata hai; chain switch sirf tab jab wallet unknown chain pe ho.

## Step 8 — End-to-end test checklist (production)

1. `https://fluxcoin.pages.dev` kholo → MetaMask connect karo (sirf connect — **auto signature prompt nahi aana chahiye**).
2. Wallet ko Polygon pe switch karo (UI ka network dropdown ya "IMPORT FLASH TOKENS" button — yeh `wallet_switchEthereumChain` + `wallet_addEthereumChain` + `wallet_watchAsset` use karta hai).
3. USDT preset select → quantity → GENERATE → MetaMask me **ek** login signature aayegi (yeh user-initiated hai, isliye safe).
4. Withdraw tab → amount → WITHDRAW → Worker `MINTER_PRIVATE_KEY` se USDT contract pe mint karega → tx Polygonscan link dikhega.
5. MetaMask me token dikhna chahiye (withdraw success pe app khud `wallet_watchAsset` offer karta hai; nahi dikhe to "IMPORT FLASH TOKENS" button dabao).
6. BTC preset select karke repeat karo → BTC contract se mint hona chahiye (Polygonscan pe tx ka "To Contract" address alag hoga).

## Step 9 — Sepolia pe pehle test karna ho to:

```powershell
# .env me:
#   RPC_URL_SEPOLIA=https://sepolia.infura.io/v3/YOUR_KEY (ya public RPC)
#   DEPLOYER_PRIVATE_KEY= (Sepolia-funded key)
#   TOKEN_ADMIN_ADDRESS / BACKEND_MINTER_ADDRESS = test addresses
cd contracts
npm run deploy:flash:sepolia

# wrangler.jsonc me (TESTING ONLY):
#   "CHAIN_ID": "11155111"
#   "RPC_URL": "https://rpc.chainlist.io/sepolia"
#   TOKEN_ADDRESS_* = Sepolia addresses
# Test ke baad mainnet values wapas daalna mat bhoolna!
```

## Troubleshooting

| Problem | Reason / Fix |
|---------|--------------|
| Tokens MetaMask me nahi dikh rahe | "IMPORT FLASH TOKENS" button dabao, ya manually "Import token" me contract address + decimals daalo. Wallet Polygon network pe hona chahiye. |
| Withdrawals "SIMULATED / DRY-RUN" keh rahe | `MINTER_PRIVATE_KEY` secret missing, ya us asset ka `TOKEN_ADDRESS_*` unset, ya `ALLOW_DRY_RUN=true`. |
| `SPONSORED_SETTLEMENT_FAILED` | Minter wallet me POL nahi hai (top up karo), ya minter ke paas `MINTER_ROLE` nahi (deploy script ne grant kiya tha — `.env.flash-assets.json` check karo). |
| Balances reset ho rahe | KV namespace bind nahi hai (Step 6d). |
| MetaMask "This site may be compromised" | MetaMask ka phishing-blocklist fluxcoin.pages.dev ko flag kar raha (code clean hai). Fix ke liye custom domain use karo (e.g. `fluxcoin.xyz` → Pages custom domain) — pages.dev subdomain MetaMask ke blocklist me aa sakta hai. Appeal bhi possible hai: https://github.com/MetaMask/phishing-detection — repo me issue kholo apne domain ke saath. |
| `UNKNOWN_ASSET` API error (`asset: "forge"`) | Frontend purane code se chal raha hai — ya to naya build deploy nahi hua (Step 7), ya dev server purane `.kilo/worktrees/*` folder se chal raha hai. Fix: root folder (`e:\Flush Coin`) se `npm run dev` / naya build deploy karo. |
| IMPORT FLASH TOKENS dabane pe network selection Sepolia pe revert ho jati | Purana build `ensureWalletChain()` ko build-default chain pe FORCE karta tha, aur purane code ka fallback Sepolia (11155111) tha kyunki `.env` Pages build tak pahunchti hi nahi. Naya code user ki current chain respect karta hai + selection localStorage me persist hoti hai — naya build deploy karo (Step 7) aur browser hard-refresh (Ctrl+Shift+R). |

## File reference (kya kahan hai)

- `contracts/src/FlashToken.sol` — per-asset ERC-20 (name/symbol/decimals parameterized, MINTER_ROLE, maxSupply cap)
- `contracts/scripts/deployFlashAssets.js` — 5 contracts deploy + roles + manifest
- `api/src/assets.ts` — asset registry (Worker side; TOKEN_ADDRESS_* parse)
- `api/src/store.ts` — per-asset balances (`Account.assets[assetId]`, legacy migration included)
- `api/src/withdraw.ts` — per-asset parse/validate/settle (per-asset dry-run fallback)
- `src/contracts/assets.js` — asset registry (frontend side; VITE_TOKEN_ADDRESS_* parse)
- `src/wallet/watchAsset.js` — EIP-747 `wallet_watchAsset` + Polygon chain switch
- `src/hooks/useCoinBalance.js` — selected asset se earn/withdraw; **auto sign-in removed** (sirf explicit click pe signature)


