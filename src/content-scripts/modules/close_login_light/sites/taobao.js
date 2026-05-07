// src/content-scripts/modules/close_login_light/sites/taobao.js
// Strategy for taobao.com — login overlays, baxia dialogs, middleware iframes
//
// CRITICAL: CSS injection and enforcement run unconditionally at load time,
// even if core.js failed to initialize globalThis.__xh_cll.
// This prevents a race condition where the module logic dies silently
// but popups remain visible.
(() => {
  "use strict";

  const PREVENT_STYLE_ID = "__xh_cll_prevent_taobao__";
  const TOOLKIT_STYLE_ID = "__xh_hide_taobao_toolkit__";

  // ── Known selectors ───────────────────────────────────

  const knownOverlaySelectors = [
    ".J_MIDDLEWARE_FRAME_WIDGET",
    ".baxia-dialog",
    ".baxia-dialog-content",
    'iframe[src*="login.taobao.com"]',
    ".pc-pop-sdk-container",
  ];

  // ── Preventive CSS ────────────────────────────────────
  // Hides known login/overlay elements before they render.

  function injectPreventiveCSS() {
    if (document.getElementById(PREVENT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PREVENT_STYLE_ID;
    style.textContent = `
      /* Middleware frame — fullscreen dark overlay that contains login iframes */
      .J_MIDDLEWARE_FRAME_WIDGET {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Baxia dialog — Alibaba anti-bot/verification that wraps login */
      .baxia-dialog,
      .baxia-dialog-content,
      .baxia-dialog-close {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Login iframes from login.taobao.com embedded in the page */
      iframe[src*="login.taobao.com"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* PC pop SDK container — spawns promotional popups */
      .pc-pop-sdk-container {
        display: none !important;
        pointer-events: none !important;
      }

      /* Search page: bone/skeleton overlay covers entire page (position:absolute).
         Make it non-blocking so clicks reach the real search UI underneath. */
      .boneClass_boneWrapper {
        pointer-events: none !important;
      }

      /* Hide skeleton elements that cover the search bar area,
         exposing the real functional input underneath in #ice-container. */
      .boneClass_searchSuggest,
      .boneClass_innerWrap,
      .boneClass_headWrapper,
      .boneClass_logoWrapAdapt,
      .boneClass_suggestWarpAdaptMod,
      .boneClass_btnSearch,
      .boneClass_imgSearchButton,
      .boneClass_imgSearchButtonIcon {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function injectToolkitCSS() {
    if (document.getElementById(TOOLKIT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TOOLKIT_STYLE_ID;
    style.textContent = `
      #tb-toolkit-new { display: none !important; }
    `;
    document.documentElement.appendChild(style);
  }

  function removeInjectedCSS() {
    try { document.getElementById(PREVENT_STYLE_ID)?.remove(); } catch {}
    try { document.getElementById(TOOLKIT_STYLE_ID)?.remove(); } catch {}
  }

  // ── Standalone safeHide (no cll dependency) ───────────
  // Used by enforcement timer which must work even if core.js failed.

  function safeHideEl(el) {
    if (!el) return;
    try {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
    } catch {}
  }

  function unlockScrollStandalone() {
    try {
      if (document.body) {
        document.body.classList.remove("modal-open", "overflow-hidden", "no-scroll");
      }
      if (document.documentElement.style.overflow === "hidden") {
        document.documentElement.style.removeProperty("overflow");
      }
      if (document.body?.style.overflow === "hidden") {
        document.body.style.removeProperty("overflow");
      }
      if (document.body) {
        const cs = getComputedStyle(document.body);
        if (cs.overflowY === "hidden" || cs.overflow === "hidden") {
          document.body.style.setProperty("overflow-y", "auto", "important");
        }
      }
      const htmlCS = getComputedStyle(document.documentElement);
      if (htmlCS.overflowY === "hidden" || htmlCS.overflow === "hidden") {
        document.documentElement.style.setProperty("overflow-y", "auto", "important");
      }
    } catch {}
  }

  // ── Enforcement timer ──────────────────────────────────
  // Safety net: periodically force-hide overlays even if core.js failed.

  let enforcementTimer = null;

  function enforceClean() {
    for (const sel of knownOverlaySelectors) {
      document.querySelectorAll(sel).forEach((el) => safeHideEl(el));
    }
    // Ensure bone/skeleton wrapper doesn't block interaction
    document.querySelectorAll(".boneClass_boneWrapper").forEach((el) => {
      el.style.setProperty("pointer-events", "none", "important");
    });
    injectPreventiveCSS();
    injectToolkitCSS();
    unlockScrollStandalone();
  }

  function startEnforcement() {
    if (enforcementTimer) return;
    enforcementTimer = setInterval(enforceClean, 500);
  }

  function stopEnforcement() {
    if (enforcementTimer) {
      clearInterval(enforcementTimer);
      enforcementTimer = null;
    }
  }

  // ══════════════════════════════════════════════════════
  // PHASE 1: Unconditional — runs even if core.js failed
  // ══════════════════════════════════════════════════════

  injectPreventiveCSS();
  injectToolkitCSS();
  startEnforcement();

  // ══════════════════════════════════════════════════════
  // PHASE 2: Module logic — only if core.js initialized
  // ══════════════════════════════════════════════════════

  const cll = globalThis.__xh_cll;
  if (!cll) return; // CSS + enforcement already active above

  const TAOBAO_COOLDOWN_MS = 300;

  // ── Active modal detection & removal ──────────────────

  function findLoginOverlay() {
    const widgets = document.querySelectorAll(".J_MIDDLEWARE_FRAME_WIDGET");
    for (const el of widgets) {
      if (!cll.isElementVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < window.innerWidth * window.innerHeight * 0.3) continue;
      const hasLoginIframe = el.querySelector('iframe[src*="login.taobao.com"]');
      const cs = getComputedStyle(el);
      const isDark = cll.isDarkOverlayColor?.(cs.backgroundColor);
      if (hasLoginIframe || isDark) return el;
    }
    return null;
  }

  function findBaxiaDialog() {
    const dialog = document.querySelector(".baxia-dialog");
    if (dialog && cll.isElementVisible(dialog)) return dialog;
    return null;
  }

  function handleLoginOverlays() {
    if (cll.isSearchInputFocused()) return false;
    const now = Date.now();
    if (now - cll.getLastAction() < TAOBAO_COOLDOWN_MS) return false;

    const overlay = findLoginOverlay();
    if (overlay) {
      cll.markAction(now);
      cll.safeHide(overlay);
      cll.unlockScroll();
      return true;
    }

    const baxia = findBaxiaDialog();
    if (baxia) {
      const closeBtn = baxia.querySelector(".baxia-dialog-close, [class*='close'], [class*='Close']");
      if (closeBtn) {
        cll.markAction(now);
        cll.clickEl(closeBtn);
        setTimeout(() => {
          const still = findBaxiaDialog();
          if (still) cll.safeHide(still);
          cll.unlockScroll();
        }, 300);
        return true;
      }
      cll.markAction(now);
      cll.safeHide(baxia);
      cll.unlockScroll();
      return true;
    }

    return false;
  }

  // ── Stale overlay cleanup ─────────────────────────────

  function cleanupStaleOverlays() {
    const widgets = document.querySelectorAll(".J_MIDDLEWARE_FRAME_WIDGET");
    for (const el of widgets) {
      cll.safeHide(el);
      try {
        const cs = getComputedStyle(el);
        if (cs.display !== "none") el.remove();
      } catch {}
    }
    const iframes = document.querySelectorAll('iframe[src*="login.taobao.com"]');
    for (const iframe of iframes) {
      cll.safeHide(iframe);
      try {
        const cs = getComputedStyle(iframe);
        if (cs.display !== "none") iframe.remove();
      } catch {}
    }
  }

  // ── Site registration ─────────────────────────────────

  cll.registerSite({
    siteId: "taobao",

    injectCSS() {
      injectPreventiveCSS();
      injectToolkitCSS();
    },

    criticalSweep() {
      for (const sel of knownOverlaySelectors) {
        document.querySelectorAll(sel).forEach((el) => cll.safeHide(el));
      }
      cll.unlockScroll();
    },

    hideKnown() {
      for (const sel of knownOverlaySelectors) {
        document.querySelectorAll(sel).forEach((el) => cll.safeHide(el));
      }
    },

    sweep() {
      cleanupStaleOverlays();
      const handled = handleLoginOverlays();
      const hasOverlays = !!findBaxiaDialog() ||
        document.querySelectorAll(".J_MIDDLEWARE_FRAME_WIDGET").length > 0;
      if (hasOverlays) cll.unlockScroll();
      return handled || hasOverlays;
    },

    onResize() {
      cleanupStaleOverlays();
    },

    cleanup() {
      stopEnforcement();
      removeInjectedCSS();
    },
  });
})();
