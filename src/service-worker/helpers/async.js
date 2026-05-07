// src/service-worker/helpers/async.js
// Async utility functions for the service worker.
// Loaded via importScripts() early in boot (after data.js).
// Extends globalThis.XH.helpers.
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const helpers = XH.helpers || (XH.helpers = {});

  function dedup(fn) {
    let inFlight = null;
    return function (...args) {
      if (inFlight) return inFlight;
      const promise = fn.apply(this, args);
      inFlight = promise;
      Promise.resolve(promise).finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      return inFlight;
    };
  }

  Object.assign(helpers, {
    dedup,
  });
})();
