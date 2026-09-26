/**
 * Zero-dependency FlushCoin HTTP API & Static File Server.
 *
 * Runs on standard Node 22+ using only native `node:http`, `node:fs`, `node:path`.
 * Provides full REST API matching the shared engine and serves the frontend SPA.
 *
 * Usage:
 *   node server/index.mjs [port]
 */
import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlushNode, NETWORK, isAddress } from '../shared/flushcore.mjs';
import { FlushStore } from './store.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT_DIR = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const DB_PATH = process.env.FLUSH_DB || join(ROOT_DIR, 'data', 'flushchain.db');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(res, statusCode, error) {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, statusCode, { ok: false, error: message });
}

async function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, filePath) {
  if (!existsSync(filePath)) return false;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export async function createFlushServer({ port = PORT, dbPath = DB_PATH, quiet = false } = {}) {
  const store = dbPath === ':memory:' ? null : new FlushStore(dbPath);
  const node = await FlushNode.create({ store });

  const server = createServer(async (req, res) => {
    // Handle CORS preflight:
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const host = req.headers.host || `localhost:${port}`;
    const url = new URL(req.url, `http://${host}`);
    const pathname = url.pathname;

    try {
      // ---------------------------------------------------- API Routes
      if (pathname === '/api/network' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, data: node.getNetwork() });
      }

      if (pathname === '/api/stats' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, data: node.getStats() });
      }

      if (pathname === '/api/blocks' && req.method === 'GET') {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
        const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        return sendJson(res, 200, { ok: true, data: node.getBlocks({ limit, offset }) });
      }

      if (pathname.startsWith('/api/block/') && req.method === 'GET') {
        const id = pathname.slice('/api/block/'.length);
        return sendJson(res, 200, { ok: true, data: node.getBlock(id) });
      }

      if (pathname.startsWith('/api/transaction/') && req.method === 'GET') {
        const hash = pathname.slice('/api/transaction/'.length);
        return sendJson(res, 200, { ok: true, data: node.getTransaction(hash) });
      }

      if (pathname === '/api/mempool' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, data: node.getMempool() });
      }

      if (pathname.startsWith('/api/account/') && req.method === 'GET') {
        const address = pathname.slice('/api/account/'.length);
        return sendJson(res, 200, { ok: true, data: node.getAccount(address) });
      }

      if (pathname === '/api/tokens' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, data: node.getTokens() });
      }

      if (pathname.startsWith('/api/token/') && req.method === 'GET') {
        const symbol = pathname.slice('/api/token/'.length);
        const token = node.getToken(symbol);
        if (!token) return sendError(res, 404, `token ${symbol} not found`);
        return sendJson(res, 200, { ok: true, data: token });
      }

      if (pathname.startsWith('/api/orderbook/') && req.method === 'GET') {
        const symbol = pathname.slice('/api/orderbook/'.length);
        return sendJson(res, 200, { ok: true, data: node.getOrderbook(symbol) });
      }

      if (pathname.startsWith('/api/trades/') && req.method === 'GET') {
        const symbol = pathname.slice('/api/trades/'.length);
        const limit = Math.min(100, Number(url.searchParams.get('limit') || 40));
        return sendJson(res, 200, { ok: true, data: node.getTrades(symbol, limit) });
      }

      if (pathname.startsWith('/api/orders') && req.method === 'GET') {
        const symbol = url.searchParams.get('symbol') || '';
        return sendJson(res, 200, { ok: true, data: node.getOpenOrders(symbol) });
      }

      if (pathname === '/api/quote' && req.method === 'GET') {
        const symbol = url.searchParams.get('symbol');
        const direction = url.searchParams.get('direction') || 'buy';
        const amountIn = url.searchParams.get('amountIn');
        if (!symbol || !amountIn) return sendError(res, 400, 'symbol and amountIn are required');
        return sendJson(res, 200, { ok: true, data: node.quote(symbol, direction, amountIn) });
      }

      if (pathname === '/api/faucet' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.address || !isAddress(body.address)) return sendError(res, 400, 'valid address required');
        const tx = await node.faucet(body.address);
        return sendJson(res, 200, { ok: true, data: tx });
      }

      if (pathname === '/api/submit' && req.method === 'POST') {
        const tx = await readBody(req);
        const result = await node.submitTransaction(tx);
        return sendJson(res, 200, { ok: true, data: result });
      }

      if (pathname === '/api/verify' && req.method === 'GET') {
        const report = await node.verifyChain();
        return sendJson(res, 200, { ok: true, data: report });
      }

      if (pathname === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          data: {
            height: node.height,
            lastHash: node.lastBlock.hash,
            stats: node.getStats(),
            tokens: node.getTokens(),
            mempoolCount: node.mempool.length,
          },
        });
      }

      // ---------------------------------------------------- Static Assets
      let filePath;
      if (pathname === '/' || pathname === '/index.html') {
        filePath = join(ROOT_DIR, 'index.html');
      } else {
        const safePath = pathname.replace(/^\/+/, '');
        filePath = join(ROOT_DIR, safePath);
      }

      if (serveStatic(req, res, filePath)) return;

      // Single-page-app fallback: if non-API HTML request, serve index.html
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        const fallback = join(ROOT_DIR, 'index.html');
        if (serveStatic(req, res, fallback)) return;
      }

      return sendError(res, 404, `Route ${pathname} not found`);

    } catch (err) {
      return sendError(res, 500, err);
    }
  });

  return { server, node, store, port };
}

// When run directly as entry point:
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { server, node, port } = await createFlushServer();
  server.listen(port, () => {
    console.log(`\n=================================================`);
    console.log(`FlushCoin Node & DEX Server`);
    console.log(`Chain:      ${NETWORK.name} (${NETWORK.chainId})`);
    console.log(`Listening:  http://localhost:${port}`);
    console.log(`Treasury:   ${node.state.meta.treasury || '0x9fd1c...ffff'}`);
    console.log(`Height:     ${node.height} (hash: ${node.lastBlock.hash.slice(0, 16)}...)`);
    console.log(`=================================================\n`);
  });
}



