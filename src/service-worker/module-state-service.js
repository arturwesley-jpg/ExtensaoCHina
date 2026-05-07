// module-state-service.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { getAlwaysModules, getFreeModules, getPremiumModules } = XH.moduleRegistry;
  const FORCED_ON_MODULE_IDS = new Set(["search_insights"]);

  function isModuleEnabled(def, moduleMap, remoteOverrides) {
    if (FORCED_ON_MODULE_IDS.has(def.id)) return true;
    // Remote kill switch: disable module globally from Supabase
    if (remoteOverrides?.[def.id]?.disabled === true) return false;
    if (moduleMap[def.id] === true) return true;
    if (moduleMap[def.id] === false) return false;
    return def.defaultEnabled ?? true;
  }

  async function normalizeForcedOnModuleMap(moduleMapInput) {
    const moduleMap = moduleMapInput && typeof moduleMapInput === "object" ? moduleMapInput : {};
    let changed = false;
    const normalized = { ...moduleMap };

    for (const moduleId of FORCED_ON_MODULE_IDS) {
      if (normalized[moduleId] === false) {
        normalized[moduleId] = true;
        changed = true;
      }
    }

    if (changed) {
      await XH.moduleStore.setModuleMap(normalized);
    }

    return normalized;
  }

  async function getAccessGate() {
    const d = await XH.authStore.getAuthState();
    const updateGate = d[XH.KEYS.UPDATE_GATE];

    if (updateGate && updateGate.required === true) {
      return { ok: false, reason: "update_required", hasSession: false };
    }

    const hasSession = d[XH.KEYS.SESSION] === true;
    if (d[XH.KEYS.BACKEND_OK] === false) return { ok: false, reason: "offline", hasSession };
    if (!hasSession) return { ok: false, reason: "no_session", hasSession: false };
    if (d[XH.KEYS.ACCESS] !== true) return { ok: false, reason: "no_access", hasSession: true };

    return { ok: true, reason: "active", hasSession: true };
  }

  async function resolveModuleState() {
    const enabled = await XH.moduleStore.getGlobalEnabled();
    const moduleMap = await normalizeForcedOnModuleMap(await XH.moduleStore.getModuleMap());
    const gate = await getAccessGate();

    // Load remote module overrides (kill switch from Supabase)
    let remoteOverrides = {};
    try {
      const remoteKey = XH.KEYS?.REMOTE_CONFIG || "xh_remote_config_v1";
      const data = await chrome.storage.local.get(remoteKey);
      remoteOverrides = data?.[remoteKey]?.module_overrides || {};
    } catch {}

    const alwaysModules = getAlwaysModules();
    const freeModules = gate.hasSession
      ? getFreeModules().filter((m) => isModuleEnabled(m, moduleMap, remoteOverrides))
      : [];
    const premiumModules = gate.ok && enabled
      ? getPremiumModules().filter((m) => isModuleEnabled(m, moduleMap, remoteOverrides))
      : [];

    return { enabled, moduleMap, gate, alwaysModules, freeModules, premiumModules };
  }

  worker.moduleStateService = {
    getAccessGate,
    resolveModuleState
  };
})();
