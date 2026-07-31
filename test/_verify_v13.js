/* V13 功能验证: 引擎加载 + M3 回退 + 捕获映射索引 */
const fs = require('fs'), path = require('path'), vm = require('vm');
global.window = global; global.document = undefined;
const base = path.join(__dirname, "..");
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
load('models.js'); load('data_battery.js'); load('fitted.js'); load('sim.js');

const SIM = global.__SIM;
if (!SIM) { console.error('FAIL: __SIM 未暴露'); process.exit(1); }
console.log('引擎加载 OK; 型号数(system)=', Object.keys(window.BDATA.systems).length);

const type = 'system';
const q = { rate: 0.5, dod: 1, cyclesPerDay: 1, cycleTemp: 25, restTemp: 25, restSOC: 0.5 };

// 1) EXACT 路径 (真实 S4)
const ser = SIM.computeSeries('EXACT', 'S4', type, q, 1.0, 0.93, 25, 0.9687);
console.log('[EXACT] source=', ser.source, '| len(soh)=', ser.soh.length, '| Y0/Y1/Y25=',
  (ser.soh[0]*100).toFixed(2), (ser.soh[1]*100).toFixed(2), (ser.soh[25]*100).toFixed(2));

// 2) 强制 M3 默认参数 (未知型号 → EXACT→M5均空 → 落到 M3 默认参数)
const ser3 = SIM.computeSeries('M3', 'ZZ-NOEXIST', type, q, 1.0, 0.93, 25, 0.9687);
const allFin = ser3.soh.every(isFinite) && (ser3.rte ? ser3.rte.every(isFinite) : true);
console.log('[M3默认] source=', ser3.source, '| 全有限=', allFin, '| Y25 SOH=', (ser3.soh[25]*100).toFixed(2)+'%');

// 3) EXACT→M5→M3 回退链验证: 用不存在的型号但走 modelKey='EXACT', 应回退到 M3
const serF = SIM.computeSeries('EXACT', 'ZZ-NOEXIST', type, q, 1.0, 0.93, 25, 0.9687);
console.log('[回退链] source=', serF.source, '| 含 M3=', /M3/.test(serF.source));

// 4) 捕获映射模拟: 模拟 __SIMOUT, 套用 app.js computeTable 的索引逻辑
const SIMOUT = { soh: ser.soh.slice(), rte: ser.rte ? ser.rte.slice() : null };
const deg = [];
// row3=FAT, row4=SAT, row5..29 = Year1..25
deg.push({ row: 3, H: 1.0, K: 0.941 });
deg.push({ row: 4, H: 0.9925, K: 0.941 });
for (let i = 1; i <= 25; i++) deg.push({ row: i + 4, H: null, K: null });
const mapped = deg.map(y => {
  let H = y.H, K = y.K;
  if (y.row === 3) { H = 1.0; if (SIMOUT.rte && SIMOUT.rte[0] != null) K = SIMOUT.rte[0]; }
  else if (y.row === 4) { H = 0.9925; if (SIMOUT.rte && SIMOUT.rte[0] != null) K = SIMOUT.rte[0]; }
  else { const yi = y.row - 4; if (yi >= 0 && yi < SIMOUT.soh.length && SIMOUT.soh[yi] != null) H = SIMOUT.soh[yi]; if (SIMOUT.rte && yi >= 0 && yi < SIMOUT.rte.length && SIMOUT.rte[yi] != null) K = SIMOUT.rte[yi]; }
  return { row: y.row, H, K };
});
console.log('[捕获映射] Year1 H=', (mapped[2].H*100).toFixed(2)+'%', '(应≈soh[1]', (ser.soh[1]*100).toFixed(2)+'%) |',
  'Year25 H=', (mapped[26].H*100).toFixed(2)+'%', '(应≈soh[25]', (ser.soh[25]*100).toFixed(2)+'%)');
const okMap = Math.abs(mapped[2].H - ser.soh[1]) < 1e-9 && Math.abs(mapped[26].H - ser.soh[25]) < 1e-9;
console.log('[捕获映射] 索引对齐=', okMap);

console.log('\n结论:', (allFin && /M3/.test(serF.source) && okMap) ? '全部通过 ✅' : '存在失败 ❌');
