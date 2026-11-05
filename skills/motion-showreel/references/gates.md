# 门禁协议（gates.md）

这个技能一共五道门：第 1、3、6 步是**必须由人来点头**的门（需求 / 风格 / 导出），
第 0 步（env）和第 2 步（brief）由机器查证据，不用人点头。把它们写成散文没用——
任务驱动型模型读到"必须等用户确认"时，常把它读成建议，然后为了"快点出片"直接冲过去。
所以这里把门做成了**代码**：能推进管线的脚本，执行前先校验门，缺证据就 `exit 2`。

---

## 1. 五道门与顺序

| 门 | 属于 | 证据从哪来 | 谁写 |
|---|---|---|---|
| `env` | 第 0 步 | `scripts/.env-ok.json`（setup 全绿才写；7 天内免重跑，但每次开门都当场复检 ffmpeg / ffprobe，且带校验位、改动即作废） | `setup.mjs` |
| `requirements` | 第 1 步 | 用户原话 `--quote` | `gate.mjs confirm` |
| `brief` | 第 2 步 | `brief.md` 真存在且填过（五段 + ≥600 字） | `gate.mjs check-brief` / 每次检查现算 |
| `style` | 第 3 步 | 用户原话 + 磁盘上真有静帧 | `gate.mjs confirm` |
| `export` | 第 6 步 | 用户原话 + 预览真开过 + 音频真合成 | `gate.mjs confirm` |

顺序是硬的：前面的没过，后面的 `confirm` 会直接报错 `前置门未通过`。

## 2. 哪些命令卡哪道门

| 命令 | 卡的门 | 为什么 |
|---|---|---|
| `scaffold.mjs` | `brief` | 建项目是第 3 步，需求没确认、brief 没写就不许建 |
| `render.mjs --still / --range / --directions` | `brief` | 渲静帧给人看之前，brief 必须先成立 |
| `render.mjs --determinism / --text-check / --poster` | `style` | 方向没定就做整片自检没意义 |
| `render.mjs`（全片，生成 MP4） | `export` | 用户没点头不许出片 |
| `audio.mjs build` | `style` | 先定方向再配乐 |
| `editor.mjs` | `style` | 预览是第 6 步，且会写 `preview.startedAt` |
| `inspect.mjs qa` | `export`（仅项目内） | 技术验收属于第 7 步 |
| `build.mjs` | `export` | 出片 + 验收，一条龙 |

被拒时不会静默失败，会打印：

```
  ┌────────────────────────────────────────────────────────────┐
  │  ✗ 门禁未通过，命令已拒绝执行                              │
  └────────────────────────────────────────────────────────────┘
  被拒绝：render 全片渲染（第 7 步：出最终 MP4）
  卡在：  第 6 步 · 导出确认
  原因：  用户还没有确认"可以导出"

  门禁进度：
    [✓] env
    [✓] requirements
    [✓] brief
    [✓] style
    [✗] export          ← 卡在这里：用户还没有确认"可以导出",证据来源有两种，对话 quote（gate.mjs confirm）与预览界面点击（preview-ui），后者由 confirmExportUI 写入。

  下一步必须做：
    先开预览：node scripts/editor.mjs <proj> --size 1920x1080 --fps 30，把网址发给用户；
    用户说"可以导出"后：node scripts/gate.mjs confirm <proj> export --quote "用户原话"
```

## 3. 常用命令

```bash
node scripts/gate.mjs init   <proj>              # 建状态（scaffold 也会自动建）
node scripts/gate.mjs status <proj>              # 看五道门 + 下一步（每步开始先跑这个）
node scripts/gate.mjs check-brief <proj>         # 第 2 步校验 brief
node scripts/gate.mjs confirm <proj> requirements --quote "确认，就按这个做" [--mode 1]
node scripts/gate.mjs confirm <proj> style        --quote "方向对，继续"
node scripts/gate.mjs confirm <proj> export       --quote "可以导出"
node scripts/gate.mjs reopen <proj> style --reason "用户要改配色"
node scripts/gate.mjs log    <proj>              # 审计流水
```

## 4. 用户驳回怎么办

驳回 = 门作废，不是"再确认一次就行"。

```bash
node scripts/gate.mjs reopen <proj> style --reason "用户觉得山太碎"
# 改 index.html → 重渲静帧 → 再给用户看 → 再 confirm style
```

`reopen` 会把它自己和**下游所有门**一起作废（`reopen style` 会同时清掉 `export`），
防止"用旧的导出确认套新的画面"。

## 5. 反绕过

| 有人想这么干 | 会怎样 |
|---|---|
| 手改 `.showreel-state.json` 把 `ok` 改 true | sha256 校验失败，`状态文件校验失败，判定为被手工改动`，所有门失效 |
| 删掉状态文件重新 init | 可以，但 `init` 后所有门归零，必须重新按顺序过 |
| 不用 gate.mjs，直接 `confirm` 时瞎编 quote | 技术上拦不住"用户到底说没说"，但 quote 会连同时间戳写进 `.showreel-gate.log`，事后可对账 |
| 绕过脚本，手搓 ffmpeg 出片 | 这条拦不住。但它不产出 `qa/final-sheet.png`、`qa/final.json` 等审片材料，第 8 步交付对不上，等于没交付 |
| 先跑 `render --still` 骗过 style 门 | 不能：`style` 门要求**用户 quote**，静帧只是必要条件之一 |
| 拿 `--mode 1` 跳过需求确认 | 只豁免第 1 步。第 3、6 步照旧强制，这是设计好的口子，不是漏洞 |

**诚实的边界**：代码能保证"顺序正确、产物存在、确认有记录"，不能保证"模型没伪造用户原话"。
所以 quote + 审计流水 + 交付物对账三者合起来用——伪造会留痕，能被追。
| 后台直接 POST /api/jobs 触发导出 | 403：缺少或无效的 UI 点击凭证（凭证仅预览页渲染时签发，单次有效，10 分钟过期） |


## 6. 老项目（没有 state 文件）

之前建的、非合规流程产出的项目，第一次跑任何命令会被拦，提示：

```
项目还没有门禁状态文件，先跑 node scripts/gate.mjs init "<proj>"
```

补票流程：`init` → 补/核对 `brief.md` → `check-brief` → 若已有静帧则 `confirm style`
→ `editor` → `confirm export`。**不接受"直接放行"这种选项**，因为那正好绕过了这套设计。
