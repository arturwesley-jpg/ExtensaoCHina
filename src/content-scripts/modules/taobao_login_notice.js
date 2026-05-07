// src/content-scripts/modules/taobao_login_notice.js
// Aviso sobre necessidade de número de telefone chinês para login no Taobao
(() => {
  "use strict";

  const NOTICE_KEY = "xh_taobao_login_notice_dismissed";

  function isLoginPage() {
    const url = window.location.href;
    return (
      url.includes("login.taobao.com") ||
      url.includes("login.tmall.com") ||
      url.includes("member.taobao.com/member/login") ||
      (document.querySelector("#fm-login-id") !== null) ||
      (document.querySelector(".login-box") !== null && url.includes("taobao.com"))
    );
  }

  function hasDismissed() {
    try {
      return sessionStorage.getItem(NOTICE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(NOTICE_KEY, "1");
    } catch {}
  }

  function createNotice() {
    const overlay = document.createElement("div");
    overlay.id = "xh-taobao-login-notice";
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;" +
      "background:rgba(0,0,0,0.6);z-index:2147483647;" +
      "display:flex;align-items:center;justify-content:center;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    const card = document.createElement("div");
    card.style.cssText =
      "background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);" +
      "border-radius:16px;padding:32px;max-width:480px;width:90%;" +
      "color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.4);text-align:center;position:relative;";

    card.innerHTML =
      '<div style="font-size:48px;margin-bottom:16px;">📱</div>' +
      '<h2 style="margin:0 0 12px;font-size:22px;font-weight:700;">Atenção: Login do Taobao</h2>' +
      '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;opacity:0.95;">' +
        'O Taobao exige um <strong>número de telefone chinês</strong> para fazer login. ' +
        'Se você não tem um, não conseguirá acessar sua conta.' +
      '</p>' +
      '<div style="background:rgba(255,255,255,0.2);border-radius:10px;padding:16px;margin-bottom:20px;">' +
        '<p style="margin:0 0 8px;font-size:14px;font-weight:600;">Alternativas recomendadas:</p>' +
        '<p style="margin:0;font-size:13px;line-height:1.5;">' +
          'Use <strong>ACBuy</strong> ou <strong>CSSBuy</strong> para comprar sem login.<br>' +
          'Basta colar o link do produto na plataforma deles.' +
        '</p>' +
      '</div>' +
      '<button id="xh-taobao-notice-dismiss" style="' +
        'background:#fff;color:#f7931e;border:none;border-radius:8px;' +
        'padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;' +
        'transition:transform 0.15s;">Entendi, fechar</button>';

    overlay.appendChild(card);

    const btn = card.querySelector("#xh-taobao-notice-dismiss");
    btn.addEventListener("click", function () {
      dismiss();
      overlay.remove();
    });
    btn.addEventListener("mouseenter", function () {
      btn.style.transform = "scale(1.05)";
    });
    btn.addEventListener("mouseleave", function () {
      btn.style.transform = "scale(1)";
    });

    return overlay;
  }

  function showNotice() {
    if (document.getElementById("xh-taobao-login-notice")) return;
    if (hasDismissed()) return;
    document.body.appendChild(createNotice());
  }

  function check() {
    if (isLoginPage() && !hasDismissed()) {
      if (document.body) {
        showNotice();
      } else {
        document.addEventListener("DOMContentLoaded", showNotice, { once: true });
      }
    }
  }

  check();

  var lastUrl = location.href;
  var observer = new MutationObserver(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      check();
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }, { once: true });
  }
})();
