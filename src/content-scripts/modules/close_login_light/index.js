// src/content-scripts/modules/close_login_light/index.js
// Boot: filters active site, injects CSS, starts observer, lifecycle
(() => {
  "use strict";

  const MODULE_ID = "close_login_light";
  const DEFAULT_ON = true;

  const cll = globalThis.__xh_cll;
  const runtime = globalThis.XHContentRuntime || {
    isModuleEnabled: async () => DEFAULT_ON,
    isSupportedHost: () => false,
    watchModuleEnabled: () => () => {},
  };

  if (!cll?.resolveActiveSites) return;
  if (!runtime.isSupportedHost()) return;

  const activeSites = cll.resolveActiveSites(location.hostname);
  if (!activeSites.length) return;

  let running = false;
  let lastRun = 0;
  let observer = null;
  let timeoutId = 0;
  let rafId = 0;
  let stopWatching = () => {};

  function runSiteCriticalSweep() {
    for (const site of activeSites) {
      site.injectCSS();
      site.criticalSweep?.();
      site.hideKnown();
    }
  }

  function sweep() {
    if (!running) return;
    runSiteCriticalSweep();
    const searchFocused = cll.isSearchInputFocused();
    // Site sweeps use specific selectors so they're safe even with search focused.
    // Footer bar detection is skipped when search input is focused to avoid
    // misidentifying the search bar as a login footer.
    let siteHandled = false;
    for (const site of activeSites) {
      if (site.sweep()) siteHandled = true;
    }
    const footerHandled = searchFocused ? false : cll.handleFooterBar();
    if (footerHandled || siteHandled) {
      cll.unlockScroll();
    }
  }

  function clearScheduledSweep() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = 0;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function scheduleSweep() {
    if (!running || timeoutId || rafId) return;
    const now = Date.now();

    if (now - lastRun < cll.CFG.debounceMs) {
      timeoutId = setTimeout(() => {
        timeoutId = 0;
        if (!running) return;
        lastRun = Date.now();
        sweep();
      }, cll.CFG.debounceMs);
      return;
    }

    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!running) return;
      lastRun = Date.now();
      sweep();
    });
  }

  function onResize() {
    if (!running) return;
    for (const site of activeSites) {
      site.onResize();
    }
  }

  function activate() {
    if (running) return;
    running = true;

    window.addEventListener("resize", onResize, { passive: true });
    observer = new MutationObserver(() => scheduleSweep());
    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden"],
      });
    } catch {}

    runSiteCriticalSweep();
    scheduleSweep();
  }

  function deactivate() {
    if (!running && !observer) return;
    running = false;
    clearScheduledSweep();
    try { observer?.disconnect(); } catch {}
    observer = null;
    window.removeEventListener("resize", onResize);
    for (const site of activeSites) {
      site.cleanup();
    }
    cll.unlockScroll();
    cll.unhideMarkedFooterBars();
  }

  stopWatching = runtime.watchModuleEnabled(MODULE_ID, DEFAULT_ON, (enabled) => {
    if (enabled) activate();
    else deactivate();
  });

  Promise.resolve(runtime.isModuleEnabled(MODULE_ID, DEFAULT_ON))
    .then((enabled) => {
      if (enabled) activate();
      else deactivate();
    })
    .catch(() => {
      if (DEFAULT_ON) activate();
    });

  window.addEventListener("unload", () => {
    deactivate();
    stopWatching();
  });
})();
