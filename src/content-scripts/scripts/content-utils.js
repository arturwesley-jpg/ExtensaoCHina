// src/content-scripts/scripts/content-utils.js
// Shared pure utility functions for content scripts.
// Injected before runtime.js via SHARED_CONTENT_SCRIPTS.
// Exposes globalThis.XHContentUtils.
(() => {
  "use strict";

  // --- Constants (inline to avoid load-order dependency) ---
  const SEARCH_QUERY_MAX_LEN = 220;
  const SEARCH_PATH_MAX_LEN = 400;
  const DEFAULT_PRICE_RATES = Object.freeze({ BRL: 0.77, USD: 0.14, EUR: 0.13 });
  const DEFAULT_PRICE_CURRENCY = "BRL";
  const PRICE_CURRENCY_META = Object.freeze({
    BRL: { label: "Real", short: "BRL", symbol: "R$" },
    USD: { label: "Dolar", short: "USD", symbol: "US$" },
    EUR: { label: "Euro", short: "EUR", symbol: "\u20ac" },
  });

  // --- Types ---

  function asString(v) {
    return String(v || "").trim();
  }

  function toFiniteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function isNonEmptyArray(v) {
    return Array.isArray(v) && v.length > 0;
  }

  // --- Strings ---

  function norm(s) {
    return (s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function sanitizeQuery(value) {
    return asString(value).replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
  }

  function normalizeQuery(value) {
    return sanitizeQuery(value).toLowerCase();
  }

  function sanitizePath(value) {
    const raw = asString(value);
    if (!raw) return "/";
    return raw.slice(0, SEARCH_PATH_MAX_LEN);
  }

  // --- Math ---

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function clampInt(value, min, max) {
    const num = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : min;
    return Math.max(min, Math.min(max, num));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // --- Price (pure normalization) ---

  function normalizeRate(value, fallback = DEFAULT_PRICE_RATES.BRL) {
    const n = Number(value);
    if (!Number.isFinite(n)) return clamp(Number(fallback) || DEFAULT_PRICE_RATES.BRL, 0.01, 10);
    return round2(clamp(n, 0.01, 10));
  }

  function normalizePriceCurrency(raw, fallback = DEFAULT_PRICE_CURRENCY) {
    const currency = String(raw || "").trim().toUpperCase();
    return PRICE_CURRENCY_META[currency] ? currency : fallback;
  }

  function normalizePriceRates(raw, legacyBrlRate = DEFAULT_PRICE_RATES.BRL) {
    const value = raw && typeof raw === "object" ? raw : {};
    return {
      BRL: normalizeRate(value.BRL, legacyBrlRate),
      USD: normalizeRate(value.USD, DEFAULT_PRICE_RATES.USD),
      EUR: normalizeRate(value.EUR, DEFAULT_PRICE_RATES.EUR),
    };
  }

  function getPriceMeta(currency) {
    return PRICE_CURRENCY_META[normalizePriceCurrency(currency)] || PRICE_CURRENCY_META[DEFAULT_PRICE_CURRENCY];
  }

  function formatConvertedAmount(value, currency) {
    const amount = Number(value);
    const safeCurrency = normalizePriceCurrency(currency);
    const meta = getPriceMeta(safeCurrency);
    if (!Number.isFinite(amount)) return `${meta.symbol} 0,00`;
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: safeCurrency }).format(amount);
    } catch {
      return `${meta.symbol} ${amount.toFixed(2).replace(".", ",")}`;
    }
  }

  // --- DOM ---

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    let cs;
    try {
      cs = getComputedStyle(el);
    } catch {
      return false;
    }
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const opacity = Number.parseFloat(cs.opacity);
    if (Number.isFinite(opacity) && opacity < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  }

  function createEl(tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function sanitizeUrl(raw) {
    const candidate = asString(raw);
    if (!candidate) return "";
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  globalThis.XHContentUtils = {
    asString,
    toFiniteNumber,
    isNonEmptyArray,
    norm,
    sanitizeQuery,
    normalizeQuery,
    sanitizePath,
    clamp,
    clampInt,
    round2,
    normalizeRate,
    normalizePriceCurrency,
    normalizePriceRates,
    getPriceMeta,
    formatConvertedAmount,
    isElementVisible,
    createEl,
    sanitizeUrl,
  };
})();
