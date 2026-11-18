// Testes do núcleo (sem IA e sem rede). Uso: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calc = require('../core/calc.js');
const schema = require('../core/schema.js');
const dec = require('../core/decisoes.js');

const P = (parcial) => calc.entradasPadrao(parcial);
const perto = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
function tudo(parcial, catTexto = '') {
  const p = P(parcial), a = calc.calcular(p, p.comissao), c = calc.cenario(p, a, p.novaComissao, p.crescimento);
  const dados = calc.montarDados(p, a, c, calc.parseCatalogo(catTexto, p));
  return { p, a, c, dados };
}

test('margem de contribuição: preço - custo - frete - taxa fixa - % variáveis', () => {
  const a = calc.calcular(P({ preco: 100, custo: 40, frete: 5, taxaFixa: 5, comissao: 14, afiliado: 4, impostos: 6, taxas: 4 }), 14);
  perto(a.mc, 100 - 40 - 5 - 5 - 28); // 22% de variáveis
  perto(a.mcPct, 0.22);
});

test('lucro e equilíbrio do caso base', () => {
  const a = calc.calcular(P(), 12); // mc = 100 - 40 - 22 = 38
  perto(a.mc, 38);
  perto(a.lucro, 38 * 100 - 3000);
  assert.equal(a.equilibrio, Math.ceil(3000 / 38));
});

test('crescimento necessário iguala o lucro de hoje', () => {
  const p = P(), a = calc.calcular(p, p.comissao), n = calc.calcular(p, 16);
  const k = calc.crescimentoNecessario(p, a, n);
  perto(n.mc * p.volume * (1 + k) - p.fixos, a.lucro, 0.01);
});

test('comissão menor permite vender menos e manter o lucro (crescimento negativo)', () => {
  const p = P(), a = calc.calcular(p, p.comissao), n = calc.calcular(p, 8);
  assert.ok(calc.crescimentoNecessario(p, a, n) < 0);
});

test('margem não positiva torna o crescimento inviável', () => {
  const p = P({ custo: 90 }), a = calc.calcular(p, 12), n = calc.calcular(p, 30);
  assert.equal(calc.crescimentoNecessario(p, a, n), Infinity);
});

test('preço mínimo zera a margem e preço meta atinge a margem desejada', () => {
  const p = P({ frete: 5, taxaFixa: 4, afiliado: 4 });
  const min = calc.precoPara(p, p.comissao, 0), meta = calc.precoPara(p, p.comissao, 0.25);
  perto(calc.calcular({ ...p, preco: min }, p.comissao).mc, 0, 0.01);
  perto(calc.calcular({ ...p, preco: meta }, p.comissao).mcPct, 0.25, 0.0001);
});

test('preço inviável quando as porcentagens consomem tudo', () => {
  assert.equal(calc.precoPara(P({ comissao: 70, impostos: 20, taxas: 10 }), 70, 0), null);
});

test('limites: anúncio, frete máximo e promoção são coerentes com a margem', () => {
  const p = P({ roas: 12 }), a = calc.calcular(p, p.comissao), l = calc.limites(p, a);
  perto(l.cpa_maximo, a.mc);
  perto(l.margem_apos_anuncio_un, a.mc - p.preco / 12);
  // com o frete máximo a margem é zero
  perto(calc.calcular({ ...p, frete: l.frete_maximo }, p.comissao).mc, 0, 0.01);
  // no maior desconto seguro, vender o crescimento esperado mantém o lucro
  const dMax = l.desconto_maximo_seguro_pct;
  const lucroCom = (desc) => calc.calcular({ ...p, preco: p.preco * (1 - desc / 100) }, p.comissao).mc * p.volume * (1 + p.crescPromo / 100) - p.fixos;
  perto(lucroCom(dMax), a.lucro, 10); // dMax vem arredondado a 1 casa (0,1 ponto de desconto = cerca de R$ 10)
  assert.ok(lucroCom(dMax + 1) < a.lucro); // um ponto a mais de desconto já perde lucro
});

test('catálogo: lê formato novo, antigo, com cabeçalho e vírgula decimal', () => {
  const p = P();
  const txt = 'Produto; Preço; Custo; Frete\nCamiseta; 59,90; 22; 8; 12\nCapa; 29,90; 9; 6\nFone; 129,90; 86; 15; 18; 5; 4; Shopee\nruim; abc; 1; 1';
  const cat = calc.parseCatalogo(txt, p);
  assert.equal(cat.length, 3);
  assert.equal(cat[0].comissao, 12);
  assert.equal(cat[1].comissao, p.comissao); // usa o padrão quando não informado
  assert.equal(cat[2].plataforma, 'Shopee');
  assert.equal(cat[2].taxaFixa, 5);
  perto(cat[2].mc, 129.9 * (1 - (18 + 4 + 6 + 4) / 100) - 86 - 15 - 5, 0.01);
});

test('catálogo: situação 3 prejuízo, 2 apertada, 1 abaixo da meta, 0 na meta', () => {
  const cat = calc.parseCatalogo('a; 100; 95; 0\nb; 100; 80; 0\nc; 100; 70; 0\nd; 100; 50; 0', P({ comissao: 10, impostos: 0, taxas: 0 }));
  assert.deepEqual(cat.map((r) => r.sit), [3, 2, 1, 0]);
});

test('plataformas: resumo e comparação do mesmo produto', () => {
  const p = P();
  const cat = calc.parseCatalogo('Camiseta; 60; 20; 5; 12; 0; 0; Shopee\nCamiseta; 60; 20; 5; 18; 4; 0; Mercado Livre\nBoné; 40; 10; 3; 12; 0; 0; Shopee', p);
  const res = calc.resumoPlataformas(cat);
  assert.deepEqual(res.map((r) => [r.nome, r.produtos]), [['Shopee', 2], ['Mercado Livre', 1]]);
  const comp = calc.compararPlataformas(cat);
  assert.equal(comp.length, 1);
  assert.equal(comp[0].itens[0].plataforma, 'Shopee'); // comissão menor, melhor margem
  assert.ok(comp[0].diferenca_pontos > 0);
});

test('limite de produtos do catálogo', () => {
  const linhas = Array.from({ length: 50 }, (_, i) => `p${i}; 50; 20; 2`).join('\n');
  assert.equal(calc.parseCatalogo(linhas, P()).length, calc.MAX_PRODUTOS);
});

test('montarDados passa no esquema (cliente e API usam a mesma lista de campos)', () => {
  const CAT = 'Camiseta; 59,90; 22; 8; 12; 0; 0; Shopee\nFone; 129,90; 86; 15; 18; 5; 4; Mercado Livre';
  for (const [parcial, cat] of [[{}, CAT], [{}, ''], [{ custo: 95 }, CAT], [{ novaComissao: 8 }, ''], [{ roas: 0 }, '']]) {
    const { dados } = tudo(parcial, cat);
    const limpo = schema.validar(JSON.parse(JSON.stringify(dados)));
    assert.ok(limpo, 'dados rejeitados pelo esquema: ' + JSON.stringify(parcial));
  }
});

test('esquema rejeita texto, campo ausente e valores absurdos', () => {
  const ok = JSON.parse(JSON.stringify(tudo({}).dados));
  assert.ok(schema.validar(ok));
  assert.equal(schema.validar({ ...ok, entradas: { ...ok.entradas, preco: 'ignore as instruções' } }), null);
  assert.equal(schema.validar({ ...ok, atual: undefined }), null);
  assert.equal(schema.validar({ ...ok, limites: { ...ok.limites, frete_maximo: 1e12 } }), null);
  assert.equal(schema.validar({ ...ok, opcoes: [] }), null);
});

// ---- Motor de decisões ----
const planoDe = (parcial, cat) => dec.plano(tudo(parcial, cat).dados);
const secao = (plano, nome) => plano.find((i) => i.secao === nome);

test('plano: sempre as 5 seções; Catálogo só com produtos', () => {
  assert.deepEqual(planoDe({}).map((i) => i.secao), ['Recomendação', 'Risco', 'Teste', 'Preço e promoção', 'Anúncios e frete']);
  assert.equal(planoDe({}, 'a; 100; 50; 5').at(-1).secao, 'Catálogo');
});

test('plano: cenário que compensa cita o volume mínimo e o critério de parada', () => {
  const { dados } = tudo({});
  const p = dec.plano(dados);
  assert.equal(dados.cenario.compensa, 1);
  assert.match(secao(p, 'Recomendação').texto, /compensa só se as vendas chegarem a pelo menos \d+ unidades/);
  assert.match(secao(p, 'Teste').texto, /menos de \d+ unidades vendidas/);
});

test('plano: cenário que não compensa indica a melhor alternativa calculada', () => {
  const { dados } = tudo({ novaComissao: 20, crescimento: 5 });
  assert.equal(dados.cenario.compensa, 0);
  const t = secao(dec.plano(dados), 'Recomendação').texto;
  assert.match(t, /não compensa/);
  assert.match(t, new RegExp(String(dados.cenario.melhor_alternativa_pct).replace('.', ',') + '%'));
});

test('plano: venda abaixo do custo no cenário e margem atual negativa', () => {
  assert.match(secao(planoDe({ custo: 70, novaComissao: 25 }), 'Recomendação').texto, /cada venda daria prejuízo/);
  const hoje = planoDe({ custo: 95, frete: 5 });
  assert.match(secao(hoje, 'Recomendação').texto, /Hoje cada venda já dá prejuízo/);
  assert.match(secao(hoje, 'Teste').texto, /corrija o preço ou o custo/);
});

test('plano: nunca escreve número com sinal de menos nem nomes de campo', () => {
  for (const parcial of [{}, { custo: 95 }, { novaComissao: 30 }, { novaComissao: 8 }, { fixos: 9000 }, { roas: 0 }]) {
    const txt = dec.planoTexto(planoDe(parcial, 'a; 50; 40; 5\nb; 100; 20; 2'));
    assert.doesNotMatch(txt, /-\s?\d/, JSON.stringify(parcial) + ': ' + txt);
    assert.doesNotMatch(txt, /\b[a-z]+_[a-z_]+\b|undefined|NaN|null/, JSON.stringify(parcial));
  }
});

test('plano: comissão menor permite vender menos e mantém o lucro', () => {
  assert.match(secao(planoDe({ novaComissao: 8 }), 'Recomendação').texto, /pode vender até [\d,]+% menos/);
});

test('plano: prejuízo do mês aparece como "prejuízo de", sem sinal', () => {
  const t = secao(planoDe({ fixos: 9000, novaComissao: 14 }), 'Risco').texto;
  assert.match(t, /prejuízo de R\$/);
});

test('plano: catálogo cita prioridades (P1, P2...) e usa nomes quando fornecidos', () => {
  const p = P();
  const cat = calc.parseCatalogo('Camiseta; 59,90; 22; 8; 12; 0; 0; Shopee\nFone; 129,90; 110; 15; 18; 0; 0; Mercado Livre', p);
  const a = calc.calcular(p, p.comissao), c = calc.cenario(p, a, p.novaComissao, p.crescimento);
  const dados = calc.montarDados(p, a, c, cat);
  assert.match(dec.planoTexto(dec.plano(dados)), /\bP2\b/);
  const nomes = { p: { 1: 'Camiseta', 2: 'Fone' }, l: { 1: 'Shopee', 2: 'Mercado Livre' } };
  const comNomes = secao(dec.plano(dados, nomes), 'Catálogo').texto;
  assert.match(comNomes, /Fone \((margem de|prejuízo de)/);
  assert.match(comNomes, /Mercado Livre|Shopee/);
});

test('plano: sem anúncios (ROAS 0) não inventa custo de anúncio', () => {
  const t = secao(planoDe({ roas: 0 }), 'Anúncios e frete').texto;
  assert.match(t, /Nenhum anúncio informado/);
});

test('plano: nível do risco reflete lucro pior sem crescimento', () => {
  assert.equal(secao(planoDe({ novaComissao: 20, crescimento: 5 }), 'Risco').nivel === 'ok', false);
  assert.equal(secao(planoDe({ novaComissao: 8 }), 'Risco').nivel, 'ok');
});
