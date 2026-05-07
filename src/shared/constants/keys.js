// keys.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});

  XH.KEYS = {
    ENABLED: "enabled",
    MODULES: "moduleEnabled",
    MODULE_SITE_OVERRIDES: "moduleSiteOverrides",
    BADGES: "badgeAgents",
    RATE: "brlRate", // TODO: remover apos refactor de options.js — usar PRICE_RATES
    PRICE_RATES: "priceRates",
    PRICE_CURRENCY: "priceCurrency",
    PRICE_DISPLAY_MODE: "brlPriceDisplayMode",
    UI_RATE_OPEN: "uiRateOpen",
    UI_THEME: "uiTheme",
    SESSION: "xhSession",
    ACCESS: "xhAccess",
    BACKEND_OK: "xhBackendOk",
    BILLING: "xhBilling",
    UPDATE_GATE: "xhUpdateGate",
    REMOTE_CONFIG: "xh_remote_config_v1",
    PRICE_RATE_MODE: "priceRateMode",
    CHECKOUT_PENDING: "xhCheckoutPending"
  };
})();
