/* 运行全部校验脚本并汇总结果
 * 用法: node test/run_all.js
 */
const { spawnSync } = require("child_process");
const path = require("path");

const here = __dirname;
const scripts = ["_verify.js", "_verify_loss.js", "_verify_v13.js", "_verify_dataflow.js", "_verify_catalog.js"];
let allOk = true;

for (const s of scripts) {
  const f = path.join(here, s);
  console.log("\n══════════════════════════════════════════");
  console.log("▶ " + s);
  console.log("══════════════════════════════════════════");
  const res = spawnSync(process.execPath, [f], { cwd: here, encoding: "utf8" });
  const out = (res.stdout || "") + (res.stderr || "");
  process.stdout.write(out);
  const failed = /FAIL|❌|存在失败|未暴露/.test(out) || res.status !== 0;
  if (failed) allOk = false;
  console.log("  → " + s + (failed ? " ❌ 失败" : " ✅ 通过"));
}

console.log("\n──────────────── 汇总 ────────────────");
console.log(allOk ? "全部校验通过 ✅" : "存在失败用例 ❌");
process.exit(allOk ? 0 : 1);
