// src/content-scripts/modules/import_calc/sites/acbuy.js
(() => {
  "use strict";

  const calc = globalThis.__xh_import_calc;
  if (!calc?.registerSite) return;

  calc.registerSite({
    siteId: "acbuy",
    panelTopPx: 60,
    panelLeftPx: 10,
    agentFilter: "acbuy",
    extractPrice() {
      // ACBuy product page: look for price elements (CNY)
      const selectors = [
        ".product-price .price",
        ".goods-price",
        "[class*='price'] .num",
        "[class*='Price'] span",
        ".item-price",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = (el.textContent || "").replace(/[^\d.]/g, "");
        const num = parseFloat(text);
        if (Number.isFinite(num) && num > 0) return num;
      }
      // Fallback: search for a price pattern in the page
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
