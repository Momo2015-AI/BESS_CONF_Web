// 储能电池衰减模型库 M1–M5 (纯函数, 浏览器/Node 通用) —— M1–M4 为参数模型, M5 为数据驱动经验多项式(系数来自 fitted.js)
// 每个模型 fn(params, cond, y) 返回"容量损失 qloss"(相对初始容量的分数, >=0)
// 最终 SOH = SOH0 - qloss ; RTE = RTE0 - kRTE * qloss
(function (root) {
  "use strict";

  function cond(c) {
    return {
      rate: c.rate != null ? c.rate : 0.5,
      dod: c.dod != null ? c.dod : 1.0,
      cyclesPerDay: c.cyclesPerDay != null ? c.cyclesPerDay : 1.0,
      cycleTemp: c.cycleTemp != null ? c.cycleTemp : 25,
      restTemp: c.restTemp != null ? c.restTemp : 25,
      restSOC: c.restSOC != null ? c.restSOC : 0.5,
    };
  }

  // 等效满循环(年累计)
  function Ne(c, y) {
    return c.cyclesPerDay * 365 * y * c.dod;
  }

  const MODELS = {
    // M1 线性叠加: 循环损伤(线性于吞吐) + 日历 Arrhenius + SOC二次项 + 初始项 (厂商常用, 默认)
    M1: {
      key: "M1",
      name: "线性叠加(厂商常用)",
      desc: "循环损伤 Ac·Ne·f(倍率) + 日历损伤 At·exp((T-25)/q)·y·(1+b·ΔSOC²) + 初始项A0  (Ne=等效满循环)",
      params: ["A0", "Ac", "kr", "At", "q", "b"],
      init: [0.02, 8.6e-5, 0.1, 0.004, 12, 1.0],
      lo: [0, 1e-6, -1.0, 1e-5, 2.0, -2.0],
      hi: [0.15, 5e-3, 2.0, 0.05, 40, 5.0],
      fn: function (p, c, y) {
        c = cond(c);
        const ne = Ne(c, y);
        const cyc = p[1] * ne * Math.pow(c.rate / 0.5, p[2]);
        const cal = p[3] * Math.exp((c.restTemp - 25) / p[4]) * y * (1 + p[5] * Math.pow(c.restSOC - 0.5, 2));
        return Math.min(0.95, Math.max(0, p[0] + cyc + cal));
      },
    },
    // M2 双指数/膝形: 两段膝形(首年陡降+后期缓降) × 倍率/温度标度
    M2: {
      key: "M2",
      name: "双指数膝形",
      desc: "qloss = [A1(1-e^(-Ne/τ1)) + A2(1-e^(-Ne/τ2))]·f(倍率)·exp((T-25)/q2)",
      params: ["A1", "tau1", "A2", "tau2", "kr2", "q2"],
      init: [0.05, 600, 0.20, 6000, 0.1, 12],
      lo: [1e-3, 20, 1e-3, 50, -1.0, 2.0],
      hi: [0.5, 50000, 0.6, 200000, 2.0, 40],
      fn: function (p, c, y) {
        c = cond(c);
        const ne = Ne(c, y);
        const knee = p[0] * (1 - Math.exp(-ne / p[1])) + p[2] * (1 - Math.exp(-ne / p[3]));
        return Math.min(0.95, Math.max(0, knee * Math.pow(c.rate / 0.5, p[4]) * Math.exp((c.restTemp - 25) / p[5])));
      },
    },
    // M3 平方根模型 (Wang/Cui): sqrt(吞吐) + sqrt(时间·Arrh·SOC)
    M3: {
      key: "M3",
      name: "平方根(Wang/Cui)",
      desc: "qloss = Ac·√Ne·f(倍率) + At·√(y·exp((T-25)/q)·(1+b·ΔSOC²))",
      params: ["Ac", "kr", "At", "q", "b"],
      init: [0.003, 0.1, 0.004, 12, 1.0],
      lo: [1e-4, -1.0, 1e-5, 2.0, -2.0],
      hi: [0.03, 2.0, 0.05, 40, 5.0],
      fn: function (p, c, y) {
        c = cond(c);
        const ne = Ne(c, y);
        const cyc = p[0] * Math.sqrt(ne) * Math.pow(c.rate / 0.5, p[1]);
        const cal = p[2] * Math.sqrt(y * Math.exp((c.restTemp - 25) / p[3]) * (1 + p[4] * Math.pow(c.restSOC - 0.5, 2)));
        return Math.min(0.95, Math.max(0, cyc + cal));
      },
    },
    // M4 纯 Arrhenius 日历主导: 温度敏感性分析
    M4: {
      key: "M4",
      name: "Arrhenius日历主导",
      desc: "qloss = k0·exp(-Ea/RT)·y^p·(循环·DOD)^p2  (归一化于25℃)",
      params: ["k0", "Ea", "p", "p2"],
      init: [0.02, 40000, 0.8, 0.5],
      lo: [1e-3, 20000, 0.3, 0.0],
      hi: [0.2, 70000, 1.5, 1.5],
      fn: function (p, c, y) {
        c = cond(c);
        const Tk = c.restTemp + 273.15;
        const arrh = Math.exp(-p[1] / (8.314 * Tk)) / Math.exp(-p[1] / (8.314 * 298.15));
        return Math.min(0.95, Math.max(0, p[0] * arrh * Math.pow(y, p[2]) * Math.pow(c.cyclesPerDay * c.dod, p[3])));
      },
    },
    // M5 经验多项式(逐曲线)：数据驱动，不靠全局参数回归。
    // 实际衰减取"最临近实测曲线"，用其三次多项式系数(来自 fitted.js 的 M.m5)；
    // sim.js 在 computeSeries 中对 modelKey==='M5' 单独分支处理，此处仅作完整注册，使 MODELS 与 UI/文档(M1–M5)一致。
    M5: {
      key: "M5",
      name: "经验多项式(逐曲线)",
      desc: "数据驱动: 取最临近实测曲线，对其 SOH 衰减做三次拟合 loss = a0 + a1·y + a2·y² + a3·y³；系数来自 fitted.js 的 M.m5，不依赖全局回归。",
      params: ["a0", "a1", "a2", "a3"],
      init: [0, 0.01, 0, 0], lo: [0, 0, 0, 0], hi: [0.5, 0.5, 0.5, 0.5],
      fn: function (p, c, y) {
        return Math.min(0.95, Math.max(0, p[0] + p[1] * y + p[2] * y * y + p[3] * y * y * y));
      },
    },
  };

  // ---------------- 优化: Nelder-Mead (带边界惩罚 + 随机重启) ----------------
  function nelderMead(f, x0, lo, hi, iters, seed) {
    const n = x0.length;
    let rng = seed || 12345;
    function rnd() { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; }
    function penalize(x) {
      let s = f(x);
      for (let i = 0; i < n; i++) {
        if (x[i] < lo[i]) s += 1e6 * (lo[i] - x[i]);
        if (x[i] > hi[i]) s += 1e6 * (x[i] - hi[i]);
      }
      if (!isFinite(s)) s = 1e12;
      return s;
    }
    const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
    let sim = [x0.slice()];
    for (let i = 0; i < n; i++) {
      const x = x0.slice();
      const step = (hi[i] - lo[i]) * 0.1 || 0.05;
      x[i] = Math.min(hi[i], Math.max(lo[i], x[i] + step * (1 + rnd())));
      sim.push(x);
    }
    let fvals = sim.map(penalize);
    for (let it = 0; it < iters; it++) {
      let o = fvals.map((v, i) => i).sort((a, b) => fvals[a] - fvals[b]);
      const best = o[0], worst = o[n];
      const m = [];
      for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n + 1; i++) if (i !== worst) s += sim[i][j]; m.push(s / n); }
      const rc = []; for (let j = 0; j < n; j++) rc.push(m[j] + alpha * (m[j] - sim[worst][j]));
      const fc = penalize(rc);
      let nw;
      if (fc < fvals[best]) {
        const re = []; for (let j = 0; j < n; j++) re.push(m[j] + gamma * (rc[j] - m[j]));
        const fe = penalize(re);
        nw = fe < fc ? re : rc;
      } else if (fc < fvals[o[n - 1]]) {
        nw = rc;
      } else {
        const ri = []; for (let j = 0; j < n; j++) ri.push(sim[worst][j] + rho * (m[j] - sim[worst][j]));
        const fi = penalize(ri);
        if (fi < fvals[worst]) { nw = ri; } else {
          for (let i = 0; i < n + 1; i++) if (i !== best) { for (let j = 0; j < n; j++) sim[i][j] = sim[best][j] + sigma * (sim[i][j] - sim[best][j]); fvals[i] = penalize(sim[i]); }
          continue;
        }
      }
      sim[worst] = nw; fvals[worst] = penalize(nw);
    }
    let bi = 0; for (let i = 1; i < n + 1; i++) if (fvals[i] < fvals[bi]) bi = i;
    return { x: sim[bi], f: fvals[bi] };
  }

  // 对一组曲线拟合某模型 (多起点重启取最优)
  function fitModel(modelDef, curves, opts) {
    opts = opts || {};
    function loss(p) {
      let s = 0;
      for (const cv of curves) {
        const base = cv.points[0].soh != null ? cv.points[0].soh : 1.0;
        const c = cv.cond;
        for (const pt of cv.points) {
          if (pt.soh == null) continue;
          const target = base - pt.soh;
          const pred = modelDef.fn(p, c, pt.y);
          const d = pred - target;
          s += d * d;
        }
      }
      return s;
    }
    let best = null;
    const restarts = opts.restarts || 6;
    for (let r = 0; r < restarts; r++) {
      const x0 = modelDef.init.slice();
      // 扰动
      for (let i = 0; i < x0.length; i++) {
        const span = modelDef.hi[i] - modelDef.lo[i];
        x0[i] = modelDef.lo[i] + span * (0.2 + 0.6 * Math.random());
      }
      const res = nelderMead(loss, x0, modelDef.lo, modelDef.hi, opts.iters || 4000, 1000 + r * 7);
      if (!best || res.f < best.f) best = res;
    }
    return best.x;
  }

  // RTE 线性拟合: rte = RTE0 - kRTE * loss  (loss = base - soh)
  function fitRTE(allPoints) {
    // allPoints: [{loss, rte}]  ; 模型: rte = RTE0 - kRTE*loss  (loss越大 RTE越小 => kRTE>0)
    let n = allPoints.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of allPoints) { const x = p.loss, y = p.rte; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const den = n * sxx - sx * sx;
    const slope = den !== 0 ? (n * sxy - sx * sy) / den : 0; // 斜率(rte vs loss, 通常为负)
    let kRTE = -slope;                                        // 模型系数需为正
    let RTE0 = (sy - slope * sx) / n;                         // loss=0 时的 RTE
    // 约束合理范围（放宽: 原 [0.85,0.99]/[0,0.5] 会把真实值裁成 artifact，如 S4-0.5P）
    if (RTE0 > 1.00) RTE0 = 1.00;
    if (RTE0 < 0.80) RTE0 = 0.80;
    if (kRTE < 0) kRTE = 0;
    if (kRTE > 1.0) kRTE = 1.0;
    return { RTE0: RTE0, kRTE: kRTE };
  }

  // M5 经验多项式(逐曲线三次): loss = a*y + b*y^2 + c*y^3
  function fitM5(curve) {
    const pts = curve.points.filter(p => p.soh != null);
    const base = pts.length ? (pts[0].soh != null ? pts[0].soh : 1.0) : 1.0;
    const xs = [], ys = [];
    for (const p of pts) { xs.push(p.y); ys.push(base - p.soh); }
    // 最小二乘三次 (正规方程 4x4)
    const A = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]; const B=[0,0,0,0];
    for (let i=0;i<xs.length;i++){ const x=xs[i],y=ys[i]; for(let a=0;a<4;a++){ for(let b=0;b<4;b++){ A[a][b]+=Math.pow(x,a+b);} B[a]+=y*Math.pow(x,a);} }
    // 高斯消元
    for(let i=0;i<4;i++){ let piv=A[i][i]; if(Math.abs(piv)<1e-12){ // 退化用二次
        return fitM5quad(xs,ys,base);} for(let j=i;j<4;j++) A[i][j]/=piv; B[i]/=piv; for(let k=0;k<4;k++){ if(k!==i){ const f=A[k][i]; for(let j=i;j<4;j++) A[k][j]-=f*A[i][j]; B[k]-=f*B[i]; } } }
    const coeffs=[B[0],B[1],B[2],B[3]]; // [a0,a1,a2,a3]; a0应≈0
    return { coeffs: coeffs, base: base };
  }
  function fitM5quad(xs, ys, base){
    // 二次: y = b1*x + b2*x^2
    let s1=0,s2=0,s3=0,s4=0,t1=0,t2=0; const n=xs.length;
    for(let i=0;i<n;i++){ const x=xs[i],y=ys[i]; s1+=x; s2+=x*x; s3+=x*x*x; s4+=x*x*x*x; t1+=y*x; t2+=y*x*x; }
    const den=s2*s4-s3*s3; let b2=den!==0?(t1*s4-t2*s3)/den:0; let b1=den!==0?(s2*t2-s3*t1)/den:0;
    return { coeffs:[0,b1,b2,0], base:base };
  }
  function m5loss(coeffs, y){ return coeffs[0]+coeffs[1]*y+coeffs[2]*y*y+coeffs[3]*y*y*y; }

  const API = { MODELS, cond, Ne, nelderMead, fitModel, fitRTE, fitM5, m5loss };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.MODELS = MODELS; root.BMODEL = API;
})(typeof window !== "undefined" ? window : globalThis);
