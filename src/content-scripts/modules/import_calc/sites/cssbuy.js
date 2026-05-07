// src/content-scripts/modules/import_calc/sites/cssbuy.js
(() => {
  "use strict";

  const calc = globalThis.__xh_import_calc;
  if (!calc?.registerSite) return;

  calc.registerSite({
    siteId: "cssbuy",
    panelTopPx: 60,
    panelLeftPx: 10,
    agentFilter: "cssbuy",
    extractPrice() {
      // CSSBuy product page: look for price elements (CNY)
      const selectors = [
        ".goods-info .price",
        ".product-price",
        ".item-price .num",
        "[class*='goodsPrice']",
        "[class*='price'] b",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = (el.textContent || "").replace(/[^\d.]/g, "");
        const num = parseFloat(text);
        if (Number.isFinite(num) && num > 0) return num;
      }
      // Fallback: regex scan for price pattern
      const allPrices = document.querySelectorAll("[class*='price'],[class*='Price']");
      for (const el of allPrices) {
        const match = (el.textContent || "").match(/[\u00a5\uffe5]?\s*(\d+(?:\.\d{1,2})?)/);
        if (match) {
          const num = parseFloat(match[1]);
          if (Number.isFinite(num) && num > 0.5) return num;
        }
      }
      return 0;
    },
  });
})();
