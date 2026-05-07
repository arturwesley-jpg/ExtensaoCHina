// src/content-scripts/modules/title_site/sites/taobao.js
(() => {
  "use strict";

  const titleSite = globalThis.__xh_title_site;
  if (!titleSite?.registerSite) return;

  titleSite.registerSite({
    siteId: "taobao",
    getTitle() {
      return "Taobao";
    },
  });
})();
