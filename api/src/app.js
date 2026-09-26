import express from 'express';
import cors from 'cors';
import config, { validateConfig } from './config.js';
import { loadLedger } from './services/ledger.js';
import { getChainStatus } from './services/chain.js';
import { authRouter } from './routes/auth.js';
import { balanceRouter } from './routes/balance.js';
import { earnRouter } from './routes/earn.js';
import { withdrawRouter } from './routes/withdraw.js';
import { notFound, errorHandler } from './middleware/errors.js';

/**
 * FluxCoin API — wallet auth, site balance ledger and zero-fee withdrawals.
 * Boot with: npm run dev (inside /api) or npm start.
 */
export function createApp() {
  const problems = validateConfig();
  if (problems.length > 0) {
    console.warn('[config] warnings:');
    problems.forEach((problem) => console.warn(`  - ${problem}`));
  }

  loadLedger();

  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGINS`));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, service: 'fluxcoin-api', uptime: process.uptime(), chain: await getChainStatus() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/balance', balanceRouter);
  app.use('/api/earn', earnRouter);
  app.use('/api/withdraw', withdrawRouter);

  // Aliases used by the frontend for the ERC-4337 paymaster proxy.
  app.post('/api/paymaster/sponsor', (req, res, next) => {
    req.url = '/paymaster/sponsor';
    withdrawRouter(req, res, next);
  });

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
