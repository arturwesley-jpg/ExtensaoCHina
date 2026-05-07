// src/content-scripts/modules/search_insights/core.js
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const MSG_TRACK_SEARCH_EVENT = "XH_TRACK_SEARCH_EVENT";
  const MSG_FLUSH_SEARCH_QUEUE = "XH_FLUSH_SEARCH_QUEUE";

  const CFG = {
    minQueryLength: 2,
    maxQueryLength: 220,
    maxPathLength: 400,
    localDedupeMs: 5000,
  };

  const DEFAULT_URL_QUERY_KEYS = [
    "q",
    "query",
    "keyword",
    "keywords",
    "key",
    "kw",
    "word",
    "search",
    "searchtext",
    "search_text",
  ];

  const DEFAULT_SEARCH_INPUT_SELECTORS = [
    'input[type="search"]',
    'input[name*="search"]',
    'input[id*="search"]',
    'input[placeholder*="search"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="搜"]',
    'input[placeholder*="关键"]',
    'input[placeholder*="商品"]',
  ];

  const { asString, sanitizeQuery, normalizeQuery, sanitizePath } = globalThis.XHContentUtils;

  function getUrlQueryKeys(site) {
    return Array.isArray(site?.urlQueryKeys) && site.urlQueryKeys.length
      ? site.urlQueryKeys
      : DEFAULT_URL_QUERY_KEYS;
  }

  function getSearchInputSelectors(site) {
    return Array.isArray(site?.searchInputSelectors) && site.searchInputSelectors.length
      ? site.searchInputSelectors
      : DEFAULT_SEARCH_INPUT_SELECTORS;
  }

  function defaultLooksLikeSearchButton(element) {
    const el = element && typeof element === "object" ? element : null;
    if (!el) return false;
    const text = asString(el.textContent).toLowerCase();
    const aria = asString(el.getAttribute?.("aria-label")).toLowerCase();
    const title = asString(el.getAttribute?.("title")).toLowerCase();
    const classes = asString(el.className).toLowerCase();
    const role = asString(el.getAttribute?.("role")).toLowerCase();
    const type = asString(el.getAttribute?.("type")).toLowerCase();

    const joined = `${text} ${aria} ${title} ${classes} ${role} ${type}`;
    return (
      joined.includes("search") ||
      joined.includes("buscar") ||
      joined.includes("pesquisa") ||
      joined.includes("搜") ||
      joined.includes("搜索")
    );
  }

  function looksLikeSearchButton(site, element) {
    if (typeof site?.looksLikeSearchButton === "function") {
      return !!site.looksLikeSearchButton(element, { asString });
    }
    return defaultLooksLikeSearchButton(element);
  }

  function defaultIsTrackableInput(target) {
    if (!target || target.tagName !== "INPUT") return false;
    const input = target;
    if (input.disabled || input.readOnly) return false;
    const type = asString(input.type).toLowerCase();
    if (type && !["text", "search", ""].includes(type)) return false;
    const attrs = `${asString(input.name)} ${asString(input.id)} ${asString(input.placeholder)}`.toLowerCase();
    return (
      attrs.includes("search") ||
      attrs.includes("buscar") ||
      attrs.includes("pesquisa") ||
      attrs.includes("搜") ||
      attrs.includes("关键") ||
      attrs.includes("商品")
    );
  }

  function isTrackableInput(site, target) {
    if (typeof site?.isTrackableInput === "function") {
      return !!site.isTrackableInput(target, { asString });
    }
    return defaultIsTrackableInput(target);
  }

  function findBestInputValue(site) {
    for (const selector of getSearchInputSelectors(site)) {
      const list = Array.from(document.querySelectorAll(selector));
      for (const input of list) {
        if (!isTrackableInput(site, input)) continue;
        const query = sanitizeQuery(input.value);
        if (query.length >= CFG.minQueryLength) return query;
      }
    }
    return "";
  }

  function readQueryFromUrl(site, rawUrl = location.href) {
    try {
      const parsed = new URL(rawUrl, location.origin);
      for (const key of getUrlQueryKeys(site)) {
        const value = sanitizeQuery(parsed.searchParams.get(key));
        if (value.length >= CFG.minQueryLength) return value;
      }
      return "";
    } catch {
      return "";
    }
  }

  function bootstrap({ runtime, moduleId, defaultEnabled }) {
    const activeSite = siteManager.resolveActive(location.hostname);
    if (!activeSite) return;

    let active = false;
    let stopWatchingModule = () => {};
    let stopWatchingUrl = () => {};
    let lastSentNorm = "";
    let lastSentAtMs = 0;

    function shouldSkipLocalDedupe(queryNorm) {
      const now = Date.now();
      if (!queryNorm) return true;
      if (queryNorm !== lastSentNorm) return false;
      return now - lastSentAtMs < CFG.localDedupeMs;
    }

    function markLocalDedupe(queryNorm) {
      lastSentNorm = queryNorm;
      lastSentAtMs = Date.now();
    }

    async function emitSearchEvent(query, trigger) {
      const safeQuery = sanitizeQuery(query);
      if (safeQuery.length < CFG.minQueryLength) return;

      const queryNorm = normalizeQuery(safeQuery);
      if (queryNorm.length < CFG.minQueryLength) return;
      if (shouldSkipLocalDedupe(queryNorm)) return;
      markLocalDedupe(queryNorm);

      const payload = {
        type: MSG_TRACK_SEARCH_EVENT,
        query: safeQuery,
        queryNorm,
        sourceSite: activeSite.siteId,
        trigger: asString(trigger || "unknown").toLowerCase() || "unknown",
        pagePath: sanitizePath(`${location.pathname}${location.search}`),
        ts: Date.now(),
      };

      try {
        await chrome.runtime.sendMessage(payload);
      } catch {}
    }

    function onKeydown(event) {
      if (!active) return;
      if (!event || event.key !== "Enter") return;
      const target = event.target;
      if (!isTrackableInput(activeSite, target)) return;
      emitSearchEvent(target.value, "enter");
    }

    function onClick(event) {
      if (!active) return;
      const target = event?.target?.closest?.("button, [role='button'], a, div");
      if (!target) return;
      if (!looksLikeSearchButton(activeSite, target)) return;

      const queryFromInput = findBestInputValue(activeSite);
      if (!queryFromInput) return;
      emitSearchEvent(queryFromInput, "button");
    }

    function onUrlChange(nextUrl) {
      if (!active) return;
      const queryFromUrl = readQueryFromUrl(activeSite, nextUrl);
      if (queryFromUrl) {
        emitSearchEvent(queryFromUrl, "url_change");
        return;
      }
      const queryFromInput = findBestInputValue(activeSite);
      if (queryFromInput) {
        emitSearchEvent(queryFromInput, "url_change_input");
      }
    }

    function requestFlush() {
      try {
        chrome.runtime.sendMessage({ type: MSG_FLUSH_SEARCH_QUEUE });
      } catch {}
    }

    function onPageHide() {
      if (!active) return;
      requestFlush();
    }

    function onVisibilityChange() {
      if (!active) return;
      if (document.visibilityState === "hidden") requestFlush();
    }

    function start() {
      if (active) return;
      active = true;
      document.addEventListener("keydown", onKeydown, true);
      document.addEventListener("click", onClick, true);
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onVisibilityChange);
      stopWatchingUrl = runtime.watchUrlChanges((nextUrl) => onUrlChange(nextUrl), 1000);
      onUrlChange(location.href);
    }

    function stop() {
      if (!active) return;
      active = false;
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopWatchingUrl();
      stopWatchingUrl = () => {};
    }

    async function init() {
      const enabled = await runtime.isModuleEnabled(moduleId, defaultEnabled);
      if (enabled) start();

      stopWatchingModule = runtime.watchModuleEnabled(moduleId, defaultEnabled, (nextEnabled) => {
        if (nextEnabled) start();
        else stop();
      });
    }

    init().catch(() => {});

    return () => {
      stop();
      stopWatchingModule();
    };
  }

  globalThis.__xh_search_insights = {
    CFG,
    sites: siteManager.sites,
    registerSite: siteManager.register,
    resolveActiveSite: siteManager.resolveActive,
    bootstrap,
  };
})();
