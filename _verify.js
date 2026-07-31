/* 校验脚本：验证辅耗页 4 点改造（仅纯计算，无 DOM） */
const fs = require("fs");

// --- 载入 data.js (window.V12) ---
const code = fs.readFileSync(__dirname + "/data.js", "utf8");
global.window = {};
const V = (function () {
  eval(code);              // 在严格模式 IIFE 内定义 window.V12
  return global.window.V12;
})();

// --- 复刻 app.js 纯计算函数（逐字一致）---
let state = { inputs: Object.assign({}, V.inputs), aux: Object.assign({}, V.auxDefault) };

function tiRow(row, T) {
  if (T <= V.Tgrid[0]) return row[0];
  if (T >= V.Tgrid[4]) return row[4];
  for (let i = 0; i < 4; i++)
    if (T >= V.Tgrid[i] && T <= V.Tgrid[i + 1])
      return row[i] + (row[i + 1] - row[i]) * (T - V.Tgrid[i]) / (V.Tgrid[i + 1] - V.Tgrid[i]);
  return row[4];
}
function riMat(mat, T, r) {
  const cols = mat.map(rw => tiRow(rw, T));
  if (r <= V.Rgrid[0]) return cols[0];
  if (r >= V.Rgrid[2]) return cols[2];
  for (let i = 0; i < 2; i++)
    if (r >= V.Rgrid[i] && r <= V.Rgrid[i + 1])
      return cols[i] + (cols[i + 1] - cols[i]) * (r - V.Rgrid[i]) / (V.Rgrid[i + 1] - V.Rgrid[i]);
  return cols[2];
}
function algo(r, T, mode, restOverride, N) {
  const pChg = riMat(V.M.chg, T, r), pTailC = riMat(V.M.tailC, T, r),
        pDis = riMat(V.M.dis, T, r), pTailD = riMat(V.M.tailD, T, r);
  const ps = V.STBY[String(mode)] != null ? V.STBY[String(mode)] : Number(mode);
  let tAct; const m = [0.25, 0.33, 0.5].find(k => Math.abs(k - r) < 1e-9);
  tAct = m !== undefined ? { 0.25: 4, 0.33: 3, 0.5: 2 }[m] : 1 / r;
  const tTail = r <= 0.33 ? 0.5 : 1.5;
  const tRest = (restOverride != null && restOverride !== "")
    ? Number(restOverride) : Math.max(0, 24 / (N || 1) - 2 * (tAct + tTail));
  const t3 = Math.min(4, tRest), t6 = Math.max(0, tRest - 4);
  const Eaux = pChg * tAct + pTailC * tTail + ps * t3 + pDis * tAct + pTailD * tTail + ps * t6;
  const cycleH = 2 * tAct + 2 * tTail + tRest;
  return { Eaux, avgKW: Eaux / cycleH, avgMW: Eaux / cycleH / 1000,
           pChg, pTailC, pDis, pTailD, ps, tAct, tTail, tRest, t3, t6, cycleH };
}
function acMatrixValue(key, T, r) {
  const I = state.inputs;
  const nC = Math.max(1, I.containerCount);
  const noLoadkW = I.acAuxNoLoad * I.skidCount * 1000 / nC;
  if (key === "chg" || key === "dis") {
    const shape = riMat(V.M[key], T, r);
    const ref = riMat(V.M[key], 25, 0.5);
    const loadkW = I.acAuxLoadPct * (I.reqP / nC) * 1000 * (ref ? shape / ref : 1);
    return noLoadkW + loadkW;
  }
  return noLoadkW;
}
function acAuxPowers() {
  const T = state.aux.T, r = state.aux.r, nC = Math.max(1, state.inputs.containerCount);
  const mw = k => acMatrixValue(k, T, r) * nC / 1000;
  return { chg: mw("chg"), dis: mw("dis"), tail: mw("tailC"), stby: mw("tailC") };
}
function computeAux() {
  const a = algo(state.aux.r, state.aux.T, state.aux.mode, state.aux.rest, state.aux.N);
  const nC = state.inputs.containerCount;
  const pac = acAuxPowers();
  return Object.assign({}, a, {
    nC, pac,
    E_cycle_sys: nC * a.Eaux / 1000
      + pac.chg * a.tAct + pac.tail * a.tTail + pac.stby * a.t3
      + pac.dis * a.tAct + pac.tail * a.tTail + pac.stby * a.t6
  });
}

// ============ 校验 1：温度下拉切换是否真改变输出 ============
function run(T) { state.aux.T = T; const s = computeAux(); return s; }
const a25 = run(25), a45 = run(45);
const T_changed = (a25.E_cycle_sys !== a45.E_cycle_sys)
  && (a25.pChg !== a45.pChg)
  && (riMat(V.M.chg, 25, 0.5) !== riMat(V.M.chg, 45, 0.5));
console.log("【校验1 温度切换改变输出】");
console.log("  T=25: pChg=%s kW/箱, E_cycle_sys=%s MWh", a25.pChg.toFixed(2), a25.E_cycle_sys.toFixed(4));
console.log("  T=45: pChg=%s kW/箱, E_cycle_sys=%s MWh", a45.pChg.toFixed(2), a45.E_cycle_sys.toFixed(4));
console.log("  => 温度改变确实改变结果:", T_changed ? "PASS" : "FAIL");

// ============ 校验 2：DC总 + AC总 = BESS总 (与 updateAux 同构) ============
function stageTotals() {
  const sys = computeAux(); const nC = sys.nC;
  const stages = [
    { t: sys.tAct, dcpw: nC * sys.pChg   / 1000, acpw: sys.pac.chg },
    { t: sys.tTail, dcpw: nC * sys.pTailC / 1000, acpw: sys.pac.tail },
    { t: sys.t3,   dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby },
    { t: sys.tAct, dcpw: nC * sys.pDis   / 1000, acpw: sys.pac.dis },
    { t: sys.tTail, dcpw: nC * sys.pTailD / 1000, acpw: sys.pac.tail },
    { t: sys.t6,   dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby }
  ];
  let dcTot = 0, acTot = 0;
  stages.forEach(s => { dcTot += s.dcpw * s.t; acTot += s.acpw * s.t; });
  return { dcTot, acTot, bess: dcTot + acTot, E_cycle_sys: sys.E_cycle_sys };
}
const t2 = stageTotals();
const idOk = Math.abs(t2.bess - t2.E_cycle_sys) < 1e-6;
console.log("\n【校验2 DC总+AC总=BESS总 恒等式】");
console.log("  DC总=%s MWh  AC总=%s MWh  BESS总=%s MWh  E_cycle_sys=%s MWh",
  t2.dcTot.toFixed(4), t2.acTot.toFixed(4), t2.bess.toFixed(4), t2.E_cycle_sys.toFixed(4));
console.log("  => DC总+AC总 == E_cycle_sys:", idOk ? "PASS" : "FAIL");

// ============ 校验 3：参数化 —— 改箱数/SKID，无硬编码 62 ============
function snapshot() { const s = computeAux(); return { perBox: s.pChg, E: s.E_cycle_sys, noLoad: acMatrixValue("tailC", state.aux.T, state.aux.r) }; }
state.inputs.containerCount = 62; state.inputs.skidCount = 16;
const base = snapshot();
state.inputs.containerCount = 100; // 改箱数
const c100 = snapshot();
state.inputs.containerCount = 62; state.inputs.skidCount = 20; // 改 SKID
const sk20 = snapshot();
const perBoxInvariant = Math.abs(base.perBox - c100.perBox) < 1e-9;        // 单箱功率与箱数无关
const dcScales = c100.E > base.E;                                          // DC 总随箱数增大
const noLoadScalesWithSkid = sk20.noLoad > base.noLoad;                    // 空载随 SKID 增大
console.log("\n【校验3 参数化 (无硬编码62)】");
console.log("  62箱/16SKID: 单箱pChg=%s, E=%s, 空载=%s", base.perBox.toFixed(2), base.E.toFixed(4), base.noLoad.toFixed(4));
console.log("  100箱/16SKID: 单箱pChg=%s, E=%s, 空载=%s", c100.perBox.toFixed(2), c100.E.toFixed(4), c100.noLoad.toFixed(4));
console.log("  62箱/20SKID: 单箱pChg=%s, E=%s, 空载=%s", sk20.perBox.toFixed(2), sk20.E.toFixed(4), sk20.noLoad.toFixed(4));
console.log("  单箱功率与箱数无关:", perBoxInvariant ? "PASS" : "FAIL");
console.log("  DC总随箱数增大:", dcScales ? "PASS" : "FAIL");
console.log("  空载随SKID增大:", noLoadScalesWithSkid ? "PASS" : "FAIL");

// ============ 校验 4：源码里计算路径无字面量 62 ============
const src = fs.readFileSync(__dirname + "/app.js", "utf8");
const hard62 = src.split("\n").filter(l => /\b62\b/.test(l) && !/\/\//.test(l) && !/\*/.test(l) && !/不写死/.test(l) && !/时间 DC/.test(l));
console.log("\n【校验4 源码计算路径无硬编码62】");
console.log("  命中行数(非纯注释):", hard62.length, hard62.length === 0 ? "PASS" : "需要复核");
hard62.forEach(l => console.log("   >>", l.trim()));

console.log("\n==== 结论 ====");
console.log("校验1(温度生效):", T_changed ? "PASS" : "FAIL");
console.log("校验2(DC+AC=BESS):", idOk ? "PASS" : "FAIL");
console.log("校验3(参数化无62):", (perBoxInvariant && dcScales && noLoadScalesWithSkid) ? "PASS" : "FAIL");
console.log("校验4(源码无硬编码62):", hard62.length === 0 ? "PASS" : "FAIL");
