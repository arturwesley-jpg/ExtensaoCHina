// src/service-worker/plans.js
// Plans catalog: fetches active plans from Supabase with TTL cache.
// Depends on: supabase-client.js (fetchActivePlans)
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const PLANS_CACHE_KEY = "xh_plans_catalog_cache";
  const PLANS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  async function getPlans() {
    // 1. Check fresh cache
    try {
      const stored = await chrome.storage.local.get(PLANS_CACHE_KEY);
      const cached = stored[PLANS_CACHE_KEY];
      if (cached && cached.ts && (Date.now() - cached.ts) < PLANS_TTL_MS) {
        return { ok: true, plans: cached.plans, source: "cache" };
      }
    } catch {}

    // 2. Fetch from network
    try {
      const result = await worker.supabaseClient.fetchActivePlans();
      if (result?.ok && Array.isArray(result.plans) && result.plans.length > 0) {
        const payload = { plans: result.plans, ts: Date.now() };
        chrome.storage.local.set({ [PLANS_CACHE_KEY]: payload }).catch(() => {});
        return { ok: true, plans: result.plans, source: "network" };
      }
    } catch {}

    // 3. Fallback: stale cache
    try {
      const stored = await chrome.storage.local.get(PLANS_CACHE_KEY);
      const cached = stored[PLANS_CACHE_KEY];
      if (cached && Array.isArray(cached.plans) && cached.plans.length > 0) {
        return { ok: true, plans: cached.plans, source: "stale_cache" };
      }
    } catch {}

    // 4. Offline
    return { ok: false, reason: "offline" };
  }

  worker.getPlans = getPlans;
})();
