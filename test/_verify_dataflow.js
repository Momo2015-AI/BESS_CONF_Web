/* 数据流专项校验: 仿真(sim) / 原始(raw) 来源 → 计算表 H/K 逐行映射
 * 覆盖:
 *  1. raw 模式: H/K 逐行等于 deg 原始表, 无回退标记
 *  2. sim 模式(仿真满 25 年): row3(FAT)=1.0 + row4(SAT)=0.9925 固定,
 *     其余行 H=sim.soh[yi] / K=sim.rte[yi] 逐年一一对应, 无回退
 *  3. sim 模式(仿真年限不足): 越界行回退原始表且 srcFallback=true, 界内行仍取仿真
 *  4. rteOverride: K 恒为覆盖值, 优先级高于 sim 与 raw
 *  5. 全年份一致性: 表格 row 数 = 原始表行数, 永不越界丢失
 */
const path = require("path");
global.window = global;                    // data.js 以 window.V12 暴露, Node 下注入
const ENG = require(path.join(__dirname, "..", "calc_engine.js"));
require(path.join(__dirname, "..", "data.js"));
const DATA = global.V12;                   // { M, Tgrid, Rgrid, STBY, inputs, degRows, augDefault }

const V = DATA;                    // { M, Tgrid, Rgrid, STBY, inputs, degRows, augDefault }
const inputs = Object.assign({}, DATA.inputs);   // 默认输入; nom 由引擎 derive 自动补齐
const aux = { r: 0.5, T: 25, mode: "1.0", rest: "", N: 1, coolStrategy: "adaptive", tailCoolFrac: 0.3 };
const deg = DATA.degRows;          // row3..row29 共 27 行
const aug1 = {}, aug2 = {};

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ✅ " : "  ❌ ") + msg); if (!cond) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

function makeSim(maxYear, soh0, kRate) {
  // 构造与 sim.js modelRTE 一致的仿真输出; 含 Year0, 共 maxYear+1 个点 soh[0..maxYear]
  // 映射: row4(SAT/Year0)=soh[0], row5(1年)=soh[1], ..., row29(25年)=soh[25]
  const soh = [], rte = [];
  for (let i = 0; i <= maxYear; i++) {
    const s = soh0 * Math.pow(0.985, i);
    soh.push(s);
    rte.push(Math.max(0, 0.941 - kRate * (soh0 - s)));
  }
  return { years: soh.map((_, i) => i), soh, rte, source: "TEST-sim" };
}
// 表格索引 → 仿真索引: row(=3+idx) → yi=row-4
const yiOf = (idx) => (idx + 3) - 4;   // idx=0(row3)→-1, idx=2(row5)→1, idx=26(row29)→25

console.log("══════════════════════════════════════════");
console.log("▶ _verify_dataflow.js  数据流: 来源 → H/K 逐行映射");
console.log("══════════════════════════════════════════\n");

/* ---- 1. raw 模式 ---- */
{
  const tbl = ENG.computeTable(V, inputs, aux, deg, aug1, aug2, "raw", null);
  const rows = tbl.rows;
  console.log("[1] raw 模式: 用 deg 原始表");
  ok(rows.length === deg.length, `行数一致 (${rows.length} = ${deg.length})`);
  ok(rows[0].row === 3 && rows[0].H === 1.0 && rows[0].K === deg[0].K, "FAT row3 H=1.0, K=原始表");
  ok(rows[1].row === 4 && rows[1].H === 0.9925, "SAT row4 H=0.9925");
  let allMatch = true, allFallback = false;
  rows.forEach((r, i) => {
    if (Math.abs(r.H - deg[i].H) > 1e-9 || Math.abs(r.K - deg[i].K) > 1e-9) allMatch = false;
    if (r.srcFallback) allFallback = true;
  });
  ok(allMatch, "每行 H/K 与原始表完全一致");
  ok(!allFallback, "无 srcFallback 标记");
  console.log(`  抽查: row5(H=1年)=${rows[2].H.toFixed(4)}(${deg[2].H.toFixed(4)}) row29(H=25年)=${rows[26].H.toFixed(4)}(${deg[26].H.toFixed(4)})`);
}

/* ---- 2. sim 模式: 仿真满 25 年 (row5..29 = soh[1..25]) ---- */
{
  const sim = makeSim(25, 1.0, 0.02);   // 满 25 年仿真, 含 Year0 共 26 点
  const tbl = ENG.computeTable(V, inputs, aux, deg, aug1, aug2, "sim", sim);
  const rows = tbl.rows;
  console.log(`\n[2] sim 模式: 仿真满 25 年 (sim.soh[0]=${sim.soh[0].toFixed(4)}, soh[25]=${sim.soh[25].toFixed(4)})`);
  ok(rows[0].H === 1.0 && near(rows[0].K, sim.rte[0]), "FAT row3: H 固定 1.0, K=sim.rte[0]");
  ok(rows[1].H === 0.9925 && near(rows[1].K, sim.rte[0]), "SAT row4: H 固定 0.9925, K=sim.rte[0]");
  let yrOk = true;
  for (let i = 2; i < rows.length; i++) {
    const yi = yiOf(i);                 // row5→soh[1], row29→soh[25]
    if (!near(rows[i].H, sim.soh[yi]) || !near(rows[i].K, sim.rte[yi])) yrOk = false;
    if (rows[i].srcFallback) yrOk = false;
  }
  ok(yrOk, "row5..29 H/K 与 sim.soh/rte 逐年一一对应, 无回退");
  console.log(`  抽查: row5(H=1年)=${rows[2].H.toFixed(4)}≈sim[1]  row29(H=25年)=${rows[26].H.toFixed(4)}≈sim[25]`);
}

/* ---- 3. sim 模式: 仿真年限不足 (只到 9 年) → 越界回退 ---- */
{
  const sim = makeSim(9, 1.0, 0.02);    // 仿真只有 10 点 soh[0..9] (Year0..9)
  const tbl = ENG.computeTable(V, inputs, aux, deg, aug1, aug2, "sim", sim);
  const rows = tbl.rows;
  console.log("\n[3] sim 模式: 仿真只到 9 年 (soh[0..9])");
  let inRange = true;
  for (let i = 2; i <= 10; i++) {       // row5..13 (年份1..9) → soh[1..9] 界内
    const yi = yiOf(i);
    if (!near(rows[i].H, sim.soh[yi]) || rows[i].srcFallback) inRange = false;
  }
  ok(inRange, "row5..13 (soh[1..9]) 取仿真值, 无回退");
  const fbOk = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26].every(i => {
    const d = deg[i];
    return near(rows[i].H, d.H) && near(rows[i].K, d.K) && rows[i].srcFallback;
  });
  ok(fbOk, "row14..29 (soh 越界) 回退原始表且 srcFallback=true");
  console.log(`  抽查: row14(H=10年)=${rows[11].H.toFixed(4)}→回退(原始 ${deg[11].H.toFixed(4)})  row29(H=25年)=${rows[26].H.toFixed(4)}→回退(原始 ${deg[26].H.toFixed(4)})`);
}

/* ---- 4. rteOverride: K 全局覆盖 ---- */
{
  const ov = 0.95;
  const inputs2 = Object.assign({}, inputs, { rteOverride: ov });
  const tblRaw = ENG.computeTable(V, inputs2, aux, deg, aug1, aug2, "raw", null);
  const tblSim = ENG.computeTable(V, inputs2, aux, deg, aug1, aug2, "sim", makeSim(25, 1.0, 0.02));
  console.log(`\n[4] rteOverride=${ov.toFixed(3)}`);
  const allOvRaw = tblRaw.rows.every(r => near(r.K, ov));
  const allOvSim = tblSim.rows.every(r => near(r.K, ov));
  ok(allOvRaw, `raw 模式下所有行 K=${ov.toFixed(3)}`);
  ok(allOvSim, `sim 模式下所有行 K=${ov.toFixed(3)} (优先级高于仿真)`);
  ok(tblSim.rows[0].H === 1.0 && tblSim.rows[1].H === 0.9925, "override 不改变 FAT/SAT 的固定 H");
}

/* ---- 5. 全年份 + 物理量完整 ---- */
{
  const sim = makeSim(25, 1.0, 0.02);
  const tbl = ENG.computeTable(V, inputs, aux, deg, aug1, aug2, "sim", sim);
  const rows = tbl.rows;
  console.log("\n[5] 全年份物理量链 (sim 满 25 年, row5)");
  const r = rows[2];
  const D = inputs.nom * r.H * Math.sqrt(r.K);
  ok(near(r.D, D), `D=nom×H×√K (${r.D.toFixed(3)} = ${D.toFixed(3)})`);
  ok(near(r.Mout, r.H_avail * inputs.effDis * inputs.cable), "Mout=H_avail×η_dis×η_cable");
  ok(near(r.Nin, r.H_avail / (r.K * inputs.cable * inputs.effChg)), "Nin=H_avail/(K×η_cable×η_chg)");
  ok(r.H_avail >= 0 && r.D >= 0 && r.Mout >= 0 && r.Nin >= 0, "所有容量/出力非负");
  ok(rows.every(x => x.H > 0 && x.K > 0), "所有行 H/K 为正");
  ok(tbl.sys && tbl.sys.E_cycle_sys > 0, "系统级辅耗 E_cycle_sys>0 随表返回");
  console.log(`  抽查: D=${r.D.toFixed(2)}MWh Mout=${r.Mout.toFixed(2)}MWh Nin=${r.Nin.toFixed(2)}MWh E_cycle_sys=${tbl.sys.E_cycle_sys.toFixed(4)}MWh`);
}

console.log("\n" + (fails === 0 ? "数据流校验全部通过 ✅" : `存在 ${fails} 项失败 ❌`));
process.exit(fails === 0 ? 0 : 1);
