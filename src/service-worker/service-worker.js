// src/service-worker/service-worker.js
"use strict";

(() => {
  const BUILD_TAG = "2026-02-17-importscripts-url";
  const RUN_REGISTRY_SELF_CHECK = false;
  const files = [
    "src/shared/constants/keys.js",
    "src/shared/utils.js",
    "src/shared/messaging/runtime-messages.js",
    "src/shared/constants/auth-constants.js",
    "src/shared/constants/price-constants.js",
    "src/shared/messaging/module-contract.js",
    "src/shared/constants/site-registry.js",
    "src/shared/constants/module-registry.js",
    "src/shared/storage/auth-store.js",
    "src/shared/storage/module-store.js",
    "src/shared/storage/ui-store.js",
    "src/service-worker/helpers/sanitize.js",
    "src/service-worker/helpers/parse.js",
    "src/service-worker/helpers/data.js",
    "src/service-worker/helpers/async.js",
    "src/service-worker/module-state-service.js",
    "src/service-worker/content-script-registrar.js",
    "src/service-worker/modules.js",
    "src/service-worker/supabase-client.js",
    "src/service-worker/currency-service.js",
    "src/service-worker/supabase-vendors.js",
    "src/service-worker/search-queue.js",
    "src/service-worker/update-gate.js",
    "src/service-worker/auth.js",
    "src/service-worker/checkout.js",
    "src/service-worker/checkout-poller.js",
    "src/service-worker/suggestions.js",
    "src/service-worker/roadmap.js",
    "src/service-worker/plans.js",
    "src/service-worker/sync-engine.js",
    "src/service-worker/quality-items.js",
    "src/service-worker/shipping-rates.js",
    "src/service-worker/messages.js",
    "src/service-worker/lifecycle.js",
    "src/service-worker/storage-watch.js",
  ];

  for (const f of files) {
    const u = chrome.runtime.getURL(f);
    console.log("[sw] importing:", u);
    importScripts(u);
    console.log("[sw] ok:", f);
  }

  if (RUN_REGISTRY_SELF_CHECK) {
    Promise.resolve()
      .then(() => XH.moduleRegistry.validateRegistryIntegrity())
      .then((r) => {
        if (r.ok) console.log("[sw] registry integrity ok", BUILD_TAG);
        else console.error("[sw] registry integrity failed", r.errors);
      })
      .catch((e) => console.error("[sw] registry integrity crashed", e));
  } else {
    console.log("[sw] registry self-check disabled", BUILD_TAG);
  }

  console.log("[sw] all imported OK", BUILD_TAG);
})();
