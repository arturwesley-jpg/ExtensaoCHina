// src/service-worker/modules.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  let _applyBusy = false;
  let _applyQueued = false;

  async function applyState() {
    if (_applyBusy) {
      _applyQueued = true;
      return;
    }
    _applyBusy = true;
    try {
      const state = await worker.moduleStateService.resolveModuleState();

      await worker.contentScriptRegistrar.unregisterAll();

      const onlyAlways = [...state.alwaysModules];

      // No session / offline / update required → only always modules
      if (!state.gate.ok && !state.gate.hasSession) {
        await worker.contentScriptRegistrar.registerModules(
          onlyAlways,
          `[xh-mod] blocked (${state.gate.reason}) - only always modules`
        );
        return;
      }

      // Logged in but no paid access → always + free modules (respects global toggle)
      if (!state.gate.ok && state.gate.hasSession) {
        const freeTier = state.enabled
          ? [...state.alwaysModules, ...state.freeModules]
          : [...state.alwaysModules];
        const label = state.enabled
          ? `[xh-mod] free tier (${state.gate.reason}) - always + free modules`
          : `[xh-mod] free tier global disabled - only always modules`;
        await worker.contentScriptRegistrar.registerModules(freeTier, label);
        return;
      }

      if (!state.enabled) {
        await worker.contentScriptRegistrar.registerModules(
          onlyAlways,
          "[xh-mod] global disabled - only always modules"
        );
        return;
      }

      // Full access → always + free + premium
      const active = [...state.alwaysModules, ...state.freeModules, ...state.premiumModules];
      await worker.contentScriptRegistrar.registerModules(active, "[xh-mod] active - all modules registered");
    } finally {
      _applyBusy = false;
      if (_applyQueued) {
        _applyQueued = false;
        applyState();
      }
    }
  }

  worker.MODULES = [...XH.moduleRegistry.getFreeModules(), ...XH.moduleRegistry.getPremiumModules()];
  worker.applyState = applyState;
  worker.getAccessGate = worker.moduleStateService.getAccessGate;
})();

