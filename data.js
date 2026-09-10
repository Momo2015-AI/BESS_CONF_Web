/* =========================================================================
 * 储能BESS配置器 — 数据源 (data.js)
 * 通用版本：所有数值/矩阵/输入参数集中维护，便于任意项目复用。
 * 以经典 <script> 全局变量方式暴露，确保 file:// 双击即可运行、无需构建。
 * ========================================================================= */
window.V12 = (function () {
  "use strict";

  // ---- 辅耗功率矩阵：2026-09-08 起资产化到 catalog.js（按产品族 keyed）----
  // V12.M/Tgrid/Rgrid/STBY 保留为「默认资产视图」引用（向后兼容旧调用方），
  // 产品级视图请用 BESS_CATALOG.makeDataView(catalog, productId) 构造。
  // 三环境作用域统一：①浏览器 <script> → 全局标识符 ②Node require → module.exports
  // ③Node eval（测试场景）→ catalog 把 API 赋到 window.BESS_CATALOG，但裸标识符
  //   在 eval 作用域不可见 → 这里同时检查 typeof/window/globalThis 三个落点。
  let _aux = (typeof BESS_CATALOG !== "undefined") ? BESS_CATALOG
           : (typeof window !== "undefined" && window.BESS_CATALOG) ? window.BESS_CATALOG
           : (typeof globalThis !== "undefined" && globalThis.BESS_CATALOG) ? globalThis.BESS_CATALOG
           : null;
  if (!_aux) {
    try { _aux = require("./catalog.js"); }
    catch (e) {
      const _p = (typeof __dirname !== "undefined" ? __dirname : "");
      const _f = _p && (function(){ try { return require("fs").readFileSync(require("path").join(_p, "catalog.js"), "utf8"); } catch (_) { return null; } })();
      if (!_f) throw new Error("catalog.js not found; load catalog.js before data.js");
      const _scope = {};
      (new Function("module", "exports", "window", "global", _f))( {exports:_scope}, _scope, window, global);
      _aux = _scope.BESS_CATALOG || _aux;
    }
  }
  const _std = _aux && _aux.auxMatrices["AUX-5MWH-STD"];
  if (!_std) throw new Error("catalog.js loaded but AUX-5MWH-STD missing — data corrupted");
  const M = _std.M;
  const Tgrid = _std.Tgrid;
  const Rgrid = _std.Rgrid;
  const STBY = _std.STBY;

  // ---- 输入参数默认值 (对齐 Inputs 页 D 列) ----
  const inputs = {
    powerPoC:      80,      // D4  并网点保证功率 (MW)
    epoc:          240,     // D5  并网点保证容量 (MWh)  ← O 列引用
    effChg:        0.9698,  // D6  充电单程效率 η_chg
    effDis:        0.9741,  // D7  放电单程效率 η_dis
    powerFactor:   0.95,    // D8  功率因数 (备用)
    acContainerSize: 40,    // D9  AC 集装箱尺寸 ft (备用)
    mvSkidCap:     10,      // D10 MV SKID 单台容量 MW (备用)
    skidCount:     16,      // D11 MV 升压变数量
    acAuxNoLoad:   0.003125, // 单台 SKID 空载损耗 (MV 变压器铁损+控制+消防) MW  ← 系统空载 = 该值 × SKID 数
    acAuxLoadPct:  0.0036,  // AC 侧负载损耗系数 (占电网功率比, 0.36%)
    reqP:          80,      // D15 直流侧需求功率 (MW)  ← J/K 引用
    reqEnergyDC:   240,     // D16 直流侧需求容量 (备用)
    rteOverride:   "",      // DC 往返效率 RTE 全局覆盖 (空=用衰减表逐年 K)
    dod:           1.00,    // 放电深度 DOD (影响可用直流电量)
    cable:         0.998,   // D17 直流电缆效率 η_cable
    containerCount:62,      // D19 直流电池集装箱数量
    perContainer:  5,       // D20 单箱容量 (MWh)
    // 以下为派生量（运行时自动计算，不直接编辑）:
    // auxAC   = AC 辅耗模型活跃相功率 (noLoad + loadPct*reqP)   (D13)
    // acTotalPower = mvSkidCap * skidCount                      (AC 总功率)
    // nom     = containerCount * perContainer                   (D18)
    // auxDCunit = AuxModel 单箱循环平均辅耗 avgMW               (D21)
    // auxDC   = auxDCunit * containerCount                      (D22)
  };

  // ---- 衰减曲线默认值 (Degradation 页: 年 Year / SOH(H) / DC-RTE(K)) ----
  // 行号映射: row3=FAT, row4=SAT(Year0), row5=1 ... row29=25
  const degRows = [
    { row: 3,  label: "FAT",         H: 1.0000, K: 0.941 },
    { row: 4,  label: "SAT (Year0)", H: 0.9925, K: 0.941 },
    { row: 5,  label: "1",           H: 0.9318, K: 0.9384 },
    { row: 6,  label: "2",           H: 0.9014, K: 0.9372 },
    { row: 7,  label: "3",           H: 0.8770, K: 0.9363 },
    { row: 8,  label: "4",           H: 0.8560, K: 0.9355 },
    { row: 9,  label: "5",           H: 0.8371, K: 0.9347 },
    { row: 10, label: "6",           H: 0.8197, K: 0.9340 },
    { row: 11, label: "7",           H: 0.8036, K: 0.9333 },
    { row: 12, label: "8",           H: 0.7885, K: 0.9326 },
    { row: 13, label: "9",           H: 0.7742, K: 0.9320 },
    { row: 14, label: "10",          H: 0.7606, K: 0.9314 },
    { row: 15, label: "11",          H: 0.7475, K: 0.9308 },
    { row: 16, label: "12",          H: 0.7350, K: 0.9302 },
    { row: 17, label: "13",          H: 0.7230, K: 0.9296 },
    { row: 18, label: "14",          H: 0.7113, K: 0.9290 },
    { row: 19, label: "15",          H: 0.7000, K: 0.9285 },
    { row: 20, label: "16",          H: 0.6890, K: 0.9279 },
    { row: 21, label: "17",          H: 0.6780, K: 0.9273 },
    { row: 22, label: "18",          H: 0.6672, K: 0.9268 },
    { row: 23, label: "19",          H: 0.6564, K: 0.9262 },
    { row: 24, label: "20",          H: 0.6458, K: 0.9256 },
    { row: 25, label: "21",          H: 0.6354, K: 0.9251 },
    { row: 26, label: "22",          H: 0.6252, K: 0.9245 },
    { row: 27, label: "23",          H: 0.6152, K: 0.9240 },
    { row: 28, label: "24",          H: 0.6074, K: 0.9235 },
    { row: 29, label: "25",          H: 0.6008, K: 0.9230 }
  ];

  // ---- 补容默认值 (Calculation 页 F/G 列, 行=安装年) ----
  // 默认第 3 年 (row7) 补容 20 MWh
  const augDefault = { 7: 20 };

  // 倍率/温度/循环数 下拉选项
  const rOptions = Rgrid.slice();
  const tOptions = Tgrid.slice();
  const nOptions = [1, 2, 3];

  // ---- AC↔DC 联动配对 (1:1 同步, 可解锁独立编辑) ----
  // 每对: [主字段(AC 侧), 从字段(DC 侧)]; 默认锁定同步
  const linkPairs = {
    power:  ["powerPoC", "reqP"],        // AC 保证功率 ↔ DC 需求功率
    energy: ["epoc", "reqEnergyDC"]      // AC 保证容量 ↔ DC 需求容量
  };
  const linksDefault = { power: true, energy: true };

	  // ---- 冷尾优化策略 ----
	  // coolStrategy: "continuous"=全程强制冷却(保守,原逻辑) | "adaptive"=两阶段模型(推荐)
	  // tailCoolFrac: adaptive 模式下强制冷却时间占比 (0~1), 默认 0.30
	  //   物理依据: 电池停机后温度指数衰减, 冷却需求同步下降
	  //   30% 强制冷却 + 70% 自然冷却, 等效热时间常数 τ≈0.47h
	  const coolStrategy = "adaptive";
	  const tailCoolFrac = 0.30;

	  return {
	    M, Tgrid, Rgrid, STBY,
	    inputs, degRows, augDefault,
	    rOptions, tOptions, nOptions,
	    linkPairs, linksDefault,
	    coolStrategy, tailCoolFrac,
	    // 设计工况默认
	    auxDefault: { r: 0.5, T: 25, mode: "1.0", rest: "", N: 1 }
	  };
})();
