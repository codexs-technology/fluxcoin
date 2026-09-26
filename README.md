# TokenForge 3D - Token Generation & Settlement Terminal

An interactive 3D simulation of a token generation & settlement terminal designed with a dark, futuristic cyberpunk aesthetic.

## Visual & Architecture Highlights

- **Visual Design**: Dark-themed terminal aesthetic with glowing cyan (`#00f0ff`) and emerald green (`#00ff88`) neon accents, scanline overlays, cyber borders, and monospace telemetry typography (`JetBrains Mono`).
- **Interactive 3D Engine**: Built with Three.js rendering a dynamic 3D token coin with beveled metallic rings, particle field, and standard/wireframe toggle controls.
- **Client-Side Simulation**: Zero external API dependencies or real blockchain vulnerabilities; includes synthesized sound effects (synthesizer Web Audio API) and confetti particle cascades.

## Key Features

### 1. Left Panel (Configuration Matrix)
- **Token Selection**: USDT (ERC-20), Ethereum (Native), Bitcoin Wrapped (BRC-20) with custom token name override.
- **Fee Tiers**: Retail ($50), Pro ($250), and Institutional ($12,000) with dynamic network gas scaling.
- **Wallet Connection Simulation**: Supports MetaMask, Trust Wallet, Binance Wallet, WalletConnect, Coinbase, and Phantom with ECDSA public key generation.

### 2. Center Panel (Synthesizer // Forge Pipeline)
- **3D Token Visualizer**: Live Three.js canvas featuring floating rotating token mesh and particle field.
- **Allocation & Mint Inputs**: Adjustable mint quantity with quick preset buttons (+1k, +10k, +100k, +1M).
- **Dynamic Fee Calculator**: Computes activation fees factoring in selected tier, volume, and simulated network gas pressure.
- **Simulated Forge Sequence**: Multi-stage forging animation with progress bar, audio feedback, confetti, and cryptographic TX receipt generation.

### 3. Right Panel (Network Telemetry & Terminal)
- **Real-Time Telemetry Dashboard**: Live fluctuating metrics for Hash Rate (TH/s), Mempool Load (tx), Throughput (TPS), Peer Mesh (peers), Gas Pressure (gwei), Current Block #, and Settlement Status.
- **Live Terminal Output**: Monospace boot sequence, logging each stage of wallet authentication, token forging, and block sealing with auto-scrolling STDOUT.
- **Critical Protocol Notice**: Explicit safety disclaimer warning users that no real blockchain is touched.

### 4. Bottom Section (Disperse Pipeline & Audit Trail)
- **Withdrawal Queue**: Live queue with ETA countdowns, destination hashes, and verification statuses.
- **Operation Ledger Table**: Immutable audit trail displaying Time, Operation, Asset, Value, Fee, TX Hash, and Confirmed status.

## Development & Build

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Build production bundle
npm run build
```
