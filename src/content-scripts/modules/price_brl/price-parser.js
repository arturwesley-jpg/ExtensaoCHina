// src/content-scripts/modules/price_brl/price-parser.js
(() => {
  "use strict";

  const { norm } = globalThis.XHContentUtils;

  function hasCjk(s) {
    return /[\u4e00-\u9fff]/.test(s);
  }

  function containsYen(s) {
    return /[\u00A5\uFFE5]/.test(s);
  }

  function containsYuanUnit(s) {
    return /(?:\u5143|\u5757|\u5757\u94B1|\u4EBA\u6C11\u5E01)/.test(s);
  }

  function toText(v) {
    return typeof v === "string" ? v : "";
  }

  const STRICT_AMOUNT_FRAGMENT = "(?:[0-9]{1,3}(?:[.,\\s][0-9]{3})+|[0-9]{1,9})(?:[.,][0-9]{1,2})?";

  function parseAmountToken(raw) {
    const src = String(raw || "")
      .replace(/\u00a0/g, "")
      .replace(/\s+/g, "")
      .replace(/[^\d.,]/g, "");
    if (!src || !/[0-9]/.test(src)) return null;

    const dotCount = (src.match(/\./g) || []).length;
    const commaCount = (src.match(/,/g) || []).length;

    let decimalSep = "";
    if (dotCount && commaCount) {
      decimalSep = src.lastIndexOf(".") > src.lastIndexOf(",") ? "." : ",";
    } else if (dotCount || commaCount) {
      const sep = dotCount ? "." : ",";
      const count = dotCount || commaCount;
      if (count === 1) {
        const idx = src.indexOf(sep);
        const tailLen = src.length - idx - 1;
        decimalSep = tailLen > 0 && tailLen <= 2 ? sep : "";
      } else {
        const idx = src.lastIndexOf(sep);
        const tailLen = src.length - idx - 1;
        decimalSep = tailLen > 0 && tailLen <= 2 ? sep : "";
      }
    }

    let normalized = src;
    if (!decimalSep) {
      normalized = normalized.replace(/[.,]/g, "");
    } else {
      const thousands = decimalSep === "." ? "," : ".";
      normalized = normalized.split(thousands).join("");
      const last = normalized.lastIndexOf(decimalSep);
      if (last >= 0) {
        normalized =
          normalized.slice(0, last).split(decimalSep).join("") +
          "." +
          normalized.slice(last + 1);
      }
    }

    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount;
  }

  function parseNumberAndDecimal(numberText, decimalText = "") {
    const n = norm(numberText || "");
    if (!n || !/[0-9]/.test(n)) return null;

    let raw = n;
    const d = norm(decimalText || "");
    if (d) {
      if (/^[.,][0-9]{1,2}$/.test(d)) raw = `${n}${d}`;
      else if (/^[0-9]{1,2}$/.test(d)) raw = `${n}.${d}`;
    }

    return parseAmountToken(raw);
  }

  function extractYenValues(text) {
    const t = norm(text);
    if (!t) return [];

    const out = [];
    const seen = new Set();
    const pushUnique = (raw) => {
      const v = parseAmountToken(raw);
      if (!Number.isFinite(v)) return;
      const key = v.toFixed(4);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    };

    let m;
    const strictYen = new RegExp(`[\\u00A5\\uFFE5]\\s*(${STRICT_AMOUNT_FRAGMENT})`, "g");
    const strictYuan = new RegExp(
      `(${STRICT_AMOUNT_FRAGMENT})\\s*(?:\\u5143|\\u5757|\\u5757\\u94B1|\\u4EBA\\u6C11\\u5E01)(?:\\s*\\u8D77)?`,
      "g"
    );

    while ((m = strictYen.exec(t)) !== null) pushUnique(m[1]);
    while ((m = strictYuan.exec(t)) !== null) pushUnique(m[1]);
    if (out.length) return out;

    // Fallback for malformed strings like "¥19.9014人想要": keep only first valid amount fragment.
    const reYen = /[\u00A5\uFFE5]\s*([0-9][0-9.,\s]{0,22})/g;
    while ((m = reYen.exec(t)) !== null) pushUnique(m[1]);

    const reYuan = /([0-9][0-9.,\s]{0,22})\s*(?:\u5143|\u5757|\u5757\u94B1|\u4EBA\u6C11\u5E01)(?:\s*\u8D77)?/g;
    while ((m = reYuan.exec(t)) !== null) pushUnique(m[1]);

    return out;
  }

  globalThis.__xh_price_brl_parser = {
    STRICT_AMOUNT_FRAGMENT,
    hasCjk,
    containsYen,
    containsYuanUnit,
    toText,
    parseAmountToken,
    parseNumberAndDecimal,
    extractYenValues,
  };
})();
