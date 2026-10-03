# FluxCoin — coin faucet + zero-fee withdrawal platform

FluxCoin is a coin-generating ("forge") site whose earned coins are backed by real
ERC-20 tokens: users connect a real wallet, earn coins into an **on-site balance**, and
withdraw them on-chain as **USDT / BTC / ETH / TRX / SOL** (the selected preset)
with **0 gas cost for the user** (sponsored ERC-4337 UserOperation, or a project wallet
that mints/transfers and pays the gas).

There are exactly **two deployables** and they must not be mixed up:

| Deployable | What it serves | Cloudflare project | URL |
|---|---|---|---|
| Frontend | the Vite SPA (`dist/`) | **Pages** | `https://fluxcoin.pages.dev` |
| API | JSON under `/api/*` only | **Workers** | `https://fluxcoin.codexstechnology.workers.dev` |

The Worker has **no static assets**: any non-`/api/*` path answers a JSON `404`
(`{"ok":false,"error":"NOT_FOUND", ...}`). The frontend is served by Pages.

---

## Why the site showed "Backend offline" (root causes, all fixed)

1. **Wrong runtime shape.** The Worker at `fluxcoin.codexstechnology.workers.dev` was
   deployed with the *frontend build* attached, so `/api/health` returned the SPA HTML
   instead of JSON. The browser then failed with `Failed to fetch` and the UI reported
   "Backend offline → start it with `npm run dev`".
   → The Worker config now lives at the **repository root** (`wrangler.jsonc`, `name:
   "fluxcoin"`, `main: "api/src/index.ts"`) with **no `assets` binding**, and every
   non-API route is an explicit JSON 404.
2. **No root Wrangler config.** The build uses root directory `/` + `npx wrangler
   deploy`, but the config sat in `api/` and named the Worker `fluxcoin-api` — a
   different hostname. → One config, at the root, named `fluxcoin`.
3. **Broken Worker source.** `api/src/index.ts` contained an unterminated function that
   swallowed the `/api/auth/nonce` route, so the bundle could not even build.
   → Rewritten as small modules (`config.ts`, `store.ts`, `session.ts`, `chain.ts`,
   `withdraw.ts`, `paymaster.ts`, `index.ts`).
4. **Unset API base URL.** `VITE_API_URL` fell back to `''`, so production builds called
   `/api/health` on the Pages origin. → `src/lib/api.js` now owns one base URL with a
   hard fallback to the production Worker, plus `.env.development` /
   `.env.production`.
5. **No CORS preflight on unknown routes.** → CORS middleware now runs on `*` and
   answers `OPTIONS` with `204` and the right headers.
6. **Session never re-hydrated.** → `fluxcoin_session`, `fluxcoin_session_address` and
   `fluxcoin_wallet` are persisted, the wallet session is restored on load
   (`src/wallet/session.js`), and the balance hook opens a session automatically once a
   wallet is connected and the Worker answers `/api/health`.

---

## Repository layout

```
.
├── wrangler.jsonc            # ★ Cloudflare Worker config (root dir `/` + `npx wrangler deploy`)
├── .env                      # shared/Vite env (VITE_* + Hardhat)
├── .env.development          # `npm run dev`      -> http://localhost:8787
├── .env.production           # `vite build`       -> the deployed Worker URL
├── api/                      # the API (Cloudflare Worker, Hono + viem)
│   ├── src/index.ts          #   routes + CORS + JSON 404
│   ├── src/config.ts         #   env -> typed config, limits, gasless mode resolution
│   ├── src/store.ts          #   ledger + KV/in-memory store, rate limits
│   ├── src/session.ts        #   SIWE nonce, signature recovery, HMAC session tokens
│   ├── src/chain.ts          #   on-chain reads + server-sponsored settlement
│   ├── src/withdraw.ts       #   validate -> reserve -> settle -> refund
│   ├── src/paymaster.ts      #   sponsored ERC-4337 UserOperation
│   └── scripts/flow-test.mjs #   end-to-end route test (in-process or --url)
├── src/                      # the frontend (Vite + React 19)
│   ├── lib/api.js            #   ★ single base URL + error classification
│   ├── api/client.js         #   protocol: endpoints, sign-in, session storage
│   ├── hooks/useCoinBalance.js
│   ├── wallet/               #   manager, EIP-6963, WalletConnect, AppKit, gasless
│   └── components/           #   balance, forge, withdraw, ledger, telemetry
└── contracts/                # FluxCoin.sol (ERC-20) + FluxFaucet.sol + Hardhat
```

---

## Quick start (local)

```powershell
# 1. API — Cloudflare Worker in local mode
cd api
npm install
npm run dev            # wrangler dev  ->  http://localhost:8787

# 2. Frontend — separate terminal
cd <repo root>
npm install
npm run dev            # Vite           ->  http://localhost:5173
```

`.env.development` already points the frontend at `http://localhost:8787`, and
`CORS_ORIGINS` in `wrangler.jsonc` allows `http://localhost:5173` and
`http://127.0.0.1:5173`.

Connect a wallet (EIP-6963 extension, WalletConnect QR or Reown AppKit). As soon as the
address is known, the app opens a session, credits coins with **GENERATE**, and
**WITHDRAW** settles them gas-free.
