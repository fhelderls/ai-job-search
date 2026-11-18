// Avaliação do relatório da IA do Margem Segura.
// Uso: node avaliacao-ia.mjs [URL_BASE]
// Para cada cenário: calcula pela regra (mesmas funções do index.html), chama /api/relatorio e confere:
//  1) números do texto que NÃO existem nos dados enviados (possível número inventado);
//  2) se o veredito do texto concorda com o da regra (heurística por palavras; casos duvidosos vão para leitura humana).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'https://margem-segura-seven.vercel.app';

// Reaproveita as funções de cálculo do próprio site, sem copiá-las.
const html = readFileSync(join(aqui, '..', 'index.html'), 'utf8');
const ini = html.indexOf('function num(');
const fim = html.indexOf('var R=function');
const { calcular, crescimentoNecessario, cenario } = new Function(
  html.slice(ini, fim) + '; return {calcular, crescimentoNecessario, cenario};'
)();

const CASOS = [
  ['1 base: lucro sobe', [100, 40, 0, 12, 6, 4, 3000, 100, 16, 20]],
  ['2 lucro cai (aposta baixa)', [100, 40, 0, 12, 6, 4, 3000, 100, 20, 5]],
  ['3 venda abaixo do custo', [100, 70, 0, 12, 6, 4, 3000, 100, 25, 50]],
  ['4 margem atual ja negativa', [100, 90, 5, 12, 6, 4, 2000, 100, 14, 10]],
  ['5 comissao menor', [100, 40, 0, 12, 6, 4, 3000, 100, 8, 5]],
  ['6 margem baixa (<15%)', [100, 60, 5, 10, 6, 4, 2000, 100, 12, 30]],
  ['7 loja pequena', [50, 20, 3, 15, 4, 3, 800, 40, 18, 10]],
  ['8 aposta zero', [80, 30, 2, 10, 6, 4, 1500, 60, 14, 0]],
];

function montar(v) {
  const [preco, custo, frete, comissao, impostos, taxas, fixos, volume, novaComissao, crescimento] = v;
  const p = { preco, custo, frete, comissao, impostos, taxas, fixos, volume, novaComissao, crescimento };
  const a = calcular(p, p.comissao), c = cenario(p, a, p.novaComissao, p.crescimento);
  const dados = {
    entradas: p,
    atual: { margem_un: +a.mc.toFixed(2), margem_pct: +(a.mcPct * 100).toFixed(1), markup_pct: +(a.markup * 100).toFixed(0), equilibrio_un: isFinite(a.equilibrio) ? a.equilibrio : null, lucro_mes: +a.lucro.toFixed(2) },
    cenario: { nova_comissao_pct: p.novaComissao, crescimento_apostado_pct: p.crescimento, margem_un: +c.novo.mc.toFixed(2), lucro_mes: +c.lucro2.toFixed(2), lucro_mes_sem_crescimento: +(c.novo.mc * p.volume - p.fixos).toFixed(2), variacao_lucro: +c.delta.toFixed(2), crescimento_minimo_pct: isFinite(c.necessario) ? +(Math.max(c.necessario, 0) * 100).toFixed(1) : null },
  };
  const compensa = a.mc > 0 && c.novo.mc > 0 && c.delta >= 0;
  const derivados = [p.volume * (1 + p.crescimento / 100), Math.ceil(p.volume * (1 + Math.max(c.necessario, 0))), p.crescimento / 100];
  return { dados, compensa, derivados };
}

function permitidos(dados, derivados) {
  const s = new Set([1, 2]); // marcadores de lista ("1.", "2.") e "2 perguntas"
  const add = (x) => { if (typeof x === 'number' && isFinite(x)) { s.add(Math.abs(x)); s.add(Math.round(Math.abs(x))); } };
  Object.values(dados).forEach((g) => Object.values(g).forEach(add));
  derivados.forEach(add);
  return [...s];
}

function numerosDoTexto(t) {
  return (t.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g) || []).map((x) => parseFloat(x.replace(/\./g, '').replace(',', '.')));
}

function veredito(texto, compensa) {
  const t = texto.toLowerCase();
  const neg = /n[ãa]o compensa|preju[ií]zo|cai\b|queda|reduz|perde|abaixo do custo|n[ãa]o vale|n[ãa]o faça/.test(t);
  const pos = /compensa|sobe|ganho|aumenta|lucro maior|a mais|vale a pena/.test(t);
  if (compensa) return pos && !/n[ãa]o compensa/.test(t) ? 'ok' : 'revisar';
  return neg ? 'ok' : 'revisar';
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
for (const [nome, v] of CASOS) {
  const { dados, compensa, derivados } = montar(v);
  let texto = '', erro = null;
  try {
    const r = await fetch(base + '/api/relatorio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
    const j = await r.json();
    if (r.ok && j.relatorio) texto = j.relatorio; else erro = j.erro || ('HTTP ' + r.status);
  } catch (e) { erro = String(e); }
  const perm = permitidos(dados, derivados);
  const fora = texto ? [...new Set(numerosDoTexto(texto).filter((x) => !perm.some((p) => Math.abs(p - x) <= 0.051)))] : [];
  resultados.push({ nome, veredito_regra: compensa ? 'compensa' : 'nao compensa', erro, numeros_nao_verificados: fora, veredito_ok: texto ? veredito(texto, compensa) : 'sem texto', texto });
  console.log(`${nome} | regra: ${compensa ? 'compensa' : 'nao compensa'} | numeros fora dos dados: ${fora.length ? fora.join(', ') : 'nenhum'} | veredito: ${resultados.at(-1).veredito_ok}${erro ? ' | ERRO ' + erro : ''}`);
  await pausa(1200);
}
writeFileSync(join(aqui, 'resultados.json'), JSON.stringify(resultados, null, 2));
const ok = resultados.filter((r) => !r.erro && !r.numeros_nao_verificados.length && r.veredito_ok === 'ok').length;
console.log(`\nSem problema automático: ${ok} de ${resultados.length}. Casos marcados devem ser lidos à mão (resultados.json).`);
