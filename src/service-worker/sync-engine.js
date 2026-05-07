// src/service-worker/sync-engine.js
// Sync engine: batch hourly burst to reduce Supabase requests.
// Depends on: supabase-client.js, supabase-vendors.js, search-queue.js, update-gate.js, auth-store.js, modules.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const SYNC_ALARM_NAME = "xh_sync_burst";
  const SYNC_CACHE_KEY = "xh_sync_cache_v1";

  let syncBurstPromise = null;

  // In-memory access cache — authoritative source for access decisions.
  // chrome.storage.local is used only for persistence across SW restarts,
  // but the in-memory copy is what validateAccess reads. This prevents
  // content scripts from tampering with access state via storage writes.
  let inMemoryAccessCache = null; // { lastSyncAtMs, access, updateGate, qualityItems, ... }

  const { asString } = XH.utils;
  const { isCacheFresh: _isCacheFresh } = XH.helpers;

  function isCacheFresh(cache) {
    if (!cache || typeof cache !== "object") return false;
    return _isCacheFresh(Number(cache.lastSyncAtMs || 0), SYNC_INTERVAL_MS);
  }

  // --- Cache read/write ---

  async function getSyncCache() {
    // Prefer in-memory cache (tamper-proof) over storage
    if (inMemoryAccessCache && typeof inMemoryAccessCache === "object") {
      return inMemoryAccessCache;
    }
    // Fallback: load from storage on SW restart, then keep in memory
    const data = await chrome.storage.local.get(SYNC_CACHE_KEY);
    const cache = data?.[SYNC_CACHE_KEY];
    if (cache && typeof cache === "object") {
      inMemoryAccessCache = cache;
      return cache;
    }
    return null;
  }

  async function setSyncCache(patch) {
    const current = inMemoryAccessCache || {};
    const next = { ...current, ...patch, lastSyncAtMs: Date.now() };
    inMemoryAccessCache = next;
    // Persist to storage for SW restart recovery (non-authoritative)
    await chrome.storage.local.set({ [SYNC_CACHE_KEY]: next }).catch(() => {});
    return next;
  }

  // --- Alarm management ---

  async function ensureSyncAlarm() {
    try {
      const existing = await chrome.alarms.get(SYNC_ALARM_NAME);
      if (
        existing &&
        Number.isFinite(Number(existing.periodInMinutes)) &&
        Math.abs(Number(existing.periodInMinutes) - 60) < 0.001
      ) {
        return;
      }
      chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 60 });
    } catch {
      chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 60 });
    }
  }

  // --- Core burst logic ---

  async function executeBurst() {
    const patch = {};

    // 1. Token refresh
    let jwt = null;
    try {
      jwt = await worker.supabaseClient.ensureValidAccessToken();
    } catch {
      jwt = null;
    }

    // 2. Validate access (can_use RPC) and sync auth store
    if (jwt) {
      try {
        let rpc = await worker.supabaseClient.fetchCanUse(jwt);
        // Retry once on 401 with forced refresh
        if (!rpc.ok && Number(rpc?.status || 0) === 401) {
          const refreshedJwt = await worker.supabaseClient.ensureValidAccessToken({ forceRefresh: true });
          if (refreshedJwt && refreshedJwt !== jwt) {
            jwt = refreshedJwt;
            rpc = await worker.supabaseClient.fetchCanUse(jwt);
          }
        }

        if (rpc.ok) {
          const row = rpc.row || {};
          const allowed = row.ok === true;
          patch.access = {
            ok: allowed,
            reason: row.reason || "ok",
            status: row.status,
            plan: row.plan,
            plan_name: row.plan_name,
            periodicidade: row.periodicidade,
            inicio_plano: row.inicio_plano,
            fim_plano: row.fim_plano,
          };
          // Keep auth store in sync so content scripts and popup see correct state
          try {
            await XH.authStore.setBackendOk(true);
            await XH.authStore.setSession(true);
            await XH.authStore.setAccess(allowed);
            if (allowed) { try { await worker.checkoutPoller?.clearCheckoutPoll?.(); } catch {} }
          } catch {}
        } else {
          patch.access = { ok: false, reason: asString(rpc?.reason || "rpc_failed") };
        }
      } catch {
        patch.access = { ok: false, reason: "offline" };
      }
    } else {
      patch.access = { ok: false, reason: "no_token" };
    }

    // 3. Refresh update gate — fetches runtime config and persists it.
    // refreshUpdateGate already calls fetchPublicRuntimeConfig internally,
    // so we only call it once to avoid a double network request.
    try {
      if (typeof worker.refreshUpdateGate === "function") {
        const gate = await worker.refreshUpdateGate({ force: true });
        if (gate) {
          patch.updateGate = gate;
        }
      }
    } catch {}

    // 4. Fetch quality items — no auth needed
    try {
      if (typeof worker.supabaseClient?.fetchQualityItems === "function") {
        const qResult = await worker.supabaseClient.fetchQualityItems({
          limit: 12,
          listKey: "nico",
          listLabel: "Recomendacoes do Nico",
        });
        if (qResult?.ok) {
          patch.qualityItems = {
            items: Array.isArray(qResult.items) ? qResult.items : [],
            listKey: asString(qResult.listKey || "nico"),
            listLabel: asString(qResult.listLabel || "Recomendacoes do Nico"),
          };
        }
      }
    } catch {}

    // 4b. Pre-fetch plans catalog
    try {
      if (typeof worker.getPlans === "function") await worker.getPlans();
    } catch {}

    // 4c. Refresh shipping rates (no auth needed)
    try {
      if (worker.shippingRates?.refreshShippingRates) {
        await worker.shippingRates.refreshShippingRates();
      }
    } catch {}

    // 5. Flush search events
    try {
      if (typeof worker.flushSearchQueue === "function") {
        await worker.flushSearchQueue({ force: true });
      }
    } catch {}

    // Save cache (in-memory + storage)
    const cache = await setSyncCache(patch);

    // Apply module state so content scripts reflect the latest access
    try {
      await worker.applyState?.();
    } catch {}

    return cache;
  }

  async function runBurst(options = {}) {
    // Always serialize — if a burst is in flight, wait for it.
    // For force: true, chain a new burst after the current one finishes.
    if (syncBurstPromise) {
      if (options?.force === true) {
        // Wait for in-flight burst to finish, then run a fresh one
        try { await syncBurstPromise; } catch {}
        // After awaiting, fall through to start a new burst below
      } else {
        return syncBurstPromise;
      }
    }

    syncBurstPromise = (async () => {
      try {
        const cache = await executeBurst();
        console.log("[sync-engine] burst complete", {
          lastSyncAtMs: cache.lastSyncAtMs,
          accessOk: cache.access?.ok,
        });
        return cache;
      } catch (e) {
        console.warn("[sync-engine] burst failed", e);
        return null;
      }
    })().finally(() => {
      syncBurstPromise = null;
    });

    return syncBurstPromise;
  }

  // Force burst — called after login, serializes with any in-flight burst
  async function forceBurst() {
    return runBurst({ force: true });
  }

  // --- Alarm listener ---

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SYNC_ALARM_NAME) return;
    // Periodic alarm uses force: false — no need to bypass dedup
    runBurst({ force: false }).catch(() => {});
  });

  // --- Exports ---

  worker.syncEngine = {
    SYNC_INTERVAL_MS,
    getSyncCache,
    isCacheFresh,
    ensureSyncAlarm,
    runBurst,
    forceBurst,
  };
})();
