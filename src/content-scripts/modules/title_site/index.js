// src/content-scripts/modules/title_site/index.js
(() => {
  "use strict";

  const MODULE_ID = "title_site";
  const DEFAULT_ON = true;
  const runtime = globalThis.XHContentRuntime || {
    watchModuleEnabled: () => () => {},
  };
  const titleSite = globalThis.__xh_title_site;

  if (!titleSite?.bootstrap) return;
  titleSite.bootstrap({ runtime, moduleId: MODULE_ID, defaultEnabled: DEFAULT_ON });
})();
