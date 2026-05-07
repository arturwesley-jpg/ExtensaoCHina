// src/content-scripts/modules/import_calc/core.js
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const engine = globalThis.__xh_import_calc_engine;
  if (!engine) return;

  const VENDOR_PANEL_ID = "__xh_quality_panel__";
  const PRICE_BADGE_SEL = 'span[data-xh_brl="1"]';
  const CALC_BTN_ATTR = "data-xh-calc-btn";

  const ITEM_TYPES = [
    { value: "geral", label: "Sem bateria (roupa, acessorio...)" },
    { value: "eletronico", label: "Com bateria (celular, tablet...)" },
  ];

  const CFG = {
    PANEL_ID: "__xh_import_calc_panel__",
    STYLE_ID: "__xh_import_calc_style__",
    UI_STATE_KEY: "xh_import_calc_ui_state",
    PREFS_KEY: "xh_import_calc_prefs",
    RATES_CACHE_KEY: "xh_shipping_rates_v2",
    REMOTE_CONFIG_KEY: "xh_remote_config_v1",
    PANEL_GAP: 8,
    defaultPanelLeftPx: 12,
    zIndex: 2147483644,
    debounceMs: 250,
  };

  const { asString, toFiniteNumber, round2, createEl, formatConvertedAmount } = globalThis.XHContentUtils;

  function bootstrap({ runtime, moduleId, defaultEnabled }) {
    const activeSite = siteManager.resolveActive(location.hostname);
    if (!activeSite) return;

    let stopped = false;
    let collapsed = true;
    let shippingData = null;
    let priceRates = null;
    let debounceTimer = null;
    let vendorObserver = null;
    let badgeObserver = null;

    let showTotal = true;
    let panel = null;
    let resultsEl = null;
    let toggleEl = null;
    let inputPriceEl = null;
    let selectTypeEl = null;
    let inputWeightEl = null;
    let inputDeclaredEl = null;
    let selectUfEl = null;

    let stopWatchingModule = () => {};

    // ── Vendor panel ──

    function getVendorPanel() { return document.getElementById(VENDOR_PANEL_ID); }

    function repositionPanel() {
      if (!panel) return;
      const v = getVendorPanel();
      panel.style.top = v ? (v.getBoundingClientRect().bottom + CFG.PANEL_GAP) + "px" : "100px";
    }

    function collapseVendorPanel() {
      const v = getVendorPanel();
      if (v && v.getAttribute("data-collapsed") !== "1") {
        v.setAttribute("data-collapsed", "1");
        chrome.storage.local.set({ xh_quality_panel_ui_state: { collapsed: true } }).catch(() => {});
      }
    }

    function watchVendorPanel() {
      const v = getVendorPanel();
      if (!v) { setTimeout(() => { if (!stopped) watchVendorPanel(); }, 500); return; }
      vendorObserver = new MutationObserver(() => {
        if (v.getAttribute("data-collapsed") === "0" && !collapsed) {
          collapsed = true;
          panel?.setAttribute("data-collapsed", "1");
          saveUiState({ collapsed: true });
        }
        repositionPanel();
      });
      vendorObserver.observe(v, { attributes: true, attributeFilter: ["data-collapsed"] });
      repositionPanel();
    }

    // ── Price buttons (next to price_brl badges) ──

    function sendPriceToCalc(cny) {
      if (!inputPriceEl) return;
      inputPriceEl.value = cny;
      inputPriceEl.style.background = "#fef9c3";
      setTimeout(() => { inputPriceEl.style.background = ""; }, 600);
      if (collapsed) toggleCollapse();
      else scheduleRecalc();
    }

    function extractCnyFromBadgeParent(badge) {
      const parent = badge.parentElement;
      if (!parent) return 0;
      let text = "";
      for (const node of parent.childNodes) {
        if (node === badge || node.hasAttribute?.(CALC_BTN_ATTR)) continue;
        if (node.nodeType === 3) text += node.textContent;
        else if (!node.hasAttribute?.("data-xh_brl")) text += node.textContent || "";
      }
      const match = text.match(/[\u00a5\uffe5]?\s*(\d[\d,]*(?:\.\d{1,2})?)/);
      if (!match) return 0;
      const num = parseFloat(match[1].replace(/,/g, ""));
      return Number.isFinite(num) && num >= 1 ? num : 0;
    }

    function createCalcButton(cnyValue) {
      const btn = document.createElement("span");
      btn.setAttribute(CALC_BTN_ATTR, "1");
      btn.title = `Enviar \u00a5${cnyValue} para calculadora`;
      btn.textContent = "\u2192";
      btn.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;" +
        "width:18px;height:18px;margin-left:4px;border-radius:50%;" +
        "font-size:10px;font-weight:700;color:#fff;background:#6366f1;" +
        "cursor:pointer;vertical-align:middle;user-select:none;" +
        "box-shadow:0 1px 3px rgba(0,0,0,.15);transition:transform .12s;" +
        "line-height:1;";
      btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.2)"; });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
      btn.addEventListener("click", (e) => {
        e.stopPropagation(); e.preventDefault();
        sendPriceToCalc(cnyValue);
      });
      return btn;
    }

    function injectCalcButtons() {
      const badges = document.querySelectorAll(PRICE_BADGE_SEL);
      for (const badge of badges) {
        if (badge.nextElementSibling?.hasAttribute(CALC_BTN_ATTR)) continue;
        if (badge.parentElement?.querySelector(`[${CALC_BTN_ATTR}]`)) continue;
        const cny = extractCnyFromBadgeParent(badge);
        if (cny <= 0) continue;
        badge.insertAdjacentElement("afterend", createCalcButton(cny));
      }
    }

    function watchForBadges() {
      injectCalcButtons();
      badgeObserver = new MutationObserver(() => { if (!stopped) injectCalcButtons(); });
      badgeObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ── Helpers ──

    function getUsdToBrl() {
      if (!priceRates) return 5.5;
      const brl = Number(priceRates.BRL) || 0.77;
      const usd = Number(priceRates.USD) || 0.14;
      return usd > 0 ? round2(brl / usd) : 5.5;
    }

    function getCnyToBrl() {
      return priceRates ? (Number(priceRates.BRL) || 0.77) : 0.77;
    }

    function fmtBrl(v) { return formatConvertedAmount(v, "BRL"); }

    function fmtPrazo(p) {
      if (!Array.isArray(p) || p.length < 2) return "";
      const a = Number(p[0]) || 0, b = Number(p[1]) || 0;
      return (a > 0 && b > 0) ? `${a}-${b} dias` : "";
    }

    // ── Data ──

    async function loadShippingData() {
      try {
        const d = await chrome.storage.local.get(CFG.RATES_CACHE_KEY);
        shippingData = d?.[CFG.RATES_CACHE_KEY] || null;
      } catch { shippingData = null; }
      if (!shippingData?.frete) {
        try {
          const res = await chrome.runtime.sendMessage({ type: "XH_GET_SHIPPING_RATES" });
          if (res?.ok && Array.isArray(res.frete)) shippingData = res;
        } catch {}
      }
    }

    async function loadPriceRates() {
      try {
        const d = await chrome.storage.local.get(CFG.REMOTE_CONFIG_KEY);
        priceRates = d?.[CFG.REMOTE_CONFIG_KEY]?.default_price_rates || null;
      } catch { priceRates = null; }
    }

    async function loadPrefs() {
      try { const d = await chrome.storage.sync.get(CFG.PREFS_KEY); return d?.[CFG.PREFS_KEY] || {}; }
      catch { return {}; }
    }
    async function savePrefs(patch) {
      try { const c = await loadPrefs(); await chrome.storage.sync.set({ [CFG.PREFS_KEY]: { ...c, ...patch } }); }
      catch {}
    }
    async function loadUiState() {
      try { const d = await chrome.storage.local.get(CFG.UI_STATE_KEY); return d?.[CFG.UI_STATE_KEY] || {}; }
      catch { return {}; }
    }
    async function saveUiState(patch) {
      try { const c = await loadUiState(); await chrome.storage.local.set({ [CFG.UI_STATE_KEY]: { ...c, ...patch } }); }
      catch {}
    }

    // ── Calculation + Results ──

    function recalc() {
      if (!resultsEl) return;
      resultsEl.innerHTML = "";

      if (!shippingData?.frete?.length) {
        resultsEl.appendChild(createEl("div", "xc-empty", "Carregando taxas..."));
        loadShippingData().then(() => { if (shippingData?.frete) recalc(); });
        return;
      }

      const priceCny = Number(inputPriceEl?.value) || 0;
      const weightG = Number(inputWeightEl?.value) || 0;
      const declaredUsd = Number(inputDeclaredEl?.value) || 0;
      const uf = selectUfEl?.value || "SC";
      const itemType = selectTypeEl?.value || "geral";

      if (priceCny <= 0) {
        resultsEl.appendChild(createEl("div", "xc-empty", "Clique \u2192 ao lado de um preco convertido."));
        return;
      }
      if (weightG <= 0 || declaredUsd <= 0) {
        resultsEl.appendChild(createEl("div", "xc-empty", "Preencha peso e valor declarado."));
        return;
      }

      const icmsEntry = (shippingData.icms || []).find((e) => e.uf === uf);
      const icmsRate = icmsEntry ? Number(icmsEntry.aliquota) : 0.17;
      const iiRate = Number(shippingData.ii_aliquota) || 0.60;
      const productBrl = round2(priceCny * getCnyToBrl());

      const results = engine.calcAllLines({
        productPriceBrl: productBrl,
        declaredValueUsd: declaredUsd,
        weightG,
        usdToBrl: getUsdToBrl(),
        icmsRate,
        iiRate,
        lines: shippingData.frete,
        agentFilter: activeSite.agentFilter || null,
        categoryFilter: itemType,
      });

      if (results.length === 0) {
        resultsEl.appendChild(createEl("div", "xc-empty", "Nenhum frete para esse tipo/peso."));
        return;
      }

      // Group results by agent
      const groups = {};
      for (const r of results) {
        if (!groups[r.agente]) groups[r.agente] = [];
        groups[r.agente].push(r);
      }

      const displayVal = (r) => showTotal ? r.totalCostBrl : round2(r.freightBrl + r.totalImpostos);
      const bestVal = displayVal(results[0]);

      for (const [agente, lines] of Object.entries(groups)) {
        const section = createEl("div", "xc-ag");
        const agentBest = lines[0];

        // Agent header
        const head = createEl("div", "xc-ag-head");
        head.appendChild(createEl("span", "xc-ag-arrow", "\u25BC"));
        head.appendChild(createEl("span", "xc-ag-name", agente.toUpperCase()));
        head.appendChild(createEl("span", "xc-ag-from", `${fmtBrl(displayVal(agentBest))}`));
        section.appendChild(head);

        const body = createEl("div", "xc-ag-body");

        for (const r of lines) {
          const val = displayVal(r);
          const isBest = val === bestVal;
          const row = createEl("div", "xc-ln" + (isBest ? " xc-best" : ""));

          // Compact row: nome + prazo + value
          const compact = createEl("div", "xc-ln-c");
          compact.appendChild(createEl("span", "xc-ln-nome", r.nome));
          const prazo = fmtPrazo(r.prazo);
          if (prazo) compact.appendChild(createEl("span", "xc-ln-prazo", prazo));
          compact.appendChild(createEl("span", "xc-ln-total" + (isBest ? " xc-ln-best" : ""), fmtBrl(val)));
          row.appendChild(compact);

          // Detail (hidden)
          const detail = createEl("div", "xc-ln-detail");
          detail.appendChild(brkRow("Produto", fmtBrl(r.productPriceBrl)));
          detail.appendChild(brkRow("Frete", fmtBrl(r.freightBrl)));
          detail.appendChild(brkRow("Impostos (II+ICMS)", fmtBrl(r.totalImpostos)));
          row.appendChild(detail);

          row.addEventListener("click", (e) => {
            e.stopPropagation();
            const open = row.classList.contains("xc-expanded");
            row.classList.toggle("xc-expanded", !open);
          });

          body.appendChild(row);
        }

        section.appendChild(body);

        head.addEventListener("click", () => {
          const open = !section.classList.contains("xc-ag-closed");
          section.classList.toggle("xc-ag-closed", open);
        });

        resultsEl.appendChild(section);
      }

      savePrefs({ uf, weight: weightG, declared: declaredUsd, itemType });
    }

    function brkRow(label, value) {
      const row = createEl("div", "xc-brk");
      row.appendChild(createEl("span", "xc-brk-l", label));
      row.appendChild(createEl("span", "xc-brk-v", value));
      return row;
    }

    function scheduleRecalc() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recalc, CFG.debounceMs);
    }

    // ── UI ──

    function ensureStyle() {
      if (document.getElementById(CFG.STYLE_ID)) return;
      const s = document.createElement("style");
      s.id = CFG.STYLE_ID;
      s.textContent = buildCss();
      document.documentElement.appendChild(s);
    }

    function buildCss() {
      const P = `#${CFG.PANEL_ID}`;
      return `
${P}{position:fixed;left:12px;top:100px;width:min(230px,calc(100vw-16px));max-height:75vh;z-index:${CFG.zIndex};border-radius:10px;border:1px solid #dbe2ec;background:#fff;box-shadow:0 8px 24px rgba(2,6,23,.13);color:#0f172a;font-family:"Segoe UI",Tahoma,Arial,sans-serif;font-size:11px;transition:all .18s ease;user-select:none;overflow:hidden;}
${P}[data-collapsed="1"]{width:fit-content;max-height:none;border-radius:999px;border:1px solid rgba(0,0,0,.10);background:rgba(255,255,255,.88);box-shadow:0 6px 16px rgba(0,0,0,.10);backdrop-filter:blur(10px);overflow:visible;}
${P} .xc-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #ecf1f7;cursor:pointer;}
${P} .xc-head:hover{background:#f8fafc;}
${P}[data-collapsed="1"] .xc-head{padding:4px 8px;gap:5px;border-bottom:0;justify-content:center;}
${P} .xc-dot{width:6px;height:6px;min-width:6px;border-radius:50%;background:rgba(96,210,140,.95);box-shadow:0 0 0 1px rgba(0,0,0,.2),0 0 8px rgba(96,210,140,.3);animation:xc_p 1.8s ease-in-out infinite alternate;}
${P}[data-collapsed="1"] .xc-dot{background:rgba(255,77,79,.95);box-shadow:0 0 0 1px rgba(0,0,0,.2),0 0 8px rgba(255,77,79,.25);}
@keyframes xc_p{0%{transform:scale(.86);opacity:.65}100%{transform:scale(1);opacity:1}}
${P} .xc-title{margin:0;font-size:11px;font-weight:700;color:#0f172a;}
${P}[data-collapsed="1"] .xc-title{font:700 9px/1 "Segoe UI",system-ui,sans-serif;color:rgba(11,16,32,.88);}
${P} .xc-body{display:flex;flex-direction:column;gap:4px;padding:4px 8px 8px;max-height:calc(75vh-32px);overflow-y:auto;}
${P}[data-collapsed="1"] .xc-body{display:none;}
${P} .xc-inputs{display:grid;grid-template-columns:auto 1fr;gap:3px 6px;align-items:center;}
${P} .xc-inputs label{font-size:10px;font-weight:600;color:#475467;white-space:nowrap;}
${P} .xc-inputs input,${P} .xc-inputs select{padding:3px 5px;border:1px solid #d0d5dd;border-radius:4px;font-size:11px;background:#fff;color:#0f172a;outline:none;font-family:inherit;min-width:0;transition:background .3s;}
${P} .xc-inputs input:focus,${P} .xc-inputs select:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.12);}
${P} .xc-sep{height:1px;background:#e2e8f0;margin:3px 0;}
${P} .xc-toggle{display:flex;border-radius:4px;overflow:hidden;border:1px solid #d0d5dd;margin-bottom:4px;}
${P} .xc-toggle-btn{flex:1;text-align:center;padding:2px 0;font-size:9px;font-weight:600;color:#64748b;cursor:pointer;background:#f8fafc;transition:all .12s;user-select:none;}
${P} .xc-toggle-btn:hover{background:#f1f5f9;}
${P} .xc-toggle-btn.xc-toggle-active{background:#6366f1;color:#fff;}
${P} .xc-toggle-btn+.xc-toggle-btn{border-left:1px solid #d0d5dd;}
${P} .xc-empty{font-size:10px;color:#94a3b8;text-align:center;padding:4px 0;}
${P} .xc-ag{margin-bottom:4px;}
${P} .xc-ag-head{display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:5px;background:#f1f5f9;cursor:pointer;user-select:none;}
${P} .xc-ag-head:hover{background:#e2e8f0;}
${P} .xc-ag-arrow{font-size:8px;color:#64748b;transition:transform .15s;}
${P} .xc-ag-closed .xc-ag-arrow{transform:rotate(-90deg);}
${P} .xc-ag-name{font-size:10px;font-weight:800;color:#334155;flex:1;}
${P} .xc-ag-from{font-size:9px;color:#64748b;white-space:nowrap;}
${P} .xc-ag-body{padding-top:2px;}
${P} .xc-ag-closed .xc-ag-body{display:none;}
${P} .xc-ln{padding:3px 6px;border-radius:4px;cursor:pointer;transition:background .1s;}
${P} .xc-ln:hover{background:#f8fafc;}
${P} .xc-ln.xc-best{background:#f0fdf4;}
${P} .xc-ln.xc-best:hover{background:#ecfdf5;}
${P} .xc-ln-c{display:flex;align-items:center;gap:4px;}
${P} .xc-ln-nome{font-size:10px;font-weight:600;color:#334155;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
${P} .xc-ln-prazo{font-size:8px;color:#94a3b8;white-space:nowrap;}
${P} .xc-ln-total{font-size:10px;font-weight:700;color:#0f172a;white-space:nowrap;}
${P} .xc-ln-total.xc-ln-best{color:#166534;}
${P} .xc-ln-detail{display:none;padding:3px 0 2px;margin-top:2px;border-top:1px dashed #e2e8f0;}
${P} .xc-ln.xc-expanded .xc-ln-detail{display:block;}
${P} .xc-ln.xc-expanded{background:#f8fafc;border-radius:6px;}
${P} .xc-brk{display:flex;justify-content:space-between;font-size:9px;padding:0 0 1px;}
${P} .xc-brk-l{color:#64748b;}
${P} .xc-brk-v{color:#334155;font-weight:500;}
@media(max-height:600px){${P}{max-height:55vh;}}
`;
    }

    function buildPanel(prefs) {
      panel = createEl("aside");
      panel.id = CFG.PANEL_ID;
      panel.setAttribute("data-collapsed", collapsed ? "1" : "0");

      const head = createEl("div", "xc-head");
      head.appendChild(createEl("span", "xc-dot"));
      head.appendChild(createEl("span", "xc-title", "Calculadora"));
      head.addEventListener("click", toggleCollapse);
      panel.appendChild(head);

      const body = createEl("div", "xc-body");
      const inputs = createEl("div", "xc-inputs");

      inputs.appendChild(mkLabel("Preco \u00a5"));
      inputPriceEl = mkInput("number", "");
      inputPriceEl.addEventListener("input", scheduleRecalc);
      inputs.appendChild(inputPriceEl);

      inputs.appendChild(mkLabel("Tipo"));
      selectTypeEl = document.createElement("select");
      for (const t of ITEM_TYPES) {
        const o = document.createElement("option");
        o.value = t.value; o.textContent = t.label;
        if (t.value === (prefs.itemType || "geral")) o.selected = true;
        selectTypeEl.appendChild(o);
      }
      selectTypeEl.addEventListener("change", scheduleRecalc);
      inputs.appendChild(selectTypeEl);

      inputs.appendChild(mkLabel("Peso (g)"));
      inputWeightEl = mkInput("number", "");
      inputWeightEl.value = prefs.weight || 500;
      inputWeightEl.addEventListener("input", scheduleRecalc);
      inputs.appendChild(inputWeightEl);

      inputs.appendChild(mkLabel("Declarar US$"));
      inputDeclaredEl = mkInput("number", "");
      inputDeclaredEl.value = prefs.declared || 15;
      inputDeclaredEl.addEventListener("input", scheduleRecalc);
      inputs.appendChild(inputDeclaredEl);

      inputs.appendChild(mkLabel("Estado"));
      selectUfEl = document.createElement("select");
      populateUf(selectUfEl, prefs.uf || "SC");
      selectUfEl.addEventListener("change", scheduleRecalc);
      inputs.appendChild(selectUfEl);

      body.appendChild(inputs);
      body.appendChild(createEl("div", "xc-sep"));

      // Toggle: Frete+Imp. | Total
      toggleEl = createEl("div", "xc-toggle");
      const btnCusto = createEl("span", "xc-toggle-btn", "Frete+Imp.");
      const btnTotal = createEl("span", "xc-toggle-btn xc-toggle-active", "Total");
      btnCusto.addEventListener("click", () => { if (showTotal) { showTotal = false; btnTotal.classList.remove("xc-toggle-active"); btnCusto.classList.add("xc-toggle-active"); savePrefs({ showTotal: false }); scheduleRecalc(); } });
      btnTotal.addEventListener("click", () => { if (!showTotal) { showTotal = true; btnCusto.classList.remove("xc-toggle-active"); btnTotal.classList.add("xc-toggle-active"); savePrefs({ showTotal: true }); scheduleRecalc(); } });
      toggleEl.appendChild(btnCusto);
      toggleEl.appendChild(btnTotal);
      if (prefs.showTotal === false) { showTotal = false; btnTotal.classList.remove("xc-toggle-active"); btnCusto.classList.add("xc-toggle-active"); }
      body.appendChild(toggleEl);

      resultsEl = createEl("div", "xc-results");
      body.appendChild(resultsEl);
      panel.appendChild(body);

      document.documentElement.appendChild(panel);
      repositionPanel();
    }

    function mkLabel(t) { const l = document.createElement("label"); l.textContent = t; return l; }
    function mkInput(type, ph) {
      const i = document.createElement("input");
      i.type = type; i.placeholder = ph; i.step = "any"; i.min = "0";
      return i;
    }

    function populateUf(sel, selected) {
      const list = shippingData?.icms || [];
      if (list.length > 0) {
        for (const e of list) {
          const o = document.createElement("option");
          o.value = e.uf; o.textContent = `${e.uf} (${(Number(e.aliquota) * 100).toFixed(0)}%)`;
          if (e.uf === selected) o.selected = true;
          sel.appendChild(o);
        }
      } else {
        for (const uf of ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"]) {
          const o = document.createElement("option");
          o.value = uf; o.textContent = uf;
          if (uf === selected) o.selected = true;
          sel.appendChild(o);
        }
      }
    }

    function toggleCollapse() {
      collapsed = !collapsed;
      panel?.setAttribute("data-collapsed", collapsed ? "1" : "0");
      saveUiState({ collapsed });
      if (!collapsed) { collapseVendorPanel(); scheduleRecalc(); }
      setTimeout(repositionPanel, 50);
    }

    // ── Lifecycle ──

    async function init() {
      await Promise.all([loadShippingData(), loadPriceRates()]);
      const [prefs, uiState] = await Promise.all([loadPrefs(), loadUiState()]);
      collapsed = uiState.collapsed !== false;
      ensureStyle();
      buildPanel(prefs);
      recalc();
      watchVendorPanel();
      watchForBadges();

      stopWatchingModule = runtime.watchModuleEnabled(moduleId, defaultEnabled, (on) => { if (!on) stop(); });

      runtime.watchUrlChanges(() => {
        if (stopped) return;
        setTimeout(injectCalcButtons, 1000);
        repositionPanel();
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (changes[CFG.RATES_CACHE_KEY]) { shippingData = changes[CFG.RATES_CACHE_KEY].newValue || shippingData; scheduleRecalc(); }
        if (changes[CFG.REMOTE_CONFIG_KEY]?.newValue?.default_price_rates) { priceRates = changes[CFG.REMOTE_CONFIG_KEY].newValue.default_price_rates; scheduleRecalc(); }
      });
    }

    function stop() {
      stopped = true;
      clearTimeout(debounceTimer);
      stopWatchingModule();
      vendorObserver?.disconnect();
      badgeObserver?.disconnect();
      document.getElementById(CFG.PANEL_ID)?.remove();
      document.getElementById(CFG.STYLE_ID)?.remove();
      document.querySelectorAll(`[${CALC_BTN_ATTR}]`).forEach((b) => b.remove());
    }

    runtime.isModuleEnabled(moduleId, defaultEnabled).then((on) => {
      if (on) init();
      else stopWatchingModule = runtime.watchModuleEnabled(moduleId, defaultEnabled, (on) => { if (on && !stopped) init(); });
    });
  }

  const sites = [];
  function registerSite(strategy) {
    const siteId = asString(strategy?.siteId);
    if (!siteId) return;
    siteManager.register(strategy);
    sites.push(strategy);
  }

  globalThis.__xh_import_calc = { CFG, sites, registerSite, bootstrap };
})();
