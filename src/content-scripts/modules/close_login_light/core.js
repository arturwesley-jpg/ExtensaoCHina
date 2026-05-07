// src/content-scripts/modules/close_login_light/core.js
// Shared utilities exposed via globalThis.__xh_cll
(() => {
  "use strict";

  const siteRegistry = globalThis.XH?.siteRegistry;
  const siteManager = siteRegistry?.createModuleSiteManager();
  if (!siteManager) return;

  const TAG_FOOTER = "__xh_loginbar__";

  const CFG = {
    debounceMs: 200,
    cooldownMs: 1200,
    sidebarCooldownMs: 200,
    fallbackHide: true,
    footerBottomSlackPx: 120,
  };
  let lastActionAt = 0;

  const { norm, isElementVisible } = globalThis.XHContentUtils;

  function parseRgba(color) {
    if (!color || typeof color !== "string") return null;
    const m = color.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;

    const parts = m[1]
      .split(",")
      .map((v) => Number.parseFloat(v.trim()))
      .filter((v) => Number.isFinite(v));
    if (parts.length < 3) return null;

    const [r, g, b] = parts;
    const a = parts.length >= 4 ? parts[3] : 1;
    return { r, g, b, a };
  }

  function isYellowish(color) {
    const rgba = parseRgba(color);
    if (!rgba) return false;
    const { r, g, b, a } = rgba;
    if (a < 0.2) return false;
    return r >= 150 && g >= 120 && b <= 150 && r >= b + 40 && g >= b + 20;
  }

  function isDarkOverlayColor(color) {
    const rgba = parseRgba(color);
    if (!rgba) return false;
    const { r, g, b, a } = rgba;
    if (a < 0.15) return false;
    return r <= 90 && g <= 90 && b <= 90;
  }

  function isBottomOverlayContainer(el) {
    if (!isElementVisible(el)) return false;

    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      return false;
    }
    if (!cs) return false;

    const pos = cs.position;
    if (pos !== "fixed" && pos !== "sticky") return false;

    const r = el.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

    if (r.height < 36 || r.height > 260) return false;
    if (r.width < Math.max(300, vw * 0.35)) return false;
    if (r.bottom < vh - Math.min(12, CFG.footerBottomSlackPx)) return false;
    if (r.top < vh * 0.45) return false;

    return true;
  }

  function isSearchInputFocused() {
    const el = document.activeElement;
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "").toLowerCase();
    if (type && type !== "text" && type !== "search") return false;
    const attrs = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.className || ""}`.toLowerCase();
    return /search|buscar|pesquisa|\u641c|\u5173\u952e|\u5546\u54c1|search-input/.test(attrs);
  }

  function clickAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return false;

    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return true;
  }

  function clickEl(el) {
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  function sendEsc() {
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function safeHide(el) {
    if (!CFG.fallbackHide || !el) return;
    try {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
    } catch {}
  }

  function inRect(x, y, r) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function unlockScroll() {
    try {
      if (document.body) {
        document.body.classList.remove("modal-open", "overflow-hidden", "no-scroll");
      }
      // Remove overflow:hidden inline
      const htmlStyle = document.documentElement.style.overflow;
      const bodyStyle = document.body?.style.overflow;
      if (htmlStyle === "hidden") {
        document.documentElement.style.removeProperty("overflow");
      }
      if (bodyStyle === "hidden") {
        document.body.style.removeProperty("overflow");
      }
      // Se o computed overflow ainda for hidden (aplicado via stylesheet),
      // forçar override inline para desbloquear o scroll
      if (document.body) {
        const bodyCS = getComputedStyle(document.body);
        if (bodyCS.overflowY === "hidden" || bodyCS.overflow === "hidden") {
          document.body.style.setProperty("overflow-y", "auto", "important");
        }
      }
      const htmlCS = getComputedStyle(document.documentElement);
      if (htmlCS.overflowY === "hidden" || htmlCS.overflow === "hidden") {
        document.documentElement.style.setProperty("overflow-y", "auto", "important");
      }
    } catch {}
  }

  function hasLoginCueText(text) {
    const t = norm(text).toLowerCase();
    if (!t) return false;
    return /(login|log in|sign in|entrar|iniciar sess[aã]o|\u767b\u5f55|\u767b\u9646|\u7acb\u5373\u767b\u5f55|\u53bb\u767b\u5f55|\u7acb\u523b\u767b\u5f55)/.test(t);
  }

  function findCloseButton(container) {
    if (!container) return null;

    const clickable = container.querySelectorAll(
      "button, a, span, i, svg, div[role='button'], [aria-label], [title]"
    );
    const cr = container.getBoundingClientRect();
    let best = null;

    for (const el of clickable) {
      if (!isElementVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;

      const t = norm(el.textContent);
      const label = norm(`${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`).toLowerCase();

      if (t === "\u00D7" || t.toLowerCase() === "x") return el;
      if (/(close|fechar|dismiss|cancel)/i.test(label)) return el;

      const nearRight = r.right > cr.right - Math.max(20, cr.width * 0.15);
      const isSmall = r.width <= 56 && r.height <= 56;
      if (nearRight && isSmall) best = el;
    }

    return best;
  }

  function findPrimaryAction(container) {
    if (!container) return null;

    const clickable = container.querySelectorAll("button, a, div[role='button'], span, div");
    let fallback = null;

    for (const el of clickable) {
      if (!isElementVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.height > 90) continue;
      if (r.width < 44 || r.width > Math.min(window.innerWidth * 0.7, 460)) continue;

      const t = norm(el.textContent);
      if (hasLoginCueText(t)) return el;

      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        cs = null;
      }
      if (!cs) continue;

      if (isYellowish(cs.backgroundColor)) {
        fallback = el;
      } else if (!fallback) {
        const role = (el.getAttribute("role") || "").toLowerCase();
        if (el.tagName === "BUTTON" || el.tagName === "A" || role === "button") {
          fallback = el;
        }
      }
    }

    return fallback;
  }

  function hideFooterBarElement(el) {
    if (!el) return;

    let cur = el;
    for (let i = 0; i < 4 && cur; i++) {
      safeHide(cur);
      try {
        cur.setAttribute(`data-${TAG_FOOTER}`, "1");
      } catch {}

      const parent = cur.parentElement;
      if (!parent) break;

      let cs;
      try {
        cs = getComputedStyle(parent);
      } catch {
        break;
      }
      if (!cs) break;

      const pos = cs.position;
      if (pos !== "fixed" && pos !== "sticky") break;

      const r = parent.getBoundingClientRect();
      if (r.bottom < window.innerHeight - CFG.footerBottomSlackPx) break;

      cur = parent;
    }
  }

  function getLastAction() {
    return lastActionAt;
  }

  function markAction(ts = Date.now()) {
    const next = Number.isFinite(ts) ? ts : Date.now();
    lastActionAt = next;
    return next;
  }

  function unhideMarkedFooterBars() {
    const nodes = document.querySelectorAll(`[data-${TAG_FOOTER}="1"]`);
    nodes.forEach((el) => {
      try {
        el.style.removeProperty("display");
        el.style.removeProperty("visibility");
        el.style.removeProperty("pointer-events");
        el.removeAttribute(`data-${TAG_FOOTER}`);
      } catch {}
    });
  }

  function findFooterLoginBar() {
    // Collect bottom-positioned containers first, then score them.
    // This avoids querying every div/span/p in the page — only elements
    // likely to be fixed/sticky footers are checked via computed style.
    const containers = document.querySelectorAll("div, section, aside, footer");
    let best = null;
    let bestScore = 0;

    for (const el of containers) {
      if (!el || el.nodeType !== 1) continue;
      if (!isBottomOverlayContainer(el)) continue;

      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        cs = null;
      }
      if (!cs) continue;

      const t = norm(el.textContent);
      const x = findCloseButton(el);
      const action = findPrimaryAction(el);

      let score = 0;
      if (hasLoginCueText(t)) score += 4;
      if (x) score += 3;
      if (action) score += 3;
      if (isDarkOverlayColor(cs.backgroundColor)) score += 2;
      if (t.length >= 8 && t.length <= 220) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    const hasLoginText = best ? hasLoginCueText(norm(best.textContent)) : false;
    return (hasLoginText && bestScore >= 3) || bestScore >= 5 ? best : null;
  }

  let lastFooterActionAt = 0;

  function handleFooterBar() {
    const bar = findFooterLoginBar();
    if (!bar) return false;

    const now = Date.now();
    if (now - lastFooterActionAt < CFG.cooldownMs) {
      hideFooterBarElement(bar);
      return true;
    }

    const xbtn = findCloseButton(bar);
    if (xbtn) {
      lastFooterActionAt = now;
      clickEl(xbtn);
      setTimeout(() => {
        const still = findFooterLoginBar();
        if (!still) return;
        hideFooterBarElement(still);
      }, 180);
      return true;
    }

    lastFooterActionAt = now;
    hideFooterBarElement(bar);
    return true;
  }

  // Expose shared namespace
  globalThis.__xh_cll = {
    CFG,
    registerSite: siteManager.register,
    resolveActiveSites: siteManager.resolveAll,
    norm,
    isElementVisible,
    isSearchInputFocused,
    clickAt,
    clickEl,
    sendEsc,
    safeHide,
    isDarkOverlayColor,
    inRect,
    unlockScroll,
    getLastAction,
    markAction,
    unhideMarkedFooterBars,
    handleFooterBar,
  };
})();
