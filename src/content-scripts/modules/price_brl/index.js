// src/content-scripts/modules/price_brl/index.js
(() => {
  "use strict";

  const MODULE_ID = "price_brl";
  const DEFAULT_ON = false;
  const runtime = globalThis.XHContentRuntime || {
    isSupportedHost: () => false,
    watchModuleEnabled: () => () => {},
  };
  const priceBrl = globalThis.__xh_price_brl;

  if (!runtime.isSupportedHost()) return;
  if (!priceBrl?.bootstrap) return;

  priceBrl.bootstrap({ runtime, moduleId: MODULE_ID, defaultEnabled: DEFAULT_ON });
})();
