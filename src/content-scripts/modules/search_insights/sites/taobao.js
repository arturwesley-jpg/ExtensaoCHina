// src/content-scripts/modules/search_insights/sites/taobao.js
(() => {
  "use strict";

  const insights = globalThis.__xh_search_insights;
  if (!insights?.registerSite) return;

  insights.registerSite({
    siteId: "taobao",
    urlQueryKeys: [
      "q",
      "query",
      "keyword",
      "keywords",
      "search",
      "searchtext",
      "search_text",
    ],
    searchInputSelectors: [
      'input[name="q"]',
      "input#q",
      'input[type="search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="搜"]',
      'input[placeholder*="关键"]',
      'input[placeholder*="商品"]',
    ],
    isTrackableInput(target, { asString }) {
      if (!target || target.tagName !== "INPUT") return false;
      const input = target;
      if (input.disabled || input.readOnly) return false;
      const type = asString(input.type).toLowerCase();
      if (type && !["text", "search", ""].includes(type)) return false;
      const name = asString(input.name).toLowerCase();
      const id = asString(input.id).toLowerCase();
      if (name === "q" || id === "q") return true;
      const attrs = `${name} ${id} ${asString(input.placeholder)}`.toLowerCase();
      return (
        attrs.includes("search") ||
        attrs.includes("搜") ||
        attrs.includes("关键") ||
        attrs.includes("商品")
      );
    },
  });
})();
