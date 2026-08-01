/* =========================================================================
 * 储能BESS配置器 — 计算引擎 + 渲染 (app.js)
 * 通用版本，无项目专属文案/图标/下拉。
 * 纯前端、无构建、file:// 双击即用。
 * ========================================================================= */
	(function () {
	  "use strict";
	  const V = window.V12;
	  const ENG = window.BESS_ENGINE;
	  if (!ENG) { console.error("BESS_ENGINE 未加载，请确认 calc_engine.js 存在"); }

  /* ---------------- SVG 图标库（线条风格, 1.75px, 24×24 viewBox） ---------------- */
  const ICONS = {
    chev:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    link:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07.07l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.07-.07l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>',
    unlink:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.84 12.61a4 4 0 0 0-5.66-5.66l-1.41 1.41"/><path d="M5.16 11.39a4 4 0 0 0 5.66 5.66l1.41-1.41"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
    check:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.51-7.12"/><polyline points="21 3 21 9 15 9"/></svg>'
  };


	  /* ---------------- 状态 ---------------- */
	  const state = {
	    inputs: Object.assign({}, V.inputs),
	    aux: Object.assign({ coolStrategy: V.coolStrategy || "adaptive", tailCoolFrac: V.tailCoolFrac != null ? V.tailCoolFrac : 0.30 }, V.auxDefault),
	    deg: V.degRows.map(d => ({ row: d.row, label: d.label, H: d.H, K: d.K })),
	    aug1: Object.assign({}, V.augDefault), // {row: MWh}
	    aug2: {},
	    links: Object.assign({}, V.linksDefault), // AC↔DC 联动开关
	    sohSrc: "raw" // "raw"=用原始衰减表 / "sim"=用仿真输出(__SIMOUT)
	  };
  // 派生量(运行时计算)
  state.inputs.auxAC = 0; state.inputs.nom = 0;
  state.inputs.auxDCunit = 0; state.inputs.auxDC = 0;
  state.inputs.acTotalPower = 0;

	  /* ---------------- 计算引擎 (委托给 BESS_ENGINE) ---------------- */
	  // tiRow / riMat / algo / acMatrixValue / acAuxPowers / computeAux / augAdd / computeTable / derive
	  // 均由 calc_engine.js 提供，此处通过 ENG.xxx 调用，保持与 state 的绑定

	  function tiRow(row, T) { return ENG.tiRow(row, T, V.Tgrid); }
	  function riMat(mat, T, r) { return ENG.riMat(mat, T, r, V.Tgrid, V.Rgrid); }
	  function algo(r, T, mode, restOverride, N) { return ENG.algo(r, T, mode, restOverride, N, V, state.aux); }
	  function acMatrixValue(key, T, r) { return ENG.acMatrixValue(key, T, r, V, state.inputs); }
	  function acAuxPowers() { return ENG.acAuxPowers(V, state.inputs, state.aux); }
	  function computeAux() { return ENG.computeAux(V, state.inputs, state.aux); }
	  function augAdd(currentRow) { return ENG.augAdd(currentRow, state.deg, state.aug1, state.aug2); }
	  function computeTable() {
	    return ENG.computeTable(V, state.inputs, state.aux, state.deg, state.aug1, state.aug2, state.sohSrc,
	      (state.sohSrc === "sim" && window.__SIMOUT) ? window.__SIMOUT : null);
	  }
	  function derive() { ENG.derive(V, state.inputs, state.aux); }

  /* ---------------- 格式化 ---------------- */
  const fmt = (x, d = 2) => (x == null || isNaN(x)) ? "—" : Number(x).toFixed(d);
  const fmtPct = (x, d = 2) => (x == null || isNaN(x)) ? "—" : (Number(x) * 100).toFixed(d) + "%";

  /* ---------------- DOM 工具 ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------------- 输入参数页 Schema ---------------- */
  const inputGroups = [
    { title: "AC 侧 / 并网侧参数", en: "Grid / PoC side", fields: [
      { k: "powerPoC", cn: "并网点保证功率", en: "Power at PoC", unit: "MW", edit: true, link: "power", note: "↔ DC 需求功率" },
      { k: "epoc", cn: "并网点保证容量", en: "Energy at PoC", unit: "MWh", edit: true, link: "energy", note: "O 列引用 · ↔ DC 需求容量" },
      { k: "effChg", cn: "充电单程效率", en: "AC eff - Charge", unit: "%", edit: true, pct: true },
      { k: "effDis", cn: "放电单程效率", en: "AC eff - Discharge", unit: "%", edit: true, pct: true },
      { k: "acTotalPower", cn: "AC 侧总功率 (MV 额定和)", en: "AC total power", unit: "MW", derive: "acTotalPower", note: "= MV 单台×数量" },
      { k: "acAuxNoLoad", cn: "单台 SKID 空载损耗", en: "AC no-load / SKID", unit: "MW", edit: true, note: "系统空载 = 该值 × SKID 数" },
      { k: "acAuxLoadPct", cn: "AC 负载损耗", en: "AC load loss", unit: "%", edit: true, pct: true, note: "占电网功率比" },
      { k: "auxAC", cn: "系统交流辅耗(活跃)", en: "AC Aux (active)", unit: "MW", derive: "auxAC", note: "= 空载+负载%×功率" },
      { k: "powerFactor", cn: "功率因数", en: "Power Factor", unit: "%", edit: true, pct: true },
      { k: "acContainerSize", cn: "AC 集装箱尺寸", en: "AC container size", unit: "ft", edit: true },
      { k: "mvSkidCap", cn: "MV SKID 单台容量", en: "MV SKID capacity", unit: "MW", edit: true },
      { k: "skidCount", cn: "MV 升压变数量", en: "MV SKID count", unit: "Set", edit: true }
    ]},
    { title: "DC 侧 / 电池侧参数", en: "Battery / DC side", fields: [
      { k: "reqP", cn: "直流侧需求功率", en: "Required power @DC", unit: "MW", edit: true, link: "power", note: "J/K 引用 · ↔ AC 保证功率" },
      { k: "reqEnergyDC", cn: "直流侧需求容量", en: "Required energy @DC", unit: "MWh", edit: true, link: "energy", note: "↔ AC 保证容量" },
      { k: "rteOverride", cn: "直流往返效率 RTE (全局覆盖)", en: "DC-RTE override", unit: "%", edit: true, pct: true, allowEmpty: true, note: "留空=用衰减表逐年 K" },
      { k: "dod", cn: "放电深度 DOD", en: "Depth of discharge", unit: "%", edit: true, pct: true, note: "影响可用直流电量" },
      { k: "cable", cn: "直流电缆效率", en: "Cables efficiency (DC)", unit: "%", edit: true, pct: true },
      { k: "nom", cn: "铭牌装机容量", en: "Nominal installed energy", unit: "MWh", derive: "nom", note: "= 数量×单箱 (D18)" },
      { k: "containerCount", cn: "电池集装箱数量", en: "No. of container", unit: "Set", edit: true },
      { k: "perContainer", cn: "单箱容量", en: "Energy per container", unit: "MWh", edit: true },
      { k: "auxDCunit", cn: "单箱辅耗 (实测环均)", en: "DC Aux per container", unit: "MW", derive: "auxDCunit", note: "= 辅耗页算法 (D21)" },
      { k: "auxDC", cn: "系统直流辅耗合计", en: "DC Aux total", unit: "MW", derive: "auxDC", note: "= 单箱×数量 (D22)" }
    ]}
  ];

  function renderInputs() {
    const page = $("page-inputs");
    page.innerHTML = "";
    inputGroups.forEach(g => {
      const card = el("div", "section-card");
      const head = el("div", "section-head");
      head.appendChild(el("span", "sh-dot"));
      head.appendChild(el("h2", null, g.title));
      head.appendChild(el("span", "sh-en", g.en));
      card.appendChild(head);
      const body = el("div", "section-body");
      const grid = el("div", "form-grid");
      g.fields.forEach(f => {
        const field = el("div", "field" + (f.edit || f.link ? "" : " locked") + (f.link ? " linked-field" : ""));
        const lab = el("label");
        lab.appendChild(el("span", null, f.cn));
        lab.appendChild(el("span", "f-unit", f.unit));
        field.appendChild(lab);
        // 英文名一行；联动字段在同一行右侧放锁链开关
        if (f.link) {
          const enRow = el("div", "f-en-row");
          enRow.appendChild(el("span", "f-en", f.en));
          const chip = el("button", "link-toggle");
          chip.type = "button";
          chip.dataset.pair = f.link;
          chip.addEventListener("click", () => toggleLink(f.link));
          enRow.appendChild(chip);
          field.appendChild(enRow);
        } else {
          field.appendChild(el("div", "f-en", f.en));
        }
        let input;
        if (f.derive) {
          input = el("input"); input.readOnly = true; input.id = "inp-" + f.k;
        } else if (f.edit) {
          input = el("input"); input.type = "number"; input.step = "any"; input.id = "inp-" + f.k;
          input.value = (f.allowEmpty && state.inputs[f.k] === "") ? "" : (f.pct ? (state.inputs[f.k] * 100) : state.inputs[f.k]);
          input.addEventListener("input", () => {
            if (f.allowEmpty && input.value.trim() === "") { state.inputs[f.k] = ""; recalc(); return; }
            let v = parseFloat(input.value);
            if (isNaN(v)) return;
            state.inputs[f.k] = f.pct ? v / 100 : v;
            if (f.link) syncLink(f.link, f.k, state.inputs[f.k]);
            recalc();
          });
        } else {
          input = el("input"); input.readOnly = true;
          input.value = f.pct ? (state.inputs[f.k] * 100) : state.inputs[f.k];
        }
        field.appendChild(input);
        if (f.note) field.appendChild(el("div", "f-derive", f.note));
        grid.appendChild(field);
      });
      body.appendChild(grid);
      card.appendChild(body);
      page.appendChild(card);
    });
    page.appendChild(el("div", "note-bar",
      "提示：<b>AC 功率 ↔ DC 需求功率</b>、<b>AC 容量 ↔ DC 需求容量</b> 默认 1:1 联动——改一个另一个自动同步；点字段上的 <b>🔗 联动</b> 徽标可解除、独立编辑（再点恢复时以 AC 侧为准同步）。AC 侧新增 <b>总功率</b>(=MV单台×数量) 与 <b>辅耗模型</b>(空载+负载% 两系数，六步同构)；DC 侧新增 <b>RTE 全局覆盖</b>(留空=用衰减表逐年 K) 与 <b>DOD</b>(影响可用直流电量)。功率因数 / 集装箱尺寸 / SKID 容量为登记项；派生项（AC Aux、铭牌、单箱辅耗）随输入自动联动。"));
    ["power", "energy"].forEach(refreshLinkChips);
  }

  /* ---------------- AC↔DC 联动 ---------------- */
  function syncLink(pair, changedKey, value) {
    if (!state.links[pair]) return;
    const [a, b] = V.linkPairs[pair];
    const other = changedKey === a ? b : a;
    state.inputs[other] = value;           // 1:1 同步 (两对均非百分比)
    const oe = $("inp-" + other);
    if (oe) oe.value = value;
  }
  function toggleLink(pair) {
    state.links[pair] = !state.links[pair];
    if (state.links[pair]) {
      // 恢复联动: 以 AC 侧(主字段)为准同步 DC 侧
      const [a, b] = V.linkPairs[pair];
      state.inputs[b] = state.inputs[a];
      const be = $("inp-" + b); if (be) be.value = state.inputs[b];
    }
    refreshLinkChips(pair);
    recalc();
  }
  function refreshLinkChips(pair) {
    const on = state.links[pair];
    document.querySelectorAll('.link-toggle[data-pair="' + pair + '"]').forEach(c => {
      c.classList.toggle("on", on);
      c.classList.toggle("off", !on);
      c.innerHTML = (on ? ICONS.link : ICONS.unlink) + '<span class="link-toggle-text">' + (on ? "联动" : "独立") + "</span>";
      c.title = on
        ? "已联动 AC↔DC：改任一个另一个同步。点击解除，可独立编辑"
        : "已独立：两侧各填各的。点击恢复联动（DC 将同步为 AC 值）";
    });
    // 联动态下给字段一个轻标记
    document.querySelectorAll('.linked-field').forEach(fd => {
      const chip = fd.querySelector('.link-toggle');
      if (chip && chip.dataset.pair === pair) fd.classList.toggle("is-linked", on);
    });
  }
  function updateInputsDerived() {
    $("inp-auxAC").value = fmt(state.inputs.auxAC, 4);
    $("inp-nom").value = fmt(state.inputs.nom, 1);
    $("inp-auxDCunit").value = fmt(state.inputs.auxDCunit, 4);
    $("inp-auxDC").value = fmt(state.inputs.auxDC, 4);
    const acT = $("inp-acTotalPower"); if (acT) acT.value = fmt(state.inputs.acTotalPower, 1);
  }

  /* ---------------- 功率矩阵表 (DC / AC 同构) ---------------- */
  function buildMatrixCard(title, en, keys, valueFn, interpFn, idp) {
    const mcard = el("div", "section-card");
    const mhead = el("div", "section-head");
    mhead.appendChild(el("span", "sh-dot"));
    mhead.appendChild(el("h2", null, title));
    mhead.appendChild(el("span", "sh-en", en));
    mcard.appendChild(mhead);
    const mbody = el("div", "section-body");
    keys.forEach(([title, key]) => {
      const wrap = el("div", "tbl-wrap"); wrap.style.marginBottom = "14px";
      const t = el("table", "tbl matrix");
      const thead = el("thead"); const htr = el("tr");
      [title + " \\ T→", ...V.Tgrid.map(tt => tt + "℃"), "当前工况"].forEach((h, idx) => {
        const th = el("th"); th.innerHTML = idx === 0 ? h : (h.includes("℃") ? h.split("℃")[0] + '<span class="th-en">℃</span>' : h);
        if (idx === 0) th.className = "yearcol";
        htr.appendChild(th);
      });
      thead.appendChild(htr); t.appendChild(thead);
      const tb = el("tbody");
      V.Rgrid.forEach((r, ri) => {
        const tr = el("tr");
        tr.appendChild(el("td", "yearcol tnum", String(r)));
        V.Tgrid.forEach((tv, ci) => {
          tr.appendChild(el("td", "num", fmt(valueFn(key, ri, ci), 2)));
        });
        const tdi = el("td", "num interp", fmt(interpFn(key), 2));
        tdi.id = idp + "-" + key; tr.appendChild(tdi);
        tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t); mbody.appendChild(wrap);
    });
    mcard.appendChild(mbody);
    return mcard;
  }

  /* ---------------- 辅耗模型页 ---------------- */
  function renderAux() {
    const page = $("page-aux");
    page.innerHTML = "";
    // 输入区
    const card = el("div", "section-card");
    const head = el("div", "section-head");
    head.appendChild(el("span", "sh-dot"));
    head.appendChild(el("h2", null, "工况输入 · Duty Inputs"));
    head.appendChild(el("span", "sh-en", "rate / temperature / standby / cycles"));
    card.appendChild(head);
    const body = el("div", "section-body");
    const grid = el("div", "form-grid");

    /* 自建下拉组件 (替代 datalist: 各浏览器对 <input list> 的弹出行为不一致, 自建 100% 可控) */
    const makeDropdown = (id, val, opts) => {
      const wrap = el("div", "dd");
      const btn = el("button", "dd-btn"); btn.type = "button"; btn.id = id;
      const lbl = el("span", "dd-lbl", String(val));
      const chev = el("span", "dd-chev"); chev.innerHTML = ICONS.chev;
      btn.appendChild(lbl); btn.appendChild(chev);
      const menu = el("div", "dd-menu");
      const fmt = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "")) : String(v));
      opts.options.forEach(v => {
        const it = el("div", "dd-item" + (Number(v) === Number(val) ? " sel" : ""));
        it.dataset.value = String(v);
        it.textContent = fmt(v);
        it.addEventListener("click", (e) => { e.stopPropagation(); applyValue(Number(v)); hide(); });
        menu.appendChild(it);
      });
      const sep = el("div", "dd-sep"); menu.appendChild(sep);
      const custWrap = el("div", "dd-cust");
      const cust = el("input"); cust.type = "text"; cust.inputMode = "decimal"; cust.placeholder = opts.placeholder || "任意值";
      if (val != null && !opts.options.some(v => Number(v) === Number(val))) cust.value = String(val);
      cust.addEventListener("input", () => { const v = parseFloat(cust.value); if (!isNaN(v)) applyValue(v); });
      cust.addEventListener("click", (e) => e.stopPropagation());
      custWrap.appendChild(cust); menu.appendChild(custWrap);
      wrap.appendChild(btn); wrap.appendChild(menu);

      function applyValue(v) {
        state.aux[opts.key] = v;
        lbl.textContent = fmt(v);
        if (opts.options.some(x => Number(x) === Number(v))) cust.value = "";
        else cust.value = String(v);
        menu.querySelectorAll(".dd-item").forEach(it => it.classList.toggle("sel", Number(it.dataset.value) === Number(v)));
        recalc();
      }
      function positionMenu() {
        // 脱离 section-card 的 overflow:hidden, 用 fixed 定位
        const r = btn.getBoundingClientRect();
        const margin = 6;
        const vh = window.innerHeight;
        const spaceBelow = vh - r.bottom - margin;
        menu.style.position = "fixed";
        menu.style.left = r.left + "px";
        menu.style.width = r.width + "px";
        // 先用预估 maxHeight 让浏览器布局, 再读真实高度做最终决策
        const estimated = Math.min(360, vh - 16);
        menu.style.maxHeight = estimated + "px";
        const menuH = menu.offsetHeight;
        if (spaceBelow >= Math.min(menuH, 280) || spaceBelow > vh - r.top + margin) {
          menu.style.top = (r.bottom + margin) + "px";
          menu.style.bottom = "auto";
          menu.style.maxHeight = Math.min(estimated, vh - r.bottom - margin - 8) + "px";
        } else {
          menu.style.top = "auto";
          menu.style.bottom = (vh - r.top + margin) + "px";
          menu.style.maxHeight = Math.min(estimated, r.top - margin - 8) + "px";
        }
      }
      function show() { positionMenu(); menu.classList.add("open"); }
      function hide() { menu.classList.remove("open"); }
      btn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.contains("open") ? hide() : show(); });
      window.addEventListener("resize", () => { if (menu.classList.contains("open")) positionMenu(); });
      window.addEventListener("scroll", () => { if (menu.classList.contains("open")) positionMenu(); }, true);
      return wrap;
    };

    // r
    const fr = el("div", "field"); fr.appendChild(el("label", null, "<span>充放电倍率 r</span><span class='f-unit'>C-rate</span>"));
    fr.appendChild(el("div", "f-en", "0.25 / 0.33 / 0.5 或任意值"));
    fr.appendChild(makeDropdown("aux-r", state.aux.r, { key: "r", options: V.rOptions, placeholder: "任意倍率" }));
    grid.appendChild(fr);
    // T
    const ft = el("div", "field"); ft.appendChild(el("label", null, "<span>环境温度 T</span><span class='f-unit'>℃</span>"));
    ft.appendChild(el("div", "f-en", "锚点 -20/0/25/35/45 或任意值"));
    ft.appendChild(makeDropdown("aux-T", state.aux.T, { key: "T", options: V.tOptions, placeholder: "任意温度" }));
    grid.appendChild(ft);
    // mode (普通 select)
    const fm = el("div", "field"); fm.appendChild(el("label", null, "<span>待机模式</span><span class='f-unit'>kW</span>"));
    fm.appendChild(el("div", "f-en", "标准待机 / 液冷自循环"));
    const modeSel = el("select", "dd-sel"); modeSel.id = "aux-mode";
    [{v:"1.0",t:"1.0 · 标准待机"},{v:"4.2",t:"4.2 · 液冷自循环"}].forEach(o => {
      const op = el("option"); op.value = o.v; op.textContent = o.t; modeSel.appendChild(op);
    });
    modeSel.value = String(state.aux.mode);
    modeSel.addEventListener("change", () => { state.aux.mode = modeSel.value; recalc(); });
    fm.appendChild(modeSel); grid.appendChild(fm);
    // rest (普通文本输入)
    const frest = el("div", "field"); frest.appendChild(el("label", null, "<span>静置时长 (覆盖)</span><span class='f-unit'>h</span>"));
    frest.appendChild(el("div", "f-en", "留空=按 24/N 自动"));
    const rest = el("input", "dd-sel"); rest.type = "text"; rest.id = "aux-rest"; rest.value = state.aux.rest; rest.placeholder = "自动";
    rest.addEventListener("input", () => { state.aux.rest = rest.value === "" ? "" : parseFloat(rest.value); recalc(); });
    frest.appendChild(rest); grid.appendChild(frest);
	    // N
	    const fn = el("div", "field"); fn.appendChild(el("label", null, "<span>每天循环数 N</span><span class='f-unit'>/d</span>"));
	    fn.appendChild(el("div", "f-en", "上限 floor(24/2(tAct+tTail))"));
	    fn.appendChild(makeDropdown("aux-N", state.aux.N, { key: "N", options: V.nOptions, placeholder: "任意循环数" }));
	    grid.appendChild(fn);

	    // 冷尾策略
	    const fcs = el("div", "field"); fcs.appendChild(el("label", null, "<span>冷尾策略</span><span class='f-unit'>Cooling</span>"));
	    fcs.appendChild(el("div", "f-en", "continuous=全程强制 / adaptive=两阶段"));
	    const csSel = el("select", "dd-sel"); csSel.id = "aux-coolStrategy";
	    [{v:"adaptive",t:"adaptive · 两阶段(推荐)"},{v:"continuous",t:"continuous · 全程强制"}].forEach(o => {
	      const op = el("option"); op.value = o.v; op.textContent = o.t; csSel.appendChild(op);
	    });
	    csSel.value = state.aux.coolStrategy;
	    csSel.addEventListener("change", () => { state.aux.coolStrategy = csSel.value; recalc(); });
	    fcs.appendChild(csSel); grid.appendChild(fcs);

	    // 冷尾强制占比 (仅 adaptive 模式生效)
	    const ffrac = el("div", "field"); ffrac.id = "aux-frac-field"; ffrac.appendChild(el("label", null, "<span>冷尾强制占比</span><span class='f-unit'>frac</span>"));
	    ffrac.appendChild(el("div", "f-en", "强制冷却时间占比 0~1"));
	    const fracWrap = el("div", "frac-wrap");
	    const fracSlider = el("input"); fracSlider.type = "range"; fracSlider.id = "aux-tailCoolFrac";
	    fracSlider.min = "0"; fracSlider.max = "1"; fracSlider.step = "0.01"; fracSlider.value = String(state.aux.tailCoolFrac);
	    const fracVal = el("span", "frac-val", String(state.aux.tailCoolFrac));
	    fracSlider.addEventListener("input", () => {
	      const v = parseFloat(fracSlider.value);
	      state.aux.tailCoolFrac = v;
	      fracVal.textContent = v.toFixed(2);
	      recalc();
	    });
	    fracWrap.appendChild(fracSlider); fracWrap.appendChild(fracVal);
	    ffrac.appendChild(fracWrap); grid.appendChild(ffrac);

	    body.appendChild(grid); card.appendChild(body); page.appendChild(card);

    // ① 单机各阶段功耗 (DC + AC, kW/箱)
    const pcard = el("div", "section-card");
    const phead = el("div", "section-head");
    phead.appendChild(el("span", "sh-dot"));
    phead.appendChild(el("h2", null, "单机各阶段功耗 · Per-Container Stage Power"));
    phead.appendChild(el("span", "sh-en", "kW/箱 · 当前工况 r / T / N 下"));
    pcard.appendChild(phead);
    const pbody = el("div", "section-body");
    const pgrid = el("div", "percont"); pgrid.id = "percont-grid"; pbody.appendChild(pgrid);
    pcard.appendChild(pbody); page.appendChild(pcard);

    // ② 各阶段时间 & 总功耗 (DC / AC / BESS, 参数化)
    const spcard = el("div", "section-card");
    const sphead = el("div", "section-head");
    sphead.appendChild(el("span", "sh-dot"));
    sphead.appendChild(el("h2", null, "各阶段时间 & 总功耗 · Stage Time & Aux Energy"));
    sphead.appendChild(el("span", "sh-en", "时间 DC/AC 共用 · 功耗按箱数/SKID 参数化计算"));
    spcard.appendChild(sphead);
    const spbody = el("div", "section-body");
    const sptable = el("div", "tbl-wrap"); sptable.id = "stagepower-table"; spbody.appendChild(sptable);
    const sptotals = el("div", "aux-cards totals"); sptotals.id = "stagepower-totals"; spbody.appendChild(sptotals);
    spcard.appendChild(spbody); page.appendChild(spcard);

    // 系统级分相位输出卡
    const ocard = el("div", "section-card");
    const ohead = el("div", "section-head");
    ohead.appendChild(el("span", "sh-dot"));
    ohead.appendChild(el("h2", null, "系统级分相位输出"));
    ohead.appendChild(el("span", "sh-en", "各相位直流 / 交流辅耗 · 活跃 / 待机 / 冷却尾流"));
    ocard.appendChild(ohead);
    const obody = el("div", "section-body");
    const oc = el("div", "aux-cards"); oc.id = "aux-cards"; obody.appendChild(oc);
    ocard.appendChild(obody); page.appendChild(ocard);

    // 矩阵区 —— DC 实测矩阵 + AC 模型推算矩阵 (移到最下面)
    const mats = [["充电功率 chg", "chg"], ["冷却尾流(充) tailC", "tailC"], ["放电功率 dis", "dis"], ["冷却尾流(放) tailD", "tailD"]];
    page.appendChild(buildMatrixCard(
      "实测功率矩阵 · DC 侧",
      "kW/箱 · T 方向分段线性 + r 方向双线性",
      mats, (k, ri, ci) => V.M[k][ri][ci], k => riMat(V.M[k], state.aux.T, state.aux.r), "interp"));
    page.appendChild(buildMatrixCard(
      "模型推算辅耗矩阵 · AC 侧",
      "kW/箱 · 空载 + 负载% (形状随 r/T, 与 DC 同相)",
      mats, (k, ri, ci) => acMatrixValue(k, V.Tgrid[ci], V.Rgrid[ri]), k => acMatrixValue(k, state.aux.T, state.aux.r), "acinterp"));

    page.appendChild(el("div", "note-bar",
      "说明：<b>工况输入</b>的 r / T / mode / N 实时驱动下方所有卡片。<b>单机各阶段功耗</b>给出每箱（kW/箱）在六个阶段的 DC 冷却与 AC 变流器/变压器损耗。<b>各阶段时间 DC 与 AC 完全相同</b>——同一运行周期两侧测量，时间仅由 r / N 决定。<b>总功耗</b>按箱数（系统 DC = 箱数×单箱环能）与 SKID 数（AC）计算，参数化、适配任意项目规模。底层功率矩阵置于最下方供核对。"));
  }
	  function updateAux() {
	    // 冷尾策略 UI 联动
	    const csSel = $("aux-coolStrategy");
	    if (csSel && csSel.value !== state.aux.coolStrategy) csSel.value = state.aux.coolStrategy;
	    const fracField = $("aux-frac-field");
	    if (fracField) fracField.style.opacity = state.aux.coolStrategy === "adaptive" ? "1" : "0.4";
	    const fracSlider = $("aux-tailCoolFrac");
	    if (fracSlider && Math.abs(parseFloat(fracSlider.value) - state.aux.tailCoolFrac) > 0.001)
	      fracSlider.value = String(state.aux.tailCoolFrac);
	    const fracVal = document.querySelector("#aux-frac-field .frac-val");
	    if (fracVal) fracVal.textContent = state.aux.tailCoolFrac.toFixed(2);

	    // 矩阵插值列 (DC + AC)
	    ["chg", "tailC", "dis", "tailD"].forEach(key => {
	      const e = $("interp-" + key); if (e) e.textContent = fmt(riMat(V.M[key], state.aux.T, state.aux.r), 2);
	      const a = $("acinterp-" + key); if (a) a.textContent = fmt(acMatrixValue(key, state.aux.T, state.aux.r), 2);
	    });
    const sys = computeAux();
    const nC = sys.nC;
    const acPC = (k) => acMatrixValue(k, state.aux.T, state.aux.r); // 每箱 kW

    // 系统级分相位卡 (保持)
    const oc = $("aux-cards");
    if (oc) {
	      const cards = [
	        { cls: "chg", label: "充电相位 P_chg_sys", val: sys.P_chg_sys, unit: "MW" },
	        { cls: "dis", label: "放电相位 P_dis_sys", val: sys.P_dis_sys, unit: "MW" },
	        { cls: "", label: "充冷尾 P_tailC_sys", val: sys.P_tailC_sys, unit: "MW" },
	        { cls: "", label: "放冷尾 P_tailD_sys", val: sys.P_tailD_sys, unit: "MW" },
	        { cls: "stby", label: "待机相位 P_stby_sys", val: sys.P_stby_sys, unit: "MW" },
	        { cls: "", label: "AC 辅耗(充/放) Pac", val: sys.pac.chg, unit: "MW" },
	        { cls: "stby", label: "AC 辅耗(待机) Pac", val: sys.pac.stby, unit: "MW" },
	        { cls: "", label: "放电时长 t_dis", val: sys.t_dis, unit: "h" },
	        { cls: "", label: "冷尾策略", val: sys.strategy || state.aux.coolStrategy, unit: "" },
	        { cls: "", label: "单箱充冷尾能耗", val: sys.eTailC, unit: "kWh" },
	        { cls: "", label: "单箱放冷尾能耗", val: sys.eTailD, unit: "kWh" },
	        { cls: "", label: "单循环总辅电 E_aux", val: sys.Eaux, unit: "kWh" },
	        { cls: "", label: "整循环辅耗 E_cycle_sys", val: sys.E_cycle_sys, unit: "MWh" }
	      ];
      oc.innerHTML = cards.map(c =>
        `<div class="aux-card ${c.cls}"><div class="ac-label">${c.label}</div><div class="ac-val">${fmt(c.val, c.unit === "MW" ? 4 : 2)}<small> ${c.unit}</small></div></div>`
      ).join("");
    }

    // ① 单机各阶段功耗 (kW/箱): DC + AC
    const pg = $("percont-grid");
    if (pg) {
      const rows = [
        { cls: "chg",  stage: "充电",       dc: sys.pChg,   ac: acPC("chg") },
        { cls: "",     stage: "充冷尾",     dc: sys.pTailC, ac: acPC("tailC") },
        { cls: "stby", stage: "静置(充后)", dc: sys.ps,     ac: acPC("tailC") },
        { cls: "dis",  stage: "放电",       dc: sys.pDis,   ac: acPC("dis") },
        { cls: "",     stage: "放冷尾",     dc: sys.pTailD, ac: acPC("tailD") },
        { cls: "stby", stage: "静置(放后)", dc: sys.ps,     ac: acPC("tailC") }
      ];
      pg.innerHTML =
        `<div class="pc-row pc-h"><span class="pc-stage">阶段</span><span class="pc-dc">DC 功耗 (kW/箱)</span><span class="pc-ac">AC 功耗 (kW/箱)</span></div>` +
        rows.map(r => `<div class="pc-row ${r.cls}"><span class="pc-stage">${r.stage}</span><span class="pc-dc tnum">${fmt(r.dc, 2)}</span><span class="pc-ac tnum">${fmt(r.ac, 2)}</span></div>`).join("");
    }

    // ② 各阶段时间 + 总功耗 (DC / AC / BESS, 参数化)
    // 冷尾语义: 冷尾为时段, 强制冷却功率 pTail 恒定; 滑块(frac)控制其中强制冷却的时间占比
    // 故冷尾拆为 强制冷却 tTail·frac (功率 pTail) + 自然冷却 tTail·(1-frac) (功率 ps), 时间拆分、功率不变
    const st = $("stagepower-table");
    if (st) {
      const frac = sys.strategy === "adaptive" ? (state.aux.tailCoolFrac != null ? state.aux.tailCoolFrac : 0.30) : 1;
      const tForced = sys.tTail * frac, tFree = sys.tTail * (1 - frac);
      const stages = [
        { stage: "充电",         t: sys.tAct,  dcpw: nC * sys.pChg   / 1000, acpw: sys.pac.chg },
        { stage: "充冷尾·强制",  t: tForced,   dcpw: nC * sys.pTailC / 1000, acpw: sys.pac.tail },
        { stage: "充冷尾·自然",  t: tFree,     dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby },
        { stage: "静置(充后)",   t: sys.t3,    dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby },
        { stage: "放电",         t: sys.tAct,  dcpw: nC * sys.pDis   / 1000, acpw: sys.pac.dis },
        { stage: "放冷尾·强制",  t: tForced,   dcpw: nC * sys.pTailD / 1000, acpw: sys.pac.tail },
        { stage: "放冷尾·自然",  t: tFree,     dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby },
        { stage: "静置(放后)",   t: sys.t6,    dcpw: nC * sys.ps     / 1000, acpw: sys.pac.stby }
      ];
      let dcTot = 0, acTot = 0;
      const trs = stages.map(s => {
        const dce = s.dcpw * s.t, ace = s.acpw * s.t;
        dcTot += dce; acTot += ace;
        return `<tr><td class="yearcol">${s.stage}</td><td class="num">${fmt(s.t, 2)}</td><td class="num">${fmt(s.dcpw, 4)}</td><td class="num">${fmt(s.acpw, 4)}</td><td class="num">${fmt(dce, 4)}</td><td class="num">${fmt(ace, 4)}</td></tr>`;
      }).join("");
      st.innerHTML = `<table class="tbl matrix stage-tbl"><thead><tr><th class="yearcol">阶段</th><th>时间 (h)</th><th>DC 功率 (MW)</th><th>AC 功率 (MW)</th><th>DC 能量 (MWh)</th><th>AC 能量 (MWh)</th></tr></thead><tbody>${trs}</tbody></table>`;
      const tot = $("stagepower-totals");
      if (tot) {
        const bess = dcTot + acTot;
        tot.innerHTML =
          `<div class="aux-card dc"><div class="ac-label">DC 总功耗 / 循环</div><div class="ac-val">${fmt(dcTot, 4)}<small> MWh</small></div></div>` +
          `<div class="aux-card ac"><div class="ac-label">AC 总功耗 / 循环</div><div class="ac-val">${fmt(acTot, 4)}<small> MWh</small></div></div>` +
          `<div class="aux-card bess"><div class="ac-label">BESS 总功耗 / 循环</div><div class="ac-val">${fmt(bess, 4)}<small> MWh</small></div></div>`;
      }
    }
  }

  /* ---------------- 衰减曲线页 · 原始数据表 (仿真面板见 #sim-panel) ---------------- */
  let degTableBody = null;
  function renderDeg() {
    // V13: 顶部仿真面板(#sim-panel)为静态 HTML, 原始数据表单独渲染到 #rawdeg-container
    const container = $("rawdeg-container") || $("page-deg");
    container.innerHTML = "";
    const card = el("div", "section-card");
    const head = el("div", "section-head");
    head.appendChild(el("span", "sh-dot"));
    head.appendChild(el("h2", null, "原始数据 · 年度衰减曲线"));
    head.appendChild(el("span", "sh-en", "SOH(H) / DC-RTE(K) · V12 手动数据，可直接编辑或粘贴"));
    head.appendChild(el("span", "sh-note", "支持从 Excel 复制整列粘贴"));
    card.appendChild(head);
    const body = el("div", "section-body");
    const wrap = el("div", "tbl-wrap");
    const t = el("table", "tbl");
    const thead = el("thead"); const htr = el("tr");
    ["年份<br>Year", "SOH 衰减率 (H)", "直流往返效率 (K)"].forEach((h, i) => {
      const th = el("th", i === 0 ? "yearcol" : null, h); thead.appendChild(th);
    });
    thead.appendChild(htr); t.appendChild(thead);
    const tb = el("tbody"); degTableBody = tb;
    state.deg.forEach(y => {
      const tr = el("tr");
      tr.appendChild(el("td", "yearcol", y.label));
      const tdH = el("td"); const iH = el("input"); iH.type = "text"; iH.className = "cell-edit"; iH.value = (y.H * 100).toFixed(2);
      iH.addEventListener("input", () => { const v = parseFloat(iH.value); if (!isNaN(v)) { y.H = v / 100; recalc(); } });
      tdH.appendChild(iH); tr.appendChild(tdH);
      const tdK = el("td"); const iK = el("input"); iK.type = "text"; iK.className = "cell-edit"; iK.value = (y.K * 100).toFixed(2);
      iK.addEventListener("input", () => { const v = parseFloat(iK.value); if (!isNaN(v)) { y.K = v / 100; recalc(); } });
      tdK.appendChild(iK); tr.appendChild(tdK);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);
    card.appendChild(body); container.appendChild(card);
    container.appendChild(el("div", "note-bar",
      "提示：在任一单元格 <b>Ctrl/Cmd+V</b> 粘贴 Excel 复制的 TSV（年份列将被忽略，仅取 SOH、K 两列数值）。改动后计算表格与趋势图即时联动。下方仿真面板计算后，可点「捕获到原始数据」把曲线写入本表。"));

    // 粘贴处理
    wrap.addEventListener("paste", (ev) => {
      const txt = (ev.clipboardData || window.clipboardData).getData("text");
      if (!txt) return;
      ev.preventDefault();
      const lines = txt.trim().split(/\r?\n/).map(l => l.split(/\t/));
      let applied = 0;
      lines.forEach((cols) => {
        // 找到纯数字的列
        const nums = cols.map(c => parseFloat(String(c).replace(/%/g, ""))).filter(n => !isNaN(n));
        if (nums.length < 2) return;
        const hv = nums[0] / 100, kv = nums[1] / 100;
        // 匹配当前行(按顺序): 第 applied 个有效行
        const y = state.deg[applied];
        if (!y) return;
        y.H = hv; y.K = kv; applied++;
      });
      if (applied > 0) { renderDeg(); recalc(); }
    });
  }

  /* ---------------- 计算表格页 ---------------- */
  const calcCols = [
    { key: "label", cn: "年份", en: "Year", type: "text", cls: "yearcol" },
    { key: "H", cn: "衰减率(SOH)", en: "Degradation", type: "pct", d: 2 },
    { key: "C", cn: "初始配置@DC", en: "Initial Config", type: "num", d: 1 },
    { key: "D", cn: "最大能量@DC", en: "Max energy @DC", type: "num", d: 1 },
    { key: "K", cn: "直流往返效率", en: "DC-RTE", type: "pct", d: 2 },
    { key: "aug1", cn: "补容1@DC", en: "Augment.1", type: "edit", d: 1, map: "aug1" },
    { key: "aug2", cn: "补容2@DC", en: "Augment.2", type: "edit", d: 1, map: "aug2" },
    { key: "H_avail", cn: "补容后直流可用", en: "DC avail. after Aug", type: "num", d: 1 },
    { key: "I", cn: "可用交流能量", en: "Usable @AC", type: "num", d: 1 },
    { key: "J", cn: "放电时间", en: "Discharge Time", type: "num", d: 3 },
    { key: "Kc", cn: "充电时间", en: "Charge Time", type: "num", d: 3 },
    { key: "L", cn: "辅耗功率", en: "Aux. power", type: "num", d: 4, live: true },
    { key: "Mout", cn: "最大输出@PoC", en: "Max OUTPUT @PoC", type: "num", d: 1 },
    { key: "Nin", cn: "最大输入@PoC", en: "Max INPUT @PoC", type: "num", d: 1 },
    { key: "O", cn: "交流往返效率(含辅耗)", en: "AC-RTE w/ Aux", type: "pct", d: 2, live: true },
    { key: "Pno", cn: "交流往返效率(无辅耗)", en: "AC-RTE no Aux", type: "pct", d: 2 }
  ];
  let calcCells = {};
  function renderCalc() {
    const page = $("page-calc");
    page.innerHTML = "";
    // KPI 英雄条
    const strip = el("div", "kpi-strip");
    strip.innerHTML = `
      <div class="kpi"><div class="k-label">铭牌装机容量</div><div class="k-en">Initial Config @DC</div><div class="k-val tnum" id="kpi-nom">—<small>MWh</small></div></div>
      <div class="kpi"><div class="k-label">并网保证容量</div><div class="k-en">Usable @AC (PoC)</div><div class="k-val tnum" id="kpi-epoc">—<small>MWh</small></div></div>
      <div class="kpi k-teal"><div class="k-label">综合效率(含辅耗) 首年</div><div class="k-en">AC-RTE w/ Aux</div><div class="k-val tnum" id="kpi-O">—</div></div>
      <div class="kpi k-teal"><div class="k-label">最大输出@PoC 首年</div><div class="k-en">Max OUTPUT @PoC</div><div class="k-val tnum" id="kpi-M">—<small>MWh</small></div></div>
      <div class="kpi k-amber"><div class="k-label">整循环系统辅耗</div><div class="k-en">E_cycle_sys</div><div class="k-val tnum" id="kpi-E">—<small>MWh</small></div></div>`;
    page.appendChild(strip);

    // 衰减数据来源切换: 来自仿真 / 来自原始数据
    const togg = el("div", "src-toggle");
    const srcLabel = el("span", "src-toggle-label", "衰减数据来源");
    togg.appendChild(srcLabel);
    const mk = (val, txt) => {
      const lab = el("label", "rd" + (state.sohSrc === val ? " on" : ""));
      const inp = el("input"); inp.type = "radio"; inp.name = "sohSrc"; inp.value = val;
      inp.checked = (state.sohSrc === val);
      inp.addEventListener("change", () => { if (inp.checked) setSrc(val); });
      lab.appendChild(inp); lab.appendChild(el("span", null, txt));
      return lab;
    };
    togg.appendChild(mk("raw", "来自原始数据"));
    togg.appendChild(mk("sim", "来自仿真"));
    const srcHint = el("span", "src-toggle-hint", "");
    togg.appendChild(srcHint);
    page.appendChild(togg);

    const card = el("div", "section-card");
    const head = el("div", "section-head");
    head.appendChild(el("span", "sh-dot"));
    head.appendChild(el("h2", null, "主计算表"));
    head.appendChild(el("span", "sh-en", "全生命周期能量与效率 (GB/T 36549 综合效率口径)"));
    head.appendChild(el("span", "sh-note", "补容1/2 可编辑"));
    card.appendChild(head);
    const body = el("div", "section-body");
    const wrap = el("div", "tbl-wrap");
    const t = el("table", "tbl");
    const thead = el("thead"); const htr = el("tr");
    calcCols.forEach(c => {
      const th = el("th", c.cls || null);
      th.innerHTML = c.cn + '<span class="th-en">' + c.en + "</span>";
      htr.appendChild(th);
    });
    thead.appendChild(htr); t.appendChild(thead);
    const tb = el("tbody"); calcCells = {};
    state.deg.forEach(y => {
      const tr = el("tr");
      calcCols.forEach(c => {
        const td = el("td", (c.cls || "") + (c.live ? " live" : "") + (c.type === "num" || c.type === "pct" ? " num" : ""));
        const cid = "cc-" + y.row + "-" + c.key;
        td.id = cid; calcCells[cid] = td;
        if (c.type === "edit") {
          const inp = el("input"); inp.type = "text"; inp.className = "cell-edit"; inp.value = state[c.map][y.row] || 0;
          inp.addEventListener("input", () => { let v = parseFloat(inp.value); if (isNaN(v)) v = 0; state[c.map][y.row] = v; recalc(); });
          td.appendChild(inp);
        } else {
          td.textContent = "—";
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); body.appendChild(wrap);
    card.appendChild(body); page.appendChild(card);

    // 图表
    const chCard = el("div", "chart-card");
    chCard.innerHTML = `<h3>全生命周期趋势 · Lifecycle Trend</h3><p>直流可用容量 / 最大输出@PoC（左轴, MWh）与 综合效率（右轴, %）随年限变化</p>`;
    const box = el("div", "chart-box"); const cv = el("canvas"); cv.id = "trendChart"; box.appendChild(cv);
    chCard.appendChild(box); page.appendChild(chCard);
  }
  function updateCalc(table) {
    state.deg.forEach(y => {
      const row = table.rows.find(r => r.row === y.row);
      calcCols.forEach(c => {
        const td = calcCells["cc-" + y.row + "-" + c.key];
        if (!td) return;
        if (c.type === "edit") return; // 编辑框保留用户输入
        if (c.type === "text") { td.textContent = row[c.key]; return; }
        if (c.type === "pct") td.textContent = fmtPct(row[c.key], c.d);
        else td.textContent = fmt(row[c.key], c.d);
      });
    });
    // KPI — 取 SAT 行 (row4, Year0) 作为"投运首年"，与"首年"语义一致
    const r0 = table.rows[1] || table.rows[0];
    setKpi("kpi-nom", fmt(state.inputs.nom, 1), "MWh");
    setKpi("kpi-epoc", fmt(state.inputs.epoc, 1), "MWh");
    setKpi("kpi-O", fmtPct(r0.O, 2), "");
    setKpi("kpi-M", fmt(r0.Mout, 1), "MWh");
    setKpi("kpi-E", fmt(table.sys.E_cycle_sys, 3), "MWh");
    updateSrcHint(table);
  }
  function updateSrcHint(table) {
    const hint = document.querySelector(".src-toggle-hint");
    if (!hint) return;
    if (state.sohSrc !== "sim") { hint.textContent = "（使用 V12 原始衰减表）"; return; }
    const sim = window.__SIMOUT;
    if (!sim) { hint.textContent = "（仿真尚未计算，请先在衰减页运行一次）"; return; }
    let msg = "（仿真：" + sim.source + "）";
    const fb = table.rows.filter(r => r.srcFallback);
    if (fb.length) {
      const first = Math.min.apply(null, fb.map(r => r.row));
      const last = Math.max.apply(null, fb.map(r => r.row));
      msg += " ⚠ 仿真年限不足，第 " + (first - 4) + "~" + (last - 4) + " 年已沿用原始衰减表";
    }
    hint.textContent = msg;
  }
  function setKpi(id, val, unit) {
    const e = $(id); if (!e) return;
    e.innerHTML = val + (unit ? `<small>${unit}</small>` : "");
    e.parentElement.classList.remove("flash"); void e.parentElement.offsetWidth; e.parentElement.classList.add("flash");
  }

  let chartInst = null;
  function drawChart(table) {
    if (!window.Chart) {
      const box = document.querySelector(".chart-box");
      if (box) box.innerHTML = '<div class="empty-hint">图表库未加载（离线环境）。联网后刷新即可显示趋势图。</div>';
      return;
    }
    const labels = table.rows.map(r => r.label);
    const cap = table.rows.map(r => r.H_avail);
    const out = table.rows.map(r => r.Mout);
    const eff = table.rows.map(r => r.O * 100);
    const ctx = $("trendChart").getContext("2d");
    if (chartInst) chartInst.destroy();
    chartInst = new window.Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "直流可用容量 (MWh)", data: cap, yAxisID: "y", borderColor: "#2E6BF2", backgroundColor: "rgba(46,107,242,.10)", fill: true, tension: .3, pointRadius: 0, borderWidth: 2 },
          { label: "最大输出@PoC (MWh)", data: out, yAxisID: "y", borderColor: "#12B3A6", backgroundColor: "transparent", fill: false, tension: .3, pointRadius: 0, borderWidth: 2, borderDash: [5, 3] },
          { label: "综合效率(含辅耗) %", data: eff, yAxisID: "y1", borderColor: "#F2A33C", backgroundColor: "transparent", fill: false, tension: .3, pointRadius: 0, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { font: { family: "Plus Jakarta Sans" }, boxWidth: 14 } } },
        scales: {
          y: { position: "left", title: { display: true, text: "容量 (MWh)" }, grid: { color: "#EEF1F7" } },
          y1: { position: "right", title: { display: true, text: "效率 (%)" }, grid: { drawOnChartArea: false }, min: 70, max: 100 },
          x: { grid: { display: false } }
        }
      }
    });
  }

  /* ---------------- 公式说明页 ---------------- */
  function renderFormulas() {
    const page = $("page-formulas");
    page.innerHTML = "";
    const card = el("div", "section-card");
    const head = el("div", "section-head");
    head.appendChild(el("span", "sh-dot"));
    head.appendChild(el("h2", null, "公式说明 (活公式, 可编辑联动)"));
    head.appendChild(el("span", "sh-en", "Formula Reference"));
    card.appendChild(head);
    const body = el("div", "section-body");
    const defs = [
      ["D — 最大能量@DC", "铭牌容量按当年 SOH 与 DC-RTE 折算后的最大直流可放电量", "D = 铭牌 × SOH(H) × √(DC-RTE)", "分相位: √K 为单程效率几何均分"],
      ["H — 补容后直流可用", "原电池 + 各年补容（每笔按各自投运年龄独立衰减）", "H = D + Σ 补容ᵢ × SOHₐ × √DC-RTEₐ", "SUMPRODUCT 扫描补容列, 新电池从 SOH=1 起算"],
      ["I — 可用交流能量", "客户指定的并网侧保证容量（恒定）", "I = Energy at PoC", "合同保证值, 恒定 240 MWh"],
      ["J — 放电时间", "满功率放电小时数（分母含放电相位辅耗）", "J = H ÷ ( P@DC/η_dis + P_dis_sys )", "分相位非对称: 用放电相位辅耗"],
      ["K — 充电时间", "满功率充电小时数（分母含充电相位净功率与 √K）", "K = H ÷ ( (P@DC×η_chg − P_chg_sys) × √DC-RTE )", "分相位非对称: 用充电相位辅耗"],
      ["L — 辅耗功率(放电相位)", "系统放电相位辅耗功率（MW）", "L = P_dis_sys = Aux_AC + 箱数×P_dis/1000", "充≠放: 实测充电辅耗>放电辅耗"],
      ["M — 最大输出@PoC", "并网点最大放电出力（直流可用×放电效率×电缆效率）", "M = H × η_dis × η_cable", "放电链单程: η_dis、η_cable 各一次"],
      ["N — 最大输入@PoC", "并网点为充满所需最大输入电量", "N = H ÷ ( DC-RTE × η_cable × η_chg )", "分母用整只 K, 往返效率均摊到输入侧"],
      ["O — 交流往返效率(含辅耗)", "含全部辅耗的往返效率（分相位, 分母含待机整循环辅耗）", "O = ( M − P_dis×t_dis ) ÷ ( N + E_cycle − P_dis×t_dis )", "★ 符合 GB/T 36549 综合效率口径"],
      ["P — 交流往返效率(无辅耗)", "不含辅耗的纯往返效率", "P = DC-RTE × η_chg × η_dis × η_cable²", "电缆平方: 充、放各过一次电缆"],
      ["AC 辅耗模型", "交流侧 BOOP 损耗: 变压器铁损+控制(空载) 与 随电网功率的负载损耗", "P_ac = noLoad + load% × P_grid", "六步同构: 充/放/冷却尾=空载+负载, 静置=空载"]
    ];
    defs.forEach(d => {
      const row = el("div", "formula-row");
      row.appendChild(el("div", "fr-col", d[0]));
      const mid = el("div");
      mid.appendChild(el("div", "fr-mean", d[1]));
      mid.appendChild(el("div", "fr-note", d[3]));
      row.appendChild(mid);
      row.appendChild(el("div", "fr-formula", d[2]));
      body.appendChild(row);
    });
    card.appendChild(body); page.appendChild(card);
    page.appendChild(el("div", "note-bar",
      "辅耗六步循环（充电→充冷尾→静置→放电→放冷尾→静置）时间积分得单循环辅电；整循环辅耗 <b>E_cycle_sys</b> 含待机，进入 O 列分母。分相位建模：充电相位辅耗 ≠ 放电相位辅耗（实测）。"));
  }

  /* ---------------- 工况徽标 ---------------- */
  function updateDuty(sys) {
    $("db-r").textContent = fmt(state.aux.r, 2);
    $("db-T").textContent = fmt(state.aux.T, 0) + " ℃";
    $("db-N").textContent = fmt(state.aux.N, 0) + " /d";
    $("db-E").textContent = fmt(sys.Eaux, 0) + " kWh";
  }

  /* ---------------- 衰减数据来源切换 ---------------- */
  function setSrc(src) {
    state.sohSrc = src;
    document.querySelectorAll('input[name="sohSrc"]').forEach(r => {
      r.checked = (r.value === src);
      const lab = r.closest ? r.closest(".rd") : null;
      if (lab) lab.classList.toggle("on", r.value === src);
    });
    const hint = document.querySelector(".src-toggle-hint");
    if (hint) {
      if (src === "sim" && window.__SIMOUT) hint.textContent = "（仿真：" + window.__SIMOUT.source + "）";
      else if (src === "sim") hint.textContent = "（仿真尚未计算，请先在衰减页运行一次）";
      else hint.textContent = "（使用 V12 原始衰减表）";
    }
    recalc();
  }

  /* ---------------- 总刷新 ---------------- */
  /* ---------------- 辅耗可视化 (第6页: 全链条效率损失链 · 双向) ---------------- */
  function buildLossNode(r, label, color, big) {
    var fs = big ? 13 : 11;
    return '<g><rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="9" fill="' + color + '" fill-opacity="0.14" stroke="' + color + '" stroke-width="1.6"/>' +
      '<text x="' + (r.x + r.w / 2) + '" y="' + (r.y + r.h / 2 + (big ? 5 : 4)) + '" text-anchor="middle" font-family="var(--font-ui)" font-size="' + fs + '" font-weight="700" fill="' + color + '">' + label + '</text></g>';
  }
  function buildLossSVG(d) {
    var W = 680, yMid = d.yMid, H = 300;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="loss-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="储能全链条效率损失链">';
    // 图例
    s += '<g transform="translate(40,18)" font-size="9" fill="#334155">' +
      '<rect x="0" y="-8" width="11" height="9" rx="2" fill="#3B82F6"/><text x="15" y="0">AC 能量流</text>' +
      '<rect x="95" y="-8" width="11" height="9" rx="2" fill="#06B6D4"/><text x="110" y="0">DC 能量流</text>' +
      '<path d="M195,-8 l5,9 l5,-9 z" fill="#DC2626"/><text x="208" y="0">转换损失</text>' +
      '<path d="M270,-8 l5,9 l5,-9 z" fill="#D97706"/><text x="283" y="0">辅耗(站用电)</text></g>';
    // 流带
    d.links.forEach(function (lk) {
      var tL = yMid - lk.ha / 2, bL = yMid + lk.ha / 2, tR = yMid - lk.hb / 2, bR = yMid + lk.hb / 2, cx = (lk.x1 + lk.x2) / 2;
      s += '<path d="M' + lk.x1 + ' ' + tL + ' C' + cx + ' ' + tL + ' ' + cx + ' ' + tR + ' ' + lk.x2 + ' ' + tR +
        ' L' + lk.x2 + ' ' + bR + ' C' + cx + ' ' + bR + ' ' + cx + ' ' + bL + ' ' + lk.x1 + ' ' + bL + ' Z" ' +
        'fill="' + lk.color + '" fill-opacity="0.55" class="loss-ribbon" data-link="' + lk.key + '"/>';
    });
    // 组件节点
    d.comps.forEach(function (c) {
      var w = 34, h = 26, x = c.x - w / 2, y = yMid - h / 2;
      s += '<g class="loss-node" data-link="' + c.key + '"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="#fff" stroke="#cbd5e1" stroke-width="1.2"/>' +
        '<text x="' + c.x + '" y="' + (y + 11) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="#334155">' + c.label + '</text>' +
        '<text x="' + c.x + '" y="' + (y + 21) + '" text-anchor="middle" font-size="7.5" fill="#94a3b8">' + c.eff + '%</text></g>';
    });
    // 红色转换漏斗
    d.reds.forEach(function (r) {
      var y = yMid + 16;
      s += '<g class="loss-tri tri-red" data-link="' + r.key + '"><path d="M' + (r.x - 7) + ' ' + y + ' l7,15 l7,-15 z" fill="#DC2626"/>' +
        '<text x="' + r.x + '" y="' + (y + 27) + '" text-anchor="middle" font-size="8" font-weight="700" fill="#7f1d1d">' + r.label + '</text>' +
        '<text x="' + r.x + '" y="' + (y + 37) + '" text-anchor="middle" font-size="7.5" fill="#b91c1c">-' + r.pct + '%</text></g>';
    });
    // 琥珀辅耗漏斗
    d.ambers.forEach(function (a) {
      var y = 232;
      s += '<g class="loss-tri tri-amber" data-link="aux"><path d="M' + (a.x - 8) + ' ' + y + ' l8,17 l8,-17 z" fill="#D97706"/>' +
        '<text x="' + a.x + '" y="' + (y + 30) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="#92400e">' + a.label + '</text>' +
        '<text x="' + a.x + '" y="' + (y + 41) + '" text-anchor="middle" font-size="7.5" fill="#b9711a">' + fmt(a.E, 0) + ' kWh</text>' +
        '<text x="' + a.x + '" y="' + (y + 51) + '" text-anchor="middle" font-size="7" fill="#a9803f">' + fmt(a.P, 0) + 'kW·' + fmt(a.t, 2) + 'h</text></g>';
    });
    // 电池净入/净出
    s += '<text x="290" y="98" text-anchor="end" font-size="8" fill="#94a3b8">净入 ' + d.batIn.toFixed(1) + '%</text>';
    s += '<text x="390" y="98" text-anchor="start" font-size="8" fill="#94a3b8">净出 ' + d.batOut.toFixed(1) + '%</text>';
    // 方向箭头
    s += '<text x="170" y="62" text-anchor="middle" font-size="9" fill="#3B82F6" font-weight="700">← 充电 (电网→电池)</text>';
    s += '<text x="510" y="62" text-anchor="middle" font-size="9" fill="#06B6D4" font-weight="700">放电 (电池→电网) →</text>';
    // 电网 + 电池节点
    s += buildLossNode(d.gridL, "电网(下网)", "#2f6df0", false);
    s += buildLossNode(d.gridR, "电网(上网)", "#2f9e44", false);
    s += buildLossNode(d.batt, "电池簇 5MWh", "#7c5cff", true);
    s += '</svg>';
    return s;
  }
  function renderLoss() {
    var root = $("page-loss"); if (!root) return;
    var sys = computeAux();
    var table = computeTable();
    var r0 = table.rows[0];
    var O = r0.O, Mout = r0.Mout, Nin = r0.Nin;
    // 引擎输出为系统级 MW / MWh，转 kW / kWh 便于阅读（×1000）
    var K = 1000;
    var tact = sys.tAct, ttail = sys.tTail, tstby = sys.tRest;
    var Pchg = sys.P_chg_sys * K, Pdis = sys.P_dis_sys * K,
        Pst = sys.P_stby_sys * K;
    var Echg = Pchg * tact, Edis = Pdis * tact, Est = Pst * tstby;
    // 冷尾: 采用引擎自适应真值 (30% 强制冷却 + 70% 自然冷却), 使五阶段之和 == 单循环辅耗
    var Ect = (sys.nC * sys.eTailC / 1000 + sys.pac.tail * ttail) * K;
    var Edt = (sys.nC * sys.eTailD / 1000 + sys.pac.tail * ttail) * K;
    var Ecyc = sys.E_cycle_sys * K;

    // ---- 组件级效率 (由引擎 inputs 重构, 使桑基链乘积 == 引擎单程效率) ----
    var ec = state.inputs.effChg, ed = state.inputs.effDis, cb = state.inputs.cable;
    var eTx = 0.992, eFeed = 0.997;                 // V12 标定: 升压变 / 交流馈线
    var ePCSchg = ec / (eTx * eFeed);               // PCS 整流单程
    var ePCSdis = ed / (eTx * eFeed);               // PCS 逆变单程
    var eCable = cb;                                // 直流馈线(电缆)
    // 充电链累计占比 (相对电网输入=1)
    var m0 = 1, m1 = m0 * eTx, m2 = m1 * eFeed, m3 = m2 * ePCSchg, m4 = m3 * eCable;
    // 放电链累计占比 (相对电池直流输出=1)
    var n5 = 1 * eCable, n6 = n5 * ePCSdis, n7 = n6 * eFeed, n8 = n7 * eTx;
    var batIn = m4 * 100, batOut = n8 * 100;

    // ---- 桑基几何: 10 段流带 ----
    function mkLink(x1, x2, ma, mb, color, key) {
      return { x1: x1, x2: x2, ha: 60 * ma, hb: 60 * mb, color: color, key: key };
    }
    var links = [
      mkLink(62, 78, m0, m1, "#3B82F6", "chg"),
      mkLink(112, 133, m1, m2, "#3B82F6", "chg"),
      mkLink(167, 188, m2, m3, "#3B82F6", "chg"),
      mkLink(222, 243, m3, m4, "#06B6D4", "cable"),
      mkLink(277, 300, m4, m4, "#06B6D4", "cable"),
      mkLink(380, 403, n5, n5, "#06B6D4", "cable"),
      mkLink(437, 458, n5, n6, "#06B6D4", "cable"),
      mkLink(492, 513, n6, n7, "#3B82F6", "dis"),
      mkLink(547, 568, n7, n8, "#3B82F6", "dis"),
      mkLink(602, 618, n8, n8, "#3B82F6", "dis")
    ];
    // 8 个组件节点 (x 中心, 标签, 效率%, key)
    function mkComp(x, label, effPct, key) { return { x: x, label: label, eff: effPct, key: key }; }
    var comps = [
      mkComp(95, "升压变", (eTx * 100).toFixed(1), "chg"),
      mkComp(150, "交流馈线", (eFeed * 100).toFixed(1), "chg"),
      mkComp(205, "PCS整流", (ePCSchg * 100).toFixed(1), "chg"),
      mkComp(260, "直流馈线", (eCable * 100).toFixed(1), "cable"),
      mkComp(420, "直流馈线", (eCable * 100).toFixed(1), "cable"),
      mkComp(475, "PCS逆变", (ePCSdis * 100).toFixed(1), "dis"),
      mkComp(530, "交流馈线", (eFeed * 100).toFixed(1), "dis"),
      mkComp(585, "升压变", (eTx * 100).toFixed(1), "dis")
    ];
    // 8 个红色转换漏斗 (组件单程损失%)
    function mkRed(x, label, pct, key) { return { x: x, label: label, pct: pct, key: key }; }
    var reds = [
      mkRed(95, "升压变", ((1 - eTx) * 100).toFixed(1), "chg"),
      mkRed(150, "交流馈线", ((1 - eFeed) * 100).toFixed(1), "chg"),
      mkRed(205, "PCS整流", ((1 - ePCSchg) * 100).toFixed(1), "chg"),
      mkRed(260, "直流馈线", ((1 - eCable) * 100).toFixed(1), "cable"),
      mkRed(420, "直流馈线", ((1 - eCable) * 100).toFixed(1), "cable"),
      mkRed(475, "PCS逆变", ((1 - ePCSdis) * 100).toFixed(1), "dis"),
      mkRed(530, "交流馈线", ((1 - eFeed) * 100).toFixed(1), "dis"),
      mkRed(585, "升压变", ((1 - eTx) * 100).toFixed(1), "dis")
    ];
    // 3 个琥珀辅耗漏斗
    function mkAmber(x, label, E, P, t) { return { x: x, label: label, E: E, P: P, t: t }; }
    var ambers = [
      mkAmber(205, "充电辅耗", Echg, Pchg, tact),
      mkAmber(340, "静置待机", Est, Pst, tstby),
      mkAmber(475, "放电辅耗", Edis, Pdis, tact)
    ];
    var svg = buildLossSVG({
      gridL: { x: 18, y: 104, w: 44, h: 52 }, gridR: { x: 618, y: 104, w: 44, h: 52 },
      batt: { x: 300, y: 104, w: 80, h: 52 }, yMid: 130,
      links: links, comps: comps, reds: reds, ambers: ambers,
      batIn: batIn, batOut: batOut
    });

    // ---- 各阶段明细卡 (6) ----
    var cards = [
      { n: "充电辅耗", t: "AC·站用电", P: Pchg, tH: tact, E: Echg },
      { n: "充电冷尾", t: "AC·强制冷却(自适应)", P: Ect / ttail, tH: ttail, E: Ect },
      { n: "静置待机", t: "AC·站用电", P: Pst, tH: tstby, E: Est },
      { n: "放电辅耗", t: "AC·站用电", P: Pdis, tH: tact, E: Edis },
      { n: "放电冷尾", t: "AC·强制冷却(自适应)", P: Edt / ttail, tH: ttail, E: Edt },
      { n: "单循环辅耗", t: "Σ 合计", P: null, tH: null, E: Ecyc }
    ];
    var cardHtml = cards.map(function (c) {
      return '<div class="aux-card loss-card" data-link="aux"><div class="ac-label">' + c.n + '</div><div class="ac-sub">' + c.t + '</div>' +
        '<div class="ac-val">' + fmt(c.E, 0) + '<small> kWh</small></div>' +
        (c.P != null ? '<div class="ac-meta">' + fmt(c.P, 0) + ' kW × ' + fmt(c.tH, 2) + ' h</div>' : '<div class="ac-meta">各阶段之和</div>') + '</div>';
    }).join("");

    // ---- 国标三项 + RTE Stack 命名节能因子 (引擎真值 decomposeLoss) ----
    var unitEff = Mout / Nin * 100;
    var denom = Nin + sys.E_cycle_sys - sys.P_dis_sys * sys.t_dis;
    var stnRate = denom > 0 ? sys.E_cycle_sys / denom * 100 : 0;
    var lf = ENG.decomposeLoss(r0, state.inputs, sys.E_cycle_sys);
    var segDefs = [
      { key: "dc",    v: lf.dc,    color: "#ef4444", name: "电池 DC 往返" },
      { key: "chg",   v: lf.chg,   color: "#3B82F6", name: "充电链 η_chg" },
      { key: "dis",   v: lf.dis,   color: "#06B6D4", name: "放电链 η_dis" },
      { key: "cable", v: lf.cable, color: "#0EA5E9", name: "电缆 η_cable²" },
      { key: "aux",   v: lf.aux,   color: "#F59E0B", name: "辅耗(站用电)" },
      { key: "other", v: lf.other, color: "#475569", name: "其他/残差" }
    ];
    var segsHtml = segDefs.map(function (s) {
      var w = (s.v * 100);
      if (w < 0.05) return "";
      return '<div class="rte-seg" data-link="' + s.key + '" style="width:' + w.toFixed(3) + '%;background:' + s.color + '" title="' + s.name + '">' +
        (w > 6 ? '<span>' + s.name + ' ' + w.toFixed(1) + '%</span>' : '') + '</div>';
    }).join("");
    var stackHtml =
      '<div class="rte-stack reveal">' +
      '<div class="rte-kept" data-link="kept" style="width:' + (lf.kept * 100).toFixed(3) + '%" title="综合效率 O (含辅耗)"><span>综合效率 O ' + (lf.kept * 100).toFixed(2) + '%</span></div>' +
      segsHtml +
      '</div>' +
      '<div class="rte-legend">' +
      '<span class="rl"><i style="background:#10b981"></i>综合效率 O</span>' +
      segDefs.map(function (s) { return '<span class="rl"><i style="background:' + s.color + '"></i>' + s.name + ' ' + (s.v * 100).toFixed(2) + '%</span>'; }).join("") +
      '</div>';

    var kpiHtml = '<div class="kpi"><div class="kpi-v">' + (O * 100).toFixed(2) + '<small>%</small></div><div class="kpi-l">综合效率 (含辅耗)</div></div>' +
      '<div class="kpi"><div class="kpi-v">' + unitEff.toFixed(2) + '<small>%</small></div><div class="kpi-l">单元转换效率</div></div>' +
      '<div class="kpi"><div class="kpi-v">' + stnRate.toFixed(2) + '<small>%</small></div><div class="kpi-l">站用电率 (GB/T 36549)</div></div>' +
      '<div class="kpi"><div class="kpi-v">' + fmt(Ecyc, 0) + '<small> kWh</small></div><div class="kpi-l">单循环辅耗</div></div>';

    root.innerHTML =
      '<div class="section-head"><span class="sh-dot"></span><h2>全链条效率损失链 · 双向 Sankey</h2><span class="badge">相位口径 · 真实引擎驱动</span></div>' +
      '<div class="chart-card reveal"><div class="loss-svg-wrap">' + svg + '</div>' +
      '<div class="loss-note">中央<strong>电池簇</strong>为汇集点：左侧<strong>充电链</strong>（电网→电池）、右侧<strong>放电链</strong>（电池→电网），流带宽度 ∝ 能量。每个<strong style="color:#dc2626">红色漏斗</strong>为组件转换损失（单程 %），<strong style="color:#d97706">琥珀漏斗</strong>为站用电辅耗（AC 侧负荷，GB/T 36549 口径）。组件级效率由引擎 <code>η_chg/η_dis/η_cable</code> 重构（链乘积 = 引擎单程效率）。冷尾采用自适应策略，故五阶段之和恰等于单循环辅耗。点击下方<strong>RTE Stack</strong>任一段或桑基流带可联动高亮。随 r / T / N 实时联动。</div></div>' +
      '<div class="section-head"><span class="sh-dot"></span><h2>各阶段明细</h2></div>' +
      '<div class="aux-grid reveal">' + cardHtml + '</div>' +
      '<div class="section-head"><span class="sh-dot"></span><h2>RTE Stack · 命名节能因子（引擎真值）</h2></div>' +
      '<div class="rte-wrap reveal">' + stackHtml + '</div>' +
      '<div class="section-head"><span class="sh-dot"></span><h2>国标三项指标</h2></div>' +
      '<div class="kpi-row reveal">' + kpiHtml + '</div>';

    // ---- 联动高亮: 点击任一带 data-link 的元素, 高亮同组, 其余淡出 ----
    if (!root.dataset.wired) {
      root.addEventListener("click", function (ev) {
        var t = ev.target.closest ? ev.target.closest("[data-link]") : null;
        if (!t) return;
        var k = t.getAttribute("data-link");
        var els = root.querySelectorAll("[data-link]");
        var already = t.classList.contains("hot");
        els.forEach(function (e) { e.classList.remove("hot"); e.classList.add("dim"); });
        if (!already) {
          root.querySelectorAll('[data-link="' + k + '"]').forEach(function (e) { e.classList.add("hot"); e.classList.remove("dim"); });
        } else {
          els.forEach(function (e) { e.classList.remove("dim"); });
        }
      });
      root.dataset.wired = "1";
    }
  }

  function recalc() {
    derive();
    const table = computeTable();
    // 派生 auxDCunit/auxDC 来自系统级(单箱环均)
    state.inputs.auxDCunit = table.sys.avgMW;
    state.inputs.auxDC = table.sys.avgMW * state.inputs.containerCount;
    updateInputsDerived();
    updateAux();
    updateCalc(table);
    updateDuty(table.sys);
    drawChart(table);
    renderLoss();
  }

  /* ---------------- 导航 ---------------- */
  const pageMeta = {
    inputs:   { cn: "输入参数", en: "Base Parameters", ey: "Configuration" },
    aux:      { cn: "辅耗模型", en: "Aux Model", ey: "Auxiliary Load" },
    deg:      { cn: "衰减曲线", en: "Degradation", ey: "Degradation" },
    calc:     { cn: "计算表格", en: "System Configuration", ey: "Calculation" },
    formulas: { cn: "公式说明", en: "Formula Reference", ey: "Formulas" },
    loss:     { cn: "辅耗可视化", en: "Aux Loss Chain", ey: "Loss Chain" }
  };
  let curPage = "inputs";
  function switchPage(name) {
    curPage = name;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === name));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.dataset.page === name));
    $("pt-cn").textContent = pageMeta[name].cn;
    $("pt-en").textContent = pageMeta[name].en;
    $("pt-eyebrow").textContent = pageMeta[name].ey;
    revealPage(name);
    // 进入衰减页时, 仿真图在隐藏态被绘制过 → 强制 resize 一次, 规避 0 尺寸
    if (name === "deg" && window.__SIM && window.__SIM.resizeChart) window.__SIM.resizeChart();
  }

  /* ---------------- 复制 CSV ---------------- */
  function copyCSV() {
    const table = computeTable();
    const head = calcCols.map(c => c.cn).join(",");
    const lines = [head];
    table.rows.forEach(r => {
      lines.push(calcCols.map(c => {
        if (c.type === "text") return r[c.key];
        if (c.type === "pct") return fmt(r[c.key] * 100, c.d);
        if (c.type === "edit") return state[c.map][r.row] || 0;
        return fmt(r[c.key], c.d);
      }).join(","));
    });
    const csv = "﻿" + lines.join("\n");
    const done = () => { flashBtn("已复制 <span class='flash-check'>" + ICONS.check + "</span>"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(done).catch(() => fallbackCopy(csv, done));
    } else fallbackCopy(csv, done);
  }
  function fallbackCopy(text, done) {
    const ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    document.body.removeChild(ta);
  }
  function flashBtn(t) {
    const b = $("btnCopy"); const old = b.innerHTML; b.innerHTML = t;
    setTimeout(() => b.innerHTML = old, 1400);
  }

  /* ---------------- 恢复默认 ---------------- */
  function resetAll() {
    state.inputs = Object.assign({}, V.inputs);
    state.inputs.auxAC = 0; state.inputs.nom = 0; state.inputs.auxDCunit = 0; state.inputs.auxDC = 0;
    state.aux = Object.assign({}, V.auxDefault);
    state.deg = V.degRows.map(d => ({ row: d.row, label: d.label, H: d.H, K: d.K }));
    state.aug1 = Object.assign({}, V.augDefault); state.aug2 = {};
    state.links = Object.assign({}, V.linksDefault);
    renderAll(); recalc();
  }

  /* ---------------- 滚动入场动效 (Scroll Reveal) ---------------- */
  const REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function tagReveal() {
    document.querySelectorAll(".section-card,.kpi,.aux-card,.chart-card,.formula-row,.section-head").forEach(e => {
      if (!e.classList.contains("reveal")) e.classList.add("reveal");
    });
  }
  function revealPage(name) {
    const root = $("page-" + name); if (!root) return;
    const items = root.querySelectorAll(".reveal");
    items.forEach((e, i) => {
      if (REDUCE) { e.classList.add("in"); return; }
      e.classList.remove("in");
      setTimeout(() => e.classList.add("in"), 50 + i * 55);
    });
  }

  /* ---------------- 初始化 ---------------- */
  function renderAll() {
    renderInputs(); renderAux(); renderDeg(); renderCalc(); renderFormulas(); renderLoss();
    tagReveal();
  }

  /* ---------------- PDF 导入 & 参数确认弹窗 ---------------- */
  let extractedParams = null; // 暂存提取的参数

  function showModal(params, meta) {
    extractedParams = params;
    const grid = $("modalGrid");
    const status = $("modalStatus");

    // 状态栏
    const ready = meta?.summary?.overallReady !== false;
    status.className = "modal-status " + (ready ? "success" : "warning");
    status.innerHTML = ready
      ? `<span>✓</span> 必填参数已全部提取 (${meta?.summary?.requiredFound || 0}/${meta?.summary?.requiredTotal || 0})，请确认后计算`
      : `<span>⚠</span> 部分必填参数未提取 (${meta?.summary?.requiredFound || 0}/${meta?.summary?.requiredTotal || 0})，请手动补充: ${(meta?.summary?.requiredMissing || []).join("、")}`;

    // 参数字段定义
    const fields = [
      { key: "powerPoC", label: "并网点功率", unit: "MW", required: true },
      { key: "epoc", label: "并网点容量", unit: "MWh", required: true },
      { key: "reqP", label: "直流侧功率", unit: "MW", required: true },
      { key: "containerCount", label: "集装箱数量", unit: "台", required: true },
      { key: "perContainer", label: "单箱容量", unit: "MWh", required: true },
      { key: "effChg", label: "充电效率", unit: "%", fmt: v => (v * 100).toFixed(2) },
      { key: "effDis", label: "放电效率", unit: "%", fmt: v => (v * 100).toFixed(2) },
      { key: "cable", label: "电缆效率", unit: "%", fmt: v => (v * 100).toFixed(2) },
      { key: "dod", label: "DOD", unit: "%", fmt: v => (v * 100).toFixed(0) },
      { key: "cRate", label: "充放电倍率", unit: "C" },
      { key: "ambientTemp", label: "设计温度", unit: "℃" },
      { key: "skidCount", label: "SKID 数量", unit: "台" },
      { key: "mvSkidCap", label: "SKID 容量", unit: "MW" },
      { key: "acAuxNoLoad", label: "AC 空载损耗", unit: "kW" },
      { key: "cyclePerDay", label: "每日循环", unit: "次" },
      { key: "warrantyYears", label: "质保年限", unit: "年" }
    ];

    grid.innerHTML = fields.map(f => {
      const p = params[f.key] || {};
      const rawVal = p.value != null ? (f.fmt ? f.fmt(p.value) : String(p.value)) : "";
      const val = rawVal.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      const conf = p.confidence || 0;
      const confCls = p.status === "inferred" ? "conf-inferred"
        : conf >= 80 ? "conf-high" : conf >= 50 ? "conf-medium" : conf > 0 ? "conf-low" : "";
      const confLabel = p.status === "inferred" ? "推断"
        : conf >= 80 ? "高" : conf >= 50 ? "中" : conf > 0 ? "低" : "";
      const reqStar = f.required ? '<span style="color:#C62828">*</span>' : "";
      const sourceHtml = p.source ? ('来源: ' + String(p.source).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")) : "";

      return `<div class="modal-field ${f.key === "projectName" ? "full" : ""}">
        <label>${reqStar}${f.label}
          ${confCls ? `<span class="conf-badge ${confCls}">${confLabel} ${conf}%</span>` : ""}
          <span class="field-unit">${f.unit}</span>
        </label>
        <input type="text" data-key="${f.key}" value="${val}" placeholder="${f.required ? "必填" : "可选"}" />
        ${sourceHtml ? `<span class="field-source">${sourceHtml}</span>` : ""}
      </div>`;
    }).join("");

    $("modalParams").style.display = "flex";
  }

  function hideModal() {
    $("modalParams").style.display = "none";
    extractedParams = null;
  }

  function applyModalParams() {
    if (!extractedParams) return;
    const grid = $("modalGrid");
    const inputs = grid.querySelectorAll("input");
    const merged = {};

    inputs.forEach(inp => {
      const key = inp.dataset.key;
      const rawVal = inp.value.trim();
      if (rawVal === "") return;

      const field = ["effChg","effDis","cable","dod"].includes(key)
        ? parseFloat(rawVal) / 100  // 百分比转小数
        : parseFloat(rawVal);

      if (!isNaN(field)) merged[key] = field;
    });

    // 应用参数到 V.inputs
    const map = {
      powerPoC: "powerPoC", epoc: "epoc", reqP: "reqP",
      containerCount: "containerCount", perContainer: "perContainer",
      effChg: "effChg", effDis: "effDis", cable: "cable",
      dod: "dod", skidCount: "skidCount", mvSkidCap: "mvSkidCap"
    };

    for (const [pk, ik] of Object.entries(map)) {
      if (merged[pk] != null) {
        state.inputs[ik] = merged[pk];
        // 同步联动对侧（双向）
        for (const [pair, [a, b]] of Object.entries(V.linkPairs)) {
          if (state.links[pair]) {
            if (ik === a) state.inputs[b] = merged[pk];
            else if (ik === b) state.inputs[a] = merged[pk];
          }
        }
      }
    }

    // acAuxNoLoad: UI 是 kW, data 是 MW
    if (merged.acAuxNoLoad != null) {
      state.inputs.acAuxNoLoad = merged.acAuxNoLoad >= 0.1 ? merged.acAuxNoLoad / 1000 : merged.acAuxNoLoad;
    }
    if (merged.ambientTemp != null) {
      state.aux.T = merged.ambientTemp;
      // 温度单向联动: 同步回衰减仿真面板"运行温度 ctemp", 保证两处一致
      const ce = $("ctemp"); if (ce) ce.value = String(merged.ambientTemp);
    }
    if (merged.cRate != null) state.aux.r = merged.cRate;
    if (merged.cyclePerDay != null) state.aux.N = Math.round(merged.cyclePerDay);

    hideModal();
    renderAll();
    recalc();
    revealPage("inputs");
    switchPage("inputs");
  }

  function handlePDFImport() {
    const fileInput = $("pdfFileInput");
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // 显示加载状态
      const status = $("modalStatus");
      $("modalParams").style.display = "flex";
      $("modalGrid").innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted)">⏳ 正在解析 PDF，请稍候...</div>';
      status.className = "modal-status";
      status.innerHTML = "⏳ 正在提取参数...";

      try {
        // 使用 pdf-parse 库 (需要 CDN 或本地引入)
        // 浏览器端: 使用 pdfjs-dist 或发送到后端
        // 这里使用内置的 FileReader + 简单文本匹配作为轻量方案
        const arrayBuffer = await file.arrayBuffer();

        // 尝试使用 pdfjs-dist (如果已加载)
        let text = "";
        if (window.pdfjsLib) {
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const pages = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map(item => item.str).join(" "));
          }
          text = pages.join("\n");
        } else {
          status.className = "modal-status warning";
          status.innerHTML = "⚠ PDF 解析库未加载，请手动引入 pdfjs-dist 后再试，或手动输入参数";
          $("modalGrid").innerHTML = "";
          fileInput.value = "";
          return;
        }

        // 使用简单的浏览器端正则提取 (复用 pdf_extract.js 的规则逻辑)
        const params = extractParamsFromText(text);
        const summary = summarizeExtraction(params);

        showModal(params, { summary: summary });

      } catch (err) {
        status.className = "modal-status error";
        status.innerHTML = `✗ PDF 解析失败: ${err.message}<br><small>请尝试使用文本格式的 PDF，或手动输入参数</small>`;
        $("modalGrid").innerHTML = "";
      }

      // 重置 file input
      fileInput.value = "";
    };
    fileInput.click();
  }

  // ---- 浏览器端简化参数提取 (复用 pdf_extract.js 规则) ----
  function extractParamsFromText(text) {
    const rules = [
      { name: "powerPoC", patterns: [/并网[点侧]*[保证额定]*功率[：:=\s]*(\d+\.?\d*)\s*(MW|kW|GW)/i, /(\d+\.?\d*)\s*MW[^hH]/] },
      { name: "epoc", patterns: [/并网[点侧]*[保证额定]*容量[：:=\s]*(\d+\.?\d*)\s*(MWh|kWh|GWh)/i, /(\d+\.?\d*)\s*MWh/] },
      { name: "reqP", patterns: [/直流[侧]*[需求额定]*功率[：:=\s]*(\d+\.?\d*)\s*(MW|kW)/i] },
      { name: "containerCount", patterns: [/集装箱[数]*量[：:=\s]*(\d+)\s*(台|套|个)?/, /(\d+)\s*台[^，,]*集装箱/, /(\d+)\s*(台|套).*电池/] },
      { name: "perContainer", patterns: [/单[台箱].*容量[：:=\s]*(\d+\.?\d*)\s*(MWh|kWh)/i, /(\d+)\s*MWh[^，,\n]*[箱舱]/] },
      { name: "effChg", patterns: [/充电[单程]*效率[：:=\s]*(\d+\.?\d*)\s*%?/i, /充电.*?(\d{2}\.?\d*)\s*%/] },
      { name: "effDis", patterns: [/放电[单程]*效率[：:=\s]*(\d+\.?\d*)\s*%?/i, /放电.*?(\d{2}\.?\d*)\s*%/] },
      { name: "cable", patterns: [/[直流]*电缆效率[：:=\s]*(\d+\.?\d*)\s*%?/i] },
      { name: "dod", patterns: [/DOD[：:=\s]*(\d+\.?\d*)\s*%?/i, /放电深度[：:=\s]*(\d+\.?\d*)\s*%?/] },
      { name: "cRate", patterns: [/充放电倍率[：:=\s]*(\d+\.?\d*)\s*C/i, /([0-9]\.[0-9]+)\s*C/] },
      { name: "ambientTemp", patterns: [/环境温度[：:=\s]*(-?\d+\.?\d*)\s*[°℃]/, /运行温度[：:=\s]*(-?\d+\.?\d*)\s*[°℃]/] },
      { name: "skidCount", patterns: [/SKID[数量]*[：:=\s]*(\d+)/i, /升压变[数量]*[：:=\s]*(\d+)/] },
      { name: "mvSkidCap", patterns: [/SKID.*容量[：:=\s]*(\d+\.?\d*)\s*(MW|kW)/i, /单台.*SKID[^\d]*(\d+\.?\d*)\s*(MW|kW)/i] },
      { name: "acAuxNoLoad", patterns: [/空载损耗[：:=\s]*(\d+\.?\d*)\s*(kW|MW)/i] },
      { name: "cyclePerDay", patterns: [/每日.*?(\d+)\s*[次个].*循环/, /[天日]循环[：:=\s]*(\d+)\s*次/] },
      { name: "warrantyYears", patterns: [/质保[期年限]*[：:=\s]*(\d+)\s*年/] },
      { name: "projectName", patterns: [/项目名称[：:=\s]*[「"']?([^「"'\n]{2,40})/] },
      { name: "customerName", patterns: [/客户[名称]*[：:=\s]*[「"']?([^「"'\n]{2,30})/] }
    ];

    const results = {};
    for (const rule of rules) {
      let bestVal = null, bestConf = 0, bestSrc = "";
      for (let pi = 0; pi < rule.patterns.length; pi++) {
        const m = text.match(rule.patterns[pi]);
        if (m) {
          const rawVal = m[1];
          let numVal = parseFloat(rawVal.replace(/[,，]/g, ""));
          if (isNaN(numVal)) {
            // 字符串类型
            bestVal = rawVal.trim();
            bestConf = 80;
            bestSrc = m[0].substring(0, 60).trim();
            break;
          }
          // 百分比转换
          if (["effChg","effDis","cable","dod"].includes(rule.name) && numVal > 1) numVal /= 100;
          const conf = 50 + (1 - pi / rule.patterns.length) * 45;
          if (conf > bestConf) {
            bestVal = numVal;
            bestConf = Math.round(conf);
            bestSrc = m[0].substring(0, 60).trim();
          }
        }
      }
      results[rule.name] = {
        value: bestVal,
        confidence: bestConf,
        status: bestConf >= 80 ? "high" : bestConf >= 50 ? "medium" : bestConf > 0 ? "low" : "not_found",
        source: bestSrc
      };
    }

    // 推断: reqP = powerPoC
    if (!results.reqP.value && results.powerPoC.value) {
      results.reqP = { value: results.powerPoC.value, confidence: 60, status: "inferred", source: "推断: reqP = powerPoC" };
    }

    return results;
  }

  function summarizeExtraction(params) {
    const required = ["powerPoC","epoc","reqP","containerCount","perContainer"];
    const found = required.filter(k => params[k] && params[k].status === "high" || params[k] && params[k].status === "medium");
    const missing = required.filter(k => !params[k] || params[k].status === "low" || params[k].status === "not_found");
    return {
      requiredFound: found.length, requiredTotal: required.length,
      requiredMissing: missing.map(k => {
        const labels = { powerPoC:"并网点功率", epoc:"并网点容量", reqP:"直流侧功率", containerCount:"集装箱数量", perContainer:"单箱容量" };
        return labels[k] || k;
      }),
      overallReady: missing.length === 0
    };
  }

  // ---- 导出报告 (浏览器端) ----
  function handleExportReport() {
    // 浏览器端无法直接调用 Node.js 的 docx/exceljs
    // 策略: 收集当前参数和计算结果, 触发下载 JSON+CSV
    const sys = computeAux();
    const tableResult = computeTable();
    const params = {};

    // 收集当前参数
    const paramKeys = ["powerPoC","epoc","reqP","containerCount","perContainer",
      "effChg","effDis","cable","dod","skidCount","mvSkidCap","acAuxNoLoad"];
    for (const k of paramKeys) {
      const v = state.inputs[k];
      params[k] = { value: v, confidence: 100, status: "manual" };
    }
    params.ambientTemp = { value: state.aux.T, confidence: 100, status: "manual" };
    params.cRate = { value: state.aux.r, confidence: 100, status: "manual" };
    params.cyclePerDay = { value: state.aux.N, confidence: 100, status: "manual" };
    params.projectName = { value: "BESS配置方案" };

    // 同时尝试下载 CSV 版本的计算表
    const csvHeader = "行,年份,SOH,RTE,额定容量,直流可用,补容后可用,J放电持续,Kc充电持续,Mout,Nin,O全站RTE,Pno";
    const csvRows = tableResult.rows.map(r =>
      [r.row, r.label, r.H, r.K, r.C, r.D, r.H_avail, r.J, r.Kc, r.Mout, r.Nin, r.O, r.Pno].join(",")
    );
    const csvContent = "\uFEFF" + csvHeader + "\n" + csvRows.join("\n");

    // 下载 CSV
    const csvBlob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvA = document.createElement("a");
    csvA.href = csvUrl; csvA.download = "BESS_计算表.csv";
    csvA.click();
    URL.revokeObjectURL(csvUrl);

    // 下载参数 JSON (供 CLI 报告生成器使用)
    const jsonBlob = new Blob([JSON.stringify({ params: params, meta: { file: "手动导出" } }, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonA = document.createElement("a");
    jsonA.href = jsonUrl; jsonA.download = "BESS_params.json";
    jsonA.click();
    URL.revokeObjectURL(jsonUrl);

    // 提示
    alert("已下载:\n• BESS_计算表.csv — 全站配置计算表\n• BESS_params.json — 参数文件");
  }

  function init() {
    document.documentElement.classList.add("anim");   // 仅在 JS 可用时启用入场动画, 默认内容可见
    renderAll();
    recalc();
    revealPage("inputs");
    // 安全网: 任何情况下 1.5s 后强制显示所有 reveal, 杜绝内容被门控隐藏
    setTimeout(() => document.querySelectorAll(".reveal:not(.in)").forEach(e => e.classList.add("in")), 1500);
    document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => switchPage(b.dataset.page)));
    $("btnReset").addEventListener("click", () => { resetAll(); revealPage(curPage); });
    $("btnCopy").addEventListener("click", copyCSV);
    // PDF 导入 & 报告导出
    $("btnImportPDF").addEventListener("click", handlePDFImport);
    $("btnExportReport").addEventListener("click", handleExportReport);
    // 弹窗事件
    $("modalClose").addEventListener("click", hideModal);
    $("modalCancel").addEventListener("click", hideModal);
    $("modalConfirm").addEventListener("click", applyModalParams);
    // 点击遮罩关闭
    $("modalParams").addEventListener("click", (e) => { if (e.target === $("modalParams")) hideModal(); });
    // 自建下拉: 点击外部关闭
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".dd-menu.open").forEach(m => {
        if (!m.parentNode.contains(e.target)) m.classList.remove("open");
      });
    });
    // Esc 关闭下拉
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".dd-menu.open").forEach(m => m.classList.remove("open"));
    });
    // 暴露给挂载的仿真器 (sim.js): 捕获到原始数据 / 来源切换 / 重算
    window.__V12 = { state: state, renderDeg: renderDeg, recalc: recalc, setSrc: setSrc };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
