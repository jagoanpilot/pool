'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let driver = null; // 'sqlite' | 'json'

let db = null; // sqlite Database
let jsonState = null;
let jsonPath = null;
let flushTimer = null;

function now() { return Date.now(); }

function initSqlite(cfg) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    throw new Error('better-sqlite3 tidak tersedia. Jalankan `npm install` (butuh toolchain build) atau gunakan database fallback. Detail: ' + e.message);
  }
  fs.mkdirSync(path.dirname(cfg.database.path), {recursive: true});
  db = new Database(cfg.database.path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS miners (
      address TEXT PRIMARY KEY,
      reward_type TEXT DEFAULT 'prop',
      valid_shares INTEGER DEFAULT 0,
      invalid_shares INTEGER DEFAULT 0,
      stale_shares INTEGER DEFAULT 0,
      pending_balance REAL DEFAULT 0,
      confirmed_balance REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS workers (
      address TEXT,
      worker TEXT,
      valid_shares INTEGER DEFAULT 0,
      invalid_shares INTEGER DEFAULT 0,
      stale_shares INTEGER DEFAULT 0,
      last_seen INTEGER,
      difficulty REAL DEFAULT 0,
      PRIMARY KEY(address, worker)
    );
    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER,
      address TEXT,
      worker TEXT,
      difficulty REAL,
      weight REAL,
      valid INTEGER,
      stale INTEGER,
      height INTEGER,
      block_candidate INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER,
      height INTEGER,
      hash TEXT,
      pow_hash TEXT,
      address TEXT,
      worker TEXT,
      reward REAL,
      status TEXT,
      confirmations INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER,
      address TEXT,
      amount REAL,
      txid TEXT,
      status TEXT
    );
    CREATE TABLE IF NOT EXISTS stats (
      ts INTEGER PRIMARY KEY,
      hashrate REAL,
      miners INTEGER,
      workers INTEGER,
      accepted INTEGER,
      rejected INTEGER,
      stale INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_shares_ts ON shares(ts);
    CREATE INDEX IF NOT EXISTS idx_shares_addr ON shares(address);
    CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height);
  `);
  driver = 'sqlite';
}

function initJson(cfg) {
  jsonPath = cfg.database.path.replace(/\.db$/i, '') + '.json';
  fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
  if (fs.existsSync(jsonPath)) {
    try { jsonState = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (_) { jsonState = null; }
  }
  if (!jsonState) {
    jsonState = {meta: {}, miners: {}, workers: {}, shares: [], blocks: [], payments: [], stats: []};
  }
  driver = 'json';
  flushTimer = setInterval(flushJson, 5000);
}

function flushJson() {
  if (driver !== 'json' || !jsonPath) return;
  try {
    // keep shares bounded
    if (jsonState.shares.length > 200000) jsonState.shares = jsonState.shares.slice(-100000);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonState));
  } catch (e) {
    logger.error('db', 'flush json failed: %s', [e.message]);
  }
}

function init(cfg) {
  const type = (cfg.database && cfg.database.type) || 'sqlite';
  if (type === 'sqlite') {
    try {
      initSqlite(cfg);
      logger.info('db', 'SQLite database ready: %s', [cfg.database.path]);
      return;
    } catch (e) {
      logger.warn('db', 'SQLite init failed, falling back to JSON store: %s', [e.message]);
      initJson(cfg);
      logger.info('db', 'JSON database fallback ready: %s', [jsonPath]);
      return;
    }
  }
  initJson(cfg);
  logger.info('db', 'JSON database ready: %s', [jsonPath]);
}

function close() {
  if (flushTimer) clearInterval(flushTimer);
  flushJson();
  if (db) try { db.close(); } catch (_) {}
}

function recordShare(s) {
  const ts = s.ts || now();
  const worker = s.worker || '';
  if (driver === 'sqlite') {
    const ins = db.prepare(`INSERT INTO shares(ts,address,worker,difficulty,weight,valid,stale,height,block_candidate) VALUES (?,?,?,?,?,?,?,?,?)`);
    ins.run(ts, s.address, worker, s.difficulty || 0, s.weight || 0, s.valid ? 1 : 0, s.stale ? 1 : 0, s.height || 0, s.blockCandidate ? 1 : 0);
    db.prepare(`INSERT INTO miners(address,reward_type,valid_shares,invalid_shares,stale_shares,last_seen)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(address) DO UPDATE SET
        reward_type=excluded.reward_type,
        valid_shares=valid_shares+excluded.valid_shares,
        invalid_shares=invalid_shares+excluded.invalid_shares,
        stale_shares=stale_shares+excluded.stale_shares,
        last_seen=excluded.last_seen`).run(
      s.address, s.rewardType || 'prop', s.valid ? 1 : 0, (!s.valid && !s.stale) ? 1 : 0, s.stale ? 1 : 0, ts
    );
    db.prepare(`INSERT INTO workers(address,worker,valid_shares,invalid_shares,stale_shares,last_seen,difficulty)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(address,worker) DO UPDATE SET
        valid_shares=valid_shares+excluded.valid_shares,
        invalid_shares=invalid_shares+excluded.invalid_shares,
        stale_shares=stale_shares+excluded.stale_shares,
        last_seen=excluded.last_seen,
        difficulty=excluded.difficulty`).run(
      s.address, worker, s.valid ? 1 : 0, (!s.valid && !s.stale) ? 1 : 0, s.stale ? 1 : 0, ts, s.difficulty || 0
    );
    return;
  }
  jsonState.shares.push({ts, ...s, worker});
  const m = jsonState.miners[s.address] || (jsonState.miners[s.address] = {address: s.address, reward_type: s.rewardType || 'prop', valid_shares: 0, invalid_shares: 0, stale_shares: 0, pending_balance: 0, confirmed_balance: 0, paid: 0, last_seen: 0});
  if (s.valid) m.valid_shares++; else if (s.stale) m.stale_shares++; else m.invalid_shares++;
  m.last_seen = ts; m.reward_type = s.rewardType || m.reward_type;
  const wk = s.address + '\u0000' + worker;
  const w = jsonState.workers[wk] || (jsonState.workers[wk] = {address: s.address, worker, valid_shares: 0, invalid_shares: 0, stale_shares: 0, last_seen: 0, difficulty: 0});
  if (s.valid) w.valid_shares++; else if (s.stale) w.stale_shares++; else w.invalid_shares++;
  w.last_seen = ts; w.difficulty = s.difficulty || w.difficulty;
}

function recordBlock(b) {
  const ts = b.ts || now();
  if (driver === 'sqlite') {
    db.prepare(`INSERT INTO blocks(ts,height,hash,pow_hash,address,worker,reward,status,confirmations) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ts, b.height || 0, b.hash || null, b.powHash || null, b.address || null, b.worker || null, b.reward || 0, b.status || 'found', b.confirmations || 0);
    return;
  }
  jsonState.blocks.push({ts, ...b});
}

function getOverview() {
  if (driver === 'sqlite') {
    const miners = db.prepare(`SELECT COUNT(*) c FROM miners WHERE last_seen > ?`).get(now() - 10 * 60 * 1000).c;
    const workers = db.prepare(`SELECT COUNT(*) c FROM workers WHERE last_seen > ?`).get(now() - 10 * 60 * 1000).c;
    const sh = db.prepare(`SELECT 
      SUM(CASE WHEN valid=1 THEN 1 ELSE 0 END) accepted,
      SUM(CASE WHEN valid=0 AND stale=0 THEN 1 ELSE 0 END) rejected,
      SUM(CASE WHEN stale=1 THEN 1 ELSE 0 END) stale
      FROM shares WHERE ts > ?`).get(now() - 24 * 3600 * 1000);
    const blocks = db.prepare(`SELECT COUNT(*) c FROM blocks`).get().c;
    return {miners, workers, accepted: sh.accepted || 0, rejected: sh.rejected || 0, stale: sh.stale || 0, blocksFound: blocks};
  }
  const cutoff = now() - 10 * 60 * 1000;
  const miners = Object.values(jsonState.miners).filter(m => m.last_seen > cutoff).length;
  const workers = Object.values(jsonState.workers).filter(w => w.last_seen > cutoff).length;
  const day = now() - 24 * 3600 * 1000;
  let accepted = 0, rejected = 0, stale = 0;
  for (const s of jsonState.shares) {
    if (s.ts < day) continue;
    if (s.valid) accepted++; else if (s.stale) stale++; else rejected++;
  }
  return {miners, workers, accepted, rejected, stale, blocksFound: jsonState.blocks.length};
}

function getMiners(limit = 100) {
  if (driver === 'sqlite') {
    return db.prepare(`SELECT * FROM miners ORDER BY last_seen DESC LIMIT ?`).all(limit);
  }
  return Object.values(jsonState.miners).sort((a,b)=>b.last_seen-a.last_seen).slice(0, limit);
}

function getWorkers(limit = 200) {
  if (driver === 'sqlite') {
    return db.prepare(`SELECT * FROM workers ORDER BY last_seen DESC LIMIT ?`).all(limit);
  }
  return Object.values(jsonState.workers).sort((a,b)=>b.last_seen-a.last_seen).slice(0, limit);
}

function getBlocks(limit = 100) {
  if (driver === 'sqlite') {
    return db.prepare(`SELECT * FROM blocks ORDER BY ts DESC LIMIT ?`).all(limit);
  }
  return [...jsonState.blocks].sort((a,b)=>b.ts-a.ts).slice(0, limit);
}

function getPayments(limit = 100) {
  if (driver === 'sqlite') {
    return db.prepare(`SELECT * FROM payments ORDER BY ts DESC LIMIT ?`).all(limit);
  }
  return [...jsonState.payments].sort((a,b)=>b.ts-a.ts).slice(0, limit);
}

module.exports = {
  init, close, recordShare, recordBlock,
  getOverview, getMiners, getWorkers, getBlocks, getPayments,
  get driver() { return driver; }
};
