/* _verify_catalog.js — 产品目录层校验（v3.0 P0）
 * 运行: node test/_verify_catalog.js   （或 node test/run_all.js）
 *
 * 覆盖（P0 验收标准）：
 *   1. 默认视图等价金基准：makeDataView("S670H401") 的矩阵/网格/待机与
 *      原 V12 全量字段一致（资产化不改变既有计算行为）。
 *   2. SKU 引用完整性：每个 SKU 的 auxMatrixId 必须在 auxMatrices 中存在。
 *   3. 视图路由真实生效：视图的 M 引用 = 其 auxMatrixId 的 M 对象（非共享默认）。
 *   4. 引擎按视图计算一致：ENG.algo 用视图 V 与用原 V12 结果逐位一致（默认 SKU）。
 *   5. 独立矩阵资产可切换：构造一个虚拟 SKU 指向缩放矩阵，视图必须独立、
 *      引擎结果按矩阵变化（证明"换产品换矩阵"不是摆设）。
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// --- 载入 catalog + data + engine（同浏览器加载序）---
const catCode = fs.readFileSync(path.join(ROOT, "catalog.js"), "utf8");
const dataCode = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
global.window = {};
eval(catCode + "\n" + dataCode);
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
["inputs", "degRows", "augDefault", "rOptions", "tOptions", "nOptions",
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

console.log("─".repeat(46));
console.log(failed === 0 ? "catalog 校验全部通过 ✅" : "catalog 校验失败 " + failed + " 项 ❌");
process.exit(failed === 0 ? 0 : 1);
