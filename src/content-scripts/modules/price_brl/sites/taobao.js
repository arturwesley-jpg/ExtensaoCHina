// src/content-scripts/modules/price_brl/sites/taobao.js
(() => {
  "use strict";

  const priceBrl = globalThis.__xh_price_brl;
  if (!priceBrl?.registerSite) return;

  priceBrl.registerSite({
    siteId: "taobao",
    focusedRootSelectors: [
      "[class*='price--']",
      "[class*='priceText--']",
      "[class*='tb-rmb-num']",
      "[class*='tb-price']",
      "[class*='main-price']",
      "[class*='price-content']",
    ],
    priceClassHints: [
      "tb-rmb",
      "tb-price",
      "price-content",
      "main-price",
      "price-now",
    ],
    splitRootHints: [
      "tb-rmb",
      "tb-price",
      "price-content",
      "main-price",
      "price--",
    ],
    signClassHints: [
      "tb-rmb",
      "symbol",
      "yen",
    ],
    numberClassHints: [
      "tb-rmb-num",
      "tb-price",
      "price-content",
      "main-price",
    ],
  });
})();
