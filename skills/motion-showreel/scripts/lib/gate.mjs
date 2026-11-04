// Machine-enforced gates for motion-showreel-v1.
//
// SKILL.md 里第 1 / 3 / 6 步是"人来确认"的门。写成散文对任务驱动型模型不够：
// 它会在"想快点出片"的状态下把句子读成建议，然后直接冲过去。所以把门变成
// 代码——每个能推进管线的脚本，执行前先断言门，缺证据就 exit(2)。
//
// 门的顺序（前面的没过，后面的一律不许过）：
//   env          第 0 步：setup.mjs 真的跑过且全绿
//   requirements 第 1 步：用户确认了需求摘要（或有"一句话出片"豁免）
//   brief        第 2 步：brief.md 真的存在且填过（不是空模板）
//   style        第 3 步：用户确认了风格帧，且静帧文件真的在原盘上
//   export       第 6 步：工作区预览真的开过，用户说了可以导出
//
// 证据写在 <project>/.showreel-state.json，只有 gate.mjs 和少数"亲眼看到产物"的
// 脚本（editor.mjs 记录预览真的开过）能写。文件带 sha256 校验位，手工改动会被
// 判为篡改并直接拒绝。审计流水在 <project>/.showreel-gate.log（JSONL，只追加）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATE_FILE = '.showreel-state.json';
export const LOG_FILE = '.showreel-gate.log';
export const ENV_FILE = path.join(SKILL_DIR, 'scripts', '.env-ok.json');
export const ENV_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const GATE_ORDER = ['env', 'requirements', 'brief', 'style', 'export'];
const GATE_LABEL = {
  env: '第 0 步 · 环境检查',
  requirements: '第 1 步 · 需求确认',
  brief: '第 2 步 · brief.md',
  style: '第 3 步 · 风格帧确认',
  export: '第 6 步 · 导出确认',
};

export class GateError extends Error {}

/* ---------- 工具 ---------- */

const nowISO = () => new Date().toISOString();

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (k !== 'hash') out[k] = stable(v[k]);
    return out;
  }
  return v;
}
const digest = obj => crypto.createHash('sha256').update(JSON.stringify(stable(obj))).digest('hex');

export function projectDirOf(target) {
  if (!target) throw new GateError('缺少 <project-dir>');
  const abs = path.resolve(target);
  try { if (fs.statSync(abs).isDirectory()) return abs; } catch { /* not there yet */ }
  return path.dirname(abs);
}

export function statePath(dir) { return path.join(dir, STATE_FILE); }

// 从任意文件/目录往上找项目根（识别 brief.md / index.html / state）
export function findProjectRoot(start, maxUp = 4) {
  let dir = projectDirOf(start);
  for (let i = 0; i <= maxUp; i++) {
    if (fs.existsSync(path.join(dir, STATE_FILE)) || fs.existsSync(path.join(dir, 'brief.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return projectDirOf(start);
}

/* ---------- 状态读写 ---------- */

export function readState(dir, { soft = false } = {}) {
  const p = statePath(dir);
  if (!fs.existsSync(p)) {
    if (soft) return null;
    throw new GateError(
      `这个项目还没有门禁状态文件：${p}\n` +
      `  说明：项目不是通过合规流程建立的，或 state 被删了。\n` +
      `  处理：node scripts/gate.mjs init "${dir}"  然后按第 1 步重新确认。`
    );
  }
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    throw new GateError(`状态文件损坏，无法解析：${p}\n  处理：node scripts/gate.mjs init "${dir}" 重建（会要求重新过门）。`);
  }
  const { hash, ...rest } = obj;
  if (hash !== digest(rest)) {
    throw new GateError(
      `状态文件校验失败，判定为被手工改动：${p}\n` +
      `  门禁状态只能由 node scripts/gate.mjs 写入，直接编辑等于伪造用户确认。\n` +
      `  处理：node scripts/gate.mjs init "${dir}" --force 重建后重新过门。`
    );
  }
  return obj;
}

export function writeState(dir, state) {
  const { hash, ...rest } = state;
  const next = { ...rest, hash: digest(rest) };
  const p = statePath(dir);
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function ensureState(dir, { force = false } = {}) {
  const p = statePath(dir);
  if (fs.existsSync(p) && !force) {
    try { return readState(dir); } catch { /* 坏了就重建 */ }
  }
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    version: 1,
    slug: path.basename(path.resolve(dir)),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    gates: {},
    project: {},
    preview: {},
    notes: [],
  };
  return writeState(dir, state);
}

export function appendLog(dir, entry) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, LOG_FILE), JSON.stringify({ at: nowISO(), ...entry }) + '\n', 'utf8');
  } catch { /* logging must never break the pipeline */ }
}

/* ---------- 各项检查 ---------- */

export function envStatus() {
  if (!fs.existsSync(ENV_FILE)) {
    return { ok: false, why: '没有找到第 0 步的环境检查记录（scripts/.env-ok.json）' };
  }
  let m;
  try { m = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')); } catch { return { ok: false, why: '环境检查记录损坏' }; }
  const age = Date.now() - (m.ts || 0);
  if (!(age >= 0 && age < ENV_MAX_AGE_MS)) {
    return { ok: false, why: `环境检查记录已过期（${Math.floor(age / 86400000)} 天前）` };
  }
  return { ok: true, marker: m };
}

export function briefStatus(dir) {
  const p = path.join(dir, 'brief.md');
  if (!fs.existsSync(p)) return { ok: false, why: '项目里没有 brief.md（第 2 步没做）' };
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch { return { ok: false, why: 'brief.md 读不出来' }; }
  const body = txt.trim();
  const need = ['<role>', '<inputs>', '<direction>', '<structure>', '<build>'];
  const missing = need.filter(t => !txt.includes(t));
  if (missing.length) return { ok: false, why: `brief.md 缺少模板必需段落：${missing.join(' ')}` };
  if (body.length < 600) return { ok: false, why: `brief.md 只有 ${body.length} 字符，明显是没填的空模板` };
  const blanks = (txt.match(/……/g) || []).length;
  return {
    ok: true,
    chars: body.length,
    sha256: crypto.createHash('sha256').update(txt).digest('hex').slice(0, 16),
    warning: blanks > 30 ? `brief.md 里还有 ${blanks} 处「……」占位符，建议填实` : null,
  };
}

export function styleArtifacts(dir) {
  const found = [];
  const walk = (d, depth = 0) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(p, depth + 1); }
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) found.push(p);
    }
  };
  for (const rel of ['qa/stills', 'qa/directions', 'qa/step3']) walk(path.join(dir, rel));
  for (const rel of ['qa/directions.png', 'qa/stills.png']) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) found.push(p);
  }
  return found;
}

export function audioArtifacts(dir) {
  return ['audio/music.wav', 'audio/final.wav', 'audio/tone.wav', 'audio/mix.wav']
    .map(r => path.join(dir, r))
    .filter(p => fs.existsSync(p));
}

/* ---------- 总状态 ---------- */

export function gateStatus(dir) {
  const rows = [];
  let state = null;
  try { state = readState(dir, { soft: true }); } catch (e) {
    return { fatal: e.message, rows: GATE_ORDER.map(g => ({ gate: g, ok: false, why: '状态文件不可用' })) };
  }
  const g = state?.gates || {};

  // env
  const env = envStatus();
  rows.push({ gate: 'env', ok: env.ok, why: env.ok ? '环境检查通过' : env.why });

  // requirements
  const req = g.requirements;
  let reqOk = !!(req && req.ok), reqWhy = '';
  if (!reqOk) reqWhy = '用户还没有确认需求摘要';
  else if (!env.ok) { reqOk = false; reqWhy = '环境检查无效，需先重跑第 0 步'; }
  rows.push({ gate: 'requirements', ok: reqOk, why: reqWhy, detail: req });

  // brief
  const brief = briefStatus(dir);
  let briefOk = !!(brief.ok && reqOk);
  let briefWhy = brief.ok ? 'brief.md 已填' : brief.why;
  if (brief.ok && !reqOk) briefWhy = 'brief.md 存在，但需求门未过，brief 不算数';
  rows.push({ gate: 'brief', ok: briefOk, why: briefWhy, detail: brief });

  // style
  const st = g.style;
  const arts = styleArtifacts(dir);
  let styleOk = !!(st && st.ok), styleWhy = '';
  if (!styleOk) styleWhy = '用户还没有确认风格帧';
  else if (!briefOk) { styleOk = false; styleWhy = 'brief 门未过，风格确认无效'; }
  else if (arts.length < 1) { styleOk = false; styleWhy = '磁盘上找不到风格静帧（qa/stills 或 qa/directions），确认没有实物支撑'; }
  rows.push({ gate: 'style', ok: styleOk, why: styleWhy, detail: st, artifacts: arts.length });

  // export
  const ex = g.export;
  let exOk = !!(ex && ex.ok), exWhy = '';
  if (!exOk) exWhy = '用户还没有确认"可以导出"';
  else if (!styleOk) { exOk = false; exWhy = '风格门未过，导出确认无效'; }
  else if (!state?.preview?.startedAt) { exOk = false; exWhy = '没有工作区预览记录（editor.mjs 从未启动过）'; }
  rows.push({ gate: 'export', ok: exOk, why: exWhy, detail: ex });

  return { state, rows, noState: !state };
}

const NEXT_STEP = {
  env: '先跑：node scripts/setup.mjs',
  requirements:
    '先读 references/guided-mode.md，按双模式向用户提问；拿到用户明确回复后：\n' +
    '    node scripts/gate.mjs confirm <proj> requirements --quote "用户原话"\n' +
    '    （模式1 一句话出片：加 --mode 1，视为用户显式豁免第 1 步）',
  brief:
    '先读 references/brief-template.md 写 <proj>/brief.md，然后：\n' +
    '    node scripts/gate.mjs check-brief <proj>',
  style:
    '先在 <proj> 写静态构图的 index.html，渲静帧：\n' +
    '    node scripts/render.mjs <proj> --still 1,4,8 --sheet\n' +
    '    把静帧交给用户，问"方向对吗"；拿到确认后：\n' +
    '    node scripts/gate.mjs confirm <proj> style --quote "用户原话"',
  export:
    '先开预览：node scripts/editor.mjs <proj> --size 1920x1080 --fps 30，把网址发给用户；\n' +
    '    用户说"可以导出"后：node scripts/gate.mjs confirm <proj> export --quote "用户原话"',
};

export function renderBlock({ gate, action, why, rows, extra }) {
  const lines = [];
  lines.push('');
  lines.push('  ┌────────────────────────────────────────────────────────────┐');
  lines.push('  │  ✗ 门禁未通过，命令已拒绝执行                              │');
  lines.push('  └────────────────────────────────────────────────────────────┘');
  lines.push(`  被拒绝：${action}`);
  lines.push(`  卡在：  ${GATE_LABEL[gate] || gate}`);
  lines.push(`  原因：  ${why || '未满足前置条件'}`);
  if (extra) lines.push(`  补充：  ${extra}`);
  lines.push('');
  lines.push('  门禁进度：');
  for (const r of rows) {
    if (r.gate === gate) lines.push(`    [✗] ${r.gate.padEnd(13)} ← 卡在这里：${r.why || ''}`);
    else lines.push(`    [${r.ok ? '✓' : ' '}] ${r.gate.padEnd(13)}${r.ok ? '' : (r.why || '未完成')}`);
  }
  lines.push('');
  lines.push('  下一步必须做：');
  for (const l of String(NEXT_STEP[gate] || '').split('\n')) lines.push('    ' + l);
  lines.push('');
  lines.push('  规则：不得手工编辑 .showreel-state.json（会判为篡改），不得用其他方式绕过本检查。');
  lines.push('        用户没有明确说过"确认/可以/没问题/方向对"，就不许写 quote。');
  lines.push('');
  return lines.join('\n');
}

export function assertGate(dir, gate, action) {
  const { fatal, rows, noState } = gateStatus(dir);
  if (fatal) {
    console.error(`\n  ✗ 门禁状态不可用：${fatal}\n`);
    process.exit(2);
  }
  const row = rows.find(r => r.gate === gate);
  if (row && row.ok) {
    appendLog(dir, { event: 'gate-pass', gate, action });
    return;
  }
  const missing = rows.find(r => !r.ok) || row;
  const anchor = missing && GATE_ORDER.indexOf(missing.gate) < GATE_ORDER.indexOf(gate) ? missing : (row || missing);
  const head = [];
  if (noState) head.push(`项目还没有门禁状态文件，先跑 node scripts/gate.mjs init "${dir}"`);
  if (anchor.gate !== gate) head.push(`这条命令要求「${GATE_LABEL[gate]}」，但它必须先建立在「${GATE_LABEL[anchor.gate]}」之上`);
  console.error(renderBlock({
    gate: anchor.gate,
    action,
    why: anchor.why,
    rows,
    extra: head.length ? head.join('\n          ') : null,
  }));
  appendLog(dir, { event: 'gate-block', gate: anchor.gate, denied: gate, action, why: anchor.why });
  process.exit(2);
}

/* ---------- 写入门 ---------- */

export function markEnvOk(extra = {}) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, JSON.stringify({ ts: Date.now(), node: process.version, platform: process.platform, ...extra }, null, 2) + '\n', 'utf8');
}

// editor.mjs 真的起了服务才能调用它——这是"预览门"的实物证据。
// 没有这条记录，export 门一律不认。
export function recordPreview(dir, info = {}) {
  const state = ensureState(dir);
  state.preview = { ...(state.preview || {}), startedAt: nowISO(), ...info };
  appendLog(dir, { event: 'preview-start', ...info });
  return writeState(dir, state);
}

export function confirmGate(dir, gate, { quote, mode, frames } = {}) {
  const state = ensureState(dir);
  const q = String(quote || '').trim();
  if (!GATE_ORDER.includes(gate) || gate === 'env') throw new GateError(`confirm 不支持的门：${gate}（env 由 setup.mjs 自动记录）`);
  if (!q) throw new GateError('缺少 --quote。必须引用用户确认需求/方向/导出的原话，不许留空、不许自己编。');

  // 前置门必须都过
  const { rows } = gateStatus(dir);
  const idx = GATE_ORDER.indexOf(gate);
  for (const r of rows) {
    if (GATE_ORDER.indexOf(r.gate) < idx && !r.ok) {
      throw new GateError(`前置门未通过：${GATE_LABEL[r.gate]}（${r.why}）。不能跳过顺序确认后面的门。`);
    }
  }

  if (gate === 'style') {
    const arts = styleArtifacts(dir);
    if (!arts.length) throw new GateError('磁盘上没有任何风格静帧（qa/stills、qa/directions）。先渲静帧，再确认方向。');
    if (frames) {
      for (const f of [].concat(frames)) {
        if (!fs.existsSync(path.resolve(dir, f))) throw new GateError(`--frames 指向的文件不存在：${f}`);
      }
    }
    state.gates.style = { ok: true, at: nowISO(), quote: q, frames: (frames ? [].concat(frames) : arts.map(a => path.relative(dir, a))).slice(0, 12) };
  } else if (gate === 'export') {
    if (!state.preview?.startedAt) throw new GateError('没有工作区预览记录：editor.mjs 从未启动过。先开预览给用户看，再谈导出。');
    const audioMode = state.project?.audioMode;
    if (audioMode && audioMode !== 'none' && !audioArtifacts(dir).length) {
      throw new GateError(`音频还没合成（audio/ 下没有 wav），不能进导出。先跑 node scripts/audio.mjs build …`);
    }
    for (const f of ['index.html', 'timeline.js']) {
      if (!fs.existsSync(path.join(dir, f))) throw new GateError(`缺少 ${f}，画面还没做完，不能导出。`);
    }
    state.gates.export = { ok: true, at: nowISO(), quote: q };
  } else if (gate === 'requirements') {
    if (mode && ![1, 2, '1', '2'].includes(mode)) throw new GateError('--mode 只能是 1 或 2');
    state.gates.requirements = { ok: true, at: nowISO(), quote: q, mode: mode ? Number(mode) : null };
  }
  const next = writeState(dir, state);
  appendLog(dir, { event: 'gate-confirm', gate, quote: q, mode: mode || null });
  return next;
}

/* ---------- 导出：预览界面点击路径（方案 A） ---------- */

// 导出前的"实物检查"：style 门是否真开、画面文件是否真存在、audio 是否真在磁盘。
// 不依赖 quote，供 editor.mjs 在 UI 点击导出时调用，作为放行前的一道硬证据。
export function exportRealArtifacts(dir) {
  const state = readState(dir, { soft: true });
  if (!state) return { ok: false, why: '没有门禁状态文件，无法验证导出前置条件' };
  // style 门必须真开（readState 已校验过 sha256，排除了手工篡改）
  if (!state.gates?.style?.ok) return { ok: false, why: 'style 门未开启：用户尚未确认风格帧，不能导出' };
  // 画面文件必须真存在
  for (const f of ['index.html', 'timeline.js']) {
    if (!fs.existsSync(path.join(dir, f))) return { ok: false, why: `缺少 ${f}，画面还没做完，不能导出` };
  }
  // audio 是否真的合成了（audioMode 为 none 时豁免）
  const audioMode = state.project?.audioMode;
  if (audioMode && audioMode !== 'none' && !audioArtifacts(dir).length) {
    return { ok: false, why: '音频还没合成（audio/ 下没有 wav），不能进导出' };
  }
  return { ok: true };
}

// 预览界面点击触发的导出确认：证据来源是 UI 点击，而非对话 quote。
// clickToken 是预览页渲染时由服务端签发的单次凭证；raw 不落盘，只存 sha256 前 32 位。
export function confirmExportUI(dir, { clickToken, jobId } = {}) {
  const pre = exportRealArtifacts(dir);
  if (!pre.ok) throw new GateError(pre.why);
  const state = ensureState(dir);
  const tokenHash = clickToken ? crypto.createHash('sha256').update(String(clickToken)).digest('hex').slice(0, 32) : 'none';
  state.gates.export = {
    ok: true,
    at: nowISO(),
    source: 'preview-ui',
    actor: 'ui-click',
    clickTokenHash: tokenHash,
    jobId: jobId || null,
  };
  const next = writeState(dir, state);
  appendLog(dir, { event: 'gate-confirm', gate: 'export', source: 'preview-ui', clickTokenHash: tokenHash, jobId: jobId || null });
  return next;
}

export function reopenGate(dir, gate, reason = '') {
  const state = ensureState(dir);
  const idx = GATE_ORDER.indexOf(gate);
  if (idx < 0) throw new GateError(`未知的门：${gate}`);
  for (const g of GATE_ORDER.slice(idx)) delete state.gates[g];
  // 画面被驳回后，旧的预览记录也失效——不能让"上一版的预览"给"这一版"背书。
  if (idx <= GATE_ORDER.indexOf('style')) {
    state.preview = {};
    state.notes.push({ at: nowISO(), event: 'preview-invalidated', because: gate });
  }
  state.notes.push({ at: nowISO(), event: 'reopen', gate, reason });
  const next = writeState(dir, state);
  appendLog(dir, { event: 'gate-reopen', gate, reason });
  return next;
}
