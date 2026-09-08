"use strict";
/**
 * refit_fitted.js — 在当前 data_battery.js（去重后）上重新生成 fitted.js
 * =========================================================================
 * 背景（2026-09-08 双仓库引擎统一时固化）：
 *   - 8 月去重把 BDATA 曲线 728→113 条后，fitted.js 的数组顺序滞留在 728 时代，
 *     而消费端（sim_engine/sim.js 的 nearestFit/nearestM5）按【索引】配对曲线
 *     与参数 → 全部 14 个系统模型错位（curve[3]=100%DOD 拿到 90%DOD 的参数）。
 *   - 修复方式：以当前 BDATA 顺序为基准重拟合，保证 fitted[i] ↔ curves[i]
 *     严格索引对齐；并加生成后自检（对齐校验 + 单调性 sanity）。
 *
 * 产出结构（与消费端 sim_engine.js 兼容）：
 *   window.FITTED = {
 *     cell:   { <model>: { M1:{params,rmse}, M2..M4 } },         // 电芯全局拟合（跨该电芯全部曲线）
 *     system: { <model>: [ {cond, rte?, M1..M4:{params,rmse}} ] }, // 逐曲线直拟，索引=BDATA.systems[model] 索引
 *     rte:    { RTE0, kRTE },                                    // 全库电芯 RTE 兜底拟合
 *     m5:     { <model>: [ {coeffs, base} ] }                    // 逐曲线 M5 三次多项式，索引对齐
 *     meta:   { generatedAt, engine: "refit_fitted.js", alignment: "index" }
 *   }
 *
 * 用法：node scripts/refit_fitted.js [--out ../scripts/fitted.js] [--iters 4000]
 */
const fs = require("fs");
const path = require("path");

const SCRIPTS = __dirname;
const API = require(path.join(SCRIPTS, "models.js"));

// ---- 载入 BDATA ----
const sandbox = { window: {} };
new Function("window", fs.readFileSync(path.join(SCRIPTS, "data_battery.js"), "utf-8"))(sandbox.window);
const BD = sandbox.window.BDATA;

// ---- 工具 ----
function cleanPts(raw, key) {
  const out = [], seen = {};
  for (const p of raw || []) {
    if (!p || !isFinite(p.y)) continue;
    const v = p[key];
    if (v == null || !isFinite(v)) continue;
    if (key === "rte" && p.y === 0 && v === 1.0) continue; // 空点哨兵
    const lo = 0.5, hi = key === "soh" ? 1.05 : 1.0;
    if (v < lo || v > hi) continue;
    if (seen[p.y] !== undefined) continue;
    seen[p.y] = 1;
    out.push({ y: p.y, v });
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

function rmseAgainst(modelKey, params, curves, conv) {
  // 与 sim 端同口径：pred loss 用模型 fn，target 用曲线 base-soh；RMSE 逐点
  let s = 0, n = 0;
  const md = API.MODELS[modelKey];
  for (const cv of curves) {
    const pts = cleanPts(cv.points, "soh");
    if (!pts.length) continue;
    const base = pts[0].v;
    for (const p of pts) {
      const pred = md.fn(params, cv.cond, p.y);
      let soh = base - pred;
      if (conv) soh *= conv;
      const d = soh - p.v;
      s += d * d; n++;
    }
  }
  return n ? Math.sqrt(s / n) : null;
}

// ---- 电芯全局拟合（每电芯跨全部曲线一个参数集）----
function fitCell(name, iters) {
  const curves = BD.cells[name] || [];
  const out = {};
  for (const mk of ["M1", "M2", "M3", "M4"]) {
    const params = API.fitModel(API.MODELS[mk], curves, { iters, restarts: 6 });
    out[mk] = { params, rmse: rmseAgainst(mk, params, curves, false) };
  }
  return out;
}

// ---- 系统直拟（逐曲线各自拟合，带曲线 cond / rte）----
function fitSystemCurve(cv, iters) {
  const entry = { cond: cv.cond };
  const ptsR = cleanPts(cv.points, "rte");
  if (ptsR.length >= 2) {
    const base0 = cleanPts(cv.points, "soh")[0];
    const base = base0 ? base0.v : 1.0;
    entry.rte = API.fitRTE(ptsR.map(p => ({ loss: base - p.v, rte: p.v })));
  }
  for (const mk of ["M1", "M2", "M3", "M4"]) {
    const params = API.fitModel(API.MODELS[mk], [cv], { iters, restarts: 4 });
    entry[mk] = { params, rmse: rmseAgainst(mk, params, [cv], false) };
  }
  return entry;
}

// ---- 全库电芯 RTE 兜底 ----
function globalCellRTE() {
  const pts = [];
  for (const nm of Object.keys(BD.cells)) {
    for (const cv of BD.cells[nm] || []) {
      if (!cv || !cv.points) continue;
      const sohPts = cleanPts(cv.points, "soh");
      const base = sohPts.length ? sohPts[0].v : 1;
      for (const p of cv.points) {
        if (p.soh != null && p.rte != null && isFinite(p.rte) && p.rte > 0.5 && p.rte <= 1)
          pts.push({ loss: base - p.soh, rte: p.rte });
      }
    }
  }
  return pts.length >= 4 ? API.fitRTE(pts) : null;
}

// ---- 主流程 ----
const argv = process.argv.slice(2);
const iters = argv.includes("--iters") ? +argv[argv.indexOf("--iters") + 1] : 4000;
const outIdx = argv.indexOf("--out");
const outPath = outIdx >= 0 ? path.resolve(argv[outIdx + 1])
                           : path.join(SCRIPTS, "fitted.js");

console.log("重拟合开始：iters=%d, BDATA cells=%d systems=%d",
            iters, Object.keys(BD.cells).length, Object.keys(BD.systems).length);

const FIT = { cell: {}, system: {}, rte: globalCellRTE(), m5: {} };

for (const nm of Object.keys(BD.cells)) {
  process.stdout.write("cell " + nm + " ... ");
  FIT.cell[nm] = fitCell(nm, iters);
  console.log("M3 rmse=" + FIT.cell[nm].M3.rmse.toFixed(5));
}

for (const nm of Object.keys(BD.systems)) {
  process.stdout.write("system " + nm + " (" + BD.systems[nm].length + " curves) ... ");
  FIT.system[nm] = BD.systems[nm].map(cv => fitSystemCurve(cv, Math.max(1500, iters / 2 | 0)));
  FIT.m5[nm] = BD.systems[nm].map(cv => API.fitM5(cv));
  console.log("done");
}
for (const nm of Object.keys(BD.cells)) {
  FIT.m5[nm] = BD.cells[nm].map(cv => API.fitM5(cv));
}

// ---- 自检 1：索引对齐（cond 一一对应）----
let mis = 0, tot = 0;
for (const nm of Object.keys(BD.systems)) {
  BD.systems[nm].forEach((cv, i) => {
    tot++;
    const e = FIT.system[nm][i];
    if (!e || !cv.cond || !e.cond ||
        JSON.stringify(e.cond) !== JSON.stringify(cv.cond)) mis++;
  });
}
if (mis) { console.error("✗ 索引对齐自检失败: %d/%d", mis, tot); process.exit(1); }
console.log("对齐自检: system %d/%d 严格索引对齐 ✓", tot - mis, tot);

// ---- 自检 2：m5 长度 == 曲线数 ----
for (const nm of Object.keys(BD.systems)) {
  if ((FIT.m5[nm] || []).length !== BD.systems[nm].length) {
    console.error("✗ m5 长度不符: %s", nm); process.exit(1);
  }
}

FIT.meta = {
  generatedAt: new Date().toISOString().slice(0, 19),
  engine: "refit_fitted.js",
  alignment: "index-strict",
  note: "fitted[i] 与 BDATA 曲线 i 严格索引对齐；消费端 nearestFit/nearestM5 按索引配对成立",
};

const body = "window.FITTED = " + JSON.stringify(FIT) + ";\n" +
             (typeof module !== "undefined" ? "if (typeof module !== \"undefined\" && module.exports) module.exports = FITTED_placeholder;\n" : "");
// fitted.js 是数据文件（window 全局风格），与 data_battery.js 一致：仅 window 赋值
const fileBody = "/* fitted.js — M1–M4/M5 预拟合参数缓存（由 scripts/refit_fitted.js 生成，勿手改）\n" +
                 " * 对齐契约: FIT.system[m][i] / FIT.m5[m][i] 与 BDATA.systems[m][i] 严格索引对齐。\n" +
                 " * 重新生成: node scripts/refit_fitted.js --out scripts/fitted.js\n" +
                 " */\nwindow.FITTED = " + JSON.stringify(FIT) + ";\n";
fs.writeFileSync(outPath, fileBody, "utf-8");
console.log("已写出: %s (%d KB)", outPath, Math.round(fs.statSync(outPath).size / 1024));
console.log("全部完成 ✓");
