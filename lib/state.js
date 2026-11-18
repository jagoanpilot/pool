'use strict';

// Shared runtime state and simple stats for dashboard/API.
const os = require('os');

const state = {
  startedAt: Date.now(),
  algorithmReady: false,
  rpc: {ok: false, lastError: null, lastOkAt: null},
  stratum: {ok: false, host: null, port: null},
  dashboard: {ok: false, host: null, port: null},
  currentJob: null,
  network: {height: null, difficulty: null, target: null, prevhash: null},
  pool: {hashrate: 0, miners: 0, workers: 0, accepted: 0, rejected: 0, stale: 0, blocksFound: 0},
  lastBlock: null,
};

function uptimeSec() { return Math.floor((Date.now() - state.startedAt) / 1000); }

function snapshot() {
  return {
    ok: true,
    uptimeSec: uptimeSec(),
    platform: os.platform(),
    node: process.version,
    ...state,
  };
}

module.exports = {state, snapshot, uptimeSec};
