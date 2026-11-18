'use strict';

/**
 * PhantomRider PHR-256-YP algorithm adapter (Node.js side).
 *
 * - calculateHash(headerHex|Buffer, cb?) -> Promise<string>|cb(err, hashHex)
 * - verifyShare({headerHex, hashHex, targetHex|targetBigInt}) -> boolean
 * - calculateTarget(bitsCompact|targetHex) helpers
 *
 * Hashing is performed by the native helper process `phr_hash` (built from
 * algorithm/phantomrider) using the exact PHR-256-YP implementation from
 * PhantomRider_v0_1. No algorithm changes. Header must be the serialized
 * 80-byte block header (version, prevhash, merkleroot, time, bits, nonce).
 * Digest is returned as 32-byte big-endian hex.
 */

const {spawn} = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_PERSONALIZATION = 'PHR';
const HEADER_SIZE = 80;

let helperPath = null;
let helpers = [];
let next = 0;
let nextId = 1;

function resolveHelperPath(configPath) {
  if (configPath && fs.existsSync(configPath)) return configPath;
  const candidates = [
    path.join(__dirname, 'build', 'Release', 'phr_hash.exe'),
    path.join(__dirname, 'build', 'phr_hash.exe'),
    path.join(__dirname, 'build', 'Release', 'phr_hash'),
    path.join(__dirname, 'build', 'phr_hash'),
    path.join(__dirname, '..', '..', 'bin', process.platform === 'win32' ? 'phr_hash.exe' : 'phr_hash'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function startOne(index) {
  const helper = {index, child: null, buffer: '', pending: new Map(), restartTimer: null};
  helpers[index] = helper;
  let child;
  try {
    child = spawn(helperPath, [], {stdio: ['pipe', 'pipe', 'pipe']});
  } catch (e) {
    scheduleRestart(index, e.message);
    return;
  }
  helper.child = child;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    helper.buffer += data;
    let idx;
    while ((idx = helper.buffer.indexOf('\n')) !== -1) {
      const line = helper.buffer.slice(0, idx).trim();
      helper.buffer = helper.buffer.slice(idx + 1);
      if (!line) continue;
      const parts = line.split(' ');
      if (parts[0] !== 'H') continue;
      const cb = helper.pending.get(parts[1]);
      if (!cb) continue;
      helper.pending.delete(parts[1]);
      if (parts[2] === 'err' || !parts[2]) cb(new Error('phr_hash error'));
      else cb(null, parts[2]);
    }
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  child.on('error', (err) => scheduleRestart(index, err.message));
  child.on('exit', (code, signal) => scheduleRestart(index, `exit code=${code} signal=${signal}`));
}

function scheduleRestart(index, reason) {
  const helper = helpers[index];
  if (!helper) return;
  helper.child = null;
  helper.pending.forEach((cb) => cb(new Error('hasher restarted: ' + reason)));
  helper.pending.clear();
  clearTimeout(helper.restartTimer);
  helper.restartTimer = setTimeout(() => startOne(index), 3000);
}

function init(opts = {}) {
  helperPath = resolveHelperPath(opts.path);
  const threads = Math.max(1, opts.threads || 1);
  helpers = [];
  next = 0;
  for (let i = 0; i < threads; i++) startOne(i);
  return {helperPath, threads};
}

function isReady() {
  return helpers.some((h) => h && h.child);
}

function stop() {
  helpers.forEach((h) => {
    if (!h) return;
    clearTimeout(h.restartTimer);
    if (h.child) {
      try { h.child.stdin.write('Q\n'); } catch (_) {}
      h.child.removeAllListeners('exit');
      try { h.child.kill(); } catch (_) {}
      h.child = null;
    }
  });
  helpers = [];
}

function calculateHash(header, cb) {
  const headerHex = Buffer.isBuffer(header) ? header.toString('hex') : String(header).toLowerCase();
  const run = (done) => {
    if (headerHex.length !== HEADER_SIZE * 2) return done(new Error('header must be 80 bytes hex'));
    for (let tries = 0; tries < helpers.length; tries++) {
      const h = helpers[next++ % Math.max(helpers.length, 1)];
      if (!h || !h.child) continue;
      const id = 'j' + (nextId++);
      h.pending.set(id, done);
      try {
        h.child.stdin.write('H ' + id + ' ' + headerHex + '\n');
      } catch (e) {
        h.pending.delete(id);
        return done(e);
      }
      return;
    }
    done(new Error('phr_hash helper not ready (build algorithm/phantomrider first)'));
  };
  if (typeof cb === 'function') return run(cb);
  return new Promise((resolve, reject) => run((err, res) => err ? reject(err) : resolve(res)));
}

function hashToBigInt(hashHex) {
  return BigInt('0x' + hashHex);
}

function targetFromCompact(bits) {
  const b = typeof bits === 'number' ? bits : parseInt(bits, 16);
  const exponent = b >>> 24;
  const mantissa = BigInt(b & 0x007fffff);
  if (exponent <= 3) return mantissa >> BigInt(8 * (3 - exponent));
  return mantissa << BigInt(8 * (exponent - 3));
}

function verifyShare({hashHex, targetHex, targetBigInt, bits}) {
  const h = hashToBigInt(hashHex);
  let t;
  if (typeof targetBigInt === 'bigint') t = targetBigInt;
  else if (targetHex) t = BigInt('0x' + targetHex.replace(/^0x/, ''));
  else if (bits != null) t = targetFromCompact(bits);
  else throw new Error('target required');
  return h <= t;
}

function difficultyFromTarget(targetBigInt) {
  // Conventional: difficulty 1 target corresponds to max target for powLimit-like chains varies.
  // PhantomRider uses 256-bit targets; expose ratio helper as target-based difficulty if caller provides powLimit.
  return targetBigInt;
}

module.exports = {
  HEADER_SIZE,
  DEFAULT_PERSONALIZATION,
  init,
  isReady,
  stop,
  calculateHash,
  hashToBigInt,
  targetFromCompact,
  verifyShare,
  difficultyFromTarget,
  resolveHelperPath,
};
