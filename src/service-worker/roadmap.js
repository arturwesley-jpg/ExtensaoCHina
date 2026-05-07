// src/service-worker/roadmap.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { asString } = XH.utils;

  const ROADMAP_DATA_CACHE_KEY = "xh_roadmap_data_cache";
  const ROADMAP_DATA_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  async function toggleRoadmapVote(featureId, voted) {
    return worker.withAuth((jwt) => worker.supabaseClient.upsertRoadmapVote(jwt, featureId, voted));
  }

  async function getMyRoadmapVotes() {
    return worker.withAuth((jwt) => worker.supabaseClient.fetchMyRoadmapVotes(jwt));
  }

  async function claimRoadmapTrialBonus() {
    return worker.withAuth((jwt) => worker.supabaseClient.claimRoadmapTrialBonus(jwt));
  }

  async function getRoadmapVoteSummary() {
    try {
      return await worker.supabaseClient.fetchRoadmapVoteSummary();
    } catch (e) {
      return { ok: false, reason: "offline", err: asString(e?.message || e) };
    }
  }

  async function getRoadmapData() {
    // Check cache first
    try {
      const stored = await chrome.storage.local.get(ROADMAP_DATA_CACHE_KEY);
      const cached = stored[ROADMAP_DATA_CACHE_KEY];
      if (cached && cached.ts && (Date.now() - cached.ts) < ROADMAP_DATA_TTL_MS) {
        return { ok: true, categories: cached.categories, features: cached.features, source: "cache" };
      }
    } catch {}

    // Fetch fresh data
    try {
      const result = await worker.supabaseClient.fetchRoadmapData();
      if (result?.ok) {
        const cachePayload = {
          categories: result.categories,
          features: result.features,
          ts: Date.now(),
        };
        chrome.storage.local.set({ [ROADMAP_DATA_CACHE_KEY]: cachePayload }).catch(() => {});
        return { ok: true, categories: result.categories, features: result.features, source: "network" };
      }
      // Network returned error — try stale cache
    } catch {}

    // Fallback: return stale cache if available
    try {
      const stored = await chrome.storage.local.get(ROADMAP_DATA_CACHE_KEY);
      const cached = stored[ROADMAP_DATA_CACHE_KEY];
      if (cached && cached.categories && cached.features) {
        return { ok: true, categories: cached.categories, features: cached.features, source: "stale_cache" };
      }
    } catch {}

    return { ok: false, reason: "offline" };
  }

  worker.toggleRoadmapVote = toggleRoadmapVote;
  worker.getMyRoadmapVotes = getMyRoadmapVotes;
  worker.claimRoadmapTrialBonus = claimRoadmapTrialBonus;
  worker.getRoadmapVoteSummary = getRoadmapVoteSummary;
  worker.getRoadmapData = getRoadmapData;
})();
