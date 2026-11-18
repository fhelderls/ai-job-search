// Avaliação do relatório da IA do Margem Segura.
// Uso: node avaliacao-ia.mjs [URL_BASE]
// Para cada cenário: calcula pela regra (mesmas funções do index.html), chama /api/relatorio e confere:
//  1) números do texto que NÃO existem nos dados enviados (possível número inventado);
//  2) se o veredito do texto concorda com o da regra (heurística por palavras; casos duvidosos vão para leitura humana).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const aqui = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || 'https://margem-segura-seven.vercel.app';

// Usa os mesmos módulos que a página e a API (core/), sem copiar código.
const require = createRequire(import.meta.url);
const { calcular, cenario, montarDados, parseCatalogo, entradasPadrao } = require('../core/calc.js');
const decisoes = require('../core/decisoes.js');

const CAT_A = 'Camiseta básica; 59,90; 22; 8; 12\nGarrafa térmica; 89,90; 48; 12; 16\nFone bluetooth; 129,90; 86; 15; 18\nCapa de celular; 29,90; 9; 6; 12\nLuminária LED; 74,90; 51; 14; 16\nChaveiro personalizado; 19,90; 12; 5; 12';
const CAT_B = 'Kit cabos; 39,90; 30; 9; 16\nMouse; 49,90; 28; 8; 14\nSuporte; 24,90; 8; 4; 12';
// Catálogo com plataformas (dor da entrevista 1: comparar o mesmo produto entre plataformas).
const CAT_C = 'Camiseta; 59,90; 22; 8; 12; 0; 0; Shopee\nCamiseta; 59,90; 22; 8; 18; 4; 0; Mercado Livre\nFone; 129,90; 78; 15; 18; 5; 0; Mercado Livre\nCapa; 29,90; 7; 6; 14; 4; 0; Shopee';
// [nome, entradas (o que faltar usa entradasPadrao), catálogo]. ROAS = preço / custo por venda dos anúncios da versão anterior.
const CASOS = [
  ['1 base: lucro sobe', { roas: 12.5 }, CAT_A],
  ['2 lucro cai (aposta baixa)', { novaComissao: 20, crescimento: 5, desconto: 20, crescPromo: 10, roas: 6.7, margemAlvo: 30 }, ''],
  ['3 venda abaixo do custo', { custo: 70, novaComissao: 25, crescimento: 50, desconto: 30, crescPromo: 50, roas: 2.5, margemAlvo: 20 }, CAT_B],
  ['4 margem atual ja negativa', { custo: 90, frete: 5, fixos: 2000, novaComissao: 14, crescimento: 10, desconto: 15, crescPromo: 20, roas: 8.3 }, CAT_A],
  ['5 comissao menor', { novaComissao: 8, crescimento: 5, desconto: 5, crescPromo: 10, roas: 33.3 }, ''],
  ['6 margem baixa (<15%)', { custo: 60, frete: 5, comissao: 10, fixos: 2000, novaComissao: 12, crescimento: 30, roas: 12.5 }, CAT_B],
  ['7 loja pequena', { preco: 50, custo: 20, frete: 3, comissao: 15, impostos: 4, taxas: 3, fixos: 800, volume: 40, novaComissao: 18, crescimento: 10, desconto: 10, crescPromo: 25, roas: 10, margemAlvo: 30 }, ''],
  ['8 aposta zero', { preco: 80, custo: 30, frete: 2, comissao: 10, fixos: 1500, volume: 60, novaComissao: 14, crescimento: 0, desconto: 25, crescPromo: 40, roas: 8, margemAlvo: 35 }, CAT_A],
  ['9 taxa fixa e afiliado', { frete: 5, taxaFixa: 5, afiliado: 4, comissao: 16, novaComissao: 19, crescimento: 15, roas: 16 }, CAT_C],
  ['10 sem anuncios, com plataformas', { roas: 0, novaComissao: 14 }, CAT_C],
];

function montar(parcial, catTexto) {
  const p = entradasPadrao(parcial);
  const a = calcular(p, p.comissao), c = cenario(p, a, p.novaComissao, p.crescimento);
  const dados = montarDados(p, a, c, parseCatalogo(catTexto, p)); // mesma função que a página usa para montar o que vai à IA
  const compensa = a.mc > 0 && c.novo.mc > 0 && c.delta >= 0;
  const derivados = [p.volume * (1 + p.crescimento / 100), Math.ceil(p.volume * (1 + Math.max(c.necessario, 0))), p.crescimento / 100];
  return { dados, compensa, derivados, plano: decisoes.planoTexto(decisoes.plano(dados)) };
}

function numerosDoTexto(t) {
  return (t.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g) || []).map((x) => parseFloat(x.replace(/\./g, '').replace(',', '.')));
}

// Números que a IA pode citar: os dados enviados, os derivados e os do plano por regra que ela reescreve.
function permitidos(dados, derivados, plano) {
  const s = new Set([1, 2, 30]); // marcadores de lista, "2 perguntas" e "30 dias" (sugestão de prazo do teste, não é dado do cálculo)
  const add = (x) => { if (typeof x === 'number' && isFinite(x)) { s.add(Math.abs(x)); s.add(Math.round(Math.abs(x))); } };
  const percorre = (x) => { if (x && typeof x === 'object') Object.values(x).forEach(percorre); else add(x); };
  percorre(dados);
  derivados.forEach(add);
  numerosDoTexto(plano).forEach(add);
  return [...s];
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
for (const [nome, v, catTexto] of CASOS) {
  const { dados, compensa, derivados, plano } = montar(v, catTexto);
  let texto = '', erro = null;
  if (process.env.USAR_PLANO) {
    // Sem chamar a IA: aplica os mesmos checadores ao plano gerado por regra (não gasta crédito).
    texto = plano;
  } else try {
    const r = await fetch(base + '/api/relatorio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
    const j = await r.json();
    if (r.ok && j.relatorio) texto = j.relatorio; else erro = j.erro || ('HTTP ' + r.status);
  } catch (e) { erro = String(e); }
  const perm = permitidos(dados, derivados, plano);
  const fora = texto ? [...new Set(numerosDoTexto(texto).filter((x) => !perm.some((p) => Math.abs(p - x) <= 0.051)))] : [];
  // Erros de interpretação que o checador de números não pega.
  const alertas = [];
  if (/cada venda (j[aá] )?d[aá] preju[ií]zo/i.test(texto) && !dados.atual.venda_da_prejuizo && !/nova comiss[aã]o|cen[aá]rio/i.test(texto.match(/[^.]*cada venda (j[aá] )?d[aá] preju[ií]zo[^.]*/i)?.[0] || '')) alertas.push('afirma prejuizo por venda hoje sem base');
  if (texto && !dados.cenario.compensa && !texto.includes(String(dados.cenario.melhor_alternativa_pct).replace('.', ',') + '%')) alertas.push('nao cita a melhor alternativa calculada pela regra (' + dados.cenario.melhor_alternativa_pct + '%)');
  const partes = ['Recomendação', 'Risco', 'Teste', 'Preço e promoção', 'Anúncios e frete'].concat(dados.catalogo_resumo.total > 0 ? ['Catálogo'] : []);
  if (texto && !partes.every((s) => texto.includes(s + ':'))) alertas.push('faltou alguma parte: ' + partes.filter((s) => !texto.includes(s + ':')).join(', '));
  if (texto && dados.catalogo_resumo.total === 0 && texto.includes('Catálogo:')) alertas.push('falou de catalogo sem catalogo');
  if (texto && dados.catalogo_resumo.total > 0 && !/\bP\d{1,2}\b/.test(texto)) alertas.push('nao priorizou produtos do catalogo (P1, P2...)');
  if (texto && dados.limites.preco_abaixo_do_minimo && !/abaixo do m[ií]nimo/i.test(texto)) alertas.push('nao disse que o preco esta abaixo do minimo');
  if (texto && dados.limites.anuncio_cabe === 0 && !/n[ãa]o cabe|n[ãa]o compensa|prejuízo|abaixo|acima do m[aá]ximo|ultrapassa/i.test(texto.split('Anúncios e frete:')[1] || '')) alertas.push('nao disse que o anuncio nao cabe');
  if (/\bprov[aá]vel|improv[aá]vel|provavelmente|nesses dados|nos dados|\bcampo/i.test(texto)) alertas.push('especulacao ou vazamento de termo interno');
  if (/(^|\n)\s*(Observa[cç][aã]o|Resumo|Conclus[aã]o)\s*:/i.test(texto)) alertas.push('secao extra nao pedida');
  if (/\b[a-z]+_[a-z_]+\b|valor [01]\b/i.test(texto)) alertas.push('vazou nome de campo');
  if (/-\s?\d/.test(texto)) alertas.push('numero com sinal de menos (esperado: "prejuizo de X")');
  resultados.push({ nome, veredito_regra: compensa ? 'compensa' : 'nao compensa', erro, numeros_nao_verificados: fora, veredito_ok: texto ? veredito(texto, compensa) : 'sem texto', alertas, texto });
  console.log(`${nome} | regra: ${compensa ? 'compensa' : 'nao compensa'} | numeros fora dos dados: ${fora.length ? fora.join(', ') : 'nenhum'} | veredito: ${resultados.at(-1).veredito_ok} | alertas: ${alertas.length ? alertas.join('; ') : 'nenhum'}${erro ? ' | ERRO ' + erro : ''}`);
  await pausa(1200);
}
writeFileSync(join(aqui, 'resultados.json'), JSON.stringify(resultados, null, 2));
const ok = resultados.filter((r) => !r.erro && !r.numeros_nao_verificados.length && r.veredito_ok === 'ok' && !r.alertas.length).length;
console.log(`\nSem problema automático: ${ok} de ${resultados.length}. Casos marcados devem ser lidos à mão (resultados.json).`);
