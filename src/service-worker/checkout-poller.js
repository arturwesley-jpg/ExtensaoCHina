// src/service-worker/checkout-poller.js
// Post-checkout polling: after a successful checkout, polls can_use() until
// access is granted or 30 minutes elapse. Persists state across SW restarts.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const CHECKOUT_POLL_ALARM = "xh_checkout_poll";
  const CHECKOUT_POLL_STATE_KEY = "xh_checkout_poll_v1";
  const CHECKOUT_PENDING_SYNC_KEY = XH.KEYS?.CHECKOUT_PENDING || "xhCheckoutPending";

  // Phase schedule (elapsed time from start -> poll interval)
  // Fase agressiva cobre os primeiros 15 min (SLA comunicado no banner da UI).
  const PHASE_1_UNTIL_MS = 15 * 60 * 1000;  // 0-15 min
  const PHASE_1_INTERVAL = 15_000;           // 15s
  const PHASE_2_UNTIL_MS = 30 * 60 * 1000;  // 15-30 min
  const PHASE_2_INTERVAL = 30_000;           // 30s
  const PHASE_3_UNTIL_MS = PHASE_2_UNTIL_MS; // mantido por compat com resumeIfActive
  const PHASE_3_INTERVAL = PHASE_2_INTERVAL;

  // --- State persistence (chrome.storage.local) ---

  async function getCheckoutPollState() {
    try {
      const data = await chrome.storage.local.get(CHECKOUT_POLL_STATE_KEY);
      const state = data?.[CHECKOUT_POLL_STATE_KEY];
      if (state && typeof state === "object" && state.active === true) return state;
    } catch {}
    return null;
  }

  async function setCheckoutPollState(state) {
    try {
      await chrome.storage.local.set({ [CHECKOUT_POLL_STATE_KEY]: state });
    } catch {}
  }

  async function clearCheckoutPoll() {
    try { await chrome.alarms.clear(CHECKOUT_POLL_ALARM); } catch {}
    try { await chrome.storage.local.remove(CHECKOUT_POLL_STATE_KEY); } catch {}
    try { await chrome.storage.sync.remove(CHECKOUT_PENDING_SYNC_KEY); } catch {}
  }

  // --- Delay calculation ---

  function computeNextDelayMs(state) {
    const elapsed = Date.now() - (Number(state?.startedAtMs) || 0);
    if (elapsed < PHASE_1_UNTIL_MS) return PHASE_1_INTERVAL;
    if (elapsed < PHASE_2_UNTIL_MS) return PHASE_2_INTERVAL;
    if (elapsed < PHASE_3_UNTIL_MS) return PHASE_3_INTERVAL;
    return 0; // signal to stop
  }

  async function scheduleNextPoll(delayMs) {
    const safeDelay = Math.max(5000, Number(delayMs) || PHASE_1_INTERVAL);
    try {
      await chrome.alarms.create(CHECKOUT_POLL_ALARM, { when: Date.now() + safeDelay });
    } catch {}
  }

  // --- Core polling ---

  async function startCheckoutPolling({ preferenceId, externalReference } = {}) {
    const now = Date.now();
    const state = {
      active: true,
      startedAtMs: now,
      preferenceId: String(preferenceId || ""),
      externalReference: String(externalReference || ""),
      pollCount: 0,
      lastPollAtMs: 0,
    };

    await setCheckoutPollState(state);

    // Set sync flag so popup can show "processing payment" state
    try {
      await chrome.storage.sync.set({
        [CHECKOUT_PENDING_SYNC_KEY]: { pending: true, startedAtMs: now },
      });
    } catch {}

    await scheduleNextPoll(PHASE_1_INTERVAL);
    console.log("[checkout-poller] started", { preferenceId, externalReference });
  }

  async function executeCheckoutPoll() {
    const state = await getCheckoutPollState();
    if (!state?.active) {
      await clearCheckoutPoll();
      return;
    }

    const nextDelay = computeNextDelayMs(state);
    if (nextDelay <= 0) {
      console.log("[checkout-poller] timeout reached, stopping");
      await clearCheckoutPoll();
      return;
    }

    // Get JWT
    let jwt = null;
    try {
      jwt = await worker.supabaseClient?.ensureValidAccessToken();
    } catch {}

    if (!jwt) {
      // No token — schedule next poll, user might still have a session later
      state.pollCount = (state.pollCount || 0) + 1;
      state.lastPollAtMs = Date.now();
      await setCheckoutPollState(state);
      await scheduleNextPoll(nextDelay);
      return;
    }

    // Check access
    let rpc = null;
    try {
      rpc = await worker.supabaseClient.fetchCanUse(jwt);
    } catch {}

    if (rpc?.ok && rpc.row?.ok === true) {
      // Access granted! Run full validateAccess to update billing/state
      console.log("[checkout-poller] access granted, finalizing");
      try {
        await worker.validateAccess?.({ force: true });
      } catch {}
      await clearCheckoutPoll();
      return;
    }

    // Not yet — schedule next poll
    state.pollCount = (state.pollCount || 0) + 1;
    state.lastPollAtMs = Date.now();
    await setCheckoutPollState(state);
    await scheduleNextPoll(nextDelay);

    console.log("[checkout-poller] poll #" + state.pollCount, {
      elapsed: Math.round((Date.now() - state.startedAtMs) / 1000) + "s",
      nextDelay: nextDelay + "ms",
    });
  }

  // --- SW restart recovery ---

  async function resumeIfActive() {
    const state = await getCheckoutPollState();
    if (!state?.active) return;

    const elapsed = Date.now() - (Number(state.startedAtMs) || 0);
    if (elapsed >= PHASE_3_UNTIL_MS) {
      console.log("[checkout-poller] expired during SW downtime, clearing");
      await clearCheckoutPoll();
      return;
    }

    // Resume with a short delay (SW just restarted)
    const delay = Math.min(computeNextDelayMs(state), 5000);
    await scheduleNextPoll(delay);
    console.log("[checkout-poller] resumed after SW restart", { elapsed: Math.round(elapsed / 1000) + "s" });
  }

  // --- Alarm listener ---

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== CHECKOUT_POLL_ALARM) return;
    executeCheckoutPoll().catch((e) => {
      console.warn("[checkout-poller] poll failed", e);
    });
  });

  // --- Exports ---

  worker.checkoutPoller = {
    startCheckoutPolling,
    clearCheckoutPoll,
    getCheckoutPollState,
    resumeIfActive,
  };
})();
