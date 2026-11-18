'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const db = require('./db');
const {StratumServer} = require('./stratum');
const dashboard = require('./dashboard');
const {state} = require('./state');

async function start(cfg) {
  logger.init(cfg);
  logger.info('server', 'Starting %s', [cfg.pool && cfg.pool.name || 'PhantomRider Pool']);
  // ensure dirs
  fs.mkdirSync(path.dirname(cfg.logging.file), {recursive: true});
  fs.mkdirSync(path.dirname(cfg.database.path), {recursive: true});
  db.init(cfg);

  const stratum = new StratumServer(cfg);
  state.stratum = {ok: false, host: cfg.stratum.host, port: cfg.stratum.port};
  try {
    await stratum.start();
  } catch (e) {
    logger.error('server', 'Failed to start stratum: %s', [e.message]);
    // continue so dashboard/status can show error
  }

  const dash = dashboard.start(cfg);

  const shutdown = (sig) => {
    logger.info('server', 'Shutting down (%s)', [sig || 'signal']);
    try { stratum.stop(); } catch (_) {}
    try { if (dash) dash.close(); } catch (_) {}
    try { db.close(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('server', 'Pool started. Stratum: %s:%d, Dashboard: %s:%d', [cfg.stratum.host, cfg.stratum.port, cfg.dashboard.host, cfg.dashboard.port]);
  return {stratum, dash, shutdown};
}

module.exports = {start};
