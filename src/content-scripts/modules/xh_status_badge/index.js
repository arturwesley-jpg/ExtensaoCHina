// src/content-scripts/modules/xh_status_badge/index.js
(() => {
  "use strict";

  const badge = globalThis.__xh_status_badge;
  if (!badge?.init) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => badge.init(), { once: true });
  } else {
    badge.init();
  }
})();
