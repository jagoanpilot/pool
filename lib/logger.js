'use strict';

const fs = require('fs');
const path = require('path');

const LEVELS = {debug: 10, info: 20, warn: 30, error: 40};
let minLevel = LEVELS.info;
let logFile = null;

function init(cfg) {
  const level = (cfg && cfg.logging && cfg.logging.level) || 'info';
  minLevel = LEVELS[level] != null ? LEVELS[level] : LEVELS.info;
  logFile = cfg && cfg.logging && cfg.logging.file;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), {recursive: true});
  }
}

function write(level, system, msg) {
  if ((LEVELS[level] || 0) < minLevel) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] [${system}] ${msg}`;
  if (level === 'error') console.error(line); else console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch (_) {}
  }
}

function fmt(msg, args) {
  if (!args || !args.length) return String(msg);
  let i = 0;
  return String(msg).replace(/%[sdj%]/g, (m) => {
    if (m === '%%') return '%';
    if (i >= args.length) return m;
    const v = args[i++];
    if (m === '%j') try { return JSON.stringify(v); } catch (_) { return String(v); }
    return String(v);
  });
}

function log(level, system, msg, args) {
  write(level, system, fmt(msg, args));
}

module.exports = {
  init,
  log,
  debug: (s, m, a) => log('debug', s, m, a),
  info: (s, m, a) => log('info', s, m, a),
  warn: (s, m, a) => log('warn', s, m, a),
  error: (s, m, a) => log('error', s, m, a),
};
