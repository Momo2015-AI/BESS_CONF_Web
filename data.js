/* =========================================================================
 * 储能BESS配置器 — 数据源 (data.js)
 * 通用版本：所有数值/矩阵/输入参数集中维护，便于任意项目复用。
 * 以经典 <script> 全局变量方式暴露，确保 file:// 双击即可运行、无需构建。
 * ========================================================================= */
window.V12 = (function () {
  "use strict";

  // ---- 辅耗功率矩阵 (实测 5MWh 集装箱 6 步循环) ----
  // 行序: 倍率 r = [0.25, 0.33, 0.5]; 列序: 温度 T = [-20, 0, 25, 35, 45]
  const M = {
    chg:   [[7.1, 11.2, 12.5, 13.8, 18.8], [10.2, 19.6, 21.0, 26.7, 32.0], [11.3, 27.3, 32.5, 33.0, 34.0]],
    tailC: [[8.0, 12.5, 14.0, 15.5, 21.1], [9.7, 18.7, 20.0, 25.5, 30.0], [9.7, 23.5, 28.0, 32.0, 33.0]],
    dis:   [[4.7, 7.4, 8.3, 9.1, 12.4], [6.0, 11.5, 12.3, 15.7, 20.0], [9.6, 23.1, 27.5, 33.0, 34.0]],
    tailD: [[9.1, 14.3, 16.0, 17.7, 24.1], [9.5, 18.2, 19.5, 24.8, 30.0], [7.6, 18.5, 22.0, 32.0, 33.0]]
  };

  const Tgrid = [-20, 0, 25, 35, 45];
  const Rgrid = [0.25, 0.33, 0.5];
  const STBY = { "1.0": 1.0, "4.2": 4.2 }; // 待机模式: 标准待机 / 液冷自循环

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
