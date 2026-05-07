// src/content-scripts/modules/import_calc/sites/goofish.js
(() => {
  "use strict";

  const calc = globalThis.__xh_import_calc;
  if (!calc?.registerSite) return;

  calc.registerSite({
    siteId: "goofish",
    panelLeftPx: 10,
    agentFilter: null,
    extractPrice() {
      // 1. Look for price containers with ¥ symbol
      const priceSelectors = [
        "[class*='headPrice--']",
        "[class*='mainPrice--']",
        "[class*='skuPrice--']",
        "[class*='wrap-price--']",
        "[class*='price-wrap--']",
        "[class*='price--']",
      ];
      for (const sel of priceSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent || "";
          // Match ¥ or ￥ followed by number
          const match = text.match(/[\u00a5\uffe5]\s*(\d+(?:\.\d{1,2})?)/);
          if (match) {
            const num = parseFloat(match[1]);
            if (Number.isFinite(num) && num >= 1) return num;
          }
        }
      }
      // 2. Broader fallback: any visible element with ¥ + number
      const all = document.querySelectorAll("[class*='price'],[class*='Price']");
      for (const el of all) {
        const text = el.textContent || "";
        const match = text.match(/[\u00a5\uffe5]\s*(\d+(?:\.\d{1,2})?)/);
        if (match) {
          const num = parseFloat(match[1]);
          if (Number.isFinite(num) && num >= 1) return num;
        }
      }
      return 0;
    },
  });
})();
