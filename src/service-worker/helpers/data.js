// src/service-worker/helpers/data.js
// Generic data transformer functions for the service worker.
// Loaded via importScripts() early in boot (after parse.js).
// Extends globalThis.XH.helpers.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const helpers = XH.helpers || (XH.helpers = {});
  const { asString } = XH.utils;

  function toPositiveInt(value, fallback = 0, min = 1, max = 300) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      const safeFallback = Number(fallback);
      if (!Number.isFinite(safeFallback) || safeFallback <= 0) return 0;
      return Math.max(min, Math.min(max, Math.trunc(safeFallback)));
    }
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
  }

  function coerceBoolean(value, fallback = true) {
    if (value === undefined || value === null || value === "") return !!fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = asString(value).toLowerCase();
    if (!normalized) return !!fallback;
    if (["true", "t", "1", "yes", "y", "sim", "ativo", "active"].includes(normalized)) return true;
    if (["false", "f", "0", "no", "n", "nao", "inativo", "inactive"].includes(normalized)) return false;
    return !!fallback;
  }

  function pickFirstField(row, keys = []) {
    for (const key of keys) {
      if (!row || typeof row !== "object") continue;
      if (!Object.hasOwn(row, key)) continue;
      const value = row[key];
      if (value === undefined || value === null) continue;
      if (typeof value === "number" || typeof value === "boolean") return value;
      if (asString(value)) return value;
    }
    return "";
  }

  function isCacheFresh(lastSyncMs, ttlMs) {
    if (!Number.isFinite(lastSyncMs) || lastSyncMs <= 0) return false;
    return Date.now() - lastSyncMs < ttlMs;
  }

  Object.assign(helpers, {
    toPositiveInt,
    coerceBoolean,
    pickFirstField,
    isCacheFresh,
  });
})();
