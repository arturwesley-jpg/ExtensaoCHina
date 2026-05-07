// src/service-worker/suggestions.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const { asString } = XH.utils;

  function normalizeSuggestionForClient(row) {
    const text = asString(row?.text || row?.texto || row?.sugestao);
    if (!text) return null;

    const createdAtIso =
      asString(row?.created_at) ||
      asString(row?.created_at_client) ||
      asString(row?.criado_em) ||
      new Date().toISOString();
    const createdAtMsRaw = Number(row?.created_at_ms);
    const createdAtMs =
      Number.isFinite(createdAtMsRaw) && createdAtMsRaw > 0
        ? createdAtMsRaw
        : (Number(Date.parse(createdAtIso)) || Date.now());

    return {
      id: asString(row?.id) || `sg-${createdAtMs}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      source: asString(row?.source || row?.origem || "options") || "options",
      created_at: createdAtIso,
      created_at_ms: createdAtMs,
    };
  }

  async function submitSuggestion(input) {
    const text = asString(input?.text);
    if (text.length < 10) {
      return { ok: false, reason: "invalid_text", err: "Sugestão precisa ter no mínimo 10 caracteres." };
    }

    return worker.withAuth(async (jwt) => {
      const result = await worker.supabaseClient.insertSuggestion(jwt, {
        text,
        source: asString(input?.source || "options") || "options",
        clientCreatedAtMs: Number(input?.clientCreatedAtMs || 0) || Date.now(),
      });

      if (!result?.ok) return result;

      const item = normalizeSuggestionForClient(result.row);
      if (!item) {
        return {
          ok: false,
          reason: "invalid_insert_response",
          err: "Resposta inválida ao salvar sugestão.",
        };
      }

      return { ok: true, item };
    }, { ensureBackendOk: true, checkGate: true });
  }

  worker.submitSuggestion = submitSuggestion;
})();
