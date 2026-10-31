#!/usr/bin/env node
// Cross-platform replacement for scaffold.sh
// Create a showreel project from the starter.
//   node scaffold.mjs <project-dir> [--audio synth|tone|layer|file|none]
//     synth (default)  score.mjs       tier 1: built-in synth
//     tone             score.tone.js   tier 2: Tone.js offline
//     layer            both            tier 2 music rendered raw + score.mjs adds SFX
//     none             no score        silent piece
//     file             no score        prepared final mix (AUDIO_FILE=audio/final.wav)
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..');
const ST = join(SKILL, 'assets', 'starter');

const argv = process.argv.slice(2);
const DEST = argv[0];
if (!DEST) {
  console.error('usage: node scaffold.mjs <project-dir> [--audio synth|tone|layer|file|none]');
  process.exit(1);
}

let AUDIO = 'synth';
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--audio') {
    AUDIO = argv[++i];
    if (!AUDIO) { console.error('✗ --audio needs synth|tone|layer|file|none'); process.exit(1); }
  } else if (a.startsWith('--audio=')) {
    AUDIO = a.slice('--audio='.length);
  } else {
    console.error(`✗ unknown option ${a} (usage: node scaffold.mjs <project-dir> [--audio synth|tone|layer|file|none])`);
    process.exit(1);
  }
}
if (!['synth', 'tone', 'layer', 'file', 'none'].includes(AUDIO)) {
  console.error(`✗ --audio must be synth | tone | layer | file | none (got '${AUDIO}')`);
  process.exit(1);
}
if (existsSync(join(DEST, 'index.html'))) {
  console.error(`✗ ${join(DEST, 'index.html')} already exists; not overwriting`);
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });
for (const f of ['index.html', 'motion.js', 'timeline.js', 'narration.js', 'preview.js', 'package.json']) {
  copyFileSync(join(ST, f), join(DEST, f));
}

switch (AUDIO) {
  case 'synth':
    copyFileSync(join(ST, 'score.mjs'), join(DEST, 'score.mjs'));
    break;
  case 'tone':
    copyFileSync(join(ST, 'score.tone.js'), join(DEST, 'score.tone.js'));
    break;
  case 'layer':
    copyFileSync(join(ST, 'score.tone.js'), join(DEST, 'score.tone.js'));
    copyFileSync(join(ST, 'score.layer.mjs'), join(DEST, 'score.mjs'));
    break;
}

// Generate build.mjs from the template, replacing placeholders.
// Use forward slashes so Windows paths stay valid inside JS string literals.
const skillForJs = SKILL.replace(/\\/g, '/');
let buildTpl = readFileSync(join(ST, 'build.mjs'), 'utf8');
buildTpl = buildTpl.replace(/__SKILL_DIR__/g, skillForJs).replace(/__AUDIO__/g, AUDIO);
writeFileSync(join(DEST, 'build.mjs'), buildTpl, 'utf8');

for (const d of ['fonts', 'assets', 'audio', 'qa', 'out']) {
  mkdirSync(join(DEST, d), { recursive: true });
}

console.log(`✓ project at ${DEST}  (audio: ${AUDIO})`);
console.log(`  stills:  node ${join(SKILL, 'scripts', 'render.mjs')} ${DEST} --still 1,3,6 --sheet`);
switch (AUDIO) {
  case 'synth': console.log(`  music:   node ${join(SKILL, 'scripts', 'audio.mjs')} build ${join(DEST, 'score.mjs')}`); break;
  case 'tone':  console.log(`  music:   node ${join(SKILL, 'scripts', 'audio.mjs')} build ${join(DEST, 'score.tone.js')}   (samples first: audio.mjs samples salamander)`); break;
  case 'layer': console.log(`  music:   score.tone.js is built raw to audio/tone.wav, then score.mjs loads it with S.load('audio/tone.wav')`); break;
  case 'none':  console.log('  music:   none (silent piece; qa will expect no audio track)'); break;
  case 'file':  console.log('  audio:   prepare audio/final.wav, or set AUDIO_FILE to your final mix'); break;
}
console.log(`  preview: node ${join(SKILL, 'scripts', 'editor.mjs')} ${DEST} --size 1920x1080 --fps 30`);
console.log(`  rebuild: node ${join(DEST, 'build.mjs')}`);