// src/content-scripts/modules/taobao_login_notice/core.js
(() => {
  "use strict";

  const NOTICE_ID = "xh-taobao-login-notice";
  const SEEN_KEY = "taobaoLoginNoticeDismissed";

  function isLoginPage() {
    const url = window.location.href;
    return (
      /login\.taobao\.com/.test(url) ||
      /login\.tmall\.com/.test(url) ||
      (document.querySelector('[class*="login"]') !== null &&
        document.querySelector('[class*="sms"]') !== null)
    );
  }

  function injectStyles() {
    if (document.getElementById(`${NOTICE_ID}-style`)) return;
    const style = document.createElement("style");
    style.id = `${NOTICE_ID}-style`;
    style.textContent = `
      #${NOTICE_ID} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 14px 20px;
        font-size: 14px;
        line-height: 1.5;
        box-shadow: 0 2px 12px rgba(0,0,0,0.25);
        display: flex;
        align-items: flex-start;
        gap: 12px;
        animation: ${NOTICE_ID}-slide 0.3s ease-out;
      }
      @keyframes ${NOTICE_ID}-slide {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      #${NOTICE_ID} .notice-icon {
        font-size: 22px;
        flex-shrink: 0;
        line-height: 1;
      }
      #${NOTICE_ID} .notice-body {
        flex: 1;
      }
      #${NOTICE_ID} .notice-title {
        font-weight: 700;
        font-size: 15px;
        margin-bottom: 4px;
      }
      #${NOTICE_ID} .notice-text {
        opacity: 0.95;
        font-size: 13px;
      }
      #${NOTICE_ID} .notice-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: #fff;
        font-size: 18px;
        cursor: pointer;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background 0.2s;
      }
      #${NOTICE_ID} .notice-close:hover {
        background: rgba(255,255,255,0.35);
      }
    `;
    document.head.appendChild(style);
  }

  function removeNotice() {
    const el = document.getElementById(NOTICE_ID);
    if (el) el.remove();
  }

  async function wasDismissed() {
    try {
      const res = await chrome.storage.local.get(SEEN_KEY);
      return !!res?.[SEEN_KEY];
    } catch {
      return false;
    }
  }

  async function markDismissed() {
    try {
      await chrome.storage.local.set({ [SEEN_KEY]: true });
    } catch { /* ignored */ }
  }

  function buildNotice() {
    const wrap = document.createElement("div");
    wrap.id = NOTICE_ID;

    const icon = document.createElement("span");
    icon.className = "notice-icon";
    icon.textContent = "\u26A0\uFE0F";

    const body = document.createElement("div");
    body.className = "notice-body";

    const title = document.createElement("div");
    title.className = "notice-title";
    title.textContent = "Aviso: Login do Taobao exige n\u00FAmero chin\u00EAs";

    const text = document.createElement("div");
    text.className = "notice-text";
    text.appendChild(document.createTextNode(
      "Para fazer login no Taobao, \u00E9 necess\u00E1rio um "
    ));
    const strong = document.createElement("strong");
    strong.textContent = "n\u00FAmero de telefone chin\u00EAs";
    text.appendChild(strong);
    text.appendChild(document.createTextNode(
      " (+86). Caso n\u00E3o tenha, voc\u00EA pode usar o Goofish (Xianyu) para navegar sem login ou utilizar agentes de compra (ACBuy / CSSBuy) que fazem o login por voc\u00EA."
    ));

    body.appendChild(title);
    body.appendChild(text);

    const closeBtn = document.createElement("button");
    closeBtn.className = "notice-close";
    closeBtn.title = "Fechar";
    closeBtn.textContent = "\u00D7";

    closeBtn.addEventListener("click", async () => {
      wrap.style.transition = "opacity 0.25s, transform 0.25s";
      wrap.style.opacity = "0";
      wrap.style.transform = "translateY(-100%)";
      setTimeout(() => removeNotice(), 250);
      await markDismissed();
    });

    wrap.appendChild(icon);
    wrap.appendChild(body);
    wrap.appendChild(closeBtn);

    return wrap;
  }

  function createNotice() {
    removeNotice();
    injectStyles();
    document.body.appendChild(buildNotice());
  }

  async function showNoticeIfRelevant() {
    if (!isLoginPage()) return;
    const dismissed = await wasDismissed();
    if (dismissed) return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => createNotice());
    } else {
      createNotice();
    }
  }

  function bootstrap() {
    showNoticeIfRelevant();
  }

  globalThis.__xh_taobao_login_notice = {
    bootstrap,
    removeNotice,
    isLoginPage,
    NOTICE_ID,
  };
})();
