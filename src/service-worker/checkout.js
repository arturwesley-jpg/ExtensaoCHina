// src/service-worker/checkout.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { asString, hasClient, waitMs, isAllowedHost } = XH.utils;
  const { toPositiveInt, sanitizeUrl, dedup } = XH.helpers;

  const CHECKOUT_ALLOWED_HOSTS = [
    "mercadopago.com",
    "mercadopago.com.br",
    "mercadopago.com.ar",
    "mercadopago.com.mx",
    "mercadopago.com.uy",
    "mercadopago.com.pe",
    "mercadopago.co",
    "mercadopago.cl",
  ];
  const CHECKOUT_RATE_LIMIT_AUTO_RETRY_MAX_SECONDS = 12;
  const CHECKOUT_RATE_LIMIT_RETRY_BUFFER_MS = 250;

  function normalizeCheckoutPlanCode(rawPlanCode) {
    const code = asString(rawPlanCode).toLowerCase();
    if (code === "premium_anual") return "premium_anual";
    if (code === "premium_quadrimestral") return "premium_quadrimestral";
    return "premium_mensal";
  }

  const startCheckout = dedup(async function startCheckout(planCode) {
    if (!hasClient()) throw new Error("supabase_client_missing");
    await XH.authStore.setBackendOk(true);
    const gateBlocked = await worker.ensureUpdateGateAllowsUsage({ requestRuntimeCheck: true });
    if (gateBlocked) return gateBlocked;

    let jwt = await worker.supabaseClient.ensureValidAccessToken();
    if (!jwt) {
      await worker.supabaseClient.clearTokens().catch(() => {});
      await XH.authStore.setSession(false);
      await XH.authStore.setAccess(false);
      return { ok: false, reason: "no_token" };
    }

    const normalizedPlanCode = normalizeCheckoutPlanCode(planCode);
    let result = await worker.supabaseClient.createCheckout(jwt, normalizedPlanCode);
    const firstStatus = Number(result?.status || 0) || 0;
    if (!result?.ok && (firstStatus === 401 || result?.reason === "checkout_unauthorized")) {
      const refreshedJwt = await worker.supabaseClient.ensureValidAccessToken({ forceRefresh: true });
      if (!refreshedJwt) {
        // Refresh failed -> treat as expired session.
        await worker.supabaseClient.clearTokens().catch(() => {});
        await XH.authStore.setSession(false);
        await XH.authStore.setAccess(false);
        await worker.setBillingSnapshot(null);
        return { ok: false, reason: "no_token" };
      }
      jwt = refreshedJwt;
      result = await worker.supabaseClient.createCheckout(jwt, normalizedPlanCode);

      const secondStatus = Number(result?.status || 0) || 0;
      if (!result?.ok && (secondStatus === 401 || result?.reason === "checkout_unauthorized")) {
        // The refreshed token was still rejected by checkout. Force a clean login.
        await worker.supabaseClient.clearTokens().catch(() => {});
        await XH.authStore.setSession(false);
        await XH.authStore.setAccess(false);
        await worker.setBillingSnapshot(null);
        return {
          ok: false,
          reason: "no_token",
          err: result?.err || "checkout_unauthorized",
        };
      }
    }

    if (!result?.ok && result?.reason === "checkout_rate_limited") {
      const retryAfterSeconds = toPositiveInt(result?.retryAfterSeconds, 0, 1, 300);
      if (
        retryAfterSeconds > 0 &&
        retryAfterSeconds <= CHECKOUT_RATE_LIMIT_AUTO_RETRY_MAX_SECONDS
      ) {
        await waitMs(retryAfterSeconds * 1000 + CHECKOUT_RATE_LIMIT_RETRY_BUFFER_MS);
        result = await worker.supabaseClient.createCheckout(jwt, normalizedPlanCode);
      }
    }

    if (!result?.ok) {
      const retryAfterSeconds = toPositiveInt(result?.retryAfterSeconds, 0, 1, 300);
      if (retryAfterSeconds > 0) {
        return { ...result, retryAfterSeconds };
      }
      return result;
    }

    const checkoutUrl = sanitizeUrl(result.checkoutUrl, { httpsOnly: true, allowedHosts: CHECKOUT_ALLOWED_HOSTS });
    if (!checkoutUrl) {
      return {
        ok: false,
        reason: "invalid_checkout_url",
        err: "checkout_url_not_allowed",
      };
    }

    await chrome.tabs.create({ url: checkoutUrl });

    // Start post-checkout polling for automatic access activation
    try {
      if (typeof worker.checkoutPoller?.startCheckoutPolling === "function") {
        await worker.checkoutPoller.startCheckoutPolling({
          preferenceId: result.preferenceId,
          externalReference: result.externalReference,
        });
      }
    } catch {}

    return {
      ok: true,
      checkoutUrl,
      preferenceId: result.preferenceId,
      externalReference: result.externalReference,
    };
  });

  worker.startCheckout = startCheckout;
})();
