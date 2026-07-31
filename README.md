# BESS 配置器 V2.0（带仿真）

零构建、双击 `index.html` 即用的**纯前端储能电站（BESS）系统配置与全生命周期能量测算工具**。

输入并网点功率/容量、单程效率、集装箱数量、DOD 等参数，输出 25 年逐年的 SOH、DC-RTE、可用容量、最大输出，以及含辅耗的**综合效率 O**（GB/T 36549 口径），并将辅耗损失链可视化。

## 特性

- **零依赖离线运行**：无框架、无构建、无 CDN，`Chart.js` 已本地化到 `vendor/`，现场/离线可直接交付。
- **数据 / 引擎 / UI 三层解耦**：核心计算 `calc_engine.js` 为 UMD 纯函数库，浏览器与 Node 回归测试共用同一份代码。
- **精细化辅耗建模**：基于 5MWh 集装箱实测的六步循环（充/放电 + 冷尾 + 静置），对倍率与温度双线性插值；`adaptive` 冷尾策略下强制冷却仅占 30% 时长。
- **衰减来源可切换**：支持手工衰减表（`raw`）或由仿真输出（`sim`）驱动。
- **可视化**：Chart.js 双轴衰减曲线 + 桑基式五因子损失链 SVG。

## 快速开始

直接用浏览器打开 `index.html` 即可（建议 Chrome / Edge）。无需安装、无需服务器。

## 文件结构

| 文件 | 层 | 职责 |
|---|---|---|
| `index.html` / `style.css` | UI | 骨架与样式（侧边栏六页导航 + PDF 参数确认弹窗） |
| `app.js` | UI | 单一 `state` + `recalc()` 驱动六页；AC↔DC 联动、PDF 导入、CSV/报告导出 |
| `calc_engine.js` | 引擎 | 核心纯函数库（UMD：`window.BESS_ENGINE` + `module.exports`），零 DOM 依赖 |
| `models.js` | 引擎 | M1–M4 衰减模型 + Nelder-Mead 带边界惩罚优化器 |
| `sim.js` | 引擎 | 衰减仿真：曲线查找/插值、EXACT→M5→M3 回退链、双轴图 |
| `data.js` | 数据 | 辅耗功率矩阵、输入默认值、25 年衰减表 |
| `data_battery.js` | 数据 | 电芯/系统实测 SOH-RTE 逐年曲线 |
| `fitted.js` | 数据 | M1–M4 预拟合参数 + RMSE（避免前端现场拟合） |
| `_verify*.js` | 测试 | Node 端校验脚本（辅耗恒等式、五因子分解 Σ=1、仿真回退） |
| `vendor/chart.umd.min.js` | 依赖 | 本地 Chart.js |

> 说明：`_verify_loss.out` 为测试运行输出、`data_battery.premerge.bak` 为合并前电池数据备份，二者均为可再生的本地产物，已通过 `.gitignore` 排除，不纳入版本管理。

## 计算口径

- 可用容量 `H_avail = (铭牌容量 × SOH × √RTE + 补容折算) × DOD`
- 最大输出 `Mout = H_avail × η_dis × η_cable`
- 综合效率 `O = (Mout − P_dis·t_dis) / (Nin + E_cycle_sys − P_dis·t_dis)`（GB/T 36549）
- 五因子分解：`1 − O = f_dc + f_chg + f_dis + f_cable + f_aux + f_other`

## 校验结论

默认工况 0.5P@25℃ N=1：综合效率 **O = 85.16%**，单循环辅耗 12371 kWh；五阶段损失链与引擎自洽（误差 < 1e-11），五因子分解 Σ = 100.00%，全部 PASS。

## 测试与质量

- 校验脚本已归入 `test/`（`_verify.js` / `_verify_loss.js` / `_verify_v13.js`），由 `node test/run_all.js` 统一运行。
- `_verify.js` 不再复刻逻辑，直接 `require('../calc_engine.js')` 对拍生产引擎（含 adaptive 冷尾）。
- `_verify_loss.js` 路径基于 `__dirname`，换机不再失效（已移除硬编码 `E:/...` 绝对路径）。
- `models.js` 的 `MODELS` 已补全 `M5`（数据驱动经验多项式，系数为 fitted 数据），与 UI/文档 M1–M5 一致。
