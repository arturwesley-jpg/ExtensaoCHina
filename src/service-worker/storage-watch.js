// storage-watch.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { KEYS } = XH;

  let applyTimer = null;
  function scheduleApplyState() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      worker.applyState().catch(err => console.log("applyState error:", err));
    }, 150);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    const keys = [KEYS.SESSION, KEYS.ACCESS, KEYS.BACKEND_OK, KEYS.ENABLED, KEYS.MODULES, KEYS.UPDATE_GATE];
    if (keys.some(k => changes[k])) scheduleApplyState();
  });
})();
