"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});

  const SITE_DEFS = Object.freeze([
    Object.freeze({
      id: "goofish",
      label: "Goofish",
      hostPatterns: Object.freeze([/(^|\.)goofish\.com$/i]),
      matches: Object.freeze([
        "https://www.goofish.com/*",
        "https://*.goofish.com/*",
      ]),
    }),
    Object.freeze({
      id: "taobao",
      label: "Taobao",
      hostPatterns: Object.freeze([/(^|\.)taobao\.com$/i]),
      matches: Object.freeze([
        "https://*.taobao.com/*",
      ]),
    }),
  ]);

  const SITE_ID_SET = new Set(SITE_DEFS.map((site) => site.id));

  function normalizeSiteId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeHostname(value = location.hostname) {
    return String(value || "").trim().toLowerCase();
  }

  function getSite(siteId) {
    const normalized = normalizeSiteId(siteId);
    return SITE_DEFS.find((site) => site.id === normalized) || null;
  }

  function matchesSite(siteId, hostname = location.hostname) {
    const site = getSite(siteId);
    if (!site) return false;
    const host = normalizeHostname(hostname);
    return site.hostPatterns.some((pattern) => pattern.test(host));
  }

  function getCurrentSiteId(hostname = location.hostname) {
    const host = normalizeHostname(hostname);
    return SITE_DEFS.find((site) => site.hostPatterns.some((pattern) => pattern.test(host)))?.id || null;
  }

  function isSupportedHost(hostname = location.hostname) {
    return !!getCurrentSiteId(hostname);
  }

  function getMatches(siteIds) {
    const out = [];
    const seen = new Set();
    const ids = Array.isArray(siteIds) ? siteIds : [siteIds];

    ids.forEach((siteId) => {
      const site = getSite(siteId);
      if (!site) return;
      site.matches.forEach((match) => {
        if (seen.has(match)) return;
        seen.add(match);
        out.push(match);
      });
    });

    return out;
  }

  function getAllMatches() {
    return getMatches(SITE_DEFS.map((site) => site.id));
  }

  function createModuleSiteManager() {
    const sites = [];

    function register(strategy) {
      const siteId = normalizeSiteId(strategy?.siteId || strategy?.id);
      if (!SITE_ID_SET.has(siteId)) return null;

      const next = Object.freeze({
        ...(strategy || {}),
        siteId,
      });
      const index = sites.findIndex((site) => site.siteId === siteId);
      if (index >= 0) sites.splice(index, 1, next);
      else sites.push(next);
      return next;
    }

    function resolveActive(hostname = location.hostname) {
      const siteId = getCurrentSiteId(hostname);
      if (!siteId) return null;
      return sites.find((site) => site.siteId === siteId) || null;
    }

    function resolveAll(hostname = location.hostname) {
      const siteId = getCurrentSiteId(hostname);
      if (!siteId) return [];
      return sites.filter((site) => site.siteId === siteId);
    }

    return {
      sites,
      register,
      resolveActive,
      resolveAll,
    };
  }

  XH.siteRegistry = {
    SITE_DEFS,
    normalizeSiteId,
    getSite,
    matchesSite,
    getCurrentSiteId,
    isSupportedHost,
    getMatches,
    getAllMatches,
    createModuleSiteManager,
  };
})();
