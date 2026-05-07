// src/content-scripts/modules/quality_sellers_panel/core.js
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const MSG_GET_QUALITY_ITEMS = "XH_GET_QUALITY_ITEMS";

  const CFG = {
    PANEL_ID: "__xh_quality_panel__",
    STYLE_ID: "__xh_quality_panel_style__",
    UI_STATE_KEY: "xh_quality_panel_ui_state",
    CACHE_KEY: "xh_quality_panel_cache_v1",
    defaultListKey: "nico",
    defaultListLabel: "Recomendacoes Nico",
    defaultTitle: "Vendedores",
    defaultPanelTopPx: 60,
    defaultPanelLeftPx: 12,
    maxItems: 30,
    maxItemsCollapsed: 30,
    dailyRefreshMs: 24 * 60 * 60 * 1000,
    zIndex: 2147483645,
  };

  const { asString, toFiniteNumber, clampInt, sanitizeUrl, isNonEmptyArray, createEl } = globalThis.XHContentUtils;

  function bootstrap({ runtime, moduleId, defaultEnabled }) {
    const activeSite = siteManager.resolveActive(location.hostname);
    if (!activeSite) return;

    let stopped = false;
    let collapsed = false;
    let inFlight = false;
    let requestSeq = 0;
    let lastFetchedAtMs = 0;
    let lastItems = [];
    let currentListKey = asString(activeSite.defaultListKey || CFG.defaultListKey) || CFG.defaultListKey;
    let currentListLabel = asString(activeSite.defaultListLabel || CFG.defaultListLabel) || CFG.defaultListLabel;

    let panel = null;
    let statusEl = null;
    let listEl = null;
    let refreshBtn = null;
    let stateDotEl = null;
    let titleEl = null;
    let subEl = null;
    let listBadgeEl = null;

    let stopWatchingModule = () => {};
    let stopWatchingUrl = () => {};

    function getPanelTitle() {
      return asString(activeSite.panelTitle || CFG.defaultTitle) || CFG.defaultTitle;
    }

    function getPanelTopPx() {
      const value = toFiniteNumber(activeSite.panelTopPx);
      return value === null ? CFG.defaultPanelTopPx : Math.max(0, Math.trunc(value));
    }

    function getPanelLeftPx() {
      const value = toFiniteNumber(activeSite.panelLeftPx);
      return value === null ? CFG.defaultPanelLeftPx : Math.max(0, Math.trunc(value));
    }

    function getDefaultListKey() {
      return asString(activeSite.defaultListKey || CFG.defaultListKey) || CFG.defaultListKey;
    }

    function getDefaultListLabel() {
      return asString(activeSite.defaultListLabel || CFG.defaultListLabel) || CFG.defaultListLabel;
    }

    function setStatus(text, tone = "info") {
      if (!statusEl) return;
      const content = asString(text);
      if (!content) {
        statusEl.textContent = "";
        statusEl.className = "xh-quality-status is-hidden";
        return;
      }
      statusEl.textContent = content;
      statusEl.className = "xh-quality-status";
      if (tone === "ok") statusEl.classList.add("is-ok");
      else if (tone === "err") statusEl.classList.add("is-err");
      else if (tone === "warn") statusEl.classList.add("is-warn");
      else statusEl.classList.add("is-info");
    }

    function ensureStyle() {
      if (document.getElementById(CFG.STYLE_ID)) return;

      const style = document.createElement("style");
      style.id = CFG.STYLE_ID;
      style.textContent = `
#${CFG.PANEL_ID}{
  position: fixed;
  left: ${getPanelLeftPx()}px;
  top: ${getPanelTopPx()}px;
  width: min(296px, calc(100vw - 16px));
  max-height: 70vh;
  z-index: ${CFG.zIndex};
  border-radius: 12px;
  border: 1px solid #dbe2ec;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.14);
  color: #0f172a;
  font-family: "Manrope", "Segoe UI", Tahoma, Arial, sans-serif;
  transition: width .16s ease, border-radius .16s ease, box-shadow .16s ease;
  -webkit-user-select: none;
  user-select: none;
}

#${CFG.PANEL_ID}[data-collapsed="1"]{
  width: fit-content;
  max-width: calc(100vw - 20px);
  max-height: none;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.10);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.10);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

#${CFG.PANEL_ID} .xh-quality-head{
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid #ecf1f7;
}

#${CFG.PANEL_ID} .xh-quality-title-row{
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

#${CFG.PANEL_ID} .xh-quality-state-dot{
  width: 6px;
  height: 6px;
  min-width: 6px;
  border-radius: 999px;
  background: rgba(96, 210, 140, 0.95);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25), 0 0 10px rgba(96,210,140,0.35);
  animation: xh_quality_pulse 1.8s ease-in-out infinite alternate;
  transition: background-color .16s ease, box-shadow .16s ease;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-state-dot{
  background: rgba(255, 77, 79, 0.95);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.20), 0 0 10px rgba(255,77,79,0.30);
}

#${CFG.PANEL_ID} .xh-quality-head-copy{
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  border-radius: 8px;
  padding: 2px 4px;
  margin: -2px -4px;
}

#${CFG.PANEL_ID} .xh-quality-head-copy:hover{
  background: #f8fafc;
}

#${CFG.PANEL_ID} .xh-quality-title{
  margin: 0;
  font-size: 14px;
  line-height: 1.2;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
}

#${CFG.PANEL_ID} .xh-quality-sub{
  display: block;
  margin: 0;
  font-size: 11px;
  line-height: 1.1;
  font-weight: 700;
  color: #475467;
  text-align: center;
  letter-spacing: 0.2px;
}

#${CFG.PANEL_ID} .xh-quality-list-badge{
  display: none;
}

#${CFG.PANEL_ID} .xh-quality-body{
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 10px;
  max-height: calc(70vh - 48px);
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-body{
  display: none;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-sub{
  display: none;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-head{
  padding: 4px 8px;
  gap: 5px;
  border-bottom: 0;
  justify-content: center;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-head-copy{
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-head-copy:hover{
  background: transparent;
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-title{
  white-space: nowrap;
  max-width: none;
  line-height: 1;
  font: 700 9px/1 "Segoe UI", system-ui, sans-serif;
  color: rgba(11,16,32,0.88);
}

#${CFG.PANEL_ID}[data-collapsed="1"] .xh-quality-list-badge{
  display: none;
}

@keyframes xh_quality_pulse{
  0% { transform: scale(0.86); opacity: 0.65; }
  100% { transform: scale(1); opacity: 1; }
}

#${CFG.PANEL_ID} .xh-quality-status{
  margin: 0;
  font-size: 11px;
  line-height: 1.3;
  color: #64748b;
  padding: 2px 0 0;
}

#${CFG.PANEL_ID} .xh-quality-status.is-hidden{
  display: none;
}

#${CFG.PANEL_ID} .xh-quality-status.is-info{
  color: #64748b;
}

#${CFG.PANEL_ID} .xh-quality-status.is-ok{
  color: #0f766e;
}

#${CFG.PANEL_ID} .xh-quality-status.is-warn{
  color: #a16207;
}

#${CFG.PANEL_ID} .xh-quality-status.is-err{
  color: #b91c1c;
}

#${CFG.PANEL_ID} .xh-quality-list{
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  max-height: calc(70vh - 86px);
  padding-right: 2px;
}

#${CFG.PANEL_ID} .xh-quality-list::-webkit-scrollbar{
  width: 6px;
}

#${CFG.PANEL_ID} .xh-quality-list::-webkit-scrollbar-thumb{
  background: #cbd5e1;
  border-radius: 999px;
}

#${CFG.PANEL_ID} .xh-quality-empty{
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.35;
  color: #334155;
  background: rgba(241, 245, 249, 0.9);
  border: 1px dashed rgba(148, 163, 184, 0.5);
}

#${CFG.PANEL_ID} .xh-quality-card{
  display: block;
  margin: 0;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  background: #fcfdff;
  padding: 9px 10px;
}

#${CFG.PANEL_ID} .xh-quality-card.is-clickable{
  cursor: pointer;
  transition: border-color .12s ease, background-color .12s ease, box-shadow .12s ease;
  -webkit-user-select: none;
  user-select: none;
}

#${CFG.PANEL_ID} .xh-quality-card.is-clickable:hover{
  border-color: #bfdbfe;
  background: #f8fbff;
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.10);
}

#${CFG.PANEL_ID} .xh-quality-main{
  min-width: 0;
}

#${CFG.PANEL_ID} .xh-quality-top{
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

#${CFG.PANEL_ID} .xh-quality-thumb{
  width: 38px;
  height: 38px;
  border-radius: 8px;
  object-fit: cover;
  flex: 0 0 auto;
  border: 1px solid #dbe3ee;
  background: #f1f5f9;
  -webkit-user-select: none;
  user-select: none;
  pointer-events: none;
}

#${CFG.PANEL_ID} .xh-quality-item-link,
#${CFG.PANEL_ID} .xh-quality-item-text{
  flex: 1;
  margin: 0;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 700;
  color: #0f172a;
  text-decoration: none;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
}

#${CFG.PANEL_ID} .xh-quality-item-link:hover{
  text-decoration: underline;
}

#${CFG.PANEL_ID} .xh-quality-meta{
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.35;
  color: #334155;
  word-break: break-word;
}

#${CFG.PANEL_ID} .xh-quality-meta.is-muted{
  margin-top: 4px;
  color: #64748b;
}

@media (max-width: 900px){
  #${CFG.PANEL_ID}{
    left: 8px;
    right: 8px;
    width: auto;
    top: ${getPanelTopPx()}px;
    max-height: 66vh;
  }

  #${CFG.PANEL_ID}[data-collapsed="1"]{
    width: fit-content;
    max-width: calc(100vw - 16px);
    right: auto;
  }
}

@media (prefers-reduced-motion: reduce){
  #${CFG.PANEL_ID},
  #${CFG.PANEL_ID} *{
    transition: none !important;
  }
  #${CFG.PANEL_ID} .xh-quality-state-dot{
    animation: none;
  }
}
      `.trim();

      document.documentElement.appendChild(style);
    }

    function setCollapsedUi() {
      if (!panel) return;
      panel.dataset.collapsed = collapsed ? "1" : "0";
      if (stateDotEl) {
        stateDotEl.title = collapsed ? "Painel minimizado" : "Painel aberto";
      }
      if (titleEl) {
        titleEl.textContent = getPanelTitle();
      }
      if (subEl) {
        subEl.textContent = collapsed ? "" : resolveListLabelForUi();
      }
      if (listBadgeEl) {
        listBadgeEl.textContent = "";
        listBadgeEl.title = "";
      }
    }

    function resolveListLabelForUi() {
      const key = asString(currentListKey || getDefaultListKey()).toLowerCase();
      if (key === "nico") return "Recomendacoes Nico";
      return asString(currentListLabel || getDefaultListLabel()) || getDefaultListLabel();
    }

    async function saveUiState() {
      try {
        await chrome.storage.local.set({
          [CFG.UI_STATE_KEY]: { collapsed: !!collapsed },
        });
      } catch {}
    }

    async function restoreUiState() {
      try {
        const data = await chrome.storage.local.get(CFG.UI_STATE_KEY);
        collapsed = data?.[CFG.UI_STATE_KEY]?.collapsed === true;
      } catch {
        collapsed = false;
      }
      setCollapsedUi();
    }

    function msUntilNextRefresh(lastMs) {
      const stamp = Number(lastMs) || 0;
      if (stamp <= 0) return 0;
      const elapsed = Date.now() - stamp;
      const remaining = CFG.dailyRefreshMs - elapsed;
      return remaining > 0 ? remaining : 0;
    }

    function formatRemainingTime(ms) {
      const safe = Math.max(0, Number(ms) || 0);
      const totalMinutes = Math.ceil(safe / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours <= 0) return `${minutes}min`;
      if (minutes <= 0) return `${hours}h`;
      return `${hours}h ${minutes}min`;
    }

    function updateRefreshButtonLimitUi() {
      if (!refreshBtn || inFlight) return;
      const remaining = msUntilNextRefresh(lastFetchedAtMs);
      if (remaining <= 0) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "R";
        refreshBtn.title = "Atualizar lista";
        refreshBtn.setAttribute("aria-label", "Atualizar lista");
        return;
      }
      refreshBtn.disabled = true;
      refreshBtn.textContent = "R";
      refreshBtn.title = `Atualizacao manual disponivel em ${formatRemainingTime(remaining)}`;
      refreshBtn.setAttribute("aria-label", refreshBtn.title);
    }

    async function saveCache(items) {
      const safeItems = Array.isArray(items) ? items : [];
      const payload = {
        fetchedAtMs: Date.now(),
        items: safeItems,
        listKey: asString(currentListKey || getDefaultListKey()) || getDefaultListKey(),
        listLabel: asString(currentListLabel || getDefaultListLabel()) || getDefaultListLabel(),
      };
      lastFetchedAtMs = payload.fetchedAtMs;
      lastItems = safeItems;
      updateRefreshButtonLimitUi();
      try {
        await chrome.storage.local.set({ [CFG.CACHE_KEY]: payload });
      } catch {}
    }

    async function loadCache() {
      try {
        const data = await chrome.storage.local.get(CFG.CACHE_KEY);
        const payload = data?.[CFG.CACHE_KEY];
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const fetchedAtMs = Number(payload?.fetchedAtMs || 0) || 0;
        currentListKey = asString(payload?.listKey || getDefaultListKey()) || getDefaultListKey();
        currentListLabel = asString(payload?.listLabel || getDefaultListLabel()) || getDefaultListLabel();
        lastFetchedAtMs = fetchedAtMs;
        lastItems = items;
        updateRefreshButtonLimitUi();
        return { items, fetchedAtMs };
      } catch {
        currentListKey = getDefaultListKey();
        currentListLabel = getDefaultListLabel();
        lastFetchedAtMs = 0;
        lastItems = [];
        updateRefreshButtonLimitUi();
        return { items: [], fetchedAtMs: 0 };
      }
    }

    function ensurePanel() {
      const existing = document.getElementById(CFG.PANEL_ID);
      if (existing) {
        panel = existing;
        statusEl = panel.querySelector(".xh-quality-status");
        listEl = panel.querySelector(".xh-quality-list");
        refreshBtn = panel.querySelector("[data-xh-quality-refresh]");
        stateDotEl = panel.querySelector(".xh-quality-state-dot");
        titleEl = panel.querySelector(".xh-quality-title");
        subEl = panel.querySelector(".xh-quality-sub");
        listBadgeEl = panel.querySelector(".xh-quality-list-badge");
        if (refreshBtn) refreshBtn.remove();
        refreshBtn = null;
        return panel;
      }

      panel = document.createElement("aside");
      panel.id = CFG.PANEL_ID;
      panel.dataset.collapsed = "0";

      const head = createEl("header", "xh-quality-head");
      const copy = createEl("div", "xh-quality-head-copy");
      const titleRow = createEl("div", "xh-quality-title-row");
      stateDotEl = createEl("span", "xh-quality-state-dot");
      stateDotEl.setAttribute("aria-hidden", "true");
      titleEl = createEl("div", "xh-quality-title", getPanelTitle());
      listBadgeEl = createEl("span", "xh-quality-list-badge", "Nico");
      subEl = createEl("div", "xh-quality-sub", resolveListLabelForUi());
      titleRow.appendChild(stateDotEl);
      titleRow.appendChild(titleEl);
      titleRow.appendChild(listBadgeEl);
      copy.appendChild(titleRow);
      copy.appendChild(subEl);
      copy.title = "Recolher/expandir painel";
      copy.setAttribute("aria-label", "Recolher/expandir painel");
      copy.addEventListener("click", () => {
        collapsed = !collapsed;
        setCollapsedUi();
        saveUiState().catch(() => {});
      });

      head.appendChild(copy);

      const body = createEl("div", "xh-quality-body");
      statusEl = createEl("p", "xh-quality-status is-info", "Carregando vendedores...");
      listEl = createEl("div", "xh-quality-list");
      body.appendChild(statusEl);
      body.appendChild(listEl);

      panel.appendChild(head);
      panel.appendChild(body);
      document.documentElement.appendChild(panel);

      return panel;
    }

    function clearList() {
      if (!listEl) return;
      listEl.replaceChildren();
    }

    function renderEmpty() {
      clearList();
      setStatus("Nenhum vendedor cadastrado nesta lista.", "warn");
      const empty = createEl(
        "p",
        "xh-quality-empty",
        "Cadastre vendedores ativos na lista selecionada no Supabase."
      );
      listEl?.appendChild(empty);
    }

    function getFetchErrorMessage(reason) {
      const key = asString(reason).toLowerCase();
      if (key === "vendors_table_missing") return "Tabela vendedores_nico nao encontrada no Supabase.";
      if (key === "vendors_policy_blocked") return "Leitura bloqueada por RLS na tabela vendedores_nico.";
      if (key === "quality_items_table_missing") return "Tabela de qualidade nao encontrada no Supabase.";
      if (key === "quality_items_policy_blocked") return "Leitura bloqueada por RLS na tabela de qualidade.";
      if (key === "offline") return "Falha de conexao ao consultar o Supabase.";
      return "Nao foi possivel carregar os vendedores.";
    }

    function renderError(reason) {
      clearList();
      setStatus(getFetchErrorMessage(reason), "err");
      const block = createEl(
        "p",
        "xh-quality-empty",
        "Atualizacao automatica em ate 24h."
      );
      listEl?.appendChild(block);
    }

    function openSellerAndMinimizePanel(url) {
      const targetUrl = sanitizeUrl(url);
      if (!targetUrl) return;
      window.open(targetUrl, "_blank", "noopener,noreferrer");
      collapsed = true;
      setCollapsedUi();
      saveUiState().catch(() => {});
    }

    function renderItemCard(item) {
      const safeItem = item && typeof item === "object" ? item : {};
      const card = createEl("article", "xh-quality-card");

      const main = createEl("div", "xh-quality-main");
      const itemTitle = asString(safeItem.itemTitle) || "Vendedor recomendado";
      const sellerUrl = sanitizeUrl(safeItem.sellerUrl) || sanitizeUrl(safeItem.itemUrl);
      const sellerName = asString(safeItem.sellerName);
      const imageUrl = sanitizeUrl(safeItem.itemImageUrl);
      const imageFallbackUrl = sanitizeUrl(safeItem.itemImageFallbackUrl);

      const top = createEl("div", "xh-quality-top");
      if (imageUrl) {
        const thumb = createEl("img", "xh-quality-thumb");
        thumb.src = imageUrl;
        thumb.alt = sellerName || itemTitle;
        thumb.loading = "lazy";
        thumb.decoding = "async";
        thumb.referrerPolicy = "no-referrer";
        thumb.draggable = false;
        if (imageFallbackUrl && imageFallbackUrl !== imageUrl) {
          thumb.dataset.fallbackSrc = imageFallbackUrl;
        }
        thumb.addEventListener("error", () => {
          const fallbackSrc = asString(thumb.dataset.fallbackSrc);
          const triedFallback = thumb.dataset.fallbackTried === "1";
          if (!triedFallback && fallbackSrc && thumb.src !== fallbackSrc) {
            thumb.dataset.fallbackTried = "1";
            thumb.src = fallbackSrc;
            return;
          }
          thumb.remove();
        });
        top.appendChild(thumb);
      }
      top.appendChild(createEl("div", "xh-quality-item-text", itemTitle));
      main.appendChild(top);
      card.appendChild(main);

      if (sellerUrl) {
        card.classList.add("is-clickable");
        card.tabIndex = 0;
        card.setAttribute("role", "link");
        card.setAttribute("aria-label", `Abrir vendedor: ${itemTitle}`);
        card.addEventListener("click", () => {
          openSellerAndMinimizePanel(sellerUrl);
        });
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openSellerAndMinimizePanel(sellerUrl);
        });
      }

      return card;
    }

    function renderItems(items) {
      clearList();
      if (!isNonEmptyArray(items)) {
        renderEmpty();
        return;
      }
      setStatus("", "ok");

      items.forEach((item) => {
        const card = renderItemCard(item);
        listEl?.appendChild(card);
      });
    }

    async function requestQualityItems() {
      const limit = collapsed ? CFG.maxItemsCollapsed : CFG.maxItems;
      const payload = {
        type: MSG_GET_QUALITY_ITEMS,
        limit: clampInt(limit, 1, 30),
        listKey: currentListKey,
        listLabel: currentListLabel,
      };
      return chrome.runtime.sendMessage(payload);
    }

    async function refreshItems(options = {}) {
      if (stopped) return;
      if (inFlight && !options.force) return;

      const remaining = msUntilNextRefresh(lastFetchedAtMs);
      if (remaining > 0) {
        updateRefreshButtonLimitUi();
        if (!options.silent && options.userInitiated) {
          setStatus(`Atualizacao manual liberada em ${formatRemainingTime(remaining)}.`, "warn");
        }
        if (isNonEmptyArray(lastItems) && !options.preserveCurrent) {
          renderItems(lastItems);
        }
        return;
      }

      const seq = ++requestSeq;
      inFlight = true;
      if (!options.silent) setStatus("Carregando vendedores...", "info");

      try {
        const result = await requestQualityItems();
        if (stopped || seq !== requestSeq) return;
        if (!result?.ok) {
          renderError(result?.reason || result?.err || "quality_items_fetch_failed");
          return;
        }
        currentListKey = asString(result?.listKey || currentListKey || getDefaultListKey()) || getDefaultListKey();
        currentListLabel = asString(result?.listLabel || currentListLabel || getDefaultListLabel()) || getDefaultListLabel();
        setCollapsedUi();
        const items = Array.isArray(result.items) ? result.items : [];
        renderItems(items);
        await saveCache(items);
      } catch {
        if (!stopped && seq === requestSeq) {
          renderError("offline");
        }
      } finally {
        if (seq === requestSeq) {
          inFlight = false;
          updateRefreshButtonLimitUi();
        }
      }
    }

    function removePanel() {
      panel?.remove();
      panel = null;
      statusEl = null;
      listEl = null;
      refreshBtn = null;
      stateDotEl = null;
      titleEl = null;
      subEl = null;
      listBadgeEl = null;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      stopWatchingModule();
      stopWatchingUrl();
      removePanel();
      document.getElementById(CFG.STYLE_ID)?.remove();
    }

    async function init() {
      const enabled = await runtime.isModuleEnabled(moduleId, defaultEnabled);
      if (!enabled || stopped) return;

      ensureStyle();
      ensurePanel();
      await restoreUiState();
      const cached = await loadCache();
      setCollapsedUi();
      if (isNonEmptyArray(cached.items)) {
        renderItems(cached.items);
      }
      await refreshItems({
        force: true,
        silent: isNonEmptyArray(cached.items),
        userInitiated: false,
        preserveCurrent: true,
      });

      stopWatchingModule = runtime.watchModuleEnabled(moduleId, defaultEnabled, (nextEnabled) => {
        if (!nextEnabled) stop();
      });
    }

    init().catch(() => {
      ensureStyle();
      ensurePanel();
      setStatus("Falha ao iniciar painel de qualidade.", "err");
    });

    return () => {
      stop();
    };
  }

  globalThis.__xh_quality_sellers_panel = {
    CFG,
    sites: siteManager.sites,
    registerSite: siteManager.register,
    resolveActiveSite: siteManager.resolveActive,
    bootstrap,
  };
})();
