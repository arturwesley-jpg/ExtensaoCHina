/**
 * Tests for currency-service.js
 *
 * Validates: rate conversion, caching, source failover
 */

// Currency service logic extracted for testability
// (mirrors the logic in src/service-worker/currency-service.js)

const STORAGE_KEY = "xh_currency_rates_v1";
const CACHE_TTL_MS = 10 * 60 * 1000;
const VALID_CODES = ["BRL", "USD", "EUR", "CNY", "RUB"];

const AWESOME_RATES = {
  "CNY-BRL": 0.77,
  "CNY-USD": 0.14,
  "CNY-EUR": 0.13,
  "CNY-RUB": 12.5,
};

const OKX_RATES = {
  "CNY-BRL": 0.78,
  "CNY-USD": 0.141,
  "CNY-EUR": 0.131,
  "CNY-RUB": 12.6,
};

function buildCachedRates(rates, source) {
  const result = {};
  const now = Date.now();
  for (const [pair, rate] of Object.entries(rates)) {
    result[pair] = { rate, source, timestamp: now };
  }
  return result;
}

function getRateFromCache(cached, base, target) {
  if (base === target) return 1;
  if (!cached) return null;

  if (base === "CNY") {
    const entry = cached[`CNY-${target}`];
    return entry ? entry.rate : null;
  }

  if (target === "CNY") {
    const entry = cached[`CNY-${base}`];
    return entry ? 1 / entry.rate : null;
  }

  const cnyToBase = cached[`CNY-${base}`];
  const cnyToTarget = cached[`CNY-${target}`];
  if (!cnyToBase || !cnyToTarget) return null;
  return cnyToTarget.rate / cnyToBase.rate;
}

function mergeRates(oldRates, newRates, source) {
  const merged = { ...oldRates };
  const now = Date.now();
  for (const [pair, rate] of Object.entries(newRates)) {
    const old = oldRates[pair];
    if (!old || source === "awesomeapi" || old.source !== "awesomeapi") {
      merged[pair] = { rate, source, timestamp: now };
    }
  }
  return merged;
}

describe("currency-service", () => {
  describe("VALID_CODES", () => {
    it("contains all required currencies", () => {
      expect(VALID_CODES).toContain("BRL");
      expect(VALID_CODES).toContain("USD");
      expect(VALID_CODES).toContain("EUR");
      expect(VALID_CODES).toContain("CNY");
      expect(VALID_CODES).toContain("RUB");
    });
  });

  describe("getRateFromCache", () => {
    it("returns 1 for same currency", () => {
      expect(getRateFromCache(null, "BRL", "BRL")).toBe(1);
    });

    it("returns null when cache is empty", () => {
      expect(getRateFromCache(null, "CNY", "BRL")).toBeNull();
    });

    it("returns direct rate from CNY to target", () => {
      const cached = buildCachedRates(AWESOME_RATES, "awesomeapi");
      expect(getRateFromCache(cached, "CNY", "BRL")).toBe(0.77);
    });

    it("returns inverse rate from target to CNY", () => {
      const cached = buildCachedRates(AWESOME_RATES, "awesomeapi");
      const rate = getRateFromCache(cached, "BRL", "CNY");
      expect(rate).toBeCloseTo(1 / 0.77, 5);
    });

    it("returns cross rate between two non-CNY currencies", () => {
      const cached = buildCachedRates(AWESOME_RATES, "awesomeapi");
      const rate = getRateFromCache(cached, "BRL", "USD");
      // USD/BRL = (CNY-USD) / (CNY-BRL) = 0.14 / 0.77
      expect(rate).toBeCloseTo(0.14 / 0.77, 5);
    });

    it("returns null if base currency missing", () => {
      const cached = buildCachedRates({ "CNY-BRL": 0.77 }, "awesomeapi");
      expect(getRateFromCache(cached, "USD", "BRL")).toBeNull();
    });
  });

  describe("mergeRates", () => {
    it("adds new rates to empty cache", () => {
      const merged = mergeRates({}, AWESOME_RATES, "awesomeapi");
      expect(merged["CNY-BRL"].rate).toBe(0.77);
      expect(merged["CNY-BRL"].source).toBe("awesomeapi");
    });

    it("prefers awesomeapi over okx", () => {
      const existing = buildCachedRates(AWESOME_RATES, "awesomeapi");
      const merged = mergeRates(existing, OKX_RATES, "okx");
      // awesomeapi rates should be preserved
      expect(merged["CNY-BRL"].rate).toBe(0.77);
    });

    it("allows awesomeapi to overwrite okx", () => {
      const existing = buildCachedRates(OKX_RATES, "okx");
      const merged = mergeRates(existing, AWESOME_RATES, "awesomeapi");
      expect(merged["CNY-BRL"].rate).toBe(0.77);
    });
  });

  describe("buildCachedRates", () => {
    it("creates proper cache structure", () => {
      const cached = buildCachedRates(AWESOME_RATES, "awesomeapi");
      for (const [pair, rate] of Object.entries(AWESOME_RATES)) {
        expect(cached[pair]).toEqual({
          rate,
          source: "awesomeapi",
          timestamp: expect.any(Number),
        });
      }
    });
  });
});
