// src/service-worker/shipping-rates.js
// Fetch and cache shipping rates + ICMS from edge function.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { asString } = XH.utils;
  const { dedup } = XH.helpers;

  const SUPABASE_URL = "https://juxjooigqgurprxkcocc.supabase.co";
  const CACHE_KEY = "xh_shipping_rates_v2";
  const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  function isFresh(cache) {
    if (!cache || typeof cache !== "object") return false;
    const age = Date.now() - Number(cache.cached_at_ms || 0);
    return age < TTL_MS;
  }

  async function getCached() {
    const data = await chrome.storage.local.get(CACHE_KEY);
    return data?.[CACHE_KEY] || null;
  }

  async function setCache(payload) {
    const record = { ...payload, cached_at_ms: Date.now() };
    await chrome.storage.local.set({ [CACHE_KEY]: record }).catch(() => {});
    return record;
  }

  async function fetchFromEdge() {
    const url = `${SUPABASE_URL}/functions/v1/get-shipping-rates`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`edge_http_${res.status}`);
    const body = await res.json();
    if (!body?.ok) throw new Error(asString(body?.error || "edge_not_ok"));
    return body;
  }

  const refreshShippingRates = dedup(async function refreshShippingRates(options = {}) {
    try {
      // Return cache if fresh and not forced
      if (!options?.force) {
        const cached = await getCached();
        if (isFresh(cached)) {
          return { ok: true, ...cached, fromCache: true };
        }
      }

      const data = await fetchFromEdge();
      const cached = await setCache({
        frete: Array.isArray(data.frete) ? data.frete : [],
        icms: Array.isArray(data.icms) ? data.icms : [],
        ii_aliquota: Number(data.ii_aliquota) || 0.60,
        fetched_at: asString(data.fetched_at),
      });
      return { ok: true, ...cached };
    } catch (e) {
      // Fallback to stale cache
      const stale = await getCached();
      if (stale) {
        return { ok: true, ...stale, fromCache: true, stale: true };
      }
      return { ok: false, reason: "offline", err: asString(e?.message || e) };
    }
  });

  async function getShippingRates() {
    const cached = await getCached();
    if (isFresh(cached)) {
      return { ok: true, ...cached, fromCache: true };
    }
    return refreshShippingRates();
  }

  worker.shippingRates = {
    CACHE_KEY,
    refreshShippingRates,
    getShippingRates,
  };
})();
