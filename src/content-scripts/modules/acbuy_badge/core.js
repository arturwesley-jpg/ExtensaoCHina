// src/content-scripts/modules/acbuy_badge/core.js
// Shared utilities exposed via globalThis.__xh_ab
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const KEY_BADGES = "badgeAgents";
  const MSG_TRACK_SEARCH_EVENT = "XH_TRACK_SEARCH_EVENT";

  const CFG = {
    BADGE_CONTAINER_ID: "__xh_badge_stack__",
    BADGE_ID_PREFIX: "__xh_badge__",
    STYLE_ID: "__xh_badge_style__",
    topPx: 10,
    rightPx: 12,
    gapPx: 10,
    zIndex: 2147483646,
    sizePx: 48,
    maxQueryLength: 220,
    maxPathLength: 400,
  };

  const { asString, sanitizeQuery, normalizeQuery, sanitizePath } = globalThis.XHContentUtils;

  function emitBadgeClickEvent(targetUrl, badgeId, sourceSite) {
    const safeTarget = sanitizeQuery(targetUrl);
    if (safeTarget.length < 2) return;

    const payload = {
      type: MSG_TRACK_SEARCH_EVENT,
      query: safeTarget,
      queryNorm: normalizeQuery(safeTarget),
      sourceSite: asString(sourceSite).toLowerCase() || undefined,
      trigger: `badge_click_${asString(badgeId).toLowerCase() || "unknown"}`,
      pagePath: sanitizePath(location.href),
      ts: Date.now(),
    };

    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  async function getBadgePrefs() {
    try {
      const res = await chrome.storage.sync.get([KEY_BADGES]);
      const prefs = res[KEY_BADGES] || {};
      return {
        acbuy: prefs.acbuy !== false,
        cssbuy: !!prefs.cssbuy,
      };
    } catch {
      return { acbuy: true, cssbuy: false };
    }
  }

  function ensureStyle() {
    if (document.getElementById(CFG.STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = CFG.STYLE_ID;
    style.textContent = `
#${CFG.BADGE_CONTAINER_ID}{
  position:fixed;
  top:${CFG.topPx}px;
  right:${CFG.rightPx}px;
  z-index:${CFG.zIndex};
  display:flex;
  flex-direction:column;
  gap:${CFG.gapPx}px;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge{
  position:relative;
  width:${CFG.sizePx}px;
  height:${CFG.sizePx}px;
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:14px;
  background:#ffffff;
  border:1px solid rgba(0,0,0,.10);
  box-shadow:
    0 10px 24px rgba(0,0,0,.16),
    0 2px 10px rgba(0,0,0,.12),
    0 0 0 1px rgba(0,0,0,.06) inset;
  cursor:pointer;
  text-decoration:none;
  color:inherit;
  user-select:none;
  transition:transform .10s ease, filter .14s ease, border-color .14s ease, box-shadow .14s ease;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge::after{
  content:attr(data-label);
  position:absolute;
  top:50%;
  right:calc(100% + 10px);
  transform:translateY(-50%) translateX(4px);
  opacity:0;
  pointer-events:none;
  white-space:nowrap;
  padding:6px 9px;
  border-radius:999px;
  background:rgba(8,22,43,.92);
  color:#ffffff;
  font:700 11px/1.2 "Segoe UI","Helvetica Neue",Arial,sans-serif;
  letter-spacing:.01em;
  box-shadow:0 8px 20px rgba(0,0,0,.18);
  transition:opacity .14s ease, transform .14s ease;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge:hover{
  transform:translateY(-1px);
  border-color:rgba(0,0,0,.18);
  filter:brightness(1.01);
  box-shadow:
    0 12px 28px rgba(0,0,0,.20),
    0 0 0 1px rgba(0,0,0,.08) inset;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge:hover::after,
#${CFG.BADGE_CONTAINER_ID} .xh-badge:focus-visible::after{
  opacity:1;
  transform:translateY(-50%) translateX(0);
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge:active{
  transform:translateY(0px) scale(.99);
  filter:brightness(1.02);
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge:focus-visible{
  outline:none;
  box-shadow:
    0 0 0 3px rgba(59,130,246,.22),
    0 12px 28px rgba(0,0,0,.20),
    0 0 0 1px rgba(0,0,0,.08) inset;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge .xh-badge__icon{
  width:calc(${CFG.sizePx}px - 14px);
  height:calc(${CFG.sizePx}px - 14px);
  display:flex;
  align-items:center;
  justify-content:center;
  border-radius:10px;
  background:#ffffff;
}

#${CFG.BADGE_CONTAINER_ID} .xh-badge img{
  width:82%;
  height:82%;
  object-fit:contain;
  display:block;
  border-radius:8px;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.28));
}

@media (prefers-reduced-motion: reduce){
  #${CFG.BADGE_CONTAINER_ID} .xh-badge{ transition:none; }
}
    `.trim();

    document.documentElement.appendChild(style);
  }

  function getRenderableBadges(site, prefs) {
    if (!site || typeof site.buildUrl !== "function") return [];

    const badges = [
      {
        id: "acbuy",
        title: "Abrir no ACBuy",
        img: "assets/images/acbuy.png",
      },
      {
        id: "cssbuy",
        title: "Abrir no CSSBuy",
        img: "assets/images/cssbuy.png",
      },
    ];

    const out = [];
    for (const badge of badges) {
      if (badge.id === "acbuy" && !prefs.acbuy) continue;
      if (badge.id === "cssbuy" && !prefs.cssbuy) continue;

      const targetUrl = asString(site.buildUrl(badge.id));
      if (!targetUrl) continue;
      out.push({ ...badge, targetUrl });
    }
    return out;
  }

  function renderBadges(site, prefs) {
    const actionableBadges = getRenderableBadges(site, prefs);
    if (!actionableBadges.length) {
      removeBadges();
      return;
    }

    ensureStyle();

    let container = document.getElementById(CFG.BADGE_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = CFG.BADGE_CONTAINER_ID;
      document.documentElement.appendChild(container);
    }
    container.replaceChildren();

    if (!container._xhClickHandler) {
      container._xhClickHandler = (e) => {
        const badge = e.target.closest(".xh-badge");
        if (!badge) return;
        const badgeId = badge.id?.replace(CFG.BADGE_ID_PREFIX + "_", "") || "";
        const targetUrl = badge.href || "";
        const siteObj = siteManager.resolveActive();
        emitBadgeClickEvent(targetUrl, badgeId, siteObj?.siteId);
      };
      container.addEventListener("click", container._xhClickHandler);
    }

    for (const badge of actionableBadges) {
      const btn = document.createElement("a");
      btn.id = `${CFG.BADGE_ID_PREFIX}_${badge.id}`;
      btn.className = "xh-badge";
      btn.title = badge.title;
      btn.href = badge.targetUrl;
      btn.target = "_blank";
      btn.rel = "noopener noreferrer";
      btn.setAttribute("aria-label", badge.title);
      btn.setAttribute("data-label", badge.title);

      const iconWrap = document.createElement("div");
      iconWrap.className = "xh-badge__icon";

      const img = document.createElement("img");
      img.alt = badge.title;
      img.draggable = false;
      img.src = chrome.runtime.getURL(badge.img);

      iconWrap.appendChild(img);
      btn.appendChild(iconWrap);
      container.appendChild(btn);
    }
  }

  function removeBadges() {
    document.getElementById(CFG.BADGE_CONTAINER_ID)?.remove();
    document.getElementById(CFG.STYLE_ID)?.remove();
  }

  // Expose shared namespace
  globalThis.__xh_ab = {
    CFG,
    sites: siteManager.sites,
    registerSite: siteManager.register,
    resolveActiveSite: siteManager.resolveActive,
    emitBadgeClickEvent,
    getBadgePrefs,
    ensureStyle,
    getRenderableBadges,
    renderBadges,
    removeBadges,
  };
})();
