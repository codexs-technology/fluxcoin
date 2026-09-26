/**
 * EIP-6963 multi-injected-provider discovery.
 *
 * This is the fix for the old "random connect" behaviour: instead of assuming
 * `window.ethereum` is whatever the user clicked, we ask every installed
 * extension to announce itself and connect to the EXACT provider selected.
 * The UI only lists wallets that are really installed.
 */

const ANNOUNCE_EVENT = 'eip6963:announceProvider';
const REQUEST_EVENT = 'eip6963:requestProvider';

/** Wallets we know how to brand/normalise (rdns values come from EIP-6963). */
export const KNOWN_WALLETS = [
  { id: 'metamask', name: 'MetaMask', rdns: ['io.metamask', 'io.metamask.flask'], icon: '🦊', url: 'https://metamask.io/download/' },
  { id: 'phantom', name: 'Phantom', rdns: ['app.phantom'], icon: '👻', url: 'https://phantom.app/download' },
  { id: 'trust', name: 'Trust Wallet', rdns: ['com.trustwallet.app', 'com.trustwallet.wallet', 'com.trustwallet'], icon: '🛡️', url: 'https://trustwallet.com/download' },
  { id: 'coinbase', name: 'Coinbase Wallet', rdns: ['com.coinbase.wallet', 'com.coinbase.wallet.extension'], icon: '🔵', url: 'https://www.coinbase.com/wallet/downloads' },
  { id: 'okx', name: 'OKX Wallet', rdns: ['com.okex.wallet', 'io.okx'], icon: '⭕', url: 'https://www.okx.com/web3' },
  { id: 'binance', name: 'Binance Wallet', rdns: ['com.binance.wallet', 'binance-wallet'], icon: '🟡', url: 'https://www.binance.com/en/web3wallet' },
  { id: 'brave', name: 'Brave Wallet', rdns: ['com.brave.wallet'], icon: '🦁', url: 'https://brave.com/wallet/' },
  { id: 'rainbow', name: 'Rainbow', rdns: ['me.rainbow', 'com.rainbow.wallet'], icon: '🌈', url: 'https://rainbow.me/download' }
];

function brandFor(rdns = '', name = '') {
  const needleRdns = String(rdns).toLowerCase();
  const needleName = String(name).toLowerCase();
  return (
    KNOWN_WALLETS.find((wallet) => wallet.rdns.some((known) => needleRdns === known || needleRdns.startsWith(known))) ||
    KNOWN_WALLETS.find((wallet) => needleName.includes(wallet.id) || needleName.includes(wallet.name.toLowerCase())) ||
    null
  );
}

function toEntry({ info, provider }) {
  const brand = brandFor(info?.rdns, info?.name);
  return {
    id: info?.uuid || info?.rdns || `injected-${info?.name}`,
    name: brand?.name || info?.name || 'Injected Wallet',
    icon: brand?.icon || '🔌',
    brandId: brand?.id || 'injected',
    rdns: info?.rdns || '',
    installed: true,
    evm: true,
    provider,
    info
  };
}

/** Collects all announced providers (resolves after ~300ms of silence). */
export function discoverInjectedProviders({ timeoutMs = 300 } = {}) {
  if (typeof window === 'undefined') return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map();

    const onAnnounce = (event) => {
      const detail = event?.detail;
      if (!detail?.provider || !detail?.info) return;
      const entry = toEntry(detail);
      found.set(entry.rdns || entry.id, entry);
    };

    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    window.dispatchEvent(new Event(REQUEST_EVENT));

    setTimeout(() => {
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
      resolve([...found.values(), ...legacyInjectedProviders(found)]);
    }, timeoutMs);
  });
}

/**
 * Legacy fallback for wallets that do not announce themselves via EIP-6963 yet
 * (older MetaMask / Trust builds, `window.ethereum.providers` aggregators, ...).
 */
function legacyInjectedProviders(alreadyFound) {
  const seenRdns = new Set([...alreadyFound.keys()]);
  const injected = [];

  const candidates = [];
  if (window.ethereum?.providers?.length) candidates.push(...window.ethereum.providers);
  if (window.ethereum) candidates.push(window.ethereum);

  for (const provider of candidates) {
    if (!provider || typeof provider.request !== 'function') continue;
    const brand = detectLegacyBrand(provider);
    if (!brand || seenRdns.has(brand.rdns)) continue;
    seenRdns.add(brand.rdns);
    injected.push({
      id: brand.rdns,
      name: brand.name,
      icon: brand.icon,
      brandId: brand.id,
      rdns: brand.rdns,
      installed: true,
      evm: true,
      provider,
      legacy: true
    });
  }

  return injected;
}

export function detectLegacyBrand(provider) {
  if (!provider) return null;
  if (provider.isBraveWallet) return { ...KNOWN_WALLETS[6], rdns: 'com.brave.wallet' };
  if (provider.isRabby) return { id: 'rabby', name: 'Rabby', icon: '🐰', rdns: 'io.rabby' };
  if (provider.isCoinbaseWallet) return { ...KNOWN_WALLETS[3], rdns: 'com.coinbase.wallet' };
  if (provider.isTrust || provider.isTrustWallet) return { ...KNOWN_WALLETS[2], rdns: 'com.trustwallet.app' };
  if (provider.isPhantom || provider.isPhantomWallet) return { ...KNOWN_WALLETS[1], rdns: 'app.phantom' };
  if (provider.isOKExWallet || provider.isOkxWallet) return { ...KNOWN_WALLETS[4], rdns: 'com.okex.wallet' };
  if (provider.isBinance || provider.isBinanceWallet) return { ...KNOWN_WALLETS[5], rdns: 'com.binance.wallet' };
  if (provider.isMetaMask) return { ...KNOWN_WALLETS[0], rdns: 'io.metamask' };
  return null;
}

/** Solana injected wallets (Phantom / Solflare) — real address via window.solana. */
export function detectSolanaProviders() {
  if (typeof window === 'undefined') return [];
  const providers = [];

  const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
  if (phantom?.connect) {
    providers.push({
      id: 'phantom-solana',
      name: 'Phantom (Solana)',
      icon: '👻',
      brandId: 'phantom',
      installed: true,
      evm: false,
      chain: 'solana',
      provider: phantom
    });
  }

  if (window.solflare?.connect) {
    providers.push({
      id: 'solflare-solana',
      name: 'Solflare (Solana)',
      icon: '🔆',
      brandId: 'solflare',
      installed: true,
      evm: false,
      chain: 'solana',
      provider: window.solflare
    });
  }

  return providers;
}

/** Wallets we can offer to install (never pretended to be connected). */
export function installableWalletLinks() {
  return KNOWN_WALLETS.map((wallet) => ({ id: wallet.id, name: wallet.name, icon: wallet.icon, url: wallet.url }));
}

/** Aggregated discovery: EVM (EIP-6963) + Solana injected wallets. */
export async function discoverAllWallets() {
  const [evm, solana] = await Promise.all([
    discoverInjectedProviders(),
    Promise.resolve(detectSolanaProviders())
  ]);
  return { evm, solana, all: [...evm, ...solana] };
}
