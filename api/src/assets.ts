/**
 * Per-asset Flash token registry (Worker side).
 *
 * The forge mints the asset the user selected, so every asset has its OWN
 * contract: USDT / BTC / ETH / TRX / SOL (on-chain names are the plain tickers,
 * locked — they are immutable after deploy), all
 * deployed from contracts/src/FlashToken.sol to Polygon (chainId 137).
 *
 * The addresses come from Wrangler vars/secrets (`TOKEN_ADDRESS_USDT`, ...).
 * When one is missing that asset still earns + withdraws in dry-run mode, it
 * just cannot settle a real mint until the address + MINTER key are set.
 *
 * KEEP IN SYNC with:
 *   - contracts/scripts/deployFlashAssets.js (the deploy source of truth)
 *   - src/contracts/assets.js (the frontend mirror)
 */

export type AssetId = 'usdt' | 'btc' | 'eth' | 'trx' | 'sol';

export type AssetMeta = {
  id: AssetId;
  /** Contract name — the plain ticker, e.g. "USDT" (immutable after deploy). */
  name: string;
  /** Ticker shown in wallets/UI, e.g. "USDT". */
  symbol: string;
  /** Contract precision (must match the deployed FlashToken). */
  decimals: number;
  /** Wrangler var that holds this asset's contract address. */
  envName: string;
};

export const ASSET_META: Record<AssetId, AssetMeta> = {
  usdt: { id: 'usdt', name: 'USDT', symbol: 'USDT', decimals: 6, envName: 'TOKEN_ADDRESS_USDT' },
  btc: { id: 'btc', name: 'BTC', symbol: 'BTC', decimals: 8, envName: 'TOKEN_ADDRESS_BTC' },
  eth: { id: 'eth', name: 'ETH', symbol: 'ETH', decimals: 18, envName: 'TOKEN_ADDRESS_ETH' },
  trx: { id: 'trx', name: 'TRX', symbol: 'TRX', decimals: 6, envName: 'TOKEN_ADDRESS_TRX' },
  sol: { id: 'sol', name: 'SOL', symbol: 'SOL', decimals: 9, envName: 'TOKEN_ADDRESS_SOL' }
};

export const ASSET_IDS = Object.keys(ASSET_META) as AssetId[];

/** Default asset when the client does not ask for one explicitly. */
export const DEFAULT_ASSET_ID: AssetId = 'usdt';

export type AssetConfig = AssetMeta & {
  /** Checksummed contract address ('' when not configured). */
  address: string;
  /** True when the Worker knows where this asset lives on-chain. */
  configured: boolean;
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Reads the 5 TOKEN_ADDRESS_* vars and validates them (bad values -> dry-run, not a crash). */
export function buildAssets(env: Record<string, unknown>): Record<AssetId, AssetConfig> {
  const assets = {} as Record<AssetId, AssetConfig>;
  for (const meta of Object.values(ASSET_META)) {
    const raw = env[meta.envName];
    const address = typeof raw === 'string' && EVM_ADDRESS_RE.test(raw.trim()) ? raw.trim() : '';
    assets[meta.id] = { ...meta, address, configured: Boolean(address) };
  }
  return assets;
}

export function anyAssetConfigured(assets: Record<AssetId, AssetConfig>): boolean {
  return ASSET_IDS.some((id) => assets[id]?.configured);
}

/** Public JSON summary for /api/health and /api/withdraw/config. */
export function assetSummary(assets: Record<AssetId, AssetConfig>) {
  return ASSET_IDS.map((id) => {
    const asset = assets[id];
    return {
      id,
      name: ASSET_META[id].name,
      symbol: ASSET_META[id].symbol,
      decimals: ASSET_META[id].decimals,
      address: asset?.address || null,
      configured: Boolean(asset?.configured)
    };
  });
}

/**
 * Resolves a client-supplied asset id/symbol to a known AssetId.
 *  - missing/empty -> the default asset ('usdt')
 *  - unknown      -> null (caller answers UNKNOWN_ASSET with the valid list)
 */
export function resolveAssetId(raw: unknown): AssetId | null {
  if (raw === undefined || raw === null) return DEFAULT_ASSET_ID;
  const text = String(raw).trim().toLowerCase();
  if (!text) return DEFAULT_ASSET_ID;
  if (text in ASSET_META) return text as AssetId;
  const bySymbol = ASSET_IDS.find((id) => ASSET_META[id].symbol.toLowerCase() === text);
  return bySymbol || null;
}

/** Decimals for a stored ledger entry (legacy entries have no asset field -> 18). */
export function decimalsForAsset(assetId: string | null | undefined): number {
  if (!assetId) return 18;
  return ASSET_META[assetId as AssetId]?.decimals ?? 18;
}
