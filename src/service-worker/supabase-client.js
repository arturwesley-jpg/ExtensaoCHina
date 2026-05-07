// src/service-worker/supabase-client.js
// Core Supabase client: config, utilities, token management, auth API,
// checkout, suggestions, search events, runtime config.
// Vendor/quality items are in supabase-vendors.js (loaded after this file).
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const KEY_TOKENS_LOCAL = XH.authConstants?.KEYS?.TOKENS_LOCAL || "xh_tokens";
  const KEY_LOGIN_STATE_LOCAL = XH.authConstants?.KEYS?.LOGIN_STATE_LOCAL || "xh_login_state";
  const KEY_LAST_EMAIL_LOCAL = XH.authConstants?.KEYS?.LAST_EMAIL_LOCAL || "xh_last_email";

  const SUPABASE_URL = "https://kingqexklavbxaqcknxf.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_c4YEWOt4p09zkWQ6IgSiUg_7EnXjcUs";
  const TOKEN_REFRESH_MARGIN_MS = 60_000;
  const SUGGESTIONS_TABLE = "sugestoes_extensao";
  const ROADMAP_VOTES_TABLE = "roadmap_votes";
  const ROADMAP_VOTES_SUMMARY_VIEW = "roadmap_votes_summary";
  const SEARCH_EVENTS_TABLE = "xianyu_search_events";
  const MAX_SEARCH_QUERY_TEXT = 220;
  const APP_RUNTIME_CONFIG_TABLE = "app_runtime_config";
  const APP_RUNTIME_CONFIG_KEY = "importkit";

  const CALLBACK_URL = chrome.runtime.getURL("src/ui/auth/callback.html");

  // --- Shared utility functions (from XH.utils) ---
  const { asString, parseJsonSafe, hasClient, sanitizeSearchQuery, normalizeSearchQuery, sanitizeSearchTrigger, sanitizeSearchPagePath, sanitizeSearchSourceSite, toIsoFromMs, toMsFromIso } = XH.utils;
  const { sanitizeText, sanitizeSlugId, getUserIdFromJwt, parseSupabaseErrorDetail, deriveErrorReason } = XH.helpers;

  // --- Internal fetch helper ---

  async function supabaseFetch(path, options = {}) {
    const { method = "GET", body, accessToken, prefer, headers: extra } = options;
    const url = path.startsWith("http") ? path : `${SUPABASE_URL}${path}`;
    const headers = { apikey: SUPABASE_ANON_KEY };
    const token = asString(accessToken) || SUPABASE_ANON_KEY;
    headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    if (extra) Object.assign(headers, extra);

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text().catch(() => "");
    const payload = parseJsonSafe(txt);
    return { res, txt, payload, ok: res.ok, status: res.status };
  }

  async function withAuth(fn, options = {}) {
    try {
      if (!hasClient()) throw new Error("supabase_client_missing");
      if (options.ensureBackendOk) await XH.authStore.setBackendOk(true);
      if (options.checkGate) {
        const gateBlocked = await worker.ensureUpdateGateAllowsUsage({ requestRuntimeCheck: true });
        if (gateBlocked) return gateBlocked;
      }
      const jwt = await ensureValidAccessToken();
      if (!jwt) {
        await XH.authStore.setSession(false);
        await XH.authStore.setAccess(false);
        return { ok: false, reason: "no_token" };
      }
      return await fn(jwt);
    } catch (e) {
      if (options.ensureBackendOk) await XH.authStore.setBackendOk(false);
      return { ok: false, reason: "offline", err: asString(e?.message || e) };
    }
  }

  // --- Suggestion normalizers ---

  function normalizeSuggestionTimestamp(row) {
    const iso =
      asString(row?.created_at) ||
      asString(row?.created_at_client) ||
      asString(row?.criado_em) ||
      asString(row?.criado_em_cliente);
    if (!iso) return { iso: new Date().toISOString(), ms: Date.now() };
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return { iso: new Date().toISOString(), ms: Date.now() };
    return { iso, ms };
  }

  function normalizeSuggestionRow(row) {
    const text = sanitizeText(row?.texto || row?.text || row?.sugestao, 600, false);
    if (!text) return null;
    const stamp = normalizeSuggestionTimestamp(row || {});
    const idRaw = asString(row?.id);
    const id = idRaw || `sg-${stamp.ms}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      text,
      source: asString(row?.origem || row?.source || "options") || "options",
      created_at: stamp.iso,
      created_at_ms: stamp.ms,
    };
  }

  const SUGGESTION_REASON_RULES = [
    ["support_rate_limited", "support_rate_limited"],
    ["support_rate_limited", "suggestion_rate_limit"],
    ["support_rate_limited", "rate limit"],
    ["suggestions_table_missing", ["relation", SUGGESTIONS_TABLE]],
    ["suggestions_policy_blocked", "row-level security"],
    ["suggestions_policy_blocked", "permission denied"],
  ];

  // --- Search events normalizers ---

  const SEARCH_EVENTS_REASON_RULES = [
    ["search_events_rate_limited", "rate_limited"],
    ["search_events_not_authenticated", "not_authenticated"],
    ["invalid_client_id", "invalid_client_id"],
    ["invalid_payload", "invalid_payload"],
    ["search_events_table_missing", ["relation", SEARCH_EVENTS_TABLE]],
    ["search_events_policy_blocked", "row-level security"],
    ["search_events_policy_blocked", "permission denied"],
  ];

  // --- Runtime config ---

  function normalizeRuntimeConfigRow(row) {
    const payload = row && typeof row === "object" ? row : {};
    return {
      app_key: asString(payload.app_key),
      min_required_version: asString(payload.min_required_version),
      update_title: asString(payload.update_title),
      update_message: asString(payload.update_message),
      chrome_store_url: asString(payload.chrome_store_url),
      edge_store_url: asString(payload.edge_store_url),
      updated_at: asString(payload.updated_at),
      extension_config: payload.extension_config && typeof payload.extension_config === "object"
        ? payload.extension_config
        : {},
    };
  }

  // --- Token management ---

  let refreshInFlightPromise = null;

  async function getTokens() {
    const d = await chrome.storage.local.get(KEY_TOKENS_LOCAL);
    return d[KEY_TOKENS_LOCAL] || null;
  }

  async function setTokens(tokens) {
    await chrome.storage.local.set({ [KEY_TOKENS_LOCAL]: tokens });
  }

  async function clearTokens() {
    await chrome.storage.local.remove(KEY_TOKENS_LOCAL);
  }

  async function setLoginState(state) {
    await chrome.storage.local.set({
      [KEY_LOGIN_STATE_LOCAL]: { value: state, created_at_ms: Date.now() },
    });
  }

  async function clearLoginState() {
    await chrome.storage.local.remove(KEY_LOGIN_STATE_LOCAL);
  }

  async function getLastEmail() {
    const data = await chrome.storage.local.get(KEY_LAST_EMAIL_LOCAL);
    const email = asString(data?.[KEY_LAST_EMAIL_LOCAL]).toLowerCase();
    return email;
  }

  function newLoginState() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
  }

  function buildCallbackUrlWithState(state) {
    const u = new URL(CALLBACK_URL);
    u.searchParams.set("xh_state", state);
    return u.toString();
  }

  async function createLoginState() {
    const state = newLoginState();
    const callbackUrl = buildCallbackUrlWithState(state);
    await setLoginState(state);
    return { state, callbackUrl };
  }

  async function ensureValidAccessToken(options = {}) {
    const forceRefresh = options === true || options?.forceRefresh === true;
    const current = await getTokens();
    const accessToken = asString(current?.access_token);
    const refreshToken = asString(current?.refresh_token);
    if (!accessToken || !refreshToken) return null;

    if (
      !forceRefresh &&
      typeof current.expires_at_ms === "number" &&
      current.expires_at_ms - Date.now() > TOKEN_REFRESH_MARGIN_MS
    ) {
      return accessToken;
    }

    // Dedup: if a refresh is already in flight, reuse it
    if (refreshInFlightPromise) return refreshInFlightPromise;

    refreshInFlightPromise = (async () => {
      try {
        const { res, txt, payload } = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: { refresh_token: refreshToken },
        });

        if (!res.ok) {
          const detail = asString(
            payload?.msg || payload?.error_description || payload?.error || payload?.message || txt || `refresh_failed_${res.status}`
          );
          console.warn("[supabase] refresh_token_failed", { status: res.status, detail });
          return null;
        }

        const nextAccessToken = asString(payload?.access_token);
        if (!nextAccessToken) return null;
        const next = {
          access_token: nextAccessToken,
          refresh_token: asString(payload?.refresh_token) || refreshToken,
          token_type: asString(payload?.token_type || "bearer") || "bearer",
          expires_at_ms: Date.now() + Number(payload.expires_in || 3600) * 1000,
        };

        await setTokens(next);
        return next.access_token;
      } catch (e) {
        console.warn("[supabase] refresh_token_error", e);
        return null;
      }
    })().finally(() => {
      refreshInFlightPromise = null;
    });

    return refreshInFlightPromise;
  }

  // --- Auth API ---

  async function sendMagicLink(email, callbackUrl) {
    const safeEmail = asString(email).toLowerCase();
    if (!safeEmail || !safeEmail.includes("@")) throw new Error("invalid_email");

    await chrome.storage.local.set({ [KEY_LAST_EMAIL_LOCAL]: safeEmail });

    const otpBase = `${SUPABASE_URL}/auth/v1/otp`;
    const attempts = [
      {
        mode: "email_otp",
        includeRedirect: false,
        payload: { email: safeEmail, create_user: true, type: "email" },
      },
      {
        mode: "magiclink",
        includeRedirect: true,
        payload: {
          email: safeEmail,
          create_user: true,
          type: "magiclink",
          redirect_to: callbackUrl,
          email_redirect_to: callbackUrl,
          redirectTo: callbackUrl,
          emailRedirectTo: callbackUrl,
        },
      },
    ];

    let lastDetail = "otp_failed";
    let lastStatus = 0;
    let redirectDetail = "";

    for (const attempt of attempts) {
      const query = new URLSearchParams();
      if (attempt.includeRedirect) {
        query.set("redirect_to", callbackUrl);
        query.set("email_redirect_to", callbackUrl);
      }
      const otpUrl = query.toString() ? `${otpBase}?${query.toString()}` : otpBase;

      const { res, txt } = await supabaseFetch(otpUrl, {
        method: "POST",
        body: attempt.payload,
      });

      if (res.ok) return { mode: attempt.mode };

      const detail = parseSupabaseErrorDetail(txt);
      const normalized = detail.toLowerCase();

      lastStatus = res.status;
      lastDetail = detail;

      if (normalized.includes("redirect") && normalized.includes("allow")) {
        redirectDetail = detail;
      }
    }

    if (redirectDetail) {
      const redirectErr = new Error("redirect_not_allowed");
      redirectErr.code = "redirect_not_allowed";
      redirectErr.callbackUrl = callbackUrl;
      redirectErr.detail = redirectDetail;
      throw redirectErr;
    }

    throw new Error(`otp_failed ${lastStatus}: ${lastDetail}`);
  }

  function normalizeVerifyType(type) {
    const t = String(type || "").trim().toLowerCase();
    if (!t) return "magiclink";
    return t;
  }

  async function verifyTokenHash(tokenHash, type) {
    const safeTokenHash = String(tokenHash || "").trim();
    const safeType = normalizeVerifyType(type);
    if (!safeTokenHash) throw new Error("missing_token_hash");

    const { res, payload } = await supabaseFetch("/auth/v1/verify", {
      method: "POST",
      body: { token_hash: safeTokenHash, type: safeType },
    });

    if (!res.ok) {
      const detail =
        payload?.msg || payload?.error_description || payload?.error || payload?.message || "verify_failed";
      throw new Error(`verify_failed ${res.status}: ${detail}`);
    }

    return payload || {};
  }

  async function verifyEmailOtpCode(code) {
    const safeCode = asString(code).replace(/\s+/g, "");
    if (!/^\d{6}$/.test(safeCode)) throw new Error("invalid_otp_code");

    const email = await getLastEmail();
    if (!email || !email.includes("@")) throw new Error("otp_email_missing");

    const attempts = [
      { email, token: safeCode, type: "email" },
      { email, token: safeCode, type: "magiclink" },
    ];

    let lastStatus = 0;
    let lastDetail = "verify_code_failed";

    for (const bodyObj of attempts) {
      const { res, txt, payload } = await supabaseFetch("/auth/v1/verify", {
        method: "POST",
        body: bodyObj,
      });

      if (res.ok) return payload || {};

      lastStatus = res.status;
      lastDetail = parseSupabaseErrorDetail(txt) || `verify_failed_${res.status}`;
    }

    throw new Error(`verify_code_failed ${lastStatus}: ${lastDetail}`);
  }

  async function fetchCanUse(accessToken) {
    const { res, payload: arr, status } = await supabaseFetch("/rest/v1/rpc/can_use", {
      method: "POST",
      accessToken,
      body: {},
    });

    if (!res.ok) {
      return { ok: false, reason: "rpc_failed", status };
    }
    const rawRow = Array.isArray(arr) ? arr[0] : arr;
    const row = rawRow && typeof rawRow === "object"
      ? {
        ok: rawRow.ok === true,
        reason: asString(rawRow.reason),
        status: asString(rawRow.status),
        plan: asString(rawRow.plan),
        plan_name: asString(rawRow.plan_name),
        periodicidade: asString(rawRow.periodicidade),
        inicio_plano: asString(rawRow.inicio_plano),
        fim_plano: asString(rawRow.fim_plano),
      }
      : {};
    return { ok: true, row };
  }

  // --- Runtime config API ---

  async function fetchPublicRuntimeConfig() {
    const qs = new URLSearchParams({
      select: "app_key,min_required_version,update_title,update_message,chrome_store_url,edge_store_url,updated_at,extension_config",
      app_key: `eq.${APP_RUNTIME_CONFIG_KEY}`,
      order: "updated_at.desc",
      limit: "1",
    });

    const { res, txt, payload } = await supabaseFetch(`/rest/v1/${APP_RUNTIME_CONFIG_TABLE}?${qs.toString()}`);

    if (!res.ok) {
      return {
        ok: false,
        reason: "runtime_config_failed",
        status: res.status,
        err: asString(
          payload?.message || payload?.error_description || payload?.error || txt || `runtime_config_failed_${res.status}`
        ),
      };
    }

    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || typeof row !== "object") {
      return { ok: false, reason: "runtime_config_missing" };
    }

    return { ok: true, config: normalizeRuntimeConfigRow(row) };
  }

  // --- Checkout API ---

  async function createCheckout(accessToken, planCode) {
    const { res, txt, payload } = await supabaseFetch("/functions/v1/create-checkout", {
      method: "POST",
      accessToken,
      body: { plan_code: String(planCode || "").trim() || "premium_mensal" },
    });

    if (!res.ok) {
      const status = Number(res.status || 0) || 0;
      const key = String(payload?.error || payload?.code || "").trim();
      const extra = String(payload?.details || payload?.message || payload?.hint || "").trim();
      const retryAfterRaw = Number(payload?.retry_after_seconds ?? payload?.retry_after ?? 0);
      const retryAfterSeconds =
        Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
          ? Math.max(1, Math.min(300, Math.trunc(retryAfterRaw)))
          : 0;
      const detailRaw =
        (key && extra && extra !== key ? `${key}: ${extra}` : "") || key || extra || txt || `checkout_failed_${res.status}`;
      const detail = String(detailRaw || "").trim() || `checkout_failed_${status || "unknown"}`;
      const prefix = status ? `${status}:` : "";
      const errText = prefix && detail.startsWith(prefix) ? detail : `${prefix} ${detail}`.trim();
      const detailLower = detail.toLowerCase();
      const isCheckoutRateLimited =
        status === 429 &&
        (key.toLowerCase() === "checkout_rate_limited" || detailLower.includes("checkout_rate_limited"));
      const reason = status === 401
        ? "checkout_unauthorized"
        : (isCheckoutRateLimited ? "checkout_rate_limited" : "checkout_failed");
      console.warn("[checkout] create-checkout failed", { status, reason, detail, retryAfterSeconds: retryAfterSeconds || null });
      const out = { ok: false, reason, status, err: errText };
      if (retryAfterSeconds > 0) out.retryAfterSeconds = retryAfterSeconds;
      return out;
    }

    return {
      ok: true,
      checkoutUrl: String(payload?.checkout_url || payload?.sandbox_checkout_url || ""),
      preferenceId: payload?.preference_id ? String(payload.preference_id) : "",
      externalReference: payload?.external_reference ? String(payload.external_reference) : "",
    };
  }

  // --- Search events API ---

  function normalizeSearchEventForInsert(input) {
    const raw = input && typeof input === "object" ? input : {};
    const query = sanitizeSearchQuery(raw.query || raw.term || raw.search || "");
    const queryNorm = normalizeSearchQuery(raw.queryNorm || query);
    if (query.length < 2 || queryNorm.length < 2) return null;

    const createdAtClient = toIsoFromMs(raw.createdAtMs || raw.ts || raw.clientCreatedAtMs);
    const rawCount = Math.trunc(Number(raw.count)) || 1;
    const count = Math.max(1, Math.min(1000, rawCount));
    const firstTsClient = toIsoFromMs(raw.firstTs);
    const lastTsClient = toIsoFromMs(raw.lastTs);
    return {
      query,
      queryNorm,
      sourceSite: sanitizeSearchSourceSite(raw.sourceSite || raw.source_site || raw.siteId || raw.site_id),
      trigger: sanitizeSearchTrigger(raw.trigger || raw.source || "unknown"),
      pagePath: sanitizeSearchPagePath(raw.pagePath || raw.path || "/"),
      createdAtClient,
      count,
      firstTsClient,
      lastTsClient,
    };
  }

  async function insertSearchEvents(accessToken, events, options = {}) {
    const source = Array.isArray(events) ? events : [];
    if (source.length === 0) {
      return { ok: true, insertedCount: 0, skippedCount: 0 };
    }

    const clientId = sanitizeSlugId(options?.clientId);
    if (clientId.length < 8) {
      return { ok: false, reason: "invalid_client_id", err: "analytics_client_id_missing_or_invalid" };
    }

    const rows = [];
    for (const input of source) {
      const normalized = normalizeSearchEventForInsert(input);
      if (!normalized) continue;
      const row = {
        query: normalized.query,
        query_norm: normalized.queryNorm,
        source_site: normalized.sourceSite,
        trigger: normalized.trigger,
        page_path: normalized.pagePath,
        count: normalized.count,
        first_seen_client: normalized.firstTsClient || normalized.createdAtClient || null,
        last_seen_client: normalized.lastTsClient || normalized.createdAtClient || null,
      };
      if (normalized.createdAtClient) {
        row.created_at_client = normalized.createdAtClient;
      }
      rows.push(row);
    }

    if (rows.length === 0) {
      return { ok: true, insertedCount: 0, skippedCount: source.length };
    }

    const { res, txt, payload: payloadRaw } = await supabaseFetch("/rest/v1/rpc/ingest_xianyu_search_events", {
      method: "POST",
      accessToken,
      body: { p_events: rows, p_client_id: clientId },
    });

    if (!res.ok) {
      const detail = parseSupabaseErrorDetail(txt);
      return {
        ok: false,
        reason: deriveErrorReason(detail, "search_events_insert_failed", SEARCH_EVENTS_REASON_RULES),
        status: res.status,
        err: detail,
        insertedCount: 0,
        skippedCount: source.length - rows.length,
      };
    }
    const payload = Array.isArray(payloadRaw) ? payloadRaw[0] : payloadRaw;
    if (!payload || payload.ok !== true) {
      const detail = asString(payload?.reason || payload?.error || txt || "search_events_insert_failed");
      return {
        ok: false,
        reason: deriveErrorReason(detail, "search_events_insert_failed", SEARCH_EVENTS_REASON_RULES),
        status: res.status,
        err: detail,
        insertedCount: Number(payload?.inserted_count || 0) || 0,
        skippedCount: source.length - rows.length,
      };
    }

    const insertedCount = Number(payload?.inserted_count || payload?.insertedCount || 0) || 0;
    return { ok: true, insertedCount, skippedCount: source.length - rows.length };
  }

  // --- Suggestion API ---

  async function insertSuggestion(accessToken, input) {
    const text = sanitizeText(input?.text, 600, false);
    if (text.length < 10) {
      return { ok: false, reason: "invalid_text", err: "Mensagem precisa ter no mínimo 10 caracteres." };
    }

    const source = asString(input?.source || "options").slice(0, 40) || "options";
    const userId = getUserIdFromJwt(accessToken);
    const clientIso = toIsoFromMs(input?.clientCreatedAtMs);
    const url = `${SUPABASE_URL}/rest/v1/${SUGGESTIONS_TABLE}`;

    const base = { texto: text, origem: source };
    if (userId) base.user_id = userId;

    const attempts = [
      clientIso ? { ...base, created_at_client: clientIso } : null,
      { ...base },
      userId ? { texto: text, user_id: userId } : { texto: text },
    ].filter(Boolean);

    let lastErr = "insert_failed";
    let lastStatus = 0;

    for (const bodyObj of attempts) {
      const { res, txt, payload } = await supabaseFetch(url, {
        method: "POST",
        accessToken,
        prefer: "return=representation",
        body: bodyObj,
      });

      if (res.ok) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const row = normalizeSuggestionRow(arr[0] || bodyObj);
        if (!row) return { ok: false, reason: "invalid_insert_response", err: "Resposta inválida do Supabase." };
        return { ok: true, row };
      }

      lastStatus = res.status;
      lastErr = String(
        payload?.message || payload?.error_description || payload?.error || txt || `suggestion_insert_failed_${res.status}`
      );
    }

    return {
      ok: false,
      reason: deriveErrorReason(lastErr, "suggestion_insert_failed", SUGGESTION_REASON_RULES),
      status: lastStatus,
      err: lastErr,
    };
  }

  // --- Roadmap Votes API ---

  async function upsertRoadmapVote(accessToken, featureId, voted) {
    const fid = asString(featureId).slice(0, 60);
    if (!fid) return { ok: false, reason: "invalid_feature_id" };

    const { res, txt, payload } = await supabaseFetch("/rest/v1/rpc/toggle_roadmap_vote_limited", {
      method: "POST",
      accessToken,
      body: { p_feature_id: fid, p_voted: !!voted },
    });

    if (!res.ok) {
      return { ok: false, reason: "vote_insert_failed", status: res.status, err: String(payload?.message || txt) };
    }
    // RPC returns {ok, reason?, action?}
    if (typeof payload === "object" && payload !== null) return payload;
    return { ok: true };
  }

  async function claimRoadmapTrialBonus(accessToken) {
    const { res, txt, payload } = await supabaseFetch("/rest/v1/rpc/claim_roadmap_trial_bonus", {
      method: "POST",
      accessToken,
      body: {},
    });

    if (!res.ok) {
      return { ok: false, reason: "claim_failed", status: res.status, err: String(payload?.message || txt) };
    }
    if (typeof payload === "object" && payload !== null) return payload;
    return { ok: true };
  }

  async function fetchMyRoadmapVotes(accessToken) {
    const userId = getUserIdFromJwt(accessToken);
    if (!userId) return { ok: false, reason: "no_user_id" };

    const { res, txt, payload } = await supabaseFetch(
      `/rest/v1/${ROADMAP_VOTES_TABLE}?select=feature_id,voted&user_id=eq.${userId}&voted=eq.true`,
      { accessToken }
    );

    if (!res.ok) {
      return { ok: false, reason: "votes_fetch_failed", status: res.status, err: String(payload?.message || txt) };
    }

    const rows = Array.isArray(payload) ? payload : [];
    const votes = {};
    for (const r of rows) {
      if (r.feature_id && r.voted) votes[r.feature_id] = true;
    }
    return { ok: true, votes };
  }

  async function fetchRoadmapVoteSummary() {
    const { res, payload } = await supabaseFetch(
      `/rest/v1/${ROADMAP_VOTES_SUMMARY_VIEW}?select=feature_id,total_votes`
    );

    if (!res.ok) {
      return { ok: false, reason: "summary_fetch_failed", status: res.status };
    }

    const rows = Array.isArray(payload) ? payload : [];
    const summary = {};
    for (const r of rows) {
      if (r.feature_id) summary[r.feature_id] = Number(r.total_votes) || 0;
    }
    return { ok: true, summary };
  }

  // --- Roadmap dynamic data ---

  const ROADMAP_CATEGORIES_TABLE = "roadmap_categories";
  const ROADMAP_FEATURES_TABLE = "roadmap_features";

  async function fetchRoadmapData() {
    const [catResult, featResult] = await Promise.all([
      supabaseFetch(`/rest/v1/${ROADMAP_CATEGORIES_TABLE}?is_active=eq.true&order=sort_order.asc&select=id,label,icon_key,color_rgb,sort_order`),
      supabaseFetch(`/rest/v1/${ROADMAP_FEATURES_TABLE}?is_active=eq.true&order=sort_order.asc&select=id,title,description,status,status_label,paid_only,progress,category_id,icon_key,sort_order`),
    ]);

    if (!catResult.ok || !featResult.ok) {
      return { ok: false, reason: "roadmap_fetch_failed", catStatus: catResult.status, featStatus: featResult.status };
    }

    const categories = Array.isArray(catResult.payload) ? catResult.payload : [];
    const features = Array.isArray(featResult.payload) ? featResult.payload : [];

    return { ok: true, categories, features };
  }

  // --- Plans catalog (public, no auth required) ---

  const PLANOS_SELECT = "codigo,nome_exibicao,valor_centavos,moeda,periodicidade,periodo_label,metodo_pagamento,nota_pagamento,popular";

  function formatBRL(centavos) {
    const reais = centavos / 100;
    return "R$ " + reais.toFixed(2).replace(".", ",");
  }

  function computeEquivMensal(valorCentavos, periodicidade) {
    const mesesMap = { mensal: 1, quadrimestral: 4, anual: 12 };
    const meses = mesesMap[periodicidade] || 1;
    if (meses <= 1) return null;
    const perMonth = valorCentavos / meses / 100;
    return "R$ " + perMonth.toFixed(2).replace(".", ",") + "/mes";
  }

  function computeSavePercent(valorCentavos, periodicidade, allRows) {
    if (periodicidade === "mensal") return null;
    const mensal = allRows.find((r) => r.periodicidade === "mensal");
    if (!mensal) return null;
    const mesesMap = { quadrimestral: 4, anual: 12 };
    const meses = mesesMap[periodicidade];
    if (!meses) return null;
    const custoMensalBase = mensal.valor_centavos;
    const custoMensalEste = valorCentavos / meses;
    const pct = Math.round((1 - custoMensalEste / custoMensalBase) * 100);
    return pct > 0 ? pct + "%" : null;
  }

  async function fetchActivePlans() {
    const result = await supabaseFetch(
      `/rest/v1/planos?visivel_ui=eq.true&ativo=eq.true&order=ordem_exibicao.asc&select=${PLANOS_SELECT}`
    );
    if (!result.ok) {
      return { ok: false, reason: "plans_fetch_failed", status: result.status };
    }
    const rows = Array.isArray(result.payload) ? result.payload : [];
    if (rows.length === 0) {
      return { ok: false, reason: "no_plans" };
    }
    const plans = rows.map((row) => ({
      code: row.codigo,
      name: row.nome_exibicao,
      price: formatBRL(row.valor_centavos),
      period: row.periodo_label,
      equiv: computeEquivMensal(row.valor_centavos, row.periodicidade),
      save: computeSavePercent(row.valor_centavos, row.periodicidade, rows),
      popular: row.popular === true,
      payment: row.metodo_pagamento,
      paymentNote: row.nota_pagamento,
    }));
    return { ok: true, plans };
  }

  // --- Shared config for supabase-vendors.js (utility functions come from XH.utils/XH.helpers) ---
  worker._supa = Object.freeze({
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    supabaseFetch,
  });

  // --- Remote extension config (cached in chrome.storage.local) ---

  const REMOTE_CONFIG_KEY = XH.KEYS?.REMOTE_CONFIG || "xh_remote_config_v1";

  async function getRemoteConfig() {
    const data = await chrome.storage.local.get(REMOTE_CONFIG_KEY);
    return data?.[REMOTE_CONFIG_KEY] || {};
  }

  async function setRemoteConfig(config) {
    if (!config || typeof config !== "object") return;
    await chrome.storage.local.set({ [REMOTE_CONFIG_KEY]: config });
  }

  // --- Public API ---
  worker.supabaseClient = {
    createLoginState,
    clearLoginState,
    clearTokens,
    ensureValidAccessToken,
    sendMagicLink,
    verifyTokenHash,
    verifyEmailOtpCode,
    fetchCanUse,
    fetchPublicRuntimeConfig,
    // fetchQualityItems — added by supabase-vendors.js
    createCheckout,
    insertSearchEvents,
    insertSuggestion,
    upsertRoadmapVote,
    claimRoadmapTrialBonus,
    fetchMyRoadmapVotes,
    fetchRoadmapVoteSummary,
    fetchRoadmapData,
    fetchActivePlans,
    getRemoteConfig,
    setRemoteConfig,
    REMOTE_CONFIG_KEY,
  };
  worker.withAuth = withAuth;
})();
