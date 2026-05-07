// src/service-worker/search-queue.js
// Search event queue: local buffering, deduplication, rate limiting, batched flush to Supabase.
// Depends on supabase-client.js (loaded before this) for worker.supabaseClient.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const KEY_SEARCH_QUEUE_LOCAL = "xh_search_queue_v1";
  const KEY_SEARCH_CLIENT_ID_LOCAL = "xh_search_client_id";
  const SEARCH_FLUSH_ALARM = "xh_search_events_flush";
  const SEARCH_QUEUE_MAX = 400;
  const SEARCH_BATCH_SIZE = 40;
  const SEARCH_FLUSH_MAX_ROUNDS = 3;
  const SEARCH_QUERY_MAX_LEN = 220;
  const SEARCH_PATH_MAX_LEN = 400;
  const SEARCH_LOCAL_DEDUPE_WINDOW_MS = 30 * 1000;
  const SEARCH_RATE_WINDOW_MS = 60 * 1000;
  const SEARCH_RATE_MAX_EVENTS_PER_WINDOW = 30;
  const SEARCH_FLUSH_DELAY_MS = 60 * 60 * 1000; // 1 hour — main flush is via sync engine burst
  const SEARCH_FLUSH_JITTER_MS = 5 * 1000;
  const SEARCH_FLUSH_FAST_MS = 5 * 1000;
  const SEARCH_RETRY_BASE_MS = 30 * 1000;
  const SEARCH_RETRY_MAX_MS = 15 * 60 * 1000;
  const SEARCH_RETRY_JITTER_MS = 20 * 1000;
  const SEARCH_MERGE_COUNT_CAP = 200;

  let searchFlushPromise = null;
  let searchRateWindowStartMs = 0;
  let searchRateUsedInWindow = 0;
  let searchFlushRetryAttempts = 0;
  let trackQueueMutex = Promise.resolve();

  const { asString, hasClient, sanitizeSearchQuery, normalizeSearchQuery, sanitizeSearchTrigger, sanitizeSearchPagePath, sanitizeSearchSourceSite } = XH.utils;
  const { sanitizeSlugId } = XH.helpers;

  function buildSearchDedupeKey(input) {
    const raw = input && typeof input === "object" ? input : {};
    const sourceSite = sanitizeSearchSourceSite(raw.sourceSite || raw.source_site || raw.siteId || raw.site_id);
    const queryNorm = normalizeSearchQuery(raw.queryNorm || raw.query || raw.term || "");
    const pagePath = sanitizeSearchPagePath(raw.pagePath || raw.path || "/");
    const trigger = sanitizeSearchTrigger(raw.trigger || raw.source || "unknown");
    return `${sourceSite}|${queryNorm}|${pagePath}|${trigger}`;
  }

  function newSearchClientId() {
    if (globalThis.crypto?.randomUUID) {
      return sanitizeSlugId(`xh_${globalThis.crypto.randomUUID().replace(/-/g, "")}`);
    }
    const raw = `xh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    return sanitizeSlugId(raw);
  }

  function normalizeSearchQueueItem(input) {
    const raw = input && typeof input === "object" ? input : {};
    const query = sanitizeSearchQuery(raw.query || raw.term || "");
    const queryNorm = normalizeSearchQuery(raw.queryNorm || query);
    if (query.length < 2 || queryNorm.length < 2) return null;

    const createdAtMsRaw = Number(raw.createdAtMs || raw.ts || raw.clientCreatedAtMs || Date.now());
    const createdAtMs = Number.isFinite(createdAtMsRaw) && createdAtMsRaw > 0
      ? Math.trunc(createdAtMsRaw)
      : Date.now();

    const rawCount = Math.trunc(Number(raw.count)) || 1;
    const count = Math.max(1, Math.min(200, rawCount));
    const rawFirstTs = Number(raw.firstTs);
    const firstTs = Number.isFinite(rawFirstTs) && rawFirstTs > 0 ? Math.trunc(rawFirstTs) : createdAtMs;
    const rawLastTs = Number(raw.lastTs);
    const lastTs = Number.isFinite(rawLastTs) && rawLastTs > 0 ? Math.trunc(rawLastTs) : createdAtMs;

    return {
      query,
      queryNorm,
      sourceSite: sanitizeSearchSourceSite(raw.sourceSite || raw.source_site || raw.siteId || raw.site_id),
      trigger: sanitizeSearchTrigger(raw.trigger || raw.source || "unknown"),
      pagePath: sanitizeSearchPagePath(raw.pagePath || raw.path || "/"),
      createdAtMs,
      dedupeKey: buildSearchDedupeKey(raw),
      count,
      firstTs,
      lastTs,
    };
  }

  function normalizeSearchQueue(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const item of source) {
      const normalized = normalizeSearchQueueItem(item);
      if (!normalized) continue;
      out.push(normalized);
    }
    if (out.length <= SEARCH_QUEUE_MAX) return out;
    return out.slice(out.length - SEARCH_QUEUE_MAX);
  }

  function mergeIntoRecentDuplicate(queue, candidate) {
    const list = Array.isArray(queue) ? queue : [];
    const item = candidate && typeof candidate === "object" ? candidate : null;
    if (!item) return { merged: false };
    const itemKey = asString(item.dedupeKey || buildSearchDedupeKey(item));
    if (!itemKey) return { merged: false };
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const current = list[i];
      const age = Number(item.createdAtMs || 0) - Number(current?.createdAtMs || 0);
      if (!Number.isFinite(age) || age > SEARCH_LOCAL_DEDUPE_WINDOW_MS) break;
      const currentKey = asString(current?.dedupeKey || buildSearchDedupeKey(current));
      if (currentKey === itemKey) {
        current.count = Math.min(SEARCH_MERGE_COUNT_CAP, (current.count || 1) + 1);
        current.lastTs = Math.max(current.lastTs || 0, item.createdAtMs || 0);
        return { merged: true, index: i };
      }
    }
    return { merged: false };
  }

  async function getSearchQueue() {
    const data = await chrome.storage.local.get(KEY_SEARCH_QUEUE_LOCAL);
    return normalizeSearchQueue(data?.[KEY_SEARCH_QUEUE_LOCAL]);
  }

  async function setSearchQueue(queue) {
    await chrome.storage.local.set({
      [KEY_SEARCH_QUEUE_LOCAL]: normalizeSearchQueue(queue),
    });
  }

  function isUpdateGateRequired(gateInput) {
    const gate = gateInput && typeof gateInput === "object" ? gateInput : null;
    return gate?.required === true;
  }

  async function getSearchTrackingGate() {
    const data = await chrome.storage.sync.get([
      XH.KEYS.SESSION,
      XH.KEYS.ACCESS,
      XH.KEYS.BACKEND_OK,
      XH.KEYS.UPDATE_GATE,
    ]);
    if (data?.[XH.KEYS.SESSION] !== true) return { ok: false, reason: "no_session" };
    if (data?.[XH.KEYS.ACCESS] !== true) return { ok: false, reason: "no_access" };
    if (data?.[XH.KEYS.BACKEND_OK] === false) return { ok: false, reason: "offline" };
    if (isUpdateGateRequired(data?.[XH.KEYS.UPDATE_GATE])) return { ok: false, reason: "update_required" };
    return { ok: true };
  }

  async function clearSearchQueueAndAlarm() {
    await setSearchQueue([]);
    try { await chrome.alarms.clear(SEARCH_FLUSH_ALARM); } catch {}
  }

  async function getSearchClientId() {
    const data = await chrome.storage.local.get(KEY_SEARCH_CLIENT_ID_LOCAL);
    const current = sanitizeSlugId(data?.[KEY_SEARCH_CLIENT_ID_LOCAL]);
    if (current.length >= 8) return current;
    const next = newSearchClientId();
    await chrome.storage.local.set({ [KEY_SEARCH_CLIENT_ID_LOCAL]: next });
    return next;
  }

  function consumeSearchRateQuota() {
    const now = Date.now();
    if (!searchRateWindowStartMs || now - searchRateWindowStartMs >= SEARCH_RATE_WINDOW_MS) {
      searchRateWindowStartMs = now;
      searchRateUsedInWindow = 0;
    }

    if (searchRateUsedInWindow >= SEARCH_RATE_MAX_EVENTS_PER_WINDOW) {
      const retryAfterMs = Math.max(1000, (searchRateWindowStartMs + SEARCH_RATE_WINDOW_MS) - now);
      return { ok: false, retryAfterMs };
    }

    searchRateUsedInWindow += 1;
    return { ok: true, remaining: Math.max(0, SEARCH_RATE_MAX_EVENTS_PER_WINDOW - searchRateUsedInWindow) };
  }

  async function scheduleSearchFlush(delayMs = SEARCH_FLUSH_DELAY_MS, withJitter = true) {
    const safeDelay = Math.max(1000, Number(delayMs) || SEARCH_FLUSH_DELAY_MS);
    const jitter = withJitter ? Math.floor(Math.random() * SEARCH_FLUSH_JITTER_MS) : 0;
    try {
      await chrome.alarms.create(SEARCH_FLUSH_ALARM, { when: Date.now() + safeDelay + jitter });
    } catch {}
  }

  function resetSearchRetryBackoff() {
    searchFlushRetryAttempts = 0;
  }

  function nextSearchRetryDelayMs() {
    const attempt = Math.min(12, Math.max(1, searchFlushRetryAttempts + 1));
    searchFlushRetryAttempts = attempt;
    const expDelay = SEARCH_RETRY_BASE_MS * (2 ** (attempt - 1));
    const cappedDelay = Math.min(SEARCH_RETRY_MAX_MS, expDelay);
    const jitter = Math.floor(Math.random() * SEARCH_RETRY_JITTER_MS);
    return cappedDelay + jitter;
  }

  function shouldDropQueueForGateReason(reason) {
    return reason === "no_session" || reason === "no_access";
  }

  async function flushSearchQueue(options = {}) {
    if (searchFlushPromise && options?.force !== true) return searchFlushPromise;

    searchFlushPromise = (async () => {
      if (!hasClient()) return { ok: false, reason: "supabase_client_missing" };
      if (typeof worker.supabaseClient.insertSearchEvents !== "function") {
        return { ok: false, reason: "insert_search_events_missing" };
      }

      const gate = await getSearchTrackingGate();
      if (!gate.ok) {
        if (shouldDropQueueForGateReason(gate.reason)) {
          await clearSearchQueueAndAlarm();
          resetSearchRetryBackoff();
          return { ok: true, insertedCount: 0, remaining: 0, dropped: true, reason: gate.reason };
        }
        const queued = await getSearchQueue();
        if (!queued.length) {
          try { await chrome.alarms.clear(SEARCH_FLUSH_ALARM); } catch {}
          resetSearchRetryBackoff();
          return { ok: true, insertedCount: 0, remaining: 0, paused: true, reason: gate.reason };
        }
        const retryAfterMs = nextSearchRetryDelayMs();
        await scheduleSearchFlush(retryAfterMs, false);
        return {
          ok: false,
          paused: true,
          reason: gate.reason,
          retryAfterMs,
          insertedCount: 0,
          remaining: queued.length,
        };
      }

      let queue = await getSearchQueue();
      if (!queue.length) {
        try { await chrome.alarms.clear(SEARCH_FLUSH_ALARM); } catch {}
        resetSearchRetryBackoff();
        return { ok: true, insertedCount: 0, remaining: 0 };
      }

      const clientId = await getSearchClientId();
      let totalInserted = 0;
      let rounds = 0;

      while (queue.length > 0 && rounds < SEARCH_FLUSH_MAX_ROUNDS) {
        rounds += 1;
        const batch = queue.slice(0, SEARCH_BATCH_SIZE);
        let accessToken = "";
        try {
          accessToken = await worker.supabaseClient.ensureValidAccessToken();
        } catch {
          accessToken = "";
        }

        const result = await worker.supabaseClient.insertSearchEvents(accessToken, batch, { clientId });
        if (!result?.ok) {
          await setSearchQueue(queue);
          const retryAfterMs = nextSearchRetryDelayMs();
          await scheduleSearchFlush(retryAfterMs, false);
          return {
            ok: false,
            reason: asString(result?.reason || "search_events_insert_failed"),
            status: Number(result?.status || 0) || 0,
            err: asString(result?.err || ""),
            retryAfterMs,
            insertedCount: totalInserted,
            remaining: queue.length,
          };
        }

        queue = queue.slice(batch.length);
        totalInserted += Number(result?.insertedCount || 0) || 0;
      }

      await setSearchQueue(queue);
      if (queue.length > 0) await scheduleSearchFlush(10 * 1000, false);
      else {
        try { await chrome.alarms.clear(SEARCH_FLUSH_ALARM); } catch {}
      }

      resetSearchRetryBackoff();
      return { ok: true, insertedCount: totalInserted, remaining: queue.length };
    })().finally(() => {
      searchFlushPromise = null;
    });

    return searchFlushPromise;
  }

  async function trackSearchEvent(input) {
    return (trackQueueMutex = trackQueueMutex.then(
      () => _trackSearchEventInner(input),
      () => _trackSearchEventInner(input),
    ));
  }

  async function _trackSearchEventInner(input) {
    try {
      if (!hasClient()) throw new Error("supabase_client_missing");
      if (typeof worker.supabaseClient.insertSearchEvents !== "function") {
        throw new Error("insert_search_events_missing");
      }

      const gate = await getSearchTrackingGate();
      if (!gate.ok) return { ok: true, skipped: true, reason: gate.reason };

      const item = normalizeSearchQueueItem(input);
      if (!item) return { ok: false, reason: "invalid_query" };

      const queue = await getSearchQueue();
      const mergeResult = mergeIntoRecentDuplicate(queue, item);
      if (mergeResult.merged) {
        await setSearchQueue(queue);
        return { ok: true, merged: true, count: queue[mergeResult.index].count, queueSize: queue.length };
      }

      const quota = consumeSearchRateQuota();
      if (!quota.ok) {
        return { ok: true, dropped: true, reason: "rate_limited", retryAfterMs: quota.retryAfterMs };
      }

      queue.push(item);
      const trimmedQueue = normalizeSearchQueue(queue);
      await setSearchQueue(trimmedQueue);

      if (trimmedQueue.length >= SEARCH_BATCH_SIZE) {
        await scheduleSearchFlush(SEARCH_FLUSH_FAST_MS, false);
      } else {
        await scheduleSearchFlush(SEARCH_FLUSH_DELAY_MS, true);
      }

      return { ok: true, queued: true, merged: false, queueSize: trimmedQueue.length };
    } catch (e) {
      return { ok: false, reason: "offline", err: asString(e?.message || e) };
    }
  }

  // --- Alarm listener ---
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== SEARCH_FLUSH_ALARM) return;
    flushSearchQueue({ force: true }).catch(() => {});
  });

  // Drain leftover queue is now handled by sync engine burst on startup.

  // --- Exports ---
  worker.trackSearchEvent = trackSearchEvent;
  worker.flushSearchQueue = flushSearchQueue;
  worker._searchQueue = { clearSearchQueueAndAlarm };
})();
