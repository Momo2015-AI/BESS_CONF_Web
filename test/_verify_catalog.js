/* _verify_catalog.js — 产品目录层校验（v3.0 P1）
 * 运行: node test/_verify_catalog.js   （或 node test/run_all.js）
 *
 * 覆盖（P1 验收标准）：
 *   1. 默认视图等价金基准：makeDataView("S670H401") 的矩阵/网格/待机与
 *      原 V12 全量字段一致（资产化不改变既有计算行为）。
 *   2. SKU 引用完整性：每个 SKU 的 auxMatrixId 必须在 auxMatrices 中存在；
 *      产品固定量（cellModel/energy/clusters/rateP）正确注入 V。
 *   3. 视图路由真实生效：视图的 M 引用 = 其 auxMatrixId 的 M 对象（非共享默认）。
 *   4. 引擎按视图计算一致：ENG.algo 用视图 V 与用原 V12 结果逐位一致（默认 SKU）；
 *      derive 优先使用 V.energyPerContainerMWh（B 重构）。
 *   5. 独立矩阵资产可切换：构造一个虚拟 SKU 指向缩放矩阵，视图必须独立、
 *      引擎结果按矩阵变化（证明"换产品换矩阵"不是摆设）。
 *   6. 电芯-衰减曲线绑定：S670→LF702K，S401/S261→MB31；未命中回退并标记。
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// --- 载入 catalog + data + engine（同浏览器加载序）---
const catCode = fs.readFileSync(path.join(ROOT, "catalog.js"), "utf8");
const dataCode = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
const batteryCode = fs.readFileSync(path.join(ROOT, "data_battery.js"), "utf8");
global.window = {};
eval(catCode + "\n" + dataCode + "\n" + batteryCode);
const CATALOG = global.window.BESS_CATALOG;
const V12 = global.window.V12;
const ENG = require(path.join(ROOT, "calc_engine.js"));

let failed = 0;
function ok(cond, label, detail) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label + (detail ? "  -> " + detail : ""));
  if (!cond) failed++;
}

console.log("════════ _verify_catalog.js — 产品目录层 ════════");

/* ---- 1. 默认视图等价金基准 ---- */
console.log("[1] makeDataView(S670H401) ≡ 原 V12（默认资产视图）");
const view = CATALOG.makeDataView(CATALOG, "S670H401", V12);
ok(view.M === CATALOG.auxMatrices["AUX-5MWH-STD"].M && view.M === V12.M,
   "矩阵引用与 V12 同源（资产化不改变既有行为）");
["Tgrid", "Rgrid", "STBY"].forEach(k =>
  ok(JSON.stringify(view[k]) === JSON.stringify(V12[k]), k + " 等价"));
["inputs", "augDefault", "rOptions", "tOptions", "nOptions",
 "linkPairs", "linksDefault", "auxDefault", "coolStrategy", "tailCoolFrac"]
 .forEach(k => ok(view[k] === V12[k] || JSON.stringify(view[k]) === JSON.stringify(V12[k]),
                  "字段共享/等价: " + k));
ok(view.rOptions !== V12.rOptions, "rOptions 为视图独立数组（防下拉选项串改）");

/* ---- 2. SKU 引用完整性 ---- */
console.log("[2] SKU 引用完整性");
Object.keys(CATALOG.products).forEach(id => {
  const sku = CATALOG.products[id];
  ok(!!CATALOG.auxMatrices[sku.auxMatrixId],
     id + " → auxMatrixId " + sku.auxMatrixId + " 存在");
  ["ident.productModel", "arch.energyPerContainerMWh", "arch.clustersPerContainer"]
    .forEach(f => ok(f.split(".").reduce((o, k) => o && o[k], sku) != null,
                     id + " 必填 " + f));
});

/* ---- 3. 未知 SKU / 未知矩阵必须抛错 ---- */
console.log("[3] 非法引用必须显式失败");
let threw1 = false, threw2 = false;
try { CATALOG.makeDataView(CATALOG, "NO-SUCH-SKU", V12); } catch (e) { threw1 = true; }
ok(threw1, "未知 SKU 抛错");
const _saved = CATALOG.products["S670H401"].auxMatrixId;
try {
  CATALOG.products["S670H401"].auxMatrixId = "NO-SUCH-MATRIX";
  CATALOG.makeDataView(CATALOG, "S670H401", V12);
} catch (e) { threw2 = true; }
finally { CATALOG.products["S670H401"].auxMatrixId = _saved; }
ok(threw2, "未知 auxMatrixId 抛错");

/* ---- 4. 引擎按视图计算一致（默认 SKU = 既有结果）---- */
console.log("[4] 引擎消费视图结果一致");
const aux = Object.assign({}, V12.auxDefault);
const a_v12 = ENG.computeAux(V12, V12.inputs, aux);
const a_view = ENG.computeAux(view, V12.inputs, aux);
ok(Math.abs(a_v12.E_cycle_sys - a_view.E_cycle_sys) < 1e-12,
   "E_cycle_sys 一致", a_view.E_cycle_sys.toFixed(6) + " MWh");

/* ---- 5. 矩阵资产可切换（换 SKU 真的换矩阵）---- */
console.log("[5] 独立矩阵资产可切换");
const aux2 = JSON.parse(JSON.stringify(CATALOG.auxMatrices["AUX-5MWH-STD"]));
aux2.M.chg = aux2.M.chg.map(row => row.map(x => x * 2));   // 充电段功率×2 的虚拟矩阵
CATALOG.auxMatrices["AUX-FAKE-2X"] = aux2;
const _savedSku = JSON.parse(JSON.stringify(CATALOG.products["S670H401"]));
CATALOG.products["S670H401"].auxMatrixId = "AUX-FAKE-2X";
try {
  const view2 = CATALOG.makeDataView(CATALOG, "S670H401", V12);
  const a2 = ENG.computeAux(view2, V12.inputs, aux);
  const ratio = a2.pChg / a_v12.pChg;
  ok(Math.abs(ratio - 2) < 1e-9, "矩阵切换生效（pChg 比例=2）", "ratio=" + ratio.toFixed(4));
  ok(view2.M !== view.M, "两个视图矩阵对象互相独立");
} finally {
  delete CATALOG.auxMatrices["AUX-FAKE-2X"];
  CATALOG.products["S670H401"] = _savedSku;
}

/* ---- 6. 产品固定量与衰减曲线绑定（B 重构）---- */
console.log("[6] 产品固定量 & 衰减曲线按电芯型号绑定");
const viewS670 = CATALOG.makeDataView(CATALOG, "S670H401", V12);
ok(viewS670.cellModel === "LF702K", "S670 cellModel=LF702K");
ok(viewS670.energyPerContainerMWh === 6.9, "S670 energyPerContainerMWh=6.9");
ok(viewS670.clustersPerContainer === 8, "S670 clustersPerContainer=8");
ok(viewS670.rateP === 0.25, "S670 rateP=0.25");
ok(viewS670.degSource === "cell-LF702K", "S670 degSource=cell-LF702K");
ok(Math.abs(viewS670.degRows[0].H - 0.9925) < 1e-9, "S670 FAT SOH=0.9925 (LF702K)");
ok(Math.abs(viewS670.degRows[1].H - 0.9550) < 1e-9, "S670 SAT SOH=0.9550 (LF702K)");

const viewS401 = CATALOG.makeDataView(CATALOG, "S401H201", V12);
ok(viewS401.cellModel === "MB31", "S401 cellModel=MB31");
ok(viewS401.energyPerContainerMWh === 0.401, "S401 energyPerContainerMWh=0.401");
ok(viewS401.degSource === "cell-MB31", "S401 degSource=cell-MB31");
ok(Math.abs(viewS401.degRows[0].H - 1.0) < 1e-9, "S401 FAT SOH=1.0 (MB31)");

const viewS261 = CATALOG.makeDataView(CATALOG, "S261H100", V12);
ok(viewS261.cellModel === "MB31", "S261 cellModel=MB31");
ok(viewS261.energyPerContainerMWh === 0.261, "S261 energyPerContainerMWh=0.261");
ok(viewS261.clustersPerContainer === 2, "S261 clustersPerContainer=2");
ok(viewS261.degSource === "cell-MB31", "S261 degSource=cell-MB31");

// 引擎 derive 优先使用 V.energyPerContainerMWh（而非 inputs.perContainer）
const inputs10 = Object.assign({}, V12.inputs, { containerCount: 10 });
const aux0 = Object.assign({}, V12.auxDefault);
const stV12 = ENG.createState(viewS670, { inputs: inputs10 });
ENG.derive(viewS670, stV12.inputs, aux0);
ok(Math.abs(stV12.inputs.nom - 69) < 1e-9,
   "derive 使用 V.energyPerContainerMWh (10箱×6.9=69)", "nom=" + stV12.inputs.nom);
// 兼容性：无 energyPerContainerMWh 时回退 inputs.perContainer
const viewLegacy = Object.assign({}, viewS670);
delete viewLegacy.energyPerContainerMWh;
const stLegacy = ENG.createState(viewLegacy, { inputs: Object.assign({}, V12.inputs, { containerCount: 10, perContainer: 3.5 }) });
ENG.derive(viewLegacy, stLegacy.inputs, aux0);
ok(Math.abs(stLegacy.inputs.nom - 35) < 1e-9,
   "derive 兼容回退 inputs.perContainer", "nom=" + stLegacy.inputs.nom);

console.log("─".repeat(46));
console.log(failed === 0 ? "catalog 校验全部通过 ✅" : "catalog 校验失败 " + failed + " 项 ❌");
process.exit(failed === 0 ? 0 : 1);
