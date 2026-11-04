---
name: motion-showreel
description: 用代码制作图形、文字或界面动画视频，输出 MP4 和可编辑源码，最长 20 分钟。
---

# Motion Showreel 技能工作流

本文件仅为总控大纲。**不要在这个文件里找具体实现方法**，每一步执行前，必须先读取对应的详细参考文件。

---

## 铁律（先读这一段，它决定你能不能往下走）

这个技能的流程被**代码强制**了。第 1、3、6 步是"必须由人来点头"的门，门禁状态记录在
`<项目>/.showreel-state.json`，由 `scripts/gate.mjs` 独占写入。

- **门禁不是建议。** 任何推进管线的脚本（`scaffold` / `render` / `audio build` / `editor` / `build` / `inspect qa`）
  执行前都会自检门禁，缺证据就 **exit 2 直接拒绝**，并打印"下一步必须做什么"。
- **不许伪造。** `confirm` 必须带 `--quote "<用户原话>"`。用户没说过"确认 / 可以 / 没问题 / 方向对"，
  就不许写 quote。所有过门动作写进 `.showreel-gate.log`，事后可查。
- **不许手改状态文件。** `.showreel-state.json` 带 sha256 校验位，手工编辑会被判为篡改，全部门禁失效。
- **不许跳过顺序。** 前一道门没过，后一道门 `confirm` 会直接报错。
- **每步开始先跑 `node scripts/gate.mjs status <项目>`**，看清卡在哪、下一步是什么，再动手。

参考：`references/gates.md`（门禁协议、反绕过规则、被拦时怎么办）。

---

## 第 0 步：环境检查

- **动作**：`node scripts/setup.mjs`
- **系统动作**：全绿后自动写入 `scripts/.env-ok.json`，这一步就是 **env 门**（7 天有效）。
- **红线**：env 门没开，`scaffold` / `render` / `audio build` / `editor` / `build` 全部会被拒绝。
  环境没全绿就去修环境，不要试图绕过。

## 第 1 步：需求确认（强制门禁 · 人来点头）

- **动作**：读取 `references/guided-mode.md`，按双模式（一句话出片 / 精细问卷）用大白话引导用户，
  收集主题、时长、横竖屏、声音、标题、口播。
- **门禁命令**：拿到用户明确回复后
  ```
  node scripts/gate.mjs init <项目>
  node scripts/gate.mjs confirm <项目> requirements --quote "<用户原话>" [--mode 1|2]
  ```
- **红线**：**用户未确认前，严禁 scaffold、严禁写任何项目代码。** 这条现在由机器执行——
  没开 requirements 门，`scaffold` 会直接 exit 2。
- **豁免权**：用户选了模式 1（一句话出片），用 `--mode 1` 记录，视为用户显式豁免本步。
  **但第 3、第 6 步门禁仍强制生效。**

## 第 2 步：写 brief.md

- **动作**：读取 `references/brief-template.md`，把确认的摘要结构化成 `<项目>/brief.md`。
- **门禁命令**：
  ```
  node scripts/gate.mjs check-brief <项目>
  ```
  校验：`brief.md` 存在、含 `<role>` `<inputs>` `<direction>` `<structure>` `<build>` 五段、正文 ≥600 字符。
- **红线**：brief 不合格 → 门不开 → 第 3 步的 `scaffold` 拒绝执行。空模板等于没写。

## 第 3 步：风格帧（强制门禁 · 人来点头）

- **动作**：
  1. 建项目：`node scripts/scaffold.mjs <项目> --audio synth|tone|layer|file|none`
     （**会自动校验 brief 门**；项目已存在且已有 index.html 时会拒绝覆盖）
  2. 写**仅含静态构图**的初版 `index.html`（不含完整动画、不写 timeline 全片）。
  3. 渲静帧：`node scripts/render.mjs <项目> --still 1,4,8 --sheet`
  4. 把静帧交给用户，问"方向对吗"。
- **门禁命令**：用户认可后
  ```
  node scripts/gate.mjs confirm <项目> style --quote "<用户原话>"
  ```
  权限校验：磁盘上必须真有静帧（`qa/stills`、`qa/directions`），否则 confirm 不成立。
- **红线**：用户否定 → 改完重渲 → 再问。**驳回一次就 `node scripts/gate.mjs reopen <项目> style`
  把门打回，不要带着旧确认继续往下。** 可反复迭代，不直接终止任务。
- **注意**：这里之后 `audio build` 和 `editor` 才被允许——方向没定就不许配乐、不许开预览。

## 第 4 步：制作画面

- **动作**：编写完整的 `timeline.js` 和 `index.html`（`window.DUR` / `window.render(t)` / `window.READY`）。
- **规范**：必须先读 `references/recipes.md`（视觉配方）与 `references/stack.md`（确定性要求），
  并参考 `references/craft.md`（审美手法：变化密度 / 转场 / 禁止清单）。
- **修改纪律【局部Bug修复】**：先用 `grep` 定位符号，用 `read_file` 带 `offset/limit` 读目标片段，
  用 `edit_file` 精确修改；**禁止全量重读、禁止推翻重写**。
- **自检**：`node scripts/render.mjs <项目> --determinism`（同一 t 不同顺序渲染必须像素一致）。

## 第 5 步：BGM、音效与混音

- **动作**：读 `references/sound.md`。写 `score.mjs`（第 1 档：Node 内置合成）或 `score.tone.js`
  （第 2 档：Tone.js 采样版）。合成：
  ```
  node scripts/audio.mjs build <项目>/score.mjs --out audio/music.wav
  ```
  （读取 score 生成音频，自动母带到 −14 LUFS / 峰值 −1.5 dBFS）
- **有录音时**：`node scripts/narration.mjs` 提取真实时间戳。
- **门禁**：`audio build` 自带 style 门校验，风格没确认就拒绝合成。
- **红线**：录音必须实测时间戳，**严禁估算、严禁拉伸音频对齐**。

## 第 6 步：工作区预览（强制门禁 · 人来点头）

- **动作**：`node scripts/editor.mjs <项目> --size 1920x1080 --fps 30`，把网址发给用户。
  启动成功会自动写入 `preview.startedAt` —— 这是导出门唯一认的证据。
- **门禁命令**：用户明确说"可以导出"后
  ```
  node scripts/gate.mjs confirm <项目> export --quote "<用户原话>"
  ```
  校验：style 门已过 + 预览确实开过 + 音频已合成（非静音项目）+ `index.html`/`timeline.js` 存在。
- **红线**：**必须先预览，不许先出低清 MP4。** 用户没点头，第 7 步全部命令拒绝执行。
- **用户要改**：回到第 4/5 步修改 → 重开预览 → 重新 `reopen export` 再确认。

## 第 7 步：导出与验收

- **动作**（在项目目录内执行）：
  ```
  cd <项目> && node build.mjs
  ```
  自动完成：合音频 → 确定性检查 → 全片渲染 → 文字框景 → QA。
  - 分辨率/帧率用环境变量：`FPS=60 SIZE=1080x1920 node build.mjs`
  - 已备好成品音轨：`AUDIO=file AUDIO_FILE=audio/final.wav node build.mjs`
  - 没有 build.mjs 时的回退：`render.mjs --out out/video.mp4` → `ffmpeg` 混流 → `inspect.mjs qa`
- **门禁**：`build.mjs` / `render` 全片 / `inspect qa` 都自带 export 门校验。
- **红线**：所有技术检查项必须 PASS，**不得有 NOT CHECKED**。响度 −14 LUFS，帧率与 brief 一致，
  `final.mp4` **必须含音轨**（`ffprobe` 确认存在 audio stream）。

## 第 8 步：交付

- **交付物**（缺一不可）：
  1. `out/final.mp4`（成片）
  2. 源码工程 `<项目>/`（`index.html`、`timeline.js`、`score.mjs`；用 Tone.js 时附 `score.tone.js`）
  3. QA 报告摘要（无黑帧 / 响度 / 时长 / 帧率 / 含音轨）
  4. 落版海报或关键帧（`qa/final-sheet.png` 等审片材料）
- **红线**：没说清这三项就结束任务 = 未交付。
