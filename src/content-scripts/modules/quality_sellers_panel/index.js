// src/content-scripts/modules/quality_sellers_panel/index.js
(() => {
  "use strict";

  const MODULE_ID = "quality_sellers_panel";
  const DEFAULT_ON = true;
  const runtime = globalThis.XHContentRuntime || {
    isModuleEnabled: async () => DEFAULT_ON,
    watchModuleEnabled: () => () => {},
    watchUrlChanges: () => () => {},
  };
  const panel = globalThis.__xh_quality_sellers_panel;

  if (!panel?.bootstrap) return;
  panel.bootstrap({ runtime, moduleId: MODULE_ID, defaultEnabled: DEFAULT_ON });
})();
