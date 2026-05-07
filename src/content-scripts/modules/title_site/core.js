// src/content-scripts/modules/title_site/core.js
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  function getActiveSite() {
    return siteManager.resolveActive(location.hostname);
  }

  function bootstrap({ runtime, moduleId, defaultEnabled }) {
    const activeSite = getActiveSite();
    const targetTitle = activeSite?.getTitle?.();
    if (!targetTitle) return;

    let stopped = false;
    let headObserver = null;
    let stopWatching = () => {};

    function setTitle() {
      if (stopped) return;
      if (document.title !== targetTitle) document.title = targetTitle;
    }

    function startObserver() {
      if (stopped || headObserver) return;
      const head = document.head || document.documentElement;
      if (!head) return;

      headObserver = new MutationObserver(() => setTitle());
      try {
        headObserver.observe(head, { childList: true, subtree: true, characterData: true });
      } catch {}
    }

    function onFocus() {
      setTitle();
    }

    function onVisibility() {
      if (!document.hidden) setTitle();
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      headObserver?.disconnect();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatching();
    }

    setTitle();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTitle();
        startObserver();
      }, { once: true });
    } else {
      startObserver();
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    stopWatching = runtime.watchModuleEnabled(moduleId, defaultEnabled, (enabled) => {
      if (!enabled) stop();
    });
  }

  globalThis.__xh_title_site = {
    sites: siteManager.sites,
    registerSite: siteManager.register,
    resolveActiveSite: siteManager.resolveActive,
    bootstrap,
  };
})();
