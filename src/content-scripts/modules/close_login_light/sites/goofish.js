// src/content-scripts/modules/close_login_light/sites/goofish.js
// Strategy for goofish.com — login popups, sidebar, fish widget
//
// CRITICAL: CSS injection runs unconditionally at load time,
// even if core.js failed to initialize globalThis.__xh_cll.
(() => {
  "use strict";

  const PREVENT_STYLE_ID = "__xh_cll_prevent_goofish__";
  const SIDEBAR_STYLE_ID = "__xh_hide_xianyu_sidebar__";

  let lastSidebarHide = 0;

  function injectPreventiveCSS() {
    if (document.getElementById(PREVENT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PREVENT_STYLE_ID;
    style.textContent = `
      [class*="loginCon--"],
      [class*="loginDialog--"],
      [class*="login-modal-wrap--"],
      [class*="login-modal"],
      [class*="login-iframe-wrap--"],
      [class*="bottomLead--"],
      [class*="notloginMask--"],
      [class*="maskText--"],
      [class*="maskBtn--"],
      [id*="havana-login"],
      [class*="havana-login"],
      [class*="surveyWrap--"],
      [class*="announcementWrap--"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      .ant-modal-mask:has(+ .ant-modal-wrap[class*="login-modal-wrap--"]),
      .ant-modal-mask:has(~ .ant-modal-wrap[class*="login-modal-wrap--"]) {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function injectSidebarCSS() {
    if (document.getElementById(SIDEBAR_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SIDEBAR_STYLE_ID;
    style.textContent = `
      [class*="sidebar-container--"],
      [class*="sidebar-item-container--"] { display:none !important; }
    `;
    document.documentElement.appendChild(style);
  }

  function removeInjectedCSS() {
    try { document.getElementById(PREVENT_STYLE_ID)?.remove(); } catch {}
    try { document.getElementById(SIDEBAR_STYLE_ID)?.remove(); } catch {}
  }

  function hideSidebarNow() {
    const now = Date.now();
    if (now - lastSidebarHide < cll.CFG.sidebarCooldownMs) return;
    lastSidebarHide = now;

    const nodes = document.querySelectorAll('[class*="sidebar-container--"], [class*="sidebar-item-container--"]');
    nodes.forEach((el) => {
      try {
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
      } catch {}
    });
  }

  function unhideSidebarNow() {
    const nodes = document.querySelectorAll('[class*="sidebar-container--"], [class*="sidebar-item-container--"]');
    nodes.forEach((el) => {
      try {
        el.style.removeProperty("display");
        el.style.removeProperty("visibility");
        el.style.removeProperty("pointer-events");
      } catch {}
    });
  }

  function findLoginBox() {
    return (
      document.querySelector('[class*="login-modal-wrap--"]') ||
      document.querySelector('[class*="loginCon--"]') ||
      document.querySelector('[class*="loginDialog--"]') ||
      document.querySelector('[class*="login-modal"]')
    );
  }

  function attemptCloseModal(box) {
    if (cll.isSearchInputFocused()) return false;
    const now = Date.now();
    if (now - cll.getLastAction() < cll.CFG.cooldownMs) return false;

    // Tentar clicar no mask do Ant Design diretamente
    const mask = document.querySelector('.ant-modal-mask');
    if (mask && cll.isElementVisible(mask)) {
      cll.markAction(now);
      cll.clickEl(mask);
      return true;
    }

    // Fallback: clicar fora do modal, mas em ponto seguro (centro do espaço acima/abaixo do modal)
    if (!box.isConnected) return false;
    const r = box.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

    // Ponto seguro: centro horizontal, acima do modal (se houver espaço)
    if (r.top > 60) {
      cll.markAction(now);
      cll.clickAt(vw / 2, r.top / 2);
      return true;
    }
    // Ou abaixo do modal
    if (r.bottom < vh - 60) {
      cll.markAction(now);
      cll.clickAt(vw / 2, (r.bottom + vh) / 2);
      return true;
    }

    // Último fallback: Escape
    cll.markAction(now);
    cll.sendEsc();
    return true;
  }

  function handleLoginModal() {
    const box = findLoginBox();
    if (!box || !cll.isElementVisible(box)) return false;

    attemptCloseModal(box);

    setTimeout(() => {
      if (cll.isSearchInputFocused()) return;
      const still = findLoginBox();
      if (!still) return;

      cll.sendEsc();
      setTimeout(() => {
        if (cll.isSearchInputFocused()) return;
        const still2 = findLoginBox();
        if (!still2) return;
        cll.safeHide(still2);
      }, 250);
    }, 250);

    return true;
  }

  function removeFishWidget() {
    const selectors = [
      '[class*="surveyWrap"]',
      '[class*="survey-float"]',
      '[id*="survey"]',
      '[class*="feedback-float"]',
      '[id*="feedback"]',
      '[class*="kefu"]',
      '[class*="customerService"]',
      '[aria-label*="feedback"]',
      '[aria-label*="Feedback"]',
    ];

    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!cll.isElementVisible(el)) continue;

        let cs;
        try {
          cs = getComputedStyle(el);
        } catch {
          cs = null;
        }
        if (!cs) continue;

        const pos = cs.position;
        if (pos !== "fixed" && pos !== "sticky") continue;

        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 30) continue;

        const nearRight = r.right > window.innerWidth - 40;
        const midLow = r.top > window.innerHeight * 0.35;
        if (!nearRight || !midLow) continue;

        cll.safeHide(el);
      }
    }
  }

  const knownSelectors = [
    '[class*="loginCon--"]',
    '[class*="loginDialog--"]',
    '[class*="login-modal-wrap--"]',
    '[class*="login-iframe-wrap--"]',
    '[class*="bottomLead--"]',
    '[class*="notloginMask--"]',
    '[class*="maskText--"]',
    '[class*="maskBtn--"]',
    '[id*="havana-login"]',
    '[class*="havana-login"]',
    '[class*="surveyWrap--"]',
    '[class*="announcementWrap--"]',
  ];

  // ══ PHASE 1: Unconditional — runs even if core.js failed ══
  injectPreventiveCSS();
  injectSidebarCSS();

  // ══ PHASE 2: Module logic — only if core.js initialized ══
  const cll = globalThis.__xh_cll;
  if (!cll) return; // CSS already active above

  cll.registerSite({
    siteId: "goofish",
    injectCSS() {
      injectPreventiveCSS();
      injectSidebarCSS();
    },

    hideKnown() {
      for (const sel of knownSelectors) {
        document.querySelectorAll(sel).forEach((el) => cll.safeHide(el));
      }
      // Only hide .ant-modal-mask when a login modal wrap is present nearby
      if (document.querySelector('[class*="login-modal-wrap--"]')) {
        document.querySelectorAll(".ant-modal-mask").forEach((el) => cll.safeHide(el));
      }
    },

    sweep() {
      hideSidebarNow();
      removeFishWidget();
      const modalHandled = handleLoginModal();
      // Se existem elementos de login no DOM (mesmo escondidos pelo CSS preventivo),
      // o site pode ter aplicado overflow:hidden — precisamos desbloquear
      const loginExists = !!findLoginBox();
      return modalHandled || loginExists;
    },

    onResize() {
      hideSidebarNow();
    },

    cleanup() {
      removeInjectedCSS();
      unhideSidebarNow();
    },
  });
})();
