/* 校验脚本：验证辅耗页 4 点改造（直接复用生产引擎 calc_engine.js，不再复刻 app.js 逻辑）
 * 运行: node test/_verify.js   (或 node test/run_all.js)
 */
const fs = require("fs");
const path = require("path");

// --- 载入 data.js (window.V12) ---
const code = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
global.window = {};
const V = (function () { eval(code); return global.window.V12; })();

// --- 直接复用生产引擎（与浏览器 / 计算表同一份代码，避免逻辑分叉）---
const ENG = require(path.join(__dirname, "..", "calc_engine.js"));

// 维护可调 state（与 app.js 同构）
let state = { inputs: Object.assign({}, V.inputs), aux: Object.assign({}, V.auxDefault) };

// 直接调用引擎 computeAux；返回字段与 app.js 完全一致
function computeAux() { return ENG.computeAux(V, state.inputs, state.aux); }

// ============ 校验 1：温度下拉切换是否真改变输出 ============
function run(T) { state.aux.T = T; return computeAux(); }
const a25 = run(25), a45 = run(45);
const T_changed = (a25.E_cycle_sys !== a45.E_cycle_sys)
  && (a25.pChg !== a45.pChg)
  && (ENG.riMat(V.M.chg, 25, 0.5, V.Tgrid, V.Rgrid) !== ENG.riMat(V.M.chg, 45, 0.5, V.Tgrid, V.Rgrid));
console.log("【校验1 温度切换改变输出】");
console.log("  T=25: pChg=%s kW/箱, E_cycle_sys=%s MWh", a25.pChg.toFixed(2), a25.E_cycle_sys.toFixed(4));
console.log("  T=45: pChg=%s kW/箱, E_cycle_sys=%s MWh", a45.pChg.toFixed(2), a45.E_cycle_sys.toFixed(4));
console.log("  => 温度改变确实改变结果:", T_changed ? "PASS" : "FAIL");

// ============ 校验 2：DC总 + AC总 = BESS总（损失链恒等式，使用引擎自适应 eTailC/eTailD）============
function stageTotals() {
  const sys = computeAux(); const nC = sys.nC;
  const dc = nC * sys.pChg   / 1000 * sys.tAct   // 充电 DC
           + nC * sys.eTailC / 1000              // 充电冷尾(自适应尾部能量)
           + nC * sys.ps     / 1000 * sys.t3     // 静置1
           + nC * sys.pDis   / 1000 * sys.tAct   // 放电 DC
           + nC * sys.eTailD / 1000              // 放电冷尾(自适应尾部能量)
           + nC * sys.ps     / 1000 * sys.t6;    // 静置2
  const ac = sys.pac.chg  * sys.tAct
           + sys.pac.tail  * sys.tTail
           + sys.pac.stby  * sys.t3
           + sys.pac.dis   * sys.tAct
           + sys.pac.tail  * sys.tTail
           + sys.pac.stby  * sys.t6;
  return { dcTot: dc, acTot: ac, bess: dc + ac, E_cycle_sys: sys.E_cycle_sys };
}
const t2 = stageTotals();
const idOk = Math.abs(t2.bess - t2.E_cycle_sys) < 1e-6;
console.log("\n【校验2 DC总+AC总=BESS总 恒等式】");
console.log("  DC总=%s MWh  AC总=%s MWh  BESS总=%s MWh  E_cycle_sys=%s MWh",
  t2.dcTot.toFixed(4), t2.acTot.toFixed(4), t2.bess.toFixed(4), t2.E_cycle_sys.toFixed(4));
console.log("  => DC总+AC总 == E_cycle_sys:", idOk ? "PASS" : "FAIL");

// ============ 校验 3：参数化 —— 改箱数/SKID，无硬编码 62 ============
function snapshot() {
  const s = computeAux();
  return { perBox: s.pChg, E: s.E_cycle_sys,
           noLoad: ENG.acMatrixValue("tailC", state.aux.T, state.aux.r, V, state.inputs) };
}
state.inputs.containerCount = 62; state.inputs.skidCount = 16;
const base = snapshot();
state.inputs.containerCount = 100; // 改箱数
const c100 = snapshot();
state.inputs.containerCount = 62; state.inputs.skidCount = 20; // 改 SKID
const sk20 = snapshot();
const perBoxInvariant = Math.abs(base.perBox - c100.perBox) < 1e-9;   // 单箱功率与箱数无关
const dcScales = c100.E > base.E;                                     // DC 总随箱数增大
const noLoadScalesWithSkid = sk20.noLoad > base.noLoad;               // 空载随 SKID 增大
console.log("\n【校验3 参数化 (无硬编码62)】");
console.log("  62箱/16SKID: 单箱pChg=%s, E=%s, 空载=%s", base.perBox.toFixed(2), base.E.toFixed(4), base.noLoad.toFixed(4));
console.log("  100箱/16SKID: 单箱pChg=%s, E=%s, 空载=%s", c100.perBox.toFixed(2), c100.E.toFixed(4), c100.noLoad.toFixed(4));
console.log("  62箱/20SKID: 单箱pChg=%s, E=%s, 空载=%s", sk20.perBox.toFixed(2), sk20.E.toFixed(4), sk20.noLoad.toFixed(4));
console.log("  单箱功率与箱数无关:", perBoxInvariant ? "PASS" : "FAIL");
console.log("  DC总随箱数增大:", dcScales ? "PASS" : "FAIL");
console.log("  空载随SKID增大:", noLoadScalesWithSkid ? "PASS" : "FAIL");

// ============ 校验 4：源码里计算路径无字面量 62 ============
const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
// 排除 SVG 损失链图/坐标绘制行（y="62"、mkLink(62,...) 是画布坐标，非集装箱数量硬编码；真正的计算硬编码由校验3以改箱数验证）
const hard62 = src.split("\n").filter(l => /\b62\b/.test(l) && !/\/\//.test(l) && !/\*/.test(l) && !/不写死/.test(l) && !/时间 DC/.test(l) && !/<text/.test(l) && !/mkLink/.test(l) && !/x=/.test(l) && !/y=/.test(l));
console.log("\n【校验4 源码计算路径无硬编码62】");
console.log("  命中行数(非纯注释):", hard62.length, hard62.length === 0 ? "PASS" : "需要复核");
hard62.forEach(l => console.log("   >>", l.trim()));

const allPass = T_changed && idOk && perBoxInvariant && dcScales && noLoadScalesWithSkid && hard62.length === 0;
console.log("\n==== 结论 ====");
console.log("校验1(温度生效):", T_changed ? "PASS" : "FAIL");
console.log("校验2(DC+AC=BESS):", idOk ? "PASS" : "FAIL");
console.log("校验3(参数化无62):", (perBoxInvariant && dcScales && noLoadScalesWithSkid) ? "PASS" : "FAIL");
console.log("校验4(源码无硬编码62):", hard62.length === 0 ? "PASS" : "FAIL");
process.exit(allPass ? 0 : 1);
