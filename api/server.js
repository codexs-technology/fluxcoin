import { createApp } from './src/app.js';
import config from './src/config.js';
import { purgeExpiredNonces } from './src/services/session.js';
import { pruneRateLimitBuckets } from './src/middleware/rateLimit.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`\n⚡ FluxCoin API listening on http://localhost:${config.port}`);
  console.log(`   CORS origins   : ${config.corsOrigins.join(', ') || '(any)'}`);
  console.log(`   chainId        : ${config.chain.chainId}`);
  console.log(`   gasless mode   : ${config.gasless.mode}${config.allowDryRun ? ' (dry-run allowed)' : ''}`);
  console.log(`   token / faucet : ${config.chain.tokenAddress || '-'} / ${config.chain.faucetAddress || '-'}`);
  console.log('   docs           : see README.md -> API reference\n');
});

// Housekeeping: drop expired auth nonces and empty rate-limit buckets.
const cleanup = setInterval(() => {
  purgeExpiredNonces();
  pruneRateLimitBuckets();
}, 60_000);
cleanup.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[api] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  });
}
