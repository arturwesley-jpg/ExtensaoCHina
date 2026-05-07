// module-registry.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});
  const { defineModule, validateRequiredFields } = XH.moduleContract;
  const siteRegistry = XH.siteRegistry;
  const SHARED_CONTENT_SCRIPTS = [
    "src/shared/constants/site-registry.js",
    "src/content-scripts/scripts/content-utils.js",
    "src/content-scripts/scripts/runtime.js",
  ];

  function targetsForSites(siteIds, runAt, extra = {}) {
    return {
      matches: siteRegistry.getMatches(siteIds),
      runAt,
      allFrames: !!extra.allFrames,
    };
  }

  /**
   * Build the scripts array for a module.
   *
   * @param {string|string[]} paths - single entry-point or ordered list of scripts
   * @param {object}          [options]
   * @param {boolean}         [options.includeSharedRuntime=true]
   */
  function moduleScripts(paths, options = {}) {
    const list = Array.isArray(paths) ? paths : [paths];
    if (options.includeSharedRuntime === false) return list;
    return [...SHARED_CONTENT_SCRIPTS, ...list];
  }

  const MODULE_REGISTRY = [
    defineModule({
      id: "xh_status_badge",
      name: "Status badge",
      description: "Mostra estado da extensao nas paginas do Goofish.",
      defaultEnabled: true,
      always: true,
      uiVisible: false,
      sites: ["goofish", "taobao"],
      category: "Sistema",
      targets: targetsForSites(["goofish", "taobao"], "document_start"),
      scripts: moduleScripts([
        "src/content-scripts/modules/xh_status_badge/core.js",
        "src/content-scripts/modules/xh_status_badge/index.js",
      ], { includeSharedRuntime: false }),
      capabilities: {},
    }),
    defineModule({
      id: "title_site",
      name: "Titulo da aba",
      description: "Define o titulo da aba conforme o site (Xianyu, Taobao).",
      defaultEnabled: true,
      free: true,
      sites: ["goofish", "taobao"],
      category: "Visual",
      targets: targetsForSites(["goofish", "taobao"], "document_start"),
      scripts: moduleScripts([
        "src/content-scripts/modules/title_site/core.js",
        "src/content-scripts/modules/title_site/sites/goofish.js",
        "src/content-scripts/modules/title_site/sites/taobao.js",
        "src/content-scripts/modules/title_site/index.js",
      ]),
      capabilities: {},
    }),
    defineModule({
      id: "close_login_light",
      name: "Fechar login automatico",
      description: "Fecha popups de login e libera a navegacao quando o site tenta bloquear a tela.",
      defaultEnabled: true,
      sites: ["goofish", "taobao"],
      category: "Navegacao",
      targets: targetsForSites(["goofish", "taobao"], "document_start"),
      scripts: moduleScripts([
        "src/content-scripts/modules/close_login_light/core.js",
        "src/content-scripts/modules/close_login_light/sites/goofish.js",
        "src/content-scripts/modules/close_login_light/sites/taobao.js",
        "src/content-scripts/modules/close_login_light/index.js",
      ]),
      capabilities: {},
    }),
    defineModule({
      id: "price_brl",
      name: "Preco convertido (estimado)",
      description: "Exibe uma estimativa em BRL, USD ou EUR usando a cotacao manual configurada por voce.",
      defaultEnabled: false,
      free: true,
      sites: ["goofish", "taobao"],
      category: "Preco",
      targets: targetsForSites(["goofish", "taobao"], "document_idle"),
      scripts: moduleScripts([
        "src/content-scripts/modules/price_brl/price-parser.js",
        "src/content-scripts/modules/price_brl/price-dom.js",
        "src/content-scripts/modules/price_brl/core.js",
        "src/content-scripts/modules/price_brl/sites/goofish.js",
        "src/content-scripts/modules/price_brl/sites/taobao.js",
        "src/content-scripts/modules/price_brl/index.js",
      ]),
      capabilities: { needsRate: true },
    }),
    defineModule({
      id: "acbuy_badge",
      name: "Agentes de compra",
      description: "Mostra atalhos flutuantes para abrir o item no ACBuy ou CSSBuy.",
      defaultEnabled: true,
      free: true,
      sites: ["goofish", "taobao"],
      category: "Compras",
      targets: targetsForSites(["goofish", "taobao"], "document_idle"),
      scripts: moduleScripts([
        "src/content-scripts/modules/acbuy_badge/core.js",
        "src/content-scripts/modules/acbuy_badge/sites/goofish.js",
        "src/content-scripts/modules/acbuy_badge/sites/taobao.js",
        "src/content-scripts/modules/acbuy_badge/index.js",
      ]),
      capabilities: { needsBadgePrefs: true },
    }),
    defineModule({
      id: "quality_sellers_panel",
      name: "Vendedores recomendados",
      description: "Mostra uma lista lateral com vendedores selecionados para facilitar sua compra.",
      defaultEnabled: true,
      sites: ["goofish", "taobao"],
      category: "Compras",
      targets: targetsForSites(["goofish", "taobao"], "document_idle"),
      scripts: moduleScripts([
        "src/content-scripts/modules/quality_sellers_panel/core.js",
        "src/content-scripts/modules/quality_sellers_panel/sites/goofish.js",
        "src/content-scripts/modules/quality_sellers_panel/sites/taobao.js",
        "src/content-scripts/modules/quality_sellers_panel/index.js",
      ]),
      capabilities: {},
    }),
    defineModule({
      id: "import_calc",
      name: "Calculadora de importacao",
      description: "Calcula frete e impostos (II + ICMS) para importacoes via ACBuy e CSSBuy.",
      defaultEnabled: false,
      free: true,
      sites: ["goofish", "taobao"],
      category: "Preco",
      targets: targetsForSites(["goofish", "taobao"], "document_idle"),
      scripts: moduleScripts([
        "src/content-scripts/modules/import_calc/calc-engine.js",
        "src/content-scripts/modules/import_calc/core.js",
        "src/content-scripts/modules/import_calc/sites/goofish.js",
        "src/content-scripts/modules/import_calc/sites/taobao.js",
        "src/content-scripts/modules/import_calc/index.js",
      ]),
      capabilities: {},
    }),
    defineModule({
      id: "search_insights",
      name: "Melhoria de buscas",
      description: "Registra buscas no Goofish e Taobao para aprimorar listas e futuras funcionalidades.",
      defaultEnabled: true,
      free: true,
      uiVisible: false,
      sites: ["goofish", "taobao"],
      category: "Insights",
      targets: targetsForSites(["goofish", "taobao"], "document_idle"),
      scripts: moduleScripts([
        "src/content-scripts/modules/search_insights/core.js",
        "src/content-scripts/modules/search_insights/sites/goofish.js",
        "src/content-scripts/modules/search_insights/sites/taobao.js",
        "src/content-scripts/modules/search_insights/index.js",
      ]),
      capabilities: {},
    }),
    defineModule({
      id: "taobao_login_notice",
      name: "Aviso login Taobao",
      description: "Mostra aviso sobre a necessidade de numero de telefone chines ao acessar o login do Taobao.",
      defaultEnabled: true,
      free: true,
      sites: ["taobao"],
      category: "Navegacao",
      targets: {
        matches: ["https://login.taobao.com/*", "https://login.tmall.com/*"],
        runAt: "document_idle",
        allFrames: false,
      },
      scripts: moduleScripts([
        "src/content-scripts/modules/taobao_login_notice/core.js",
        "src/content-scripts/modules/taobao_login_notice/index.js",
      ]),
      capabilities: {},
    }),
  ];

  function getWorkerModules() {
    return MODULE_REGISTRY.filter((m) => !m.always);
  }

  function getAlwaysModules() {
    return MODULE_REGISTRY.filter((m) => m.always);
  }

  function getFreeModules() {
    return MODULE_REGISTRY.filter((m) => !m.always && m.free);
  }

  function getPremiumModules() {
    return MODULE_REGISTRY.filter((m) => !m.always && !m.free);
  }

  async function validateRegistryIntegrity() {
    const ids = new Set();
    const errors = [];

    for (const mod of MODULE_REGISTRY) {
      const missing = validateRequiredFields(mod);
      if (missing.length) errors.push(`module ${mod.id || "(no-id)"} missing: ${missing.join(", ")}`);

      if (ids.has(mod.id)) errors.push(`duplicated module id: ${mod.id}`);
      ids.add(mod.id);

      for (const path of mod.scripts || []) {
        if (typeof path !== "string" || !path.trim()) {
          errors.push(`invalid script path for ${mod.id}: ${String(path)}`);
          continue;
        }
        if (!path.endsWith(".js")) {
          errors.push(`invalid script extension for ${mod.id}: ${path}`);
          continue;
        }
        if (path.includes("\\")) {
          errors.push(`invalid script path separator for ${mod.id}: ${path}`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  XH.moduleRegistry = {
    MODULE_REGISTRY,
    getWorkerModules,
    getAlwaysModules,
    getFreeModules,
    getPremiumModules,
    validateRegistryIntegrity,
  };
})();
