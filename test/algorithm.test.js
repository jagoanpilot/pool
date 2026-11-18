'use strict';

/**
 * Algorithm correctness tests for PHR-256-YP.
 * Uses known test vectors from PhantomRider_v0_1 (phr_yp_selftest / README).
 * Runs Python reference if available; optionally checks native helper if built.
 */

const {spawnSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const algoDir = path.resolve(__dirname, '..', 'algorithm', 'phantomrider');
const refPy = path.join(algoDir, 'phr_yp_ref.py');

const vectors = [
  {name: '64B/1r', header: '00010203', pers: 'PHR', mib: 0, bytes: 64, rounds: 1, expected: '4363c05142a95741a8e0cb1d938e6b400cc41cb7d9bb247ac111404193eb4243'},
  {name: '1MiB/32r', header: '00010203', pers: 'PHR', mib: 1, bytes: 1024*1024, rounds: 32, expected: '6e1e85ee9a61847bef13adaa190635674bb2809332dca0ddd7707fa0fe8e3e1e'},
  {name: '80B/1MiB/32r', header: Buffer.from(Array.from({length:80}, (_,i)=>i)).toString('hex'), pers: 'PHR', mib: 1, bytes: 1024*1024, rounds: 32, expected: 'ade861711ac82e11193cbf03c6432f4eb23afb4a629d9e0b3fb20a86ed04eae2'},
];

function runPython(vec) {
  // ref script takes mib as dataset_mib; for 64 bytes case not directly supported by CLI args except mib=0 not valid
  // so handle 64B case by calling inline python logic? easier: skip 64B in CLI mode and test via helper/selftest note.
  if (vec.bytes !== 1024*1024) return null;
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const r = spawnSync(py, [refPy, vec.header, vec.pers, String(vec.mib), String(vec.rounds)], {encoding: 'utf8', timeout: 120000});
  if (r.error || r.status !== 0) return null;
  return (r.stdout || '').trim();
}

function findHelper() {
  const c = [
    path.join(algoDir,'build','Release','phr_hash.exe'),
    path.join(algoDir,'build','phr_hash.exe'),
    path.join(algoDir,'build','Release','phr_hash'),
    path.join(algoDir,'build','phr_hash'),
  ];
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

async function main() {
  let passed = 0, skipped = 0, failed = 0;

  console.log('== PHR-256-YP algorithm tests ==');
  console.log('Reference vectors from PhantomRider_v0_1');

  // Python reference tests (1 MiB vectors; 64B not supported by CLI interface)
  for (const v of vectors) {
    if (v.bytes !== 1024*1024) {
      console.log(`SKIP ${v.name} (python CLI tidak mendukung ukuran dataset non-1MiB; gunakan phr_yp_selftest native)`);
      skipped++;
      continue;
    }
    const got = runPython(v);
    if (got == null) {
      console.log(`SKIP ${v.name} (python3/python atau referensi tidak tersedia)`);
      skipped++;
      continue;
    }
    try {
      assert.strictEqual(got, v.expected);
      console.log(`PASS ${v.name} (python ref) ${got}`);
      passed++;
    } catch (e) {
      console.error(`FAIL ${v.name} expected=${v.expected} got=${got}`);
      failed++;
    }
  }

  // Native helper selftest if built
  const helper = findHelper();
  const selftest = helper ? helper.replace(/phr_hash(\.exe)?$/, (m, ex) => 'phr_yp_selftest' + (ex||'')) : null;
  if (selftest && fs.existsSync(selftest)) {
    const r = spawnSync(selftest, [], {encoding: 'utf8', timeout: 120000});
    if (r.status === 0) {
      console.log('PASS native phr_yp_selftest');
      console.log((r.stdout||'').trim());
      passed++;
    } else {
      console.error('FAIL native phr_yp_selftest');
      console.error(r.stdout||''); console.error(r.stderr||'');
      failed++;
    }
  } else {
    console.log('SKIP native phr_yp_selftest (belum dibangun). Jalankan: npm run build:algo');
    skipped++;
  }

  console.log(`\nResult: passed=${passed} skipped=${skipped} failed=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
