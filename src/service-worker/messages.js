// src/service-worker/messages.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const MSG = XH.runtimeMessages?.TYPES || {
    PING: "XH_PING",
    APPLY_STATE: "APPLY_STATE",
    GET_MODULES: "GET_MODULES",
    SEND_MAGIC_LINK: "XH_SEND_MAGIC_LINK",
    CONSUME_MAGIC_LINK_URL: "XH_CONSUME_MAGIC_LINK_URL",
    VALIDATE_ACCESS: "XH_VALIDATE_ACCESS",
    CHECK_UPDATE_GATE: "XH_CHECK_UPDATE_GATE",
    START_CHECKOUT: "XH_START_CHECKOUT",
    LOGOUT: "XH_LOGOUT",
    SUBMIT_SUPPORT_MESSAGE: "XH_SUBMIT_SUPPORT_MESSAGE",
    GET_QUALITY_ITEMS: "XH_GET_QUALITY_ITEMS",
    TRACK_SEARCH_EVENT: "XH_TRACK_SEARCH_EVENT",
    FLUSH_SEARCH_QUEUE: "XH_FLUSH_SEARCH_QUEUE",
    TOGGLE_ROADMAP_VOTE: "XH_TOGGLE_ROADMAP_VOTE",
    GET_MY_ROADMAP_VOTES: "XH_GET_MY_ROADMAP_VOTES",
    GET_ROADMAP_VOTE_SUMMARY: "XH_GET_ROADMAP_VOTE_SUMMARY",
    GET_ROADMAP_DATA: "XH_GET_ROADMAP_DATA",
    GET_PLANS: "XH_GET_PLANS",
    GET_SHIPPING_RATES: "XH_GET_SHIPPING_RATES",
  };

  const TAG = "[xh-msg]";

  function log(...a) {
    console.log(TAG, ...a);
  }
  function warn(...a) {
    console.warn(TAG, ...a);
  }
  function err(...a) {
    console.error(TAG, ...a);
  }

  function isTrustedSender(sender) {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    return true;
  }

  const { normalizeSearchSourceSite } = XH.utils;

  function resolveSenderSourceSite(sender) {
    const candidate = String(sender?.url || sender?.tab?.url || "").trim();
    if (!candidate) return "";
    try {
      const parsed = new URL(candidate);
      return normalizeSearchSourceSite(XH.siteRegistry?.getCurrentSiteId(parsed.hostname));
    } catch {
      return "";
    }
  }

  function getSafeModuleList() {
    const registry = Array.isArray(XH.moduleRegistry?.MODULE_REGISTRY) ? XH.moduleRegistry.MODULE_REGISTRY : [];
    return registry.filter((m) => m?.uiVisible !== false).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description || m.desc,
      category: m.category || "Outros",
      capabilities: m.capabilities || {},
      defaultEnabled: m.defaultEnabled ?? true,
      sites: Array.isArray(m.sites) ? m.sites.slice() : [],
      uiVisible: m.uiVisible !== false,
      free: !!m.free,
    }));
  }

  const handlers = {
    async [MSG.PING]() {
      return {
        ok: true,
        pong: true,
        ts: Date.now(),
        hasValidateAccess: typeof worker.validateAccess === "function",
      };
    },

    async [MSG.APPLY_STATE]() {
      await worker.applyState?.();
      return { ok: true };
    },

    async [MSG.GET_MODULES]() {
      return { ok: true, modules: getSafeModuleList() };
    },

    async [MSG.SEND_MAGIC_LINK](msg) {
      const email = String(msg?.email || "").trim();
      if (!email.includes("@")) throw new Error("invalid_email");
      if (typeof worker.sendMagicLink !== "function") throw new Error("sendMagicLink_missing");
      const result = await worker.sendMagicLink(email);
      if (result && typeof result === "object") return result;
      return { ok: true };
    },

    async [MSG.CONSUME_MAGIC_LINK_URL](msg) {
      const url = String(msg?.url || "").trim();
      if (!url) throw new Error("missing_url");
      if (typeof worker.consumeMagicLinkUrl !== "function") throw new Error("consumeMagicLinkUrl_missing");
      return worker.consumeMagicLinkUrl(url);
    },

    async [MSG.VALIDATE_ACCESS]() {
      if (typeof worker.validateAccess !== "function") throw new Error("validateAccess_missing");
      return worker.validateAccess({ force: true });
    },

    async [MSG.CHECK_UPDATE_GATE]() {
      if (typeof worker.refreshUpdateGate !== "function") throw new Error("refreshUpdateGate_missing");
      const gate = await worker.refreshUpdateGate({ force: true, requestRuntimeCheck: true });
      await worker.applyState?.();
      return { ok: true, gate };
    },

    async [MSG.START_CHECKOUT](msg) {
      if (typeof worker.startCheckout !== "function") throw new Error("startCheckout_missing");
      const planCode = String(msg?.planCode || "").trim();
      return worker.startCheckout(planCode);
    },

    async [MSG.LOGOUT]() {
      if (typeof worker.logout !== "function") throw new Error("logout_missing");
      await worker.logout();
      return { ok: true };
    },

    async [MSG.SUBMIT_SUPPORT_MESSAGE](msg) {
      if (typeof worker.submitSuggestion !== "function") throw new Error("submitSuggestion_missing");
      const text = String(msg?.text || "").trim();
      if (text.length < 10) {
        return { ok: false, reason: "invalid_text", err: "Mensagem precisa ter no minimo 10 caracteres." };
      }
      return worker.submitSuggestion({
        text,
        source: String(msg?.source || "options").trim().slice(0, 40) || "options",
        clientCreatedAtMs: Number(msg?.clientCreatedAtMs || 0) || Date.now(),
      });
    },

    async [MSG.GET_QUALITY_ITEMS](msg) {
      if (typeof worker.getQualityItems !== "function") throw new Error("getQualityItems_missing");
      const requestedLimit = Number(msg?.limit || 0);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.max(1, Math.min(30, Math.trunc(requestedLimit)))
        : undefined;
      return worker.getQualityItems({ limit });
    },

    async [MSG.TRACK_SEARCH_EVENT](msg, sender) {
      if (typeof worker.trackSearchEvent !== "function") throw new Error("trackSearchEvent_missing");
      const sourceSite =
        normalizeSearchSourceSite(
          msg?.sourceSite || msg?.source_site || msg?.siteId || msg?.site_id
        ) ||
        resolveSenderSourceSite(sender) ||
        "goofish";
      return worker.trackSearchEvent({
        query: String(msg?.query || "").trim(),
        queryNorm: String(msg?.queryNorm || "").trim(),
        sourceSite,
        trigger: String(msg?.trigger || "").trim(),
        pagePath: String(msg?.pagePath || "").trim(),
        ts: Number(msg?.ts || Date.now()) || Date.now(),
      });
    },

    async [MSG.FLUSH_SEARCH_QUEUE]() {
      if (typeof worker.flushSearchQueue !== "function") throw new Error("flushSearchQueue_missing");
      return worker.flushSearchQueue({ force: true });
    },

    async [MSG.TOGGLE_ROADMAP_VOTE](msg) {
      if (typeof worker.toggleRoadmapVote !== "function") throw new Error("toggleRoadmapVote_missing");
      const featureId = String(msg?.featureId || "").trim();
      if (!featureId) return { ok: false, reason: "invalid_feature_id" };
      const voted = msg?.voted !== false;
      return worker.toggleRoadmapVote(featureId, voted);
    },

    async [MSG.GET_MY_ROADMAP_VOTES]() {
      if (typeof worker.getMyRoadmapVotes !== "function") throw new Error("getMyRoadmapVotes_missing");
      return worker.getMyRoadmapVotes();
    },

    async [MSG.GET_ROADMAP_VOTE_SUMMARY]() {
      if (typeof worker.getRoadmapVoteSummary !== "function") throw new Error("getRoadmapVoteSummary_missing");
      return worker.getRoadmapVoteSummary();
    },

    async [MSG.CLAIM_ROADMAP_TRIAL_BONUS]() {
      if (typeof worker.claimRoadmapTrialBonus !== "function") throw new Error("claimRoadmapTrialBonus_missing");
      return worker.claimRoadmapTrialBonus();
    },

    async [MSG.GET_ROADMAP_DATA]() {
      if (typeof worker.getRoadmapData !== "function") throw new Error("getRoadmapData_missing");
      return worker.getRoadmapData();
    },

    async [MSG.GET_PLANS]() {
      if (typeof worker.getPlans !== "function") throw new Error("getPlans_missing");
      return worker.getPlans();
    },

    async [MSG.GET_SHIPPING_RATES]() {
      if (!worker.shippingRates?.getShippingRates) throw new Error("getShippingRates_missing");
      return worker.shippingRates.getShippingRates();
    },
  };

  log("boot", {
    hasApplyState: typeof worker.applyState === "function",
    hasSendMagicLink: typeof worker.sendMagicLink === "function",
    hasConsumeMagicLinkUrl: typeof worker.consumeMagicLinkUrl === "function",
    hasValidateAccess: typeof worker.validateAccess === "function",
    hasRefreshUpdateGate: typeof worker.refreshUpdateGate === "function",
    hasStartCheckout: typeof worker.startCheckout === "function",
    hasLogout: typeof worker.logout === "function",
    hasSubmitSupportMessage: typeof worker.submitSuggestion === "function",
    hasGetQualityItems: typeof worker.getQualityItems === "function",
    hasTrackSearchEvent: typeof worker.trackSearchEvent === "function",
    hasGetPlans: typeof worker.getPlans === "function",
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const type = String(msg?.type || "");
    log("recv", { type, from: sender?.url || sender?.id || "unknown" });

    if (!isTrustedSender(sender)) {
      warn("blocked sender", { type, from: sender?.url || sender?.id || "unknown" });
      sendResponse({ ok: false, err: "forbidden_sender" });
      return;
    }

    const handler = handlers[type];
    if (!handler) {
      warn("unknown msg.type", type);
      sendResponse({ ok: false, err: "unknown_type", type });
      return;
    }

    Promise.resolve()
      .then(() => handler(msg, sender))
      .then((result) => {
        if (type === MSG.VALIDATE_ACCESS) log("validate access result", result);
        sendResponse(result);
      })
      .catch((e) => {
        err(`${type} failed`, e);
        sendResponse({
          ok: false,
          reason: "exception",
          err: String(e?.message || e),
          code: e?.code ? String(e.code) : undefined,
          callbackUrl: e?.callbackUrl ? String(e.callbackUrl) : undefined,
          detail: e?.detail ? String(e.detail) : undefined,
        });
      });

    return true;
  });
})();
