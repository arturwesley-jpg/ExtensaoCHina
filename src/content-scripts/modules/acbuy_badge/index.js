// src/content-scripts/modules/acbuy_badge/index.js
(() => {
  "use strict";

  const MODULE_ID = "acbuy_badge";
  const DEFAULT_ON = true;
  const runtime = globalThis.XHContentRuntime || {
    isSupportedHost: () => false,
    isModuleEnabled: async () => DEFAULT_ON,
    watchModuleEnabled: () => () => {},
    watchUrlChanges: () => () => {},
  };
  const badge = globalThis.__xh_ab;

  if (!runtime.isSupportedHost()) return;
  if (!badge?.resolveActiveSite) return;

  let stopped = false;
  let stopWatching = () => {};
  let stopWatchingUrl = () => {};

  async function refreshBadges() {
    if (stopped) return;

    const activeSite = badge.resolveActiveSite(location.hostname);
    if (!activeSite) {
      badge.removeBadges();
      return;
    }

    const enabled = await runtime.isModuleEnabled(MODULE_ID, DEFAULT_ON);
    if (!enabled) {
      badge.removeBadges();
      return;
    }

    const prefs = await badge.getBadgePrefs();
    if (!prefs.acbuy && !prefs.cssbuy) {
      badge.removeBadges();
      return;
    }

    badge.renderBadges(activeSite, prefs);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stopWatching();
    stopWatchingUrl();
    badge.removeBadges();
  }

  refreshBadges();

  stopWatching = runtime.watchModuleEnabled(MODULE_ID, DEFAULT_ON, (enabled) => {
    if (!enabled) {
      stop();
      return;
    }
    refreshBadges();
  });

  stopWatchingUrl = runtime.watchUrlChanges(() => {
    refreshBadges();
  });
})();
