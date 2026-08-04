# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-04
- Context: Discovered by Agent while improving the M3 battery degradation model (models.js/sim.js/fitted.js)
- Category: Build Methods
- Instructions:
  - fitted.js 是单行超大 JS（约 600KB，`window.FITTED = {...}`），node 直接 console 打印会刷屏截断（输出约 49KB 一截），检查其数据结构应写入临时文件再 read。
  - fitted.js 的 JSON 主体经 JSON.parse + JSON.stringify 往返是字节稳定的（数字表示、键顺序均不变），因此可通过解析→改 M3.params→重序列化实现定点更新，git diff 只显示改动值。
  - 修改 models.js 中 M3 公式后，预拟合参数即失效，需用 models.js 导出的 API.fitModel(MODELS.M3, [curve], {restarts, iters}) 对 BD.systems/BD.cells 逐曲线重拟合并写回 fitted.js（475 条 system + 2 个 cell 约需 100 秒，脚本模板 /tmp/opencode/refit_m3.js）。
  - 该仓库浏览器/Node 双环境通过 UMD 挂 window，node 测试用 vm.runInThisContext 顺序加载 models.js → data_battery.js → fitted.js → sim.js（sim.js 在 document 未定义时跳过 UI 部分），测试命令 `node test/run_all.js`。

[Project Knowledge Summary]
- Date: 2026-08-04
- Context: Discovered by Agent while debugging system direct-fit not taking effect
- Category: Troubleshooting & Debugging
- Instructions:
  - sim.js resolveName 的"清洁型号名"多键合并分支中，sysFit 曾把整个 FIT.system[key] 数组当作单条 entry 推入，导致 UI 里以清洁名（如 S4）选型号时 M1-M4 系统直拟永远失效、全部回落默认参数×转化系数；已修复为推入 `sf ? sf[i] : null`。若再遇"直拟参数不生效、source 恒为默认"类问题，优先检查 resolveName 的键索引对齐。
