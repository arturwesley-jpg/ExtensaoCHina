// src/service-worker/supabase-vendors.js
// Vendor quality items: normalizers, image map, fetch logic.
// Depends on supabase-client.js (loaded first) for worker._supa config (URL, key).
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const worker = XH.worker || (XH.worker = {});
  const S = worker._supa;
  const { asString, toFiniteNumber } = XH.utils;
  const { sanitizeListKey, sanitizeText, sanitizeUrl, sanitizeStoragePath, coerceBoolean, pickFirstField, deriveErrorReason } = XH.helpers;

  const VENDORS_NICO_TABLE = "vendedores_nico";
  const VENDORS_NICO_STORAGE_BUCKET = "vendedores-nico";
  const QUALITY_ITEMS_TABLE = "itens_vendedores_qualidade";
  const DEFAULT_VENDOR_LIST_KEY = "nico";
  const DEFAULT_VENDOR_LIST_LABEL = "Recomendacoes do Nico";
  const QUALITY_ITEMS_DEFAULT_LIMIT = 12;
  const QUALITY_ITEMS_MAX_LIMIT = 30;

  const VENDORS_NICO_WEB_IMAGE_BY_USER_ID = Object.freeze({
    "918690794": "https://planilhanico.my.canva.site/xianyu/_assets/media/7fce2c9fd4c0cbfadcd45388b6219e4c.png",
    "51625985": "https://planilhanico.my.canva.site/xianyu/_assets/media/3201d685720398ed47e53e7bfa308200.jpg",
    "2218273214950": "https://planilhanico.my.canva.site/xianyu/_assets/media/a63c15faa67c2f9acd96a4f5bb83bf41.jpg",
    "2214100368996": "https://planilhanico.my.canva.site/xianyu/_assets/media/818caadc363754fcadf48851f2856ee8.jpg",
    "391299371": "https://planilhanico.my.canva.site/xianyu/_assets/media/7fce2c9fd4c0cbfadcd45388b6219e4c.png",
    "86508149": "https://planilhanico.my.canva.site/xianyu/_assets/media/bfad2dbaaaf04f38ddee734ec40b6b21.jpg",
    "2207485980547": "https://planilhanico.my.canva.site/xianyu/_assets/media/19d1b0c4dddd6a15ba5ca44c646253fd.png",
    "3385338059": "https://planilhanico.my.canva.site/xianyu/_assets/media/669eff18304ecaf911dd4c43ae6b811d.png",
    "2215764481076": "https://planilhanico.my.canva.site/xianyu/_assets/media/19cfab90b77250508e311dd88e45c65d.jpg",
    "2207576282831": "https://planilhanico.my.canva.site/xianyu/_assets/media/d2b2a1e981459303b68b2fbde33cdbe6.jpg",
    "4274538760": "https://planilhanico.my.canva.site/xianyu/_assets/media/efd3f5f19e8141bb5a57e53c55e719e2.png",
    "4189278061": "https://planilhanico.my.canva.site/xianyu/_assets/media/63658ef6f4b561d6bad8c6fa9048e6c0.png",
    "1078363433": "https://planilhanico.my.canva.site/xianyu/_assets/media/78e384f6746352f3d4c4410a1ad74c33.png",
    "2736263883": "https://planilhanico.my.canva.site/xianyu/_assets/media/efd3f5f19e8141bb5a57e53c55e719e2.png",
    "2924407035": "https://planilhanico.my.canva.site/xianyu/_assets/media/f6bac847df4cfb465b180b67c219808d.png",
    "2219201438421": "https://planilhanico.my.canva.site/xianyu/_assets/media/fe7b9997cf4a8ab10997f547fbaa41c2.jpg",
    "2215439073736": "https://planilhanico.my.canva.site/xianyu/_assets/media/a995772401932e217d755370475bc87f.jpg",
    "2214649371464": "https://planilhanico.my.canva.site/xianyu/_assets/media/a8fb63f376e51eb64014bc01490d8ec2.png",
    "645519622": "https://planilhanico.my.canva.site/xianyu/_assets/media/a8fb63f376e51eb64014bc01490d8ec2.png",
    "2212865316806": "https://planilhanico.my.canva.site/xianyu/_assets/media/d982295f6c66fd01bf037088ebe09901.jpg",
    "2200733913024": "https://planilhanico.my.canva.site/xianyu/_assets/media/6cc4934a3334b39ddb1229b6140d621b.jpg",
    "136959038": "https://planilhanico.my.canva.site/xianyu/_assets/media/bbb662e1e0fcc195f4c8d682601acd24.jpg",
    "2212918838631": "https://planilhanico.my.canva.site/xianyu/_assets/media/f54db68893f2e412c20f306c63f2bb41.jpg",
    "110670835": "https://planilhanico.my.canva.site/xianyu/_assets/media/6fc9bc7fa0570b0f9e7c4f884d799d61.jpg",
    "2529500597": "https://planilhanico.my.canva.site/xianyu/_assets/media/5fb1cdc88c80756122b34c16aea67813.jpg",
  });

  function buildStoragePublicUrl(bucketId, storagePath) {
    const bucket = asString(bucketId);
    const safePath = sanitizeStoragePath(storagePath);
    if (!bucket || !safePath) return "";
    const encodedPath = safePath
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
    if (!encodedPath) return "";
    return `${S.SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
  }

  function isSupabaseStoragePublicUrl(value, bucketId) {
    const url = sanitizeUrl(value);
    const bucket = asString(bucketId);
    if (!url || !bucket) return false;
    const expectedPrefix = `${S.SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
    return url.startsWith(expectedPrefix);
  }

  function normalizeVendorsNicoRow(row, index = 0) {
    const raw = row && typeof row === "object" ? row : {};
    const isActive = coerceBoolean(pickFirstField(raw, ["ativo", "active", "is_active"]), true);
    if (!isActive) return null;

    const sortRaw = toFiniteNumber(pickFirstField(raw, ["ordem", "sort_order", "rank", "ranking"]));
    const sortOrder = sortRaw === null ? 9999 : Math.max(0, Math.trunc(sortRaw));

    const marketName = sanitizeText(
      pickFirstField(raw, ["nome_vendavel", "nome", "item_title", "title", "categoria_original"]),
      120
    );
    const categoryName = sanitizeText(
      pickFirstField(raw, ["categoria_original", "categoria", "seller_name", "nome_vendedor"]),
      80
    );
    const sellerUrl = sanitizeUrl(
      pickFirstField(raw, ["url", "seller_url", "profile_url", "link_vendedor", "shop_url", "item_url", "link"])
    );
    if (!marketName && !categoryName) return null;
    if (!sellerUrl) return null;

    const userId = asString(pickFirstField(raw, ["user_id", "seller_id", "userid"]));
    const imageWebUrl = sanitizeUrl(VENDORS_NICO_WEB_IMAGE_BY_USER_ID[userId] || "");
    const imageStorageUrl = sanitizeUrl(
      pickFirstField(raw, ["image_storage_url", "imagem_storage_url", "imagem_supabase_url"])
    );
    const imageStoragePath = sanitizeStoragePath(
      pickFirstField(raw, ["image_storage_path", "imagem_storage_path", "storage_path", "image_path"])
    );
    const rowImageUrl = sanitizeUrl(
      pickFirstField(raw, ["item_image_url", "image_url", "imagem_item", "thumbnail_url", "foto", "imagem"])
    );
    const safeRowImageUrl = isSupabaseStoragePublicUrl(rowImageUrl, VENDORS_NICO_STORAGE_BUCKET)
      ? rowImageUrl
      : "";
    const imageUrlFromStorage =
      imageStorageUrl ||
      buildStoragePublicUrl(VENDORS_NICO_STORAGE_BUCKET, imageStoragePath) ||
      safeRowImageUrl;
    const imageUrl = imageWebUrl || imageUrlFromStorage;
    const imageFallbackUrl =
      imageWebUrl && imageUrlFromStorage && imageUrlFromStorage !== imageWebUrl
        ? imageUrlFromStorage
        : "";
    const listKey = sanitizeListKey(pickFirstField(raw, ["list_key", "lista_key", "lista_id"]), DEFAULT_VENDOR_LIST_KEY);
    const listLabel = sanitizeText(
      pickFirstField(raw, ["list_name", "lista_nome", "collection_name", "nome_lista"]),
      80
    ) || DEFAULT_VENDOR_LIST_LABEL;

    const idRaw = asString(pickFirstField(raw, ["id", "uuid", "item_id"]));
    const id = idRaw || `vendor-nico-${sortOrder}-${index}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      itemTitle: marketName || categoryName || "Vendedor recomendado",
      itemUrl: "",
      itemImageUrl: imageUrl,
      itemImageFallbackUrl: imageFallbackUrl,
      priceCny: null,
      sellerName: categoryName || "Vendedor Nico",
      sellerUrl,
      sellerScore: null,
      sellerBadge: "",
      notes: "",
      linkKind: "seller_only",
      listKey,
      listLabel,
      sortOrder,
    };
  }

  function normalizeVendorsNicoPayload(payload, limit, fallbackListLabel = DEFAULT_VENDOR_LIST_LABEL) {
    const rows = Array.isArray(payload) ? payload : [];
    const max = Math.max(1, Math.min(QUALITY_ITEMS_MAX_LIMIT, Number(limit) || QUALITY_ITEMS_DEFAULT_LIMIT));
    const items = [];

    for (let i = 0; i < rows.length && items.length < max; i += 1) {
      const normalized = normalizeVendorsNicoRow(rows[i], i);
      if (!normalized) continue;
      items.push(normalized);
    }

    items.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return String(a.itemTitle).localeCompare(String(b.itemTitle));
    });

    const sliced = items.slice(0, max);
    const labels = Array.from(new Set(sliced.map((item) => asString(item?.listLabel)).filter(Boolean)));
    let listLabel = asString(fallbackListLabel) || DEFAULT_VENDOR_LIST_LABEL;
    if (labels.length === 1) listLabel = labels[0];
    else if (labels.length > 1) listLabel = "Recomendacoes";

    return { items: sliced, listLabel };
  }

  function normalizeQualityItemRow(row, index = 0) {
    const raw = row && typeof row === "object" ? row : {};
    const isActive = coerceBoolean(pickFirstField(raw, ["ativo", "active", "is_active"]), true);
    if (!isActive) return null;

    const itemTitle = sanitizeText(
      pickFirstField(raw, ["item_title", "titulo_item", "item_name", "nome_item", "title", "nome", "item"]),
      120
    );
    const sellerName = sanitizeText(
      pickFirstField(raw, ["seller_name", "nome_vendedor", "vendedor", "seller", "loja", "shop_name"]),
      80
    );
    if (!itemTitle && !sellerName) return null;

    const itemUrl = sanitizeUrl(
      pickFirstField(raw, ["item_url", "url_item", "link_item", "product_url", "url", "link"])
    );
    const sellerUrl = sanitizeUrl(
      pickFirstField(raw, ["seller_url", "url_vendedor", "link_vendedor", "shop_url", "profile_url"])
    );
    const imageUrl = sanitizeUrl(
      pickFirstField(raw, ["item_image_url", "image_url", "imagem_item", "thumbnail_url", "foto", "imagem"])
    );

    const scoreRaw = toFiniteNumber(
      pickFirstField(raw, ["seller_score", "nota_vendedor", "rating", "score", "seller_rating"])
    );
    const score =
      scoreRaw === null ? null : Math.round(Math.min(5, Math.max(0, scoreRaw)) * 100) / 100;

    const priceRaw = toFiniteNumber(
      pickFirstField(raw, ["price_cny", "preco_cny", "preco", "price", "valor_cny"])
    );
    const priceCny = priceRaw === null ? null : Math.round(Math.max(0, priceRaw) * 100) / 100;

    const sortRaw = toFiniteNumber(pickFirstField(raw, ["sort_order", "ordem", "rank", "ranking"]));
    const sortOrder = sortRaw === null ? 9999 : Math.max(0, Math.trunc(sortRaw));

    const notes = sanitizeText(
      pickFirstField(raw, ["notes", "observacoes", "descricao", "description", "destaque"]),
      180
    );
    const sellerBadge = sanitizeText(
      pickFirstField(raw, ["seller_badge", "badge_vendedor", "seller_level", "nivel"]),
      40
    );

    const idRaw = asString(pickFirstField(raw, ["id", "uuid", "item_id"]));
    const id = idRaw || `quality-${sortOrder}-${index}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      itemTitle: itemTitle || "Item recomendado",
      itemUrl,
      itemImageUrl: imageUrl,
      priceCny,
      sellerName: sellerName || "Vendedor recomendado",
      sellerUrl,
      sellerScore: score,
      sellerBadge,
      notes,
      sortOrder,
    };
  }

  function normalizeQualityItemsPayload(payload, limit) {
    const rows = Array.isArray(payload) ? payload : [];
    const max = Math.max(1, Math.min(QUALITY_ITEMS_MAX_LIMIT, Number(limit) || QUALITY_ITEMS_DEFAULT_LIMIT));
    const items = [];

    for (let i = 0; i < rows.length && items.length < max; i += 1) {
      const normalized = normalizeQualityItemRow(rows[i], i);
      if (!normalized) continue;
      items.push(normalized);
    }

    items.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      const aScore = Number.isFinite(Number(a.sellerScore)) ? Number(a.sellerScore) : -1;
      const bScore = Number.isFinite(Number(b.sellerScore)) ? Number(b.sellerScore) : -1;
      if (aScore !== bScore) return bScore - aScore;
      return String(a.itemTitle).localeCompare(String(b.itemTitle));
    });

    return items.slice(0, max);
  }

  const QUALITY_ITEMS_REASON_RULES = [
    ["vendors_table_missing", ["relation", VENDORS_NICO_TABLE]],
    ["quality_items_table_missing", ["relation", QUALITY_ITEMS_TABLE]],
    ["vendors_policy_blocked", ["row-level security", VENDORS_NICO_TABLE]],
    ["vendors_policy_blocked", ["permission denied", VENDORS_NICO_TABLE]],
    ["quality_items_policy_blocked", "row-level security"],
    ["quality_items_policy_blocked", "permission denied"],
  ];

  async function fetchQualityRowsFromTable(tableName, limit, orderSpec = "", filters = null, selectFields = "*") {
    const qs = new URLSearchParams({
      select: asString(selectFields) || "*",
      limit: String(limit),
    });
    if (asString(orderSpec)) qs.set("order", asString(orderSpec));
    if (filters && typeof filters === "object") {
      Object.entries(filters).forEach(([key, value]) => {
        const field = asString(key);
        const raw = asString(value);
        if (!field || !raw) return;
        qs.set(field, `eq.${raw}`);
      });
    }

    const { res, txt, payload } = await S.supabaseFetch(`/rest/v1/${tableName}?${qs.toString()}`);
    if (!res.ok) {
      const detail = asString(
        payload?.message ||
        payload?.error_description ||
        payload?.error ||
        txt ||
        `quality_items_fetch_failed_${res.status}`
      );
      return {
        ok: false,
        reason: deriveErrorReason(detail, "quality_items_fetch_failed", QUALITY_ITEMS_REASON_RULES),
        status: res.status,
        err: detail,
      };
    }

    return { ok: true, payload };
  }

  async function fetchQualityItems(options = {}) {
    const requestedLimit = Number(options?.limit || QUALITY_ITEMS_DEFAULT_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.max(1, Math.min(QUALITY_ITEMS_MAX_LIMIT, Math.trunc(requestedLimit)))
      : QUALITY_ITEMS_DEFAULT_LIMIT;
    const requestedListKey = sanitizeListKey(options?.listKey, DEFAULT_VENDOR_LIST_KEY);
    const requestedListLabel = sanitizeText(options?.listLabel, 80) || DEFAULT_VENDOR_LIST_LABEL;

    const vendorsResult = await fetchQualityRowsFromTable(
      VENDORS_NICO_TABLE,
      limit,
      "ordem.asc.nullslast,updated_at.desc",
      {
        list_key: requestedListKey,
        ativo: "true",
      },
      "id,ordem,categoria_original,nome_vendavel,url,user_id,list_key,list_name,image_storage_path,image_storage_url,updated_at"
    );
    if (vendorsResult.ok) {
      const normalized = normalizeVendorsNicoPayload(vendorsResult.payload, limit, requestedListLabel);
      return {
        ok: true,
        items: normalized.items,
        listKey: requestedListKey,
        listLabel: normalized.listLabel,
        sourceTable: VENDORS_NICO_TABLE,
      };
    }

    const legacyResult = await fetchQualityRowsFromTable(
      QUALITY_ITEMS_TABLE,
      limit,
      "sort_order.asc.nullslast,updated_at.desc",
      { ativo: "true" },
      "id,ativo,sort_order,item_title,item_url,item_image_url,price_cny,seller_name,seller_url,seller_score,seller_badge,notes,updated_at"
    );
    if (legacyResult.ok) {
      return {
        ok: true,
        items: normalizeQualityItemsPayload(legacyResult.payload, limit),
        listKey: "legacy",
        listLabel: "Recomendacoes",
        sourceTable: QUALITY_ITEMS_TABLE,
      };
    }

    if (vendorsResult.reason === "vendors_table_missing" || vendorsResult.reason === "vendors_policy_blocked") {
      return vendorsResult;
    }
    return legacyResult;
  }

  // Add to supabaseClient (created by supabase-client.js)
  const client = worker.supabaseClient || (worker.supabaseClient = {});
  client.fetchQualityItems = fetchQualityItems;
})();
