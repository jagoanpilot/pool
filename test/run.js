'use strict';
const {spawnSync} = require('child_process');
const path = require('path');

const tests = ['algorithm.test.js'];
let failed = 0;
for (const t of tests) {
  console.log(`\n>>> node test/${t}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], {stdio: 'inherit'});
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
