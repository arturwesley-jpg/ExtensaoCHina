# ImportKit

**Ferramentas para importacao via Goofish/Xianyu e Taobao**

> Extensao Chrome (Manifest V3) com conversao de moeda em tempo real, badges de agentes de compra e painel de vendedores confiaveis.

---

## Funcionalidades

| Modulo | Descricao | Sites |
|--------|-----------|-------|
| **Conversao de Moeda** | Precos exibidos em BRL/USD/EUR/RUB com taxas ao vivo via AwesomeAPI + OKX (fallback) | Goofish, Taobao |
| **Badges de Agentes** | Links rapidos para ACBuy e CSSBuy em paginas de produto | Goofish, Taobao |
| **Vendedores Confiaveis** | Painel lateral com lista de vendedores verificados (Supabase) | Goofish, Taobao |
| **Aviso de Login Taobao** | Notificacao sobre necessidade de telefone chines | Taobao |
| **Calculadora de Importacao** | Estimativa de custo total com impostos e frete | Goofish, Taobao |

## Instalacao

### Via Chrome Web Store
_(Em breve)_

### Desenvolvimento
1. Clone o repositorio:
   ```bash
   git clone https://github.com/arturwesley-jpg/ExtensaoCHina.git
   cd ExtensaoCHina
   ```
2. Instale dependencias de desenvolvimento:
   ```bash
   npm install
   ```
3. Abra `chrome://extensions/` no Chrome
4. Ative **Modo do desenvolvedor**
5. Clique em **Carregar sem compactacao** e selecione a pasta do projeto

## Desenvolvimento

### Estrutura do Projeto

```
ImportKit-Chrome-Web-Store/
├── manifest.json                    # Manifest V3
├── src/
│   ├── service-worker/              # Background service worker
│   │   ├── service-worker.js        # Entry point (importScripts)
│   │   ├── supabase-client.js       # Cliente Supabase (auth, API)
│   │   ├── currency-service.js      # AwesomeAPI + OKX currency rates
│   │   ├── content-script-registrar.js
│   │   └── helpers/
│   ├── content-scripts/
│   │   ├── scripts/                 # Runtime compartilhado
│   │   │   ├── content-utils.js
│   │   │   └── runtime.js
│   │   └── modules/                 # Modulos por funcionalidade
│   │       ├── price_brl/           # Conversao de moeda
│   │       ├── acbuy_badge/         # Badges de agentes
│   │       ├── quality_sellers_panel/
│   │       ├── taobao_login_notice/
│   │       ├── import_calc/
│   │       ├── search_insights/
│   │       ├── close_login_light/
│   │       ├── title_site/
│   │       └── xh_status_badge/
│   ├── shared/
│   │   └── constants/
│   │       ├── site-registry.js     # Definicao de sites (goofish, taobao)
│   │       ├── module-registry.js   # Registro de todos os modulos
│   │       ├── keys.js
│   │       └── auth-constants.js
│   └── ui/
│       ├── popup/                   # Popup da extensao
│       ├── options/                 # Pagina de opcoes
│       └── auth/                    # Fluxo de autenticacao
└── assets/
    ├── icons/
    └── images/
```

### Arquitetura

A extensao usa **injecao programatica** de content scripts via `chrome.scripting.registerContentScripts`. Cada modulo:

1. Registra sites compativeis em `sites/{site}.js`
2. Define logica em `core.js`
3. Bootstrapa em `index.js`
4. E registrado em `src/shared/constants/module-registry.js`

A injecao e gerenciada pelo `content-script-registrar.js` no service worker.

### Comandos

```bash
npm run lint           # ESLint com security plugin
npm run lint:fix       # Auto-fix lint issues
npm test               # Executar testes Jest
```

### Moedas Suportadas

| Codigo | Moeda | Fonte |
|--------|-------|-------|
| BRL | Real Brasileiro | AwesomeAPI + OKX fallback |
| USD | Dolar Americano | AwesomeAPI + OKX fallback |
| EUR | Euro | AwesomeAPI + OKX fallback |
| CNY | Yuan Chines | Base (precos nativos) |
| RUB | Rublo Russo | AwesomeAPI + OKX fallback |

### APIs de Cotacao

- **Primaria:** [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas)
- **Fallback:** [OKX](https://www.okx.com/pt-br/okx-api)
- **Cache:** `chrome.storage.local`, TTL de 10 minutos, refresh via `chrome.alarms`

### Adicionando um Novo Site

1. Adicione definicao em `SITE_DEFS` em `src/shared/constants/site-registry.js`
2. Para cada modulo ativo, crie `sites/{site}.js` com `registerSite()`
3. Atualize `matches` no `module-registry.js`
4. Adicione `host_permissions` no `manifest.json`

### Adicionando um Novo Modulo

1. Crie diretorio em `src/content-scripts/modules/{module_id}/`
2. Implemente `core.js` (logica), `index.js` (bootstrap)
3. Registre em `src/shared/constants/module-registry.js` via `defineModule()`
4. Adicione scripts ao `service-worker.js` se necessario

## Configuracao

### Supabase

A extensao usa Supabase para:
- Autenticacao de usuarios (magic link)
- Catalogo de vendedores confiaveis
- Sugestoes e roadmap votes
- Configuracao remota (taxas de cambio, feature flags)

Para configurar seu proprio Supabase, edite `src/service-worker/supabase-client.js`:
```javascript
const SUPABASE_URL = "https://SEU_PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA_ANON_KEY";
```

## Seguranca

- ESLint com `eslint-plugin-security` (0 erros)
- Sanitizacao de inputs via `helpers/sanitize.js`
- RLS (Row Level Security) no Supabase
- Tokens armazenados em `chrome.storage.local`

## Licenca

MIT

## Autor

[@arturwesley-jpg](https://github.com/arturwesley-jpg)
