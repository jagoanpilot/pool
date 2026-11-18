#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const http = require('http');

const root = path.resolve(__dirname, '..');
const configPath = process.env.POOL_CONFIG || path.join(root, 'config', 'pool.yaml');
const pidFile = path.join(root, 'data', 'pool.pid');

function ensureData() { fs.mkdirSync(path.join(root, 'data'), {recursive: true}); fs.mkdirSync(path.join(root, 'data', 'logs'), {recursive: true}); }

function readPid() {
  try { return parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10) || null; } catch (_) { return null; }
}
function isRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function loadCfg() {
  // lazy require deps (yaml) after install
  const {loadConfig} = require('../lib/config');
  return loadConfig(configPath);
}

function fetchStatus(cfg) {
  return new Promise((resolve) => {
    if (!cfg || !cfg.dashboard) return resolve(null);
    const req = http.get({hostname: cfg.dashboard.host === '0.0.0.0' ? '127.0.0.1' : cfg.dashboard.host, port: cfg.dashboard.port, path: '/api/status', timeout: 1500}, (res) => {
      let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ try{resolve(JSON.parse(d));}catch(_){resolve(null);} });
    });
    req.on('error', ()=>resolve(null));
    req.on('timeout', ()=>{ req.destroy(); resolve(null); });
  });
}

async function cmdStart(args) {
  const foreground = args.includes('--foreground') || args.includes('-f');
  ensureData();
  const pid = readPid();
  if (isRunning(pid)) { console.log('Pool sudah berjalan (PID ' + pid + ')'); return; }
  if (foreground) {
    const {start} = require('../lib/server');
    const cfg = loadCfg();
    fs.writeFileSync(pidFile, String(process.pid));
    await start(cfg);
    return; // keep running
  }
  const out = fs.openSync(path.join(root, 'data', 'logs', 'pool.out.log'), 'a');
  const err = fs.openSync(path.join(root, 'data', 'logs', 'pool.out.log'), 'a');
  const child = spawn(process.execPath, [__filename, 'start', '--foreground'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, err],
    env: {...process.env, POOL_CONFIG: configPath},
    windowsHide: true,
  });
  fs.writeFileSync(pidFile, String(child.pid));
  child.unref();
  console.log('Pool dimulai (PID ' + child.pid + '). Gunakan `pool status` atau `pool logs`.');
}

async function cmdStop() {
  const pid = readPid();
  if (!pid || !isRunning(pid)) { console.log('Pool tidak berjalan.'); try{fs.unlinkSync(pidFile);}catch(_){}; return; }
  try { process.kill(pid, 'SIGTERM'); } catch (e) { console.log('Gagal stop:', e.message); return; }
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (!isRunning(pid)) break;
    await new Promise(r=>setTimeout(r, 300));
  }
  if (isRunning(pid) && process.platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch(_){} }
  try { fs.unlinkSync(pidFile); } catch(_){}
  console.log('Pool dihentikan.');
}

async function cmdStatus() {
  const pid = readPid();
  const running = isRunning(pid);
  console.log('Process:', running ? ('RUNNING (PID ' + pid + ')') : 'STOPPED');
  try {
    const cfg = loadCfg();
    const st = await fetchStatus(cfg);
    if (st) {
      console.log('Dashboard:', 'OK', `${cfg.dashboard.host}:${cfg.dashboard.port}`);
      console.log('RPC:', st.rpc && st.rpc.ok ? 'OK' : ('ERR - ' + (st.rpc && st.rpc.lastError || 'n/a')));
      console.log('Algorithm helper:', st.algorithmReady ? 'READY' : 'NOT READY');
      console.log('Stratum:', st.stratum && st.stratum.ok ? `OK ${st.stratum.host}:${st.stratum.port}` : 'NOT LISTENING');
      console.log('Height:', st.network && st.network.height != null ? st.network.height : 'n/a');
      console.log('Miners:', st.pool && st.pool.miners != null ? st.pool.miners : 0, 'Workers:', st.pool && st.pool.workers != null ? st.pool.workers : 0);
      console.log('Shares accepted/rejected/stale:', `${st.pool&&st.pool.accepted||0}/${st.pool&&st.pool.rejected||0}/${st.pool&&st.pool.stale||0}`);
      console.log('Blocks found:', st.pool && st.pool.blocksFound != null ? st.pool.blocksFound : 0);
    } else {
      console.log('Dashboard/API: tidak dapat dihubungi (mungkin belum siap atau dashboard nonaktif).');
    }
  } catch (e) {
    console.log('Status detail tidak tersedia:', e.message);
  }
}

function cmdLogs(args) {
  const logFile = path.join(root, 'data', 'logs', 'pool.log');
  const outFile = path.join(root, 'data', 'logs', 'pool.out.log');
  const file = fs.existsSync(logFile) ? logFile : outFile;
  if (!fs.existsSync(file)) { console.log('Belum ada log.'); return; }
  if (args.includes('-f') || args.includes('--follow')) {
    const {spawnSync} = require('child_process');
    if (process.platform === 'win32') {
      // simple tail loop
      let pos = Math.max(0, fs.statSync(file).size - 4000);
      console.log('--- tail -f (Ctrl+C untuk keluar) ---');
      const timer = setInterval(()=>{
        try {
          const st = fs.statSync(file);
          if (st.size < pos) pos = 0;
          if (st.size > pos) {
            const fd = fs.openSync(file,'r');
            const buf = Buffer.alloc(st.size - pos);
            fs.readSync(fd, buf, 0, buf.length, pos);
            fs.closeSync(fd);
            process.stdout.write(buf.toString('utf8'));
            pos = st.size;
          }
        } catch(_){}
      }, 500);
      process.on('SIGINT', ()=>{ clearInterval(timer); process.exit(0); });
      return;
    } else {
      const p = spawn('tail', ['-n','100','-f', file], {stdio:'inherit'});
      p.on('exit', code=>process.exit(code||0));
      return;
    }
  }
  const n = 100;
  const data = fs.readFileSync(file, 'utf8');
  const lines = data.split(/\r?\n/);
  console.log(lines.slice(-n).join('\n'));
}

function cmdConfig() {
  const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
  const {spawnSync} = require('child_process');
  spawnSync(editor, [configPath], {stdio: 'inherit', shell: process.platform === 'win32'});
}

async function cmdUpdate() {
  console.log('Update: tarik source terbaru di direktori instalasi, rebuild algorithm helper bila perlu, lalu `pool restart`.');
  console.log('Linux:   git pull && npm install --omit=dev && npm run build:algo && sudo systemctl restart phantomrider-pool');
  console.log('Windows: git pull; npm install --omit=dev; npm run build:algo; Restart-Service phantomrider-pool (jika terpasang)');
}

async function cmdUninstall() {
  console.log('Gunakan scripts/uninstall.sh (Linux) atau scripts/uninstall.ps1 (Windows) untuk uninstall aman.');
}

async function cmdInstallHint() {
  console.log('Gunakan installer:');
  console.log('  Windows: .\\scripts\\install.ps1');
  console.log('  Linux:   sudo ./scripts/install.sh');
}

async function main() {
  const [,, cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'start': return cmdStart(rest);
    case 'stop': return cmdStop();
    case 'restart': await cmdStop(); return cmdStart(rest);
    case 'status': return cmdStatus();
    case 'logs': return cmdLogs(rest);
    case 'config': return cmdConfig();
    case 'update': return cmdUpdate();
    case 'uninstall': return cmdUninstall();
    case 'install': return cmdInstallHint();
    case 'help': case undefined: case '-h': case '--help':
      console.log(`PhantomRider Pool CLI
Usage: pool <command>
  start [--foreground]   Mulai pool
  stop                   Hentikan pool
  restart                Restart pool
  status                 Status pool & komponen
  logs [-f]              Tampilkan log
  config                 Edit config/pool.yaml
  update                 Petunjuk update
  uninstall              Petunjuk uninstall`);
      return;
    default:
      console.error('Perintah tidak dikenal:', cmd);
      process.exit(1);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
