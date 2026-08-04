/* =========================================================================
 * 衰减仿真器 (挂载版) — 嵌入 V13 衰减曲线页
 * 基于 battery_degradation_web 引擎 (models.js/data_battery.js/fitted.js)
 * 适配: 控件在 #sim-panel 内, 计算后写 window.__SIMOUT, 提供"捕获到原始数据"
 * 优化(M2→M3): EXACT→M5→M1 回退改为 EXACT→M5→M3, 并加拟合发散守卫
 * ========================================================================= */
(function () {
  "use strict";
  var API = window.BMODEL, MODELS = window.MODELS, BD = window.BDATA, FIT = window.FITTED;

  // ---------- 工具 ----------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isFin(x) { return typeof x === "number" && isFinite(x); }

  // 净化: 滤掉 rte/soh 越界值(原始 xlsx 有把"年号"误读到 RTE 列的脏数据,
  //         或多个子表被合并到同一 points[] 数组里, RTE 落到 1.0+ 或 21 等垃圾),
  //         并按 y 升序排序, 以便 interpPts 用真正的 max(y) 短路.
  function cleanPts(raw, key) {
    if (!raw) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (!p) continue;
      var y = p.y;
      if (!isFin(y)) continue;
      var v = p[key];
      if (v == null || !isFin(v)) continue;
      // 占位脏数据: y=0 时 rte===1.0 是"空点"占位(真实 RTE 必 < 1.0), 丢弃
      if (key === "rte" && y === 0 && v === 1.0) continue;
      // 物理约束: SOH 50%-110%, RTE 50%-100%
      var lo = key === "soh" ? 0.5 : 0.5, hi = key === "soh" ? 1.05 : 1.0;
      if (v < lo || v > hi) continue;
      if (seen[y] !== undefined) continue; // 重复 y 保留先到的
      seen[y] = out.length;
      out.push({ y: y, v: v });
    }
    out.sort(function (a, b) { return a.y - b.y; });
    return out;
  }
  function interpPts(pts, y) {
    // pts 来自 cleanPts(...) : 已排序、单调 y、值合法 → 线性插值, 末端点 clamp
    if (!pts.length) return null;
    if (y <= pts[0].y) return pts[0].v;
    var last = pts[pts.length - 1];
    if (y >= last.y) return last.v;
    for (var i = 0; i < pts.length - 1; i++) {
      if (y >= pts[i].y && y <= pts[i + 1].y) {
        var t = (y - pts[i].y) / (pts[i + 1].y - pts[i].y);
        return pts[i].v + t * (pts[i + 1].v - pts[i].v);
      }
    }
    return last.v;
  }
  function condDist(c, q) {
    var cr = c.rate != null ? c.rate : 0.5, cd = c.dod != null ? c.dod : 1,
        cc = c.cyclesPerDay != null ? c.cyclesPerDay : 1,
        crt = c.restTemp != null ? c.restTemp : 25, cct = c.cycleTemp != null ? c.cycleTemp : crt;
    var qr = q.rate, qd = q.dod, qc = q.cyclesPerDay, qrt = q.restTemp, qct = q.cycleTemp;
    return 2 * Math.abs(cr - qr) + 5 * Math.abs(cd - qd) + 1 * Math.abs(cc - qc)
      + 0.2 * (Math.abs(crt - qrt) + Math.abs(cct - qct));
  }
  function sameCond(c, q) {
    return Math.abs((c.rate != null ? c.rate : 0.5) - q.rate) < 1e-6
      && Math.abs((c.dod != null ? c.dod : 1) - q.dod) < 1e-3
      && Math.abs((c.cyclesPerDay != null ? c.cyclesPerDay : 1) - q.cyclesPerDay) < 1e-3;
  }
  function isSaneM5(c) {
    if (!c || !c.coeffs || c.coeffs.length < 4) return false;
    if (!(c.base > 0.5 && c.base < 1.05)) return false;
    for (var i = 0; i < 4; i++) if (!isFin(c.coeffs[i])) return false;
    if (c.coeffs[0] === 0 && c.coeffs[1] === -1) return false; // 退化哨兵
    return true;
  }
  var DEFAULT_PARAMS = {
    M1: [0.05, 1.2e-5, 0.5, 0.005, 15, 1.0],
    M2: [0.05, 500, 0.5, 60000, 0.2, 12],
    M3: [0.003, 0.2, 0.01, 5000, 1.0],
    M4: [0.03, 45000, 0.6, 0.5]
  };

  // ---------- 型号聚合 (清洁名称 → 可能的多个原始 key) ----------
  function cleanModelName(key) {
    return String(key).replace(/-(\d+(\.\d+)?)P$/i, "");
  }
  function resolveName(type, name) {
    var rawArr = type === "cell" ? BD.cells : BD.systems;
    if (rawArr[name]) {
      var m5s = (FIT.m5 && FIT.m5[name]) || [];
      return {
        single: true, keys: [name], curves: rawArr[name], m5: m5s,
        cellFit: type === "cell" ? (FIT.cell && FIT.cell[name]) : null,
        sysFit: type === "system" ? (FIT.system && FIT.system[name]) : null
      };
    }
    var clean = cleanModelName(name), keys = [];
    Object.keys(rawArr).forEach(function (k) { if (cleanModelName(k) === clean) keys.push(k); });
    if (!keys.length) return { single: false, keys: [name], curves: [], m5: [], cellFit: null, sysFit: null };
    var curves = [], m5 = [], sysFit = [];
    keys.forEach(function (k) {
      var arr = rawArr[k] || [], mm = (FIT.m5 && FIT.m5[k]) || [], sf = (FIT.system && FIT.system[k]) || null;
      arr.forEach(function (cv, i) { curves.push(cv); m5.push(mm[i]); sysFit.push(sf ? sf[i] : null); });
    });
    return { single: false, keys: keys, curves: curves, m5: m5, cellFit: null, sysFit: sysFit };
  }

  // ---------- 全局电芯 RTE (兜底) ----------
  var CELL_RTE = null;
  (function () {
    var pts = [];
    Object.keys(BD.cells).forEach(function (nm) {
      (BD.cells[nm] || []).forEach(function (cv) {
        if (!cv || !cv.points) return;
        var base = cv.points[0].soh != null ? cv.points[0].soh : 1;
        cv.points.forEach(function (p) { if (p.soh != null && p.rte != null) pts.push({ loss: base - p.soh, rte: p.rte }); });
      });
    });
    if (pts.length >= 4) CELL_RTE = API.fitRTE(pts);
  })();

  // ---------- 曲线查找 ----------
  function findExact(arr, q) {
    var TOL = 4;
    var withCt = null, wbd = 1e9;
    var noCt = null, nbd = 1e9;
    (arr || []).forEach(function (cv) {
      if (!cv || !cv.cond) return;
      if (!sameCond(cv.cond, q)) return;
      var cr = cv.cond.restTemp != null ? cv.cond.restTemp : 25;
      if (cv.cond.cycleTemp != null) {
        var dt = Math.abs(cr - q.restTemp) + Math.abs(cv.cond.cycleTemp - q.cycleTemp);
        if (dt < wbd) { wbd = dt; withCt = cv; }
      } else {
        var closerT = Math.abs(q.cycleTemp - cr) <= Math.abs(q.restTemp - cr) ? q.cycleTemp : q.restTemp;
        var dt2 = Math.abs(cr - q.restTemp) + Math.abs(cr - closerT);
        if (dt2 < nbd) { nbd = dt2; noCt = cv; }
      }
    });
    if (withCt && wbd <= TOL) return withCt;
    if (noCt && nbd <= TOL) return noCt;
    return null;
  }
  function nearestFit(arr, fitArr, q) {
    var best = null, bd = 1e9;
    (arr || []).forEach(function (cv, i) {
      if (!cv || !cv.cond) return;
      var fit = fitArr ? fitArr[i] : null;
      if (fit == null) return;
      var d = condDist(cv.cond, q);
      if (d < bd) { bd = d; best = { cv: cv, fit: fit }; }
    });
    return best;
  }
  function nearestM5(curves, m5Arr, q) {
    var best = null, bd = 1e9;
    (curves || []).forEach(function (cv, i) {
      if (!cv || !cv.cond) return;
      var c = m5Arr[i];
      if (!isSaneM5(c)) return;
      var d = condDist(cv.cond, q);
      if (d < bd) { bd = d; best = { coeffs: c.coeffs, cv: cv }; }
    });
    return best;
  }

  // M5 外推守卫: 三次多项式超出实测区间可能翘曲 (SOH 回升 / 末段斜率发散), 判断是否可信
  // 规则: ① 全区间衰减量单调不减(SOH 不回升); ② 实测段之后年均损失率不超过
  //      "实测段末斜率×3 或 绝对 6%/年" 中的较大者 (发散 → 判定不可信, 回退 M3)
  function isSaneM5Extrapolate(coeffs, cv, maxYear) {
    var maxYData = 0;
    (cv.points || []).forEach(function (p) { if (p.soh != null && isFin(p.y) && p.y > maxYData) maxYData = p.y; });
    var yEnd = Math.max(maxYear, maxYData);
    var d0 = coeffs[1] + 2 * coeffs[2] * maxYData + 3 * coeffs[3] * maxYData * maxYData;
    var cap = Math.max(0.06, 3 * Math.max(0, d0));
    var prevLoss = null;
    for (var yy = 0; yy <= yEnd; yy++) {
      var loss = API.m5loss(coeffs, yy);
      if (!isFin(loss)) return false;
      if (prevLoss != null && loss < prevLoss - 1e-9) return false;
      if (yy > maxYData && yy > 0) {
        var dL = coeffs[1] + 2 * coeffs[2] * yy + 3 * coeffs[3] * yy * yy;
        if (dL < -1e-9) return false;
        if (dL > cap) return false;
      }
      prevLoss = loss;
    }
    return true;
  }

  // ---------- 核心计算 ----------
  function computeSeries(modelKey, name, type, q, SOH0, RTE0, maxYear, conv) {
    var M = resolveName(type, name);
    var years = []; for (var y = 0; y <= maxYear; y++) years.push(y);
    var soh = [], rte = [], source = "", exactRef = null, usedConv = false;

    if (modelKey === "EXACT") {
      var cv = findExact(M.curves, q);
      if (cv) {
        var ptsS = cleanPts(cv.points, "soh");
        var ptsR = cleanPts(cv.points, "rte");
        soh = years.map(function (yy) { return interpPts(ptsS, yy); });
        rte = ptsR.length ? years.map(function (yy) { return interpPts(ptsR, yy); }) : null;
        source = "精确表内(原始曲线插值)"; exactRef = cv;
        return { years: years, soh: soh, rte: rte, source: source, exactRef: exactRef };
      }
      modelKey = "M5"; // 回退
    }

    if (modelKey === "M5") {
      var m = nearestM5(M.curves, M.m5, q);
      if (m) {
        if (isSaneM5Extrapolate(m.coeffs, m.cv, maxYear)) {
          soh = years.map(function (yy) { return clamp(SOH0 - API.m5loss(m.coeffs, yy), 0, 1); });
          var rcv = m.cv, ptsR2 = cleanPts(rcv.points, "rte");
          if (ptsR2.length) {
            rte = years.map(function (yy) { return interpPts(ptsR2, yy); });
          } else {
            rte = modelRTE(type, name, q, null, soh, SOH0, RTE0);
          }
          source = "M5 经验多项式(最近曲线)";
          return { years: years, soh: soh, rte: rte, source: source, exactRef: null };
        }
      }
      modelKey = "M3"; // 守卫回退 / 优化(M2→M3): 原 M1 改为 M3 — M3(√) 在实测曲线上聚合 RMSE 显著更低
    }

    // ---- M1–M4 ----
    var md = MODELS[modelKey], params = null, rteFit = null;
    if (type === "cell") {
      var cf = M.cellFit;
      params = cf && cf[modelKey] ? cf[modelKey].params : DEFAULT_PARAMS[modelKey];
      rteFit = CELL_RTE;
      source = "M" + modelKey.slice(1) + " 电芯全局模型";
    } else {
      var e = nearestFit(M.curves, M.sysFit, q);
      if (e && e.fit[modelKey]) {
        params = e.fit[modelKey].params; rteFit = e.fit.rte;
        source = "M" + modelKey.slice(1) + " 系统直拟(最近曲线)";
      } else {
        params = DEFAULT_PARAMS[modelKey]; rteFit = null;
        source = "M" + modelKey.slice(1) + " 默认参数×系统转化系数(无直拟)";
        usedConv = true;
      }
    }
    // 防御: 拟合发散/NaN → 回退 M3 默认参数(诊断建议), 避免整条曲线 NaN
    if (!params || params.some(function (v) { return !isFin(v); })) {
      params = DEFAULT_PARAMS[modelKey];
      usedConv = true;
      source = "M" + modelKey.slice(1) + " 默认参数×系统转化系数(拟合发散回退)";
    }
    // M1 发散守卫: 若 Ac·Ne(1)(首年纯循环损失)过大，该直拟参数在此工况会触顶 0.95 钳位使曲线"假死"，回退 M1 默认参数
    if (modelKey === "M1" && params) {
      var _qc = API.cond(q), _ne1 = API.Ne(_qc, 1);
      var _cyc1 = params[1] * _ne1 * Math.pow(_qc.rate / 0.5, params[2]);
      if (isFin(_cyc1) && _cyc1 > 0.5) {
        params = DEFAULT_PARAMS.M1;
        usedConv = true;
        source = "M1 默认参数×系统转化系数(发散守卫: Ac·Ne(1)=" + _cyc1.toFixed(3) + ")";
      }
    }
    soh = years.map(function (yy) {
      var s = SOH0 - md.fn(params, q, yy);
      if (usedConv) s = s * conv;
      return clamp(s, 0, 1);
    });
    rte = modelRTE(type, name, q, rteFit, soh, SOH0, RTE0);
    return { years: years, soh: soh, rte: rte, source: source, exactRef: null };
  }

  function modelRTE(type, name, q, rteFit, soh, SOH0, RTE0) {
    // kRTE 优先取曲线自带拟合; 缺失时取全库拟合(FIT.rte.kRTE), 仅当两者皆无才回退硬编码
    var k = rteFit ? rteFit.kRTE
      : (FIT.rte && isFin(FIT.rte.kRTE)) ? FIT.rte.kRTE
      : (type === "cell" ? 0.03 : 0.06);
    var r0 = rteFit ? rteFit.RTE0 : RTE0;
    if (!(r0 > 0)) r0 = RTE0;
    return soh.map(function (s) { return clamp(r0 - k * (SOH0 - s), 0, 1); });
  }

  // 把当前仿真结果暴露给 V12 计算表 (year 索引 0..maxYear)
  function storeSimOut(ser, inp) {
    window.__SIMOUT = {
      years: ser.years.slice(),
      soh: ser.soh.slice(),
      rte: ser.rte ? ser.rte.slice() : null,
      source: ser.source,
      type: inp.type, name: inp.name,
      q: { rate: inp.rate, dod: inp.dod, cpd: inp.cpd, ctemp: inp.ctemp, rtemp: inp.rtemp, soc: inp.soc }
    };
  }

  // 参考曲线(用于 RMSE) = 最近的、含 soh 点的原始曲线
  function refCurve(type, name, q) {
    var M = resolveName(type, name);
    var best = null, bd = 1e9;
    (M.curves || []).forEach(function (cv) {
      if (!cv || !cv.cond) return;
      if (!cv.points || !cv.points.some(function (p) { return p.soh != null; })) return;
      var d = condDist(cv.cond, q);
      if (d < bd) { bd = d; best = cv; }
    });
    return best;
  }
  function modelRMSE(modelKey, name, type, q, SOH0, RTE0, conv) {
    var rc = refCurve(type, name, q);
    if (!rc) return null;
    var maxY = rc.points[rc.points.length - 1].y;
    var ser = computeSeries(modelKey, name, type, q, SOH0, RTE0, maxY, conv);
    var ps = rc.points.filter(function (p) { return p.soh != null; });
    var s = 0;
    ps.forEach(function (p) { var pred = interpYear(ser, p.y); var d = pred - p.soh; s += d * d; });
    return Math.sqrt(s / ps.length);
  }
  function interpYear(ser, y) {
    if (y <= ser.years[0]) return ser.soh[0];
    if (y >= ser.years[ser.years.length - 1]) return ser.soh[ser.soh.length - 1];
    for (var i = 0; i < ser.years.length - 1; i++) {
      if (y >= ser.years[i] && y <= ser.years[i + 1]) {
        var t = (y - ser.years[i]) / (ser.years[i + 1] - ser.years[i]);
        return ser.soh[i] + t * (ser.soh[i + 1] - ser.soh[i]);
      }
    }
    return ser.soh[ser.soh.length - 1];
  }

  // ---------- Chart.js 双轴图 (自带图例 + 悬浮显示曲线名) ----------
  var COL = { soh: "#2f6df6", rte: "#e0922f", c1: "#2f6df6", c2: "#0fae9e", c3: "#e2553f", c4: "#9b59d0", c5: "#2faa5b", exact: "#16202f" };
  var chartInst = null;
  function renderChart(sohSeries, rteSeries) {
    var canvas = document.getElementById("chart");
    if (!canvas) return;
    if (typeof Chart === "undefined") {
      canvas.parentNode.innerHTML = '<div style="padding:24px;color:#8a97ad;text-align:center">图表库 Chart.js 未加载，请确认 vendor/chart.umd.min.js 存在。</div>';
      return;
    }
    var datasets = [];
    sohSeries.concat(rteSeries).forEach(function (s) {
      datasets.push({
        label: s.label,
        data: s.data.map(function (d) { return { x: d.x, y: d.y }; }),
        yAxisID: s.axis === "rte" ? "yRTE" : "ySOH",
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.w || 2.2,
        borderDash: s.dashed ? [7, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25
      });
    });
    if (chartInst) { try { chartInst.destroy(); } catch (e) {} chartInst = null; }
    chartInst = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: { usePointStyle: true, boxWidth: 8, padding: 14, font: { size: 12 }, color: "#33415c" }
          },
          tooltip: {
            callbacks: {
              title: function (items) { return "第 " + items[0].parsed.x + " 年"; },
              label: function (ctx) { return ctx.dataset.label + "：" + (ctx.parsed.y * 100).toFixed(2) + "%"; }
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "年限 Year", color: "#51607a", font: { size: 12 } },
            ticks: { color: "#8a97ad" }
          },
          ySOH: {
            position: "left",
            title: { display: true, text: "SOH (%)", color: "#3a5fa0", font: { size: 12 } },
            ticks: { color: "#8a97ad", callback: function (v) { return (v * 100).toFixed(0) + "%"; } },
            grid: { color: "#eef1f6" }
          },
          yRTE: {
            position: "right",
            // 专用聚焦区间: 不与 SOH 共用 0~100% 视觉尺度, 避免 RTE 曲线被压扁
            // 正常 RTE 落在 [0.85,1.0]; 若实测更低(极端衰减)则自适应下探, 防止裁剪
            min: (function () {
              var lo = 0.85;
              rteSeries.forEach(function (s) { s.data.forEach(function (d) { if (isFin(d.y) && d.y - 0.01 < lo) lo = d.y - 0.01; }); });
              return lo;
            })(),
            max: 1.0,
            title: { display: true, text: "RTE (%)", color: "#b9711a", font: { size: 12 } },
            ticks: { color: "#c79a5e", callback: function (v) { return (v * 100).toFixed(1) + "%"; } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  // ---------- UI ----------
  var $ = function (id) { return (typeof document !== "undefined") ? document.getElementById(id) : null; };
  var modelSel = $("model"), presetSel = $("preset");

  function condText(c) {
    var r = c.rate != null ? c.rate : 0.5;
    var d = (c.dod != null ? c.dod : 1) * 100;
    var cpd = c.cyclesPerDay != null ? c.cyclesPerDay : 1;
    var ct = c.cycleTemp != null ? c.cycleTemp : (c.restTemp != null ? c.restTemp : 25);
    var rt = c.restTemp != null ? c.restTemp : 25;
    return fmtR(r) + "P / " + fmtD(d) + "%DOD / " + fmtC(cpd) + "次天 / " + fmtT(ct) + "℃·" + fmtT(rt) + "℃";
  }
  // 显示精度收敛: 倍率 3 位去尾零, DOD% 整数, 每天循环数 2 位去尾零, 温度 1 位去尾零
  // 仅影响 condText 显示, 原始 c.* 数值原样保留供 applyPreset / computeSeries 使用
  function fmtR(v) { return parseFloat(v.toFixed(3)).toString(); }
  function fmtD(v) { return Math.round(v).toString(); }
  function fmtC(v) { return parseFloat(v.toFixed(2)).toString(); }
  function fmtT(v) { return parseFloat(v.toFixed(1)).toString(); }

  function fillModels() {
    var type = $("type").value;
    var rawArr = type === "cell" ? BD.cells : BD.systems;
    var seen = {}, cleanNames = [];
    Object.keys(rawArr).forEach(function (k) {
      var cn = cleanModelName(k);
      if (!seen[cn]) { seen[cn] = 1; cleanNames.push(cn); }
    });
    cleanNames.sort();
    modelSel.innerHTML = "";
    cleanNames.forEach(function (cn) {
      var o = document.createElement("option");
      o.value = cn; o.textContent = cn;
      modelSel.appendChild(o);
    });
  }
  function fillPresets() {
    var type = $("type").value, cn = $("model").value;
    var M = resolveName(type, cn);
    presetSel.innerHTML = '<option value="">— 自定义 —</option>';
    var seen = {};
    (M.curves || []).forEach(function (cv, i) {
      if (!cv || !cv.cond) return;
      var t = condText(cv.cond);
      if (seen[t]) return;
      seen[t] = 1;
      var o = document.createElement("option"); o.value = i; o.textContent = t;
      presetSel.appendChild(o);
    });
  }
  function readInputs() {
    return {
      type: $("type").value, name: $("model").value,
      rate: parseFloat($("rate").value) || 0.5,
      dod: (parseFloat($("dod").value) || 100) / 100,
      cpd: parseFloat($("cpd").value) || 1,
      ctemp: parseFloat($("ctemp").value) || 25,
      rtemp: parseFloat($("rtemp").value) || 25,
      soc: (parseFloat($("soc").value) || 50) / 100,
      soh0: parseFloat($("soh0").value) || 1.0,
      rte0: parseFloat($("rte0").value) || 0.93,
      years: Math.max(1, parseInt($("years").value) || 25),
      conv: parseFloat($("conv").value) || 0.968911
    };
  }
  function applyPreset(idx) {
    var type = $("type").value, cn = $("model").value;
    var M = resolveName(type, cn);
    var cv = M.curves[idx]; if (!cv || !cv.cond) return;
    var c = cv.cond;
    $("rate").value = (c.rate != null ? c.rate : 0.5);
    $("dod").value = ((c.dod != null ? c.dod : 1) * 100);
    $("cpd").value = (c.cyclesPerDay != null ? c.cyclesPerDay : 1);
    $("ctemp").value = (c.cycleTemp != null ? c.cycleTemp : (c.restTemp != null ? c.restTemp : 25));
    $("rtemp").value = (c.restTemp != null ? c.restTemp : 25);
    $("soc").value = ((c.restSOC != null ? c.restSOC : 0.5) * 100);
    syncAuxT();
  }

  // 温度单向联动: 衰减仿真"运行温度 ctemp" → 辅耗模型环境温度 aux.T
  // (衰减页在辅耗页之前, 用户在衰减页定工况温度后, 辅耗自动跟随, 避免两处不一致)
  function syncAuxT() {
    var V12 = window.__V12;
    if (!V12) return;
    var t = parseFloat($("ctemp").value);
    if (!isFinite(t)) return;
    V12.state.aux.T = t;
    V12.recalc();
  }

  function buildSeries(ser, color, label, axis, dashed, w) {
    var data = ser.years.map(function (y, i) {
      var v = axis === "rte" ? ser.rte[i] : ser.soh[i];
      return { x: y, y: v };
    });
    return { label: label, color: color, data: data, axis: axis || "soh", dashed: dashed, w: w };
  }

  function renderKPIs(ser) {
    function pick(yr) {
      var i = ser.years.indexOf(yr); if (i < 0) return null;
      return { soh: ser.soh[i], rte: ser.rte[i] };
    }
    var maxY = ser.years[ser.years.length - 1];
    var k = [1, 5, 10, 20].filter(function (y) { return y <= maxY; });
    if (k[k.length - 1] !== maxY) k.push(maxY);
    var html = "";
    var cls = ["blue", "teal", "amber", "green", "blue", "teal"];
    k.forEach(function (yr, i) {
      var v = pick(yr); if (!v) return;
      html += '<div class="kpi ' + (cls[i] || "blue") + '"><div class="k-label">Y' + yr + ' SOH</div><div class="k-val">' + (v.soh * 100).toFixed(1) + '%</div></div>';
    });
    var end = pick(maxY);
    html += '<div class="kpi amber"><div class="k-label">Y' + maxY + ' RTE</div><div class="k-val">' + (end && end.rte != null ? (end.rte * 100).toFixed(1) + '%' : '—') + '</div></div>';
    html += '<div class="kpi green"><div class="k-label">Y' + maxY + ' 衰减</div><div class="k-val">' + ((1 - (end ? end.soh : 1)) * 100).toFixed(1) + '%</div></div>';
    $("kpis").innerHTML = html;
  }
  function renderTable(ser) {
    var h = '<thead><tr><th class="yearcol">年限<br>Year</th><th>SOH<span class="th-en">衰减率</span></th><th>衰减<span class="th-en">Delta</span></th><th>RTE<span class="th-en">往返效率</span></th></tr></thead><tbody>';
    ser.years.forEach(function (y, i) {
      var rte = ser.rte[i] != null ? (ser.rte[i] * 100).toFixed(2) + "%" : "—";
      h += '<tr><td class="yearcol">Y' + y + '</td><td class="num">' + (ser.soh[i] * 100).toFixed(2) + '%</td><td class="num">' + ((1 - ser.soh[i]) * 100).toFixed(2) + '%</td><td class="num">' + rte + '</td></tr>';
    });
    h += "</tbody>";
    $("tbl").innerHTML = h;
  }
  function badge(src) {
    var b = $("srcBadge");
    b.textContent = src;
    b.className = "badge" + (src.indexOf("精确") >= 0 ? " ok" : src.indexOf("默认") >= 0 ? " warn" : "");
    $("algoNote").textContent = src.indexOf("默认") >= 0
      ? "注: 该型号无对应直拟曲线, 已用默认参数并以系统转化系数折算 (仅供外推参考)。" : "";
  }

  function doCalc() {
    $("cmpCard").style.display = "none";
    $("degGrid").classList.remove("show-cmp");
    var inp = readInputs();
    syncAuxT();
    var q = { rate: inp.rate, dod: inp.dod, cyclesPerDay: inp.cpd, cycleTemp: inp.ctemp, restTemp: inp.rtemp, restSOC: inp.soc };
    var ser = computeSeries($("algo").value, inp.name, inp.type, q, inp.soh0, inp.rte0, inp.years, inp.conv);
    storeSimOut(ser, inp);
    renderKPIs(ser);
    badge(ser.source);
    var sohS = [buildSeries(ser, COL.soh, "SOH (" + $("algo").value + ")", "soh", false, 2.6)];
    var rteArr = ser.rte || [];
    var rteS = rteArr.some(function (v) { return v != null; }) ? [buildSeries(ser, COL.rte, "RTE", "rte", false, 2.2)] : [];
    renderChart(sohS, rteS);
    renderTable(ser);
  }

  function doCompare() {
    var inp = readInputs();
    var q = { rate: inp.rate, dod: inp.dod, cyclesPerDay: inp.cpd, cycleTemp: inp.ctemp, restTemp: inp.rtemp, restSOC: inp.soc };
    var keys = ["EXACT", "M1", "M2", "M3", "M4", "M5"];
    var colors = { EXACT: COL.exact, M1: COL.c1, M2: COL.c2, M3: COL.c3, M4: COL.c4, M5: COL.c5 };
    var labels = { EXACT: "表内精确", M1: "M1 线性", M2: "M2 双指数", M3: "M3 平方根", M4: "M4 Arrhenius", M5: "M5 经验" };
    var sohS = [], exactSer = null, primSer = null;
    var rows = '<thead><tr><th class="yearcol">算法</th><th>来源</th><th>Y5<span class="th-en">5年</span></th><th>Y10<span class="th-en">10年</span></th><th>Y20<span class="th-en">20年</span></th><th>RMSE<span class="th-en">拟合误差</span></th></tr></thead><tbody>';
    keys.forEach(function (k) {
      var ser = computeSeries(k, inp.name, inp.type, q, inp.soh0, inp.rte0, inp.years, inp.conv);
      if (k === "EXACT") exactSer = ser;
      if (k === $("algo").value) primSer = ser;
      sohS.push(buildSeries(ser, colors[k], labels[k], "soh", k === "EXACT", 2.0));
      function at(yr) { var i = ser.years.indexOf(yr); return i >= 0 ? (ser.soh[i] * 100).toFixed(1) + "%" : "—"; }
      var rmse = modelRMSE(k, inp.name, inp.type, q, inp.soh0, inp.rte0, inp.conv);
      rows += "<tr><td>" + labels[k] + "</td><td style='text-align:left;color:#8a97ad;font-size:11px'>" + ser.source + "</td><td>" + at(5) + "</td><td>" + at(10) + "</td><td>" + at(20) + "</td><td>" + (rmse != null ? (rmse * 100).toFixed(2) + "%" : "—") + "</td></tr>";
    });
    rows += "</tbody>";
    $("cmpTbl").innerHTML = rows;
    $("cmpCard").style.display = "";
    $("degGrid").classList.add("show-cmp");
    var rteArr = exactSer && exactSer.rte || [];
    var rteS = rteArr.some(function (v) { return v != null; }) ? [buildSeries(exactSer, COL.rte, "RTE(精确)", "rte", false, 2.2)] : [];
    renderChart(sohS, rteS);
    renderKPIs(exactSer || (sohS[0] && primSer));
    badge("算法对比: " + keys.length + " 个模型叠加 (见下表)");
    renderTable(exactSer || primSer);
    if (primSer) storeSimOut(primSer, inp);
  }

  function doMatch() {
    var inp = readInputs();
    var q = { rate: inp.rate, dod: inp.dod, cyclesPerDay: inp.cpd, cycleTemp: inp.ctemp, restTemp: inp.rtemp, restSOC: inp.soc };
    var M = resolveName(inp.type, inp.name);
    var cv = findExact(M.curves, q) || refCurve(inp.type, inp.name, q);
    if (cv && cv.points && cv.points.length) {
      var base = cv.points[0].soh != null ? cv.points[0].soh : 1;
      $("soh0").value = base.toFixed(4);
      var r0pt = cv.points.find(function (p) { return p.rte != null; });
      if (r0pt) $("rte0").value = r0pt.rte.toFixed(4);
      $("algoNote").textContent = "已填入匹配曲线初值: SOH0=" + base.toFixed(4) + (r0pt ? ", RTE0=" + r0pt.rte.toFixed(4) : "");
    } else {
      $("algoNote").textContent = "未找到匹配曲线, 保留当前初值。";
    }
  }

  // 一键捕获: 把当前仿真结果写入 V12 原始数据表 (year1..25), FAT/SAT 锚点保留
  function captureToRaw() {
    var s = window.__SIMOUT;
    var V12 = window.__V12;
    if (!s || !V12) { alert("请先在上方计算一次仿真结果，再捕获。"); return; }
    var deg = V12.state.deg;
    deg.forEach(function (y) {
      if (y.row === 3) { y.H = 1.0; if (s.rte && s.rte[0] != null) y.K = s.rte[0]; }
      else if (y.row === 4) { y.H = 0.9925; if (s.rte && s.rte[0] != null) y.K = s.rte[0]; }
      else {
        var yi = y.row - 4; // Year 索引: row5(Year1) -> 1
        if (yi >= 0 && yi < s.soh.length && s.soh[yi] != null) y.H = s.soh[yi];
        if (s.rte && yi >= 0 && yi < s.rte.length && s.rte[yi] != null) y.K = s.rte[yi];
      }
    });
    V12.setSrc("raw");      // 捕获后"原始数据"即等于仿真, 来源回到 raw
    V12.renderDeg();        // 重绘原始数据表
    V12.recalc();           // 计算表格即时联动
    var note = $("capNote");
    if (note) note.textContent = "已捕获仿真（" + s.source + "）到原始数据表 · FAT/SAT 锚点保留。";
  }

  // 暴露计算核心 (供 node 单元测试复用, 防止逻辑漂移)
  function resizeChart() { if (chartInst) { try { chartInst.resize(); } catch (e) {} } }
  if (typeof window !== "undefined") {
    window.__SIM = {
      computeSeries: computeSeries, modelRMSE: modelRMSE, findExact: findExact,
      refCurve: refCurve, nearestM5: nearestM5, CELL_RTE: CELL_RTE, renderChart: renderChart,
      resizeChart: resizeChart,
      BD: BD, FIT: FIT, MODELS: MODELS, API: API, resolveName: resolveName, cleanModelName: cleanModelName
    };
  }

  // ---------- 以下仅浏览器环境执行 ----------
  if (typeof document === "undefined") return;

  // 事件
  $("type").addEventListener("change", function () { fillModels(); fillPresets(); });
  $("model").addEventListener("change", function () { fillPresets(); });
  $("ctemp").addEventListener("change", syncAuxT);
  $("btnCalc").addEventListener("click", doCalc);
  $("btnCompare").addEventListener("click", doCompare);
  $("btnMatch").addEventListener("click", doMatch);
  $("btnCaptureSim").addEventListener("click", captureToRaw);
  presetSel.addEventListener("change", function () { if (this.value !== "") applyPreset(parseInt(this.value)); });

  // 初始化
  fillModels(); fillPresets();
  // 默认载入 系统·S4 · 0.5P/90%/1次天/29.5·30.9℃ 工况
  $("type").value = "system"; fillModels(); $("model").value = "S4"; fillPresets();
  var defTarget = "0.5P / 90%DOD / 1次天 / 29.5℃·30.9℃";
  var defOpt = null;
  for (var oi = 0; oi < presetSel.options.length; oi++) {
    if (presetSel.options[oi].textContent === defTarget) { defOpt = presetSel.options[oi]; break; }
  }
  if (defOpt) { presetSel.value = defOpt.value; applyPreset(parseInt(defOpt.value)); }
  else { $("rate").value = 0.5; $("dod").value = 90; $("cpd").value = 1; $("ctemp").value = 29.5; $("rtemp").value = 30.9; $("soc").value = 50; }
  doCalc();
})();
