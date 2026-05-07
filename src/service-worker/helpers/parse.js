// src/service-worker/helpers/parse.js
// Decoding, JWT, version, error, and URL parsing functions for the service worker.
// Loaded via importScripts() early in boot (after sanitize.js).
// Extends globalThis.XH.helpers.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const helpers = XH.helpers || (XH.helpers = {});
  const { asString, parseJsonSafe } = XH.utils;

  function decodeBase64Url(raw) {
    const source = asString(raw);
    if (!source) return "";
    const normalized = source.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    return atob(normalized + "=".repeat(padding));
  }

  function decodeHtmlUrlEntities(raw) {
    return asString(raw)
      .replace(/&amp;/gi, "&")
      .replace(/&#x3d;/gi, "=")
      .replace(/&#61;/gi, "=")
      .replace(/&#x3a;/gi, ":")
      .replace(/&#58;/gi, ":")
      .replace(/&#x2f;/gi, "/")
      .replace(/&#47;/gi, "/")
      .replace(/&#x3f;/gi, "?")
      .replace(/&#63;/gi, "?");
  }

  function maybeDecodeUrl(raw) {
    const v = decodeHtmlUrlEntities(raw);
    if (!v) return "";
    let out = v;
    for (let i = 0; i < 2; i += 1) {
      try {
        const decoded = decodeURIComponent(out);
        if (!decoded || decoded === out) break;
        out = decoded;
      } catch {
        break;
      }
    }
    return out;
  }

  function toHashParams(hashValue) {
    return new URLSearchParams(asString(hashValue).replace(/^#/, ""));
  }

  function getUserIdFromJwt(accessToken) {
    const token = asString(accessToken);
    if (!token) return "";
    try {
      const parts = token.split(".");
      if (parts.length < 2) return "";
      const payload = JSON.parse(decodeBase64Url(parts[1]));
      return asString(payload?.sub);
    } catch {
      return "";
    }
  }

  function parseSupabaseErrorDetail(raw) {
    const payload = parseJsonSafe(raw);
    return asString(
      payload?.msg ||
      payload?.error_description ||
      payload?.error ||
      payload?.message ||
      raw ||
      "supabase_request_failed"
    );
  }

  function toVersionNumber(part) {
    const clean = String(part || "").replace(/[^0-9]/g, "");
    const num = Number(clean);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
  }

  function parseVersion(rawVersion) {
    const raw = asString(rawVersion);
    if (!raw) return [0, 0, 0];
    return raw.split(".").map(toVersionNumber);
  }

  function compareVersions(a, b) {
    const va = parseVersion(a);
    const vb = parseVersion(b);
    const max = Math.max(va.length, vb.length);
    for (let i = 0; i < max; i += 1) {
      const pa = va[i] ?? 0;
      const pb = vb[i] ?? 0;
      if (pa > pb) return 1;
      if (pa < pb) return -1;
    }
    return 0;
  }

  function deriveErrorReason(detail, fallbackReason, rules) {
    const text = asString(detail).toLowerCase();
    if (!text) return fallbackReason;
    for (const [reason, conditions] of rules) {
      const all = Array.isArray(conditions) ? conditions : [conditions];
      if (all.every(c => text.includes(c))) return reason;
    }
    return fallbackReason;
  }

  Object.assign(helpers, {
    decodeBase64Url,
    decodeHtmlUrlEntities,
    maybeDecodeUrl,
    toHashParams,
    getUserIdFromJwt,
    parseSupabaseErrorDetail,
    parseVersion,
    compareVersions,
    deriveErrorReason,
  });
})();
