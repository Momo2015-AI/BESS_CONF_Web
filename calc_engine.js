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
  // auxRatio（aux.auxRatio，缺省 1.0）= 「辅耗比例调节」总开关，唯一生效点在这里。
  // 约定：等比缩放【全部】系统级辅耗量 —— 功率 P_*_sys 与单循环电量 E_cycle_sys 同步缩放。
  //   · 只缩 E_cycle_sys 而不缩 P_dis_sys 会导致 auxRatio→0 时 O ≠ Pno（口径分叉），故必须同步。
  //   · 严禁在引擎外部（_calc.js / web/app.js / _sim_workflow.js）二次缩放 sys.E_cycle_sys，
  //     否则 O 列（含辅耗往返效率）拿不到缩放值 → 滑块「拉了没反应」的历史 bug。
  //   · 原始未缩放值保留在 E_cycle_sys_raw / P_*_sys_raw，供审计与 UI 对照。
  function computeAux(V, inputs, aux) {
    const a = algo(aux.r, aux.T, aux.mode, aux.rest, aux.N, V, aux);
    const nC = inputs.containerCount;
    const pac = acAuxPowers(V, inputs, aux);
    const ratio = (typeof aux.auxRatio === "number" && isFinite(aux.auxRatio) && aux.auxRatio >= 0)
      ? aux.auxRatio : 1;
    const P_chg_raw   = pac.chg  + nC * a.pChg   / 1000;
    const P_dis_raw   = pac.dis  + nC * a.pDis   / 1000;
    const P_tailC_raw = pac.tail + nC * a.pTailC / 1000;
    const P_tailD_raw = pac.tail + nC * a.pTailD / 1000;
    const P_stby_raw  = pac.stby + nC * a.ps     / 1000;
    const E_raw = nC * a.Eaux / 1000
      + pac.chg * a.tAct + pac.tail * a.tTail + pac.stby * a.t3
      + pac.dis * a.tAct + pac.tail * a.tTail + pac.stby * a.t6;
    return Object.assign({}, a, {
      nC, pac,
      auxRatio: ratio,
      P_chg_sys:   P_chg_raw   * ratio,
      P_dis_sys:   P_dis_raw   * ratio,
      P_tailC_sys: P_tailC_raw * ratio,
      P_tailD_sys: P_tailD_raw * ratio,
      P_stby_sys:  P_stby_raw  * ratio,
      P_chg_sys_raw: P_chg_raw, P_dis_sys_raw: P_dis_raw,
      P_tailC_sys_raw: P_tailC_raw, P_tailD_sys_raw: P_tailD_raw,
      P_stby_sys_raw: P_stby_raw,
      t_dis: a.tAct,
      E_cycle_sys_raw: E_raw,
      E_cycle_sys: E_raw * ratio
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
        // FAT=出厂新电池(H=1.0)；SAT=投运首年，SOH 必须取衰减源 Y0（soh[0]）。
        // 【契约】G6 双验用同一 soh[0] 复算 AC 可用——SAT 行不得引入 soh[0] 之外的
        // 魔法数（曾硬编码 0.9925，恰与金基准衰减文件同值才未被 G6 暴露；换衰减
        // 源后 G6 会以 ~0.75% 偏差误拦正确结果）。无 sim 输入时保留 degRows 表内值。
        if (y.row === 3) {
          H = 1.0; // FAT = 出厂新电池
          if (simR != null) K = simR;
        } else if (y.row === 4) {
          if (SIM.soh && SIM.soh[0] != null) H = SIM.soh[0];
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
    // 单箱容量优先从产品目录 V 读取；兼容旧 V12（未升级目录时回退 inputs.perContainer）
    const epc = (V && V.energyPerContainerMWh != null)
      ? V.energyPerContainerMWh : (I.perContainer != null ? I.perContainer : 5);
    I.nom = I.containerCount * epc;
    I.acTotalPower = I.mvSkidCap * I.skidCount;
    const ratio = (typeof aux.auxRatio === "number" && isFinite(aux.auxRatio) && aux.auxRatio >= 0)
      ? aux.auxRatio : 1;
    const a0 = algo(aux.r, aux.T, aux.mode, aux.rest, aux.N, V, aux);
    // 与 computeAux 同口径缩放，避免摘要卡片(auxDC/auxAC)与年度表(E_cycle_sys)脱节
    I.auxDCunit = a0.avgMW * ratio;
    I.auxDC = I.auxDCunit * I.containerCount;
    const pac = acAuxPowers(V, I, aux);
    I.auxAC = pac.chg * ratio;
    I.auxRatio = ratio;
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

  // ---- 回归守卫: auxRatio 必须真正贯通到 O 列 ------------------------------
  // 历史 bug：auxRatio 只在引擎【外部】缩放 E_cycle_sys，导致 O(含辅耗) 纹丝不动。
  // 本守卫在每次运行时用 3 个比例跑一遍，任一恒等式/单调性破坏立即抛错。
  //   ① ratio=0  ⇒ O == Pno（无辅耗时含/不含辅耗效率必须重合）
  //   ② O 随 ratio 单调递减：O(0) > O(0.5) > O(1)
  //   ③ Pno 与 ratio 无关（Pno 定义上不含辅耗）
  //   ④ E_cycle_sys(0.5) == 0.5 × E_cycle_sys(1)
  function selftestAuxRatio(V) {
    const run = (ratio) => {
      const st = createState(V, { aux: { auxRatio: ratio } });
      derive(V, st.inputs, st.aux);
      return computeTable(V, st.inputs, st.aux, st.deg, st.aug1, st.aug2, "raw", null);
    };
    const t0 = run(0), th = run(0.5), t1 = run(1);
    const i = Math.min(1, t1.rows.length - 1);          // SAT (Year0) 行
    const O0 = t0.rows[i].O, Oh = th.rows[i].O, O1 = t1.rows[i].O;
    const Pno0 = t0.rows[i].Pno, Pno1 = t1.rows[i].Pno;
    const err = (m) => { throw new Error("[calc_engine] auxRatio 守卫失败: " + m); };
    if (!(Math.abs(O0 - Pno0) < 1e-9))
      err(`ratio=0 时 O(${O0.toFixed(6)}) ≠ Pno(${Pno0.toFixed(6)})，辅耗未被完整缩放`);
    if (!(O1 < Oh && Oh < O0))
      err(`O 对 auxRatio 非单调: O(0)=${O0.toFixed(6)} O(0.5)=${Oh.toFixed(6)} O(1)=${O1.toFixed(6)}`);
    if (Math.abs(Pno0 - Pno1) > 1e-12)
      err("Pno 不应随 auxRatio 变化（其定义不含辅耗）");
    if (Math.abs(th.sys.E_cycle_sys - 0.5 * t1.sys.E_cycle_sys) > 1e-9)
      err("E_cycle_sys 未按 auxRatio 线性缩放");
    return true;
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
    createState, calc,
    selftestAuxRatio
  };

  // UMD: 浏览器 + Node.js 双环境
  if (typeof window !== "undefined") {
    window.BESS_ENGINE = API;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
})();
