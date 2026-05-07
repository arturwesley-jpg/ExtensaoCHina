// src/service-worker/update-gate.js
// Version gate: normalizes update requirements, caches remote config,
// triggers runtime update checks, and exposes ensureUpdateGateAllowsUsage.
// Depends on supabase-client.js (worker.supabaseClient) and auth-store (XH.authStore).
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});

  const UPDATE_GATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — aligned with sync engine interval
  const RUNTIME_UPDATE_CHECK_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_UPDATE_TITLE = "Atualizacao obrigatoria";

  let updateGateRefreshPromise = null;
  let lastRuntimeUpdateCheckAtMs = 0;

  const { asString, hasClient } = XH.utils;
  const { parseVersion, compareVersions } = XH.helpers;

  function getInstalledVersion() {
    return asString(chrome.runtime.getManifest?.().version || "0.0.0");
  }

  // --- Normalize / storage ---

  function normalizeUpdateGate(input, fallback = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const base = fallback && typeof fallback === "object" ? fallback : {};
    const installedVersion = asString(raw.installed_version || base.installed_version || getInstalledVersion());
    const minRequiredVersion = asString(raw.min_required_version || base.min_required_version);
    const requiredExplicit = raw.required === true;
    const requiredByVersion = !!minRequiredVersion && compareVersions(installedVersion, minRequiredVersion) < 0;
    const required = minRequiredVersion ? requiredByVersion : requiredExplicit;
    const defaultMessage = required && minRequiredVersion
      ? `Esta versao (${installedVersion}) nao e mais suportada. Atualize para ${minRequiredVersion} ou superior para continuar.`
      : "";

    return {
      required,
      installed_version: installedVersion,
      min_required_version: minRequiredVersion,
      update_title: asString(raw.update_title || base.update_title || DEFAULT_UPDATE_TITLE),
      update_message: asString(raw.update_message || base.update_message || defaultMessage),
      chrome_store_url: asString(raw.chrome_store_url || base.chrome_store_url),
      edge_store_url: asString(raw.edge_store_url || base.edge_store_url),
      config_updated_at: asString(raw.config_updated_at || raw.updated_at || base.config_updated_at || base.updated_at),
      reason: asString(raw.reason || base.reason || (required ? "outdated" : "up_to_date")),
      last_error: asString(raw.last_error || base.last_error),
      checked_at_ms: Number(raw.checked_at_ms || base.checked_at_ms || Date.now()) || Date.now(),
      runtime_update_check: asString(raw.runtime_update_check || base.runtime_update_check),
    };
  }

  async function getStoredUpdateGate() {
    const data = await chrome.storage.sync.get(XH.KEYS.UPDATE_GATE);
    const gate = data?.[XH.KEYS.UPDATE_GATE];
    if (!gate || typeof gate !== "object") return null;
    return normalizeUpdateGate(gate);
  }

  function getUpdateGateCheckedAtMs(gate) {
    const checkedAtMs = Number(gate?.checked_at_ms || 0);
    if (!Number.isFinite(checkedAtMs) || checkedAtMs <= 0) return 0;
    return Math.trunc(checkedAtMs);
  }

  async function setStoredUpdateGate(gate) {
    const normalized = normalizeUpdateGate(gate);
    await XH.authStore.setUpdateGate(normalized);
    return normalized;
  }

  // --- Runtime update check ---

  async function requestRuntimeUpdateCheck(options = {}) {
    const force = options?.force === true;
    const now = Date.now();
    if (!force && now - lastRuntimeUpdateCheckAtMs < RUNTIME_UPDATE_CHECK_TTL_MS) {
      return { ok: true, status: "cached" };
    }

    lastRuntimeUpdateCheckAtMs = now;

    if (typeof chrome.runtime.requestUpdateCheck !== "function") {
      return { ok: false, status: "unsupported" };
    }

    const result = await new Promise((resolve) => {
      try {
        chrome.runtime.requestUpdateCheck((status, details) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            resolve({
              ok: false,
              status: "error",
              err: asString(lastErr.message || "request_update_check_failed"),
            });
            return;
          }
          resolve({
            ok: true,
            status: asString(status || "unknown") || "unknown",
            version: asString(details?.version),
          });
        });
      } catch (e) {
        resolve({
          ok: false,
          status: "exception",
          err: asString(e?.message || e),
        });
      }
    });

    if (result?.status === "update_available") {
      try {
        chrome.runtime.reload();
      } catch {}
    }

    return result;
  }

  // --- Resolve from remote config ---

  async function resolveUpdateGateFromRemote(installedVersion) {
    if (!hasClient() || typeof worker.supabaseClient.fetchPublicRuntimeConfig !== "function") {
      return {
        ok: false,
        gate: normalizeUpdateGate({
          required: false,
          installed_version: installedVersion,
          reason: "runtime_config_not_available",
        }),
      };
    }

    const configResult = await worker.supabaseClient.fetchPublicRuntimeConfig();
    if (!configResult?.ok) {
      return {
        ok: false,
        gate: normalizeUpdateGate({
          required: false,
          installed_version: installedVersion,
          reason: asString(configResult?.reason || "runtime_config_failed"),
          last_error: asString(configResult?.err),
        }),
      };
    }

    const config = configResult.config || {};
    const gate = normalizeUpdateGate({
      required: compareVersions(installedVersion, config.min_required_version) < 0,
      installed_version: installedVersion,
      min_required_version: config.min_required_version,
      update_title: config.update_title,
      update_message: config.update_message,
      chrome_store_url: config.chrome_store_url,
      edge_store_url: config.edge_store_url,
      updated_at: config.updated_at,
      reason: "runtime_config_ok",
      last_error: "",
    });
    return { ok: true, gate, extensionConfig: config.extension_config || {} };
  }

  // --- Refresh & enforce ---

  async function refreshUpdateGate(options = {}) {
    const force = options?.force === true;
    const requestRuntimeCheck = options?.requestRuntimeCheck === true;
    const now = Date.now();

    if (!force && updateGateRefreshPromise) return updateGateRefreshPromise;

    const cached = await getStoredUpdateGate();
    const cachedCheckedAtMs = getUpdateGateCheckedAtMs(cached);
    if (!force && cached && now - cachedCheckedAtMs < UPDATE_GATE_CACHE_TTL_MS) {
      if (cached.required === true && requestRuntimeCheck) {
        const runtimeCheck = await requestRuntimeUpdateCheck({ force: false });
        if (runtimeCheck?.status) {
          const nextCached = {
            ...cached,
            runtime_update_check: runtimeCheck.status,
          };
          return setStoredUpdateGate(nextCached);
        }
      }
      return cached;
    }

    updateGateRefreshPromise = (async () => {
      const installedVersion = getInstalledVersion();
      const previousGate = cached;

      let resolved = await resolveUpdateGateFromRemote(installedVersion);
      let gate = resolved.gate;

      if (!resolved.ok && previousGate?.required === true) {
        gate = normalizeUpdateGate(
          {
            ...previousGate,
            installed_version: installedVersion,
            reason: "runtime_config_failed_cached_required",
            last_error: asString(gate?.last_error || gate?.reason || "runtime_config_failed"),
          },
          previousGate
        );
      }

      gate.checked_at_ms = Date.now();

      if (gate.required === true && requestRuntimeCheck) {
        const runtimeCheck = await requestRuntimeUpdateCheck({ force });
        gate.runtime_update_check = asString(runtimeCheck?.status || "unknown");
      }

      // Cache remote extension config (piggybacks on the same fetch)
      if (resolved.extensionConfig && typeof worker.supabaseClient?.setRemoteConfig === "function") {
        await worker.supabaseClient.setRemoteConfig(resolved.extensionConfig).catch(() => {});
      }

      const storedGate = await setStoredUpdateGate(gate);
      return storedGate;
    })().finally(() => {
      updateGateRefreshPromise = null;
    });

    return updateGateRefreshPromise;
  }

  async function ensureUpdateGateAllowsUsage(options = {}) {
    const gate = await refreshUpdateGate(options);
    if (gate?.required === true) {
      return {
        ok: false,
        reason: "update_required",
        updateGate: gate,
      };
    }
    return null;
  }

  // --- Exports ---
  worker.refreshUpdateGate = refreshUpdateGate;
  worker.getUpdateGate = async () => refreshUpdateGate({ force: false, requestRuntimeCheck: false });
  worker.ensureUpdateGateAllowsUsage = ensureUpdateGateAllowsUsage;
  worker._updateGate = Object.freeze({ normalizeUpdateGate });
})();
