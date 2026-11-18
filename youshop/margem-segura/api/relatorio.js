// Função serverless (Vercel). Recebe só números já calculados no navegador e
// pede à API da Claude uma explicação em linguagem simples. A conta NÃO é feita aqui.
// Requer a variável de ambiente ANTHROPIC_API_KEY (configurada na Vercel, nunca no código).

const MODELO = 'claude-sonnet-5-5';
const JANELA_MS = 10 * 60 * 1000;
const MAX_POR_JANELA = 8;
const acessos = new Map(); // limite simples por IP (melhor esforço, por instância)

function limitado(ip) {
  const agora = Date.now();
  const lista = (acessos.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  acessos.set(ip, lista);
  return lista.length > MAX_POR_JANELA;
}

function soNumeros(obj, chaves) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const k of chaves) {
    const v = obj[k];
    if (v === null) { out[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e9) return null;
    out[k] = v;
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return res.status(503).json({ erro: 'IA ainda não configurada neste servidor.' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  if (limitado(ip)) return res.status(429).json({ erro: 'Muitos pedidos. Tente de novo em alguns minutos.' });

  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
  if (!corpo) return res.status(400).json({ erro: 'Corpo inválido.' });

  const entradas = soNumeros(corpo.entradas, ['preco', 'custo', 'frete', 'comissao', 'impostos', 'taxas', 'fixos', 'volume', 'novaComissao', 'crescimento', 'desconto', 'crescPromo', 'cpa', 'margemAlvo']);
  const atual = soNumeros(corpo.atual, ['margem_un', 'margem_pct', 'markup_pct', 'equilibrio_un', 'lucro_mes', 'queda_maxima_vendas_pct', 'venda_da_prejuizo']);
  const cenario = soNumeros(corpo.cenario, ['nova_comissao_pct', 'crescimento_apostado_pct', 'volume_apostado_un', 'volume_necessario_un', 'margem_un', 'lucro_mes', 'lucro_mes_sem_crescimento', 'variacao_lucro', 'crescimento_minimo_pct', 'melhor_alternativa_pct', 'lucro_melhor_alternativa', 'venda_da_prejuizo', 'compensa']);
  const listaOpcoes = Array.isArray(corpo.opcoes) && corpo.opcoes.length > 0 && corpo.opcoes.length <= 8 ? corpo.opcoes : null;
  const opcoes = listaOpcoes ? listaOpcoes.map((o) => soNumeros(o, ['comissao_pct', 'margem_un', 'equilibrio_un', 'crescimento_minimo_pct', 'lucro_mes_sem_crescimento'])) : null;
  const est = corpo.estrategias && typeof corpo.estrategias === 'object' ? corpo.estrategias : null;
  const estrategias = est ? {
    subir_tudo: soNumeros(est.subir_tudo, ['lucro_se_aposta_vem', 'lucro_se_nao_vem']),
    preco: soNumeros(est.preco, ['preco_novo', 'aumento_preco_pct']),
    corte_custo: soNumeros(est.corte_custo, ['custo_novo', 'reducao_custo_pct']),
    comissao_maxima: soNumeros(est.comissao_maxima, ['comissao_maxima_pct']),
  } : null;
  const limites = soNumeros(corpo.limites, ['preco_minimo', 'preco_meta', 'preco_abaixo_do_minimo', 'preco_abaixo_da_meta', 'frete_maximo', 'cpa_maximo', 'roas_equilibrio', 'margem_apos_anuncio_un', 'margem_apos_anuncio_pct', 'anuncio_cabe', 'desconto_margem_un', 'desconto_crescimento_minimo_pct', 'desconto_cabe', 'desconto_maximo_seguro_pct']);
  const listaCat = Array.isArray(corpo.catalogo) && corpo.catalogo.length <= 15 ? corpo.catalogo : null;
  const catalogo = listaCat ? listaCat.map((o) => soNumeros(o, ['n', 'margem_un', 'margem_pct', 'preco_meta', 'situacao'])) : null;
  const catalogoResumo = soNumeros(corpo.catalogo_resumo, ['total', 'abaixo_meta', 'prejuizo']);
  if (!entradas || !atual || !cenario || !opcoes || opcoes.some((o) => !o) || !estrategias || Object.values(estrategias).some((o) => !o) || !limites || !catalogo || catalogo.some((o) => !o) || !catalogoResumo) return res.status(400).json({ erro: 'Dados inválidos.' });

  // O texto do pedido é montado aqui; o cliente só envia números (evita usar o endpoint como chat livre).
  const dados = JSON.stringify({ entradas, atual, cenario, estrategias, limites, catalogo, catalogo_resumo: catalogoResumo, opcoes }, null, 2);
  const prompt =
    'Você é um consultor que ajuda um pequeno vendedor a proteger a margem. Ele já vê na tela as tabelas de números, ' +
    'então NÃO narre nem repita o que a tela mostra: entregue decisão e próximos passos. Responda em português simples, sem asteriscos nem markdown, ' +
    'em até 24 linhas no total, com estas partes, cada uma começando pelo seu nome:\n' +
    'Recomendação: sobre a mudança de comissão do cenário, uma frase coerente com o campo compensa (1 = o cenário compensa se a aposta de vendas se confirmar; 0 = não compensa). ' +
    'Se compensa for 1, diga que a mudança só vale se as vendas chegarem ao mínimo exigido e recomende testá-la com cuidado; ' +
    'se crescimento_minimo_pct for negativo, a comissão é menor e ele pode vender um pouco menos e manter o lucro. ' +
    'Se compensa for 0, recomende não adotar a comissão do cenário e indique a melhor alternativa, que JÁ ESTÁ calculada em ' +
    'melhor_alternativa_pct (com lucro do mês lucro_melhor_alternativa, sem depender de crescimento); não escolha outra e não compare as opções por conta própria. ' +
    'Se melhor_alternativa_pct for igual a entradas.comissao, a melhor alternativa é manter a comissão atual. Não invente motivos. ' +
    'Para absorver a nova comissão sem depender de vendas, cite o caminho do preço (estrategias.preco) ou o do corte de custo (estrategias.corte_custo), se existirem, ' +
    'e a comissão mais alta que ainda iguala o lucro de hoje (comissao_maxima_pct). ' +
    'A comissão atual é entradas.comissao: use "manter" só para ela e "reduzir" ou "subir" para as demais. ' +
    'O veredito é FIXO e vem de compensa: nunca o contradiga (se compensa for 1, não diga que o cenário não compensa, e vice-versa). ' +
    'Para saber se o lucro melhora ou piora, use variacao_lucro (positivo = melhora, negativo = piora) e não compare números negativos por conta própria. ' +
    'Se atual.venda_da_prejuizo for 1, COMECE a Recomendação dizendo que cada venda já dá prejuízo hoje e que o primeiro passo é rever preço ou custo. ' +
    'Se atual.venda_da_prejuizo for 0, NUNCA diga que cada venda já dá prejuízo hoje, mesmo que o lucro do mês seja negativo (pode ser por causa dos custos fixos). ' +
    'Se cenario.venda_da_prejuizo for 1, diga que a nova comissão faria cada venda dar prejuízo. ' +
    'O mínimo exigido de vendas é volume_necessario_un; volume_apostado_un é apenas o que o vendedor apostou, não o mínimo.\n' +
    'Risco: o que acontece com o lucro do mês se a aposta de vendas não vier (use lucro_mes_sem_crescimento e compare com o lucro de hoje). ' +
    'Se mesmo com a aposta o lucro do mês ficar abaixo do de hoje ou negativo, diga isso claramente.\n' +
    'Teste: como validar a mudança de comissão sem apostar tudo (por exemplo, por um período curto, como 30 dias, ou só com parte das vendas). ' +
    'Se compensa for 1, o critério de parada é vender pelo menos volume_necessario_un unidades por mês; ' +
    'se compensa for 0, o critério é o lucro real do mês não ficar abaixo do lucro de hoje.\n' +
    'Preço e promoção: use limites. Se preco_abaixo_do_minimo for 1, diga que o preço atual está abaixo do mínimo (preco_minimo) e cada venda perde dinheiro; ' +
    'senão, se preco_abaixo_da_meta for 1, diga que o preço atual está abaixo do preço para a margem desejada (preco_meta); senão, diga que o preço atual já atinge a margem desejada. ' +
    'Depois diga se a promoção testada cabe (desconto_cabe: 1 = cabe se as vendas subirem pelo menos desconto_crescimento_minimo_pct; 0 = não cabe) e o maior desconto seguro (desconto_maximo_seguro_pct).\n' +
    'Anúncios e frete: use limites. Diga se o custo por venda em anúncios testado (entradas.cpa) cabe (anuncio_cabe: 1 = cabe, 0 = não cabe), o custo máximo por venda (cpa_maximo) e o retorno mínimo (roas_equilibrio, escreva "retorno mínimo de Nx sobre o gasto"). ' +
    'Diga também o frete máximo (frete_maximo) em comparação com o frete atual (entradas.frete).\n' +
    'Catálogo: SOMENTE se catalogo_resumo.total for maior que 0 (senão omita esta parte). Diga quantos produtos estão abaixo da meta (abaixo_meta) e quantos dão prejuízo (prejuizo), ' +
    'e indique até 3 prioridades entre os de pior margem do campo catalogo (situacao 3 = prejuízo, 2 = margem abaixo de 15%, 1 = abaixo da meta, 0 = na meta), ' +
    'citando cada um como P seguido do número n (por exemplo P2) e o preço para a meta (preco_meta). Não invente produtos nem nomes.\n' +
    'Regras: escreva como para uma pessoa leiga. NUNCA escreva nomes de campos nem os valores 0 ou 1 dos indicadores: ' +
    'diga "o cenário compensa" ou "não compensa", "lucro do mês", "unidades necessárias" etc. ' +
    'Quando o lucro do mês for negativo, escreva "prejuízo de X reais" (sem sinal de menos) em vez de "lucro de -X". ' +
    'Escreva somente as partes pedidas, sem acrescentar outras seções (como "Observação"). ' +
    'Não use palavras de probabilidade (provável, improvável, provavelmente) nem especule sobre causas. ' +
    'Quando um caminho não existir (valor vazio), diga apenas que não há como absorver por esse caminho; nunca mencione "dados", "campos" nem "cálculo". ' +
    'Se atual.venda_da_prejuizo for 0, não fale em "perda por unidade": a nova comissão só reduz a margem de cada venda. ' +
    'Use SOMENTE números dos dados abaixo, não recalcule nada, ' +
    'não invente previsões nem dados de mercado e deixe claro que o aumento de vendas é uma aposta do vendedor.\n\n' + dados;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1500, thinking: { type: 'between_tools' }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) {
      const detalhe = await r.text().catch(() => '');
      console.error('Anthropic API', r.status, detalhe.slice(0, 300));
      return res.status(502).json({ erro: 'A IA não respondeu agora. Tente de novo.' });
    }
    const j = await r.json();
    console.log('stop_reason', j.stop_reason, JSON.stringify(j.usage || {}), 'blocos', (j.content || []).map((b) => b.type + ':' + (b.text || '').length).join(','));
    const texto = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texto) {
      console.error('Resposta sem texto', j.stop_reason, JSON.stringify(j.content || []).slice(0, 300));
      return res.status(502).json({ erro: 'Resposta vazia da IA.' });
    }
    return res.status(200).json({ relatorio: texto });
  } catch (e) {
    return res.status(502).json({ erro: 'Falha ao falar com a IA.' });
  }
};
