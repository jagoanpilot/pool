'use strict';

const http = require('http');
const https = require('https');
const {URL} = require('url');

function callRpc(cfg, method, params, cb) {
  const url = new URL(cfg.network.rpc_url);
  const body = JSON.stringify({jsonrpc: '1.0', id: String(Date.now()), method, params: params || []});
  const opts = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname || '/',
    method: 'POST',
    auth: `${cfg.network.rpc_user}:${cfg.network.rpc_password}`,
    headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)},
    timeout: cfg.network.timeout || 30000,
  };
  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.request(opts, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => data += c);
    res.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(data || '{}'); } catch (e) {
        return cb(new Error(`RPC ${method}: invalid JSON response (${res.statusCode})`));
      }
      if (parsed.error) return cb(new Error(`RPC ${method}: ${parsed.error.message || JSON.stringify(parsed.error)}`));
      if (res.statusCode >= 400) return cb(new Error(`RPC ${method}: HTTP ${res.statusCode}`));
      cb(null, parsed.result);
    });
  });
  req.on('timeout', () => req.destroy(new Error(`RPC ${method}: timeout`)));
  req.on('error', (e) => cb(new Error(`RPC ${method}: ${e.message}`)));
  req.write(body);
  req.end();
}

function callRpcAsync(cfg, method, params) {
  return new Promise((resolve, reject) => callRpc(cfg, method, params, (err, res) => err ? reject(err) : resolve(res)));
}

module.exports = {callRpc, callRpcAsync};
