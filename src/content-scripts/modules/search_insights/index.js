// src/content-scripts/modules/search_insights/index.js
(() => {
  "use strict";

  const MODULE_ID = "search_insights";
  const DEFAULT_ON = true;
  const runtime = globalThis.XHContentRuntime || {
    isModuleEnabled: async () => DEFAULT_ON,
    watchModuleEnabled: () => () => {},
    watchUrlChanges: () => () => {},
  };
  const insights = globalThis.__xh_search_insights;

  if (!insights?.bootstrap) return;
  insights.bootstrap({ runtime, moduleId: MODULE_ID, defaultEnabled: DEFAULT_ON });
})();
