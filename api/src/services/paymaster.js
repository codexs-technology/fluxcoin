import config from '../config.js';

/**
 * BICONOMY PAYMASTER PROXY (ERC-4337 Account Abstraction).
 * -------------------------------------------------------
 * With ERC-4337 the USER's smart account sends the withdrawal UserOperation —
 * and your Paymaster pays the gas, so the withdrawal is free for the user.
 *
 * The Paymaster API key must never ship in the browser bundle, so the frontend
 * asks this endpoint instead and we forward the sponsorship call server-side.
 *
 * ★★★ WHERE TO PUT YOUR BICONOMY KEYS ★★★
 *   api/.env -> BICONOMY_PAYMASTER_API_KEY / BICONOMY_PAYMASTER_URL / BICONOMY_BUNDLER_URL
 *   Get them from https://dashboard.biconomy.io (Paymaster & Bundler endpoints).
 */

export const PAYMASTER_METHODS = {
  STUB: 'pm_getPaymasterStubData',
  DATA: 'pm_getPaymasterData',
  SUPPORTED: 'pm_supportedEntryPoints'
};

export function isPaymasterConfigured() {
  return Boolean(
    (config.gasless.biconomyPaymasterUrl || config.gasless.biconomyPaymasterApiKey) &&
      config.gasless.biconomyBundlerUrl
  );
}

function paymasterEndpoint() {
  if (config.gasless.biconomyPaymasterUrl) return config.gasless.biconomyPaymasterUrl;
  // Biconomy's chain-aware paymaster endpoint format.
  return `https://paymaster.biconomy.io/api/v2/${config.chain.chainId}/${config.gasless.biconomyPaymasterApiKey}`;
}

async function rpc(method, params) {
  const url = paymasterEndpoint();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.gasless.biconomyPaymasterApiKey
        ? { 'x-api-key': config.gasless.biconomyPaymasterApiKey }
        : {})
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });

  const payload = await response.json();
  if (payload.error) {
    throw new Error(`Paymaster error: ${payload.error.message || JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

/**
 * Returns Paymaster sponsorship data for a UserOperation.
 * @param {'stub'|'data'} stage `stub` = gas estimation pass, `data` = final signature pass
 */
export async function getPaymasterData({ stage = 'data', userOp, entryPoint = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789', chainId }) {
  const method = stage === 'stub' ? PAYMASTER_METHODS.STUB : PAYMASTER_METHODS.DATA;
  const resolvedChainId = chainId ? `0x${Number(chainId).toString(16)}` : `0x${config.chain.chainId.toString(16)}`;
  return rpc(method, [userOp, entryPoint, resolvedChainId, {}]);
}

export function bundlerUrl() {
  return config.gasless.biconomyBundlerUrl || null;
}

/** Everything the browser needs to build + sponsor an ERC-4337 withdrawal. */
export function publicPaymasterConfig() {
  return {
    mode: 'biconomy-4337',
    bundlerUrl: config.gasless.biconomyBundlerUrl || null,
    paymasterProxyUrl: '/api/paymaster/sponsor',
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    chainId: config.chain.chainId,
    sponsorPaidBy: 'project-paymaster'
  };
}
