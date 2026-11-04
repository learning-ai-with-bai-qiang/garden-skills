#!/usr/bin/env node
// 门禁 CLI。SKILL.md 每一步都要调用它——它是流程的唯一裁判。
//
//   node gate.mjs init <proj> [--force]            新建/重建门禁状态（第 2 步写 brief 之前先 init）
//   node gate.mjs status <proj>                    看五道门的状态 + 下一步该做什么
//   node gate.mjs check-brief <proj>               第 2 步：校验 brief.md 真填了
//   node gate.mjs confirm <proj> requirements --quote "用户原话" [--mode 1|2]
//   node gate.mjs confirm <proj> style --quote "用户原话" [--frames qa/stills/a.png,...]
//   node gate.mjs confirm <proj> export --quote "用户原话"
//   node gate.mjs reopen <proj> [style|export|brief|requirements] [--reason "..."]
//                                                  用户驳回时回退门禁（下游门一起作废）
//   node gate.mjs log <proj>                       看审计流水
//
// 规则：quote 必须是用户的原话。拿不出原话就不许 confirm。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GateError, ensureState, gateStatus, confirmGate, reopenGate, projectDirOf,
  readState, writeState, briefStatus, appendLog, LOG_FILE, STATE_FILE,
} from './lib/gate.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const target = argv[1];

function opt(name) {
  const i = argv.indexOf(`--${name}`);
  if (i > 0) {
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : true;
  }
  const pref = `--${name}=`;
  const hit = argv.find(a => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}
const hasFlag = name => argv.includes(`--${name}`);
const die = msg => { console.error(`✗ ${msg}`); process.exit(1); };

if (!cmd || ['-h', '--help', 'help'].includes(cmd)) {
  console.log(`usage:
  node gate.mjs init <proj> [--force]
  node gate.mjs status <proj>
  node gate.mjs check-brief <proj>
  node gate.mjs confirm <proj> requirements|style|export --quote "用户原话" [--mode 1|2] [--frames a.png,b.png]
  node gate.mjs reopen <proj> [gate] [--reason "..."]
  node gate.mjs log <proj>`);
  process.exit(0);
}

if (!target) die(`${cmd} 需要 <project-dir>`);
const dir = projectDirOf(target);

try {
  switch (cmd) {
    case 'init': {
      const existed = existsSync(path.join(dir, STATE_FILE));
      if (existed && !hasFlag('force')) {
        ensureState(dir);
        console.log(`✓ 门禁状态已存在：${path.join(dir, STATE_FILE)}（加 --force 可重建）`);
      } else {
        ensureState(dir, { force: true });
        console.log(`✓ 已建立门禁状态：${path.join(dir, STATE_FILE)}`);
        console.log('  接下来：第 1 步需求确认 → 第 2 步写 brief.md → check-brief');
      }
      appendLog(dir, { event: 'init', force: hasFlag('force') });
      break;
    }

    case 'status': {
      const { fatal, rows, state } = gateStatus(dir);
      if (fatal) die(fatal);
      console.log(`\n  项目：${dir}${state?.project?.audioMode ? `  (audio: ${state.project.audioMode})` : ''}\n`);
      const badge = ok => (ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m');
      for (const r of rows) {
        console.log(`  ${badge(r.ok)} ${r.gate.padEnd(13)} ${r.ok ? '' : (r.why || '未完成')}`);
      }
      const firstBad = rows.find(r => !r.ok);
      console.log('');
      if (firstBad) {
        console.log(`  下一步：${firstBad.gate}`);
        if (firstBad.detail?.quote) console.log(`         已记录用户原话：${firstBad.detail.quote}`);
        if (firstBad.gate === 'requirements') console.log('           node scripts/gate.mjs confirm "' + dir + '" requirements --quote "<用户原话>"');
        if (firstBad.gate === 'brief') console.log('           写好 brief.md 后：node scripts/gate.mjs check-brief "' + dir + '"');
        if (firstBad.gate === 'style') console.log('           渲静帧给人看，确认后：node scripts/gate.mjs confirm "' + dir + '" style --quote "<用户原话>"');
        if (firstBad.gate === 'export') console.log('           开预览给人看，确认后：node scripts/gate.mjs confirm "' + dir + '" export --quote "<用户原话>"');
        if (firstBad.gate === 'env') console.log('           node scripts/setup.mjs');
      } else {
        console.log('  全部通过，可以进入下一步（第 4/5 步制作，或第 7 步导出）。');
      }
      console.log('');
      break;
    }

    case 'check-brief': {
      ensureState(dir);
      const b = briefStatus(dir);
      if (!b.ok) {
        console.error(`✗ brief.md 不合格：${b.why}`);
        console.error('  模板：references/brief-template.md');
        process.exit(2);
      }
      console.log(`✓ brief.md 合格：${b.chars} 字符，sha256:${b.sha256}`);
      if (b.warning) console.log(`  ! ${b.warning}`);
      // 重新校验：把结果记进状态（不改门禁，只留痕）
      const st = readState(dir);
      st.notes.push({ at: new Date().toISOString(), event: 'brief-check', sha256: b.sha256, chars: b.chars });
      writeState(dir, st);
      appendLog(dir, { event: 'brief-check', sha256: b.sha256 });
      break;
    }

    case 'confirm': {
      const gate = argv[2];
      if (!gate) die('confirm 需要门名：requirements | style | export');
      const quote = opt('quote');
      if (!quote || quote === true) die('缺少 --quote "<用户原话>"。不许空着、不许自己编造。');
      const next = confirmGate(dir, gate, { quote, mode: opt('mode'), frames: opt('frames') });
      console.log(`✓ 门已通过：${gate}`);
      console.log(`  记录的用户原话：${quote}`);
      if (gate === 'requirements' && next.gates.requirements.mode) console.log(`  模式：${next.gates.requirements.mode}${next.gates.requirements.mode === 1 ? '（一句话出片，豁免第 1 步）' : ''}`);
      console.log('  下一步用 node scripts/gate.mjs status <proj> 查看。');
      break;
    }

    case 'reopen': {
      const gate = argv[2];
      if (!gate) die('reopen 需要门名：requirements | brief | style | export');
      reopenGate(dir, gate, opt('reason') && opt('reason') !== true ? opt('reason') : '');
      console.log(`✓ 已回退门禁：${gate} 及其下游全部作废`);
      break;
    }

    case 'log': {
      const p = path.join(dir, LOG_FILE);
      if (!existsSync(p)) die('没有审计流水');
      console.log(readFileSync(p, 'utf8').trim());
      break;
    }

    default:
      die(`未知命令 ${cmd}`);
  }
} catch (e) {
  if (e instanceof GateError) die(e.message);
  die(String(e?.message || e));
}
