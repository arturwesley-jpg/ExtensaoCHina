// src/content-scripts/modules/acbuy_badge/sites/taobao.js
// Strategy for taobao.com — item ID extraction + agent URL builders
(() => {
  "use strict";

  const ab = globalThis.__xh_ab;

  const ACBUY_TB_DEFAULT = "https://www.acbuy.com/product?url=";
  const CSSBUY_TB_DEFAULT = "https://www.cssbuy.com/item-taobao-";

  let acbuyUrl = ACBUY_TB_DEFAULT;
  let cssbuyUrl = CSSBUY_TB_DEFAULT;

  // Load remote URLs (non-blocking, fallback to defaults)
  chrome.storage.local.get("xh_remote_config_v1").then((data) => {
    const urls = data?.xh_remote_config_v1?.agent_urls;
    if (urls?.acbuy?.taobao) acbuyUrl = String(urls.acbuy.taobao);
    if (urls?.cssbuy?.taobao) cssbuyUrl = String(urls.cssbuy.taobao);
  }).catch(() => {});

  function extractItemIdFromUrl(rawUrl) {
    const candidate = String(rawUrl || "").trim();
    if (!candidate) return null;

    try {
      const u = new URL(candidate);
      const directId = u.searchParams.get("id");
      if (directId && /^\d{6,}$/.test(directId)) return directId;

      const nestedUrl = u.searchParams.get("redirectURL") || u.searchParams.get("redirectUrl");
      if (!nestedUrl) return null;

      const decoded = decodeURIComponent(nestedUrl);
      if (decoded && decoded !== candidate) {
        return extractItemIdFromUrl(decoded);
      }
      return null;
    } catch {
      return null;
    }
  }

  function getItemId() {
    const direct = extractItemIdFromUrl(location.href);
    if (direct) return direct;

    const isLoginPage = /(^|\.)login\.taobao\.com$/i.test(location.hostname) ||
      /\/login\//i.test(location.pathname);
    if (!isLoginPage) return null;

    return extractItemIdFromUrl(document.referrer);
  }

  ab.registerSite({
    siteId: "taobao",
    getItemId,

    buildUrl(agentId) {
      const id = getItemId();
      if (!id) return null;
      if (agentId === "acbuy") {
        const itemUrl = `https://item.taobao.com/item.htm?id=${id}`;
        return acbuyUrl + encodeURIComponent(itemUrl);
      }
      if (agentId === "cssbuy") {
        return `${cssbuyUrl}${encodeURIComponent(id)}.html?promotionCode=5f81f9524c47166a`;
      }
      return null;
    },
  });
})();
