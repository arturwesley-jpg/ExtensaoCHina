// lifecycle.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { KEYS } = XH;

  // Legacy alarm — clean up if present from previous version
  const LEGACY_REVALIDATE_ALARM = "xh_revalidate";

  async function hasStoredSession() {
    try {
      const data = await chrome.storage.sync.get(KEYS.SESSION);
      return data?.[KEYS.SESSION] === true;
    } catch {
      return false;
    }
  }

  async function initSyncEngine() {
    // Remove legacy alarm if it exists
    try { await chrome.alarms.clear(LEGACY_REVALIDATE_ALARM); } catch {}

    // Set up sync engine alarm (1h periodic burst)
    if (worker.syncEngine) {
      await worker.syncEngine.ensureSyncAlarm();
    }
  }

  async function runInitialBurst() {
    // Immediate burst on install/startup for fresh data
    if (worker.syncEngine) {
      await worker.syncEngine.runBurst({ force: true });
    } else {
      console.warn("[lifecycle] syncEngine not available, falling back to validateAccess only");
      if (await hasStoredSession()) {
        await worker.validateAccess();
      }
    }
  }

  chrome.runtime.onInstalled.addListener(async () => {
    const cur = await chrome.storage.sync.get([
      KEYS.ENABLED,
      KEYS.MODULES,
      KEYS.MODULE_SITE_OVERRIDES,
      KEYS.SESSION,
      KEYS.ACCESS,
      KEYS.BACKEND_OK,
      KEYS.UPDATE_GATE,
    ]);

    if (cur[KEYS.ENABLED] === undefined) {
      await chrome.storage.sync.set({ [KEYS.ENABLED]: true });
    }
    if (cur[KEYS.MODULES] === undefined) {
      await chrome.storage.sync.set({ [KEYS.MODULES]: {} });
    }
    if (cur[KEYS.MODULE_SITE_OVERRIDES] === undefined) {
      await chrome.storage.sync.set({ [KEYS.MODULE_SITE_OVERRIDES]: {} });
    }
    if (cur[KEYS.SESSION] === undefined) {
      await chrome.storage.sync.set({ [KEYS.SESSION]: false });
    }
    if (cur[KEYS.ACCESS] === undefined) {
      await chrome.storage.sync.set({ [KEYS.ACCESS]: false });
    }
    if (cur[KEYS.BACKEND_OK] === undefined) {
      await chrome.storage.sync.set({ [KEYS.BACKEND_OK]: true });
    }
    if (cur[KEYS.UPDATE_GATE] === undefined) {
      await chrome.storage.sync.set({
        [KEYS.UPDATE_GATE]: {
          required: false,
          installed_version: chrome.runtime.getManifest().version || "0.0.0",
          min_required_version: "",
          reason: "bootstrap",
          checked_at_ms: Date.now(),
        },
      });
    }

    await initSyncEngine();
    await worker.applyState();
    await runInitialBurst();
    try { await worker.checkoutPoller?.resumeIfActive?.(); } catch {}
  });

  chrome.runtime.onStartup.addListener(async () => {
    await initSyncEngine();
    await worker.applyState();
    await runInitialBurst();
    try { await worker.checkoutPoller?.resumeIfActive?.(); } catch {}
  });
})();
