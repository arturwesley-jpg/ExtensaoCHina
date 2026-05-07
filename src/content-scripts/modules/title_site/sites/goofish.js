// src/content-scripts/modules/title_site/sites/goofish.js
(() => {
  "use strict";

  const titleSite = globalThis.__xh_title_site;
  if (!titleSite?.registerSite) return;

  titleSite.registerSite({
    siteId: "goofish",
    getTitle() {
      return "Xianyu";
    },
  });
})();
