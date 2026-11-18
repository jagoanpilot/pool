'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const logger = require('./logger');
const db = require('./db');
const {state, snapshot} = require('./state');

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(body);
}

function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
    res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
}

function start(cfg) {
  if (!cfg.dashboard || !cfg.dashboard.enabled) return null;
  const root = path.resolve(cfg._root, 'dashboard');
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const p = parsed.pathname || '/';
    try {
      if (p === '/api/status') return sendJson(res, 200, snapshot());
      if (p === '/api/overview') return sendJson(res, 200, {ok: true, ...db.getOverview(), ...state.pool, network: state.network});
      if (p === '/api/miners') return sendJson(res, 200, {ok: true, miners: db.getMiners(200)});
      if (p === '/api/workers') return sendJson(res, 200, {ok: true, workers: db.getWorkers(300)});
      if (p === '/api/blocks') return sendJson(res, 200, {ok: true, blocks: db.getBlocks(200)});
      if (p === '/api/payments') return sendJson(res, 200, {ok: true, payments: db.getPayments(200)});
      if (p === '/api/config') {
        // do not expose secrets
        const safe = JSON.parse(JSON.stringify(cfg));
        if (safe.network) { safe.network.rpc_password = safe.network.rpc_password ? '***' : ''; safe.network.rpc_user = safe.network.rpc_user ? '***' : ''; }
        return sendJson(res, 200, {ok: true, config: safe});
      }
      if (p === '/api/logs') {
        const file = cfg.logging.file;
        let tail = '';
        try {
          if (fs.existsSync(file)) {
            const data = fs.readFileSync(file, 'utf8');
            tail = data.slice(-20000);
          }
        } catch (_) {}
        return sendJson(res, 200, {ok: true, tail});
      }
      // static
      if (p === '/' || p === '/index.html') return serveStatic(res, path.join(root, 'index.html'));
      const rel = p.replace(/^\/+/, '');
      const fp = path.resolve(root, rel);
      if (fp.startsWith(root)) return serveStatic(res, fp);
      res.writeHead(403); res.end('Forbidden');
    } catch (e) {
      sendJson(res, 500, {ok: false, error: e.message});
    }
  });
  server.listen(cfg.dashboard.port, cfg.dashboard.host || '0.0.0.0', () => {
    state.dashboard = {ok: true, host: cfg.dashboard.host || '0.0.0.0', port: cfg.dashboard.port};
    logger.info('dashboard', 'Dashboard listening on %s:%d', [state.dashboard.host, state.dashboard.port]);
  });
  server.on('error', (e) => logger.error('dashboard', 'Dashboard error: %s', [e.message]));
  return server;
}

module.exports = {start};
