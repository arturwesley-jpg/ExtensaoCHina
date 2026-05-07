# Changelog

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [1.0.5] - 2026-05-07

### Adicionado
- **Currency Service** (`src/service-worker/currency-service.js`): cotacoes ao vivo via AwesomeAPI (primaria) + OKX (fallback)
- **Moedas suportadas**: BRL, USD, EUR, CNY (base), RUB
- **Cache de cotacoes**: `chrome.storage.local` com TTL de 10 minutos e refresh via `chrome.alarms`
- **Taobao Login Notice**: overlay informativo sobre necessidade de telefone chines
- **ESLint + eslint-plugin-security**: pipeline de linting estatico com 0 erros
- **package.json**: gerenciamento de dependencias npm com scripts de lint

### Modificado
- `price_brl/core.js`: integrado com `xh_currency_rates_v1` para taxas dinamicas (antes: hardcoded)
- `manifest.json`: adicionado host_permissions para AwesomeAPI e OKX
- `service-worker.js`: currency-service.js adicionado ao import chain

### Corrigido
- Regex useless-escape em `helpers/sanitize.js`

## [1.0.4] - Versao base

### Funcionalidades
- Conversao de moeda (BRL, USD, EUR) com taxas hardcoded
- Badges ACBuy/CSSBuy para Goofish e Taobao
- Painel de vendedores confiaveis (Supabase)
- Calculadora de importacao
- Search insights
- Fechamento automatico de login lightbox
- Status badge de extensao

### Sites suportados
- Goofish (goofish.com)
- Taobao (taobao.com)
