// Função serverless (Vercel). Recebe só números já calculados no navegador e
// pede à API da Claude uma explicação em linguagem simples. A conta NÃO é feita aqui.
// Requer a variável de ambiente ANTHROPIC_API_KEY (configurada na Vercel, nunca no código).

const MODELO = 'claude-haiku-5-5';
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

  const entradas = soNumeros(corpo.entradas, ['preco', 'custo', 'frete', 'comissao', 'impostos', 'taxas', 'fixos', 'volume', 'novaComissao', 'crescimento']);
  const atual = soNumeros(corpo.atual, ['margem_un', 'margem_pct', 'markup_pct', 'equilibrio_un', 'lucro_mes']);
  const cenario = soNumeros(corpo.cenario, ['nova_comissao_pct', 'crescimento_apostado_pct', 'margem_un', 'lucro_mes', 'lucro_mes_sem_crescimento', 'variacao_lucro', 'crescimento_minimo_pct']);
  if (!entradas || !atual || !cenario) return res.status(400).json({ erro: 'Dados inválidos.' });

  // O texto do pedido é montado aqui; o cliente só envia números (evita usar o endpoint como chat livre).
  const dados = JSON.stringify({ entradas, atual, cenario }, null, 2);
  const prompt =
    'Você é um consultor financeiro para pequenos vendedores. Explique em português simples, em até 8 linhas, ' +
    'o resultado abaixo e diga se o cenário de mudança de comissão compensa. Use SOMENTE os números fornecidos, ' +
    'não recalcule nada (se precisar do lucro com as vendas iguais, use lucro_mes_sem_crescimento), não invente previsões e deixe claro que o aumento de vendas é uma aposta do vendedor. ' +
    'Termine com 2 perguntas que o vendedor deve se fazer antes de decidir.\n\n' + dados;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1500, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: prompt }] }),
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
