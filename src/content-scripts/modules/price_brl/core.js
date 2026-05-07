// src/content-scripts/modules/price_brl/core.js
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const {
    REPLACED_TEXT_ATTR,
    BASE_PRICE_CLASS_HINTS,
    BASE_SPLIT_ROOT_HINTS,
    BASE_SIGN_CLASS_HINTS,
    BASE_NUMBER_CLASS_HINTS,
    BASE_DECIMAL_CLASS_HINTS,
    scorePriceCandidateEl,
    restoreAllReplacedContainers,
    restoreAllReplacedTextNodes,
    replacePurePriceEl,
    replaceSplitPriceContainer,
    ensureOneBadge,
    removeAllBadges,
    cleanupOrphans,
    makeBadgeText,
    isBetterCandidate,
    parsePureCny,
    looksPurePriceEl,
    pickAnchor,
    parseSplitPriceFromContainer,
    findCandidateContainers,
    buildBestCandidates,
  } = globalThis.__xh_price_brl_dom;

  const { normalizeRate, normalizePriceCurrency: normalizeCurrency, normalizePriceRates, norm } = globalThis.XHContentUtils;

  const DISPLAY_MODE = Object.freeze({
    SIDE: "side",
    REPLACE: "replace",
  });

  const CFG = {
    rateKey: "brlRate",
    ratesKey: "priceRates",
    currencyKey: "priceCurrency",
    modeKey: "brlPriceDisplayMode",
    defaultRate: 0.77,
    defaultCurrency: "BRL",
    defaultRates: Object.freeze({
      BRL: 0.77,
      USD: 0.14,
      EUR: 0.13,
    }),
    defaultDisplayMode: DISPLAY_MODE.REPLACE,
    scanDebounceMs: 250,
    maxCandidates: 9000,
  };

  let runtime = null;
  let activeSite = null;
  let currentModuleId = "price_brl";
  let currentDefaultEnabled = false;
  let initialized = false;

  let scheduled = false;
  let stopped = false;
  let observer = null;
  let stopWatching = () => {};
  let stopWatchingStorage = () => {};

  let cachedPriceRates = { ...CFG.defaultRates };
  let priceRatesLoaded = false;
  let cachedPriceCurrency = CFG.defaultCurrency;
  let priceCurrencyLoaded = false;
  let cachedDisplayMode = CFG.defaultDisplayMode;
  let displayModeLoaded = false;

  function mergeHints(base, extra) {
    const out = [];
    const seen = new Set();
    [...base, ...(Array.isArray(extra) ? extra : [])].forEach((value) => {
      const hint = String(value || "").trim().toLowerCase();
      if (!hint || seen.has(hint)) return;
      seen.add(hint);
      out.push(hint);
    });
    return out;
  }

  function getFocusedRootSelectors() {
    return Array.isArray(activeSite?.focusedRootSelectors) ? activeSite.focusedRootSelectors : [];
  }

  function getPriceClassHints() {
    return mergeHints(BASE_PRICE_CLASS_HINTS, activeSite?.priceClassHints);
  }

  function getSplitRootHints() {
    return mergeHints(BASE_SPLIT_ROOT_HINTS, activeSite?.splitRootHints);
  }

  function getSignClassHints() {
    return mergeHints(BASE_SIGN_CLASS_HINTS, activeSite?.signClassHints);
  }

  function getNumberClassHints() {
    return mergeHints(BASE_NUMBER_CLASS_HINTS, activeSite?.numberClassHints);
  }

  function getDecimalClassHints() {
    return mergeHints(BASE_DECIMAL_CLASS_HINTS, activeSite?.decimalClassHints);
  }

  function normalizeDisplayMode(raw) {
    return String(raw || "").trim().toLowerCase() === DISPLAY_MODE.SIDE
      ? DISPLAY_MODE.SIDE
      : DISPLAY_MODE.REPLACE;
  }

  async function loadPriceRatesOnce() {
    if (priceRatesLoaded) return cachedPriceRates;
    try {
      const modeRes = await chrome.storage.sync.get("priceRateMode");
      const mode = modeRes?.priceRateMode === "manual" ? "manual" : "auto";

      if (mode === "auto") {
        // Auto mode: prefer remote config rates, fallback to hardcoded
        const remote = await chrome.storage.local.get("xh_remote_config_v1");
        const remoteRates = remote?.xh_remote_config_v1?.default_price_rates;
        if (remoteRates && typeof remoteRates === "object") {
          cachedPriceRates = normalizePriceRates(remoteRates);
        } else {
          cachedPriceRates = { ...CFG.defaultRates };
        }
      } else {
        // Manual mode: use user-configured rates from sync storage
        const res = await chrome.storage.sync.get([CFG.ratesKey, CFG.rateKey]);
        if (res[CFG.ratesKey] && typeof res[CFG.ratesKey] === "object") {
          cachedPriceRates = normalizePriceRates(res[CFG.ratesKey], res[CFG.rateKey]);
        } else {
          cachedPriceRates = { ...CFG.defaultRates };
        }
      }
    } catch {}
    priceRatesLoaded = true;
    return cachedPriceRates;
  }

  async function refreshPriceRates() {
    priceRatesLoaded = false;
    return loadPriceRatesOnce();
  }

  async function loadPriceCurrencyOnce() {
    if (priceCurrencyLoaded) return cachedPriceCurrency;
    try {
      const res = await chrome.storage.sync.get(CFG.currencyKey);
      cachedPriceCurrency = normalizeCurrency(res[CFG.currencyKey], CFG.defaultCurrency);
    } catch {}
    priceCurrencyLoaded = true;
    return cachedPriceCurrency;
  }

  async function refreshPriceCurrency() {
    priceCurrencyLoaded = false;
    return loadPriceCurrencyOnce();
  }

  async function loadRateOnce() {
    const [currency, rates] = await Promise.all([loadPriceCurrencyOnce(), loadPriceRatesOnce()]);
    return normalizeRate(rates[currency], CFG.defaultRates[currency]);
  }

  async function refreshRate() {
    await Promise.all([refreshPriceCurrency(), refreshPriceRates()]);
    return loadRateOnce();
  }

  async function loadDisplayModeOnce() {
    if (displayModeLoaded) return cachedDisplayMode;
    try {
      const res = await chrome.storage.sync.get(CFG.modeKey);
      cachedDisplayMode = normalizeDisplayMode(res[CFG.modeKey]);
    } catch {}
    displayModeLoaded = true;
    return cachedDisplayMode;
  }

  async function refreshDisplayMode() {
    displayModeLoaded = false;
    return loadDisplayModeOnce();
  }

  function scanSide(rate, currency) {
    restoreAllReplacedContainers();
    restoreAllReplacedTextNodes();
    const bestByAnchor = buildBestCandidates(
      CFG.maxCandidates,
      getPriceClassHints(),
      getFocusedRootSelectors(),
      getSignClassHints(),
      getNumberClassHints(),
      getDecimalClassHints(),
      getSplitRootHints(),
      () => stopped
    );
    for (const [anchor, chosen] of bestByAnchor.entries()) {
      ensureOneBadge(anchor, makeBadgeText(chosen.value, rate, currency), currency);
    }
    cleanupOrphans();
  }

  function scanReplace(rate, currency) {
    restoreAllReplacedContainers();
    restoreAllReplacedTextNodes();
    removeAllBadges();

    const priceHints = getPriceClassHints();
    const signHints = getSignClassHints();
    const numberHints = getNumberClassHints();
    const decimalHints = getDecimalClassHints();
    const splitRootHints = getSplitRootHints();
    const focusedRootSelectors = getFocusedRootSelectors();

    const fallbackSide = new Map();
    let fallbackSeq = 0;
    const addFallback = (anchor, value, score) => {
      if (!anchor) return;
      if (!Number.isFinite(value) || value <= 0 || value > 99999999) return;
      const next = { value, score: Number(score) || 0, idx: fallbackSeq++ };
      const prev = fallbackSide.get(anchor);
      if (isBetterCandidate(next, prev)) fallbackSide.set(anchor, next);
    };

    const nodes = document.querySelectorAll("span, div, em, strong, b, i, p");
    let count = 0;
    for (const el of nodes) {
      if (stopped) return;
      if (++count > CFG.maxCandidates) break;
      if (!looksPurePriceEl(el, priceHints)) continue;

      const cny = parsePureCny(el.textContent);
      if (cny == null) continue;

      if (replacePurePriceEl(el, cny, rate, currency, priceHints)) {
        continue;
      } else {
        const score = 120 + scorePriceCandidateEl(el, norm(el.textContent || ""), priceHints);
        addFallback(pickAnchor(el), cny, score);
      }
    }

    const containers = findCandidateContainers(CFG.maxCandidates, priceHints, focusedRootSelectors);
    for (const c of containers) {
      if (stopped) return;
      if (c.hasAttribute(REPLACED_TEXT_ATTR) || c.querySelector(`[${REPLACED_TEXT_ATTR}]`)) continue;

      const parsed = parseSplitPriceFromContainer(c, priceHints, signHints, numberHints, decimalHints, splitRootHints);
      if (!parsed) continue;

      if (replaceSplitPriceContainer(c, parsed.value, rate, currency, signHints, numberHints, decimalHints, splitRootHints)) {
        continue;
      } else {
        const score = 40 + (Number(parsed.score) || 0);
        addFallback(pickAnchor(c), parsed.value, score);
      }
    }

    for (const [anchor, chosen] of fallbackSide.entries()) {
      ensureOneBadge(anchor, makeBadgeText(chosen.value, rate, currency), currency);
    }

    cleanupOrphans();
  }

  async function scan() {
    if (stopped) return;
    const [currency, rates, mode] = await Promise.all([
      loadPriceCurrencyOnce(),
      loadPriceRatesOnce(),
      loadDisplayModeOnce(),
    ]);
    const rate = normalizeRate(rates[currency], CFG.defaultRates[currency]);
    if (mode === DISPLAY_MODE.REPLACE) {
      scanReplace(rate, currency);
      return;
    }
    scanSide(rate, currency);
  }

  function scheduleScan() {
    if (stopped || scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, CFG.scanDebounceMs);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    stopWatching();
    stopWatchingStorage();
    restoreAllReplacedContainers();
    restoreAllReplacedTextNodes();
    removeAllBadges();
  }

  function watchRateAndModeChanges() {
    if (!chrome?.storage?.onChanged) return () => {};

    const listener = (changes, areaName) => {
      if (areaName !== "sync") return;
      if (!changes[CFG.rateKey] && !changes[CFG.ratesKey] && !changes[CFG.currencyKey] && !changes[CFG.modeKey] && !changes.priceRateMode) {
        return;
      }

      const tasks = [];
      if (changes[CFG.rateKey] || changes[CFG.ratesKey]) tasks.push(refreshPriceRates());
      if (changes[CFG.currencyKey]) tasks.push(refreshPriceCurrency());
      if (changes[CFG.modeKey]) tasks.push(refreshDisplayMode());
      Promise.all(tasks).finally(() => scheduleScan());
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {}
    };
  }

  function bootstrap({ runtime: runtimeApi, moduleId, defaultEnabled }) {
    if (initialized) return;

    activeSite = siteManager.resolveActive(location.hostname);
    if (!activeSite) return;

    runtime = runtimeApi;
    currentModuleId = moduleId;
    currentDefaultEnabled = defaultEnabled;
    initialized = true;

    scheduleScan();

    observer = new MutationObserver(() => scheduleScan());
    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}

    stopWatchingStorage = watchRateAndModeChanges();
    stopWatching = runtime.watchModuleEnabled(currentModuleId, currentDefaultEnabled, (enabled) => {
      if (!enabled) stop();
    });
  }

  globalThis.__xh_price_brl = {
    CFG,
    sites: siteManager.sites,
    registerSite: siteManager.register,
    resolveActiveSite: siteManager.resolveActive,
    bootstrap,
  };
})();
