/**
 * Zero-dependency sqlite store using Node 22+ built-in `node:sqlite`.
 * Saves blocks, chain state snapshots, and mempool so the node survives restarts.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class FlushStore {
  constructor(filePath) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (
        height INTEGER PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        prev_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
      CREATE TABLE IF NOT EXISTS state_snapshots (
        height INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mempool (
        hash TEXT PRIMARY KEY,
        tx_data TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
    `);
  }

  load() {
    const blockRows = this.db.prepare('SELECT data FROM blocks ORDER BY height ASC').all();
    const blocks = blockRows.map((row) => JSON.parse(row.data));

    const stateRow = this.db.prepare('SELECT data FROM state_snapshots ORDER BY height DESC LIMIT 1').get();
    const state = stateRow ? JSON.parse(stateRow.data) : null;

    const mempoolRows = this.db.prepare('SELECT tx_data FROM mempool ORDER BY received_at ASC').all();
    const mempool = mempoolRows.map((row) => JSON.parse(row.tx_data));

    return { blocks: blocks.length ? blocks : null, state, mempool };
  }

  save({ blocks, state, mempool }) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      if (Array.isArray(blocks)) {
        const insertBlock = this.db.prepare(`
          INSERT OR REPLACE INTO blocks (height, hash, prev_hash, timestamp, data)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const block of blocks) {
          insertBlock.run(
            block.height,
            block.hash,
            block.prevHash,
            block.timestamp,
            JSON.stringify(block),
          );
        }
      }

      if (state) {
        const height = blocks && blocks.length ? blocks[blocks.length - 1].height : 0;
        this.db.prepare(`
          INSERT OR REPLACE INTO state_snapshots (height, data, updated_at)
          VALUES (?, ?, ?)
        `).run(height, JSON.stringify(state), Date.now());

        // Retain only the 5 most recent snapshots to bound disk growth:
        this.db.prepare(`
          DELETE FROM state_snapshots WHERE height NOT IN (
            SELECT height FROM state_snapshots ORDER BY height DESC LIMIT 5
          )
        `).run();
      }

      if (Array.isArray(mempool)) {
        this.db.prepare('DELETE FROM mempool').run();
        const insertMempool = this.db.prepare(`
          INSERT OR REPLACE INTO mempool (hash, tx_data, received_at)
          VALUES (?, ?, ?)
        `);
        for (const tx of mempool) {
          insertMempool.run(tx.hash, JSON.stringify(tx), tx.timestamp || Date.now());
        }
      }

      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  close() {
    try {
      this.db.close();
    } catch {
      // ignore double close
    }
  }
}
