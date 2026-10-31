#!/usr/bin/env node
// Cross-platform replacement for setup.sh
// Installs playwright + tone, downloads Chromium, runs check-env.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = process.argv[2] || '';
const isWin = process.platform === 'win32';

function commandExists(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { stdio: 'ignore', shell: isWin });
  return !r.error && r.status === 0;
}

function run(cmd, args, opts = {}) {
  const { allowFail = false, ...rest } = opts;
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...rest });
  if (r.status !== 0 && !allowFail) process.exit(r.status ?? 1);
  return r.status === 0;
}

// 1. node
if (!commandExists('node')) {
  console.error('✗ Node.js 18+ is required (https://nodejs.org)');
  process.exit(1);
}

// 2. ffmpeg (warn only)
if (!commandExists('ffmpeg', ['-version'])) {
  console.warn('✗ ffmpeg missing: macOS "brew install ffmpeg" · Windows "winget install ffmpeg" · Linux "apt install ffmpeg"');
}

// 3. deps
const hasHere = existsSync(join(HERE, 'node_modules', 'playwright')) && existsSync(join(HERE, 'node_modules', 'tone'));
const hasProj = PROJ && existsSync(join(PROJ, 'node_modules', 'playwright')) && existsSync(join(PROJ, 'node_modules', 'tone'));

if (hasHere) {
  console.log('✓ playwright + tone already installed');
} else if (hasProj) {
  console.log('✓ playwright + tone already installed in project');
} else {
  console.log(`→ installing playwright + tone into ${HERE}`);
  const registry = process.env.npm_config_registry || 'https://registry.npmmirror.com';
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `--registry=${registry}`], { cwd: HERE });
}

// 4. Chromium
const ok = run('npx', ['--yes', 'playwright', 'install', 'chromium'], { cwd: PROJ || HERE, allowFail: true });
if (!ok) console.warn('! could not download Chromium; render.mjs will fall back to an installed Google Chrome / Edge');

// 5. check-env
const args = [join(HERE, 'check-env.mjs')];
if (PROJ) args.push(PROJ);
run('node', args);