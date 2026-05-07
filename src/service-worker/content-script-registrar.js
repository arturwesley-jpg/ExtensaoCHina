// src/service-worker/content-script-registrar.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  function toContentScriptDef(mod) {
    return {
      id: mod.id,
      js: mod.scripts,
      matches: mod.targets.matches,
      runAt: mod.targets.runAt,
      allFrames: !!mod.targets.allFrames,
    };
  }

  async function unregisterAll() {
    try {
      await chrome.scripting.unregisterContentScripts();
    } catch (e) {
      console.log("[xh-cs] unregister all failed (ignored):", e);
    }
  }

  async function registerModules(modules, logPrefix) {
    const defs = modules.map(toContentScriptDef);
    try {
      await chrome.scripting.registerContentScripts(defs);
      console.log(logPrefix, "registered:", defs.map((d) => d.id));
    } catch (e) {
      console.log("[xh-cs] register failed:", e);
    }
  }

  worker.contentScriptRegistrar = { unregisterAll, registerModules };
})();

