// src/content-scripts/modules/quality_sellers_panel/sites/goofish.js
(() => {
  "use strict";

  const panel = globalThis.__xh_quality_sellers_panel;
  if (!panel?.registerSite) return;

  panel.registerSite({
    siteId: "goofish",
    panelTitle: "Vendedores",
    panelTopPx: 60,
    panelLeftPx: 10,
    defaultListKey: "nico",
    defaultListLabel: "Recomendacoes Nico",
  });
})();
