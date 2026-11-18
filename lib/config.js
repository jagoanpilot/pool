'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function substituteEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
      return process.env[name] != null ? process.env[name] : '';
    });
  }
  if (Array.isArray(value)) return value.map(substituteEnv);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteEnv(v);
    return out;
  }
  return value;
}

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra === undefined ? base : extra;
  const out = {...base};
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const defaults = {
  pool: {name: 'PhantomRider Pool', enabled: true},
  network: {rpc_url: 'http://127.0.0.1:8332', rpc_user: '', rpc_password: '', timeout: 30000},
  stratum: {host: '0.0.0.0', port: 3333, tls: false},
  algorithm: {name: 'phantomrider', source: './algorithm/phantomrider', helper_path: '', helper_threads: 2, verify_shares: true},
  mining: {
    min_difficulty: 1, max_difficulty: 1000000, default_difficulty: 256,
    vardiff: true, target_share_time: 15, retarget_time: 60, variance_percent: 30, max_jump_percent: 100,
    max_connections: 2000, max_connections_per_ip: 100, login_timeout_sec: 20,
  },
  rewards: {scheme: 'PPLNS', pool_fee: 1.0, minimum_payout: 0.01, pplns_window: 2.0},
  database: {type: 'sqlite', path: './data/database/pool.db'},
  dashboard: {enabled: true, host: '0.0.0.0', port: 8080, auth: {enabled: false, user: 'admin', password_hash: ''}},
  logging: {level: 'info', file: './data/logs/pool.log'},
};

function resolvePath(root, p) {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  return path.resolve(root, p);
}

function loadConfig(configPath) {
  const root = path.resolve(path.dirname(configPath), '..');
  let fileCfg = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    fileCfg = yaml.load(raw) || {};
  }
  fileCfg = substituteEnv(fileCfg);
  const cfg = deepMerge(defaults, fileCfg);
  cfg._root = root;
  cfg._configPath = path.resolve(configPath);
  // resolve paths
  cfg.algorithm.source = resolvePath(root, cfg.algorithm.source);
  if (cfg.algorithm.helper_path) cfg.algorithm.helper_path = resolvePath(root, cfg.algorithm.helper_path);
  cfg.database.path = resolvePath(root, cfg.database.path);
  cfg.logging.file = resolvePath(root, cfg.logging.file);
  return cfg;
}

module.exports = {loadConfig, substituteEnv, defaults};
