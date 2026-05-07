// src/content-scripts/modules/import_calc/calc-engine.js
// Pure calculation functions — zero DOM, zero side effects.
(() => {
  "use strict";

  const II_DEFAULT = 0.60;

  function calcFreightCentavos(weightG, line) {
    const w = Number(weightG) || 0;
    if (w < (line.min_g || 0) || w > (line.max_g || 30000)) return null;

    const first = Number(line.primeiro_kg_centavos) || 0;
    const add = Number(line.kg_adicional_centavos) || 0;
    const extraKg = Math.max(0, Math.ceil((w - 1000) / 1000));
    return first + extraKg * add;
  }

  function calcImportTaxes({ declaredValueBrl, freightBrl, seguroBrl, icmsRate, iiRate }) {
    const declared = Number(declaredValueBrl) || 0;
    const freight = Number(freightBrl) || 0;
    const seguro = Number(seguroBrl) || 0;
    const icms = Number(icmsRate) || 0.17;
    const ii = Number(iiRate) || II_DEFAULT;

    const valorAduaneiro = declared + freight + seguro;
    const iiValue = ii * valorAduaneiro;
    const baseIcms = (valorAduaneiro + iiValue) / (1 - icms);
    const icmsValue = icms * baseIcms;

    return {
      valorAduaneiro: round2(valorAduaneiro),
      ii: round2(iiValue),
      baseIcms: round2(baseIcms),
      icms: round2(icmsValue),
      totalImpostos: round2(iiValue + icmsValue),
    };
  }

  function calcLandedCost({ productPriceBrl, freightCentavosUsd, declaredValueUsd, usdToBrl, icmsRate, iiRate }) {
    const prodBrl = Number(productPriceBrl) || 0;
    const rate = Number(usdToBrl) || 5.5;

    const freightUsd = (Number(freightCentavosUsd) || 0) / 100;
    const freightBrl = round2(freightUsd * rate);
    const declaredBrl = round2((Number(declaredValueUsd) || 0) * rate);

    const taxes = calcImportTaxes({
      declaredValueBrl: declaredBrl,
      freightBrl: 0,
      seguroBrl: 0,
      icmsRate,
      iiRate,
    });

    return {
      productPriceBrl: round2(prodBrl),
      freightUsd: round2(freightUsd),
      freightBrl,
      declaredValueUsd: Number(declaredValueUsd) || 0,
      declaredValueBrl: declaredBrl,
      ...taxes,
      totalCostBrl: round2(prodBrl + freightBrl + taxes.totalImpostos),
    };
  }

  function calcAllLines({ productPriceBrl, declaredValueUsd, weightG, usdToBrl, icmsRate, iiRate, lines, agentFilter, categoryFilter }) {
    if (!Array.isArray(lines)) return [];
    let filtered = lines;
    if (agentFilter) filtered = filtered.filter((l) => l.agente === agentFilter);
    if (categoryFilter) filtered = filtered.filter((l) => !Array.isArray(l.categorias) || l.categorias.includes(categoryFilter));

    const results = [];
    for (const line of filtered) {
      const freightCentavos = calcFreightCentavos(weightG, line);
      if (freightCentavos === null) continue;

      const cost = calcLandedCost({
        productPriceBrl,
        freightCentavosUsd: freightCentavos,
        declaredValueUsd,
        usdToBrl,
        icmsRate,
        iiRate,
      });

      results.push({
        agente: line.agente,
        linha: line.linha,
        nome: line.nome,
        prazo: line.prazo,
        ...cost,
      });
    }

    results.sort((a, b) => a.totalCostBrl - b.totalCostBrl);
    return results;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  globalThis.__xh_import_calc_engine = {
    calcFreightCentavos,
    calcImportTaxes,
    calcLandedCost,
    calcAllLines,
  };
})();
