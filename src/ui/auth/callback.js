// src/ui/auth/callback.js
"use strict";

/**
 * Supabase redirect example:
 * chrome-extension://.../src/ui/auth/callback.html#access_token=...&refresh_token=...&expires_in=3600&token_type=bearer&type=magiclink
 */

const XH = globalThis.XH || (globalThis.XH = {});
const AUTH = XH.authConstants || {
  KEYS: { LOGIN_STATE_LOCAL: "xh_login_state" },
  TTL_MS: { LOGIN_STATE: 15 * 60 * 1000 },
};
const MSG = XH.runtimeMessages?.TYPES || {
  VALIDATE_ACCESS: "XH_VALIDATE_ACCESS",
};
const KEYS = XH.KEYS || { UI_THEME: "uiTheme" };

const KEY_LOGIN_STATE_LOCAL = AUTH.KEYS.LOGIN_STATE_LOCAL;
const LOGIN_STATE_TTL_MS = AUTH.TTL_MS.LOGIN_STATE;
const THEME_DEFAULT = "white";
const THEME_SET = new Set(["white", "black"]);

function normalizeTheme(value) {
  // Inline fallback: callback.html nao carrega ui-store.js
  const raw = String(value || "").trim().toLowerCase();
  return THEME_SET.has(raw) ? raw : THEME_DEFAULT;
}

function parseQueryParams() {
  const p = new URLSearchParams(location.search || "");
  return { xh_state: p.get("xh_state") || "" };
}

function parseHashParams() {
  const h = (location.hash || "").replace(/^#/, "");
  const p = new URLSearchParams(h);

  const access_token = p.get("access_token") || "";
  const refresh_token = p.get("refresh_token") || "";
  const expires_in = Number(p.get("expires_in") || "3600");
  const expires_at = Number(p.get("expires_at") || "0");
  const token_type = (p.get("token_type") || "bearer").toLowerCase();

  return { access_token, refresh_token, expires_in, expires_at, token_type };
}

function clearSensitiveUrlParams() {
  const sensitiveKeys = [
    "access_token",
    "refresh_token",
    "token_type",
    "expires_in",
    "expires_at",
    "type",
    "token",
    "token_hash",
  ];
  try {
    const u = new URL(location.href);
    sensitiveKeys.forEach((key) => {
      u.searchParams.delete(key);
    });

    const hashParams = new URLSearchParams((u.hash || "").replace(/^#/, ""));
    sensitiveKeys.forEach((key) => {
      hashParams.delete(key);
    });
    const nextHash = hashParams.toString();
    u.hash = nextHash ? `#${nextHash}` : "";

    history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {}
}

function isLikelyJwt(token) {
  return typeof token === "string" && token.split(".").length === 3;
}

function setStatus(el, tone, message) {
  if (!el) return;
  el.className = `muted ${tone}`.trim();
  el.textContent = message;
}

async function applyThemeFromStorage() {
  try {
    const d = await chrome.storage.sync.get(KEYS.UI_THEME);
    const theme = normalizeTheme(d[KEYS.UI_THEME]);
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    document.documentElement.setAttribute("data-theme", THEME_DEFAULT);
  }
}

async function validateLoginState(stateFromUrl) {
  if (!stateFromUrl) return { ok: false, reason: "missing_state" };

  const d = await chrome.storage.local.get(KEY_LOGIN_STATE_LOCAL);
  const saved = d[KEY_LOGIN_STATE_LOCAL];
  const createdAt = Number(saved?.created_at_ms || 0);

  if (!saved?.value || !createdAt) return { ok: false, reason: "state_not_found" };
  if (saved.value !== stateFromUrl) return { ok: false, reason: "state_mismatch" };
  if (Date.now() - createdAt > LOGIN_STATE_TTL_MS) return { ok: false, reason: "state_expired" };

  return { ok: true, reason: "ok" };
}

async function main() {
  await applyThemeFromStorage();

  const el = document.getElementById("status");
  const hint = document.getElementById("hint");
  const q = parseQueryParams();
  const stateCheck = await validateLoginState(q.xh_state);

  if (!stateCheck.ok) {
    setStatus(el, "err", "Falhou: link de login inválido ou expirado.");
    if (hint) hint.textContent = "Solicite um novo magic link no popup e tente novamente.";
    return;
  }

  await chrome.storage.local.remove(KEY_LOGIN_STATE_LOCAL);

  const t = parseHashParams();
  clearSensitiveUrlParams();
  if (!t.access_token || !t.refresh_token) {
    setStatus(el, "err", "Falhou: tokens não vieram no redirect.");
    if (hint) {
      hint.textContent =
        "Verifique se o redirect URL da extensão está cadastrado no Auth do Supabase e solicite um novo link.";
    }
    return;
  }

  if (!isLikelyJwt(t.access_token)) {
    setStatus(el, "err", "Falhou: access_token inválido.");
    if (hint) {
      hint.textContent =
        "O access_token recebido não parece JWT válido. Solicite um novo link e tente novamente.";
    }
    return;
  }

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const expiresAtSec = t.expires_at > 0 ? t.expires_at : nowSec + (t.expires_in || 3600);
  const expiresAtMs = expiresAtSec * 1000;

  await chrome.storage.local.set({
    xh_tokens: {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      token_type: t.token_type,
      expires_at: expiresAtSec,
      expires_at_ms: expiresAtMs,
    },
    xhSession: true,
    xhBackendOk: true,
  });

  await chrome.storage.sync.set({
    xhSession: true,
    xhBackendOk: true,
  });

  try {
    await chrome.runtime.sendMessage({ type: MSG.VALIDATE_ACCESS });
  } catch (e) {
    console.warn("Não consegui chamar validate access:", e);
  }

  setStatus(el, "ok", "Login concluído. Você já pode voltar ao popup.");
  if (hint) hint.textContent = "Fechando esta aba...";

  setTimeout(() => window.close(), 800);
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById("status");
  setStatus(el, "err", `Erro: ${String(e)}`);
});


