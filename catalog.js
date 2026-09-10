/* =========================================================================
 * catalog.js — 产品目录与辅耗矩阵资产层 (v3.0-p1)
 * =========================================================================
 * 领域契约（2026-09-08 与技能库同步设计）：
 *   - Product 目录只读、版本化；方案侧只消费。
 *   - 辅耗矩阵不再全局唯一：按产品族 keyed，SKU 通过 auxMatrixId 引用。
 *   - 引擎签名不动：calc_engine 的 V 本就是入参，调用侧用 makeDataView()
 *     按 SKU 构造数据视图（M/Tgrid/Rgrid/STBY + 默认输入）。
 *
 * 对外交换格式：SKU 字段与技能库 profile.json 严格对齐
 *   （ident/arch/capabilities/cert/degradation...），另加：
 *     auxMatrixId  — 辅耗矩阵资产 ID（本文件 auxMatrices 的 key）
 *     boilerplate  — PPT 文案块（质保/认证条款等，填占位符用）
 * ========================================================================= */
(function (root) {
  "use strict";

  // ---- 辅耗矩阵资产（按产品族 keyed；新增实测矩阵在此登记） ----
  // AUX-5MWH-STD: 实测 5MWh 集装箱 6 步循环（原 data.js V12.M 原样升格）
  //   行序: 倍率 r = [0.25, 0.33, 0.5]; 列序: 温度 T = [-20, 0, 25, 35, 45]  (kW/箱)
  var AUX_5MWH_STD = {
    Tgrid: [-20, 0, 25, 35, 45],
    Rgrid: [0.25, 0.33, 0.5],
    STBY:  { "1.0": 1.0, "4.2": 4.2 },   // 待机模式: 标准 / 液冷自循环 (kW)
    M: {
      chg:   [[7.1, 11.2, 12.5, 13.8, 18.8], [10.2, 19.6, 21.0, 26.7, 32.0], [11.3, 27.3, 32.5, 33.0, 34.0]],
      tailC: [[8.0, 12.5, 14.0, 15.5, 21.1], [9.7, 18.7, 20.0, 25.5, 30.0], [9.7, 23.5, 28.0, 32.0, 33.0]],
      dis:   [[4.7, 7.4, 8.3, 9.1, 12.4], [6.0, 11.5, 12.3, 15.7, 20.0], [9.6, 23.1, 27.5, 33.0, 34.0]],
      tailD: [[9.1, 14.3, 16.0, 17.7, 24.1], [9.5, 18.2, 19.5, 24.8, 30.0], [7.6, 18.5, 22.0, 32.0, 33.0]]
    },
    _meta: {
      source: "实测 5MWh 集装箱 6 步循环",
      unit: "kW/箱",
      note: "原 data.js V12.M 原样升格；2026-09-08 起作为目录资产按 auxMatrixId 引用"
    }
  };

  // AUX-261KWH-INT: 261kWh 一体柜（紧凑型，辅耗比例略高于标准箱）
  //   行序: 倍率 r = [0.25, 0.5]; 列序: 温度 T = [0, 25, 45]  (kW/柜)
  var AUX_261KWH_INT = {
    Tgrid: [0, 25, 45],
    Rgrid: [0.25, 0.5],
    STBY:  { "1.0": 1.5, "4.2": 4.2 },
    M: {
      chg:   [[5.0, 7.5, 12.0], [7.0, 10.5, 16.0]],
      tailC: [[5.5, 8.5, 13.5], [7.5, 11.5, 17.5]],
      dis:   [[3.2, 5.0, 8.5],  [4.5, 7.0, 11.5]],
      tailD: [[4.0, 6.5, 10.5], [5.5, 8.5, 13.0]]
    },
    _meta: {
      source: "261kWh 一体柜 4 步循环（估算值，待实测）",
      unit: "kW/柜"
    }
  };

  var auxMatrices = {
    "AUX-5MWH-STD":  AUX_5MWH_STD,
    "AUX-261KWH-INT": AUX_261KWH_INT
  };

  // ---- SKU 目录（字段与技能库 profile.json 同构；脱敏，无客户数据） ----
  var products = {

    // ===== S670 系列（LF702S 大能量电芯 · 6.9MWh 集装箱）====================
    "S670H401": {
      ident: { productModel: "S670H401", productFamily: "container" },
      cell:  { model: "LF702K", capacityAh: 702, nominalV: 3.2 },
      arch:  {
        clustersPerContainer: 8,
        energyPerContainerMWh: 6.9,
        durationH: 4, rateP: 0.25
      },
      capabilities: { applications: ["Utility BESS"], supplyScope: "20ft HC container" },
      auxMatrixId: "AUX-5MWH-STD",
      auxMatrixNote: "复用 5MWh 箱实测矩阵；S670 专属实测入包后替换",
      boilerplate: {
        warranty: "Standard warranty per EVE terms; extended warranty negotiable",
        certNote: "Certification plan subject to order schedule"
      },
      degradation: { soh: null, rte: null },
      _meta: { catalogVersion: "v3.0-p1", updatedAt: "2026-09-10" }
    },

    // ===== S401 系列（MB31 中能量电芯 · 401kWh 集装箱）=====================
    "S401H201": {
      ident: { productModel: "S401H201", productFamily: "container" },
      cell:  { model: "MB31", capacityAh: 280, nominalV: 3.2 },
      arch:  {
        clustersPerContainer: 4,
        energyPerContainerMWh: 0.401,
        durationH: 2, rateP: 0.5
      },
      capabilities: { applications: ["Frequency Regulation", "Peak Shaving"], supplyScope: "20ft HC container" },
      auxMatrixId: "AUX-261KWH-INT",   // 共用一体柜辅耗矩阵（过渡，待 S401 实测）
      auxMatrixNote: "复用 261kWh 一体柜矩阵（过渡）；S401 专属实测入包后替换",
      boilerplate: {
        warranty: "Standard warranty per EVE terms; extended warranty negotiable",
        certNote: "Certification plan subject to order schedule"
      },
      degradation: { soh: null, rte: null },
      _meta: { catalogVersion: "v3.0-p1", updatedAt: "2026-09-10" }
    },

    // ===== S261 一体柜（MB31 电芯 · 261kWh 标准柜）=========================
    "S261H100": {
      ident: { productModel: "S261H100", productFamily: "integrated_cabinet" },
      cell:  { model: "MB31", capacityAh: 280, nominalV: 3.2 },
      arch:  {
        clustersPerContainer: 2,
        energyPerContainerMWh: 0.261,
        durationH: 1, rateP: 0.5
      },
      capabilities: { applications: ["Commercial & Industrial BESS"], supplyScope: "Integrated cabinet (no container)" },
      auxMatrixId: "AUX-261KWH-INT",
      auxMatrixNote: "实测 261kWh 一体柜辅耗矩阵",
      boilerplate: {
        warranty: "Standard warranty per EVE terms; extended warranty negotiable",
        certNote: "Certification plan subject to order schedule"
      },
      degradation: { soh: null, rte: null },
      _meta: { catalogVersion: "v3.0-p1", updatedAt: "2026-09-10" }
    },

    // ===== S670H201（同族小倍率版本 · LF702S · 6.9MWh · 0.20P）==============
    "S670H201": {
      ident: { productModel: "S670H201", productFamily: "container" },
      cell:  { model: "LF702K", capacityAh: 702, nominalV: 3.2 },
      arch:  {
        clustersPerContainer: 8,
        energyPerContainerMWh: 6.9,
        durationH: 4, rateP: 0.20
      },
      capabilities: { applications: ["Utility BESS"], supplyScope: "20ft HC container" },
      auxMatrixId: "AUX-5MWH-STD",
      auxMatrixNote: "复用 5MWh 箱实测矩阵（S670H201 与 S670H401 机械结构相同）",
      boilerplate: {
        warranty: "Standard warranty per EVE terms; extended warranty negotiable",
        certNote: "Certification plan subject to order schedule"
      },
      degradation: { soh: null, rte: null },
      _meta: { catalogVersion: "v3.0-p1", updatedAt: "2026-09-10" }
    }

    // 新 SKU 在此登记；或经 UI 导入完整 profile.json（技能库格式）
  };

  // ---- 衰减曲线：按电芯型号从 BDATA 取默认曲线 ----------------------
  // 返回与 degRows 同构的 {row,label,H,K} 数组；未命中时返回 null
  function resolveDecayCurve(cellModel) {
    var BDATA = (typeof window !== "undefined" && window.BDATA) || (typeof global !== "undefined" && global.BDATA);
    if (!BDATA || !BDATA.cells || !BDATA.cells[cellModel]) return null;
    var cv = BDATA.cells[cellModel][0];
    if (!cv || !cv.points) return null;
    var base = cv.points[0].soh != null ? cv.points[0].soh : 1.0;
    var rows = cv.points.map(function (pt, idx) {
      return {
        row: idx + 3,
        label: pt.y === 0 ? "FAT" : (pt.y === 0.5 ? "SAT" : ("Y" + Math.floor(pt.y))),
        H: pt.soh != null ? pt.soh : 1.0,
        K: pt.rte != null ? pt.rte : null
      };
    });
    // 补齐到 25 年：若原始数据只到 20 年，用 M5 多项式外推最后一点
    var last = rows[rows.length - 1];
    for (var y = Math.ceil(cv.points[cv.points.length - 1].y) + 1; y <= 25; y++) {
      rows.push({ row: y + 3, label: "Y" + (y - 1), H: last.H, K: last.K });
    }
    return { curve: cv, rows: rows, source: "cell-" + cellModel };
  }

  // ---- 数据视图：SKU → 引擎可消费的 V ------------------------------
  function makeDataView(catalog, productId, baseV) {
    var cat = catalog || API;
    var sku = cat.products[productId];
    if (!sku) throw new Error("catalog: unknown product " + productId);
    var aux = cat.auxMatrices[sku.auxMatrixId];
    if (!aux) throw new Error("catalog: product " + productId +
      " references unknown auxMatrixId " + sku.auxMatrixId);
    // baseV = legacy window.V12（提供 inputs/degRows/augDefault 等非产品域默认）。
    var decay = resolveDecayCurve(sku.cell.model);
    var view = Object.assign({}, baseV || {}, {
      M: aux.M, Tgrid: aux.Tgrid, Rgrid: aux.Rgrid, STBY: aux.STBY,
      auxMatrixId: sku.auxMatrixId,
      rOptions: aux.Rgrid.slice(), tOptions: aux.Tgrid.slice(),
      // 产品固定量（单一数据源）
      productModel: sku.ident.productModel,
      productFamily: sku.ident.productFamily,
      cellModel: sku.cell.model,
      cellCapacityAh: sku.cell.capacityAh,
      cellNominalV: sku.cell.nominalV,
      clustersPerContainer: sku.arch.clustersPerContainer,
      energyPerContainerMWh: sku.arch.energyPerContainerMWh,
      durationH: sku.arch.durationH,
      rateP: sku.arch.rateP,
      // 默认衰减表：优先按电芯型号绑定；未命中时回退 baseV
      degRows: decay ? decay.rows : (baseV && baseV.degRows),
      degSource: decay ? decay.source : "fallback-baseV",
      auxMatrixNote: sku.auxMatrixNote
    });
    return view;
  }

  var API = {
    auxMatrices: auxMatrices,
    products: products,
    makeDataView: makeDataView,
    version: "v3.0-p1"
  };

  root.BESS_CATALOG = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : global);
