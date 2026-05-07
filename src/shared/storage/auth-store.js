// auth-store.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const { KEYS } = XH;

  async function getAuthState() {
    return chrome.storage.sync.get([
      KEYS.SESSION,
      KEYS.ACCESS,
      KEYS.BACKEND_OK,
      KEYS.BILLING,
      KEYS.UPDATE_GATE,
    ]);
  }

  async function setBackendOk(ok) {
    await chrome.storage.sync.set({ [KEYS.BACKEND_OK]: ok !== false });
  }

  async function setSession(ok) {
    await chrome.storage.sync.set({ [KEYS.SESSION]: ok === true });
  }

  async function setAccess(ok) {
    await chrome.storage.sync.set({ [KEYS.ACCESS]: ok === true });
  }

  async function setUpdateGate(gate) {
    await chrome.storage.sync.set({ [KEYS.UPDATE_GATE]: gate && typeof gate === "object" ? gate : null });
  }

  XH.authStore = { getAuthState, setBackendOk, setSession, setAccess, setUpdateGate };
})();
