// ui-store.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const { KEYS } = XH;
  const THEME_DEFAULT = "white";
  const THEME_SET = new Set([
    "white",
    "black",
  ]);

  function normalizeTheme(value) {
    const raw = String(value || "").trim().toLowerCase();
    return THEME_SET.has(raw) ? raw : THEME_DEFAULT;
  }

  async function getUiRateOpen() {
    const d = await chrome.storage.sync.get(KEYS.UI_RATE_OPEN);
    return !!d[KEYS.UI_RATE_OPEN];
  }

  async function setUiRateOpen(open) {
    await chrome.storage.sync.set({ [KEYS.UI_RATE_OPEN]: !!open });
  }

  async function getTheme() {
    const d = await chrome.storage.sync.get(KEYS.UI_THEME);
    return normalizeTheme(d[KEYS.UI_THEME]);
  }

  async function setTheme(theme) {
    await chrome.storage.sync.set({ [KEYS.UI_THEME]: normalizeTheme(theme) });
  }

  XH.uiStore = {
    getUiRateOpen,
    setUiRateOpen,
    getTheme,
    setTheme,
    normalizeTheme,
    THEME_DEFAULT
  };
})();
