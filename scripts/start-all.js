'use strict';
// Menjalankan gateway + dua service sekaligus dengan output berawalan.
const { spawn } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const procs = [
  ['transkrip', 'service-transkrip/app.js'],
  ['nilai', 'service-nilai/app.js'],
  ['gateway', 'gateway/app.js'],
].map(([name, file]) => {
  const p = spawn(process.execPath, [path.join(root, file)], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(d));
  p.stderr.on('data', (d) => process.stderr.write(d));
  p.on('exit', (code) => { console.error(`[${name}] berhenti (kode ${code})`); shutdown(code || 1); });
  return p;
});
function shutdown(code) { procs.forEach((p) => p.kill()); process.exit(code); }
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
