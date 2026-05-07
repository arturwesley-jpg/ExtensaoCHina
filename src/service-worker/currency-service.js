// src/service-worker/currency-service.js
// AwesomeAPI (primary) + OKX (fallback) currency rates relative to CNY
(() => {
  "use strict";

  const CACHE_KEY = "xh_currency_rates_v1";
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const ALARM_NAME = "xh-currency-refresh";

  const TARGET_CURRENCIES = ["BRL", "USD", "EUR", "RUB"];
  const AWESOME_API_KEY =
    "6dd877d055e13395868d880e2c7badfc8ec290e512c57fb7fe6d360a8582c648";

  // AwesomeAPI pairs: CNY-BRL, CNY-USD, CNY-EUR, CNY-RUB
  const AWESOME_PAIRS = TARGET_CURRENCIES.map((c) => `CNY-${c}`);

  // --- helpers ---

  function fetchWithTimeout(url, timeoutMs) {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Fetch timed out")), timeoutMs);
    });
    return Promise.race([fetch(url), timeout]);
  }

  // --- AwesomeAPI (primary) ---

  async function fetchAwesomeApi() {
    const result = {};
    const pairsStr = AWESOME_PAIRS.join(",");
    const url = `https://economia.awesomeapi.com.br/json/last/${pairsStr}?apikey=${AWESOME_API_KEY}`;

    try {
      const resp = await fetchWithTimeout(url, 5000);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // AwesomeAPI returns keys like "CNYBRL", "CNYUSD" (no hyphen)
      for (const currency of TARGET_CURRENCIES) {
        const key = `CNY${currency}`;
        const entry = data[key];
        if (entry && entry.bid) {
          const rate = parseFloat(entry.bid);
          if (Number.isFinite(rate) && rate > 0) {
            result[`CNY-${currency}`] = {
              rate,
              source: "awesomeapi",
              timestamp: Date.now(),
            };
          }
        }
      }
    } catch (e) {
      console.warn("[currency] AwesomeAPI batch failed:", e.message);
    }

    return result;
  }

  // --- OKX (fallback) ---

  async function fetchOkxPair(base, target) {
    const url = `https://www.okx.com/api/v5/market/ticker?instId=${base}-${target}`;
    const resp = await fetchWithTimeout(url, 5000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data?.data?.[0]?.last) {
      const rate = parseFloat(data.data[0].last);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
    throw new Error("No valid rate in OKX response");
  }

  // --- refresh logic ---

  async function refreshRates() {
    console.log("[currency] refreshing all rates...");

    // 1. Try AwesomeAPI for all currencies in one batch
    const awesomeRates = await fetchAwesomeApi();

    // 2. Determine which currencies are missing
    const missing = TARGET_CURRENCIES.filter(
      (c) => !awesomeRates[`CNY-${c}`]
    );

    // 3. Fetch OKX fallback for each missing currency individually
    if (missing.length > 0) {
      console.log("[currency] missing from AwesomeAPI:", missing);
      for (const currency of missing) {
        try {
          const rate = await fetchOkxPair("CNY", currency);
          awesomeRates[`CNY-${currency}`] = {
            rate,
            source: "okx",
            timestamp: Date.now(),
          };
        } catch (e) {
          console.warn(`[currency] OKX CNY-${currency} failed:`, e.message);
        }
      }
    }

    // 4. Load existing cache to preserve any previously-good rates
    let existing = {};
    try {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      existing = stored?.[CACHE_KEY] || {};
    } catch {}

    // 5. Merge: new rates overwrite old, keep old if new fetch failed
    const final = { ...existing };
    for (const [key, val] of Object.entries(awesomeRates)) {
      if (val && Number.isFinite(val.rate) && val.rate > 0) {
        final[key] = val;
      }
    }

    // 6. Write to storage
    await chrome.storage.local.set({ [CACHE_KEY]: final });

    const count = Object.keys(final).length;
    console.log(`[currency] rates updated: ${count} pairs cached`);

    return final;
  }

  // --- public API ---

  /**
   * Get the exchange rate from `base` to `target`.
   * Returns the numeric rate, or null if unavailable.
   * Since all rates are stored as CNY->X, a conversion from A to B is:
   *   rate(A,B) = rate(CNY,B) / rate(CNY,A)
   */
  async function getRate(base, target) {
    try {
      const stored = await chrome.storage.local.get(CACHE_KEY);
      const rates = stored?.[CACHE_KEY];
      if (!rates) return null;

      // Same currency
      if (base === target) return 1;

      // Direct: base is CNY
      if (base === "CNY") {
        const entry = rates[`CNY-${target}`];
        return entry?.rate ?? null;
      }

      // Direct: target is CNY
      if (target === "CNY") {
        const entry = rates[`CNY-${base}`];
        return entry?.rate ? 1 / entry.rate : null;
      }

      // Cross rate: A -> B = (CNY->B) / (CNY->A)
      const baseEntry = rates[`CNY-${base}`];
      const targetEntry = rates[`CNY-${target}`];
      if (baseEntry?.rate && targetEntry?.rate) {
        return targetEntry.rate / baseEntry.rate;
      }

      return null;
    } catch {
      return null;
    }
  }

  // --- init & alarms ---

  async function init() {
    console.log("[currency] initializing...");

    // Always fetch on install/startup
    await refreshRates();

    // Set up periodic refresh via chrome.alarms
    try {
      await chrome.alarms.clear(ALARM_NAME);
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 10 });
      console.log("[currency] alarm set for 10min refresh");
    } catch (e) {
      console.warn("[currency] failed to set alarm:", e.message);
    }
  }

  // Listen for alarms
  if (chrome?.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === ALARM_NAME) {
        console.log("[currency] alarm triggered, refreshing...");
        await refreshRates();
      }
    });
  }

  // Listen for install event to fetch immediately
  if (chrome?.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      console.log("[currency] extension installed, fetching rates...");
      refreshRates().catch((e) =>
        console.error("[currency] install refresh failed:", e)
      );
    });
  }

  // Expose on globalThis for other service worker modules
  globalThis.__xh_currency_service = {
    getRate,
    refreshRates,
  };

  // Auto-init
  init().catch((e) => console.error("[currency] init failed:", e));
})();
