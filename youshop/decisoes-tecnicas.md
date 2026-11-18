# Margem Segura: decisões técnicas e como defendê-las

Documento de estudo para a banca do Desafio de Inovação YouShop. Cada item diz o que foi feito, por quê e qual é o limite. Onde algo ainda não foi feito, está escrito.

## 1. A ideia em uma frase
O vendedor muda a comissão ou o preço sem saber quanto precisa vender a mais para o lucro não cair. O Margem Segura calcula isso por regra e uma IA explica o resultado em linguagem simples.

## 2. Arquitetura
- **Site estático** (um HTML) que faz toda a conta no navegador.
- **Uma função serverless** (`/api/relatorio`, na Vercel) que recebe só números e chama a API da Claude para escrever a explicação.
- **Sem banco de dados e sem login.** O protótipo não guarda dados do usuário.

Por quê: o desafio pede um protótipo funcional em poucos dias. Esse desenho tem pouca coisa para quebrar e custo quase zero.

## 3. Decisões e justificativas

**3.1 A conta é por regra, não por IA**
- Margem de contribuição = preço − custo − frete − preço × (comissão + impostos + taxas).
- Lucro = margem × volume − custos fixos. Ponto de equilíbrio = custos fixos ÷ margem.
- Crescimento necessário = quanto o volume precisa subir na nova comissão para igualar o lucro de hoje.
- Por quê: dinheiro exige resultado exato e repetível. Um LLM pode errar conta ou dar respostas diferentes para a mesma entrada. É a mesma regra que usei no PetCore: regras primeiro, IA só onde linguagem natural ajuda.

**3.2 A IA só explica, mas entrega uma decisão**
- A regra calcula tudo e envia à IA os números, o veredito (`compensa` 1 ou 0), a melhor alternativa entre as comissões testadas e se cada venda dá prejuízo. A IA escreve três partes: **Recomendação**, **Risco** (e se a aposta de vendas não vier) e **Teste** (como validar em 30 dias ou com parte dos vendedores, com um critério de parada).
- Por quê: a primeira versão só repetia os números que a tela já mostrava, então não agregava nada. O valor da IA aqui é traduzir números em decisão e em plano de teste para quem não é de finanças, não calcular.

**3.3 A IA não prevê vendas**
- O aumento de vendas é uma aposta que o vendedor digita. O sistema mostra o mínimo necessário, mas não afirma que vai acontecer.
- Por quê: não há dados reais para estimar a reação das vendas a uma mudança de comissão. Inventar essa previsão seria enganar o usuário.

**3.4 O prompt é montado no servidor**
- O navegador envia só números. O servidor valida que cada campo é numérico e dentro de um limite, e escreve o texto do pedido.
- Por quê: se o navegador mandasse texto livre, qualquer pessoa usaria o endpoint como chat gratuito às custas do meu crédito, ou tentaria manipular o modelo (prompt injection).

**3.5 Chave de API no servidor**
- A chave fica como variável de ambiente na Vercel, nunca no código nem no navegador.
- Por quê: chave em página pública é roubada em minutos.

**3.6 Modelo: Claude Sonnet (testei o Haiku antes) e limites de custo**
- Comecei com o Haiku, por ser rápido e barato. Quando o relatório passou a recomendar e comparar opções, o Haiku errou em cada execução algo diferente: comparou números negativos ao contrário, disse que "cada venda dá prejuízo hoje" quando a margem era positiva, contradisse o veredito calculado. Troquei para o Sonnet e, nos mesmos 8 cenários, li todos os textos e não achei erro.
- Por quê: a tarefa é curta, mas exige seguir várias regras ao mesmo tempo, e o modelo menor não segurou. O custo por relatório continua baixo.
- O custo é controlado por limite de tokens por resposta e limite de 8 pedidos por IP a cada 10 minutos.

**3.7 Raciocínio interno desligado**
- Primeira versão: respostas vazias ou cortadas, porque o modelo gastava os tokens "pensando" antes de escrever. Achei pelo log do servidor, desliguei o raciocínio e aumentei o limite. No Sonnet o parâmetro é outro (`between_tools`), descoberto também pelo log.
- Por quê: para reformular números prontos, esse raciocínio não ajuda e custa tokens e tempo.

**3.9 Tudo que a IA poderia errar vem pronto da regra**
- Quando a IA comparava números por conta própria, errava (por exemplo, achava que −2.200 é melhor que −1.800). Por isso a regra passou a enviar já decidido: o veredito, a melhor alternativa, a variação do lucro (positiva = melhora), o volume mínimo e se a venda dá prejuízo.
- Por quê: o que é conta ou comparação fica na regra, que é exata. A IA só escolhe as palavras e monta a recomendação.

**3.8 Falhar sem quebrar**
- Se a IA não responder (sem crédito, erro, rede), a página mostra uma mensagem e a leitura por regra continua na tela.
- Por quê: a decisão do usuário não pode depender de um serviço externo.

**3.10 O valor não está no resumo: a regra compara caminhos e a IA decide e escreve**
- Feedback que recebi ao testar: um relatório que só resume a conta não justifica usar a ferramenta. Passei a calcular, por regra, três caminhos para a mesma mudança: (1) comissão maior em todas as vendas, (2) comissão maior **só sobre as vendas acima do volume de hoje** (comissão escalonada), (3) comissão maior com **aumento de preço** que mantém a margem por unidade. Calcula também a **comissão máxima** que ainda iguala o lucro de hoje com a aposta do vendedor.
- A IA escolhe um caminho, avalia o risco, propõe um teste de 30 dias com critério de parada e escreve uma **mensagem pronta** para propor a mudança ao parceiro (afiliado, representante ou marketplace).
- Por quê: o vendedor sozinho não calcula a escalonada nem a comissão máxima, e a mensagem é um material que ele usa de fato na conversa. A escalonada é o caminho que mais reduz o risco: se as vendas não passarem do volume de hoje, nada muda.
- A mensagem nunca revela lucro, prejuízo ou margem do negócio ao parceiro (regra no prompt e checagem no script).

## 4. Como a IA "avalia" (perguntas prováveis)

**"Como a IA chega à conclusão?"**
Ela não chega: a conclusão (compensa ou não, quanto vender a mais) vem da regra. A IA recebe esse resultado e o reescreve. Isso responde também a "e se ela alucinar": o risco fica restrito ao texto, e o texto é limitado a usar só os números enviados.

**"Como vocês sabem que a explicação da IA está certa?"**
Fiz uma avaliação com 8 cenários fixos (lucro sobe, lucro cai, venda abaixo do custo, margem já negativa, comissão menor, margem baixa, loja pequena, aposta zero). O script está em `margem-segura/tests/avaliacao-ia.mjs` e roda contra o site publicado. Ele confere duas coisas e eu leio todos os textos:
1. **Números fora dos dados:** extrai os números do texto e aponta os que não existem nos dados enviados.
2. **Veredito:** confere se o texto concorda com a regra (heurística por palavras).
3. **Leitura humana de cada texto**, refazendo a conta à mão.

Resultado da avaliação (18/11/2026):
- **1ª rodada:** o checador automático passou 8 de 8, mas a leitura humana achou 1 erro. No cenário base a IA disse "se as vendas ficarem iguais, o lucro cai para R$ 800". O certo era R$ 400. O R$ 800 existia nos dados, só foi usado no lugar errado, então o checador de números não pegou.
- **Causa:** a IA precisou calcular um valor que a regra não entregou (lucro com a nova comissão e vendas iguais).
- **Correção:** a regra passou a enviar esse valor (`lucro_mes_sem_crescimento`) e o prompt manda a IA usá-lo.
- **2ª rodada (depois da correção):** nos 8 cenários os valores citados conferem com a conta feita à mão. O checador marcou 2 casos, e os dois eram alarmes falsos: uma subtração correta feita pela IA (1.200 − 800 = 400) e o filtro de palavras que não entendeu um texto correto.
- **Também corrigi no site:** quando o cenário melhora o lucro mas o mês continua no prejuízo (cenário 6), o cartão não fica mais verde. Ele diz "Melhora, mas o mês continua no prejuízo".

**Depois (18/11/2026): o relatório foi reescrito e avaliado de novo.** Ao testar o site, vi que o relatório só repetia o que a tela já mostra. Reescrevi para dar Recomendação, Risco e Teste. A cada rodada de 8 cenários li todos os textos e refiz as contas à mão. O que apareceu:
- **Vazamento de nomes internos** (`compensa (valor 1)`): proibido no prompt e checado pelo script.
- **Volume mínimo errado** quando a comissão era menor: eu cortava o crescimento mínimo em zero, e a IA mandava "pare se vender menos de 100" quando o certo era 91. Passei a enviar o valor sem corte.
- **Comparação de números negativos ao contrário**, mais de uma vez (achar −2.200 melhor que −1.800; dizer que −310 é pior que −500; contradizer o veredito). Passei a enviar o veredito, a melhor alternativa e a variação do lucro já calculados.
- **"Cada venda já dá prejuízo hoje" dito sem base**, confundindo mês no prejuízo com venda no prejuízo. Passei a enviar esse fato como campo e o script passou a checar.
- **O Haiku errou algo diferente a cada execução**, mesmo com essas travas. Com o Sonnet, nos 8 cenários o script passou 8 de 8 e eu não achei erro na leitura.
- O script agora checa automaticamente: números fora dos dados, veredito contra a regra, nome de campo vazado, prejuízo por venda sem base e se o texto cita a melhor alternativa calculada.

Limites desta avaliação: são só 8 cenários, escolhidos por mim, e a IA pode variar de uma chamada para outra. A última rodada passou limpa, mas não prova que nunca erra: o mesmo prompt no modelo menor errou em rodadas seguidas. A leitura humana de cada texto continua sendo parte do método, porque o script não pega todo tipo de erro.

**Avaliação humana ainda pendente:** pedir aos entrevistados que leiam o relatório e digam se entenderam e se faz sentido para o negócio deles.

**"E se o usuário digitar valores errados?"**
O resultado acompanha o que foi digitado. Há tratamento para casos extremos (margem negativa, comissão que zera a margem) e avisos quando a margem fica abaixo de 15%. Não há validação contra a realidade do negócio.

## 5. Como classificamos se deu certo

Duas camadas, uma do produto e uma da IA. Os limites abaixo são propostas minhas, não valores já validados.

**Produto (validado nas entrevistas):**
- Quantos entrevistados não sabiam a margem real por venda antes (a dor existe).
- Quantos entenderam o veredito do simulador sem ajuda.
- Quantos dizem que usariam e a faixa de preço que citaram.
- Proposta de sucesso do protótipo: a maioria dos entrevistados entender o veredito sozinha e pelo menos metade dizer que usaria.

**Produto em uso real (futuro):**
- Cenários simulados por usuário e por semana.
- Quantos usuários mudam de fato a comissão ou o preço depois de simular, e o que aconteceu com a margem real deles.

**IA:**
- Taxa de relatórios sem número inventado (meta: 100%).
- Taxa de relatórios cujo veredito bate com a regra (meta: 100%).
- Taxa de falha da API e tempo de resposta.
- Custo por relatório.

## 6. Limitações que devo admitir
- **Modelo linear:** assume preço, custo e custos fixos constantes ao mudar o volume. Na vida real há degraus de custo.
- **Sem previsão de demanda:** o aumento de vendas é palpite do usuário.
- **A comissão escalonada depende de o parceiro aceitar.** O simulador mostra o ganho, mas não sabe se o marketplace ou afiliado oferece esse formato. Preciso confirmar isso nas entrevistas.
- **O caminho do preço não prevê a reação da demanda.** Ele mostra o preço que mantém a margem, mas não quanto as vendas caem se o preço sobe.
- **Uma única linha de produto por simulação.** Vendedor com muitos produtos precisa simular um de cada vez.
- **Limite de uso fraco:** a contagem por IP fica na memória de cada instância da função e pode ser contornada. Em produção usaria um banco ou serviço de limite de taxa.
- **Sem dados reais de usuários ainda.** A evidência de mercado vem das entrevistas que estou fazendo.
- **Avaliação da IA pequena:** 8 cenários e leitura feita por mim. Falta a avaliação por usuários reais.

## 7. Próximos passos
1. Ampliar os casos de teste (mais cenários, rodar várias vezes cada um) e fazer a IA citar só valores que já vêm prontos da regra, inclusive diferenças.
2. Entrada em lote: subir a planilha de produtos e mostrar quais têm margem insegura.
3. Salvar cenários e histórico por usuário (login, banco).
4. Calibrar a previsão de vendas com dados reais de quem aceitar compartilhar.

## 8. Respostas curtas para decorar
- **Por que não usar só IA?** Porque dinheiro exige conta exata. A IA explica, a regra decide.
- **Por que o modelo não sabe o futuro?** Não existe dado para isso. Ele só explica os números, a aposta de vendas é do vendedor.
- **O que você faria diferente?** Mediria a qualidade da IA com casos fixos desde o primeiro dia. Quando medi, achei um erro que o checador automático não pegou e corrigi.
- **O que deu errado no caminho?** Respostas vazias por causa do raciocínio interno do modelo. Achei pelo log e corrigi.
- **Como saber se funcionou?** Entrevistados entenderem sozinhos o veredito, dizerem que usariam e, depois, mudarem a comissão com base na simulação.
