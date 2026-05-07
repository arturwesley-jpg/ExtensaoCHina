// src/service-worker/helpers/sanitize.js
// Consolidated input sanitization functions for the service worker.
// Loaded via importScripts() early in boot (after utils.js).
// Exposes functions on globalThis.XH.helpers.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const helpers = XH.helpers || (XH.helpers = {});
  const { asString, isAllowedHost } = XH.utils;

  function sanitizeSlugId(value, maxLen = 64) {
    return asString(value).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, Math.max(1, maxLen));
  }

  function sanitizeText(value, maxLen = 140, collapseWhitespace = true) {
    let s = asString(value);
    if (collapseWhitespace) s = s.replace(/\s+/g, " ");
    return s.slice(0, Math.max(1, Number(maxLen) || 140));
  }

  function sanitizeListKey(value, fallback = "") {
    const normalized = asString(value).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!normalized) return asString(fallback).toLowerCase() || "";
    return normalized.slice(0, 40);
  }

  function sanitizeStoragePath(value) {
    return asString(value).toLowerCase().replace(/[^a-z0-9/_\.-]/g, "").slice(0, 255);
  }

  function sanitizeUrl(value, options = {}) {
    const candidate = asString(value);
    if (!candidate) return "";
    try {
      const parsed = new URL(candidate);
      const httpsOnly = options.httpsOnly === true;
      if (httpsOnly) {
        if (parsed.protocol !== "https:") return "";
      } else {
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      }
      if (options.allowedHosts) {
        if (!isAllowedHost(parsed.hostname, options.allowedHosts)) return "";
      }
      return parsed.toString();
    } catch {
      return "";
    }
  }

  Object.assign(helpers, {
    sanitizeSlugId,
    sanitizeText,
    sanitizeListKey,
    sanitizeStoragePath,
    sanitizeUrl,
  });
})();
