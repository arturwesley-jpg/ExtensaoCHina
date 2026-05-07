// src/service-worker/quality-items.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { asString, hasClient } = XH.utils;
  const { dedup } = XH.helpers;

  const getQualityItems = dedup(async function getQualityItems(options = {}) {
    try {
      // --- Sync cache shortcut (batch hourly) ---
      if (worker.syncEngine) {
        const cache = await worker.syncEngine.getSyncCache();
        if (worker.syncEngine.isCacheFresh(cache) && cache.qualityItems) {
          return {
            ok: true,
            items: Array.isArray(cache.qualityItems.items) ? cache.qualityItems.items : [],
            listKey: asString(cache.qualityItems.listKey || "nico"),
            listLabel: asString(cache.qualityItems.listLabel || "Recomendacoes do Nico"),
            fromCache: true,
          };
        }
      }

      if (!hasClient()) throw new Error("supabase_client_missing");
      if (typeof worker.supabaseClient.fetchQualityItems !== "function") {
        throw new Error("fetch_quality_items_missing");
      }

      const requestedLimit = Number(options?.limit || 0);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.max(1, Math.min(30, Math.trunc(requestedLimit)))
        : 12;
      const listKey = asString(options?.listKey || "nico");
      const listLabel = asString(options?.listLabel || "Recomendacoes do Nico");
      const result = await worker.supabaseClient.fetchQualityItems({ limit, listKey, listLabel });
      if (!result?.ok) return result;
      return {
        ok: true,
        items: Array.isArray(result.items) ? result.items : [],
        listKey: asString(result.listKey || listKey),
        listLabel: asString(result.listLabel || listLabel),
      };
    } catch (e) {
      return { ok: false, reason: "offline", err: asString(e?.message || e) };
    }
  });

  worker.getQualityItems = getQualityItems;
})();
