# Arquitetura do ImportKit

## Visao Geral

ImportKit e uma extensao Chrome Manifest V3 para Goofish/Xianyu e Taobao.

## Camadas

```
┌─────────────────────────────────────────────────────┐
│  UI Layer (popup, options, auth)                     │
├─────────────────────────────────────────────────────┤
│  Service Worker (background)                         │
│  ├── supabase-client.js   (auth, API, config)        │
│  ├── currency-service.js  (cotacoes AwesomeAPI/OKX)  │
│  └── content-script-registrar.js                     │
├─────────────────────────────────────────────────────┤
│  Content Scripts (injecao programatica)              │
│  ├── price_brl/           (conversao de moeda)       │
│  ├── acbuy_badge/         (badges de agentes)        │
│  ├── quality_sellers_panel/ (vendedores confiaveis)  │
│  ├── taobao_login_notice/ (aviso telefone chines)    │
│  ├── import_calc/         (calculadora)              │
│  ├── search_insights/     (insights de busca)        │
│  ├── close_login_light/   (fechar login lightbox)    │
│  ├── title_site/          (titulo do site)           │
│  └── xh_status_badge/     (status da extensao)       │
├─────────────────────────────────────────────────────┤
│  Shared Constants                                    │
│  ├── site-registry.js     (definicoes de sites)      │
│  ├── module-registry.js   (registro de modulos)      │
│  └── keys.js, auth-constants.js                      │
└─────────────────────────────────────────────────────┘
```

## Fluxo de Injecao de Content Scripts

1. Service worker carrega `module-registry.js` e `content-script-registrar.js`
2. `content-script-registrar.js` le `MODULE_REGISTRY` de `module-registry.js`
3. Para cada modulo ativo, registra `chrome.scripting.registerContentScripts` com:
   - `matches` baseado nos sites que o modulo suporta
   - `js` = scripts do modulo (shared runtime + modulo core + modulo index + sites)
4. Chrome injeta os scripts automaticamente nas paginas correspondentes

## Padrao de Modulo

Cada modulo segue o padrao:

```
modules/{module_id}/
├── core.js        # Logica principal (IIFE, "use strict")
├── index.js       # Bootstrap (define MODULE_ID, DEFAULT_ON, chama core)
└── sites/
    ├── goofish.js # Registracao do site Goofish
    └── taobao.js  # Registracao do site Taobao
```

### Namespace Global

Modulos comunicam via `globalThis.__xh_{module_id}`:
- `globalThis.__xh_price_brl` — conversao de moeda
- `globalThis.__xh_ab` — badges de agentes
- `globalThis.__xh_quality_sellers_panel` — painel de vendedores
- `globalThis.__xh_taobao_login_notice` — aviso de login

### Registracao de Sites

```javascript
// sites/goofish.js
(function registerGoofishSite() {
  "use strict";
  if (!globalThis.__xh_price_brl) return;
  globalThis.__xh_price_brl.registerSite({
    id: "goofish",
    hostPattern: /(^|\.)goofish\.com$/i,
    selectPrice: function (node) { /* ... */ },
    parsePrice: function (text) { /* ... */ },
  });
})();
```

## Service Worker

O service worker carrega arquivos via `importScripts()` na ordem:

1. Constants (keys.js)
2. Utils (sanitize.js, crypto.js)
3. Supabase client
4. Currency service
5. Content script registrar
6. Storage watch

## Currency Service

- **Fonte primaria:** AwesomeAPI (`economia.awesomeapi.com.br`)
- **Fallback:** OKX (`www.okx.com/api/v5`)
- **Cache:** `chrome.storage.local` key `xh_currency_rates_v1`
- **TTL:** 10 minutos, refresh via `chrome.alarms`
- **Moedas:** BRL, USD, EUR, CNY (base), RUB
- **Conversao:** Todas as taxas sao relativas a CNY

## Supabase

- Auth: magic link via email
- Tabelas: `sugestoes_extensao`, `roadmap_votes`, `quality_sellers`, `runtime_config`
- RPC: funcoes para checkout, uso, planos
- RLS: politicas de seguranca por linha

## Seguranca

- ESLint + `eslint-plugin-security`
- Sanitizacao de inputs (`helpers/sanitize.js`)
- RLS no Supabase
- Tokens em `chrome.storage.local` (nao `localStorage`)
- Sem uso de funcoes de avaliacao dinamica
