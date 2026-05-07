// src/shared/utils.js
// Shared pure utility functions for the service worker.
// Loaded via importScripts() early in the boot sequence (after keys.js).
// Exposes globalThis.XH.utils — no business logic, only reusable helpers.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  // --- Constants (inline to avoid load-order dependency) ---
  const SEARCH_QUERY_MAX_LEN = 220;
  const SEARCH_PATH_MAX_LEN = 400;

  // --- Types ---

  function asString(v) {
    return String(v || "").trim();
  }

  function parseJsonSafe(raw) {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function toFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function isNonEmptyArray(v) {
    return Array.isArray(v) && v.length > 0;
  }

  // --- Time ---

  function waitMs(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function toIsoFromMs(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    return new Date(ms).toISOString();
  }

  function toMsFromIso(value) {
    const iso = asString(value);
    if (!iso) return 0;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 0;
    return ms;
  }

  // --- Search sanitization ---

  function sanitizeSearchQuery(value) {
    return asString(value).replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
  }

  function normalizeSearchQuery(value) {
    return sanitizeSearchQuery(value).toLowerCase();
  }

  function sanitizeSearchTrigger(value) {
    return asString(value).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "unknown";
  }

  function sanitizeSearchPagePath(value) {
    const raw = asString(value).slice(0, SEARCH_PATH_MAX_LEN);
    return raw || "/";
  }

  function sanitizeSearchSourceSite(value) {
    const siteId = asString(value).toLowerCase();
    return siteId === "taobao" ? "taobao" : "goofish";
  }

  function normalizeSearchSourceSite(value) {
    const siteId = asString(value).toLowerCase();
    if (siteId === "taobao") return "taobao";
    if (siteId === "goofish") return "goofish";
    return "";
  }

  // --- Verification ---

  function hasClient() {
    return !!worker.supabaseClient;
  }

  function isLikelyJwt(token) {
    const v = asString(token);
    return v.split(".").length === 3;
  }

  function isAllowedHost(hostname, allowedHosts) {
    const host = asString(hostname).toLowerCase();
    if (!host) return false;
    for (const rawAllowed of allowedHosts || []) {
      const allowed = asString(rawAllowed).toLowerCase();
      if (!allowed) continue;
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  XH.utils = {
    asString,
    parseJsonSafe,
    toFiniteNumber,
    isNonEmptyArray,
    waitMs,
    toIsoFromMs,
    toMsFromIso,
    sanitizeSearchQuery,
    normalizeSearchQuery,
    sanitizeSearchTrigger,
    sanitizeSearchPagePath,
    sanitizeSearchSourceSite,
    normalizeSearchSourceSite,
    hasClient,
    isLikelyJwt,
    isAllowedHost,
  };
})();
