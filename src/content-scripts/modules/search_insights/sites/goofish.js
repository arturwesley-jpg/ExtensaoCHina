// src/content-scripts/modules/search_insights/sites/goofish.js
(() => {
  "use strict";

  const insights = globalThis.__xh_search_insights;
  if (!insights?.registerSite) return;

  insights.registerSite({
    siteId: "goofish",
    urlQueryKeys: [
      "q",
      "query",
      "keyword",
      "keywords",
      "key",
      "kw",
      "word",
      "search",
      "searchtext",
      "search_text",
    ],
    searchInputSelectors: [
      'input[type="search"]',
      'input[name*="search"]',
      'input[id*="search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="搜"]',
      'input[placeholder*="关键"]',
      'input[placeholder*="商品"]',
    ],
  });
})();
