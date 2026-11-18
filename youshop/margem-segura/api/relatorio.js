// Função serverless (Vercel). Recebe só números já calculados no navegador, valida pelo esquema
// compartilhado, monta o plano de decisão POR REGRA (core/decisoes.js) e pede à API da Claude
// apenas que reescreva esse plano em linguagem simples. A conta e o veredito NÃO são feitos pela IA.
// Requer ANTHROPIC_API_KEY (variável de ambiente na Vercel, nunca no código).
// Opcional: MODELO_IA para trocar o modelo (padrão: Sonnet) sem mexer no código.

const crypto = require('node:crypto');
const schema = require('../core/schema.js');
const decisoes = require('../core/decisoes.js');

const MODELO = process.env.MODELO_IA || 'claude-sonnet-5-5';
const JANELA_MS = 10 * 60 * 1000;
const MAX_POR_JANELA = 8;
const acessos = new Map(); // limite simples por IP (melhor esforço, por instância)

// Cache por plano: a mesma entrada devolve o mesmo texto sem gastar crédito (melhor esforço, por instância).
const CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

function limitado(ip) {
  const agora = Date.now();
  const lista = (acessos.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  acessos.set(ip, lista);
  return lista.length > MAX_POR_JANELA;
}

function doCache(chave) {
  const item = cache.get(chave);
  if (!item) return null;
  if (Date.now() - item.t > CACHE_MS) { cache.delete(chave); return null; }
  return item.texto;
}
function guardaNoCache(chave, texto) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(chave, { t: Date.now(), texto });
}

function montarPrompt(planoTexto) {
  return (
    'Você ajuda um pequeno vendedor a decidir sobre preço, comissão e margem. Abaixo está um plano de decisão já calculado e conferido por regras. ' +
    'Reescreva-o em português simples, para uma pessoa leiga, sem asteriscos nem markdown, em até 24 linhas, ' +
    'mantendo as mesmas partes na mesma ordem, cada uma começando pelo seu nome seguido de dois-pontos.\n' +
    'Regras: não mude nenhum número, veredito nem recomendação; mantenha os códigos P1, P2, L1... exatamente como estão; ' +
    'não acrescente fatos, causas, previsões, números ou partes novas; não use palavras de probabilidade (provável, provavelmente); ' +
    'escreva "prejuízo de X reais" em vez de um número com sinal de menos; ' +
    'deixe claro que o aumento de vendas é uma aposta do vendedor, não uma previsão. Você pode juntar frases e tornar o texto mais claro.\n\n' +
    'PLANO:\n' + planoTexto
  );
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST.' });

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) return res.status(503).json({ erro: 'IA ainda não configurada neste servidor.' });

  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = null; } }
  const dados = schema.validar(corpo);
  if (!dados) return res.status(400).json({ erro: 'Dados inválidos.' });

  // O texto do pedido é montado aqui, a partir de números validados (evita usar o endpoint como chat livre).
  const planoTexto = decisoes.planoTexto(decisoes.plano(dados));
  const hash = crypto.createHash('sha256').update(MODELO + '\n' + planoTexto).digest('hex');
  const guardado = doCache(hash);
  if (guardado) return res.status(200).json({ relatorio: guardado, cache: true });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  if (limitado(ip)) return res.status(429).json({ erro: 'Muitos pedidos. Tente de novo em alguns minutos.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1500, thinking: { type: 'between_tools' }, messages: [{ role: 'user', content: montarPrompt(planoTexto) }] }),
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
    guardaNoCache(hash, texto);
    return res.status(200).json({ relatorio: texto });
  } catch (e) {
    return res.status(502).json({ erro: 'Falha ao falar com a IA.' });
  }
};

// Exposto só para testes.
module.exports.montarPrompt = montarPrompt;
