(() => {
  "use strict";

  const panel = globalThis.__xh_quality_sellers_panel;
  if (!panel?.registerSite) return;

  panel.registerSite({
    siteId: "taobao",
    panelTitle: "Vendedores",
    panelTopPx: 82,
    panelLeftPx: 10,
    defaultListKey: "nico",
    defaultListLabel: "Recomendacoes Nico",
  });
})();
