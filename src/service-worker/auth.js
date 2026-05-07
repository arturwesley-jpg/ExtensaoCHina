// src/service-worker/auth.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const AUTH = XH.authConstants || {
    KEYS: {
      TOKENS_LOCAL: "xh_tokens",
      LOGIN_STATE_LOCAL: "xh_login_state",
      MAGIC_LINK_RATE_LOCAL: "xh_magic_link_rate",
    },
    TTL_MS: {
      LOGIN_STATE: 15 * 60 * 1000,
      MAGIC_LINK_SEND_COOLDOWN: 30 * 1000,
    },
  };
  const KEY_TOKENS_LOCAL = AUTH.KEYS.TOKENS_LOCAL || "xh_tokens";
  const KEY_LOGIN_STATE_LOCAL = AUTH.KEYS.LOGIN_STATE_LOCAL || "xh_login_state";
  const KEY_MAGIC_LINK_RATE_LOCAL = AUTH.KEYS.MAGIC_LINK_RATE_LOCAL || "xh_magic_link_rate";
  const LOGIN_STATE_TTL_MS = Number(AUTH.TTL_MS?.LOGIN_STATE || 15 * 60 * 1000);
  const MAGIC_LINK_SEND_COOLDOWN_MS = Math.max(1000, Number(AUTH.TTL_MS?.MAGIC_LINK_SEND_COOLDOWN || 30 * 1000));
  const MAX_MAGIC_LINK_PARSE_DEPTH = 5;
  const NESTED_URL_PARAM_KEYS = [
    "url",
    "u",
    "target",
    "redirect",
    "redirect_to",
    "redirectUrl",
    "redirect_uri",
    "destination",
    "dest",
    "q",
    "link",
    "href",
    "next",
    "continue",
    "return",
    "return_to",
    "return_url",
    "goto",
    "to",
    "data",
    "path",
    "r",
  ];

  const { asString, hasClient, isLikelyJwt } = XH.utils;
  const { decodeHtmlUrlEntities, maybeDecodeUrl, toHashParams } = XH.helpers;

  function normalizeEmail(value) {
    return asString(value).toLowerCase();
  }

  function normalizeMagicLinkRateState(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const byEmailSource = source.by_email && typeof source.by_email === "object" ? source.by_email : {};
    const byEmail = {};

    for (const [email, msRaw] of Object.entries(byEmailSource)) {
      const safeEmail = normalizeEmail(email);
      const ms = Number(msRaw);
      if (!safeEmail || !Number.isFinite(ms) || ms <= 0) continue;
      byEmail[safeEmail] = Math.floor(ms);
    }

    const lastGlobal = Number(source.last_global_sent_at_ms || 0);
    return {
      last_global_sent_at_ms: Number.isFinite(lastGlobal) && lastGlobal > 0 ? Math.floor(lastGlobal) : 0,
      by_email: byEmail,
    };
  }

  function computeMagicLinkRetryAfterMs(lastSentAtMs) {
    const ms = Number(lastSentAtMs || 0);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    const retryAfterMs = ms + MAGIC_LINK_SEND_COOLDOWN_MS - Date.now();
    return retryAfterMs > 0 ? retryAfterMs : 0;
  }

  async function getMagicLinkRateState() {
    const data = await chrome.storage.local.get(KEY_MAGIC_LINK_RATE_LOCAL);
    return normalizeMagicLinkRateState(data?.[KEY_MAGIC_LINK_RATE_LOCAL]);
  }

  async function getMagicLinkRetryInfo(email) {
    const safeEmail = normalizeEmail(email);
    const state = await getMagicLinkRateState();
    const lastGlobalSentAtMs = Number(state.last_global_sent_at_ms || 0);
    const lastEmailSentAtMs = safeEmail ? Number(state.by_email?.[safeEmail] || 0) : 0;
    const retryAfterMs = Math.max(
      computeMagicLinkRetryAfterMs(lastGlobalSentAtMs),
      computeMagicLinkRetryAfterMs(lastEmailSentAtMs)
    );

    return {
      retryAfterMs,
      lastGlobalSentAtMs,
      lastEmailSentAtMs,
    };
  }

  async function markMagicLinkSent(email) {
    const safeEmail = normalizeEmail(email);
    const state = await getMagicLinkRateState();
    const now = Date.now();
    const minKeepMs = now - (24 * 60 * 60 * 1000);

    state.last_global_sent_at_ms = now;
    if (safeEmail) state.by_email[safeEmail] = now;

    for (const [storedEmail, msRaw] of Object.entries(state.by_email)) {
      const ms = Number(msRaw);
      if (!Number.isFinite(ms) || ms < minKeepMs) delete state.by_email[storedEmail];
    }

    await chrome.storage.local.set({
      [KEY_MAGIC_LINK_RATE_LOCAL]: state,
    });
  }

  function normalizeVerifyType(type) {
    const t = asString(type).toLowerCase();
    if (!t) return "magiclink";
    return t;
  }

  function readNestedUrlParams(searchParams, hashParams) {
    const out = [];
    for (const key of NESTED_URL_PARAM_KEYS) {
      const rawSearch = asString(searchParams.get(key));
      if (rawSearch) out.push(rawSearch);

      const rawHash = asString(hashParams.get(key));
      if (rawHash) out.push(rawHash);
    }
    return out;
  }

  function parseVerifyParamsFromUrl(rawUrl, depth = 0) {
    if (depth > MAX_MAGIC_LINK_PARSE_DEPTH) return null;

    const raw = maybeDecodeUrl(rawUrl);
    if (!raw) return null;

    let u = null;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }

    const hashParams = toHashParams(u.hash);
    const tokenHash = asString(
      u.searchParams.get("token_hash") ||
      u.searchParams.get("token") ||
      hashParams.get("token_hash") ||
      hashParams.get("token")
    );
    const type = normalizeVerifyType(u.searchParams.get("type") || hashParams.get("type"));
    if (tokenHash) return { tokenHash, type };

    const nestedCandidates = readNestedUrlParams(u.searchParams, hashParams);
    for (const nestedRaw of nestedCandidates) {
      if (!nestedRaw) continue;

      const parsed =
        parseVerifyParamsFromUrl(nestedRaw, depth + 1) ||
        parseVerifyParamsFromUrl(maybeDecodeUrl(nestedRaw), depth + 1);

      if (parsed?.tokenHash) return parsed;
    }

    return null;
  }

  function parseSessionPayloadFromUrl(rawUrl, depth = 0) {
    if (depth > MAX_MAGIC_LINK_PARSE_DEPTH) return null;

    const raw = maybeDecodeUrl(rawUrl);
    if (!raw) return null;

    let u = null;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }

    const hashParams = toHashParams(u.hash);
    const accessToken = asString(hashParams.get("access_token") || u.searchParams.get("access_token"));
    const refreshToken = asString(hashParams.get("refresh_token") || u.searchParams.get("refresh_token"));

    if (accessToken && refreshToken && isLikelyJwt(accessToken)) {
      const tokenType = asString(hashParams.get("token_type") || u.searchParams.get("token_type") || "bearer");
      const expiresAtRaw = Number(hashParams.get("expires_at") || u.searchParams.get("expires_at") || 0);
      const expiresInRaw = Number(hashParams.get("expires_in") || u.searchParams.get("expires_in") || 3600);
      const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? expiresAtRaw : 0;
      const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 3600;
      const type = normalizeVerifyType(hashParams.get("type") || u.searchParams.get("type"));

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: tokenType.toLowerCase() || "bearer",
        expires_at: expiresAt,
        expires_in: expiresIn,
        type,
      };
    }

    const nestedCandidates = readNestedUrlParams(u.searchParams, hashParams);
    for (const nestedRaw of nestedCandidates) {
      if (!nestedRaw) continue;

      const parsed =
        parseSessionPayloadFromUrl(nestedRaw, depth + 1) ||
        parseSessionPayloadFromUrl(maybeDecodeUrl(nestedRaw), depth + 1);

      if (parsed?.access_token && parsed?.refresh_token) return parsed;
    }

    return null;
  }

  function parseLoginStateFromUrl(rawUrl, depth = 0) {
    if (depth > MAX_MAGIC_LINK_PARSE_DEPTH) return "";

    const raw = maybeDecodeUrl(rawUrl);
    if (!raw) return "";

    let u = null;
    try {
      u = new URL(raw);
    } catch {
      return "";
    }

    const hashParams = toHashParams(u.hash);
    const state = asString(u.searchParams.get("xh_state") || hashParams.get("xh_state"));
    if (state) return state;

    const nestedCandidates = readNestedUrlParams(u.searchParams, hashParams);
    for (const nestedRaw of nestedCandidates) {
      if (!nestedRaw) continue;

      const nestedState =
        parseLoginStateFromUrl(nestedRaw, depth + 1) ||
        parseLoginStateFromUrl(maybeDecodeUrl(nestedRaw), depth + 1);
      if (nestedState) return nestedState;
    }

    return "";
  }

  function parseOtpCode(rawValue) {
    const raw = asString(rawValue);
    const compact = raw.replace(/\s+/g, "");
    if (/^\d{6}$/.test(compact)) return compact;
    const match = raw.match(/(?:^|\D)(\d{6})(?:\D|$)/);
    return match?.[1] || "";
  }

  async function validatePendingLoginState(rawUrl) {
    const stateFromUrl = parseLoginStateFromUrl(rawUrl);
    if (!stateFromUrl) return { ok: false, reason: "missing_state" };

    const d = await chrome.storage.local.get(KEY_LOGIN_STATE_LOCAL);
    const saved = d?.[KEY_LOGIN_STATE_LOCAL];
    const savedValue = asString(saved?.value);
    const createdAtMs = Number(saved?.created_at_ms || 0);

    if (!savedValue || !createdAtMs) return { ok: false, reason: "state_not_found" };
    if (savedValue !== stateFromUrl) return { ok: false, reason: "state_mismatch" };
    if (Date.now() - createdAtMs > LOGIN_STATE_TTL_MS) return { ok: false, reason: "state_expired" };

    return { ok: true, reason: "ok" };
  }

  async function validatePendingLoginWithoutState() {
    const d = await chrome.storage.local.get(KEY_LOGIN_STATE_LOCAL);
    const saved = d?.[KEY_LOGIN_STATE_LOCAL];
    const savedValue = asString(saved?.value);
    const createdAtMs = Number(saved?.created_at_ms || 0);

    if (!savedValue || !createdAtMs) return { ok: false, reason: "state_not_found" };
    if (Date.now() - createdAtMs > LOGIN_STATE_TTL_MS) return { ok: false, reason: "state_expired" };

    return { ok: true, reason: "ok" };
  }

  function buildTokenRecordFromVerifyPayload(payload) {
    const session = payload?.access_token ? payload : payload?.session || {};

    const accessToken = asString(session.access_token);
    const refreshToken = asString(session.refresh_token);
    if (!accessToken || !refreshToken) throw new Error("verify_missing_tokens");

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const expiresIn = Number(session.expires_in || 3600);
    const expiresAtSec =
      Number(session.expires_at || 0) > 0
        ? Number(session.expires_at)
        : nowSec + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: asString(session.token_type || "bearer").toLowerCase() || "bearer",
      expires_at: expiresAtSec,
      expires_at_ms: expiresAtSec * 1000,
    };
  }

  async function persistVerifiedSession(payload) {
    const tokens = buildTokenRecordFromVerifyPayload(payload);

    await chrome.storage.local.set({
      [KEY_TOKENS_LOCAL]: tokens,
      [XH.KEYS.SESSION]: true,
      [XH.KEYS.BACKEND_OK]: true,
    });

    await chrome.storage.sync.set({
      [XH.KEYS.SESSION]: true,
      [XH.KEYS.BACKEND_OK]: true,
    });
  }

  function normalizeBillingSnapshot(validateRow) {
    const row = validateRow && typeof validateRow === "object" ? validateRow : {};
    const planCode = asString(row.plan);
    const planName = asString(row.plan_name || row.planName);

    return {
      status_acesso: asString(row.status || row.status_acesso || "inativo"),
      plan_code: planCode,
      plan_name: planName || planCode || "",
      periodicidade: asString(row.periodicidade || ""),
      inicio_plano: asString(row.inicio_plano || row.inicioPlano || ""),
      fim_plano: asString(row.fim_plano || row.fimPlano || ""),
      updated_at_ms: Date.now(),
    };
  }

  async function setBillingSnapshot(snapshot) {
    await chrome.storage.sync.set({
      [XH.KEYS.BILLING]: snapshot || null,
    });
  }

  async function sendMagicLink(email) {
    if (!hasClient()) throw new Error("supabase_client_missing");
    await XH.authStore.setBackendOk(true);
    const gateBlocked = await worker.ensureUpdateGateAllowsUsage({ requestRuntimeCheck: true });
    if (gateBlocked) return gateBlocked;

    const safeEmail = normalizeEmail(email);
    if (!safeEmail || !safeEmail.includes("@")) {
      return { ok: false, reason: "invalid_email" };
    }

    const retryInfo = await getMagicLinkRetryInfo(safeEmail);
    if (retryInfo.retryAfterMs > 0) {
      return {
        ok: false,
        reason: "email_send_rate_limited",
        retryAfterMs: retryInfo.retryAfterMs,
        cooldownMs: MAGIC_LINK_SEND_COOLDOWN_MS,
      };
    }

    const { callbackUrl } = await worker.supabaseClient.createLoginState();
    let sendResult = null;
    try {
      sendResult = await worker.supabaseClient.sendMagicLink(safeEmail, callbackUrl);
    } catch (e) {
      const errText = asString(e?.message || e).toLowerCase();
      if (errText.includes("otp_failed 429") || errText.includes("rate limit")) {
        await markMagicLinkSent(safeEmail);
        return {
          ok: false,
          reason: "email_send_rate_limited",
          retryAfterMs: MAGIC_LINK_SEND_COOLDOWN_MS,
          cooldownMs: MAGIC_LINK_SEND_COOLDOWN_MS,
        };
      }
      throw e;
    }

    await markMagicLinkSent(safeEmail);
    return {
      ok: true,
      mode: asString(sendResult?.mode || "email_otp"),
      cooldownMs: MAGIC_LINK_SEND_COOLDOWN_MS,
      retryAfterMs: MAGIC_LINK_SEND_COOLDOWN_MS,
    };
  }

  async function validateAccess(options = {}) {
    const force = options?.force === true;
    try {
      if (!hasClient()) throw new Error("supabase_client_missing");

      // --- Sync cache shortcut (batch hourly) ---
      if (!force && worker.syncEngine) {
        const cache = await worker.syncEngine.getSyncCache();
        if (worker.syncEngine.isCacheFresh(cache) && cache.access) {
          const cached = cache.access;
          const allowed = cached.ok === true;
          const billingSnapshot = normalizeBillingSnapshot(cached);
          await XH.authStore.setBackendOk(true);
          await XH.authStore.setSession(true);
          await XH.authStore.setAccess(allowed);
          await setBillingSnapshot(billingSnapshot);
          return {
            ok: allowed,
            reason: cached.reason || "ok",
            status: cached.status,
            plan: cached.plan,
            billing: billingSnapshot,
            fromCache: true,
          };
        }
      }

      // --- Full remote validation (burst or force) ---
      await XH.authStore.setBackendOk(true);

      let jwt = await worker.supabaseClient.ensureValidAccessToken();
      if (!jwt) {
        await worker.supabaseClient.clearTokens().catch(() => {});
        await XH.authStore.setSession(false);
        await XH.authStore.setAccess(false);
        await setBillingSnapshot(null);
        return { ok: false, reason: "no_token" };
      }

      const gateBlocked = await worker.ensureUpdateGateAllowsUsage({});
      if (gateBlocked) return gateBlocked;

      let rpc = await worker.supabaseClient.fetchCanUse(jwt);
      if (!rpc.ok && Number(rpc?.status || 0) === 401) {
        const refreshedJwt = await worker.supabaseClient.ensureValidAccessToken({ forceRefresh: true });
        if (refreshedJwt && refreshedJwt !== jwt) {
          jwt = refreshedJwt;
          rpc = await worker.supabaseClient.fetchCanUse(jwt);
        }
      }
      if (!rpc.ok) {
        if (Number(rpc?.status || 0) === 401) {
          await worker.supabaseClient.clearTokens().catch(() => {});
          await XH.authStore.setSession(false);
          await XH.authStore.setAccess(false);
          await setBillingSnapshot(null);
          return { ok: false, reason: "no_token" };
        }
        await XH.authStore.setSession(false);
        await XH.authStore.setAccess(false);
        await setBillingSnapshot(null);
        return { ok: false, reason: "rpc_failed" };
      }

      const row = rpc.row || {};
      const allowed = row.ok === true;
      const billingSnapshot = normalizeBillingSnapshot(row);

      await XH.authStore.setSession(true);
      await XH.authStore.setAccess(allowed);
      await setBillingSnapshot(billingSnapshot);

      if (allowed) { try { await worker.checkoutPoller?.clearCheckoutPoll?.(); } catch {} }

      return {
        ok: allowed,
        reason: row.reason || "ok",
        status: row.status,
        plan: row.plan,
        billing: billingSnapshot,
      };
    } catch {
      await XH.authStore.setBackendOk(false);
      return { ok: false, reason: "offline" };
    } finally {
      try {
        await worker.applyState?.();
      } catch {}
    }
  }

  async function consumeMagicLinkUrl(rawUrl) {
    if (!hasClient()) throw new Error("supabase_client_missing");
    const gateBlocked = await worker.ensureUpdateGateAllowsUsage({ requestRuntimeCheck: true });
    if (gateBlocked) return gateBlocked;

    const otpCode = parseOtpCode(rawUrl);
    const isOtpCodeInput = !!otpCode;
    const parsedVerify = isOtpCodeInput ? null : parseVerifyParamsFromUrl(rawUrl);
    const parsedSession = isOtpCodeInput || parsedVerify?.tokenHash ? null : parseSessionPayloadFromUrl(rawUrl);
    if (!isOtpCodeInput && !parsedVerify?.tokenHash && !parsedSession?.access_token) {
      return { ok: false, reason: "invalid_magic_link_url" };
    }

    try {
      await XH.authStore.setBackendOk(true);
      const stateCheck = isOtpCodeInput
        ? await validatePendingLoginWithoutState()
        : await validatePendingLoginState(rawUrl);
      if (!stateCheck.ok) {
        return { ok: false, reason: "invalid_magic_link_url", err: stateCheck.reason };
      }

      const payload = isOtpCodeInput
        ? await worker.supabaseClient.verifyEmailOtpCode(otpCode)
        : (parsedVerify?.tokenHash
          ? await worker.supabaseClient.verifyTokenHash(parsedVerify.tokenHash, parsedVerify.type)
          : parsedSession);
      await persistVerifiedSession(payload);
      await worker.supabaseClient.clearLoginState().catch(() => {});

      // Force bypass cache — user must see access instantly after login
      const result = await validateAccess({ force: true });

      // Refresh the entire sync engine cache (quality items, search flush, etc.)
      // without re-calling fetchCanUse — validateAccess already did that.
      if (worker.syncEngine) {
        worker.syncEngine.runBurst({ force: false }).catch(() => {});
      }

      return {
        ...result,
        consumed: true,
        tokenType: isOtpCodeInput ? "email_otp_code" : (parsedVerify?.type || parsedSession?.type || "magiclink"),
      };
    } catch (e) {
      const errText = asString(e?.message || e);
      const normalizedErr = errText.toLowerCase();
      let reason = "verify_failed";
      if (normalizedErr.includes("otp_email_missing")) reason = "otp_email_missing";
      if (normalizedErr.includes("invalid_otp_code")) reason = "invalid_otp_code";
      return {
        ok: false,
        reason,
        err: errText,
      };
    }
  }

  async function logout() {
    if (!hasClient()) throw new Error("supabase_client_missing");
    await worker.supabaseClient.clearTokens();
    await worker.supabaseClient.clearLoginState();
    await worker._searchQueue.clearSearchQueueAndAlarm();
    try { await worker.checkoutPoller?.clearCheckoutPoll?.(); } catch {}
    await XH.authStore.setSession(false);
    await XH.authStore.setAccess(false);
    await XH.authStore.setBackendOk(true);
    await setBillingSnapshot(null);

    try {
      await worker.applyState?.();
    } catch {}
  }

  worker.sendMagicLink = sendMagicLink;
  // refreshUpdateGate, getUpdateGate, ensureUpdateGateAllowsUsage — provided by update-gate.js
  worker.validateAccess = validateAccess;
  worker.consumeMagicLinkUrl = consumeMagicLinkUrl;
  worker.logout = logout;
  worker.setBillingSnapshot = setBillingSnapshot;
  // trackSearchEvent, flushSearchQueue — provided by search-queue.js
  // startCheckout — provided by checkout.js
  // submitSuggestion — provided by suggestions.js
  // getQualityItems — provided by quality-items.js
  // toggleRoadmapVote, getMyRoadmapVotes, claimRoadmapTrialBonus, getRoadmapVoteSummary, getRoadmapData — provided by roadmap.js
})();
