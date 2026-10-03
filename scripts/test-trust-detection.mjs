/**
 * Temporary verification script for the Trust Wallet detection fixes.
 * Simulates the browser window (EIP-6963 announcements + window.trustwallet)
 * and checks that every known Trust build is discovered and branded correctly.
 * Run: node scripts/test-trust-detection.mjs
 */
import { discoverAllWallets, findTrustWalletEntry, detectLegacyBrand } from '../src/wallet/eip6963.js';

const announceHandlers = new Set();
let trustProviderAnnounced = null;
let trustProviderWindow = null;

globalThis.window = {
  addEventListener: (evt, fn) => {
    if (evt === 'eip6963:announceProvider') announceHandlers.add(fn);
  },
  removeEventListener: (evt, fn) => announceHandlers.delete(fn),
  dispatchEvent: () => {
    // The dApp dispatches eip6963:requestProvider -> wallets announce back.
    for (const fn of announceHandlers) {
      if (trustProviderAnnounced) {
        fn({ detail: { info: { uuid: 'uuid-trust', name: 'Trust Wallet', rdns: trustProviderAnnounced, icon: 'x' }, provider: trustProviderWindow } });
      }
    }
    return true;
  }
};

const results = [];
const check = (label, condition) => {
  results.push(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) process.exitCode = 1;
};

async function runDiscovery() {
  // discoverAllWallets() -> discoverInjectedProviders (waits 500ms) + solana
  const result = await discoverAllWallets();
  return result;
}

// --- Scenario 1: modern extension announces rdns `app.trustwallet.com` -------
trustProviderAnnounced = 'app.trustwallet.com';
trustProviderWindow = { request: async () => ['0x1111111111111111111111111111111111111111'] };
{
  const { evm } = await runDiscovery();
  const trust = evm.find((w) => w.brandId === 'trust');
  check('rdns app.trustwallet.com  -> discovered as Trust Wallet', Boolean(trust));
  check('rdns app.trustwallet.com  -> name branded "Trust Wallet"', trust?.name === 'Trust Wallet');
}

// --- Scenario 2: docs rdns `com.trustwallet.app` -----------------------------
trustProviderAnnounced = 'com.trustwallet.app';
trustProviderWindow = { request: async () => ['0x2222222222222222222222222222222222222222'] };
{
  const { evm } = await runDiscovery();
  const trust = evm.find((w) => w.brandId === 'trust');
  check('rdns com.trustwallet.app  -> discovered as Trust Wallet', Boolean(trust));
}

// --- Scenario 3: future/unknown rdns still containing "trustwallet" ---------
trustProviderAnnounced = 'wallet.trustwallet.something';
trustProviderWindow = { request: async () => ['0x3333333333333333333333333333333333333333'] };
{
  const { evm } = await runDiscovery();
  check('unknown rdns containing "trustwallet" -> branded Trust', evm.some((w) => w.brandId === 'trust'));
}

// --- Scenario 4: no EIP-6963 at all, only window.trustwallet (legacy) --------
trustProviderAnnounced = null; // no announce happens
globalThis.window.ethereum = undefined;
globalThis.window.trustwallet = { request: async () => ['0x4444444444444444444444444444444444444444'] };
{
  const { evm } = await runDiscovery();
  check('window.trustwallet only  -> discovered as Trust Wallet (legacy)', evm.some((w) => w.brandId === 'trust'));
  const entry = findTrustWalletEntry(await runDiscovery());
  check('findTrustWalletEntry()   -> returns the window.trustwallet entry', Boolean(entry?.provider === globalThis.window.trustwallet));
}

// --- Scenario 5: EIP-6963 missed but window.trustwallet present --------------
{
  trustProviderAnnounced = null;
  const entry = findTrustWalletEntry({ all: [] }); // nothing discovered
  check('findTrustWalletEntry()   -> falls back to window.trustwallet', entry?.brandId === 'trust');
}

// --- Scenario 6: no Trust at all -> null (no fake wallet) --------------------
{
  globalThis.window.trustwallet = undefined;
  const entry = findTrustWalletEntry({ all: [] });
  check('nothing installed        -> findTrustWalletEntry() = null (no fake)', entry === null);
}

// --- Scenario 7: legacy brand flags -------------------------------------------
{
  check('detectLegacyBrand(isTrust) -> Trust', detectLegacyBrand({ isTrust: true, request: () => {} })?.id === 'trust');
  check('detectLegacyBrand(isTrustWallet) -> Trust', detectLegacyBrand({ isTrustWallet: true, request: () => {} })?.id === 'trust');
}

console.log(results.join('\n'));
console.log(results.every((r) => r.startsWith('PASS')) ? '\nALL CHECKS PASSED ✔' : '\nSOME CHECKS FAILED ✘');
