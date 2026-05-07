// src/content-scripts/modules/price_brl/price-dom.js
(() => {
  "use strict";

  const { hasCjk, containsYen, containsYuanUnit, toText, parseAmountToken, parseNumberAndDecimal, extractYenValues } =
    globalThis.__xh_price_brl_parser;
  const { clamp, round2, normalizeRate, normalizePriceCurrency: normalizeCurrency, normalizePriceRates, getPriceMeta, formatConvertedAmount, norm } =
    globalThis.XHContentUtils;

  const TAG = "xh_brl";
  const BADGE_SELECTOR = `span[data-${TAG}="1"]`;
  const REPLACED_HTML_ATTR = `data-${TAG}-orig-html`;
  const REPLACED_TEXT_ATTR = `data-${TAG}-orig-text`;
  const REPLACED_STYLE_ATTR = `data-${TAG}-orig-style`;

  const BASE_PRICE_CLASS_HINTS = [
    "price--",
    "price-wrap--",
    "wrap-price--",
    "row3-wrap-price--",
    "pricesign--",
    "pricetext--",
    "mainprice--",
    "headprice--",
    "skuprice--",
    "comprice--",
    "promotionpricename--",
    "yen--",
    "right-card-main-price--",
    "right-card-main-symbol--",
    "right-card-main-number--",
  ];
  const BASE_SPLIT_ROOT_HINTS = [
    "price-wrap--",
    "wrap-price--",
    "price--",
    "value--",
    "headprice--",
    "mainprice--",
    "skuprice--",
    "comprice--",
  ];
  const BASE_SIGN_CLASS_HINTS = [
    "sign--",
    "pricesign--",
    "symbol--",
    "yen--",
    "right-card-main-symbol--",
  ];
  const BASE_NUMBER_CLASS_HINTS = [
    "number--",
    "price--",
    "pricetext--",
    "mainprice--",
    "skuprice--",
    "comprice--",
    "right-card-main-number--",
  ];
  const BASE_DECIMAL_CLASS_HINTS = [
    "decimal--",
  ];

  const ORIGINAL_PRICE_HINT_RE =
    /(original(?:price)?|origin(?:al)?[-_ ]?price|old[-_ ]?price|list[-_ ]?price|market[-_ ]?price|was[-_ ]?price|before[-_ ]?price|raw[-_ ]?price|reference[-_ ]?price|del[-_ ]?price|strike|strikethrough|line[-_]?through|yuanjia|yuan_jia|oprice|\u539F\u4EF7|\u5212\u7EBF|\u5E02\u573A\u4EF7|\u53C2\u8003\u4EF7|\u540A\u724C\u4EF7|\u4E13\u67DC\u4EF7)/i;
  const CURRENT_PRICE_HINT_RE =
    /(sale[-_ ]?price|current[-_ ]?price|now[-_ ]?price|deal[-_ ]?price|promo[-_ ]?price|final[-_ ]?price|pay[-_ ]?price|flash[-_ ]?price|discount[-_ ]?price|activity[-_ ]?price|new[-_ ]?price|price[-_ ]?(sale|current|now|final)|real[-_ ]?pay|\u73B0\u4EF7|\u5230\u624B|\u6D3B\u52A8\u4EF7|\u5238\u540E|\u6298\u540E|\u6210\u4EA4\u4EF7|\u5B9E\u4ED8)/i;
  const NON_ITEM_PRICE_HINT_RE =
    /(ship|shipping|freight|delivery|postage|tax|service[-_ ]?fee|\u8FD0\u8D39|\u90AE\u8D39|\u7A0E\u8D39|\u670D\u52A1\u8D39)/i;

  function elSignature(el) {
    if (!el || el.nodeType !== 1) return "";
    const parts = [
      el.id,
      toText(el.className),
      el.getAttribute("data-testid"),
      el.getAttribute("data-test"),
      el.getAttribute("data-type"),
      el.getAttribute("data-role"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
    ];
    return norm(parts.filter(Boolean).join(" "));
  }

  function hasHintInAncestry(el, hintRe, maxDepth = 3) {
    let cur = el;
    for (let i = 0; i <= maxDepth && cur; i++) {
      if (hintRe.test(elSignature(cur))) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function isLikelyOriginalPriceEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest("del, s")) return true;
    return hasHintInAncestry(el, ORIGINAL_PRICE_HINT_RE, 3);
  }

  function isLikelyCurrentPriceEl(el) {
    return !!el && el.nodeType === 1 && hasHintInAncestry(el, CURRENT_PRICE_HINT_RE, 3);
  }

  function isLikelyNonItemPriceEl(el) {
    return !!el && el.nodeType === 1 && hasHintInAncestry(el, NON_ITEM_PRICE_HINT_RE, 2);
  }

  function scorePriceCandidateEl(el, text, priceHints) {
    let score = 0;
    const t = norm(text);
    const tag = (el?.tagName || "").toLowerCase();

    if (isLikelyCurrentPriceEl(el)) score += 50;
    if (looksPurePriceEl(el, priceHints)) score += 24;
    if (/^[\u00A5\uFFE5]\s*[0-9]/.test(t)) score += 10;
    if (t.length <= 16) score += 8;
    if (t.length > 30) score -= 10;
    if (/(?:\u4EBA\u60F3\u8981|\u4EBA\u60F3\u4E70|\u6D4F\u89C8|\u6536\u85CF|\u5DF2\u552E|\u9500\u91CF|want|sold|views?)/i.test(t)) {
      score -= 36;
    }
    if (["strong", "em", "b", "i"].includes(tag)) score += 8;

    try {
      const cs = getComputedStyle(el);
      const fw = String(cs.fontWeight || "");
      const fwn = parseInt(fw, 10);
      if ((Number.isFinite(fwn) && fwn >= 600) || /bold/i.test(fw)) score += 6;
      const fs = parseFloat(cs.fontSize || "");
      if (Number.isFinite(fs) && fs >= 16) score += 4;
    } catch {}

    return score;
  }

  function isStrikethrough(el) {
    try {
      if (el.closest("del, s")) return true;
      const cs = getComputedStyle(el);
      return (cs.textDecorationLine || "").includes("line-through");
    } catch {
      return false;
    }
  }

  function classText(el) {
    return toText(el?.className).toLowerCase();
  }

  function hasClassHint(el, hint) {
    return classText(el).includes(hint);
  }

  function hasAnyClassHint(el, hints) {
    const c = classText(el);
    if (!c) return false;
    for (const hint of hints) {
      if (c.includes(hint)) return true;
    }
    return false;
  }

  function isLikelyPriceClassEl(el, priceHints) {
    return hasAnyClassHint(el, priceHints);
  }

  function setReplacedText(el, text, strong = false) {
    if (!el || el.nodeType !== 1) return false;
    rememberNodeState(el);
    el.textContent = text;
    el.style.color = strong ? "#059669" : "#047857";
    el.style.fontWeight = strong ? "800" : "700";
    if (strong) {
      try {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (Number.isFinite(fs) && (fs < 16 || fs > 22)) {
          el.style.fontSize = clamp(fs, 16, 22) + "px";
          el.style.lineHeight = "1.25";
        }
      } catch {}
    }
    return true;
  }

  function canReplacePurePriceEl(el, priceHints) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(BADGE_SELECTOR)) return false;
    if (el.querySelector("a, button, input, textarea, select")) return false;

    const text = norm(el.textContent || "");
    if (!text || text.length > 28) return false;
    if (!(containsYen(text) || containsYuanUnit(text) || isLikelyPriceClassEl(el, priceHints))) return false;
    if (el.children.length > 2) return false;
    return true;
  }

  function tokenScore(el, classHint) {
    if (!el || el.nodeType !== 1) return Number.NEGATIVE_INFINITY;
    if (isStrikethrough(el) || isLikelyOriginalPriceEl(el) || isLikelyNonItemPriceEl(el)) {
      return Number.NEGATIVE_INFINITY;
    }

    let score = 0;
    if (classHint && hasClassHint(el, classHint)) score += 26;
    if (isLikelyCurrentPriceEl(el)) score += 10;

    try {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize || "");
      if (Number.isFinite(fs)) score += fs;
      const fw = parseInt(String(cs.fontWeight || ""), 10);
      if (Number.isFinite(fw) && fw >= 600) score += 6;
    } catch {}

    return score;
  }

  function isSignTokenEl(el, signHints) {
    if (!el || el.nodeType !== 1) return false;
    const text = norm(el.textContent || "");
    if (text === "\u00A5" || text === "\uFFE5") return true;
    if (hasAnyClassHint(el, signHints)) {
      if (!text) return true;
      if (containsYen(text)) return true;
      if (/^(r\$|brl)$/i.test(text)) return true;
    }
    return false;
  }

  function isNumberTokenEl(el, numberHints) {
    if (!el || el.nodeType !== 1) return false;
    const text = norm(el.textContent || "");
    if (/^[0-9][0-9.,]{0,16}$/.test(text)) return true;
    if (hasAnyClassHint(el, numberHints) && /[0-9]/.test(text)) {
      return true;
    }
    return false;
  }

  function isDecimalTokenEl(el, decimalHints) {
    if (!el || el.nodeType !== 1) return false;
    const text = norm(el.textContent || "");
    if (/^[.,][0-9]{1,2}$/.test(text)) return true;
    return hasAnyClassHint(el, decimalHints) && /[0-9]/.test(text);
  }

  function indexInParent(el) {
    const p = el?.parentElement;
    if (!p) return -1;
    return Array.prototype.indexOf.call(p.children, el);
  }

  function pickBestPair(signCandidates, numberCandidates) {
    let best = null;
    for (const signEl of signCandidates) {
      for (const numberEl of numberCandidates) {
        if (!signEl || !numberEl || signEl === numberEl) continue;

        const signScore = tokenScore(signEl, "sign");
        const numberScore = tokenScore(numberEl, "price");
        if (!Number.isFinite(signScore) || !Number.isFinite(numberScore)) continue;

        let score = signScore + numberScore;
        const sameParent = signEl.parentElement && signEl.parentElement === numberEl.parentElement;
        if (sameParent) score += 16;

        let distancePenalty = 0;
        if (sameParent) {
          const idxA = indexInParent(signEl);
          const idxB = indexInParent(numberEl);
          if (idxA >= 0 && idxB >= 0) distancePenalty = Math.abs(idxA - idxB);
        } else {
          distancePenalty = 7;
        }
        score -= Math.min(distancePenalty, 7);

        if (!best || score > best.score) {
          best = {
            signEl,
            numberEl,
            parent: sameParent ? signEl.parentElement : null,
            score,
          };
        }
      }
    }
    return best;
  }

  function findDecimalToken(referencePair, decimalCandidates) {
    if (!referencePair || !decimalCandidates.length) return null;
    let best = null;
    for (const decimalEl of decimalCandidates) {
      const base = tokenScore(decimalEl, "decimal--");
      if (!Number.isFinite(base)) continue;
      let score = base;
      if (referencePair.parent && decimalEl.parentElement === referencePair.parent) score += 12;
      const idxA = indexInParent(referencePair.numberEl);
      const idxB = indexInParent(decimalEl);
      if (idxA >= 0 && idxB >= 0 && referencePair.numberEl.parentElement === decimalEl.parentElement) {
        score -= Math.min(Math.abs(idxA - idxB), 6);
      }
      if (!best || score > best.score) best = { decimalEl, score };
    }
    return best?.decimalEl || null;
  }

  function findSplitPriceParts(container, signHints, numberHints, decimalHints, splitRootHints) {
    if (!container || container.nodeType !== 1) return null;

    const rootCandidates = [];
    const roots = [container, ...container.querySelectorAll("div, span, p")];
    for (const root of roots) {
      if (!root || root.nodeType !== 1) continue;
      if (hasAnyClassHint(root, splitRootHints)) {
        rootCandidates.push(root);
      }
    }
    if (!rootCandidates.length) rootCandidates.push(container);

    const seen = new Set();
    for (const root of rootCandidates) {
      if (!root || seen.has(root)) continue;
      seen.add(root);

      const tokenNodes = [root, ...root.querySelectorAll("span, div, em, strong, b, i")];
      if (tokenNodes.length > 120) continue;

      const signCands = tokenNodes.filter((el) => isSignTokenEl(el, signHints));
      const numberCands = tokenNodes.filter((el) => isNumberTokenEl(el, numberHints));
      if (!signCands.length || !numberCands.length) continue;

      const pair = pickBestPair(signCands, numberCands);
      if (!pair) continue;

      const decimalCands = tokenNodes.filter((el) => isDecimalTokenEl(el, decimalHints));
      const decimalEl = findDecimalToken(pair, decimalCands);
      return { signEl: pair.signEl, numberEl: pair.numberEl, decimalEl };
    }
    return null;
  }

  function parseSplitPriceFromParts(container, signHints, numberHints, decimalHints, splitRootHints) {
    const parts = findSplitPriceParts(container, signHints, numberHints, decimalHints, splitRootHints);
    if (!parts || !parts.numberEl) return null;

    if (
      !parts.signEl &&
      !hasAnyClassHint(parts.numberEl, numberHints)
    ) {
      return null;
    }

    const amount = parseNumberAndDecimal(
      parts.numberEl.textContent || "",
      parts.decimalEl ? parts.decimalEl.textContent || "" : ""
    );
    if (!Number.isFinite(amount) || amount <= 0) return null;

    let score = 70 + tokenScore(parts.numberEl, "price");
    if (parts.signEl) score += 12 + tokenScore(parts.signEl, "sign");
    if (parts.decimalEl) score += 4 + tokenScore(parts.decimalEl, "decimal");
    return { value: amount, score };
  }

  function rememberNodeState(el) {
    if (!el || el.nodeType !== 1) return;
    if (!el.hasAttribute(REPLACED_TEXT_ATTR)) {
      el.setAttribute(REPLACED_TEXT_ATTR, el.textContent || "");
    }
    if (!el.hasAttribute(REPLACED_STYLE_ATTR)) {
      el.setAttribute(REPLACED_STYLE_ATTR, el.getAttribute("style") || "");
    }
  }

  function restoreAllReplacedContainers() {
    const nodes = document.querySelectorAll(`[${REPLACED_HTML_ATTR}]`);
    for (const el of nodes) {
      const original = el.getAttribute(REPLACED_HTML_ATTR);
      if (typeof original === "string") el.innerHTML = original;
      el.removeAttribute(REPLACED_HTML_ATTR);
    }
  }

  function restoreAllReplacedTextNodes() {
    const nodes = document.querySelectorAll(`[${REPLACED_TEXT_ATTR}]`);
    for (const el of nodes) {
      const originalText = el.getAttribute(REPLACED_TEXT_ATTR);
      if (typeof originalText === "string") el.textContent = originalText;

      const originalStyle = el.getAttribute(REPLACED_STYLE_ATTR);
      if (typeof originalStyle === "string") {
        if (originalStyle) el.setAttribute("style", originalStyle);
        else el.removeAttribute("style");
      } else {
        el.removeAttribute("style");
      }

      el.removeAttribute(REPLACED_TEXT_ATTR);
      el.removeAttribute(REPLACED_STYLE_ATTR);
    }
  }

  function replacePurePriceEl(el, cny, rate, currency, priceHints) {
    if (!canReplacePurePriceEl(el, priceHints)) return false;
    const parts = makeReplaceParts(cny, rate, currency);
    return setReplacedText(el, parts.compact, true);
  }

  function replaceSplitPriceContainer(container, cny, rate, currency, signHints, numberHints, decimalHints, splitRootHints) {
    const parts = findSplitPriceParts(container, signHints, numberHints, decimalHints, splitRootHints);
    if (!parts) return false;

    const converted = makeReplaceParts(cny, rate, currency);
    if (parts.signEl) {
      setReplacedText(parts.signEl, converted.symbol, false);
      // "R$" is wider than "¥" — prevent overlap with the number element
      parts.signEl.style.whiteSpace = "nowrap";
      parts.signEl.style.width = "auto";
      parts.signEl.style.marginRight = "2px";
    }

    if (parts.decimalEl) {
      const left = parts.signEl ? converted.number : `${converted.symbol}${converted.number}`;
      setReplacedText(parts.numberEl, left, true);
      setReplacedText(parts.decimalEl, converted.decimal, true);
    } else {
      const full = parts.signEl ? `${converted.number}${converted.decimal}` : converted.compact;
      setReplacedText(parts.numberEl, full, true);
    }
    return true;
  }

  function ensureOneBadge(anchor, text, currency) {
    if (!anchor) return;
    const meta = getPriceMeta(currency);
    const badgeTitle = `Estimativa em ${meta.label} com a cotacao configurada na extensao.`;

    const badges = anchor.querySelectorAll(BADGE_SELECTOR);
    if (badges.length > 1) {
      for (let i = 1; i < badges.length; i++) badges[i].remove();
    }

    if (badges.length === 1) {
      if (badges[0].textContent !== text) badges[0].textContent = text;
      badges[0].setAttribute("title", badgeTitle);
      badges[0].setAttribute("aria-label", badgeTitle);
      return;
    }

    const badge = document.createElement("span");
    badge.setAttribute(`data-${TAG}`, "1");
    badge.setAttribute("title", badgeTitle);
    badge.setAttribute("aria-label", badgeTitle);
    badge.style.cssText =
      "display:inline-flex;align-items:center;vertical-align:middle;white-space:nowrap;" +
      "margin-left:8px;padding:3px 9px;border-radius:999px;" +
      "font:700 11px/1.25 'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#0f4c81;" +
      "background:linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%);" +
      "border:1px solid rgba(59,130,246,.28);" +
      "box-shadow:0 1px 2px rgba(2,6,23,.06),0 0 0 1px rgba(255,255,255,.45) inset;" +
      "letter-spacing:.1px;";
    badge.textContent = text;
    anchor.appendChild(badge);
  }

  function removeAllBadges() {
    const badges = document.querySelectorAll(BADGE_SELECTOR);
    for (const b of badges) b.remove();
  }

  function cleanupOrphans() {
    const badges = document.querySelectorAll(BADGE_SELECTOR);
    for (const b of badges) {
      const host = b.parentElement;
      if (!host) {
        b.remove();
        continue;
      }
      const t = norm(host.textContent || "");
      if (!containsYen(t) && !t.includes("\u5143")) b.remove();
    }
  }

  function makeBadgeText(cny, rate, currency) {
    return `\u2248 ${formatConvertedAmount(cny * rate, currency)}`;
  }

  function makeReplaceParts(cny, rate, currency) {
    const value = Math.max(0, round2(Number(cny) * Number(rate)));
    const safeCurrency = normalizeCurrency(currency);
    const meta = getPriceMeta(safeCurrency);
    try {
      const parts = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: safeCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).formatToParts(value);
      const symbol = parts.find((part) => part.type === "currency")?.value || meta.symbol;
      const number =
        parts
          .filter((part) => part.type === "integer" || part.type === "group")
          .map((part) => part.value)
          .join("") || "0";
      const decimalSep = parts.find((part) => part.type === "decimal")?.value || ",";
      const fraction = parts.find((part) => part.type === "fraction")?.value || "00";
      return {
        symbol,
        number,
        decimal: `${decimalSep}${fraction}`,
        compact: `${symbol}${number}${decimalSep}${fraction}`,
      };
    } catch {
      const fixed = value.toFixed(2);
      const [intPart, fracPart] = fixed.split(".");
      return {
        symbol: meta.symbol,
        number: intPart || "0",
        decimal: `,${fracPart || "00"}`,
        compact: `${meta.symbol}${intPart || "0"},${fracPart || "00"}`,
      };
    }
  }

  function isBetterCandidate(next, prev) {
    if (!prev) return true;
    if (next.score !== prev.score) return next.score > prev.score;
    if (next.value !== prev.value) return next.value < prev.value;
    return next.idx < prev.idx;
  }

  function parsePureCny(text) {
    const t = norm(text);
    if (!t) return null;
    if (hasCjk(t) && !containsYuanUnit(t)) return null;

    const values = extractYenValues(t);
    if (!values.length) return null;

    const hasCurrencyHint = containsYen(t) || containsYuanUnit(t);
    if (values.length === 1) {
      if (hasCurrencyHint) return values[0];
      if (/^[0-9][0-9.,\s]{0,20}$/.test(t)) return values[0];
    } else if (hasCurrencyHint) {
      return values[0];
    }
    return null;
  }

  function looksPurePriceEl(el, priceHints) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "textarea", "input"].includes(tag)) return false;
    if (el.closest(BADGE_SELECTOR)) return false;
    if (isStrikethrough(el)) return false;
    if (isLikelyOriginalPriceEl(el)) return false;
    if (isLikelyNonItemPriceEl(el)) return false;

    const t = norm(el.textContent);
    if (!t || t.length > 28) return false;
    if (!(containsYen(t) || containsYuanUnit(t) || isLikelyPriceClassEl(el, priceHints))) return false;
    if (hasCjk(t) && !containsYen(t) && !containsYuanUnit(t) && !isLikelyPriceClassEl(el, priceHints)) return false;
    return parsePureCny(t) != null;
  }

  function pickAnchor(el) {
    let cur = el;
    for (let i = 0; i < 6 && cur?.parentElement; i++) {
      const p = cur.parentElement;
      const t = norm(p.textContent || "");
      if (t.length > 60) break;
      cur = p;
    }
    return cur || el;
  }

  function parseSplitPriceFromContainer(container, priceHints, signHints, numberHints, decimalHints, splitRootHints) {
    if (!container || container.nodeType !== 1) return null;

    const partsBased = parseSplitPriceFromParts(container, signHints, numberHints, decimalHints, splitRootHints);
    if (partsBased) return partsBased;

    const rootText = norm(container.textContent || "");
    if (
      containsYen(rootText) &&
      /(?:\u4EBA\u60F3\u8981|\u60F3\u8981|\u60F3\u4E70|want|sold|views?)/i.test(rootText)
    ) {
      // In rows like "¥1702人想要", avoid regex fallback because it can merge price with counters.
      return null;
    }
    const rootHasPriceHint = containsYen(rootText) || containsYuanUnit(rootText) || isLikelyPriceClassEl(container, priceHints);
    if (!rootHasPriceHint || rootText.length > 120) return null;

    const candidates = [];
    let idx = 0;
    const nodes = [container, ...container.querySelectorAll("span, div, em, strong, b, i, p")];

    for (const el of nodes) {
      if (!el || el.nodeType !== 1) continue;
      if (el.closest(BADGE_SELECTOR)) continue;
      if (isStrikethrough(el)) continue;
      if (isLikelyOriginalPriceEl(el)) continue;
      if (isLikelyNonItemPriceEl(el)) continue;

      const t = norm(el.textContent || "");
      const localHasHint = containsYen(t) || containsYuanUnit(t) || isLikelyPriceClassEl(el, priceHints);
      if (!t || t.length > 100 || !localHasHint) continue;

      const values = extractYenValues(t);
      if (!values.length) continue;

      const score = scorePriceCandidateEl(el, t, priceHints);
      for (const value of values) {
        candidates.push({ value, score, idx: idx++ });
      }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.value !== b.value) return a.value - b.value;
      return a.idx - b.idx;
    });

    return { value: candidates[0].value, score: candidates[0].score };
  }

  function maybePushCandidate(out, seen, el, maxCandidates, priceHints) {
    if (!el || el.nodeType !== 1) return;
    if (seen.has(el)) return;
    if (out.length >= maxCandidates) return;
    if (el.closest(BADGE_SELECTOR)) return;
    if (isStrikethrough(el)) return;
    if (isLikelyOriginalPriceEl(el)) return;
    if (isLikelyNonItemPriceEl(el)) return;

    const t = norm(el.textContent || "");
    if (!t) return;
    if (t.length > 120) return;
    if (!/[0-9]/.test(t)) return;
    if (!(containsYen(t) || containsYuanUnit(t) || isLikelyPriceClassEl(el, priceHints))) return;

    seen.add(el);
    out.push(el);
  }

  function findCandidateContainers(maxCandidates, priceHints, focusedRootSelectors) {
    const out = [];
    const seen = new Set();

    if (focusedRootSelectors.length) {
      let focusedRoots = [];
      try {
        focusedRoots = Array.from(document.querySelectorAll(focusedRootSelectors.join(", ")));
      } catch {
        focusedRoots = [];
      }
      for (const el of focusedRoots) {
        if (out.length >= maxCandidates) break;
        maybePushCandidate(out, seen, el, maxCandidates, priceHints);
        const nested = el.querySelectorAll("span, em, strong, b, i, p");
        for (const inner of nested) {
          if (out.length >= maxCandidates) break;
          maybePushCandidate(out, seen, inner, maxCandidates, priceHints);
        }
      }
    }

    if (out.length >= maxCandidates) return out;

    const nodes = document.querySelectorAll("span, div, em, strong, b, i, p");
    for (const el of nodes) {
      if (out.length >= maxCandidates) break;
      maybePushCandidate(out, seen, el, maxCandidates, priceHints);
    }
    return out;
  }

  function buildBestCandidates(maxCandidates, priceHints, focusedRootSelectors, signHints, numberHints, decimalHints, splitRootHints, stoppedFn) {
    const bestByAnchor = new Map();
    let candidateSeq = 0;
    const addCandidate = (anchor, value, score) => {
      if (!anchor) return;
      if (!Number.isFinite(value) || value <= 0 || value > 99999999) return;
      const next = { value, score: Number(score) || 0, idx: candidateSeq++ };
      const prev = bestByAnchor.get(anchor);
      if (isBetterCandidate(next, prev)) bestByAnchor.set(anchor, next);
    };

    const nodes = document.querySelectorAll("span, div, em, strong, b, i, p");
    let count = 0;

    for (const el of nodes) {
      if (stoppedFn()) return bestByAnchor;
      if (++count > maxCandidates) break;
      if (!looksPurePriceEl(el, priceHints)) continue;

      const cny = parsePureCny(el.textContent);
      if (cny == null) continue;

      const t = norm(el.textContent || "");
      const score = 120 + scorePriceCandidateEl(el, t, priceHints);
      addCandidate(pickAnchor(el), cny, score);
    }

    const containers = findCandidateContainers(maxCandidates, priceHints, focusedRootSelectors);
    for (const c of containers) {
      if (stoppedFn()) return bestByAnchor;
      const parsed = parseSplitPriceFromContainer(c, priceHints, signHints, numberHints, decimalHints, splitRootHints);
      if (!parsed) continue;

      const score = 40 + (Number(parsed.score) || 0);
      addCandidate(pickAnchor(c), parsed.value, score);
    }

    return bestByAnchor;
  }

  globalThis.__xh_price_brl_dom = {
    TAG,
    BADGE_SELECTOR,
    REPLACED_HTML_ATTR,
    REPLACED_TEXT_ATTR,
    REPLACED_STYLE_ATTR,
    BASE_PRICE_CLASS_HINTS,
    BASE_SPLIT_ROOT_HINTS,
    BASE_SIGN_CLASS_HINTS,
    BASE_NUMBER_CLASS_HINTS,
    BASE_DECIMAL_CLASS_HINTS,
    ORIGINAL_PRICE_HINT_RE,
    CURRENT_PRICE_HINT_RE,
    NON_ITEM_PRICE_HINT_RE,
    elSignature,
    hasHintInAncestry,
    isLikelyOriginalPriceEl,
    isLikelyCurrentPriceEl,
    isLikelyNonItemPriceEl,
    scorePriceCandidateEl,
    isStrikethrough,
    classText,
    hasClassHint,
    hasAnyClassHint,
    isLikelyPriceClassEl,
    setReplacedText,
    canReplacePurePriceEl,
    tokenScore,
    isSignTokenEl,
    isNumberTokenEl,
    isDecimalTokenEl,
    indexInParent,
    pickBestPair,
    findDecimalToken,
    findSplitPriceParts,
    parseSplitPriceFromParts,
    rememberNodeState,
    restoreAllReplacedContainers,
    restoreAllReplacedTextNodes,
    replacePurePriceEl,
    replaceSplitPriceContainer,
    ensureOneBadge,
    removeAllBadges,
    cleanupOrphans,
    makeBadgeText,
    makeReplaceParts,
    isBetterCandidate,
    parsePureCny,
    looksPurePriceEl,
    pickAnchor,
    parseSplitPriceFromContainer,
    maybePushCandidate,
    findCandidateContainers,
    buildBestCandidates,
  };
})();
