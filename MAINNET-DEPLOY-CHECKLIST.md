# 🚀 FluxCoin — Mainnet Deploy Checklist (5 Flash contracts, Polygon 137)

> Yeh ek **beginner-friendly, copy-paste ready** ordered checklist hai — `contracts/scripts/deployFlashAssets.js` se **Polygon mainnet (chainId 137)** pe 5 Flash token contracts (USDT / BTC / ETH / TRX / SOL — plain ticker names) deploy karne ke liye.
>
> Detail wali guide `DEPLOYMENT.md` me hai — yeh file sirf **step-by-step execution** ke liye hai.
> Saare commands **repo root (`e:\Flush Coin`)** se chalane ke liye likhe hain jab tak `cd contracts` na bola jaye.

---

## ⚡ TL;DR — 12-Step Ordered Checklist

| # | Step | Kahan |
|---|------|-------|
| 1 | 3 wallets banao (Deployer / Admin / Minter) | MetaMask |
| 2 | Deployer me **3+ POL**, Minter me **10+ POL** bhejo | Exchange se Polygon network pe withdraw |
| 3 | Root `.env` me 3 values bharo (key + 2 addresses) | `.env` |
| 4 | (Optional) Sepolia pe pehle free test karo | Section 3.3 |
| 5 | `cd contracts` → `npm install` → `npm run deploy:flash:polygon` | Terminal |
| 6 | 5 addresses console + `.env.flash-assets.json` se copy karo | repo root |
| 7 | Root `.env` me `VITE_TOKEN_ADDRESS_*` (5 values) bharo | `.env` |
| 8 | `wrangler.jsonc` me `TOKEN_ADDRESS_*` (5 values) + KV binding bharo | `wrangler.jsonc` |
| 9 | Worker secrets set karo: `SESSION_SECRET` + `MINTER_PRIVATE_KEY` | `npx wrangler secret put` |
| 10 | Worker redeploy: `npx wrangler deploy --config wrangler.jsonc` | Terminal |
| 11 | Frontend build + deploy: `npm run build` → `npx wrangler pages deploy dist` | Terminal |
| 12 | Verify: Polygonscan + `/api/health` + E2E flow | Section 5 |

---

## 1️⃣ Wallet Setup — kaunsi wallet me kya chahiye

### 1.1 — Teen alag wallets banao (MetaMask me 3 naye accounts)

| Wallet | Kaam | Gas (POL) chahiye? |
|--------|------|--------------------|
| 🔧 **Deployer** | 5 contracts deploy karega + role-grant txs | ✅ **3+ POL** |
| 👑 **Admin / Treasury** | `DEFAULT_ADMIN_ROLE` receive karega (owner) | ❌ 0 (sirf address chahiye) |
| 🖨️ **Backend Minter** | Worker isi se withdrawal mint karega | ✅ **10+ POL** |

> ⚠️ **3 alag accounts hi use karo** — ek hi wallet se kaam chal jata hai, par security ke liye alag rakhna best practice hai (minter key Worker me rehti hai, agar leak ho to sirf minter wallet ka loss hota hai, admin safe rehta hai).

### 1.2 — Kitna POL lagega (approximate)

- **Deployer (3+ POL):** har FlashToken deploy ≈ 1.2–1.6M gas → 5 contracts + 5 role-grant txs ≈ **7–8M total gas**. Gas price 30–100 gwei pe = **0.25–0.8 POL**, spikes pe (300 gwei) ≈ 2.4 POL. **3 POL ka buffer safe hai.**
- **Minter (10+ POL):** har withdrawal mint ≈ 70k gas ≈ **0.002–0.02 POL per withdrawal** → 10 POL = hazaron withdrawals.
- Admin: **0 POL** (sirf roles receive karta hai, koi tx nahi karta).

### 1.3 — POL kahan se laun

| Option | Kaise | Note |
|--------|-------|------|
| ✅ **Exchange withdraw (recommended)** | Binance / MEXC / OKX se **POL (MATIC)** kharido → withdraw karte waqt **network: Polygon (MATIC/Polygon PoS)** select karo | Sabse sasta (~0.1 POL fee). **Dhyan: "Ethereum (ERC-20)" network mat chunna** — wahan fees ₹500+ lagti hai |
| 💳 MetaMask card se | MetaMask me "Buy" → MoonPay/Transak se POL | Easy par fees zyada (3–5%) |
| 🌉 Bridge | Ethereum se assets Polygon pe bridge karo | Slow + Ethereum gas fees |

> Exchange pe POL kabhi kabhi **MATIC** naam se listed hai (same coin, rebrand hua tha). Withdraw address = apna Deployer wallet address, network = **Polygon**.

---

## 2️⃣ Deployer Private Key Setup

### 2.1 — Root `.env` me yeh 3 values bharo

File: **`e:\Flush Coin\.env`** (repo root — yeh file **git me commit nahi hoti**, isliye safe hai):

```env
# Deploy gas dene wali wallet (jisme 3+ POL dala hai)
DEPLOYER_PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY

# Roles receive karne wale addresses (gas nahi chahiye)
TOKEN_ADMIN_ADDRESS=0xYOUR_ADMIN_WALLET_ADDRESS
BACKEND_MINTER_ADDRESS=0xYOUR_MINTER_WALLET_ADDRESS

# RPC (default free RPC already set hai — alag se bharne ki zaroorat nahi)
RPC_URL_POLYGON=https://polygon-rpc.com
```

**Private key kaise nikalein (MetaMask):** Account details → "Show private key" → password daalo → copy.
Format hamesha `0x` se shuru hota hai (e.g. `0xabc123...`).

### 2.2 — Security rules

- ✅ `DEPLOYER_PRIVATE_KEY` **sirf root `.env` me** (`.env` gitignored hai — kabhi commit nahi hogi)
- ✅ `MINTER_PRIVATE_KEY` **sirf Cloudflare Worker secret** me (Step 9 me — env file me NAHI)
- ❌ Private keys kabhi chat/WhatsApp/screenshot me mat bhejo
- 👑 Admin ka private key **kahin set nahi karna** — sirf uska `TOKEN_ADMIN_ADDRESS` use hota hai. Admin key apne paas safe rakho (yahi sabse powerful hai — roles grant/revoke kar sakta hai)

### 2.3 — (Optional) Polygonscan API key — contract verify ke liye

Free key: https://polygonscan.com/myapikey → root `.env` me:
```env
POLYGONSCAN_API_KEY=YOUR_KEY
```
Isse deployed contracts ka **source code Polygonscan pe readable** dikhega (trusted lagta hai users ko).

---

## 3️⃣ Deployment Commands

### 3.1 — Deploy se pehle env variables (checklist)

Root `.env` me yeh set honi chahiye:

| Variable | Zaroori? | Value |
|----------|----------|-------|
| `DEPLOYER_PRIVATE_KEY` | ✅ | Deployer wallet ka key (POL funded) |
| `TOKEN_ADMIN_ADDRESS` | ✅ (recommended) | Admin wallet ka **address** (0x...) |
| `BACKEND_MINTER_ADDRESS` | ✅ (recommended) | Minter wallet ka **address** (0x...) |
| `RPC_URL_POLYGON` | ✅ (default already set) | `https://polygon-rpc.com` |
| `POLYGONSCAN_API_KEY` | ⬜ Optional | Verify ke liye |

### 3.2 — ⭐ MAINNET DEPLOY (Polygon, chainId 137) — EXACT COMMANDS

```powershell
# 1. Repo root se contracts folder me jao (ek baar)
cd e:\Flush Coin\contracts

# 2. Dependencies (pehli baar — skip agar pehle se ho chuka)
npm install

# 3. Compile check (optional, 30 sec)
npm run compile

# 4. 🚀 DEPLOY — 5 contracts Polygon mainnet pe
npm run deploy:flash:polygon
```

> **Yeh command real hai — real POL kharch hoga aur mainnet pe immutable contracts banenge.**
> Output ~2–4 min leta hai (10 transactions: 5 deploy + 5 role grants).

**Kya hoga:** Har asset ke liye console me aisa dikhega:
```
Deploying USDT (USDT, 6 decimals)…
  USDT -> 0xAbC123...def456
  granted MINTER_ROLE to backend minter 0xYourMinterAddress
...
Saved deployment manifest -> e:\Flush Coin\.env.flash-assets.json
```

### 3.3 — 🧪 FREE TESTNET PEHLE (Sepolia) — recommended!

Mainnet se pehle **bina paise** ka full test (repo me testnet = **Sepolia**, chainId 11155111):

```powershell
# 1. Free Sepolia ETH lo (deployer wallet address se):
#    https://cloud.google.com/application/web3/faucet/ethereum/sepolia   (Google account se login, free)
#    ya https://sepolia-faucet.pk910.de                                  (PoW faucet, no signup)
#    0.5 ETH se kaam ho jayega

# 2. Root .env me temporarily (TEST KE LIYE):
#    DEPLOYER_PRIVATE_KEY=<Sepolia-funded wallet ka key>

# 3. Deploy to Sepolia:
cd e:\Flush Coin\contracts
npm run deploy:flash:sepolia
```

Sepolia addresses `https://sepolia.etherscan.io/address/<addr>` pe check karo.
**Test ke baad** root `.env` me wapas **mainnet wala `DEPLOYER_PRIVATE_KEY`** daalna, aur Step 5+ me hamesha **mainnet addresses** use karna!

> Note: Sepolia pe gas **ETH** me lagta hai (POL nahi) — isliye free faucet ka ETH chahiye.

---

## 4️⃣ Deploy ke Baad — Addresses Kahan Set Karni Hain

### 4.1 — Addresses kahan milengi

**Do jagah (dono same hain):**
1. **Console output** — deploy command ne print ki (upar jaisa)
2. **File:** `e:\Flush Coin\.env.flash-assets.json` — isme sab kuch structured me saved hai:
```json
{
  "chainId": 137,
  "assets": {
    "usdt": { "address": "0x...", "symbol": "USDT", "decimals": 6 },
    "btc":  { "address": "0x...", "symbol": "BTC",  "decimals": 8 }
  }
}
```

### 4.2 — Frontend `.env` (root `e:\Flush Coin\.env`)

```env
VITE_TOKEN_ADDRESS_USDT=0xUSDT_CONTRACT_ADDRESS
VITE_TOKEN_ADDRESS_BTC=0xBTC_CONTRACT_ADDRESS
VITE_TOKEN_ADDRESS_ETH=0xETH_CONTRACT_ADDRESS
VITE_TOKEN_ADDRESS_TRX=0xTRX_CONTRACT_ADDRESS
VITE_TOKEN_ADDRESS_SOL=0xSOL_CONTRACT_ADDRESS
VITE_NETWORK_ID=137
```

> Yeh values **build me bake hoti hain** — badalne ke baad `npm run build` dobara zaroori (Section 4.8).

### 4.3 — Cloudflare Worker (`wrangler.jsonc` at repo root)

`vars` block me 5 addresses bharo (deploy script ne exact lines print ki thi):

```jsonc
"TOKEN_ADDRESS_USDT": "0xUSDT_CONTRACT_ADDRESS",
"TOKEN_ADDRESS_BTC": "0xBTC_CONTRACT_ADDRESS",
"TOKEN_ADDRESS_ETH": "0xETH_CONTRACT_ADDRESS",
"TOKEN_ADDRESS_TRX": "0xTRX_CONTRACT_ADDRESS",
"TOKEN_ADDRESS_SOL": "0xSOL_CONTRACT_ADDRESS",
```

(`CHAIN_ID` already `"137"` set hai.)

### 4.4 — KV namespace (balances persist karne ke liye)

```powershell
# 1. Namespace banao (repo root se):
npx wrangler kv namespace create FLUXCOIN_KV
# Output me id milega, e.g.: id = "abcd1234..."
```

Phir `wrangler.jsonc` me top-level add karo (vars ke bahar):

```jsonc
"kv_namespaces": [
  { "binding": "FLUXCOIN_KV", "id": "<WOH_ID_YAHAN>" }
]
```

> **KV me kuch manually store nahi karna** — Worker khud balances/ledger save karta hai. Sirf create + bind karna hai. (Abhi production me storage "memory" hai = cold start pe balances reset — yeh step yeh fix karta hai.)

### 4.5 — Worker SECRETS (exact names)

```powershell
# Repo root se (e:\Flush Coin):
npx wrangler secret put SESSION_SECRET
# -> long random string paste karo. Generate karne ke liye PowerShell me:
#    -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

npx wrangler secret put MINTER_PRIVATE_KEY
# -> MINTER WALLET ka private key paste karo (0x... — jis wallet ka
#    address aapne BACKEND_MINTER_ADDRESS me deploy ke waqt diya tha)
```

### 4.6 — Kya sirf deployer minter hai? — NAHI

Deploy script **`MINTER_ROLE` aapke `BACKEND_MINTER_ADDRESS` wallet ko deta hai** (deployer ko nahi — deployer sirf gas deta hai). Isliye:

- Worker me `MINTER_PRIVATE_KEY` = **usi minter wallet ka private key** (jo `BACKEND_MINTER_ADDRESS` me diya tha) — yeh **zaroori hai** real mint ke liye
- ⚠️ Agar aapne deploy ke waqt `BACKEND_MINTER_ADDRESS` **khali** chhoda → script ne default **deployer** ko minter bana diya → phir `MINTER_PRIVATE_KEY` me **deployer ka key** hi dena padega (chalta hai, par alag minter wallet zyada safe hai)
- **Exact Worker secrets (sirf 2 zaroori):** `SESSION_SECRET`, `MINTER_PRIVATE_KEY`

### 4.7 — Worker redeploy

```powershell
# Repo root se:
npx wrangler deploy --config wrangler.jsonc
```

(Git push karne pe Cloudflare CI bhi Worker auto-deploy kar deta hai, kyunki build `npx wrangler deploy` chalata hai — manual command bhi same kaam karti hai.)

### 4.8 — Frontend build + deploy

```powershell
# Repo root se (.env me VITE_TOKEN_ADDRESS_* bharne ke BAAD):
npm run build
npx wrangler pages deploy dist --project-name fluxcoin
```

---

## 5️⃣ Verification Steps

### 5.1 — Polygonscan pe contracts confirm karo

Har address kholo: `https://polygonscan.com/address/<CONTRACT_ADDRESS>`

| Kya check karna | Kya dikhna chahiye |
|-----------------|--------------------|
| Contract name | "USDT" / "BTC" / "ETH" / "TRX" / "SOL" (plain tickers) |
| Contract Creator | Aapka **deployer** address |
| Token Tracker | Symbol (USDT/BTC/...) + decimals |
| Tx list | Deploy + `grantRole` transactions |

Minter role confirm: contract page → **"Logs"** tab → `RoleGranted` event me `account` = aapka minter address ✓

### 5.2 — API health check (yeh aana chahiye jab SAB sahi set ho)

Browser me kholo: **https://fluxcoin.codexstechnology.workers.dev/api/health**

```json
{
  "ok": true,
  "network": {
    "chainId": 137,
    "tokenConfigured": true,
    "assetsConfigured": 5,
    "assets": [
      { "id": "usdt", "configured": true, "address": "0x..." },
      { "id": "btc",  "configured": true, "address": "0x..." },
      { "id": "eth",  "configured": true, "address": "0x..." },
      { "id": "trx",  "configured": true, "address": "0x..." },
      { "id": "sol",  "configured": true, "address": "0x..." }
    ]
  },
  "storage": "kv",
  "gasless": { "mode": "server-sponsored" },
  "warnings": []
}
```

**Green flags:** `chainId: 137` ✓ `tokenConfigured: true` ✓ `assetsConfigured: 5` ✓ `storage: "kv"` ✓ `gasless.mode: "server-sponsored"` ✓ `warnings: []` (empty — koi dry-run warning nahi) ✓

**Current status (deploy se pehle):** `assetsConfigured: 0`, `storage: "memory"`, `gasless.mode: "dry-run"`, 5 warnings — yahi aapka "USDT contract address is not set" error ka source hai (`src/hooks/useCoinBalance.js` frontend `.env` ke khali `VITE_TOKEN_ADDRESS_USDT` ki wajah se).

### 5.3 — End-to-End test (generate → withdraw → MetaMask)

1. **https://fluxcoin.pages.dev** kholo → **Ctrl+Shift+R** (hard refresh — naya build load hoga)
2. Wallet connect karo → network dropdown me **Polygon PoS** select karo
3. **USDT** preset select karo → quantity (e.g. 100) → **GENERATE** → MetaMask me 1 signature aayegi (yeh free login signature hai)
4. **Withdraw** tab → amount (e.g. 10) → **WITHDRAW** → result me **status SETTLED + txHash** aana chahiye (agar "SIMULATED" aaye to Section 6 / secrets check karo)
5. txHash ka Polygonscan link kholo → **"To" address = USDT contract** ho, function **`mint`** ho ✓
6. MetaMask → **IMPORT FLASH TOKENS** button → USDT balance dikhna chahiye (wallet Polygon pe ho)
7. **BTC** preset ke saath repeat karo → alag contract address se mint hona chahiye

---

## 6️⃣ Dry-Run se Real Mode — `ALLOW_DRY_RUN=false`

**Pehle samjho:** `MINTER_PRIVATE_KEY` + `TOKEN_ADDRESS_*` set hote hi Worker **khud real mint karna shuru** kar deta hai (`GASLESS_MODE=auto` → `server-sponsored`). `ALLOW_DRY_RUN` sirf **fallback** hai — jab kuch missing ho to withdrawal fail hone ki jagah "SIMULATED" book ho jati hai.

**Band karna (jab sab confirm ho jaye):**

```powershell
# 1. wrangler.jsonc me (repo root):
#    "ALLOW_DRY_RUN": "true"   ->   "ALLOW_DRY_RUN": "false"

# 2. Worker redeploy:
npx wrangler deploy --config wrangler.jsonc
```

**Effect:** ab agar kabhi minter key/RPC/address missing ho gayi to withdrawals **503 error** dengi (loud failure) — chupke se fake "SIMULATED" entries nahi.

> 💡 Recommendation: pehle 1–2 asli withdrawal test kar lo (real mint hone do), phir `false` kar do.

---

## 🔧 Common Problems

| Problem | Fix |
|---------|-----|
| `insufficient funds for gas` | Deployer wallet me POL nahi hai — 3+ POL bhejo |
| Deploy ne `NOTE: you deployed to chainId 11155111` bola | Aap Sepolia pe deploy kar rahe the! Mainnet ke liye `npm run deploy:flash:polygon` use karo |
| Health me `assetsConfigured: 0` | `wrangler.jsonc` me `TOKEN_ADDRESS_*` nahi bhare, ya Worker redeploy nahi hua (Section 4.3 + 4.7) |
| Withdrawals ab bhi "SIMULATED" | `MINTER_PRIVATE_KEY` secret missing / minter wallet me POL nahi / minter ke paas `MINTER_ROLE` nahi |
| Frontend me "USDT contract address is not set" | Root `.env` me `VITE_TOKEN_ADDRESS_USDT` bharne ke **baad** `npm run build` + Pages deploy **nahi hua** (Section 4.8) |
| Balances reset ho rahe hain | KV namespace bind nahi hai (Section 4.4) |
| `SPONSORED_SETTLEMENT_FAILED` | Minter wallet me POL khatam — top up karo |

---

*Last updated: 2026-09-29 • Repo: codexs-technology/fluxcoin • Detail guide: `DEPLOYMENT.md`*
