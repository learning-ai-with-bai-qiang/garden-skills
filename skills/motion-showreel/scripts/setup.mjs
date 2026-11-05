#!/usr/bin/env node
// Cross-platform replacement for setup.sh
// Installs playwright + tone, downloads Chromium, runs check-env.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markEnvOk, ENV_FILE } from './lib/gate.mjs';

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

// 0. 开工先作废旧凭证：中途 Ctrl+C / 安装失败也不会留下可用通行证
try { unlinkSync(ENV_FILE); } catch { /* 文件本来就不存在 */ }


// 1. node
if (!commandExists('node')) {
  console.error('✗ Node.js 18+ is required (https://nodejs.org)');
  process.exit(1);
}

// 2. deps
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

// 3. Chromium
const ok = run('npx', ['--yes', 'playwright', 'install', 'chromium'], { cwd: PROJ || HERE, allowFail: true });
if (!ok) console.warn('! could not download Chromium; render.mjs will fall back to an installed Google Chrome / Edge');

// 4. check-env
const args = [join(HERE, 'check-env.mjs')];
if (PROJ) args.push(PROJ);
const envOk = run('node', args, { allowFail: true });

// 5. 第 0 步门：只有全绿才写标记，后面所有门都以它为前提
if (envOk) {
  markEnvOk({ proj: PROJ || null });
  console.log('\n✓ 第 0 步已记录：env 门通过（7 天内免重跑，但每次开门仍会当场复检 ffmpeg / ffprobe）。');
  console.log('  下一步：第 1 步需求确认 —— 读 references/guided-mode.md，向用户提问，拿到确认后：');
  console.log('  node scripts/gate.mjs init <proj>  然后  node scripts/gate.mjs confirm <proj> requirements --quote "<用户原话>"');
} else {
  // 本次检查失败：旧通行证必须作废，否则下游门仍会按旧标记放行
  try { unlinkSync(ENV_FILE); } catch { /* 文件本来就不存在 */ }
  console.error('\n✗ 环境检查没有全绿，第 0 步门未通过。');
  console.error('  在修好之前，所有带门禁的推进脚本都会被拒绝。');
  process.exit(1);
}
