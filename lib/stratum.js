'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./logger');
const rpc = require('./rpc');
const db = require('./db');
const block = require('./block');
const algo = require('../algorithm/phantomrider/adapter');
const {state} = require('./state');

const TWO_64_1 = 18446744073709551615n;
const TWO_256 = 1n << 256n;

function shareLimit(diff) {
  const d = BigInt(Math.max(1, Math.round(Number(diff))));
  return TWO_64_1 / d;
}

class StratumServer {
  constructor(cfg) {
    this.cfg = cfg;
    this.miners = new Set();
    this.jobs = new Map();
    this.currentJob = null;
    this.jobSeq = 0;
    this.refreshing = false;
    this.lastTip = null;
    this.lastTemplateAt = 0;
    this.templateErrorAt = 0;
    this.templateErrorMsg = '';
    this.extraNonceCounter = crypto.randomBytes(2).readUInt16BE(0);
    this.poolScriptHex = null; // set from config/pool address (needs conversion) - not always known
    this.connectionsByIp = new Map();
    this.totalConnections = 0;
    this.accepted = 0; this.rejected = 0; this.stale = 0; this.blocksFound = 0;
    this.diffMemory = new Map();
    this.banned = new Map();
  }

  async start() {
    // init algorithm helper
    const helperPath = this.cfg.algorithm.helper_path || undefined;
    const info = algo.init({path: helperPath, threads: this.cfg.algorithm.helper_threads || 2});
    logger.info('algo', 'PHR-256-YP helper: %s (threads=%d)', [info.helperPath, info.threads]);
    state.algorithmReady = algo.isReady();

    if (!this.cfg.stratum || this.cfg.stratum.port == null) throw new Error('stratum.port tidak dikonfigurasi');
    await this.listen();
    await this.refreshTemplate();
    this.refreshTimer = setInterval(() => this.refreshTemplate().catch(()=>{}), 1000);
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  stop() {
    clearInterval(this.refreshTimer);
    clearInterval(this.cleanupTimer);
    if (this.server) try { this.server.close(); } catch (_) {}
    for (const m of this.miners) try { m.destroy(); } catch (_) {}
    algo.stop();
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onConn = (socket) => this.onConnection(socket);
      let server;
      if (this.cfg.stratum.tls) {
        try {
          const opts = {
            cert: fs.readFileSync(this.cfg.stratum.tls_cert),
            key: fs.readFileSync(this.cfg.stratum.tls_key),
            minVersion: 'TLSv1.2',
          };
          server = tls.createServer(opts, onConn);
        } catch (e) {
          return reject(new Error('TLS config error: ' + e.message));
        }
      } else {
        server = net.createServer(onConn);
      }
      server.on('error', reject);
      server.listen(this.cfg.stratum.port, this.cfg.stratum.host || '0.0.0.0', () => {
        this.server = server;
        state.stratum = {ok: true, host: this.cfg.stratum.host || '0.0.0.0', port: this.cfg.stratum.port};
        logger.info('stratum', 'Stratum listening on %s:%d', [state.stratum.host, state.stratum.port]);
        resolve();
      });
    });
  }

  cleanup() {
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, v] of this.diffMemory) if (v.seen < cutoff) this.diffMemory.delete(k);
    for (const [ip, t] of this.banned) if (Date.now() - t > 10 * 60 * 1000) this.banned.delete(ip);
  }

  getPoolScriptHex() {
    // Requires address->script conversion for PhantomRider. Not implemented generically without
    // chain-specific base58/version bytes. Expect config to provide pool payout script hex if needed.
    if (this.cfg.mining && this.cfg.mining.pool_script_hex) return this.cfg.mining.pool_script_hex;
    if (this.cfg.rewards && this.cfg.rewards.pool_script_hex) return this.cfg.rewards.pool_script_hex;
    return null;
  }

  async refreshTemplate() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const tip = await rpc.callRpcAsync(this.cfg, 'getbestblockhash', []);
      const now = Date.now();
      if (tip === this.lastTip && this.currentJob && now - this.lastTemplateAt < 30000) {
        state.rpc = {ok: true, lastError: null, lastOkAt: now};
        this.refreshing = false; return;
      }
      let tpl;
      try {
        tpl = await rpc.callRpcAsync(this.cfg, 'getblocktemplate', [{rules: ['segwit']}]);
      } catch (e) {
        // try without params
        tpl = await rpc.callRpcAsync(this.cfg, 'getblocktemplate', []);
      }
      const poolScript = this.getPoolScriptHex();
      if (!poolScript) {
        throw new Error('mining.pool_script_hex (atau rewards.pool_script_hex) wajib diisi: konversi alamat PhantomRider ke scriptPubKey bergantung pada format alamat chain dan belum dikonfigurasi.');
      }
      if (tpl.previousblockhash !== tip) { this.refreshing = false; return; }
      const job = block.buildJob(tpl, poolScript, 8, this.cfg.mining && this.cfg.mining.coinbase_tag || '/PhantomRiderPool/');
      const newBlock = !this.currentJob || this.currentJob.height !== job.height || this.currentJob.prevHash !== job.prevHash;
      this.lastTip = tip; this.lastTemplateAt = now;
      job.id = String(++this.jobSeq);
      this.jobs.set(job.id, job);
      this.currentJob = job;
      for (const [id, j] of this.jobs) {
        if (j.height < job.height || now - j.created > 10*60*1000 || Number(id) < this.jobSeq - 30) this.jobs.delete(id);
      }
      state.rpc = {ok: true, lastError: null, lastOkAt: now};
      state.algorithmReady = algo.isReady();
      state.currentJob = {id: job.id, height: job.height, prevHash: job.prevHash, bits: job.bitsHex, time: job.time};
      state.network = {height: job.height, target: job.targetHex, prevhash: job.prevHash, bits: job.bitsHex};
      if (newBlock) logger.info('pool', 'New job height=%d target=%s', [job.height, job.targetHex]);
      for (const m of this.miners) m.sendJob(newBlock);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (msg !== this.templateErrorMsg || Date.now() - this.templateErrorAt > 30000) {
        this.templateErrorMsg = msg; this.templateErrorAt = Date.now();
        logger.error('rpc', 'Template refresh failed: %s', [msg]);
      }
      state.rpc = {ok: false, lastError: msg, lastOkAt: state.rpc.lastOkAt};
    } finally {
      this.refreshing = false;
    }
  }

  onConnection(socket) {
    const ip = (socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!ip) return socket.destroy();
    const perIp = this.connectionsByIp.get(ip) || 0;
    if (this.totalConnections >= (this.cfg.mining.max_connections || 2000)) return socket.destroy();
    if (perIp >= (this.cfg.mining.max_connections_per_ip || 100)) return socket.destroy();
    this.connectionsByIp.set(ip, perIp + 1);
    this.totalConnections++;

    const en1 = Buffer.alloc(4);
    en1.writeUInt16BE(this.extraNonceCounter = (this.extraNonceCounter + 1) & 0xffff, 0);
    crypto.randomBytes(2).copy(en1, 2);
    const miner = this.createMiner(socket, ip, en1);
    this.miners.add(miner);

    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);

    const loginTimeout = setTimeout(() => {
      if (!miner.authorized) miner.destroy('login timeout');
    }, (this.cfg.mining.login_timeout_sec || 20) * 1000);

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line) miner.onLine(line);
      }
      if (buffer.length > 16384) miner.destroy('oversized line');
    });
    socket.on('error', () => miner.destroy('socket error'));
    socket.on('close', () => {
      clearTimeout(loginTimeout);
      this.miners.delete(miner);
      this.connectionsByIp.set(ip, Math.max(0, (this.connectionsByIp.get(ip)||1) - 1));
      this.totalConnections = Math.max(0, this.totalConnections - 1);
      if (miner.address) logger.info('stratum', 'Miner disconnected %s@%s', [miner.workerName ? miner.address+'.'+miner.workerName : miner.address, ip]);
    });

    miner.cleanupLoginTimer = () => clearTimeout(loginTimeout);
  }

  createMiner(socket, ip, extraNonce1) {
    const srv = this;
    const m = this.cfg.mining || {};
    const miner = {
      socket, ip, extraNonce1,
      id: crypto.randomBytes(8).toString('hex'),
      authorized: false, subscribed: false,
      address: null, workerName: null, rewardType: 'prop',
      diff: Math.min(Math.max(m.default_difficulty || 256, m.min_difficulty || 1), m.max_difficulty || 1000000),
      sent: new Map(),
      sendSeq: 0,
      shareTimes: [],
      lastRetarget: Date.now(),
      seenNonces: new Map(),
      destroy(reason) {
        if (miner.dead) return; miner.dead = true;
        if (miner.cleanupLoginTimer) miner.cleanupLoginTimer();
        try { socket.destroy(); } catch (_) {}
      },
      send(obj) {
        if (miner.dead || !socket.writable) return;
        try { socket.write(JSON.stringify(obj) + '\n'); } catch (_) {}
      },
      reply(id, result, error) {
        miner.send({id, result, error: error ? [error.code || 20, error.message, null] : null});
      },
      sendJob(clean) {
        if (!miner.authorized || !srv.currentJob) return;
        const job = srv.currentJob;
        miner.sendSeq++;
        const jid = job.id + '.' + miner.sendSeq;
        miner.sent.set(jid, {job, diff: miner.diff, nonces: new Set()});
        while (miner.sent.size > 40) miner.sent.delete(miner.sent.keys().next().value);
        const stratumDiff = Math.max(miner.diff / 65536, 1 / 16384);
        miner.send({id: null, method: 'mining.set_difficulty', params: [stratumDiff]});
        miner.send({id: null, method: 'mining.notify', params: block.notifyParams(job, jid, !!clean)});
      },
      onLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch (_) { return miner.destroy('bad json'); }
        if (!msg || typeof msg !== 'object') return;
        switch (msg.method) {
          case 'mining.subscribe': return srv.onSubscribe(miner, msg);
          case 'mining.authorize': return srv.onAuthorize(miner, msg);
          case 'mining.submit': return srv.onSubmit(miner, msg);
          case 'mining.extranonce.subscribe': return miner.reply(msg.id, true);
          default: return miner.reply(msg.id, msg.method === 'mining.configure' ? {} : true);
        }
      }
    };
    return miner;
  }

  onSubscribe(miner, msg) {
    miner.subscribed = true;
    miner.reply(msg.id, [[['mining.set_difficulty', 'sd'+miner.id], ['mining.notify', 'nt'+miner.id]], miner.extraNonce1.toString('hex'), 4]);
  }

  parseLogin(user, pass) {
    if (typeof user !== 'string' || !user.length) return {error: 'Invalid login'};
    let rewardType = 'prop';
    let rest = user;
    if (rest.startsWith('solo:')) { rewardType = 'solo'; rest = rest.slice(5); }
    else if (rest.startsWith('prop:')) { rewardType = 'prop'; rest = rest.slice(5); }
    let worker = null;
    const sep = rest.search(/[.+]/);
    let address = rest;
    if (sep !== -1) { worker = rest.slice(sep + 1).slice(0, 32) || null; address = rest.slice(0, sep); }
    if (!worker && typeof pass === 'string' && pass !== 'x' && pass) worker = pass.slice(0, 32);
    if (!/^[A-Za-z0-9]{20,64}$/.test(address)) return {error: 'Invalid address format'};
    return {address, workerName: worker, rewardType};
  }

  onAuthorize(miner, msg) {
    const p = msg.params || [];
    const parsed = this.parseLogin(p[0], p[1]);
    if (parsed.error) {
      miner.reply(msg.id, null, {code: 24, message: parsed.error});
      return setTimeout(() => miner.destroy('unauthorized'), 50);
    }
    if (!this.currentJob) {
      miner.reply(msg.id, null, {code: 20, message: 'Pool starting (no template yet)'});
      return setTimeout(() => miner.destroy('no job'), 50);
    }
    miner.address = parsed.address;
    miner.workerName = parsed.workerName;
    miner.rewardType = parsed.rewardType;
    miner.authorized = true;
    if (miner.cleanupLoginTimer) miner.cleanupLoginTimer();
    logger.info('stratum', 'Authorized %s worker=%s type=%s ip=%s', [miner.address, miner.workerName, miner.rewardType, miner.ip]);
    miner.reply(msg.id, true);
    miner.sendJob(true);
  }

  rejectShare(miner, msg, reason, count = true) {
    if (count) {
      this.rejected++;
      db.recordShare({address: miner.address, worker: miner.workerName, difficulty: miner.diff, valid: false, stale: false, rewardType: miner.rewardType});
    }
    miner.reply(msg && msg.id, null, {code: 23, message: reason});
  }

  async onSubmit(miner, msg) {
    if (!miner.authorized) return miner.reply(msg.id, null, {code: 24, message: 'Unauthorized'});
    const params = msg.params || [];
    const jobId = String(params[1] || '');
    const sent = miner.sent.get(jobId);
    if (!sent || !this.currentJob || sent.job.height !== this.currentJob.height || sent.job.prevHash !== this.currentJob.prevHash) {
      this.stale++;
      db.recordShare({address: miner.address, worker: miner.workerName, difficulty: sent ? sent.diff : miner.diff, valid: false, stale: true, rewardType: miner.rewardType});
      return miner.reply(msg.id, null, {code: 21, message: 'Job not found / stale'});
    }
    const job = sent.job;
    const en2 = String(params[2] || '').toLowerCase();
    const ntimeHex = String(params[3] || '').toLowerCase();
    const nonceHex = String(params[4] || '').toLowerCase();
    if (en2.length !== 8 || !/^[0-9a-f]+$/.test(en2)) return this.rejectShare(miner, msg, 'Invalid extranonce2', false);
    if (!/^[0-9a-f]{8}$/.test(ntimeHex) || !/^[0-9a-f]{8}$/.test(nonceHex)) return this.rejectShare(miner, msg, 'Invalid ntime/nonce', false);
    const ntime = parseInt(ntimeHex, 16);
    const nonce = parseInt(nonceHex, 16);
    const key = en2 + ntimeHex + nonceHex;
    if (sent.nonces.has(key)) return miner.reply(msg.id, null, {code: 22, message: 'Duplicate'});

    const cb = block.coinbaseFor(job, Buffer.concat([miner.extraNonce1, Buffer.from(en2, 'hex')]));
    const merkle = block.merkleRootFromBranches(cb.txid, job.branches);
    const header = block.buildHeader({version: job.version, prevHashInternal: job.prevInternal, merkleRootInternal: merkle, ntime, bits: job.bits, nonce});

    let hashHex;
    try {
      hashHex = await algo.calculateHash(header);
    } catch (e) {
      return miner.reply(msg.id, null, {code: 20, message: 'Hash error: ' + e.message});
    }
    const hashInt = BigInt('0x' + hashHex);
    const limit = shareLimit(sent.diff);
    if (hashInt > limit) return this.rejectShare(miner, msg, 'Low difficulty share', true);

    sent.nonces.add(key);
    const isBlock = hashInt <= job.target;
    this.accepted++;
    const weight = sent.diff; // simplified PPLNS weight basis
    db.recordShare({address: miner.address, worker: miner.workerName, difficulty: sent.diff, weight, valid: true, stale: false, height: job.height, blockCandidate: isBlock, rewardType: miner.rewardType});
    miner.reply(msg.id, true);
    this.updatePoolStats();
    this.retarget(miner);

    if (isBlock) {
      await this.submitBlock(job, header, cb.tx, hashHex, miner);
    }
  }

  retarget(miner) {
    const m = this.cfg.mining || {};
    if (!m.vardiff) return;
    const now = Date.now();
    miner.shareTimes.push(now);
    if (miner.shareTimes.length > 30) miner.shareTimes.shift();
    if (now - miner.lastRetarget < (m.retarget_time || 60) * 1000 || miner.shareTimes.length < 4) return;
    miner.lastRetarget = now;
    const span = (miner.shareTimes[miner.shareTimes.length - 1] - miner.shareTimes[0]) / 1000 / (miner.shareTimes.length - 1);
    const target = m.target_share_time || 15;
    let ratio = target / (span || 0.1);
    if (Math.abs(1 - ratio) * 100 < (m.variance_percent || 30)) return;
    let nd = miner.diff * ratio;
    const jump = (m.max_jump_percent || 100) / 100;
    nd = Math.min(Math.max(nd, miner.diff * (1 - jump/(1+jump))), miner.diff * (1 + jump));
    nd = Math.round(Math.min(Math.max(nd, m.min_difficulty || 1), m.max_difficulty || 1000000));
    if (nd !== miner.diff) {
      miner.diff = nd;
      miner.shareTimes.length = 0;
      miner.sendJob(false);
    }
  }

  async submitBlock(job, header, coinbaseTx, powHashHex, miner) {
    this.blocksFound++;
    logger.info('pool', 'BLOCK CANDIDATE height=%d by %s worker=%s', [job.height, miner.address, miner.workerName || '-']);
    const blockHex = block.serializeBlock(job, header, coinbaseTx);
    let result;
    try {
      result = await rpc.callRpcAsync(this.cfg, 'submitblock', [blockHex]);
    } catch (e) {
      logger.error('pool', 'submitblock error: %s (konstruksi blok mungkin perlu disesuaikan dengan konsensus PhantomRider)', [e.message]);
      db.recordBlock({height: job.height, hash: null, powHash: powHashHex, address: miner.address, worker: miner.workerName, status: 'submit_error:' + e.message});
      return;
    }
    if (result === null || result === undefined) {
      const blockHash = block.reverse(block.sha256d(header)).toString('hex');
      logger.info('pool', 'BLOCK ACCEPTED height=%d hash=%s', [job.height, blockHash]);
      db.recordBlock({height: job.height, hash: blockHash, powHash: powHashHex, address: miner.address, worker: miner.workerName, status: 'accepted'});
      state.lastBlock = {height: job.height, hash: blockHash, ts: Date.now()};
      setTimeout(() => this.refreshTemplate().catch(()=>{}), 100);
    } else {
      logger.warn('pool', 'Block rejected by node: %j', [result]);
      db.recordBlock({height: job.height, hash: null, powHash: powHashHex, address: miner.address, worker: miner.workerName, status: 'rejected:' + String(result)});
    }
  }

  updatePoolStats() {
    const ov = db.getOverview();
    state.pool = {
      ...state.pool,
      miners: ov.miners,
      workers: ov.workers,
      accepted: this.accepted,
      rejected: this.rejected,
      stale: this.stale,
      blocksFound: ov.blocksFound || this.blocksFound,
    };
  }
}

module.exports = {StratumServer};
