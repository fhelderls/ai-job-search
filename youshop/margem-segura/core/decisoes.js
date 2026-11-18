// Motor de decisões do Margem Segura. Transforma os números calculados (montarDados) em um plano
// de decisão em português, só por regra. Funciona sem IA: a IA, quando usada, apenas reescreve
// este texto em linguagem mais simples, sem poder mudar números nem vereditos.
// Roda no navegador (window.MargemDecisoes) e no Node (require).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MargemDecisoes = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  function N(v, d) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d === undefined ? 1 : d }); }
  function R(v) { return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // "lucro de R$ 400,00" ou "prejuízo de R$ 400,00" (nunca um número com sinal de menos).
  function lucroTxt(v) { return v < 0 ? 'prejuízo de ' + R(v) : 'lucro de ' + R(v); }

  function recomendacao(d) {
    var e = d.entradas, a = d.atual, c = d.cenario, est = d.estrategias, l = d.limites, t = [], nivel = 'ok';
    if (a.venda_da_prejuizo === 1) {
      nivel = 'bad';
      t.push('Hoje cada venda já dá prejuízo. O primeiro passo é rever o preço ou o custo, antes de mexer na comissão.');
      if (l.preco_minimo !== null) t.push('O preço mínimo para não perder dinheiro é ' + R(l.preco_minimo) + '.');
      return { secao: 'Recomendação', nivel: nivel, texto: t.join(' ') };
    }
    if (c.nova_comissao_pct === e.comissao) {
      return { secao: 'Recomendação', nivel: 'ok', texto: 'A nova comissão é igual à atual, então não há mudança a avaliar. Altere o cenário para comparar.' };
    }
    var melhorAlternativa = function () {
      if (c.melhor_alternativa_pct === e.comissao) {
        return 'A melhor opção entre as comissões comparadas é manter a atual, de ' + N(e.comissao) + '%, com ' + lucroTxt(c.lucro_melhor_alternativa) + ' por mês sem depender de vendas.';
      }
      return 'Entre as comissões comparadas, a melhor é ' + N(c.melhor_alternativa_pct) + '%, com ' + lucroTxt(c.lucro_melhor_alternativa) + ' por mês sem depender de vendas.';
    };
    if (c.venda_da_prejuizo === 1) {
      nivel = 'bad';
      t.push('Com ' + N(c.nova_comissao_pct) + '% de comissão cada venda daria prejuízo. Não adote esse cenário: nenhum aumento de vendas compensa.');
      t.push(melhorAlternativa());
    } else if (c.compensa === 1) {
      if (c.crescimento_minimo_pct !== null && c.crescimento_minimo_pct < 0) {
        t.push('O cenário de ' + N(c.nova_comissao_pct) + '% de comissão compensa: você pode vender até ' + N(Math.abs(c.crescimento_minimo_pct)) + '% menos (mínimo de ' + N(c.volume_necessario_un, 0) + ' unidades por mês) e manter o lucro de hoje.');
      } else {
        t.push('O cenário de ' + N(c.nova_comissao_pct) + '% de comissão compensa só se as vendas chegarem a pelo menos ' + N(c.volume_necessario_un, 0) + ' unidades por mês (' + N(c.crescimento_minimo_pct) + '% a mais que hoje). Esse aumento é uma aposta sua, não uma previsão: teste com cuidado.');
      }
      if (c.lucro_mes < 0) { nivel = 'warn'; t.push('Mesmo assim o mês continua com prejuízo de ' + R(c.lucro_mes) + '.'); }
    } else {
      nivel = 'bad';
      t.push('O cenário de ' + N(c.nova_comissao_pct) + '% de comissão não compensa: com a sua aposta de ' + N(c.crescimento_apostado_pct) + '% a mais em vendas, o lucro do mês cai ' + R(c.variacao_lucro) + '.');
      t.push(melhorAlternativa());
    }
    if (c.nova_comissao_pct > e.comissao && c.venda_da_prejuizo !== 1) {
      var saidas = [];
      if (est.preco.preco_novo !== null) saidas.push('subir o preço para ' + R(est.preco.preco_novo) + ' (' + N(est.preco.aumento_preco_pct) + '% a mais)');
      if (est.corte_custo.custo_novo !== null) saidas.push('baixar o custo do produto para ' + R(est.corte_custo.custo_novo) + ' (' + N(est.corte_custo.reducao_custo_pct) + '% a menos)');
      if (saidas.length) t.push('Para absorver a nova comissão sem depender de vendas: ' + saidas.join(' ou ') + '. Essas saídas também são apostas: o preço maior pode afastar clientes e o custo menor depende de negociar.');
      if (est.comissao_maxima.comissao_maxima_pct !== null) t.push('Com a sua aposta de vendas, a comissão mais alta que ainda iguala o lucro de hoje é ' + N(est.comissao_maxima.comissao_maxima_pct) + '%.');
    }
    return { secao: 'Recomendação', nivel: nivel, texto: t.join(' ') };
  }

  function risco(d) {
    var a = d.atual, c = d.cenario, sem = c.lucro_mes_sem_crescimento, hoje = a.lucro_mes, t = [];
    t.push('Se a aposta de vendas não vier e as vendas ficarem iguais, o mês fica com ' + lucroTxt(sem) + ' (hoje: ' + lucroTxt(hoje) + ').');
    if (c.lucro_mes < hoje - 0.005) t.push('Mesmo com a aposta, o mês fica com ' + lucroTxt(c.lucro_mes) + ', abaixo do de hoje.');
    else if (c.lucro_mes < 0) t.push('Mesmo com a aposta, o mês continua com prejuízo de ' + R(c.lucro_mes) + '.');
    if (a.queda_maxima_vendas_pct > 0) t.push('Hoje suas vendas podem cair até ' + N(a.queda_maxima_vendas_pct, 0) + '% antes de o mês dar prejuízo.');
    var nivel = sem < hoje - 0.005 ? (sem < 0 ? 'bad' : 'warn') : 'ok';
    return { secao: 'Risco', nivel: nivel, texto: t.join(' ') };
  }

  function teste(d) {
    var e = d.entradas, a = d.atual, c = d.cenario;
    if (a.venda_da_prejuizo === 1) return { secao: 'Teste', nivel: 'bad', texto: 'Antes de testar qualquer comissão, corrija o preço ou o custo.' };
    if (c.nova_comissao_pct === e.comissao) return { secao: 'Teste', nivel: 'ok', texto: 'Sem mudança de comissão, não há o que testar.' };
    if (c.venda_da_prejuizo === 1) return { secao: 'Teste', nivel: 'bad', texto: 'Não teste este cenário: cada venda daria prejuízo.' };
    if (c.compensa === 1) {
      return { secao: 'Teste', nivel: 'ok', texto: 'Teste por 30 dias, ou só com parte das vendas. Critério de parada: se o mês fechar com menos de ' + N(c.volume_necessario_un, 0) + ' unidades vendidas, volte à comissão anterior.' };
    }
    return { secao: 'Teste', nivel: 'warn', texto: 'Se mesmo assim quiser testar, faça por 30 dias, ou só com parte das vendas, e volte à comissão anterior se o resultado real do mês ficar abaixo do de hoje (' + lucroTxt(a.lucro_mes) + ').' };
  }

  function precoPromocao(d) {
    var e = d.entradas, l = d.limites, t = [], nivel = 'ok';
    if (l.preco_minimo === null) { nivel = 'bad'; t.push('Com esses custos e comissões não existe preço que deixe margem.'); }
    else if (l.preco_abaixo_do_minimo === 1) { nivel = 'bad'; t.push('Seu preço de ' + R(e.preco) + ' está abaixo do mínimo de ' + R(l.preco_minimo) + ': cada venda perde dinheiro.'); }
    else if (l.preco_meta === null) { nivel = 'warn'; t.push('Com esses custos não há preço que atinja a margem desejada de ' + N(e.margemAlvo, 0) + '%.'); }
    else if (l.preco_abaixo_da_meta === 1) { nivel = 'warn'; t.push('O preço atual de ' + R(e.preco) + ' está abaixo de ' + R(l.preco_meta) + ', o preço que dá a margem desejada de ' + N(e.margemAlvo, 0) + '%.'); }
    else t.push('O preço atual já atinge a margem desejada de ' + N(e.margemAlvo, 0) + '%.');
    if (e.desconto > 0) {
      if (l.desconto_crescimento_minimo_pct === null) { nivel = 'bad'; t.push('A promoção de ' + N(e.desconto, 0) + '% deixa a venda sem margem.'); }
      else if (l.desconto_cabe === 1) t.push('A promoção de ' + N(e.desconto, 0) + '% cabe se as vendas subirem pelo menos ' + N(l.desconto_crescimento_minimo_pct) + '% (você espera ' + N(e.crescPromo, 0) + '%).');
      else { if (nivel === 'ok') nivel = 'warn'; t.push('A promoção de ' + N(e.desconto, 0) + '% não cabe: seria preciso vender pelo menos ' + N(l.desconto_crescimento_minimo_pct) + '% a mais e você espera ' + N(e.crescPromo, 0) + '%.'); }
      if (l.desconto_maximo_seguro_pct !== null) t.push('O maior desconto seguro é de ' + N(l.desconto_maximo_seguro_pct) + '% se as vendas subirem ' + N(e.crescPromo, 0) + '%.');
    }
    return { secao: 'Preço e promoção', nivel: nivel, texto: t.join(' ') };
  }

  function anunciosFrete(d) {
    var e = d.entradas, l = d.limites, t = [], nivel = 'ok';
    if (e.roas > 0) {
      if (l.anuncio_cabe === 1) t.push('Com retorno de ' + N(e.roas) + 'x nos anúncios (custo de ' + R(e.cpa) + ' por venda), a margem fica em ' + R(l.margem_apos_anuncio_un) + ' por unidade (' + N(l.margem_apos_anuncio_pct) + '% do preço): o anúncio cabe.');
      else { nivel = 'bad'; t.push('Com retorno de ' + N(e.roas) + 'x nos anúncios (custo de ' + R(e.cpa) + ' por venda), cada venda ficaria com prejuízo de ' + R(l.margem_apos_anuncio_un) + ' depois do anúncio: o anúncio não cabe.'); }
    } else t.push('Nenhum anúncio informado.');
    if (l.cpa_maximo > 0) t.push('O máximo que dá para gastar é ' + R(l.cpa_maximo) + ' por venda, o que exige retorno mínimo de ' + N(l.roas_equilibrio) + 'x sobre o gasto.');
    else t.push('A venda já não deixa margem para anúncios.');
    if (l.frete_maximo <= 0) { nivel = 'bad'; t.push('Mesmo com frete zero, a venda não deixa margem.'); }
    else {
      if (e.frete > l.frete_maximo) nivel = 'bad';
      t.push('O frete máximo que ainda deixa margem é ' + R(l.frete_maximo) + ' (hoje: ' + R(e.frete) + ').');
    }
    return { secao: 'Anúncios e frete', nivel: nivel, texto: t.join(' ') };
  }

  // Produtos e plataformas aparecem como P1, P2... e L1, L2...; a página troca pelos nomes digitados.
  function catalogo(d, nomes) {
    var r = d.catalogo_resumo, e = d.entradas;
    if (!r.total) return null;
    var nomeP = function (n) { return (nomes && nomes.p && nomes.p[n]) || ('P' + n); };
    var nomeL = function (n) { return (nomes && nomes.l && nomes.l[n]) || ('L' + n); };
    var t = [], nivel = r.prejuizo > 0 ? 'bad' : (r.abaixo_meta > 0 ? 'warn' : 'ok');
    t.push(N(r.total, 0) + ' produtos lidos: ' + N(r.abaixo_meta, 0) + ' abaixo da meta de ' + N(e.margemAlvo, 0) + '% e ' + N(r.prejuizo, 0) + ' dando prejuízo.');
    var prior = d.catalogo.filter(function (x) { return x.situacao >= 1; }).slice(0, 3);
    if (prior.length) {
      t.push('Corrija primeiro: ' + prior.map(function (x) {
        return nomeP(x.n) + ' (' + (x.margem_pct < 0 ? 'prejuízo de ' + N(Math.abs(x.margem_pct)) + '% do preço por venda' : 'margem de ' + N(x.margem_pct) + '%') + (x.preco_meta !== null ? ', preço para a meta ' + R(x.preco_meta) : '') + (x.plat && r.n_plataformas >= 2 ? ', em ' + nomeL(x.plat) : '') + ')';
      }).join('; ') + '.');
    } else t.push('Todos os produtos estão na meta.');
    if (d.plataformas.length >= 2) {
      var ord = d.plataformas.slice().sort(function (x, y) { return x.margem_media_pct - y.margem_media_pct; });
      var pior = ord[0], melhor = ord[ord.length - 1];
      t.push('Margem média por plataforma: a pior é ' + nomeL(pior.n) + ' (' + N(pior.margem_media_pct) + '%) e a melhor é ' + nomeL(melhor.n) + ' (' + N(melhor.margem_media_pct) + '%).');
    }
    return { secao: 'Catálogo', nivel: nivel, texto: t.join(' ') };
  }

  function plano(d, nomes) {
    var itens = [recomendacao(d), risco(d), teste(d), precoPromocao(d), anunciosFrete(d), catalogo(d, nomes)];
    return itens.filter(Boolean);
  }
  function planoTexto(itens) {
    return itens.map(function (i) { return i.secao + ': ' + i.texto; }).join('\n\n');
  }

  return { plano: plano, planoTexto: planoTexto, lucroTxt: lucroTxt, R: R, N: N };
});
