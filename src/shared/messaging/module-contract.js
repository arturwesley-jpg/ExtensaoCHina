// module-contract.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});

  const REQUIRED_FIELDS = ["id", "name", "description", "defaultEnabled", "targets", "scripts"];

  function normalizeTargets(targets = {}) {
    return {
      matches: Array.isArray(targets.matches) ? targets.matches : [],
      runAt: targets.runAt || "document_idle",
      allFrames: !!targets.allFrames
    };
  }

  function normalizeCapabilities(capabilities = {}) {
    return {
      needsRate: !!capabilities.needsRate,
      needsBadgePrefs: !!capabilities.needsBadgePrefs
    };
  }

  function normalizeSites(sites = []) {
    if (!Array.isArray(sites)) return [];
    const seen = new Set();
    return sites
      .map((siteId) => String(siteId || "").trim().toLowerCase())
      .filter((siteId) => siteId && !seen.has(siteId) && seen.add(siteId));
  }

  function defineModule(def) {
    return {
      id: String(def.id || ""),
      name: String(def.name || ""),
      description: String(def.description || ""),
      defaultEnabled: def.defaultEnabled !== false,
      targets: normalizeTargets(def.targets),
      capabilities: normalizeCapabilities(def.capabilities),
      scripts: Array.isArray(def.scripts) ? def.scripts.slice() : [],
      sites: normalizeSites(def.sites),
      category: def.category || "Outros",
      always: def.always === true,
      free: def.free === true,
      uiVisible: def.uiVisible !== false,
    };
  }

  function validateRequiredFields(mod) {
    const missing = [];
    for (const key of REQUIRED_FIELDS) {
      if (mod[key] === undefined || mod[key] === null || mod[key] === "") missing.push(key);
    }
    if (!mod.targets?.matches?.length) missing.push("targets.matches");
    if (!mod.scripts?.length) missing.push("scripts");
    return missing;
  }

  XH.moduleContract = {
    REQUIRED_FIELDS,
    defineModule,
    validateRequiredFields
  };
})();
