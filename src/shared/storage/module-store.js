// module-store.js
// Storage layer para configuracoes de modulos. Constantes de preco vem de XH.priceConstants.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const { KEYS } = XH;
  const P = XH.priceConstants;
  const siteRegistry = XH.siteRegistry;

  const { normalizeSiteId } = siteRegistry;

  function getKnownSiteIds() {
    const defs = Array.isArray(siteRegistry?.SITE_DEFS) ? siteRegistry.SITE_DEFS : [];
    return defs.map((site) => normalizeSiteId(site?.id)).filter(Boolean);
  }

  function normalizeModuleSiteOverrides(value) {
    const raw = value && typeof value === "object" ? value : {};
    const knownSiteIds = new Set(getKnownSiteIds());
    const out = {};

    Object.entries(raw).forEach(([moduleIdRaw, siteIdsRaw]) => {
      const moduleId = String(moduleIdRaw || "").trim();
      if (!moduleId || !Array.isArray(siteIdsRaw)) return;

      const seen = new Set();
      const normalizedSites = siteIdsRaw
        .map((siteId) => normalizeSiteId(siteId))
        .filter((siteId) => siteId && knownSiteIds.has(siteId) && !seen.has(siteId) && seen.add(siteId));

      out[moduleId] = normalizedSites;
    });

    return out;
  }

  async function getGlobalEnabled() {
    const d = await chrome.storage.sync.get(KEYS.ENABLED);
    return d[KEYS.ENABLED] === true || d[KEYS.ENABLED] === undefined;
  }


  async function setGlobalEnabled(enabled) {
    await chrome.storage.sync.set({ [KEYS.ENABLED]: !!enabled });
  }

  async function getModuleMap() {
    const d = await chrome.storage.sync.get(KEYS.MODULES);
    return d[KEYS.MODULES] || {};
  }

  async function setModuleMap(map) {
    await chrome.storage.sync.set({ [KEYS.MODULES]: map || {} });
  }

  async function getModuleSiteOverrides() {
    const d = await chrome.storage.sync.get(KEYS.MODULE_SITE_OVERRIDES);
    return normalizeModuleSiteOverrides(d[KEYS.MODULE_SITE_OVERRIDES]);
  }

  async function setModuleSiteOverrides(overrides) {
    await chrome.storage.sync.set({
      [KEYS.MODULE_SITE_OVERRIDES]: normalizeModuleSiteOverrides(overrides),
    });
  }

  async function getBadgePrefs(defaults = { acbuy: true, cssbuy: false }) {
    const d = await chrome.storage.sync.get(KEYS.BADGES);
    return { ...defaults, ...(d[KEYS.BADGES] || {}) };
  }

  async function setBadgePrefs(next) {
    await chrome.storage.sync.set({ [KEYS.BADGES]: next || {} });
  }

  async function getPriceCurrency(defaultCurrency) {
    const d = await chrome.storage.sync.get(KEYS.PRICE_CURRENCY);
    return P.normalizePriceCurrency(d[KEYS.PRICE_CURRENCY], defaultCurrency);
  }

  async function setPriceCurrency(currency) {
    await chrome.storage.sync.set({
      [KEYS.PRICE_CURRENCY]: P.normalizePriceCurrency(currency),
    });
  }

  async function getPriceRates() {
    const d = await chrome.storage.sync.get(KEYS.PRICE_RATES);
    return P.normalizePriceRates(d[KEYS.PRICE_RATES]);
  }

  async function setPriceRates(rates) {
    const normalized = P.normalizePriceRates(rates);
    await chrome.storage.sync.set({
      [KEYS.PRICE_RATES]: normalized,
    });
  }

  async function getRate(defaultRate, currency) {
    const [selectedCurrency, rates] = await Promise.all([
      getPriceCurrency(),
      getPriceRates(),
    ]);
    const safeCurrency = P.normalizePriceCurrency(currency, selectedCurrency);
    return P.normalizeRate(rates[safeCurrency], defaultRate);
  }

  async function setRate(rate, currency) {
    const safeCurrency = P.normalizePriceCurrency(currency, await getPriceCurrency());
    const rates = await getPriceRates();
    const normalized = {
      ...rates,
      [safeCurrency]: P.normalizeRate(rate, rates[safeCurrency] ?? P.DEFAULT_RATE),
    };
    await setPriceRates(normalized);
  }

  async function getPriceDisplayMode(defaultMode) {
    const d = await chrome.storage.sync.get(KEYS.PRICE_DISPLAY_MODE);
    return P.normalizePriceDisplayMode(d[KEYS.PRICE_DISPLAY_MODE] || defaultMode);
  }

  async function setPriceDisplayMode(mode) {
    await chrome.storage.sync.set({
      [KEYS.PRICE_DISPLAY_MODE]: P.normalizePriceDisplayMode(mode),
    });
  }

  XH.moduleStore = {
    getGlobalEnabled,
    setGlobalEnabled,
    getModuleMap,
    setModuleMap,
    getModuleSiteOverrides,
    setModuleSiteOverrides,
    getBadgePrefs,
    setBadgePrefs,
    getPriceCurrency,
    setPriceCurrency,
    getPriceRates,
    setPriceRates,
    getRate,
    setRate,
    getPriceDisplayMode,
    setPriceDisplayMode,
    normalizeModuleSiteOverrides,
  };
})();
