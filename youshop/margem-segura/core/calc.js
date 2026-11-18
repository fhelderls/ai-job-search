// Núcleo de cálculo do Margem Segura. Tudo aqui é regra determinística, sem DOM e sem IA.
// Funciona no navegador (window.MargemCalc) e no Node (require), para a página, a API e os testes
// usarem exatamente o mesmo código.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MargemCalc = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  // Abaixo disso a margem de contribuição é considerada apertada (% do preço, em fração).
  var MARGEM_APERTADA = 0.15;
  var VARIACOES_COMISSAO = [-4, -2, 0, 2, 4, 6, 8];
  var MAX_PRODUTOS = 30;

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function arred(v, d) { return (v === null || v === undefined || !isFinite(v)) ? null : +v.toFixed(d); }

  // Percentual variável total sobre o preço (comissão informada + afiliado + impostos + taxa de pagamento).
  function varFrac(p, comissao) { return (comissao + (p.afiliado || 0) + p.impostos + p.taxas) / 100; }
  // Custo fixo por unidade vendida: produto + frete/embalagem + taxa fixa da plataforma.
  function custoUn(p) { return p.custo + p.frete + (p.taxaFixa || 0); }
  function cpaDe(p) { return p.roas > 0 ? p.preco / p.roas : 0; }

  function calcular(p, comissao) {
    var vf = varFrac(p, comissao);
    var mc = p.preco - custoUn(p) - p.preco * vf; // margem de contribuição por unidade
    var mcPct = p.preco > 0 ? mc / p.preco : 0;
    var markup = p.custo > 0 ? (p.preco - p.custo) / p.custo : 0;
    var lucro = mc * p.volume - p.fixos;
    var equilibrio = mc > 0 ? Math.ceil(p.fixos / mc) : Infinity;
    var folga = (mc > 0 && p.volume > 0) ? (p.volume - equilibrio) / p.volume : -1;
    return { comissao: comissao, mc: mc, mcPct: mcPct, markup: markup, lucro: lucro, equilibrio: equilibrio, folga: folga };
  }

  // Crescimento de vendas, na nova comissão, que iguala o lucro de hoje.
  function crescimentoNecessario(p, atual, novo) {
    if (novo.mc <= 0) return Infinity;
    var volNec = (atual.lucro + p.fixos) / novo.mc;
    return p.volume > 0 ? volNec / p.volume - 1 : Infinity;
  }

  function cenario(p, atual, novaComissao, cresc) {
    var n = calcular(p, novaComissao);
    var vol2 = p.volume * (1 + cresc / 100);
    var lucro2 = n.mc * vol2 - p.fixos;
    return { novo: n, vol2: vol2, lucro2: lucro2, delta: lucro2 - atual.lucro, necessario: crescimentoNecessario(p, atual, n) };
  }

  // Preço em que a margem de contribuição é "margem" (fração) do preço.
  function precoPara(p, comissao, margem) {
    var den = 1 - varFrac(p, comissao) - margem;
    return den > 0 ? custoUn(p) / den : null;
  }

  function limites(p, a) {
    var vf = varFrac(p, p.comissao), mc = a.mc, V = p.volume, V2 = V * (1 + p.crescPromo / 100), k = custoUn(p), cpa = cpaDe(p);
    var pMin = precoPara(p, p.comissao, 0), pMeta = precoPara(p, p.comissao, p.margemAlvo / 100);
    var mcAd = mc - cpa;
    var pD = p.preco * (1 - p.desconto / 100), mcD = pD * (1 - vf) - k;
    var necD = (mcD > 0 && V > 0) ? (a.lucro + p.fixos) / mcD / V - 1 : null;
    var mcNeed = V2 > 0 ? (a.lucro + p.fixos) / V2 : null;
    var pN = (mcNeed !== null && mc > 0 && vf < 1) ? (mcNeed + k) / (1 - vf) : null;
    var dMax = (pN !== null && p.preco > 0) ? Math.max((1 - pN / p.preco) * 100, 0) : null;
    return {
      preco_minimo: arred(pMin, 2), preco_meta: arred(pMeta, 2),
      preco_abaixo_do_minimo: (pMin !== null && p.preco < pMin) ? 1 : 0,
      preco_abaixo_da_meta: (pMeta === null || p.preco < pMeta) ? 1 : 0,
      frete_maximo: arred(p.preco * (1 - vf) - p.custo - (p.taxaFixa || 0), 2),
      cpa_maximo: arred(Math.max(mc, 0), 2), roas_equilibrio: mc > 0 ? arred(p.preco / mc, 1) : null,
      margem_apos_anuncio_un: arred(mcAd, 2), margem_apos_anuncio_pct: p.preco > 0 ? arred(mcAd / p.preco * 100, 1) : null,
      anuncio_cabe: mcAd > 0 ? 1 : 0,
      desconto_margem_un: arred(mcD, 2), desconto_crescimento_minimo_pct: necD === null ? null : arred(necD * 100, 1),
      desconto_cabe: (mcD > 0 && necD !== null && necD <= p.crescPromo / 100) ? 1 : 0,
      desconto_maximo_seguro_pct: arred(dMax, 1)
    };
  }

  function lerNum(s) {
    s = String(s == null ? '' : s).replace(/[^0-9,.\-]/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function situacao(mc, pct, p) { return mc <= 0 ? 3 : (pct < MARGEM_APERTADA ? 2 : (pct < p.margemAlvo / 100 ? 1 : 0)); }

  // Lista de produtos: "nome; preço; custo; frete; comissão%; taxa fixa; afiliado%; plataforma"
  // (separado por ; ou tab, como numa planilha). Só os 4 primeiros campos são obrigatórios;
  // os demais usam os padrões em p (comissao, taxaFixa, afiliado). Linhas de cabeçalho são ignoradas.
  function parseCatalogo(texto, p) {
    var out = [], linhas = String(texto || '').split(/\r?\n/), plats = [];
    for (var i = 0; i < linhas.length && out.length < MAX_PRODUTOS; i++) {
      var f = linhas[i].split(/\t|;/);
      if (f.length < 4) continue;
      var preco = lerNum(f[1]), custo = lerNum(f[2]), frete = lerNum(f[3]);
      if (preco === null || preco <= 0 || custo === null || frete === null) continue;
      var cm = f.length > 4 && String(f[4]).trim() !== '' ? lerNum(f[4]) : null;
      var tf = f.length > 5 && String(f[5]).trim() !== '' ? lerNum(f[5]) : null;
      var af = f.length > 6 && String(f[6]).trim() !== '' ? lerNum(f[6]) : null;
      var plataforma = f.length > 7 ? String(f[7]).trim().slice(0, 30) : '';
      var q = { comissao: cm !== null ? cm : p.comissao, taxaFixa: tf !== null ? tf : (p.taxaFixa || 0), afiliado: af !== null ? af : (p.afiliado || 0), impostos: p.impostos, taxas: p.taxas };
      var vf = varFrac(q, q.comissao), mc = preco * (1 - vf) - custo - frete - q.taxaFixa, pct = mc / preco, den = 1 - vf - p.margemAlvo / 100;
      var plat = 0;
      if (plataforma) { var ix = plats.indexOf(plataforma.toLowerCase()); if (ix < 0) { plats.push(plataforma.toLowerCase()); ix = plats.length - 1; } plat = ix + 1; }
      out.push({
        nome: (f[0] || '').trim().slice(0, 40) || ('Produto ' + (out.length + 1)), n: out.length + 1,
        plataforma: plataforma, plat: plat, preco: preco, custo: custo, frete: frete, comissao: q.comissao, taxaFixa: q.taxaFixa, afiliado: q.afiliado,
        mc: mc, pct: pct, precoMeta: den > 0 ? (custo + frete + q.taxaFixa) / den : null, sit: situacao(mc, pct, p)
      });
    }
    return out;
  }

  // Resumo por plataforma (ordem da primeira aparição). Vazio se nenhuma linha informou plataforma.
  function resumoPlataformas(cat) {
    var mapa = {}, ordem = [];
    cat.forEach(function (r) {
      if (!r.plat) return;
      if (!mapa[r.plat]) { mapa[r.plat] = { n: r.plat, nome: r.plataforma, produtos: 0, soma: 0, abaixo_meta: 0, prejuizo: 0 }; ordem.push(r.plat); }
      var m = mapa[r.plat]; m.produtos++; m.soma += r.pct; if (r.sit >= 1) m.abaixo_meta++; if (r.sit === 3) m.prejuizo++;
    });
    return ordem.map(function (k) { var m = mapa[k]; return { n: m.n, nome: m.nome, produtos: m.produtos, margem_media_pct: arred(m.soma / m.produtos * 100, 1), abaixo_meta: m.abaixo_meta, prejuizo: m.prejuizo }; });
  }

  // Produtos com o mesmo nome vendidos em mais de uma plataforma, melhor margem primeiro.
  function compararPlataformas(cat) {
    var grupos = {}, ordem = [];
    cat.forEach(function (r) {
      if (!r.plat) return;
      var k = r.nome.toLowerCase();
      if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
      grupos[k].push(r);
    });
    return ordem.filter(function (k) { return grupos[k].length > 1; }).map(function (k) {
      var itens = grupos[k].slice().sort(function (x, y) { return y.pct - x.pct; });
      return { nome: itens[0].nome, itens: itens, diferenca_pontos: arred((itens[0].pct - itens[itens.length - 1].pct) * 100, 1) };
    });
  }

  // Tudo que o plano de decisão (e a IA) recebe: só números, calculados aqui.
  function montarDados(p, a, c, cat) {
    cat = cat || [];
    var entradas = {}; Object.keys(p).forEach(function (k) { entradas[k] = p[k]; });
    entradas.cpa = arred(cpaDe(p), 2);
    var k = custoUn(p);
    var opcoes = VARIACOES_COMISSAO.map(function (d) { return p.comissao + d; }).filter(function (x) { return x >= 0; }).map(function (cm) {
      var n = calcular(p, cm), kk = crescimentoNecessario(p, a, n);
      return { comissao_pct: cm, margem_un: +n.mc.toFixed(2), equilibrio_un: isFinite(n.equilibrio) ? n.equilibrio : null,
        crescimento_minimo_pct: isFinite(kk) ? +(kk * 100).toFixed(1) : null, lucro_mes_sem_crescimento: +(n.mc * p.volume - p.fixos).toFixed(2) };
    });
    var melhor = opcoes.reduce(function (m, o) { return o.lucro_mes_sem_crescimento > m.lucro_mes_sem_crescimento ? o : m; }, opcoes[0]);
    var V = p.volume, V2 = V * (1 + p.crescimento / 100), mcA = a.mc, mcN = c.novo.mc, sobe = p.novaComissao > p.comissao, nec = c.necessario;
    var subirTudo = { lucro_se_aposta_vem: +c.lucro2.toFixed(2), lucro_se_nao_vem: +(mcN * V - p.fixos).toFixed(2) };
    var den = 1 - varFrac(p, p.novaComissao), pNovo = (mcA > 0 && den > 0) ? (mcA + k) / den : null;
    var preco = { preco_novo: (pNovo !== null && sobe) ? +pNovo.toFixed(2) : null, aumento_preco_pct: (pNovo !== null && sobe && p.preco > 0) ? +((pNovo / p.preco - 1) * 100).toFixed(1) : null };
    var redUn = (sobe && mcA > 0 && mcN > 0 && p.custo > 0 && p.custo - (mcA - mcN) > 0) ? (mcA - mcN) : null;
    var corte = { custo_novo: redUn !== null ? +(p.custo - redUn).toFixed(2) : null, reducao_custo_pct: redUn !== null ? +(redUn / p.custo * 100).toFixed(1) : null };
    var tetoMc = V2 > 0 ? (a.lucro + p.fixos) / V2 : null;
    var comMax = (tetoMc !== null && mcA > 0 && p.preco > 0) ? +(((p.preco - k - tetoMc) / p.preco) * 100 - p.impostos - p.taxas - (p.afiliado || 0)).toFixed(1) : null;
    var piores = cat.slice().sort(function (x, y) { return x.pct - y.pct; }).slice(0, 15).map(function (r) {
      return { n: r.n, margem_un: arred(r.mc, 2), margem_pct: arred(r.pct * 100, 1), preco_meta: arred(r.precoMeta, 2), situacao: r.sit, plat: r.plat };
    });
    var plataformas = resumoPlataformas(cat).slice(0, 8).map(function (m) { return { n: m.n, produtos: m.produtos, margem_media_pct: m.margem_media_pct, abaixo_meta: m.abaixo_meta, prejuizo: m.prejuizo }; });
    return {
      entradas: entradas,
      atual: { margem_un: +a.mc.toFixed(2), margem_pct: +(a.mcPct * 100).toFixed(1), markup_pct: +(a.markup * 100).toFixed(0), equilibrio_un: isFinite(a.equilibrio) ? a.equilibrio : null, lucro_mes: +a.lucro.toFixed(2), queda_maxima_vendas_pct: a.folga > 0 ? +(a.folga * 100).toFixed(0) : 0, venda_da_prejuizo: a.mc <= 0 ? 1 : 0 },
      cenario: { nova_comissao_pct: p.novaComissao, crescimento_apostado_pct: p.crescimento, volume_apostado_un: Math.round(c.vol2), volume_necessario_un: isFinite(nec) ? Math.ceil(p.volume * (1 + nec)) : null, margem_un: +c.novo.mc.toFixed(2), lucro_mes: +c.lucro2.toFixed(2), lucro_mes_sem_crescimento: +(c.novo.mc * p.volume - p.fixos).toFixed(2), variacao_lucro: +c.delta.toFixed(2), crescimento_minimo_pct: isFinite(nec) ? +(nec * 100).toFixed(1) : null,
        melhor_alternativa_pct: melhor.comissao_pct, lucro_melhor_alternativa: melhor.lucro_mes_sem_crescimento,
        venda_da_prejuizo: c.novo.mc <= 0 ? 1 : 0, compensa: (a.mc > 0 && c.novo.mc > 0 && c.delta >= 0) ? 1 : 0 },
      estrategias: { subir_tudo: subirTudo, preco: preco, corte_custo: corte, comissao_maxima: { comissao_maxima_pct: comMax } },
      limites: limites(p, a),
      catalogo: piores,
      catalogo_resumo: { total: cat.length, abaixo_meta: cat.filter(function (r) { return r.sit >= 1; }).length, prejuizo: cat.filter(function (r) { return r.sit === 3; }).length, n_plataformas: plataformas.length },
      plataformas: plataformas,
      opcoes: opcoes
    };
  }

  // Conjunto completo de entradas a partir de valores parciais (usado na página e nos testes).
  function entradasPadrao(parcial) {
    var base = { preco: 100, custo: 40, frete: 0, taxaFixa: 0, comissao: 12, afiliado: 0, impostos: 6, taxas: 4, fixos: 3000, volume: 100,
      novaComissao: 16, crescimento: 20, desconto: 10, crescPromo: 30, roas: 12, margemAlvo: 25 };
    Object.keys(parcial || {}).forEach(function (k) { base[k] = parcial[k]; });
    return base;
  }

  return {
    MARGEM_APERTADA: MARGEM_APERTADA, VARIACOES_COMISSAO: VARIACOES_COMISSAO, MAX_PRODUTOS: MAX_PRODUTOS,
    num: num, arred: arred, lerNum: lerNum, varFrac: varFrac, custoUn: custoUn, cpaDe: cpaDe,
    calcular: calcular, crescimentoNecessario: crescimentoNecessario, cenario: cenario, precoPara: precoPara, limites: limites,
    parseCatalogo: parseCatalogo, resumoPlataformas: resumoPlataformas, compararPlataformas: compararPlataformas,
    montarDados: montarDados, entradasPadrao: entradasPadrao
  };
});
