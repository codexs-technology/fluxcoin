# FluxCoin - Flash Token Blockchain Platform

A high-performance Web3 platform for creating, transferring, swapping, and trading **Flash Tokens** with full blockchain smart contract integration.

## Key Features

1. **Smart Contracts (`/src/contracts/FlashToken.sol`)**:
   - Built on ERC-20 with ERC20Permit & Ownable.
   - **Flash Minting**: Authorized flash minting function with protocol event logs.
   - **Protocol Fee Routing**: 0.05% fee automatically deducted and routed on transfers.
   - **Token Burning**: Deflationary `burn` mechanism for supply management.

2. **Real Web3 Wallet Integration (`/src/utils/walletConnection.js`)**:
   - Native integration with `window.ethereum` (MetaMask, Trust Wallet, Coinbase, Binance Wallet, etc.) using `ethers.js` v6.
   - Live network detection (Ethereum Mainnet, Sepolia Testnet, Polygon, BSC) and auto-switching.
   - Dynamic real balance retrieval and transaction broadcast with receipt tracking.

3. **Transfer Engine (`/src/components/TokenTransfer.jsx`)**:
   - Direct on-chain ERC-20 transfer with gas verification and automated ledger auditing.
   - Live Etherscan link generation for confirmed transactions.

4. **DEX Swapping (`/src/components/TokenSwap.jsx` & `/src/utils/dexIntegration.js`)**:
   - Uniswap V2 Router integration (`swapExactTokensForTokens`) for liquidity pools.
   - Real-time quote estimations between FLASH, WETH, and USDT.

5. **Orderbook Trading (`/src/components/TokenTrade.jsx`)**:
   - Limit & Market order execution interface with live order placement.

6. **Interactive 3D Engine & Cyber Aesthetic**:
   - Three.js 3D coin visualizer with beveled edge geometry, wireframe/mesh modes, and ambient particle field.
   - Live telemetry monitors (Hash Rate, Mempool load, TPS, Gas pressure, Block number).

## Environment Variables (.env)

```env
VITE_TOKEN_ADDRESS=0x6B175474E89094C44Da98b954EedeAC495271d0F
VITE_ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
VITE_NETWORK_ID=1
```

## Build & Deployment

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Build production bundle
npm run build
```
