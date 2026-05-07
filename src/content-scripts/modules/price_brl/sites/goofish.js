// src/content-scripts/modules/price_brl/sites/goofish.js
(() => {
  "use strict";

  const priceBrl = globalThis.__xh_price_brl;
  if (!priceBrl?.registerSite) return;

  priceBrl.registerSite({
    siteId: "goofish",
    focusedRootSelectors: [
      "[class*='wrap-price--']",
      "[class*='price-wrap--']",
      "[class*='price--']",
      "[class*='value--']",
      "[class*='headPrice--']",
      "[class*='mainPrice--']",
      "[class*='skuPrice--']",
      "[class*='comPrice--']",
      "[class*='priceText--']",
      "[class*='priceSign--']",
    ],
    splitRootHints: [
      "price-wrap--",
      "wrap-price--",
      "price--",
      "value--",
      "headprice--",
      "mainprice--",
      "skuprice--",
      "comprice--",
    ],
  });
})();
