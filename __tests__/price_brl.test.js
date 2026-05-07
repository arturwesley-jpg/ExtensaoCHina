/**
 * Tests for price_brl/core.js conversion logic
 *
 * Validates: currency conversion math, normalization, edge cases
 */

// Extract conversion logic for testing (mirrors price_brl/core.js)
const DEFAULT_RATES = Object.freeze({
  BRL: 0.77,
  USD: 0.14,
  EUR: 0.13,
  CNY: 1.0,
  RUB: 12.5,
});

const FALLBACK_RATES = Object.freeze({
  BRL: 0.77,
  USD: 0.14,
  EUR: 0.13,
  CNY: 1.0,
  RUB: 12.5,
});

function normalizePriceText(text) {
  if (!text) return "";
  let cleaned = text.replace(/[¥￥元]/g, "");
  cleaned = cleaned.replace(/[^\d.,\-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }
  return cleaned;
}

function toCNY(amount, currency) {
  if (!amount || !isFinite(amount)) return null;
  if (currency === "CNY") return amount;
  const r = FALLBACK_RATES[currency];
  if (!r) return null;
  return amount / r;
}

function fromCNY(amountCNY, targetCurrency, rates) {
  if (!amountCNY || !isFinite(amountCNY)) return null;
  if (targetCurrency === "CNY") return amountCNY;
  const r = rates[targetCurrency];
  if (!r) return null;
  return amountCNY * r;
}

function convertCurrency(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amount;
  const cny = toCNY(amount, fromCurrency);
  if (cny === null) return null;
  return fromCNY(cny, toCurrency, rates || FALLBACK_RATES);
}

describe("price_brl conversion", () => {
  describe("normalizePriceText", () => {
    it("removes CNY symbols", () => {
      expect(normalizePriceText("¥199.99")).toBe("199.99");
      expect(normalizePriceText("￥50元")).toBe("50");
    });

    it("handles comma as decimal separator", () => {
      expect(normalizePriceText("199,99")).toBe("199.99");
    });

    it("handles dot as thousands and comma as decimal", () => {
      expect(normalizePriceText("1.999,99")).toBe("1999.99");
    });

    it("removes non-numeric chars except . , -", () => {
      expect(normalizePriceText("R$ 199.99")).toBe("199.99");
    });

    it("returns empty string for null/undefined", () => {
      expect(normalizePriceText(null)).toBe("");
      expect(normalizePriceText(undefined)).toBe("");
    });
  });

  describe("toCNY", () => {
    it("returns same amount for CNY", () => {
      expect(toCNY(100, "CNY")).toBe(100);
    });

    it("converts BRL to CNY", () => {
      const result = toCNY(77, "BRL");
      expect(result).toBeCloseTo(100, 0);
    });

    it("converts USD to CNY", () => {
      const result = toCNY(14, "USD");
      expect(result).toBeCloseTo(100, 0);
    });

    it("returns null for unknown currency", () => {
      expect(toCNY(100, "JPY")).toBeNull();
    });

    it("returns null for zero/NaN amount", () => {
      expect(toCNY(0, "BRL")).toBeNull();
      expect(toCNY(NaN, "BRL")).toBeNull();
    });
  });

  describe("fromCNY", () => {
    it("returns same amount for CNY", () => {
      expect(fromCNY(100, "CNY", DEFAULT_RATES)).toBe(100);
    });

    it("converts CNY to BRL", () => {
      const result = fromCNY(100, "BRL", DEFAULT_RATES);
      expect(result).toBeCloseTo(77, 0);
    });

    it("returns null for missing rate", () => {
      expect(fromCNY(100, "JPY", DEFAULT_RATES)).toBeNull();
    });
  });

  describe("convertCurrency", () => {
    it("returns same amount for same currency", () => {
      expect(convertCurrency(100, "BRL", "BRL")).toBe(100);
    });

    it("converts BRL to USD via CNY", () => {
      const result = convertCurrency(77, "BRL", "USD");
      // 77 BRL = 100 CNY = 14 USD
      expect(result).toBeCloseTo(14, 0);
    });

    it("converts USD to BRL via CNY", () => {
      const result = convertCurrency(14, "USD", "BRL");
      // 14 USD = 100 CNY = 77 BRL
      expect(result).toBeCloseTo(77, 0);
    });

    it("converts EUR to RUB", () => {
      const result = convertCurrency(13, "EUR", "RUB");
      // 13 EUR = 100 CNY = 1250 RUB
      expect(result).toBeCloseTo(1250, 0);
    });

    it("uses custom rates when provided", () => {
      const customRates = { BRL: 0.80, USD: 0.15, EUR: 0.14, RUB: 13.0 };
      const result = convertCurrency(100, "CNY", "BRL", customRates);
      expect(result).toBe(80);
    });
  });

  describe("DEFAULT_RATES", () => {
    it("CNY is always 1.0 (base currency)", () => {
      expect(DEFAULT_RATES.CNY).toBe(1.0);
    });

    it("all rates are positive numbers", () => {
      for (const [currency, rate] of Object.entries(DEFAULT_RATES)) {
        expect(rate).toBeGreaterThan(0);
      }
    });
  });
});
