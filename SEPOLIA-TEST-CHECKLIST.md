# 🧪 FluxCoin — Sepolia Testnet Deploy Checklist (5 Flash contracts)

> Yeh file **sirf Sepolia (chainId 11155111) test** ke liye hai — asli production deploy `MAINNET-DEPLOY-CHECKLIST.md` me hai.
> Saare commands **repo root (`e:\Flush Coin`)** se chalane ke liye likhe hain jab tak `cd contracts` na bola jaye.
> ⚠️ **Test ke baad mainnet pe switch karna ho to Section 9 (Clean Switch Plan) follow karo** — wahi single source of truth hai, taake Sepolia values mainnet me mix na hon.
>
> Koi bhi **code file me hardcoded change NAHI hai** — sirf config files (`.env` + `wrangler.jsonc`) switch hoti hain, wahi revert hoti hain.

---

## ⚡ TL;DR — Ordered Checklist

| # | Step | Kahan | Manual zaroorat? |
|---|------|-------|------------------|
| 0 | Root `.env` ki 3 values VERIFY karo (⚠️ abhi KHALI mile hain!) | `.env` | Agar khali → aap bharo |
| 1 | `cd contracts` → `npm install` → `npm run deploy:flash:sepolia` | Terminal | ❌ |
| 2 | 5 addresses console + `.env.flash-assets.json` se note karo | repo root | ❌ |
| 3 | Root `.env`: `VITE_NETWORK_ID=11155111` + 5 `VITE_TOKEN_ADDRESS_*` | `.env` | ✅ paste |
| 4 | `wrangler.jsonc`: `CHAIN_ID` + `RPC_URL` + 5 `TOKEN_ADDRESS_*` | `wrangler.jsonc` | ✅ paste |
| 5 | Minter wallet me ~0.01 Sepolia ETH + Worker secrets (`MINTER_PRIVATE_KEY`) | MetaMask + Terminal | ✅ |
| 6 | Worker redeploy: `npx wrangler deploy --config wrangler.jsonc` | Terminal | ❌ (wrangler login chahiye) |
| 7 | Frontend build + deploy: `npm run build` → `npx wrangler pages deploy dist` | Terminal | ❌ |
| 8 | Verify: Sepolia Etherscan + `/api/health` + E2E flow | Browser | ✅ |
| 9 | (Baad me) Mainnet clean switch — **Section 9** | — | ✅ |

---

## 0️⃣ Step 0 — Root `.env` VERIFY karo (PEHLA BLOCKER)

Aapne bola ki `DEPLOYER_PRIVATE_KEY`, `TOKEN_ADMIN_ADDRESS`, `BACKEND_MINTER_ADDRESS` set hain — **lekin abhi file me yeh 3 values KHALI mile hain** (file save nahi hui lagta hai). Yeh safe check command chalao (private key print NAHI hogi, sirf status):

```powershell
cd e:\Flush Coin
foreach ($n in 'DEPLOYER_PRIVATE_KEY','TOKEN_ADMIN_ADDRESS','BACKEND_MINTER_ADDRESS') {
  $line = Select-String -Path .env -Pattern "^$n=" | Select-Object -First 1
  $val = if ($line) { $line.Line.Substring($n.Length+1).Trim() } else { '' }
  if ([string]::IsNullOrWhiteSpace($val)) { Write-Host "$n : MISSING (khali hai!)" -ForegroundColor Red }
  elseif ($n -eq 'DEPLOYER_PRIVATE_KEY') { Write-Host "$n : SET ($($val.Length) chars)" -ForegroundColor Green }
  else { Write-Host "$n : SET ($val)" -ForegroundColor Green }
}
```

Agar MISSING dikhe to file **`e:\Flush Coin\.env`** me yeh bhar do (MetaMask → account → Account details → Show private key):

```env
DEPLOYER_PRIVATE_KEY=0x<DEPLOYER_PRIVATE_KEY>          # 0x2DA543190bEFE31c2183c1ba286362A9eDE208B5 wali wallet ka key
TOKEN_ADMIN_ADDRESS=0x<ADMIN_WALLET_ADDRESS>           # roles receive karega (gas nahi chahiye)
BACKEND_MINTER_ADDRESS=0x<MINTER_WALLET_ADDRESS>       # isi wallet ka key Step 5 me Worker secret banega
```

> ⚠️ **`BACKEND_MINTER_ADDRESS` khali chhoda toh** deploy script default **deployer** ko MINTER_ROLE de degi — phir Worker secret `MINTER_PRIVATE_KEY` me **deployer ka hi key** dena padega. Alag minter wallet zyada safe hai.

`RPC_URL_SEPOLIA=https://rpc.sepolia.org` already set hai — kuch nahi karna.

**Deployer ETH check (0.124 ETH):** 5 contracts + 5 role-grants ≈ 10–11M total gas. Sepolia gas sasta hai (aam taur pe 0.1–3 gwei) → total ~0.01–0.03 ETH lagta hai. **0.124 ETH normally kaafi hai** — sirf agar gas 12+ gwei pe spike ho jaye tab problem (phir faucet se thoda aur le lo).

---

## 1️⃣ Step 1 — Contracts deploy karo (Sepolia)

```powershell
# 1. Contracts folder me jao (ek baar)
cd e:\Flush Coin\contracts

# 2. Dependencies (pehli baar; node_modules already hai toh fast hoga)
npm install

# 3. (Optional) compile check — 30 sec
npm run compile

# 4. 🚀 DEPLOY — 5 Flash contracts Sepolia pe
npm run deploy:flash:sepolia
```

- **Time:** ~2–5 min, **10 transactions** (5 deploy + 5 `grantRole`)
- Console me aisa dikhega:

```
== Flash asset deployment (5 per-asset contracts) ==
network        : sepolia (chainId 11155111)
deployer       : 0x2DA543190bEFE31c2183c1ba286362A9eDE208B5
admin          : 0x<ADMIN>
backend minter : 0x<MINTER>

Deploying Flash USDT (USDT, 6 decimals)…
  USDT -> 0xAbC123...def456
  granted MINTER_ROLE to backend minter 0x<MINTER>
...
Saved deployment manifest -> e:\Flush Coin\.env.flash-assets.json
```

- End me `NOTE: you deployed to chainId 11155111` print hoga — **yeh normal hai** (yehi test hai).

## 2️⃣ Step 2 — 5 contract addresses KAHAN milengi

Do jagah, dono me same values:

1. **Console output** — deploy command ke end me ready-made paste blocks print hote hain:
   - `=== Paste into the repository root .env ===` → 5 `VITE_TOKEN_ADDRESS_*` lines + `VITE_NETWORK_ID=11155111`
   - `=== Paste into wrangler.jsonc "vars" ===` → 5 `TOKEN_ADDRESS_*` lines + `CHAIN_ID=11155111`
2. **Manifest file** — `e:\Flush Coin\.env.flash-assets.json` (JSON, `assets.usdt.address`, `assets.btc.address`, … keys me). Yeh file git-ignored hai (local record).

> 💡 Terminal se pure block copy karo aur neeche ke steps me paste karo — typing error ka chance zero.

---

## 3️⃣ Step 3 — Frontend `.env` (Sepolia test values)

File: **`e:\Flush Coin\.env`** (repo root) — sirf yeh 6 lines badalna hai:

```env
# Chain the Flash contracts live on: 137 = Polygon (PRODUCTION), 11155111 = Sepolia (testing)
VITE_NETWORK_ID=11155111

# Per-asset FlashToken contracts — Sepolia deploy ke addresses yahan paste karo:
VITE_TOKEN_ADDRESS_USDT=0x<SEPOLIA_USDT_ADDRESS>
VITE_TOKEN_ADDRESS_BTC=0x<SEPOLIA_BTC_ADDRESS>
VITE_TOKEN_ADDRESS_ETH=0x<SEPOLIA_ETH_ADDRESS>
VITE_TOKEN_ADDRESS_TRX=0x<SEPOLIA_TRX_ADDRESS>
VITE_TOKEN_ADDRESS_SOL=0x<SEPOLIA_SOL_ADDRESS>
```

**Kuch aur change NAHI karna:**
- `VITE_API_URL=https://fluxcoin.codexstechnology.workers.dev` — same rahega (build me `.env.production` override karta hai, already sahi hai)
- `VITE_RPC_11155111=https://rpc.sepolia.org` — already set hai
- `VITE_TOKEN_ADDRESS` / `VITE_FAUCET_ADDRESS` (legacy) — khali hi rehne do

---

## 4️⃣ Step 4 — Worker `wrangler.jsonc` (Sepolia test values)

File: **`e:\Flush Coin\wrangler.jsonc`** (repo root) — `vars` block me **sirf yeh 7 values** badalna hai:

```jsonc
    // TESTNET: Sepolia (11155111). Production = Polygon 137 (switch-back: Section 9).
    "CHAIN_ID": "11155111",
    "RPC_URL": "https://rpc.sepolia.org",

    "TOKEN_ADDRESS_USDT": "0x<SEPOLIA_USDT_ADDRESS>",
    "TOKEN_ADDRESS_BTC": "0x<SEPOLIA_BTC_ADDRESS>",
    "TOKEN_ADDRESS_ETH": "0x<SEPOLIA_ETH_ADDRESS>",
    "TOKEN_ADDRESS_TRX": "0x<SEPOLIA_TRX_ADDRESS>",
    "TOKEN_ADDRESS_SOL": "0x<SEPOLIA_SOL_ADDRESS>",
```

**Kuch aur change NAHI karna:**
- `TOKEN_ADDRESS` / `FAUCET_ADDRESS` (legacy) — khali hi rehne do (`tokenConfigured: false` health me normal hai)
- `GASLESS_MODE: "auto"` — same rahega (MINTER_PRIVATE_KEY set hone pe khud `server-sponsored` mode me chala jayega)
- `ALLOW_DRY_RUN: "true"` — test ke liye theek hai (fallback safety)
- `EXPLORER_URL` var set karne ki zaroorat nahi — `CHAIN_ID` se auto `https://sepolia.etherscan.io` resolve hota hai
- **KV namespace** — Sepolia test ke liye **bind mat karo** (memory storage kaafi hai, aur test balances production KV me mix bhi nahi hongi). Mainnet me `MAINNET-DEPLOY-CHECKLIST.md` Section 4.4 follow karna.
- `CORS_ORIGINS`, limits, `SITE_*` — untouched

---

## 5️⃣ Step 5 — Minter wallet setup + Worker SECRETS

### 5.1 — Minter wallet me Sepolia ETH bhejo (ZAROORI real mint ke liye)

- **Haan, minter wallet me thora Sepolia ETH chahiye** — har withdrawal mint (~70k gas) **minter wallet** pay karta hai (server-sponsored mode).
- **Kitna:** ~**0.005–0.01 Sepolia ETH** kaafi hai hazaron test mints ke liye.
- **Kahan se:** MetaMask se apne **deployer** (0.124 ETH hai) se minter address pe 0.01 bhej do, YA faucet pe minter address se bhi ETH le lo:
  - https://cloud.google.com/application/web3/faucet/ethereum/sepolia (Google login, free)
  - https://sepolia-faucet.pk910.de (PoW faucet, no signup)

### 5.2 — Wrangler login check (ek baar)

```powershell
cd e:\Flush Coin
npx wrangler whoami
```

- Agar account email dikhaye → logged in ho, aage badho.
- Agar "not authenticated" bole → `npx wrangler login` chalao (browser khulega → Cloudflare pe **Allow** karo). **← MANUAL STEP**

### 5.3 — Secrets check + set

```powershell
cd e:\Flush Coin
npx wrangler secret list
```

**A) `MINTER_PRIVATE_KEY` — TEST KE LIYE ABHI SET KARO** (yahi real mint enable karta hai):

```powershell
npx wrangler secret put MINTER_PRIVATE_KEY
# prompt pe paste karo: BACKEND_MINTER_ADDRESS wali wallet ka private key (0x se shuru)
```

> Agar yeh skip kiya toh withdrawals **SIMULATED** book hongi (flow test hota hai, par MetaMask me real Flash USDT NAHI dikhega). Kyunki aapka goal "MetaMask me Flash USDT dikhna" hai → **abhi set karo**.
> Mainnet switch ke waqt is secret ko **naye mainnet minter key se dobara put** karna hoga (Section 9).

**B) `SESSION_SECRET`** — agar `secret list` me NAHI dikha:

```powershell
# random 64-char string generate karo (output copy karo):
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })

npx wrangler secret put SESSION_SECRET
# paste karo upar wala random string
```

---

## 6️⃣ Step 6 — Worker REDEPLOY (vars + secrets load honge)

```powershell
cd e:\Flush Coin
npx wrangler deploy --config wrangler.jsonc
```

> ⚠️ **Order matter karta hai:** pehle Step 4 (vars) + Step 5 (secrets) → **phir** yeh deploy. Deploy ke baad hi naye values live hoti hain.

---

## 7️⃣ Step 7 — Frontend BUILD + PAGES DEPLOY (naye `.env` values ke saath)

```powershell
cd e:\Flush Coin
npm run build
npx wrangler pages deploy dist --project-name fluxcoin
```

- Build **local** hota hai — root `.env` ki values `dist/` bundle me bake ho jati hain (Cloudflare dashboard me kuch set nahi karna).
- Deploy ke baad site pe jaake **Ctrl+Shift+R** (hard refresh) zaroor karo — warna purana cached build chalega.

## 8️⃣ Step 8 — VERIFICATION (Sepolia)

### 8.1 — Sepolia Etherscan pe contracts check karo

Har address kholo: **`https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>`**

| Kya check karna | Kya dikhna chahiye |
|----------------|--------------------|
| Contract Creator | Aapka deployer: `0x2DA543190bEFE31c2183c1ba286362A9eDE208B5` |
| Tx list | 2 transactions: contract creation + `grantRole` |
| Token Tracker (verify ke baad) | Symbol USDT/BTC/... + correct decimals |

**Minter role confirm:** contract page → **"Logs"** tab → `RoleGranted` event → `account` = aapka minter address ✓

**(Optional) Source code verify** (name readable banane ke liye — root `.env` me `ETHERSCAN_API_KEY` chahiye, free: https://etherscan.io/myapikey):

```powershell
cd e:\Flush Coin\contracts
npx hardhat verify --network sepolia 0x<USDT_ADDRESS> "Flash USDT" USDT 6 0x<ADMIN_ADDRESS> 0 1000000000
npx hardhat verify --network sepolia 0x<BTC_ADDRESS>  "Flash Bitcoin" BTC 8 0x<ADMIN_ADDRESS> 0 21000000
npx hardhat verify --network sepolia 0x<ETH_ADDRESS> "Flash Ethereum" ETH 18 0x<ADMIN_ADDRESS> 0 120000000
npx hardhat verify --network sepolia 0x<TRX_ADDRESS> "Flash TRX" TRX 6 0x<ADMIN_ADDRESS> 0 1000000000
npx hardhat verify --network sepolia 0x<SOL_ADDRESS> "Flash Solana" SOL 9 0x<ADMIN_ADDRESS> 0 1000000000
```

### 8.2 — `/api/health` expected output (Sepolia pe)

Browser me kholo: **https://fluxcoin.codexstechnology.workers.dev/api/health**

```json
{
  "ok": true,
  "service": "fluxcoin-api",
  "status": "online",
  "network": {
    "chainId": 11155111,
    "explorer": "https://sepolia.etherscan.io",
    "tokenConfigured": false,
    "assets": [
      { "id": "usdt", "name": "Flash USDT", "symbol": "USDT", "decimals": 6, "address": "0x…", "configured": true },
      { "id": "btc",  "name": "Flash Bitcoin", "symbol": "BTC", "decimals": 8, "address": "0x…", "configured": true },
      { "id": "eth",  "name": "Flash Ethereum", "symbol": "ETH", "decimals": 18, "address": "0x…", "configured": true },
      { "id": "trx",  "name": "Flash TRX", "symbol": "TRX", "decimals": 6, "address": "0x…", "configured": true },
      { "id": "sol",  "name": "Flash Solana", "symbol": "SOL", "decimals": 9, "address": "0x…", "configured": true }
    ],
    "assetsConfigured": 5
  },
  "storage": "memory",
  "gasless": { "mode": "server-sponsored", "userGasCost": "0" },
  "warnings": [ "FLUXCOIN_KV is not bound: balances live in isolate memory and reset on cold start" ]
}
```

**Green flags (Sepolia test):** `chainId: 11155111` ✓ `assetsConfigured: 5` ✓ sab assets `configured: true` ✓ `gasless.mode: "server-sponsored"` ✓

**Normal (fail nahi hain):** `tokenConfigured: false` (legacy single-token var khali hai) ✓ `storage: "memory"` (KV test me bind nahi kiya) ✓ KV wali warning ✓

**Red flags (fix karo):** `assetsConfigured: 0` → Step 4 vars nahi bhare YA worker redeploy nahi hua (Step 6) • `mode: "dry-run"` → `MINTER_PRIVATE_KEY` secret missing (Step 5) • `chainId: 137` → wrangler.jsonc change ke baad deploy nahi hua

### 8.3 — End-to-End test flow (website → wallet → generate → withdraw → MetaMask)

1. **https://fluxcoin.pages.dev** kholo → **Ctrl+Shift+R** (hard refresh)
2. MetaMask me **Sepolia Testnet** network select karo (already added hai)
3. **Connect wallet** karo → network dropdown me Sepolia hi rehne do
4. **USDT** preset select karo → quantity (e.g. `100`) → **GENERATE** → MetaMask me 1 free login signature aayegi (gas nahi lagta)
5. **Withdraw** tab → amount (e.g. `10`) → **WITHDRAW** → result me **`status: SETTLED` + `txHash`** aana chahiye (agar `SIMULATED` aaye toh Section 8.2 ke red flags dekho)
6. txHash ka link kholo (`sepolia.etherscan.io/tx/…`) → **"To" = USDT contract address** ho, function **`mint`** ho, log me **`BackendMint`** event ho ✓
7. Success ke baad app khud MetaMask me token **import popup** deta hai; nahi dikhe to **"IMPORT FLASH TOKENS"** button dabao → **Flash USDT balance** MetaMask me dikhna chahiye (wallet Sepolia pe hi khula ho)
8. **BTC** preset ke saath repeat karo → alag contract address se mint hona chahiye

## 9️⃣ Step 9 — CLEAN SWITCH PLAN: Sepolia → Mainnet (Polygon 137)

> 🎯 **Yeh section follow karo jab mainnet deploy karo** — isse pehle `MAINNET-DEPLOY-CHECKLIST.md` bhi padh lo (wallet funding/POL wali details wahan hain). Neeche sirf **exactly kya reset karna hai** ka list hai — yahi file follow karo, kuch miss nahi hoga.

### 9.1 — Config reset table (EXACT variables)

| # | File | Variable | Sepolia test value ❌ hatao | Mainnet value ✅ lagao |
|---|------|----------|------------------------------|------------------------|
| 1 | `.env` | `VITE_NETWORK_ID` | `11155111` | `137` |
| 2 | `.env` | `VITE_TOKEN_ADDRESS_USDT` | Sepolia addr | **Mainnet** USDT addr |
| 3 | `.env` | `VITE_TOKEN_ADDRESS_BTC` | Sepolia addr | Mainnet BTC addr |
| 4 | `.env` | `VITE_TOKEN_ADDRESS_ETH` | Sepolia addr | Mainnet ETH addr |
| 5 | `.env` | `VITE_TOKEN_ADDRESS_TRX` | Sepolia addr | Mainnet TRX addr |
| 6 | `.env` | `VITE_TOKEN_ADDRESS_SOL` | Sepolia addr | Mainnet SOL addr |
| 7 | `wrangler.jsonc` | `CHAIN_ID` | `"11155111"` | `"137"` |
| 8 | `wrangler.jsonc` | `RPC_URL` | `"https://rpc.sepolia.org"` | `"https://polygon-rpc.com"` |
| 9 | `wrangler.jsonc` | `TOKEN_ADDRESS_USDT` | Sepolia addr | Mainnet USDT addr |
| 10 | `wrangler.jsonc` | `TOKEN_ADDRESS_BTC` | Sepolia addr | Mainnet BTC addr |
| 11 | `wrangler.jsonc` | `TOKEN_ADDRESS_ETH` | Sepolia addr | Mainnet ETH addr |
| 12 | `wrangler.jsonc` | `TOKEN_ADDRESS_TRX` | Sepolia addr | Mainnet TRX addr |
| 13 | `wrangler.jsonc` | `TOKEN_ADDRESS_SOL` | Sepolia addr | Mainnet SOL addr |
| 14 | Worker secret | `MINTER_PRIVATE_KEY` | Sepolia test minter key | **Mainnet minter key** (dobara `npx wrangler secret put MINTER_PRIVATE_KEY`) |

**Jo CHANGE NAHI hote (mix hone ka darr nahi):**
- `.env`: `RPC_URL_*`, `VITE_API_URL`, `VITE_RPC_*` (dono chains ke values already rakhe hain)
- `wrangler.jsonc`: `CORS_ORIGINS`, `GASLESS_MODE`, `ALLOW_DRY_RUN`, limits, `SITE_*`, `TOKEN_ADDRESS`/`FAUCET_ADDRESS` (legacy khali)
- Worker secret: `SESSION_SECRET` (same rehta hai, dobara set NAHI karna)
- Sepolia pe deployed 5 contracts — khatam nahi hote, bas ab use nahi honge (koi action nahi)

### 9.2 — Mainnet switch ORDER (step-by-step)

```powershell
# (Optional) Sepolia manifest ka backup rakhna ho toh AB deploy se PEHLE:
#   Copy-Item "e:\Flush Coin\.env.flash-assets.json" "e:\Flush Coin\.env.flash-assets.sepolia.json"

# 1. Mainnet contracts deploy (deployer wallet me 3+ POL chahiye):
cd e:\Flush Coin\contracts
npm run deploy:flash:polygon
# -> naye Polygon addresses console + .env.flash-assets.json me (Sepolia wale OVERWRITE ho jayenge)

# 2. Section 9.1 ke table ke mutabik .env + wrangler.jsonc me naye Polygon addresses paste karo

# 3. Mainnet minter key Worker secret me daalo (Sepolia wali replace ho jayegi):
cd e:\Flush Coin
npx wrangler secret put MINTER_PRIVATE_KEY
# (mainnet minter wallet ka key — jisme POL funded hai)

# 4. Worker redeploy:
npx wrangler deploy --config wrangler.jsonc

# 5. Frontend build + pages deploy:
npm run build
npx wrangler pages deploy dist --project-name fluxcoin

# 6. Verify: /api/health me chainId: 137 + assetsConfigured: 5 + mode: server-sponsored
#    + MAINNET-DEPLOY-CHECKLIST.md Section 5 (Polygonscan + E2E + ALLOW_DRY_RUN=false)
```

### 9.3 — Final safety check (mainnet ke baad)

- `/api/health` → `"chainId": 137` (11155111 NAHI) ✓
- `warnings` me `dry-run` wali line NAHI ✓
- Withdraw test → `status: SETTLED` + txHash `polygonscan.com/tx/…` pe ✓
- MetaMask wallet **Polygon PoS** pe ho, tabhi Flash tokens dikhenge ✓

---

## 🔧 Common Problems (Sepolia test)

| Problem | Fix |
|---------|-----|
| `insufficient funds for gas` (deploy ke waqt) | Deployer me Sepolia ETH kam hai — faucet se top-up, phir `npm run deploy:flash:sepolia` |
| Deploy ne `NOTE: you deployed to chainId 11155111` bola | **Normal hai** — yeh Sepolia test hai, mainnet nahi |
| Health me `assetsConfigured: 0` | `wrangler.jsonc` me `TOKEN_ADDRESS_*` nahi bhare, YA Step 6 worker redeploy nahi hua |
| Health me `mode: "dry-run"` | `MINTER_PRIVATE_KEY` secret missing — Step 5.3-A |
| Withdrawals `SIMULATED` aa rahi hain | `MINTER_PRIVATE_KEY` missing YA `TOKEN_ADDRESS_*` khali YA worker redeploy pending |
| Withdraw me `SPONSORED_SETTLEMENT_FAILED` | **Minter wallet me Sepolia ETH nahi** — Step 5.1 |
| Frontend me "USDT contract address is not set" | `.env` bharne ke BAAD Step 7 (build + pages deploy) nahi hua, YA browser cache — **Ctrl+Shift+R** |
| Balances refresh pe reset | KV bound nahi — **test ke liye normal hai** (mainnet me KV banana hai) |
| Sepolia RPC errors / timeouts | `rpc.sepolia.org` rate-limit ho sakta hai — thoda ruk ke retry, ya `RPC_URL_SEPOLIA`/`RPC_URL` me `https://ethereum-sepolia-rpc.publicnode.com` try karo |

---

## 📌 Quick answers (user ke sawaal)

1. **Deploy command:** `cd e:\Flush Coin\contracts` → `npm install` → `npm run deploy:flash:sepolia` ✓
2. **5 addresses:** console output + `e:\Flush Coin\.env.flash-assets.json` ✓
3. **Minter wallet me Sepolia ETH chahiye?** — **HAAN**, ~0.005–0.01 ETH (mint gas minter deta hai). `MINTER_PRIVATE_KEY` secret **abhi (test ke liye)** set karo — warna withdrawals SIMULATED rahengi. Mainnet pe naye minter key se dobara `secret put` hoga (Section 9.1 #14).
4. **Manual steps kahan:** Step 0 (agar `.env` khali), Step 5.1 (MetaMask se ETH bhejna), Step 5.2 (`wrangler login` agar pehli baar), Step 5.3 (secrets paste), Step 8 (browser testing) ✓

---

*Last updated: 2026-09-29 • Repo: codexs-technology/fluxcoin • Production guide: `MAINNET-DEPLOY-CHECKLIST.md` • Detail: `DEPLOYMENT.md`*



