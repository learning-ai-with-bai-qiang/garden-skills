#!/usr/bin/env node
// build.mjs — one-command rebuild of the film + its technical acceptance.
// SKILL and AUDIO are filled in by scaffold.mjs.
// FPS / SIZE / AUDIO / AUDIO_FILE / LOOP / DETERMINISM / TEXTCHECK are env vars, same as build.sh.
// Extra CLI args go to render.mjs (quality only): node build.mjs --subframes 2 --grain 4
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

const SKILL = process.env.SKILL || '__SKILL_DIR__';
const FPS = process.env.FPS || '30';
const SIZE = process.env.SIZE || '1920x1080';
const AUDIO = process.env.AUDIO || '__AUDIO__';
const AUDIO_FILE = process.env.AUDIO_FILE || 'audio/final.wav';
const LOOP = process.env.LOOP || '0';
const DETERMINISM = process.env.DETERMINISM || '1';
const TEXTCHECK = process.env.TEXTCHECK || '1';

function run(cmd, args, opts = {}) {
  const { allowFail = false, ...rest } = opts;
    const needsShell = isWin && /^(npm|npx)$/.test(cmd);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: needsShell, cwd: HERE, ...rest });
  if (r.status !== 0 && !allowFail) process.exit(r.status ?? 1);
  return r.status === 0;
}
function die(msg) { console.log(msg); process.exit(1); }

// ── 门禁：build = 出片 + 验收，属于第 7 步。
// 用户没在第 6 步说过"可以导出"，这里直接拒绝（exit 2），不产出 MP4。
const { assertGate } = await import(pathToFileURL(join(SKILL, 'scripts', 'lib', 'gate.mjs')).href);
assertGate(HERE, 'export', 'build.mjs 出片 + 技术验收（第 7 步）');

// 1. DUR from timeline.js
const timelinePath = join(HERE, 'timeline.js');
const { DUR } = await import(pathToFileURL(timelinePath).href);
const DUR_STR = DUR != null ? String(DUR) : '';
const durNum = Number(DUR_STR);
if (!Number.isFinite(durNum) || durNum <= 0 || durNum > 1200) {
  die('timeline DUR must be positive and at most 1200 seconds; confirm a duration conflict with the user');
}
if (AUDIO === 'file') {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', AUDIO_FILE], { encoding: 'utf8', cwd: HERE }).trim();
  const n = Number(out);
  if (!Number.isFinite(n) || Math.abs(n - durNum) > 1.5 / Number(FPS)) {
    die('prepared audio duration conflicts with timeline; confirm the duration before building (no automatic trimming or speed change)');
  }
}

// 2. reject conflicting CLI args
for (const a of process.argv.slice(2)) {
  if (/^--(fps|size|out|audio|start|duration)/.test(a)) {
    console.log(`✗ build.mjs ${a}: FPS / SIZE are variables here (they also drive the checks): FPS=60 SIZE=1080x1920 node build.mjs`);
    console.log('  for a segment or a one-off output, call render.mjs directly');
    process.exit(1);
  }
}

// 3. audio
const audio = (...args) => run('node', [join(SKILL, 'scripts', 'audio.mjs'), ...args]);
function need(file) {
  if (!existsSync(join(HERE, file))) die(`✗ AUDIO=${AUDIO} needs ${file} (or set AUDIO=synth|tone|layer|file|none in build.mjs)`);
}
function ignored(file) {
  if (existsSync(join(HERE, file))) console.log(`! ${file} is ignored (AUDIO=${AUDIO}). Delete it, or set AUDIO=layer to use both.`);
}

switch (AUDIO) {
  case 'synth':
    need('score.mjs'); ignored('score.tone.js');
    audio('build', 'score.mjs', '--out', 'audio/music.wav');
    break;
  case 'tone':
    need('score.tone.js'); ignored('score.mjs');
    audio('build', 'score.tone.js', '--out', 'audio/music.wav');
    break;
  case 'layer': {
    need('score.tone.js'); need('score.mjs');
    if (!/tone\.wav/.test(readFileSync(join(HERE, 'score.mjs'), 'utf8'))) {
      die('✗ AUDIO=layer but score.mjs never loads audio/tone.wav: the Tone layer would be built and then dropped (see assets/starter/score.layer.mjs)');
    }
    audio('build', 'score.tone.js', '--raw', '--out', 'audio/tone.wav');
    audio('build', 'score.mjs', '--out', 'audio/music.wav');
    break;
  }
  case 'none':
    ignored('score.mjs'); ignored('score.tone.js');
    break;
  case 'file':
    need(AUDIO_FILE);
    break;
  default:
    die(`✗ AUDIO must be synth | tone | layer | file | none (got '${AUDIO}')`);
}

if (AUDIO === 'file' && existsSync(join(HERE, 'audio', 'narration.json'))) {
  run('node', [join(SKILL, 'scripts', 'narration.mjs'), 'check', '.', '--duration', DUR_STR, '--audio', AUDIO_FILE]);
}

// 4. determinism
if (DETERMINISM === '1') {
  run('node', [join(SKILL, 'scripts', 'render.mjs'), '.', '--fps', FPS, '--size', SIZE, '--determinism']);
} else {
  console.log('! DETERMINISM=0: determinism not checked (fine for drafts, not for delivery)');
}

// 5. render
const renderCmd = [join(SKILL, 'scripts', 'render.mjs'), '.', '--fps', FPS, '--size', SIZE, '--out', 'out/final.mp4'];
if (AUDIO !== 'none') renderCmd.push('--audio', AUDIO === 'file' ? AUDIO_FILE : 'audio/music.wav');
renderCmd.push(...process.argv.slice(2));
run('node', renderCmd);

// 6. text check
if (TEXTCHECK === '1') {
  const ok = run('node', [join(SKILL, 'scripts', 'render.mjs'), '.', '--size', SIZE, '--text-check', '--out', 'qa/text'], { allowFail: true });
  if (!ok) console.log('! text check could not run (review material only; the build goes on)');
}

// 7. inspect qa
const expectArgs = ['--expect-size', SIZE, '--expect-fps', FPS, '--audio', AUDIO === 'none' ? 'none' : 'required'];
if (DUR_STR) expectArgs.push('--expect-duration', DUR_STR);
else console.log('! no DUR in timeline.js: duration will not be checked');
if (LOOP === '1') expectArgs.push('--loop');
run('node', [join(SKILL, 'scripts', 'inspect.mjs'), 'qa', 'out/final.mp4', '--out', 'qa/final', ...expectArgs]);