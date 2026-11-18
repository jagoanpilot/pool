#!/usr/bin/env node
'use strict';
// Main pool server entrypoint (equivalent to pool start --foreground)
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const configPath = process.env.POOL_CONFIG || path.join(root, 'config', 'pool.yaml');
const {loadConfig} = require('../lib/config');
const {start} = require('../lib/server');

(async () => {
  const cfg = loadConfig(configPath);
  fs.mkdirSync(path.join(root, 'data'), {recursive: true});
  fs.writeFileSync(path.join(root, 'data', 'pool.pid'), String(process.pid));
  await start(cfg);
})().catch(e => { console.error(e); process.exit(1); });
