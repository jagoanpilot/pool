'use strict';

/**
 * Block/job helpers for PhantomRider pool.
 *
 * PoW: PHR-256-YP over serialized 80-byte block header (Bitcoin header layout).
 * Header serialization for hashing (as in node CBlockHeader): nVersion(4 LE), hashPrevBlock(32),
 * hashMerkleRoot(32), nTime(4 LE), nBits(4 LE), nNonce(4 LE).
 *
 * NOTE (penting): PhantomRider node dianalisis sebagai fork Dash-derived dengan coinbase khusus
 * (CbTx/DIP0003, smartnode/superblock/founder payments, coinbase_payload). Konstruksi blok penuh
 * untuk submitblock HARUS divalidasi terhadap node PhantomRider yang berjalan. Modul ini
 * menyediakan logika stratum/job dan verifikasi share PoW; builder submitblock bersifat
 * best-effort berdasarkan template GBT dan perlu penyesuaian konsensus jika node menolak blok.
 */

const crypto = require('crypto');

function sha256d(buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}
function reverse(buf) { return Buffer.from(buf).reverse(); }
function swapWords(buf) {
  const out = Buffer.from(buf);
  for (let i = 0; i + 4 <= out.length; i += 4) {
    const t0 = out[i], t1 = out[i+1]; out[i] = out[i+2]; out[i+1] = out[i+3]; out[i+2] = t1; out[i+3] = t0;
  }
  return out;
}
function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0]=0xfd; b.writeUInt16LE(n,1); return b; }
  if (n <= 0xffffffff) { const b = Buffer.alloc(5); b[0]=0xfe; b.writeUInt32LE(n,1); return b; }
  const b = Buffer.alloc(9); b[0]=0xff; b.writeBigUInt64LE(BigInt(n),1); return b;
}
function scriptNum(n) {
  // minimal CScriptNum encoding for positive ints (BIP34 height)
  if (n === 0) return Buffer.from([0]);
  const neg = n < 0; let abs = Math.abs(n);
  const bytes = [];
  while (abs > 0) { bytes.push(abs & 0xff); abs >>= 8; }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0x00);
  else if (neg) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}
function heightPush(height) {
  if (height >= 1 && height <= 16) return Buffer.from([0x50 + height]);
  const n = scriptNum(height);
  return Buffer.concat([Buffer.from([n.length]), n]);
}
function pushData(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (b.length < 0x4c) return Buffer.concat([Buffer.from([b.length]), b]);
  if (b.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, b.length]), b]);
  throw new Error('push too large');
}

function compactToTarget(bits) {
  const b = typeof bits === 'string' ? parseInt(bits, 16) : bits;
  const exponent = b >>> 24;
  const mantissa = BigInt(b & 0x007fffff);
  if (exponent <= 3) return mantissa >> BigInt(8 * (3 - exponent));
  return mantissa << BigInt(8 * (exponent - 3));
}

function targetToCompact(target) {
  // simplified; good enough for display if needed
  let t = BigInt(target);
  let exponent = 0;
  let mantissa = 0n;
  while (t > 0xffffffn) { t >>= 8n; exponent++; }
  mantissa = t;
  if (mantissa & 0x800000n) { mantissa >>= 8n; exponent++; }
  const compact = (exponent + 3) << 24 | Number(mantissa & 0x7fffffn);
  return compact >>> 0;
}

function buildHeader({version, prevHashInternal, merkleRootInternal, ntime, bits, nonce}) {
  const h = Buffer.alloc(80);
  h.writeInt32LE(version >>> 0, 0);
  Buffer.from(prevHashInternal).copy(h, 4);
  Buffer.from(merkleRootInternal).copy(h, 36);
  h.writeUInt32LE(ntime >>> 0, 68);
  h.writeUInt32LE(bits >>> 0, 72);
  h.writeUInt32LE(nonce >>> 0, 76);
  return h;
}

function merkleBranches(txidsInternal) {
  let level = [null].concat(txidsInternal);
  const steps = [];
  while (level.length > 1) {
    steps.push(level[1] || level[0]);
    if (level.length % 2) level.push(level[level.length - 1]);
    const next = [null];
    for (let i = 2; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i+1]])));
    level = next;
  }
  return steps;
}

function merkleRootFromBranches(coinbaseTxidInternal, branches) {
  let root = coinbaseTxidInternal;
  for (const b of branches) root = sha256d(Buffer.concat([root, b || root]));
  return root;
}

/**
 * Build a basic coinbase split for stratum around extranonce.
 * WARNING: PhantomRider template may require CbTx payload/special outputs; this is a best-effort
 * generic builder. For full consensus compatibility, coinbase must include template-required
 * outputs (smartnode/superblock/founder) and correct coinbase format. Use with caution.
 */
function buildCoinbase(template, poolScriptHex, extraNonceSize, tag) {
  const height = template.height || 0;
  const hPush = heightPush(height);
  const tagBuf = tag ? Buffer.from(String(tag)) : Buffer.alloc(0);
  const tagPush = tagBuf.length ? Buffer.concat([Buffer.from([tagBuf.length]), tagBuf]) : Buffer.alloc(0);
  const scriptLen = hPush.length + 1 + extraNonceSize + tagPush.length;
  if (scriptLen > 100) throw new Error('coinbase scriptsig too large');

  let value = template.coinbasevalue;
  if (!(value > 0)) throw new Error('invalid coinbasevalue');

  const outputs = [];
  // Pool output placeholder (full value minus known required template outputs we can detect)
  let required = 0n;
  const requiredOutputs = [];
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const o of arr) {
      if (o && o.script && o.amount != null) {
        required += BigInt(o.amount);
        requiredOutputs.push({script: Buffer.from(o.script, 'hex'), amount: BigInt(o.amount)});
      }
    }
  };
  collect(template.smartnode);
  collect(template.superblock);
  if (template.founder && template.founder.script && template.founder.amount != null) {
    required += BigInt(template.founder.amount);
    requiredOutputs.push({script: Buffer.from(template.founder.script, 'hex'), amount: BigInt(template.founder.amount)});
  }

  const poolValue = BigInt(value) - required;
  if (poolValue <= 0n) throw new Error('pool coinbase value <= 0 after required outputs; check template');
  outputs.push({script: Buffer.from(poolScriptHex, 'hex'), amount: poolValue});
  for (const o of requiredOutputs) outputs.push(o);

  // If template specifies default_witness_commitment, include it
  if (template.default_witness_commitment) {
    outputs.push({script: Buffer.from(template.default_witness_commitment, 'hex'), amount: 0n});
  }

  const version = Buffer.alloc(4); version.writeInt32LE(1, 0);
  const prevout = Buffer.alloc(32);
  const seq = Buffer.from('ffffffff', 'hex');
  const outCount = varint(outputs.length);
  const outsBuf = Buffer.concat(outputs.map(o => {
    const v = Buffer.alloc(8); v.writeBigUInt64LE(o.amount);
    return Buffer.concat([v, varint(o.script.length), o.script]);
  }));
  const lock = Buffer.alloc(4);

  const coinb1 = Buffer.concat([
    version,
    varint(1),
    prevout, seq,
    varint(scriptLen),
    hPush, Buffer.from([extraNonceSize]),
  ]);
  const coinb2 = Buffer.concat([
    tagPush, seq,
    outCount, outsBuf,
    lock,
  ]);
  return {coinb1, coinb2, poolValue: Number(poolValue), outputs};
}

function buildJob(template, poolScriptHex, extraNonceSize, tag) {
  const coinbase = buildCoinbase(template, poolScriptHex, extraNonceSize, tag);
  const txs = template.transactions || [];
  const txids = txs.map(t => reverse(Buffer.from(t.txid || t.hash, 'hex')));
  const branches = merkleBranches(txids);
  const bitsNum = typeof template.bits === 'string' ? parseInt(template.bits, 16) : template.bits;
  const targetHex = template.target;
  const target = targetHex ? BigInt('0x' + targetHex) : compactToTarget(bitsNum);
  const prevInternal = reverse(Buffer.from(template.previousblockhash, 'hex'));
  return {
    height: template.height,
    version: template.version >>> 0,
    versionHex: (template.version >>> 0).toString(16).padStart(8, '0'),
    bits: bitsNum >>> 0,
    bitsHex: (typeof template.bits === 'string' ? template.bits : bitsNum.toString(16)).padStart(8, '0'),
    time: template.curtime,
    mintime: template.mintime || template.curtime,
    target,
    targetHex: target.toString(16).padStart(64, '0'),
    prevHash: template.previousblockhash,
    prevInternal,
    coinb1: coinbase.coinb1,
    coinb2: coinbase.coinb2,
    branches,
    transactions: txs.map(t => t.data),
    rawTransactions: txs,
    poolValue: coinbase.poolValue,
    template,
    created: Date.now(),
  };
}

function notifyParams(job, jobId, clean) {
  return [
    jobId,
    swapWords(job.prevInternal).toString('hex'),
    job.coinb1.toString('hex'),
    job.coinb2.toString('hex'),
    job.branches.map(b => b.toString('hex')),
    job.versionHex,
    job.bitsHex,
    (job.time >>> 0).toString(16).padStart(8, '0'),
    !!clean,
  ];
}

function coinbaseFor(job, extraNonceBuf) {
  const tx = Buffer.concat([job.coinb1, extraNonceBuf, job.coinb2]);
  return {tx, txid: sha256d(tx)};
}

function serializeBlock(job, header, coinbaseTx) {
  // Best-effort serialization: header + varint(txcount) + coinbase + txs.
  // PhantomRider/Dash-derived blocks may have special fields; submitblock expects full block hex.
  const count = 1 + job.transactions.length;
  return header.toString('hex') + varint(count).toString('hex') + coinbaseTx.toString('hex') + job.transactions.join('');
}

module.exports = {
  sha256d, reverse, swapWords, varint, compactToTarget, targetToCompact,
  buildHeader, merkleBranches, merkleRootFromBranches, buildJob, notifyParams,
  coinbaseFor, serializeBlock,
};
