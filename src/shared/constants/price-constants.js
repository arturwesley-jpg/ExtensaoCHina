// price-constants.js
// Fonte unica de constantes, normalizacao e formatacao de precos.
// Compartilhado por: module-store.js, popup/modules.js, content scripts.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});

  const RATE_MIN = 0.01;
  const RATE_MAX = 10;
  const DEFAULT_RATE = 0.77;

  const PRICE_CURRENCIES = Object.freeze({
    BRL: "BRL",
    USD: "USD",
    EUR: "EUR",
  });

  const DEFAULT_PRICE_CURRENCY = PRICE_CURRENCIES.BRL;

  const DEFAULT_PRICE_RATES = Object.freeze({
    [PRICE_CURRENCIES.BRL]: DEFAULT_RATE,
    [PRICE_CURRENCIES.USD]: 0.14,
    [PRICE_CURRENCIES.EUR]: 0.13,
  });

  const PRICE_DISPLAY_MODES = Object.freeze({
    SIDE: "side",
    REPLACE: "replace",
  });

  const PRICE_CURRENCY_META = Object.freeze({
    [PRICE_CURRENCIES.BRL]: { label: "Real", short: "BRL", symbol: "R$" },
    [PRICE_CURRENCIES.USD]: { label: "Dolar", short: "USD", symbol: "US$" },
    [PRICE_CURRENCIES.EUR]: { label: "Euro", short: "EUR", symbol: "€" },
  });

  // --- Utilitarios de normalizacao ---

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function normalizeRate(value, fallback = DEFAULT_RATE) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return clamp(Number(fallback) || DEFAULT_RATE, RATE_MIN, RATE_MAX);
    return round2(clamp(numeric, RATE_MIN, RATE_MAX));
  }

  function normalizePriceCurrency(value, fallback = DEFAULT_PRICE_CURRENCY) {
    const normalized = String(value || "").trim().toUpperCase();
    return Object.hasOwn(PRICE_CURRENCIES, normalized) ? normalized : fallback;
  }

  function normalizePriceRates(value, legacyBrlRate) {
    const raw = value && typeof value === "object" ? value : {};
    const brlFallback = normalizeRate(
      legacyBrlRate,
      DEFAULT_PRICE_RATES[PRICE_CURRENCIES.BRL]
    );
    return {
      [PRICE_CURRENCIES.BRL]: normalizeRate(raw[PRICE_CURRENCIES.BRL], brlFallback),
      [PRICE_CURRENCIES.USD]: normalizeRate(raw[PRICE_CURRENCIES.USD], DEFAULT_PRICE_RATES[PRICE_CURRENCIES.USD]),
      [PRICE_CURRENCIES.EUR]: normalizeRate(raw[PRICE_CURRENCIES.EUR], DEFAULT_PRICE_RATES[PRICE_CURRENCIES.EUR]),
    };
  }

  function normalizePriceDisplayMode(value) {
    return String(value || "").trim().toLowerCase() === PRICE_DISPLAY_MODES.SIDE
      ? PRICE_DISPLAY_MODES.SIDE
      : PRICE_DISPLAY_MODES.REPLACE;
  }

  // --- Utilitarios de formatacao ---

  function getPriceMeta(currency) {
    return PRICE_CURRENCY_META[normalizePriceCurrency(currency)] || PRICE_CURRENCY_META[DEFAULT_PRICE_CURRENCY];
  }

  function formatRateNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0,00";
    return numeric.toFixed(2).replace(".", ",");
  }

  function formatConvertedAmount(value, currency) {
    const amount = Number(value);
    const safeCurrency = normalizePriceCurrency(currency);
    const meta = getPriceMeta(safeCurrency);
    if (!Number.isFinite(amount)) return `${meta.symbol} 0,00`;
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: safeCurrency,
      }).format(amount);
    } catch {
      return `${meta.symbol} ${amount.toFixed(2).replace(".", ",")}`;
    }
  }

  XH.priceConstants = {
    // Constantes
    RATE_MIN,
    RATE_MAX,
    DEFAULT_RATE,
    PRICE_CURRENCIES,
    DEFAULT_PRICE_CURRENCY,
    DEFAULT_PRICE_RATES,
    PRICE_DISPLAY_MODES,
    PRICE_CURRENCY_META,
    // Normalizacao
    clamp,
    round2,
    normalizeRate,
    normalizePriceCurrency,
    normalizePriceRates,
    normalizePriceDisplayMode,
    // Formatacao
    getPriceMeta,
    formatRateNumber,
    formatConvertedAmount,
  };
})();
