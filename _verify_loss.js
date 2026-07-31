/* 校验脚本：验证第6页「辅耗可视化」损失链与引擎/计算表自洽 */
const fs = require("fs");
const path = require("path");
const WIN = "E:/11 配置信息/v13_web BESS 配置器V_2.0_ 带仿真";

// --- 载入 V12 数据源 ---
const dataCode = fs.readFileSync(path.join(WIN, "data.js"), "utf8");
global.window = {};
eval(dataCode);
const V = global.window.V12;

// --- 载入引擎 (Node module.exports) ---
const ENG = require(path.join(WIN, "calc_engine.js"));

function run(auxOverrides, label) {
  const state = ENG.createState(V, { aux: auxOverrides });
  ENG.derive(V, state.inputs, state.aux);
  const table = ENG.computeTable(V, state.inputs, state.aux, state.deg, state.aug1, state.aug2, state.sohSrc, null);
  const sys = table.sys;
  const r0 = table.rows[0];      // 首行(FAT/Year0 前) — 用 row4=SAT(Year0) 看首年
  const rY0 = table.rows.find(z => z.row === 4);

  // 损失链当前实现(连续冷却简化): 5 阶段
  const tact = sys.tAct, ttail = sys.tTail, tstby = sys.tRest;
  const Echg = sys.P_chg_sys * tact;
  const Ect = sys.P_tailC_sys * ttail;   // 连续: 全冷却
  const Est = sys.P_stby_sys * tstby;
  const Edis = sys.P_dis_sys * tact;
  const Edt = sys.P_tailD_sys * ttail;   // 连续: 全冷却
  const chain5 = Echg + Ect + Est + Edis + Edt;

  // 引擎真实 adaptive 尾部能量(每箱 DC): eTailC/eTailD
  const frac = (state.aux.coolStrategy === "adaptive") ? (state.aux.tailCoolFrac != null ? state.aux.tailCoolFrac : 0.30) : 1;
  const nC = sys.nC;
  // 真实充电尾/放电尾(系统级) = DC(自适应) + AC(整段 tail)
  const Ect_real = nC * sys.eTailC / 1000 + sys.pac.tail * ttail;
  const Edt_real = nC * sys.eTailD / 1000 + sys.pac.tail * ttail;
  const chain5_real = Echg + Ect_real + Est + Edis + Edt_real;

  console.log("\n===== " + label + " =====");
  console.log("  r=%s T=%s mode=%s N=%s  cool=%s frac=%s", state.aux.r, state.aux.T, state.aux.mode, state.aux.N, state.aux.coolStrategy, frac);
  console.log("  阶段功率(kW)  P_chg=%s P_dis=%s P_tailC=%s P_tailD=%s P_stby=%s",
    sys.P_chg_sys.toFixed(1), sys.P_dis_sys.toFixed(1), sys.P_tailC_sys.toFixed(1), sys.P_tailD_sys.toFixed(1), sys.P_stby_sys.toFixed(1));
  console.log("  时长(h) tAct=%s tTail=%s tRest=%s t3=%s t6=%s", tact.toFixed(2), ttail.toFixed(2), tstby.toFixed(2), sys.t3.toFixed(2), sys.t6.toFixed(2));
  console.log("  损失链(连续模型): Echg=%s Ect=%s Est=%s Edis=%s Edt=%s  Σ5=%s",
    Echg.toFixed(0), Ect.toFixed(0), Est.toFixed(0), Edis.toFixed(0), Edt.toFixed(0), chain5.toFixed(0));
  console.log("  损失链(adaptive真值): Ect_real=%s Edt_real=%s  Σ5_real=%s",
    Ect_real.toFixed(0), Edt_real.toFixed(0), chain5_real.toFixed(0));
  console.log("  E_cycle_sys(引擎)=%s  ΔE(连续-引擎)=%s", sys.E_cycle_sys.toFixed(0), (chain5 - sys.E_cycle_sys).toFixed(0));
  console.log("  Σ5_real 是否≈E_cycle_sys: %s (Δ=%s)", Math.abs(chain5_real - sys.E_cycle_sys) < 1, (chain5_real - sys.E_cycle_sys).toFixed(1));
  console.log("  计算表 row0: O=%s Mout=%s Nin=%s", (r0.O*100).toFixed(2)+"%", r0.Mout.toFixed(1), r0.Nin.toFixed(1));
  console.log("  首年(Year0 row4): O=%s 单元转换(Mout/Nin)=%s 站用电率(1-O)=%s",
    (rY0.O*100).toFixed(2)+"%", (rY0.Mout/rY0.Nin*100).toFixed(2)+"%", ((1-rY0.O)*100).toFixed(2)+"%");
}

run({}, "默认 0.5P@25℃ N=1 标准待机");
run({ T: 45 }, "0.5P@45℃ N=1");
run({ r: 0.25, T: -20 }, "0.25P@-20℃ N=1 严寒");
run({ N: 2 }, "0.5P@25℃ N=2");
run({ mode: "4.2" }, "0.5P@25℃ N=1 液冷自循环");
run({ coolStrategy: "continuous" }, "0.5P@25℃ N=1 连续冷却(对照)");

console.log("\n\n########## 镜像 renderLoss (修复后: kW/kWh + 自适应冷尾 + GB/T站用电率) ##########");
function mirror(auxOverrides, label) {
  const state = ENG.createState(V, { aux: auxOverrides });
  ENG.derive(V, state.inputs, state.aux);
  const table = ENG.computeTable(V, state.inputs, state.aux, state.deg, state.aug1, state.aug2, state.sohSrc, null);
  const sys = table.sys, r0 = table.rows[0];
  const K = 1000;
  const tact = sys.tAct, ttail = sys.tTail, tstby = sys.tRest;
  const Pchg = sys.P_chg_sys*K, Pdis = sys.P_dis_sys*K, Pst = sys.P_stby_sys*K;
  const Echg = Pchg*tact, Edis = Pdis*tact, Est = Pst*tstby;
  const Ect = (sys.nC*sys.eTailC/1000 + sys.pac.tail*ttail)*K;
  const Edt = (sys.nC*sys.eTailD/1000 + sys.pac.tail*ttail)*K;
  const Ecyc = sys.E_cycle_sys*K;
  const sum5 = Echg + Ect + Est + Edis + Edt;
  const denom = r0.Nin + sys.E_cycle_sys - sys.P_dis_sys*sys.t_dis;
  const stnRate = denom>0 ? sys.E_cycle_sys/denom*100 : 0;
  console.log("\n===== " + label + " =====");
  console.log("  损失链显示(kW/kWh): 充电辅耗 %d kW×%dh=%d kWh | 充电冷尾 %d kWh | 静置待机 %d kWh | 放电辅耗 %d kWh | 放电冷尾 %d kWh",
    Pchg, tact, Echg, Ect, Est, Edis, Edt);
  console.log("  五阶段之和=%d kWh  单循环辅耗 Ecyc=%d kWh  差值=%d  → %s",
    sum5, Ecyc, sum5-Ecyc, Math.abs(sum5-Ecyc)<1 ? "PASS(自洽)" : "FAIL");
  console.log("  KPI: 综合效率(O)=%s  单元转换=%s  站用电率(GB/T)=%s%%  单循环辅耗=%d kWh",
    (r0.O*100).toFixed(2)+"%", (r0.Mout/r0.Nin*100).toFixed(2)+"%", stnRate.toFixed(2), Ecyc);
}
mirror({}, "默认 0.5P@25℃ N=1");
mirror({ T: 45 }, "0.5P@45℃ N=1");
mirror({ r: 0.25, T: -20 }, "0.25P@-20℃");
mirror({ N: 2 }, "0.5P@25℃ N=2");
mirror({ mode: "4.2" }, "0.5P@25℃ 液冷自循环");

console.log("\n\n########## 引擎 lossFactors 五因子分解自洽 (ΣΔ = 1−O) ##########");
function testLoss(auxOverrides, label) {
  const state = ENG.createState(V, { aux: auxOverrides });
  ENG.derive(V, state.inputs, state.aux);
  const table = ENG.computeTable(V, state.inputs, state.aux, state.deg, state.aug1, state.aug2, state.sohSrc, null);
  const sys = table.sys;
  const r0 = table.rows[0];
  const lf = ENG.decomposeLoss(r0, state.inputs, sys.E_cycle_sys);
  const sum = lf.dc + lf.chg + lf.dis + lf.cable + lf.aux + lf.other;
  const kept = lf.kept;
  const total = sum + kept;
  const ok = Math.abs(total - 1) < 1e-9 && Math.abs(lf.O - kept) < 1e-12;
  console.log("\n===== " + label + " =====");
  console.log("  O=%s%%  kept=%s%%  Σ损失=%s%%  合计=%s%%  → %s",
    (lf.O*100).toFixed(2), (kept*100).toFixed(2), (sum*100).toFixed(2), (total*100).toFixed(2), ok?"PASS":"FAIL");
  console.log("  分段(占1): dc=%s chg=%s dis=%s cable=%s aux=%s other=%s",
    (lf.dc*100).toFixed(2), (lf.chg*100).toFixed(2), (lf.dis*100).toFixed(2), (lf.cable*100).toFixed(2), (lf.aux*100).toFixed(2), (lf.other*100).toFixed(2));
  console.log("  站用电率(aux_rel)=%s%%  Pno(无辅耗往返)=%s%%  K=%s η_chg=%s η_dis=%s η_cable=%s",
    (lf.aux_rel*100).toFixed(2), (lf.Pno*100).toFixed(2), lf.dcRte, lf.effChg, lf.effDis, lf.cableEff);
}
testLoss({}, "默认 0.5P@25℃ N=1");
testLoss({ T: 45 }, "0.5P@45℃ N=1");
testLoss({ r: 0.25, T: -20 }, "0.25P@-20℃");
testLoss({ N: 2 }, "0.5P@25℃ N=2");
testLoss({ mode: "4.2" }, "0.5P@25℃ 液冷自循环");

