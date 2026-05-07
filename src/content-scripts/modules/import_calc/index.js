// src/content-scripts/modules/import_calc/index.js
(() => {
  "use strict";

  const MODULE_ID = "import_calc";
  const DEFAULT_ON = false;

  const runtime = globalThis.XHContentRuntime;
  const calc = globalThis.__xh_import_calc;

  if (!runtime || !calc?.bootstrap) {
    console.warn("[import_calc] runtime or module not available");
    return;
  }

  calc.bootstrap({ runtime, moduleId: MODULE_ID, defaultEnabled: DEFAULT_ON });
})();
