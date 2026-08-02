/* =========================================================================
 * BESS 配置器 — 计算引擎 (calc_engine.js)
 * 双环境: 浏览器(window.BESS_ENGINE) + Node.js(module.exports)
 * 纯函数，零 DOM 依赖，可被 Skill 命令行调用
 * ========================================================================= */
(function () {
  "use strict";

  // ---- 插值工具 ----
  function tiRow(row, T, Tgrid) {
    if (T <= Tgrid[0]) return row[0];
    if (T >= Tgrid[4]) return row[4];
    for (let i = 0; i < 4; i++)
      if (T >= Tgrid[i] && T <= Tgrid[i + 1])
        return row[i] + (row[i + 1] - row[i]) * (T - Tgrid[i]) / (Tgrid[i + 1] - Tgrid[i]);
    return row[4];
  }

  function riMat(mat, T, r, Tgrid, Rgrid) {
    const cols = mat.map(rw => tiRow(rw, T, Tgrid));
    if (r <= Rgrid[0]) return cols[0];
    if (r >= Rgrid[2]) return cols[2];
    for (let i = 0; i < 2; i++)
      if (r >= Rgrid[i] && r <= Rgrid[i + 1])
        return cols[i] + (cols[i + 1] - cols[i]) * (r - Rgrid[i]) / (Rgrid[i + 1] - Rgrid[i]);
    return cols[2];
  }

  // ---- DC 辅耗: 单箱六步循环 ----
  function algo(r, T, mode, restOverride, N, V, aux) {
    const pChg = riMat(V.M.chg, T, r, V.Tgrid, V.Rgrid),
          pTailC = riMat(V.M.tailC, T, r, V.Tgrid, V.Rgrid),
          pDis = riMat(V.M.dis, T, r, V.Tgrid, V.Rgrid),
          pTailD = riMat(V.M.tailD, T, r, V.Tgrid, V.Rgrid);
    const ps = V.STBY[String(mode)] != null ? V.STBY[String(mode)] : Number(mode);
    let tAct; const m = [0.25, 0.33, 0.5].find(k => Math.abs(k - r) < 1e-9);
    tAct = m !== undefined ? { 0.25: 4, 0.33: 3, 0.5: 2 }[m] : 1 / r;
    const tTail = r <= 0.33 ? 0.5 : 1.5;
    const tRest = (restOverride != null && restOverride !== "")
      ? Number(restOverride) : Math.max(0, 24 / (N || 1) - 2 * (tAct + tTail));
    const t3 = Math.min(4, tRest), t6 = Math.max(0, tRest - 4);
    // 冷尾策略
    const strategy = (aux.coolStrategy) || "adaptive";
    const frac = (strategy === "adaptive") ? (aux.tailCoolFrac != null ? aux.tailCoolFrac : 0.30) : 1;
    const eTailC = pTailC * tTail * frac + ps * tTail * (1 - frac);
    const eTailD = pTailD * tTail * frac + ps * tTail * (1 - frac);
    const Eaux = pChg * tAct + eTailC + ps * t3 + pDis * tAct + eTailD + ps * t6;
    const cycleH = 2 * tAct + 2 * tTail + tRest;
    const warning = cycleH > 24 ? "单次循环时长(" + cycleH.toFixed(1) + "h) 超过 24h，当前倍率与每日循环数不匹配" : null;
    return { Eaux, avgKW: Eaux / cycleH, avgMW: Eaux / cycleH / 1000,
             pChg, pTailC, pDis, pTailD, ps, tAct, tTail, tRest, t3, t6, cycleH,
             strategy, eTailC, eTailD, warning };
  }

  // ---- AC 侧辅耗模型 ----
  function acMatrixValue(key, T, r, V, inputs) {
    const nC = Math.max(1, inputs.containerCount);
    const noLoadkW = inputs.acAuxNoLoad * inputs.skidCount * 1000 / nC;
    if (key === "chg" || key === "dis") {
      const shape = riMat(V.M[key], T, r, V.Tgrid, V.Rgrid);
      const ref = riMat(V.M[key], 25, 0.5, V.Tgrid, V.Rgrid);
      const loadkW = inputs.acAuxLoadPct * (inputs.reqP / nC) * 1000 * (ref ? shape / ref : 1);
      return noLoadkW + loadkW;
    }
    return noLoadkW;
  }

  function acAuxPowers(V, inputs, aux) {
    const T = aux.T, r = aux.r, nC = Math.max(1, inputs.containerCount);
    const mw = k => acMatrixValue(k, T, r, V, inputs) * nC / 1000;
    return { chg: mw("chg"), dis: mw("dis"), tail: mw("tailC"), stby: mw("tailC") };
  }

  // ---- 系统级辅耗 ----
  function computeAux(V, inputs, aux) {
    const a = algo(aux.r, aux.T, aux.mode, aux.rest, aux.N, V, aux);
    const nC = inputs.containerCount;
    const pac = acAuxPowers(V, inputs, aux);
    return Object.assign({}, a, {
      nC, pac,
      P_chg_sys:  pac.chg  + nC * a.pChg  / 1000,
      P_dis_sys:  pac.dis  + nC * a.pDis  / 1000,
      P_tailC_sys: pac.tail + nC * a.pTailC / 1000,
      P_tailD_sys: pac.tail + nC * a.pTailD / 1000,
      P_stby_sys: pac.stby + nC * a.ps    / 1000,
      t_dis: a.tAct,
      E_cycle_sys: nC * a.Eaux / 1000
        + pac.chg * a.tAct + pac.tail * a.tTail + pac.stby * a.t3
        + pac.dis * a.tAct + pac.tail * a.tTail + pac.stby * a.t6
    });
  }

  // ---- 补容 ----
  function augAdd(currentRow, deg, aug1, aug2) {
    let add = 0;
    const consider = (map) => {
      for (const key in map) {
        const ir = +key, val = map[key];
        if (!val) continue;
        if (ir <= currentRow) {
          const srcRow = currentRow - ir + 3;
          const src = deg.find(z => z.row === srcRow);
          if (src) add += val * src.H * Math.sqrt(src.K);
        }
      }
    };
    consider(aug1); consider(aug2);
    return add;
  }

  // ---- 全站计算表 ----
  function computeTable(V, inputs, aux, deg, aug1, aug2, sohSrc, simOut) {
    // 防护: 若派生量未计算，自动 derive，避免直接调用产出 NaN
    if (inputs.nom == null) derive(V, inputs, aux);
    const sys = computeAux(V, inputs, aux);
    const I = inputs;
    const rteOv = (I.rteOverride !== "" && I.rteOverride != null) ? I.rteOverride : null;
    const SIM = (sohSrc === "sim" && simOut) ? simOut : null;
    const rows = deg.map(y => {
      let H = y.H;
      let K = rteOv != null ? rteOv : y.K;
      let srcFallback = false;
      if (SIM) {
        // 取仿真逐年 soh；FAT(出厂) 与 SAT(投运首年/Year0) 均对应仿真 Y0 = soh[0]
        // 仿真年限不足的行回退原始衰减表，并标记 srcFallback 供 UI 提示
        // rteOverride 为全局覆盖, 优先级最高: 设置后 K 恒为覆盖值, 不受 sim/raw 影响
        const simR = (rteOv == null) ? (SIM.rte && SIM.rte[0] != null ? SIM.rte[0] : null) : null;
        if (y.row === 3) {
          H = 1.0; // FAT = 出厂新电池，H 固定为 1.0
          if (simR != null) K = simR;
        } else if (y.row === 4) {
          H = 0.9925; // SAT = 投运首年 (出厂后运输/安装调试损耗)
          if (simR != null) K = simR;
        } else {
          const yi = y.row - 4;
          if (yi >= 0 && yi < SIM.soh.length && SIM.soh[yi] != null) H = SIM.soh[yi];
          else srcFallback = true;
          if (rteOv == null && SIM.rte && yi >= 0 && yi < SIM.rte.length && SIM.rte[yi] != null) K = SIM.rte[yi];
        }
      }
      const C = I.nom;
      const D = I.nom * H * Math.sqrt(K);
      const H_avail = (D + augAdd(y.row, deg, aug1, aug2)) * I.dod;
      const J = H_avail / (I.reqP / I.effDis + sys.P_dis_sys);
      const Kc = H_avail / ((I.reqP * I.effChg - sys.P_chg_sys) * Math.sqrt(K));
      const L = sys.P_dis_sys;
      const Mout = H_avail * I.effDis * I.cable;
      const Nin = H_avail / (K * I.cable * I.effChg);
      const O = (Mout - sys.P_dis_sys * sys.t_dis) / (Nin + sys.E_cycle_sys - sys.P_dis_sys * sys.t_dis);
      const Pno = K * I.effChg * I.effDis * I.cable * I.cable;
      return { row: y.row, label: y.label, H, K, C, D, srcFallback,
        aug1: aug1[y.row] || 0, aug2: aug2[y.row] || 0,
        H_avail, I: I.epoc, J, Kc, L, Mout, Nin, O, Pno };
    });
    return { rows, sys };
  }

  // ---- 派生量 ----
  function derive(V, inputs, aux) {
    const I = inputs;
    I.nom = I.containerCount * I.perContainer;
    I.acTotalPower = I.mvSkidCap * I.skidCount;
    const a0 = algo(aux.r, aux.T, aux.mode, aux.rest, aux.N, V, aux);
    I.auxDCunit = a0.avgMW;
    I.auxDC = I.auxDCunit * I.containerCount;
    const pac = acAuxPowers(V, I, aux);
    I.auxAC = pac.chg;
  }

  // ---- RTE Stack 五因子损失分解 (命名节能因子) ----
  // 输入: 计算表某一行 row(含 K/O/Nin) + inputs(含 effChg/effDis/cable) + 系统级单循环辅耗 E_cycle_sys(MWh)
  // 输出: 7 段(占 1 的比例) —— kept(O) + dc/chg/dis/cable/aux/other, 满足 Σ = 1
  //   f_dc    = 1 - K                      电池本体 DC 往返损失
  //   f_chg   = K·(1 - η_chg)              充电链(PCS 整流 + AC/DC)
  //   f_dis   = K·η_chg·(1 - η_dis)        放电链(PCS 逆变 + DC/AC)
  //   f_cable = K·η_chg·η_dis·(1 - η_cable²) 电缆(充+放各一次)
  //   f_aux   = Pno · (E_cycle/(Nin+E_cycle))  辅耗(摊薄到往返, GB/T 站用电率口径)
  //   f_other = (1 - O) - Σ(前5)            残差(引擎 ±P_dis·t_dis 离散修正 + 相位非对称)
  function decomposeLoss(row, inputs, E_cycle_sys) {
    const K = row.K;
    const ec = inputs.effChg, ed = inputs.effDis, cb = inputs.cable;
    const Pno = K * ec * ed * cb * cb;          // 无辅耗往返效率 (与 P 列同式)
    const f_dc    = 1 - K;
    const f_chg   = K * (1 - ec);
    const f_dis   = K * ec * (1 - ed);
    const f_cable = K * ec * ed * (1 - cb * cb);
    const aux_rel = E_cycle_sys / (row.Nin + E_cycle_sys);   // = 站用电率(GB/T)
    const f_aux   = Pno * aux_rel;
    const O = row.O;
    const named = f_dc + f_chg + f_dis + f_cable + f_aux;      // = 1 - O_model
    const residual = (1 - O) - named;
    // 容差: 极小浮点残差不截断，避免 Σ 偏离 1；仅当残差显著为负时截断
    const f_other = Math.abs(residual) < 1e-12 ? residual : Math.max(0, residual);
    return {
      O: O, Pno: Pno,
      dc: f_dc, chg: f_chg, dis: f_dis, cable: f_cable,
      aux: f_aux, other: f_other,
      aux_rel: aux_rel,
      kept: O,
      effChg: ec, effDis: ed, cableEff: cb, dcRte: K
    };
  }

  // 便捷: 直接吃 state 计算首行(Year0) 分解
  function lossFactors(V, inputs, aux, deg, aug1, aug2, sohSrc, simOut, rowIdx) {
    const tbl = computeTable(V, inputs, aux, deg, aug1, aug2, sohSrc, simOut || null);
    const sys = tbl.sys;
    const ri = (rowIdx != null) ? rowIdx : 0;
    const row = tbl.rows[ri] || tbl.rows[0];
    return Object.assign({ row: row.row, label: row.label }, decomposeLoss(row, inputs, sys.E_cycle_sys));
  }

  // ---- 格式化 ----
  function fmt(x, d) {
    d = d || 2;
    return (x == null || isNaN(x)) ? "—" : Number(x).toFixed(d);
  }
  function fmtPct(x, d) {
    d = d || 2;
    return (x == null || isNaN(x)) ? "—" : (Number(x) * 100).toFixed(d) + "%";
  }

  // ---- 便捷: 从 V12 数据源创建完整 state ----
  function createState(V, overrides) {
    overrides = overrides || {};
    return {
      inputs: Object.assign({}, V.inputs, overrides.inputs || {}),
      aux: Object.assign(
        { coolStrategy: V.coolStrategy || "adaptive", tailCoolFrac: V.tailCoolFrac != null ? V.tailCoolFrac : 0.30 },
        V.auxDefault,
        overrides.aux || {}
      ),
      deg: (overrides.deg || V.degRows).map(d => ({ row: d.row, label: d.label, H: d.H, K: d.K })),
      aug1: Object.assign({}, overrides.aug1 || V.augDefault),
      aug2: Object.assign({}, overrides.aug2 || {}),
      links: Object.assign({}, overrides.links || V.linksDefault || { power: true, energy: true }),
      sohSrc: overrides.sohSrc || "raw"
    };
  }

  // ---- 一键计算: createState + derive + computeTable ----
  function calc(V, overrides, simOut) {
    const state = createState(V, overrides);
    derive(V, state.inputs, state.aux);
    return computeTable(V, state.inputs, state.aux, state.deg, state.aug1, state.aug2, state.sohSrc, simOut || null);
  }

  // ---- 导出 ----
  const API = {
    tiRow, riMat, algo,
    acMatrixValue, acAuxPowers, computeAux,
    augAdd, computeTable, derive,
    decomposeLoss, lossFactors,
    fmt, fmtPct,
    createState, calc
  };

  // UMD: 浏览器 + Node.js 双环境
  if (typeof window !== "undefined") {
    window.BESS_ENGINE = API;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})();
