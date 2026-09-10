/* =========================================================================
 * workbench.core.js — 主仓 PPT 导出核心逻辑层（纯函数，零 DOM 依赖）
 * =========================================================================
 * 与技能仓 web/workbench.core.js 同源；差异点：
 *   · V / ENG 直接从 window 读取（本文件不接收 deps）
 *   · FILL_MAP 从同目录 fill_map.json 读取（Node 用 require，浏览器用 __FILL_MAP__）
 *   · 导出 window.BESS_WEB_CORE = { Ctx, computeValues, fillXml, collectFromXml,
 *                                     runCalc, stampResult, inputsSha, gates }
 *   · 不跑 sha256 / selftestAuxRatio（主仓 calc_engine.js 已单独保证）
 * ========================================================================= */
(function (root) {
  "use strict";

  // ========================= sha256（同步、无依赖） =========================
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function sha256(str) {
    var msg = new TextEncoder().encode(str);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = msg.length, withOne = ((len + 9) >> 6) + 1;
    var words = new Array(withOne * 16);
    for (var i = 0; i < len; i++)
      words[i >> 2] = (words[i >> 2] || 0) | (msg[i] << (24 - (i % 4) * 8));
    words[len >> 2] = (words[len >> 2] || 0) | (0x80 << (24 - (len % 4) * 8));
    for (var j = (len >> 2) + 1; j < withOne * 16; j++) words[j] = words[j] || 0;
    words[withOne * 16 - 1] = len << 3;
    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) | 0; }
    function hex8(n) {
      var s = (n >>> 0).toString(16);
      while (s.length < 8) s = "0" + s;
      return s;
    }
    for (var blk = 0; blk < withOne; blk++) {
      var w = new Array(64);
      for (var t = 0; t < 16; t++) w[t] = words[blk * 16 + t];
      for (var t2 = 16; t2 < 64; t2++) {
        var s0 = rotr(w[t2 - 15], 7) ^ rotr(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3);
        var s1 = rotr(w[t2 - 2], 17) ^ rotr(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10);
        w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3],
          e = H[4], f = H[5], gg = H[6], h = H[7];
      for (var t3 = 0; t3 < 64; t3++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & gg);
        var t12 = (h + S1 + ch + K[t3] + w[t3]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t22 = (S0 + maj) | 0;
        h = gg; gg = f; f = e; e = (d + t12) | 0;
        d = c; c = b; b = a; a = (t12 + t22) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0;
      H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + gg) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = "";
    for (var k = 0; k < 8; k++) out += hex8(H[k]);
    return out;
  }

  // ========================= 指纹规范化（sort_keys） ======================
  function canon(o) {
    if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
    if (o && typeof o === "object")
      return "{" + Object.keys(o).sort()
        .map(function (k) { return JSON.stringify(k) + ":" + canon(o[k]); })
        .join(",") + "}";
    return JSON.stringify(o);
  }

  // ========================= 通用工具 ====================================
  function dig(obj, path, dflt) {
    var cur = obj;
    var parts = String(path || "").split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object" || !(parts[i] in cur))
        return dflt === undefined ? null : dflt;
      cur = cur[parts[i]];
    }
    return cur === undefined ? (dflt === undefined ? null : dflt) : cur;
  }
  function unwrap(v) {
    if (v && typeof v === "object" && "value" in v) return v.value;
    return v;
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function pick(result, logical) {
    var keys = {
      dcNameplate: ["nomDC", "dcNameplateMWh", "dcNameplate", "nom_dc"],
      acUsable:    ["acUsableBOL", "acUsableMWh", "acUsable", "acUsableBOL_MWh"],
      rte:         ["acEff", "rte", "acRTE"],
      required:    ["requiredAC", "requiredEnergyMWh", "required"],
      meets:       ["meets", "compliant"],
      rows:        ["sizingRows", "rows", "years"]
    }[logical] || [];
    for (var i = 0; i < keys.length; i++)
      if (keys[i] in result) return result[keys[i]];
    return null;
  }

  // ========================= AC 可用能量 =================================
  function computeAcUsable(H_avail, effDis, cable, E_cycle_sys) {
    return H_avail * effDis * cable - E_cycle_sys;
  }

  // ========================= 加载 FILL_MAP ===============================
  var FILL_MAP = null;
  if (typeof window !== "undefined" && window.__FILL_MAP__) {
    FILL_MAP = window.__FILL_MAP__;
  } else if (typeof globalThis !== "undefined" && globalThis.__FILL_MAP__) {
    FILL_MAP = globalThis.__FILL_MAP__;
  } else if (typeof require !== "undefined") {
    try { FILL_MAP = require("./fill_map.json"); } catch (e) {}
  }
  if (!FILL_MAP) throw new Error("fill_map.json 未找到，请把 fill_map.json 放在同目录或挂在 window.__FILL_MAP__");

  // ========================= 闸门常量（gates.py 同源） ====================
  var PROSE_KEYS = /^(namingAliases|note|quote|comments?|description)$/i;
  var PROSE_KEY_HINT = /(?:note|comment|alias|desc)/i;
  var LEGACY_PATTERNS = [
    /\b(?:LF502S|NF502S|MB56|S5[5-9]\d{2}H\d{3})\b/gi,
    /\bS556H201\b/gi
  ];
  var ACCIDENT_CONSTS = [
    /\b1\.73\b/,
    /\b5015(\.\d+)?\b/,
    /\b(?:62|58|71)\b(?=\s*[;,)])/
  ];

  // ========================= Ctx + 占位符求值 ===========================
  function Ctx(profile, project, result, deg) {
    this.profile = profile || {};
    this.project = project || {};
    this.result = result || {};
    this.deg = deg || {};
  }

  Ctx.prototype.src = function (path) {
    var i = path.indexOf(".");
    var root = i < 0 ? path : path.slice(0, i);
    var rest = i < 0 ? "" : path.slice(i + 1);
    var obj = { profile: this.profile, project: this.project,
                result: this.result, degradation: this.deg }[root] || {};
    return rest ? unwrap(dig(obj, rest)) : obj;
  };

  // Python format string parser: "{:.2f}" → toFixed(2)
  function fmtRule(v, fmt) {
    if (!fmt || !isNum(v)) return String(v);
    var m = /\{:(\.\d+)?f\}/.exec(fmt);
    if (!m) return String(v);
    var d = m[1] ? parseInt(m[1].slice(1), 10) : 6;
    return v.toFixed(d);
  }

  Ctx.prototype.computeValues = function (placeholders) {
    var self = this;
    var values = {}, missingMap = [], manual = [], empty = [], optionalEmpty = [];
    Object.keys(placeholders).forEach(function (ph) {
      var rule = FILL_MAP[ph];
      if (!rule) { missingMap.push(ph); return; }
      var srcPath = rule.src;
      var v = srcPath ? self.src(srcPath) : null;
      // derived 字段
      if (srcPath && srcPath.indexOf("derived:") === 0) {
        var spec = srcPath.slice(8);
        var i2 = spec.indexOf(":");
        var name = i2 < 0 ? spec : spec.slice(0, i2);
        var arg = i2 < 0 ? "" : spec.slice(i2 + 1);
        v = self.derived(name, arg);
      }
      if (v === null || v === undefined) {
        if (rule.optional) optionalEmpty.push(ph);
        else if (rule.manual) manual.push(ph);
        else empty.push(ph);
        values[ph] = null;
        return;
      }
      var fmt = rule.fmt;
      if (fmt) v = fmtRule(v, fmt);
      values[ph] = String(v);
    });
    return { values: values, missingMap: missingMap, manual: manual,
             empty: empty, optionalEmpty: optionalEmpty };
  };

  // ---------------- derived 求值 --------------------------------------
  function _digObj(obj, path) {
    var cur = obj;
    path.split(".").forEach(function (k) {
      if (cur == null || typeof cur !== "object") { cur = null; }
      else { cur = cur[k]; }
    });
    return cur;
  }
  Ctx.prototype.derived = function (name, arg) {
    var p = this.profile, pr = this.project, rs = this.result, self = this;
    if (name === "containerQty") {
      var qc = rs.containerCount;
      return isNum(qc) ? qc : null;
    }
    if (name === "dcNameplate") {
      return isNum(rs.nomDC) ? rs.nomDC : null;
    }
    if (name === "acUsableMWh") {
      return isNum(rs.acUsableBOL) ? rs.acUsableBOL : null;
    }
    if (name === "energyMWh") {
      return isNum(rs.nomDC) ? rs.nomDC : null;
    }
    if (name === "durationH") {
      var dur = dig(p, "arch.durationH");
      return isNum(dur) ? dur : null;
    }
    if (name === "rateLabel") {
      var rr = dig(p, "arch.rateP");
      return isNum(rr) ? (String(parseFloat(rr)) + "P") : null;
    }
    if (name === "pcsMvaTotal") {
      var q = self.derived("containerQty");
      var mva = unwrap(dig(pr, "systemConfig.pcsMvaPerContainer"));
      var mvaN = (mva != null && isNum(unwrap(mva))) ? unwrap(mva) : null;
      return (isNum(q) && mvaN != null) ? q * mvaN : null;
    }
    if (name === "effPct") {
      var map = { effDis: "systemAssumptions.effDis", effChg: "systemAssumptions.effChg",
                  cable: "systemAssumptions.cable", transformer: "systemAssumptions.transformer" };
      var v2 = map[arg] ? unwrap(dig(pr, map[arg])) : null;
      if (arg === "ac") {
        var a = unwrap(dig(pr, "systemAssumptions.effChg")),
            b = unwrap(dig(pr, "systemAssumptions.effDis")),
            c = unwrap(dig(pr, "systemAssumptions.cable"));
        v2 = (isNum(a) && isNum(b) && isNum(c)) ? a * b * c : null;
      }
      return isNum(v2) ? v2 * 100 : null;
    }
    if (name === "compliance") return self._compliance(arg ? parseInt(arg, 10) : 0);
    if (name.indexOf("cert") === 0) return self._cert(name, arg);
    return null;
  };

  Ctx.prototype._cert = function (name, arg) {
    var levels = dig(this.profile, "cert.levels") || [];
    var byLevel = {}, flat = [];
    levels.forEach(function (lv) {
      var label = String(lv.level || "");
      var items = lv.items || [];
      byLevel[label] = items;
      items.forEach(function (it) { flat.push([label, it]); });
    });
    function itemsFor(kind) {
      for (var label in byLevel)
        if (label.toLowerCase().indexOf(kind.toLowerCase()) >= 0)
          return byLevel[label];
      return [];
    }
    if (name === "certCell")
      return itemsFor("cell").map(function (i) { return i.std || ""; }).join(", ");
    if (name === "certPack")
      return itemsFor("pack").map(function (i) { return i.std || ""; }).join(", ");
    if (name === "certCluster")
      return itemsFor("cluster").map(function (i) { return i.std || ""; }).join(", ");
    if (name === "certContainer")
      return itemsFor("system").map(function (i) { return i.std || ""; }).join(", ");
    if (name === "certCellNote") return "Certification plan subject to order schedule";
    if (name === "certListSummary") {
      var set = {};
      flat.forEach(function (x) { if (x[1].std) set[x[1].std] = 1; });
      return Object.keys(set).sort().join("; ").slice(0, 300);
    }
    return null;
  };

  Ctx.prototype._compliance = function (n) {
    var pr = this.project, p = this.profile, self = this;
    function reqnum(path) {
      var v = unwrap(dig(pr, path));
      return isNum(v) ? v : null;
    }
    var capApp = dig(p, "capabilities.applications");
    var capScope = dig(p, "capabilities.supplyScope");
    var rows = {
      1:  ["contains", dig(pr, "requirement.application"),       capApp],
      2:  ["eq",       dig(pr, "requirement.supplyScope"),       capScope],
      3:  ["num>=",    reqnum("requirement.powerMW"),            self.derived("pcsMvaTotal")],
      4:  ["num>=",    reqnum("requirement.energyMWh"),          self.derived("acUsableMWh")],
      5:  ["num==",    reqnum("requirement.rateP"),              dig(p, "arch.rateP")],
      6:  ["num>=",    reqnum("requirement.cyclesPerDay"),       reqnum("requirement.cyclesPerDay")],
      7:  ["num>=",    reqnum("requirement.dod"),                unwrap(dig(p, "systemAssumptions.dod.value"))],
      8:  ["num>=",    reqnum("requirement.warrantyYears"),      reqnum("requirement.warrantyYears")],
      9:  ["ext",      dig(pr, "requirement.extWarrantyYears"),  dig(pr, "requirement.extWarrantyYears")],
      10: ["contains", dig(pr, "requirement.communication"),     dig(pr, "requirement.communication")]
    };
    var r = rows[n];
    if (!r) return null;
    var mode = r[0], a = r[1], b = r[2];
    if (mode === "ext") {
      var av = (a == null || unwrap(a) == null) ? null : unwrap(a);
      var bv = (b == null || unwrap(b) == null) ? null : unwrap(b);
      if (av == null && bv == null) return "Be discussed";
      if (!isNum(av) || !isNum(bv)) return "Be discussed";
      return bv >= av - 1e-9 ? "Meet" : "Not meet";
    }
    function verdict(req, eve, md) {
      if (md === "num>=" || md === "num==") {
        var aa = isNum(req) ? req : (req != null && isNum(unwrap(req)) ? unwrap(req) : null);
        var bb = isNum(eve) ? eve : (eve != null && isNum(unwrap(eve)) ? unwrap(eve) : null);
        if (aa == null || bb == null) return "Be discussed";
        if (md === "num>=") return bb >= aa - 1e-9 ? "Meet" : "Not meet";
        return Math.abs(bb - aa) < 1e-9 ? "Meet" : "Not meet";
      }
      var rs = String(req == null ? "" : req).trim();
      var es = String(eve == null ? "" : eve).trim();
      if (!rs || !es) return "Be discussed";
      if (md === "contains") return (es.indexOf(rs) >= 0 || rs.indexOf(es) >= 0) ? "Meet" : "Be discussed";
      return rs === es ? "Meet" : "Be discussed";
    }
    return verdict(a, b, mode);
  };

  // ---------------- XML 工具 ------------------------------------------
  var PH_RE = /\{\{([A-Z0-9_]+)\}\}/g;
  var AT_RE = /<a:t>([\s\S]*?)<\/a:t>/g;
  function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function xmlUnescape(s) {
    return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  function fillXml(xml, values) {
    return xml.replace(AT_RE, function (m0, inner) {
      if (inner.indexOf("{{") < 0) return m0;
      var out = xmlUnescape(inner);
      Object.keys(values).forEach(function (ph) {
        var v = values[ph];
        if (v == null) return;
        out = out.split("{{" + ph + "}}").join(String(v));
      });
      return "<a:t>" + xmlEscape(out) + "</a:t>";
    });
  }
  function collectFromXml(xml) {
    var found = {};
    (xml.match(AT_RE) || []).forEach(function (m0) {
      var inner = m0.replace(/<\/?a:t>/g, "");
      var m;
      PH_RE.lastIndex = 0;
      while ((m = PH_RE.exec(inner)) !== null)
        found[m[1]] = 1;
    });
    return found;
  }

  // ========================= runCalc（引擎直算） ========================
  function runCalc(project, profile, deg) {
    var perContainer = unwrap(dig(profile, "arch.energyPerContainerMWh"));
    if (!(isNum(perContainer) && perContainer > 0))
      throw new Error("profile.arch.energyPerContainerMWh 缺失或非法");
    var rateP = isNum(unwrap(dig(profile, "arch.rateP")))
      ? unwrap(dig(profile, "arch.rateP"))
      : (isNum(unwrap(dig(project, "requirement.rateP.value")))
           ? unwrap(dig(project, "requirement.rateP.value")) : 0.25);
    var reqP = unwrap(dig(project, "requirement.powerMW.value"));
    var requiredAC = unwrap(dig(project, "requirement.energyMWh.value"));
    if (!(isNum(reqP) && isNum(requiredAC)))
      throw new Error("project 缺 requirement.powerMW / energyMWh");
    var effChg = unwrap(dig(project, "systemAssumptions.effChg.value"));
    if (!isNum(effChg)) effChg = unwrap(dig(profile, "systemAssumptions.effChg"));
    var effDis = unwrap(dig(project, "systemAssumptions.effDis.value"));
    if (!isNum(effDis)) effDis = unwrap(dig(profile, "systemAssumptions.effDis"));
    var cable = unwrap(dig(project, "systemAssumptions.cable.value"));
    if (!isNum(cable)) cable = unwrap(dig(profile, "systemAssumptions.cable"));
    if (!isNum(effChg) || !isNum(effDis) || !isNum(cable))
      throw new Error("效率链参数缺失（effChg/effDis/cable）");
    var dod = unwrap(dig(project, "requirement.dod.value"));
    if (!isNum(dod)) dod = unwrap(dig(profile, "systemAssumptions.dod.value"));
    if (!(isNum(dod) && dod > 0 && dod < 1))
      throw new Error("DOD 未取得合法值（须 0<dod<1，禁止默认值）");
    var auxModel = dig(project, "systemAssumptions.auxModel") || {};
    var aux = {
      T: isNum(auxModel.T) ? auxModel.T : 25,
      r: isNum(auxModel.r) ? auxModel.r : rateP,
      N: isNum(auxModel.N) ? auxModel.N : 1,
      mode: String(auxModel.mode != null ? auxModel.mode : "1.0")
    };
    var acAuxNoLoad = unwrap(dig(profile, "systemAssumptions.acAuxNoLoad"));
    if (!isNum(acAuxNoLoad)) acAuxNoLoad = 0.003125;
    var mvSkidCap = unwrap(dig(profile, "arch.pcsMvaPerContainer.value"));
    if (!isNum(mvSkidCap)) mvSkidCap = perContainer * rateP;
    var soh = (deg && Array.isArray(deg.soh)) ? deg.soh : null;
    var rte = (deg && Array.isArray(deg.rte)) ? deg.rte : null;
    if ((!soh || soh.length < 2) && profile.degradation) {
      soh = profile.degradation.soh; rte = profile.degradation.rte;
    }
    if (!Array.isArray(soh) || !Array.isArray(rte) ||
        soh.length !== rte.length || soh.length < 2)
      throw new Error("衰减源 soh/rte 非法（需等长且 >=2 点）");
    var simOut = { soh: soh.slice(), rte: rte.slice() };
    var acEff = rte[0];
    var root = (typeof window !== "undefined" ? window : globalThis);
    var CATALOG = root.BESS_CATALOG;
    var V12 = root.V12;
    var ENG = root.BESS_ENGINE;
    var productModel = dig(profile, "ident.productModel");
    var V = (CATALOG && productModel && CATALOG.products[productModel])
      ? CATALOG.makeDataView(CATALOG, productModel, V12)
      : V12;
    function runFor(N) {
      var overrides = {
        inputs: {
          powerPoC: reqP, epoc: requiredAC, reqP: reqP,
          reqEnergyDC: N * perContainer,
          effChg: effChg, effDis: effDis, cable: cable, dod: dod,
          containerCount: N, perContainer: perContainer,
          skidCount: N, mvSkidCap: mvSkidCap,
          acAuxNoLoad: acAuxNoLoad
        },
        aux: { T: aux.T, r: aux.r, N: aux.N, mode: aux.mode },
        aug1: {}, aug2: {}, sohSrc: "sim",
        product: dig(profile, "ident.productModel") || ""
      };
      var calc = ENG.calc(V, overrides, simOut);
      var rows = calc.rows, sys = calc.sys, I = overrides.inputs;
      var sizingRows = [];
      var maxYear = soh.length - 1;
      rows.forEach(function (r) {
        // row3=FAT, row4=Year0, row5=Year1, ... row29=Year25
        if (r.row < 4) return;
        var yr = r.row - 4;
        if (yr > maxYear) return;
        var acUsable = computeAcUsable(r.H_avail, I.effDis, I.cable, sys.E_cycle_sys);
        sizingRows.push({ year: yr, soh: r.H, acUsable: acUsable });
      });
      sizingRows.sort(function (a, b) { return a.year - b.year; });
      if (!sizingRows.length) throw new Error("runCalc: 未能从计算表中识别 Year0..YearN 行");
      return { sizingRows: sizingRows, sys: sys, acUsableBOL: sizingRows[0].acUsable };
    }
    var containerCount;
    { var lo = 1, hi = 64;
      while (runFor(hi).acUsableBOL < requiredAC && hi < 100000) hi *= 2;
      if (runFor(hi).acUsableBOL < requiredAC) throw new Error("无法在合理柜数内满足 AC 可用需求");
      containerCount = hi;
      while (lo <= hi) {
        var mid = Math.floor((lo + hi) / 2);
        if (runFor(mid).acUsableBOL >= requiredAC) { containerCount = mid; hi = mid - 1; }
        else lo = mid + 1;
      }
    }
    var chosen = runFor(containerCount);
    var sizingRows = chosen.sizingRows, sys = chosen.sys;
    var nomDC = containerCount * perContainer;
    var meets = chosen.acUsableBOL >= requiredAC;
    return {
      nomDC: nomDC, acUsableBOL: chosen.acUsableBOL, acEff: acEff,
      requiredAC: requiredAC, meets: meets, containerCount: containerCount,
      auxMWh: sys.E_cycle_sys, sizingRows: sizingRows
    };
  }

  // ========================= 闸门 G0-G6 =================================
  function gateLintInputs(profile, project, deg) {
    var errs = [];
    var current = [];
    ["cell.model", "pack.model", "cluster.model", "container.model",
     "ident.productModel"].forEach(function (f) {
      var v = dig(profile, f);
      if (v) current.push(String(v).toUpperCase());
    });
    function collectValueTexts(obj, key, out) {
      if (obj == null) return;
      if (Array.isArray(obj)) { obj.forEach(function (x) { collectValueTexts(x, key, out); }); return; }
      if (typeof obj === "object") {
        Object.keys(obj).forEach(function (k) {
          if (PROSE_KEYS.test(k) || PROSE_KEY_HINT.test(k)) return;
          collectValueTexts(obj[k], k, out);
        });
        return;
      }
      out.push(String(obj));
    }
    [["profile", profile], ["project", project], ["degradation", deg]].forEach(function (pair) {
      var texts = [];
      collectValueTexts(pair[1] || {}, null, texts);
      var joined = texts.join(" | ").toUpperCase();
      LEGACY_PATTERNS.forEach(function (rx) {
        var m = rx.exec(joined);
        if (m && current.indexOf(m[0].toUpperCase()) < 0)
          errs.push(pair[0] + " 混入旧型号族: " + m[0]);
        rx.lastIndex = 0;
      });
      texts.forEach(function (t) {
        if (!/^-?\d+(\.\d+)?$/.test(t)) return;
        ACCIDENT_CONSTS.forEach(function (rx) {
          var m = rx.exec(t);
          if (m) errs.push(pair[0] + " 混入事故常量 " + m[0]);
        });
      });
    });
    return { ok: errs.length === 0, errs: errs, warns: [] };
  }
  function gateProfile(profile) {
    var errs = [], warns = [];
    if (!profile || typeof profile !== "object") return { ok: false, errs: ["profile 不是对象"], warns: warns };
    var PROFILE_REQUIRED = [
      "ident.productModel", "cell.model", "cell.capacityAh", "cell.nominalV",
      "pack.model", "pack.configS", "cluster.model", "cluster.configS",
      "container.model", "arch.clustersPerContainer", "arch.energyPerContainerMWh",
      "arch.durationH", "arch.rateP"
    ];
    PROFILE_REQUIRED.forEach(function (p) {
      var v = dig(profile, p);
      if (v === null || v === undefined || v === "") errs.push("profile." + p + " 缺失");
    });
    var cellCap = unwrap(dig(profile, "cell.capacityAh"));
    if (isNum(cellCap) && !(cellCap >= 50 && cellCap <= 5000))
      errs.push("cell.capacityAh = " + cellCap + " 超出合理区间 [50, 5000]");
    var energy = unwrap(dig(profile, "arch.energyPerContainerMWh"));
    if (isNum(energy) && !(energy > 0.5 && energy < 20))
      errs.push("arch.energyPerContainerMWh = " + energy + " 超出合理区间");
    var packS = unwrap(dig(profile, "pack.configS"));
    var clusterS = unwrap(dig(profile, "cluster.configS"));
    if (isNum(packS) && isNum(clusterS) && packS !== clusterS)
      errs.push("pack.configS(" + packS + ") ≠ cluster.configS(" + clusterS + ")，产品层级串并联不一致");
    // 一致性：电芯型号若能在 BDATA 找到则曲线可绑定，未找到给 warning（不拦，允许先占位）
    var cellModel = unwrap(dig(profile, "cell.model"));
    var BDATA = (typeof window !== "undefined" ? window : globalThis).BDATA;
    if (cellModel && BDATA && BDATA.cells && !BDATA.cells[cellModel])
      warns.push("cell.model=" + cellModel + " 在 BDATA 中无衰减曲线，将回退默认表");
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function gateProject(project) {
    var errs = [], warns = [];
    if (!project || typeof project !== "object") return { ok: false, errs: ["project 不是对象"], warns: warns };
    var REQ_REQUIRED = ["requirement.powerMW", "requirement.energyMWh",
                        "systemAssumptions.effChg", "systemAssumptions.effDis",
                        "systemAssumptions.cable"];
    REQ_REQUIRED.forEach(function (p) {
      var v = unwrap(dig(project, p));
      if (v === null || v === undefined) errs.push("project." + p + " 缺失");
    });
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function collectAsk(obj, path) {
    var hits = [];
    function walk(cur, parent) {
      if (!cur || typeof cur !== "object") return;
      if (Array.isArray(cur)) { cur.forEach(function (x) { walk(x, parent); }); return; }
      if (cur.status === "ASK-USER" || cur.status === "ask-user" ||
          (cur.value === null && cur.status && String(cur.status).toUpperCase().indexOf("ASK") >= 0)) {
        hits.push(parent + "." + (cur.key || Object.keys(parent).find(function (k) { return parent[k] === cur; })));
      }
      Object.keys(cur).forEach(function (k) { walk(cur[k], cur); });
    }
    walk(obj, null);
    return hits;
  }
  function gateAsk(project, profile) {
    var errs = [], warns = [];
    var askKeys = ["requirement.dod", "requirement.energyBasis",
                   "systemConfig.corrosionClass", "requirement.extWarrantyYears"];
    askKeys.forEach(function (p) {
      var v = dig(project, p);
      if (v && typeof v === "object" && v.status === "ASK-USER")
        errs.push("项目层仍标记 ASK-USER: " + p);
    });
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function gateDeg(deg, profile, project) {
    var errs = [], warns = [];
    if (!deg || typeof deg !== "object") return { ok: false, errs: ["degradation 不是对象"], warns: warns };
    var cellModel = dig(profile, "cell.model");
    var degCell = deg.cellModel;
    if (!degCell) errs.push("degradation.cellModel 缺失");
    else if (cellModel && String(degCell).toUpperCase() !== String(cellModel).toUpperCase())
      errs.push("电芯型号不匹配：衰减源=" + degCell + "，产品契约=" + cellModel);
    var soh = deg.soh || [], rte = deg.rte || [];
    if (!soh.length) return { ok: false, errs: errs.concat(["degradation.soh 为空"]), warns: warns };
    var years = unwrap(dig(project, "requirement.designLifeYears"));
    if (isNum(years) && soh.length < years + 1)
      errs.push("soh 数组长度 " + soh.length + " < 设计寿命 " + years + " + 1");
    if (!isNum(soh[0]) || !(soh[0] >= 0.90 && soh[0] <= 1.0))
      errs.push("soh[0] = " + soh[0] + " 不在 [0.90, 1.0]");
    for (var i = 1; i < soh.length; i++) {
      if (!isNum(soh[i])) errs.push("soh[" + i + "] 非有限数");
      else if (soh[i] > soh[i - 1] + 1e-9)
        errs.push("soh 非单调递减：soh[" + i + "] > soh[" + (i - 1) + "]");
    }
    if (rte.length) {
      if (rte.length !== soh.length)
        errs.push("rte 长度 " + rte.length + " != soh 长度 " + soh.length);
      rte.forEach(function (v, j) {
        if (!isNum(v) || !(v >= 0.50 && v <= 1.0))
          errs.push("rte[" + j + "] = " + v + " 超出 [0.50, 1.0]");
      });
    }
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function gateResult(result, profile, project, inputsSha) {
    var errs = [], warns = [];
    if (!result || typeof result !== "object") return { ok: false, errs: ["result 不是对象"], warns: warns };
    var prov = result._provenance;
    if (!prov) errs.push("result 缺 _provenance");
    else {
      if (!prov.engineVersion) errs.push("_provenance.engineVersion 缺失");
      if (inputsSha && prov.inputsSha256 && prov.inputsSha256 !== inputsSha)
        errs.push("_provenance.inputsSha256 与当前输入不一致 —— 必须重算");
    }
    var dc = pick(result, "dcNameplate"), ac = pick(result, "acUsable");
    if (!isNum(dc)) errs.push("result 缺 DC 铭牌");
    if (!isNum(ac)) errs.push("result 缺 AC 可用");
    if (errs.length) return { ok: false, errs: errs, warns: warns };
    if (ac > dc * (1 + 1e-6))
      errs.push("物理不成立：AC 可用 " + ac.toFixed(4) + " > DC 铭牌 " + dc.toFixed(4));
    var per = dig(profile, "arch.energyPerContainerMWh");
    var qty = result.containerCount;
    if (isNum(per) && isNum(qty)) {
      if (dc > per * qty * 1.02)
        errs.push("物理不成立：DC 铭牌 " + dc.toFixed(4) + " > 柜数 " + qty + " × 单柜 " + per);
    }
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function gatePptxXmls(xmlTexts, profile, result) {
    var errs = [], warns = [];
    var joined = xmlTexts.join(" ");
    var blank = {};
    xmlTexts.forEach(function (xml, idx) {
      var residue = collectFromXml(xml);
      Object.keys(residue).forEach(function (ph) {
        if (!blank[ph]) blank[ph] = [];
        blank[ph].push(idx);
      });
    });
    if (Object.keys(blank).length > 0)
      errs.push("残留占位符: " + Object.keys(blank).slice(0, 10).join(", ") +
                (Object.keys(blank).length > 10 ? " ..." : ""));
    // 旧型号检测
    var legacyRx = /\b(?:S556H201|S568H\d{3}|LF502S|NF502S|MB56)\b/gi;
    var m = legacyRx.exec(joined);
    if (m) errs.push("残留旧型号: " + m[0]);
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }
  function recomputeAc(dc, soh0, rte, effChg, effDis, cable, dod, auxMwh) {
    dod = dod == null ? 1.0 : dod;
    return dc * soh0 * Math.sqrt(rte) * dod * effDis * cable - (auxMwh || 0);
  }
  function gateRecheck(result, project, profile, deg) {
    var errs = [], warns = [];
    var dc = pick(result, "dcNameplate"), ac = pick(result, "acUsable");
    var soh0 = (deg && deg.soh && deg.soh.length) ? deg.soh[0] : null;
    var rte = ((deg && deg.rte && deg.rte.length) ? deg.rte[0] : null) ||
              pick(result, "rte");
    var dod = unwrap(dig(project, "requirement.dod.value"));
    var effDis = unwrap(dig(project, "systemAssumptions.effDis.value"));
    var cable = unwrap(dig(project, "systemAssumptions.cable.value"));
    var effChg = unwrap(dig(project, "systemAssumptions.effChg.value"));
    var missing = [];
    if (!isNum(dc)) missing.push("DC 铭牌");
    if (!isNum(ac)) missing.push("AC 可用");
    if (!isNum(rte)) missing.push("RTE");
    if (!isNum(soh0)) missing.push("SOH[0]");
    if (!isNum(effDis)) missing.push("放电效率");
    if (!isNum(cable)) missing.push("电缆效率");
    if (missing.length) {
      warns.push("复算跳过: " + missing.join(", "));
      return { ok: true, errs: errs, warns: warns, skipped: true };
    }
    var aux = 0;
    ["auxMWh", "auxTotalMWh", "aux"].forEach(function (k) {
      if (isNum(result[k])) aux = result[k];
    });
    var calc = recomputeAc(dc, soh0, rte, effChg || 1.0, effDis, cable, dod, aux);
    var dev = Math.abs(calc - ac) / ac;
    if (dev > 0.005) {
      errs.push("双验不通过：引擎 AC 可用 " + ac.toFixed(4) + "，独立复算 " + calc.toFixed(4) +
                "，偏差 " + (dev * 100).toFixed(2) + "% > 0.50%");
    } else {
      warns.push("双验通过：偏差 " + (dev * 100).toFixed(3) + "%（引擎 " + ac.toFixed(4) + " vs 复算 " + calc.toFixed(4) + "）");
    }
    return { ok: errs.length === 0, errs: errs, warns: warns, dev: dev };
  }

  // ========================= 指纹 =====================================
  function inputsSha(project, profile, deg) {
    return sha256(canon({ profile: profile, project: project, degradation: deg }));
  }
  function stampResult(result, project, profile, deg) {
    result._provenance = {
      engineVersion: "v13-web",
      builtAt: new Date().toISOString().slice(0, 19),
      inputsSha256: inputsSha(project, profile, deg),
      stampedBy: "main-workbench"
    };
    return result;
  }

  // ========================= 导出 =====================================
  var API = {
    Ctx: Ctx, computeValues: Ctx.prototype.computeValues, FILL_MAP: FILL_MAP,
    fillXml: fillXml, collectFromXml: collectFromXml,
    runCalc: runCalc, stampResult: stampResult, inputsSha: inputsSha,
    gates: {
      lintInputs: gateLintInputs, G0: gateProfile, G1: gateProject,
      G2: gateAsk, G3: gateDeg, G4: gateResult, G5: gatePptxXmls, G6: gateRecheck
    }
  };
  if (typeof root !== "undefined") root.BESS_WEB_CORE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
