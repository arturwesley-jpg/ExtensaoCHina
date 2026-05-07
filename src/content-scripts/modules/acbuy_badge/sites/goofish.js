// src/content-scripts/modules/acbuy_badge/sites/goofish.js
// Strategy for goofish.com — item ID extraction + agent URL builders
(() => {
  "use strict";

  const ab = globalThis.__xh_ab;

  const ACBUY_DEFAULT = "https://www.acbuy.com/product?url=";
  const CSSBUY_DEFAULT = "https://www.cssbuy.com/item-xianyu-";

  let acbuyUrl = ACBUY_DEFAULT;
  let cssbuyUrl = CSSBUY_DEFAULT;

  // Load remote URLs (non-blocking, fallback to defaults)
  chrome.storage.local.get("xh_remote_config_v1").then((data) => {
    const urls = data?.xh_remote_config_v1?.agent_urls;
    if (urls?.acbuy?.goofish) acbuyUrl = String(urls.acbuy.goofish);
    if (urls?.cssbuy?.goofish) cssbuyUrl = String(urls.cssbuy.goofish);
  }).catch(() => {});

  function getItemId() {
    try {
      const u = new URL(location.href);
      if (!/\/item\b/i.test(u.pathname)) return null;
      const id = u.searchParams.get("id");
      if (!id) return null;
      if (!/^\d{6,}$/.test(id)) return null;
      return id;
    } catch {
      return null;
    }
  }

  ab.registerSite({
    siteId: "goofish",
    getItemId,

    buildUrl(agentId) {
      const id = getItemId();
      if (!id) return null;
      if (agentId === "acbuy") {
        const itemUrl = `https://www.goofish.com/item?id=${id}`;
        return acbuyUrl + encodeURIComponent(itemUrl);
      }
      if (agentId === "cssbuy") {
        return `${cssbuyUrl}${encodeURIComponent(id)}.html?promotionCode=5f81f9524c47166a`;
      }
      return null;
    },
  });
})();
