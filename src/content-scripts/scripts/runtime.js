// src/content-scripts/scripts/runtime.js
(() => {
  "use strict";

  const KEY_ENABLED = "enabled";
  const KEY_MODULES = "moduleEnabled";
  const KEY_MODULE_SITE_OVERRIDES = "moduleSiteOverrides";
  const siteRegistry = globalThis.XH?.siteRegistry;

  function isGoofishHost(hostname = location.hostname) {
    return !!siteRegistry?.matchesSite("goofish", hostname);
  }

  function isTaobaoHost(hostname = location.hostname) {
    return !!siteRegistry?.matchesSite("taobao", hostname);
  }

  function isSupportedHost(hostname = location.hostname) {
    return !!siteRegistry?.isSupportedHost(hostname);
  }

  function getCurrentSiteId(hostname = location.hostname) {
    return siteRegistry?.getCurrentSiteId(hostname) || null;
  }

  function matchesSite(siteId, hostname = location.hostname) {
    return !!siteRegistry?.matchesSite(siteId, hostname);
  }

  function getModuleSiteOverride(overrides, moduleId) {
    if (!overrides || typeof overrides !== "object") return null;
    if (!Object.hasOwn(overrides, moduleId)) return null;
    return Array.isArray(overrides[moduleId]) ? overrides[moduleId] : [];
  }

  async function isModuleEnabled(moduleId, defaultEnabled) {
    try {
      const res = await chrome.storage.sync.get([KEY_ENABLED, KEY_MODULES, KEY_MODULE_SITE_OVERRIDES]);
      const globalOn = res[KEY_ENABLED] ?? true;
      const map = res[KEY_MODULES] ?? {};
      const siteId = getCurrentSiteId();
      const siteOverride = getModuleSiteOverride(res[KEY_MODULE_SITE_OVERRIDES], moduleId);
      const moduleOn = map[moduleId];
      const siteAllowed = !siteId || siteOverride === null ? true : siteOverride.includes(siteId);
      return globalOn && siteAllowed && (moduleOn === undefined ? defaultEnabled : moduleOn);
    } catch {
      return defaultEnabled;
    }
  }

  function watchModuleEnabled(moduleId, defaultEnabled, onChange) {
    if (!chrome?.storage?.onChanged || typeof onChange !== "function") return () => {};

    const listener = (changes, areaName) => {
      if (areaName !== "sync") return;
      if (!changes[KEY_ENABLED] && !changes[KEY_MODULES] && !changes[KEY_MODULE_SITE_OVERRIDES]) return;

      Promise.resolve(isModuleEnabled(moduleId, defaultEnabled))
        .then((enabled) => onChange(enabled))
        .catch(() => {});
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener);
      } catch {}
    };
  }

  function watchUrlChanges(onChange, pollIntervalMs = 1000) {
    if (typeof onChange !== "function") return () => {};

    let lastHref = location.href;
    let timer = null;

    const check = () => {
      const cur = location.href;
      if (cur === lastHref) return;
      lastHref = cur;
      onChange(cur);
    };

    try {
      const origPush = history.pushState;
      history.pushState = function (...args) {
        const ret = origPush.apply(this, args);
        check();
        return ret;
      };

      const origReplace = history.replaceState;
      history.replaceState = function (...args) {
        const ret = origReplace.apply(this, args);
        check();
        return ret;
      };
    } catch {}

    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
    timer = setInterval(check, pollIntervalMs);

    return () => {
      window.removeEventListener("popstate", check);
      window.removeEventListener("hashchange", check);
      if (timer) clearInterval(timer);
    };
  }

  globalThis.XHContentRuntime = {
    siteRegistry,
    matchesSite,
    getCurrentSiteId,
    isGoofishHost,
    isTaobaoHost,
    isSupportedHost,
    isModuleEnabled,
    watchModuleEnabled,
    watchUrlChanges,
  };
})();
