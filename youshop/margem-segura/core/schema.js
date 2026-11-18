// Esquema único dos dados que a página envia à API. A API só aceita números nestes campos
// (nada de texto livre), e o teste confere que montarDados() produz exatamente isto.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MargemSchema = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var CAMPOS = {
    entradas: ['preco', 'custo', 'frete', 'taxaFixa', 'comissao', 'afiliado', 'impostos', 'taxas', 'fixos', 'volume', 'novaComissao', 'crescimento', 'desconto', 'crescPromo', 'roas', 'margemAlvo', 'cpa'],
    atual: ['margem_un', 'margem_pct', 'markup_pct', 'equilibrio_un', 'lucro_mes', 'queda_maxima_vendas_pct', 'venda_da_prejuizo'],
    cenario: ['nova_comissao_pct', 'crescimento_apostado_pct', 'volume_apostado_un', 'volume_necessario_un', 'margem_un', 'lucro_mes', 'lucro_mes_sem_crescimento', 'variacao_lucro', 'crescimento_minimo_pct', 'melhor_alternativa_pct', 'lucro_melhor_alternativa', 'venda_da_prejuizo', 'compensa'],
    opcao: ['comissao_pct', 'margem_un', 'equilibrio_un', 'crescimento_minimo_pct', 'lucro_mes_sem_crescimento'],
    subir_tudo: ['lucro_se_aposta_vem', 'lucro_se_nao_vem'],
    preco: ['preco_novo', 'aumento_preco_pct'],
    corte_custo: ['custo_novo', 'reducao_custo_pct'],
    comissao_maxima: ['comissao_maxima_pct'],
    limites: ['preco_minimo', 'preco_meta', 'preco_abaixo_do_minimo', 'preco_abaixo_da_meta', 'frete_maximo', 'cpa_maximo', 'roas_equilibrio', 'margem_apos_anuncio_un', 'margem_apos_anuncio_pct', 'anuncio_cabe', 'desconto_margem_un', 'desconto_crescimento_minimo_pct', 'desconto_cabe', 'desconto_maximo_seguro_pct'],
    catalogo_item: ['n', 'margem_un', 'margem_pct', 'preco_meta', 'situacao', 'plat'],
    catalogo_resumo: ['total', 'abaixo_meta', 'prejuizo', 'n_plataformas'],
    plataforma_item: ['n', 'produtos', 'margem_media_pct', 'abaixo_meta', 'prejuizo']
  };
  var MAX_OPCOES = 8, MAX_CATALOGO = 15, MAX_PLATAFORMAS = 8;

  // Copia só os campos listados; devolve null se algum não for número finito (ou null).
  function soNumeros(obj, chaves) {
    if (!obj || typeof obj !== 'object') return null;
    var out = {};
    for (var i = 0; i < chaves.length; i++) {
      var k = chaves[i], v = obj[k];
      if (v === null) { out[k] = null; continue; }
      if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 1e9) return null;
      out[k] = v;
    }
    return out;
  }
  function lista(arr, chaves, max, minimo) {
    if (!Array.isArray(arr) || arr.length > max || arr.length < minimo) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) { var o = soNumeros(arr[i], chaves); if (!o) return null; out.push(o); }
    return out;
  }

  // Devolve os dados limpos (só os campos do esquema) ou null se algo estiver fora do formato.
  function validar(corpo) {
    if (!corpo || typeof corpo !== 'object') return null;
    var est = corpo.estrategias;
    if (!est || typeof est !== 'object') return null;
    var dados = {
      entradas: soNumeros(corpo.entradas, CAMPOS.entradas),
      atual: soNumeros(corpo.atual, CAMPOS.atual),
      cenario: soNumeros(corpo.cenario, CAMPOS.cenario),
      estrategias: {
        subir_tudo: soNumeros(est.subir_tudo, CAMPOS.subir_tudo),
        preco: soNumeros(est.preco, CAMPOS.preco),
        corte_custo: soNumeros(est.corte_custo, CAMPOS.corte_custo),
        comissao_maxima: soNumeros(est.comissao_maxima, CAMPOS.comissao_maxima)
      },
      limites: soNumeros(corpo.limites, CAMPOS.limites),
      catalogo: lista(corpo.catalogo, CAMPOS.catalogo_item, MAX_CATALOGO, 0),
      catalogo_resumo: soNumeros(corpo.catalogo_resumo, CAMPOS.catalogo_resumo),
      plataformas: lista(corpo.plataformas, CAMPOS.plataforma_item, MAX_PLATAFORMAS, 0),
      opcoes: lista(corpo.opcoes, CAMPOS.opcao, MAX_OPCOES, 1)
    };
    var e = dados.estrategias;
    var ok = dados.entradas && dados.atual && dados.cenario && dados.limites && dados.catalogo && dados.catalogo_resumo && dados.plataformas && dados.opcoes &&
      e.subir_tudo && e.preco && e.corte_custo && e.comissao_maxima;
    return ok ? dados : null;
  }

  return { CAMPOS: CAMPOS, soNumeros: soNumeros, validar: validar };
});
