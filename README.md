# FluxCoin (FLUX) — wallet connection + zero-fee withdrawal platform

FluxCoin is a coin-generating ("faucet/forge") site whose earned coins are backed by a real ERC-20
token: users connect a real wallet, earn coins into an on-site balance, and **withdraw them on-chain
as FLUX ERC-20 with zero gas cost for the user** (ERC-2771 Gelato Relay, ERC-4337 Paymaster, or a
backend-sponsored mint).

```
frontend (Vite + React)       api (Express)                  contracts (Hardhat + Solidity)
───────────────────────       ───────────────────────        ──────────────────────────────
wallet/   connection layer    auth/nonce + SIWE verify       FluxCoin.sol    ERC-20, 18 decimals
api/      balance+withdraw    ledger (earned balance)        FluxFaucet.sol  backend-signed claims
contracts/ addresses + ABI    gasless sponsorship proxy      scripts/ deploy, grantMinter, addLiquidity
```

---

## 1. Audit — why wallets connected "randomly" (and what was fixed)

Five separate defects combined to make connections look random:

| # | File (before) | Defect | Consequence |
|---|---|---|---|
| 1 | `src/hooks/useWallet.js` | When `window.ethereum` was missing it generated a **fake address with `Math.random()`**, stored it as `connectedWallet` and showed a fake `1.25 ETH` balance | A *different random address* appeared on every click/refresh |
| 2 | `src/utils/walletConnection.js` | `connectRealWallet()` **always** read `window.ethereum`, ignoring which button was clicked | With several extensions installed, `window.ethereum` is whichever one won the injection race → clicking "Coinbase" connected MetaMask |
| 3 | `src/components/WalletConnect.jsx` + `src/utils/mockData.js` | The picker listed **6 hardcoded wallets** (`walletProviders`) and passed only a *name* to one connect function; the modal said "Simulated connection" | No installed-wallet detection; the connected wallet had nothing to do with the clicked one |
| 4 | `src/utils/walletConnection.js` | `DEFAULT_TOKEN_ADDRESS` fell back to **`0x6B1754…` (mainnet DAI)** | "FLUX" transfers/mints targeted an unrelated real token when `VITE_TOKEN_ADDRESS` was unset |
| 5 | `src/store/useAppStore.js`, `TokenTransfer.jsx`, `TokenSwap.jsx`, `useToken.js` | Fabricated **random tx hashes**, random withdrawal destinations, and a `* 0.995` "simulated quote" whenever a call failed | The ledger showed on-chain activity that never happened |

**Root cause in one sentence:** the app never asked the *selected* wallet for its address — it asked
`window.ethereum` (or invented an address), so the displayed identity was decided by whichever
injected provider happened to be first, or by `Math.random()`.

### What replaced it

* `src/wallet/eip6963.js` — EIP-6963 multi-provider discovery: each installed extension announces
  itself, so the picker lists **only installed wallets**, each with the exact `provider` to call.
* `src/wallet/manager.js` — `WalletManager` singleton, the **single source of truth**. The address
  always comes from `eth_requestAccounts` / `eth_accounts` on the *chosen* provider. No fallback, no
  mock address, no `Math.random()` in the wallet layer.
* `src/wallet/appkit.js` — Reown AppKit (WalletConnect v2) branded universal modal.
* `src/wallet/walletConnectEngine.js` — raw WC v2 provider for the in-app **live QR** + deep links.
* `src/wallet/session.js` + `manager.restore()` — session persistence + silent reconnection on reload.
* `src/wallet/token.js`, `src/wallet/dex.js`, `src/contracts/*` — real ERC-20/DEX calls replacing the
  fabricated hashes and quotes.

---

## 2. Quick start

```bash
# 1. frontend
npm install
Copy-Item .env.example .env        # then set VITE_WALLETCONNECT_PROJECT_ID (see §4)

# 2. backend (separate terminal)
cd api
npm install
Copy-Item .env.example .env        # keeps ALLOW_DRY_RUN=true so you can test without funds
npm run dev                        # http://localhost:8787

# 3. contracts (only needed for real on-chain FLUX)
cd ../contracts
npm install
npx hardhat test                   # Solidity test suite (no deployment)
npx hardhat run scripts/deploy.js --network sepolia
```

Then run `npm run dev` in the repository root and open <http://localhost:5173>.

---

## 3. Architecture / folder structure

```
src/
  wallet/                  ← wallet connection layer (no UI)
    manager.js             WalletManager singleton: connect / switch chain / events / restore
    eip6963.js             installed-extension discovery (MetaMask, Phantom, Trust, Coinbase …)
    appkit.js              Reown AppKit (WalletConnect v2) modal
    walletConnectEngine.js WC v2 provider: pairing URI, live QR payload, deep links, session restore
    gasless.js             client half of the zero-fee withdrawal (userOp / meta-transaction)
    token.js               ERC-20 reads + signed transfers (real provider, never window.ethereum)
    dex.js                 router quotes / approvals / swaps (Uniswap V2 compatible)
    chains.js              supported networks, RPC + explorer URLs (VITE_RPC_* overridable)
    session.js             localStorage session (address + connector + chain)
    format.js              address truncation (0xAb3…9F2), amount helpers
    actions.js, index.js   barrel exports used by the UI
  contracts/
    addresses.js           deployed token/faucet/router addresses from VITE_* (no placeholders)
    abis.js                ERC-20 + FluxFaucet + Uniswap V2 router ABIs
  api/client.js            frontend API client (SIWE session, balance, earn, withdraw, paymaster proxy)
  hooks/
    useWallet.js           React binding for the wallet manager (connection state + actions)
    useCoinBalance.js      site balance ↔ on-chain FLUX balance, earn(), withdraw()
    useToken.js            ERC-20 balance/transfer/burn bound to the connected wallet
  components/
    WalletConnect.jsx      connect panel + installed-wallet picker + chain switch + disconnect
    WalletQrModal.jsx      live WalletConnect QR + deep links
    CoinBalance.jsx        earned vs on-chain balance, sign-in, gasless mode
    WithdrawPanel.jsx      withdrawal form (0 gas, server-validated), progress + explorer link
    ForgeSequence.jsx      "generate coins" → POST /api/earn (site balance)
    OperationLedger.jsx    real audit trail (API ledger + real receipts)
api/
  src/routes/              auth (nonce/verify), balance, earn, withdraw (+config/history/paymaster)
  src/services/            ledger, session (SIWE), withdrawal, chain, gelato, paymaster
  scripts/flow-test.mjs    end-to-end backend test: auth → earn → withdraw → balance
contracts/
  src/FluxCoin.sol         standard ERC-20 (18 decimals) + role-gated minting
  src/FluxFaucet.sol       EIP-712 backend-authorized claims (ERC-2771 aware)
  scripts/deploy.js        deploys both, grants MINTER_ROLE, prints the .env values
  scripts/grantMinter.js   grants MINTER_ROLE to the API hot wallet
  scripts/addLiquidity.js  seeds a FLUX/native Uniswap-V2/Pancake pool
  test/FluxFaucet.test.js  Solidity test suite (claim auth, caps, replay protection)
```

---

## 4. Environment variables (where every key goes)

### 4.1 Repository root `.env` → `VITE_*` (frontend)

| Variable | Purpose |
|---|---|
| `VITE_WALLETCONNECT_PROJECT_ID` | **Reown/WalletConnect project id** — required for the QR modal and AppKit. Free at <https://dashboard.reown.com>. Without it, extension wallets still work and the UI shows exactly which variable is missing. |
| `VITE_API_URL` | Backend base URL (default `http://localhost:8787`). |
| `VITE_NETWORK_ID` | Chain the contracts live on (11155111 Sepolia, 1 Ethereum, 56 BSC, 137 Polygon). |
| `VITE_TOKEN_ADDRESS`, `VITE_FAUCET_ADDRESS` | Printed by `contracts/scripts/deploy.js`. Left empty → the UI says "not configured" instead of using a wrong token. |
| `VITE_ROUTER_ADDRESS` | Optional DEX router override (defaults per chain in `src/contracts/addresses.js`). |
| `VITE_RPC_*` | RPC endpoints for read-only calls and metadata. |
| `VITE_BICONOMY_BUNDLER_URL` | Optional: bundler URL for the client-side ERC-4337 path (the **paymaster** URL stays server-side). |
| `DEPLOYER_PRIVATE_KEY`, `BACKEND_MINTER_ADDRESS`, `TOKEN_ADMIN_ADDRESS` | Hardhat deployment only. |

### 4.2 `api/.env` (backend) — ★ this is where the Paymaster/Relayer keys live

| Variable | Purpose |
|---|---|
| `MINTER_PRIVATE_KEY` | Hot wallet with `MINTER_ROLE`; mints FLUX **and pays the gas** in `GASLESS_MODE=server`. |
| `BACKEND_SIGNER_PRIVATE_KEY` | Holds `SIGNER_ROLE` on `FluxFaucet`; signs the EIP-712 withdrawal authorizations. |
| `GASLESS_MODE` | `server` \| `gelato` \| `biconomy` (see §7). |
| `GELATO_RELAY_API_KEY` | **★★★ your Gelato 1Balance/Relay key** (<https://app.gelato.network>). Used when `GASLESS_MODE=gelato`. |
| `BICONOMY_PAYMASTER_API_KEY`, `BICONOMY_PAYMASTER_URL` | **★★★ your Biconomy Paymaster credentials** (<https://dashboard.biconomy.io>). Used when `GASLESS_MODE=biconomy`; the API proxies sponsorship so the key never reaches the browser. |
| `BICONOMY_BUNDLER_URL` | Bundler endpoint for that mode. |
| `TOKEN_ADDRESS`, `FAUCET_ADDRESS`, `RPC_URL`, `CHAIN_ID` | Chain wiring (same values as the deploy output). |
| `SESSION_SECRET` | HMAC secret for the signed session token (≥16 chars in production). |
| `ALLOW_DRY_RUN` | `true` validates and records withdrawals without broadcasting — ideal for local testing. |
| `EARN_*` / `WITHDRAW_*` | Server-side limits: per-claim min/max, cooldown, per-day caps. |

**Never** put a Paymaster/Relayer key or a private key in a `VITE_*` variable: everything prefixed
`VITE_` is shipped to the browser.

---

## 5. Wallet connection (the three supported methods)

| Method | How it works | Files |
|---|---|---|
| **1. Browser extension** | Wallets announce themselves via EIP-6963 (`eip6963:announceProvider`). The picker renders only the ones that are installed, each with its own provider object. Connecting calls `eth_requestAccounts` **on that provider** and stores the returned address. | `src/wallet/eip6963.js`, `manager.connectInjected()`, `WalletConnect.jsx` |
| **2. QR code (mobile)** | "WalletConnect v2 — scan QR code" creates a WC v2 pairing, exposes the live `display_uri`, renders it as a QR image inside our own modal and lists deep links for phones. Approving in the wallet resolves the session and the real address appears. | `src/wallet/walletConnectEngine.js`, `WalletQrModal.jsx` |
| **3. Deep link / AppKit modal** | On mobile the QR modal offers "Open directly in MetaMask/Trust/Rainbow/Phantom/Coinbase". The "Reown AppKit" button opens the branded wallet list which handles deep links itself. | `src/wallet/appkit.js`, `WalletQrModal.jsx` |

Behaviour that is implemented after connecting:

* **Real truncated address** in the panel and the header (`0xAb3…9F2`) — `format.truncateAddress()`, with copy + explorer links.
* **Session persistence** — `wallet/session.js` stores `{address, chainId, connectorType, connectorId}`; `manager.restore()` re-validates it on reload (`eth_accounts` for injected, `enable()` for WalletConnect, `getAccount()` for AppKit) so a refresh keeps the connection without a new prompt.
* **Account changes** — `accountsChanged` re-reads the address, re-persists the session and refreshes the balance; an empty array disconnects.
* **Chain changes** — `chainChanged` updates `chainId`/network name and refreshes balances; the panel also has a chain `<select>` that calls `wallet_switchEthereumChain` (adding the chain when the wallet does not know it).
* **Disconnect** — resets the manager state, closes WC/AppKit sessions, clears the stored session and the API session token.
* **No silent fallback** — connecting a wallet that is not installed throws (and the UI shows the download links) instead of connecting something else.

### Manual test checklist (frontend)

1. `npm run dev` (root) with the API running → open <http://localhost:5173>.
2. Click **CONNECT WEB3 WALLET** → the picker lists your installed extensions only (install one to see it appear).
3. Connect MetaMask → the panel shows MetaMask, the truncated address, the network and the native balance; click COPY and the explorer link.
4. Reload the page → the wallet reconnects silently (no fake address flashes).
5. Switch the account in the extension → the address in the panel changes immediately.
6. Switch the network in the extension → the network label changes and balances refresh.
7. Click "WalletConnect v2 — scan QR code" → a QR appears (needs `VITE_WALLETCONNECT_PROJECT_ID`); scan with a phone wallet → the session connects.
8. Click DISCONNECT → the panel returns to the connect button and `localStorage['fluxcoin.wallet.session.v2']` is gone.

---

## 6. The token contract + how the withdrawal flow works

### 6.1 Contract

`contracts/src/FluxCoin.sol` — a **standard ERC-20** (`name`, `symbol`, `decimals = 18`, `totalSupply`,
`balanceOf`, `allowance`, `approve`, `transfer`, `transferFrom`, events) plus:

* `mint(to, amount)` — `MINTER_ROLE` only (held by the Faucet and the API hot wallet);
* an immutable `MAX_SUPPLY` cap, `burn()`/`burnFrom()`;
* **no transfer fee, no rebasing, no blacklist** — required for DEX/CEX listing (a hidden fee breaks
  router quotes and exchange accounting, which is what the old `FlashToken.sol` did with its 0.05% fee).

`contracts/src/FluxFaucet.sol` is the bridge between the site ledger and the token: it mints only when
it receives a valid **EIP-712 `Withdrawal` authorization signed by the backend** (SIGNER_ROLE), and it
consumes a per-user nonce (replay protection), enforces a per-claim cap and a deadline. That is what
makes "never more than the site balance" enforceable *on-chain* as well.

### 6.2 Deploy

```bash
cd contracts
npx hardhat test                                   # 11 tests: ERC-20 surface, caps, replay, ERC-2771
npx hardhat run scripts/deploy.js --network sepolia
```

The script deploys `FluxCoin` + `FluxFaucet`, grants `MINTER_ROLE` to the Faucet and to
`BACKEND_MINTER_ADDRESS`, writes `.env.contracts.json`, and prints the values to paste into `.env`:

```
VITE_TOKEN_ADDRESS=0x…
VITE_FAUCET_ADDRESS=0x…
VITE_NETWORK_ID=11155111
TOKEN_ADDRESS=0x…        # api/.env
FAUCET_ADDRESS=0x…       # api/.env
CHAIN_ID=11155111
```

### 6.3 Withdrawal flow (end to end)

```
 user clicks "WITHDRAW"           backend (api/)                     chain
 ──────────────────────           ──────────────                     ─────
 POST /api/withdraw {amount}  →   1. requires a signed session
                                 2. validateWithdrawal():
                                    - address is the session address
                                    - amount ≥ min, ≤ max, ≤ DAILY cap
                                    - amount ≤ SITE BALANCE  ← hard rule
                                 3. reserve the balance
                                 4. mint/relay per GASLESS_MODE  →   mint FLUX to the user
                                 5. settle the reservation (tx hash)
 GET /api/balance             ←   site balance (available/withdrawn)  + on-chain balanceOf()
```

* `api/src/services/withdrawal.js → validateWithdrawal()` refuses
  `INSUFFICIENT_SITE_BALANCE`, `BELOW_MINIMUM`, `ABOVE_MAXIMUM`, `DAILY_CAP_EXCEEDED`, `INVALID_ADDRESS`.
* The frontend checks the same rule again (`useCoinBalance.withdraw`) so the user gets an instant error,
  but the server is the authority.
* Withdrawals always go to **the connected address**: `requireMatchingAddress` rejects a session/address
  mismatch, and the Gelato path additionally checks that `struct.user` (the signed beneficiary) equals
  the session wallet in `/api/withdraw/relayed`.
* After a withdrawal the site balance and the on-chain balance are re-fetched, so the UI reflects the
  debit and the newly minted tokens.

---

## 7. Zero-fee (gasless) withdrawals — three interchangeable routes

`api/src/config.js → gasless.mode` selects the route. In **every** route the user pays `0` gas and the
project pays for it. `GET /api/withdraw/config` tells the frontend which one is active, and the UI shows
it ("GASLESS MODE").

| Mode | Who pays | What the user does | What you must configure |
|---|---|---|---|
| `server` (default) | The API hot wallet (`MINTER_PRIVATE_KEY`, holds `MINTER_ROLE`) | Nothing — no signature, no transaction | `MINTER_PRIVATE_KEY`, `TOKEN_ADDRESS`, `RPC_URL` |
| `gelato` — **ERC-2771 relayer** | Gelato 1Balance sponsored by your project | Signs one FREE EIP-712 meta-transaction (no gas, no tx) | **`GELATO_RELAY_API_KEY`** in `api/.env` + the Faucet deployed with Gelato's trusted forwarder |
| `biconomy` — **ERC-4337** | Your Biconomy Paymaster | Signs one UserOperation with a smart account; the paymaster sponsors it | **`BICONOMY_PAYMASTER_API_KEY` + `BICONOMY_PAYMASTER_URL`** (+ `BICONOMY_BUNDLER_URL`) in `api/.env` |

### Where the Paymaster/Relayer keys go (this is the important bit)

```
api/.env            ← the ONLY place the keys live (server-side, never sent to the browser)
─────────────────────────────────────────────────────────────────────────────────────────
GASLESS_MODE=gelato
GELATO_RELAY_API_KEY=your_key_from_app.gelato.network        ← ★ Gelato 1Balance / Relay API key

# or, for the ERC-4337 route:
GASLESS_MODE=biconomy
BICONOMY_PAYMASTER_API_KEY=your_key_from_dashboard.biconomy.io   ← ★ Paymaster API key
BICONOMY_PAYMASTER_URL=https://paymaster.biconomy.io/api/v2/11155111/<paymasterId>
BICONOMY_BUNDLER_URL=https://bundler.biconomy.io/api/v2/11155111/<bundlerId>
```

* The browser only ever calls `POST /api/withdraw/paymaster/sponsor`; the API attaches the key
  (`api/src/services/paymaster.js`). Keys are **never** exposed via `VITE_*`.
* If `GASLESS_MODE=gelato` but `GELATO_RELAY_API_KEY` is missing, the API logs/fails with an actionable
  message at boot (`validateConfig()`), and `resolveMode()` falls back to `server` (or `dry-run`).
* `ALLOW_DRY_RUN=true` (local default) validates and records the withdrawal without broadcasting, so the
  whole flow — including the site-balance debit — can be tested with no funds at all.

Client-side counterpart: `src/wallet/gasless.js` (`performGaslessWithdrawal`) handles the three shapes:
no signature required (`server`), sign typed data then `POST /api/withdraw/relayed` (`gelato`), or build
and send a UserOperation with the sponsored paymaster data (`biconomy`).

---

## 8. Trade / exchange support

### 8.1 The token is exchange-ready

`FluxCoin` is a plain ERC-20 with **18 decimals**, no transfer fee, no rebasing and no blacklist, so it can
be deposited to exchanges/wallets and traded on any Uniswap-V2-style DEX. The Swap tab in the UI
(`src/components/TokenSwap.jsx`) quotes through the router for real (`getAmountsOut`) and swaps with
slippage protection and an explicit `approve` — the FLUX address and the router come from
`src/contracts/addresses.js` (`VITE_TOKEN_ADDRESS`, `VITE_ROUTER_ADDRESS`, per-chain defaults).

Routers used by default:

| Chain | DEX | Router |
|---|---|---|
| Ethereum / Sepolia | Uniswap V2 | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| BNB Chain / testnet | PancakeSwap V2 | `0x10ED43C718714eb63d5aA57B78B54704E256024E` / `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` |
| Polygon | QuickSwap | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` |

### 8.2 Add liquidity (make FLUX tradable)

The ready-made script approves the router and calls `addLiquidityETH` (FLUX + the chain's native coin):

```bash
cd contracts
# Sepolia example: 100,000 FLUX paired with 0.1 ETH (5% slippage tolerance)
TOKEN_ADDRESS=0x<deployed FluxCoin> \
ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D \
LP_TOKEN_AMOUNT=100000 LP_NATIVE_AMOUNT=0.1 LP_SLIPPAGE_BPS=500 \
npx hardhat run scripts/addLiquidity.js --network sepolia
```

Then keep the LP tokens: the script prints the factory address; look up the pair
(`factory.getPair(FLUX, WETH)`) on the explorer/DEX UI to see the pool.

**PancakeSwap (BSC)** — same script, Pancake router:

```bash
TOKEN_ADDRESS=0x<deployed FluxCoin> ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E \
LP_TOKEN_AMOUNT=100000 LP_NATIVE_AMOUNT=0.5 \
npx hardhat run scripts/addLiquidity.js --network bsc
# or bscTestnet with 0xD99D1c33F9fC3444f8101754aBC46c52416550D1
```

**Without the script** (UI route): open PancakeSwap/Uniswap → *Add Liquidity* → paste the FLUX address →
add `FLUX + BNB/ETH` → approve → supply. The pool address then shows up in the Swap tab ("LP pair").
Make sure the treasury holds a meaningful amount of FLUX (`INITIAL_SUPPLY` is minted to `TOKEN_ADMIN_ADDRESS`).

**Listing on an exchange (CEX)** usually needs: verified source code
(`npx hardhat verify --network sepolia <address> <admin> <initialSupply> <maxSupply>`), a public
liquidity pool, and the standard ERC-20 interface — all satisfied here.

---

## 9. Testing the full flow locally

### 9.1 Backend (no funds needed)

```bash
cd api
npm run test:flow       # 18 assertions: auth → earn → withdrawal validation → gasless withdrawal → balances
```

What it proves: only a signature from the session wallet authenticates, coins are credited with
cooldown/cap enforcement, **a withdrawal larger than the site balance is rejected**, negative amounts are
rejected, a withdrawal to another wallet is rejected, the gasless withdrawal returns a tx hash with
`userGasCost: 0`, and the balance/audit trail reflect the debit.

### 9.2 Contracts

```bash
cd contracts
npx hardhat test                             # 10 passing: ERC-20 surface + claim auth/nonce/cap + ERC-2771 path
npx hardhat run scripts/deploy.js            # dry run on the in-process hardhat network (.env.contracts.json)
```

### 9.3 Frontend

```bash
npm run build           # production build (validates every import)
npm run dev             # then follow the checklist in §5
```

### 9.4 Full end-to-end (real chain, small amounts)

1. Deploy to Sepolia, copy the printed values into `.env` **and** `api/.env`.
2. `cd api && npm run dev`; root `npm run dev`.
3. In the UI: connect MetaMask → **Sign in** (loads the site balance) → *Forge* 1,000 FLUX → *Withdraw*
   a small amount → the panel shows the phase, then the tx hash + explorer link, and both balances update.
4. Re-running the withdrawal with an amount above the remaining site balance must fail with
   "You cannot withdraw more than your earned site balance".

---

## 10. Files created / modified in this task

**Created (frontend)**

| File | Purpose |
|---|---|
| `src/wallet/manager.js` | `WalletManager` singleton — connection state machine, provider events, chain switching, session restore, balance refresh. |
| `src/wallet/eip6963.js` | Installed-extension discovery (EIP-6963 + legacy `window.ethereum.providers` fallback) + Solana detection. |
| `src/wallet/appkit.js` | Reown AppKit init/modal/`subscribeAccount`/disconnect/switch network. |
| `src/wallet/walletConnectEngine.js` | WC v2 provider: pairing URI, deep links, session restore, disconnect. |
| `src/wallet/gasless.js` | Client half of the three gasless withdrawal routes. |
| `src/wallet/token.js` | ERC-20 reads/transfers through the connected provider (never `window.ethereum`). |
| `src/wallet/dex.js` | Router quotes, approvals, FLUX↔native swaps with real slippage. |
| `src/wallet/chains.js` | Networks, RPC/explorer URLs (`VITE_RPC_*` overridable). |
| `src/wallet/session.js` | Wallet session persistence. |
| `src/wallet/format.js` | Address truncation/validation, amount helpers. |
| `src/wallet/actions.js`, `src/wallet/index.js` | Action layer + barrel exports. |
| `src/contracts/addresses.js` | Token/faucet/router addresses from env (no placeholder token). |
| `src/contracts/abis.js` | ERC-20 + FluxFaucet + Uniswap V2 ABIs. |
| `src/api/client.js` | API client: SIWE session, balance, earn, withdraw, paymaster proxy, health. |
| `src/hooks/useCoinBalance.js` | Site↔on-chain balance, sign-in, earn, withdraw with phases. |
| `src/components/WalletQrModal.jsx` | Live WalletConnect QR + deep links. |
| `src/components/CoinBalance.jsx` | Earned vs on-chain FLUX balance, sign-in, gasless mode. |
| `src/components/WithdrawPanel.jsx` | Withdrawal form (0 gas, server-validated) with phase/explorer feedback. |
| `api/**` | Express backend (auth nonce+verify, ledger, earn, withdraw, Gelato/Biconomy services, flow test). |
| `contracts/src/**`, `contracts/test/**`, `contracts/scripts/**`, `contracts/hardhat.config.js` | Token + faucet contracts, tests, deployment and LP scripts. |
| `.env.example` | Documented configuration for every key (frontend + contracts). |

**Modified**

| File | Change |
|---|---|
| `src/App.jsx` | Real address/network in the header; new "02 // WITHDRAW FLUX (0 GAS)" tab; `CoinBalance` replaces the fake fee tiers. |
| `src/store/useAppStore.js` | `connectedWallet` is a projection of the manager; real ledger/withdrawal queue; forge credits via `POST /api/earn` (no random tx hashes/destinations). |
| `src/hooks/useWallet.js` | Rewritten: mirrors the manager, exposes connect/QR/AppKit/chain-switch/disconnect, no `Math.random()` address. |
| `src/hooks/useToken.js` | Rewritten against `wallet/token.js`. |
| `src/components/WalletConnect.jsx` | Rewritten: installed-wallet picker, QR, AppKit, chain switch, copy/explorer, disconnect. |
| `src/components/ForgeSequence.jsx` | Calls the real earn API; zero-fee breakdown; honest labels. |
| `src/components/OperationLedger.jsx` | Real ledger rows + real explorer links; empty states. |
| `src/components/TokenTransfer.jsx` | Real ERC-20 transfer; no mock hash fallback. |
| `src/components/TokenSwap.jsx` | Real quotes/approvals/swaps; reports missing pools instead of inventing prices; shows the LP pair. |
| `src/components/NetworkTelemetry.jsx`, `ProtocolNotice.jsx`, `TokenTrade.jsx` | Labelled demo/cosmetic; notices describe what is actually on-chain. |
| `src/utils/mockData.js` | Removed the hardcoded `walletProviders` and fake fee tiers. |
| `package.json` | Added `@reown/appkit`, `@reown/appkit-adapter-ethers`, `@walletconnect/ethereum-provider`, `qrcode`. |
| `contracts/hardhat.config.js` | `evmVersion: 'cancun'` (OpenZeppelin 5.x uses `mcopy`); pinned `@openzeppelin/contracts@5.6.1`. |
| `contracts/src/FluxFaucet.sol` | Diamond-override fix (`ERC2771Context`, `Context`) for OpenZeppelin 5.x. |
| `contracts/scripts/deploy.js` | Grants `SIGNER_ROLE` to `BACKEND_SIGNER_ADDRESS`; stores it in the manifest. |
| `contracts/test/FluxFaucet.test.js` | Repaired brace structure + grants `SIGNER_ROLE` to the test backend signer. |
| `.gitignore` | Ignores `.env`, `api/.env`, `.env.contracts.json`, artifacts/cache, `*-output.txt`. |

**Removed (fake/hardcoded logic)**

`src/utils/walletConnection.js` (blind `window.ethereum` + DAI placeholder), `src/utils/dexIntegration.js`
(invented quotes), `src/utils/contractABI.js` (ABI of a non-existent `flashMint`), `src/utils/feeCalculator.js`
and `src/components/FeeTiers.jsx` (fabricated fees), `src/contracts/FlashToken.sol` (token with a 0.05%
transfer fee — replaced by the fee-free `contracts/src/FluxCoin.sol`).

---

## 11. Security notes & known limitations

* **The site balance is authoritative.** Coins generated on the site are off-chain ledger entries
  (`api/src/services/ledger.js`). They only become on-chain tokens on withdrawal, always to the address
  that signed the session. A malicious client cannot inflate the amount: `validateWithdrawal()` is
  server-side and the same limit is signed into the EIP-712 authorization.
* **The API hot wallet is a hot wallet.** Fund it with the minimum gas needed; keep `MINTER_PRIVATE_KEY`
  and `BACKEND_SIGNER_PRIVATE_KEY` in `api/.env` only (never `VITE_*`), and rotate them if leaked.
* **Dry-run mode is honest.** With `ALLOW_DRY_RUN=true` nothing is broadcast and the response is flagged
  `simulated: true`; the UI shows "DRY-RUN (no real tx)" instead of pretending it is confirmed.
* **Ledger persistence** is file-based (`api/data/`), which suits a single instance. Use a real database
  before scaling horizontally.
* **Anti-abuse** is limited to per-wallet cooldowns and daily caps; add CAPTCHA/proof-of-work if you need
  stronger faucet protection.
* **Solana wallets** can be connected (Phantom/Solflare are detected), but withdrawals are minted as
  EVM ERC-20 tokens, so an EVM wallet is required for that step (the UI says so).
* **The dashboard gauges** (hash rate, mempool, TPS, peers) are cosmetic and labelled "DEMO GAUGES";
  the orderbook tab is a demo UI. Real data lives in the wallet, balance, ledger and withdraw panels.
* **Transfer/swap cost gas** — only the withdrawal path is sponsored. The UI states this explicitly so
  nobody is surprised by a wallet prompt asking for gas.
