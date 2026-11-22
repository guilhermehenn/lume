# Revisão de Investimentos — v0.3.5

Escopo: a tela **Investimentos**:

- totais (investido, rendimentos do ano, resultado);
- gráfico por tipo;
- carteira com as posições abertas e encerradas;
- painel de cada posição, com os atalhos de aplicação, resgate e rendimento e o histórico.

Do lado técnico, entram o cálculo da carteira (custo médio), os códigos do Imposto de Renda, o formulário de investimento, a validação do CNPJ e o que o servidor confere antes de gravar.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **A carteira contava operações com data futura.** Uma aplicação agendada para o mês que vem já aparecia como investida hoje. | A carteira vai até hoje. Embaixo do título aparece "1 operação com data futura ainda não entra na carteira." A operação entra sozinha no dia. |
| P2 | **Resgate de renda fixa acima do custo não mostrava ganho.** Um CDB aplicado em R$ 1.000 e resgatado em R$ 1.100 zerava o custo, e os R$ 100 sumiam. | O que passa do custo vira ganho realizado. O total passou a se chamar **"Resultado em vendas e resgates"**, também no relatório de investimentos. |
| P3 | **Vender mais cotas do que havia inflava o resultado.** O valor da venda inteira era comparado com o custo só das cotas que existiam. | Só a parte correspondente às cotas que existiam entra no resultado. No resgate, o formulário mostra **"Em carteira nessa data: 100"** e avisa quando a quantidade passa disso. |
| P4 | Posições encerradas mostravam "R$ 0,00" (o custo), o que não diz nada. | Mostram o **resultado**, com sinal e cor, e o selo "Encerrada". O botão diz "Mostrar 3 encerradas". |
| P5 | O gráfico por tipo só destacava a fatia ao passar o mouse; não servia para achar as posições de um tipo. | Clicar num tipo (ou Enter, pelo teclado) **filtra a carteira**. Um selo com o nome do tipo e um "×" tira o filtro. |
| P6 | **ETF de ações ou de cripto aparecia com o código "07 · ?"** do Imposto de Renda. | Código da tabela do IRPF 2026: **07.06** (ações e cripto) e 07.08 (renda fixa). Os outros códigos foram conferidos com a mesma tabela. |
| P7 | **CNPJ alfanumérico recusado.** Os CNPJs emitidos desde julho de 2026 podem ter letras, e o campo só aceitava números (no celular, abria o teclado numérico). | Aceita os dois formatos, com a mesma conta de verificação da Receita. Exemplo: `12.ABC.345/01DE-35`. |
| P8 | Taxas maiores que o valor da aplicação, e IR retido maior que o rendimento, eram aceitos e deixavam custo ou rendimento líquido negativos. | Recusados com mensagem no campo, no navegador e no servidor. |
| P9 | "Rendimentos em 2026" somava até 31/12 (inclusive rendimentos agendados), e o ano ficava fixo desde que a página abriu. | Soma de 1º de janeiro até hoje e acompanha a virada do ano. |
| P10 | Mantido de propósito | A carteira continua **pelo custo de aquisição**: é o que vai para a ficha Bens e Direitos. O valor de mercado fica para depois (abaixo). |

**Recomendado para depois (não feito agora):**

- **Valor atual:** informar à mão ou buscar cotações (B3, Tesouro, cripto) para mostrar a rentabilidade ao lado do custo.
- **Renda fixa sem nome:** agrupar por vencimento os CDBs e LCIs lançados sem nome, que hoje caem todos numa posição só por banco.
- **Exportar o histórico** de operações de um ativo (CSV), útil para o contador e para conferir com a nota de corretagem.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | A tela inteira e a linha de posição num arquivo de 266 linhas, com a regra de "posição aberta" repetida duas vezes. | `screens/investments/`: a tela (`Investments.tsx`) e a posição (`PositionRow.tsx`). `isOpenPosition` ficou em `selectors.ts`, uma vez só. Os atalhos copiam do ativo uma lista única de campos (`ASSET_FIELDS`), com teste. |
| E2 | O histórico da posição aberta era filtrado e ordenado entre todas as operações **a cada redesenho**, inclusive a cada passada do mouse no gráfico (1,3 ms com 20 mil operações, toda vez). | Calculado só quando a posição aberta ou o cofre mudam. Passar o mouse não refaz nada. Um mapa com o histórico de todas as posições foi testado e descartado (6,3 ms a cada gravação). |
| E3 | O nome com que o ativo é gravado ("Tesouro IPCA+ 2035", ticker em maiúsculas) era montado dentro da gravação, e o formulário não tinha como achar a posição antes de salvar. | `resolveAsset` separado. O formulário usa o mesmo nome para mostrar a quantidade em carteira (`heldQuantity`, que ignora a própria operação ao editar). |
| E4 | Quantidades eram arredondadas em 8 casas só na venda. Somas como 0,1 + 0,2 BTC deixavam resto (0,30000000000000004). | Arredondadas também ao somar. |
| E5 | O ano dos rendimentos vinha de `new Date()` lido uma vez. | Usa o mesmo relógio do Início e de Lançamentos (`useToday`). |
| E6 | `id` do painel da posição montado com a posição na lista; ao filtrar, o mesmo `id` passava para outra posição. | `useId()`. |
| E7 | Removido o que não era usado | Traduções sem uso (`investments.operations`, `averagePrice`, `quantity`, `cost`, `closed`, `showClosed` e `form.irpfNoCode`, nos três idiomas). O caso "código ?" do Imposto de Renda, que deixou de existir com o código do ETF. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | A legenda do gráfico só reagia ao mouse: pelo teclado ou com leitor de tela não havia como escolher um tipo. | Cada tipo é um botão (`aria-pressed`). O foco destaca a fatia, e Enter filtra. |
| D2 | **No celular, o cartão "Por tipo" saía da tela**: um nome longo na carteira alargava a coluna inteira. | A coluna fica na largura da tela, e os nomes longos são cortados com reticências. |
| D3 | Nome longo no meio do gráfico ("Fundos imobiliários (FII)") passava por cima do anel. Valores grandes também. | O nome quebra em até três linhas dentro do círculo, e valores longos usam letra menor. O gráfico cresceu de 190 para 200 px. |
| D4 | No painel da posição, "Resultado em vendas e resgates" quebrava a linha e desalinhava os três valores. | Os valores ficam alinhados no pé de cada quadro. |
| D5 | O selo "07 · 03" não dizia o que era. | Ao passar o mouse e para leitores de tela: "Imposto de Renda: Bens e Direitos, grupo 07, código 03". |
| D6 | "Mostrar posições encerradas (3)". | "Mostrar 3 encerradas" (e "Mostrar 1 encerrada"). |
| D7 | Com tudo encerrado, ou com um filtro sem posição aberta, a carteira ficava em branco. | "Nenhuma posição em carteira." |
| D8 | O campo de CNPJ não deixava digitar letras, e a mensagem de erro dizia "Confira os números". | O campo aceita letras (maiúsculas automáticas, sem corretor) e a mensagem diz "Confira letras e números". |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/investments.spec.ts`, 4 testes):**
  - carteira até hoje, com a aplicação agendada de fora e o aviso dela;
  - CDB resgatado acima do custo: ganho no total e posição encerrada com "+R$ 100,00";
  - filtro pelo gráfico com o mouse e pelo teclado, o selo que tira o filtro e o código 07.06 do ETF com o texto para leitores de tela;
  - resgate a partir da posição: ativo preenchido, quantidade em carteira, aviso de quantidade maior e o resultado depois de salvar (custo médio);
  - CNPJ alfanumérico digitado em minúsculas e formatado, e taxas maiores que o valor recusadas.
- **Regras (`tests/unit/investments.test.ts`, 13 testes):**
  - renda fixa com ganho no resgate; poupança;
  - custo médio em compras e vendas parciais;
  - venda de mais cotas do que havia, e venda sem nada em carteira;
  - dados antigos sem quantidade;
  - cripto (0,1 + 0,2 vendido em 0,3 fecha sem resto);
  - operação futura fora da carteira;
  - rendimentos e IR retido;
  - 20 mil operações em menos de 150 ms;
  - quantidade em carteira ao editar;
  - nome do ativo igual ao gravado;
  - atalhos copiando só os campos do ativo.
- CNPJ alfanumérico e o código do ETF nos testes de modelo e de cálculo que já existiam.
- Os testes de Investimentos, do Início, de Lançamentos e dos fluxos principais rodaram também com o relógio em 1º de janeiro de 2027. Os de Investimentos rodaram 6 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | **Valor errado em silêncio nos campos de dinheiro (vinha de versões anteriores, valia para todo o app).** Clicar num valor e apertar Ctrl+A (⌘A) logo em seguida às vezes não selecionava nada: o cursor era levado para o fim no quadro seguinte e desfazia a seleção. O número digitado ia para o fim do valor antigo: R$ 300,00 + "5000" virava **R$ 3.000.050,00**. Achado com o computador carregado. | Ctrl+A (⌘A) agora sempre seleciona o valor inteiro, e o que se digita depois o substitui. Vale para todos os campos de dinheiro (Novo, Lançamentos, Investimentos). |
| Q2 | Ganho do CDB perdido (P2), resultado inflado na venda (P3) e operação futura na carteira (P1). | Corrigidos no cálculo, com testes. |
| Q3 | Código "07 · ?" do ETF (P6). | Código do IRPF 2026. |
| Q4 | Cartão fora da tela no celular e nome sobre o anel do gráfico (D2, D3). | Corrigidos e conferidos em capturas de tela no computador e no celular. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **As regras dos investimentos só existiam no navegador.** O servidor gravava ação sem quantidade, rendimento com quantidade, preço ou taxas, IR retido numa aplicação, IR maior que o rendimento, taxas maiores que a aplicação, Tesouro sem título e CNPJ com dígito errado. | O servidor confere tudo isso antes de gravar e recusa com 422, dizendo a operação e o motivo ("investments[0]: CNPJ inválido"). |
| B2 | Regra nova não pode impedir de abrir o que já existe. | As regras valem para o que se grava a partir de agora (`POST /api/vault/changes`). Criar um cofre a partir de um backup antigo continua aceitando os dados como estão, com teste. |
| B3 | O nome do ativo aceitava só espaços ("   "), porque o tamanho mínimo contava os espaços. | Espaços das pontas saem antes de conferir: nome vazio é recusado; até 80 caracteres. |
| B4 | Dados antigos: cofres e backups de antes desta versão podem ter vendas de ações sem quantidade. | O cálculo trata essas vendas pelo valor, como na renda fixa, e a posição fecha. Teste com esse caso. |
| B5 | Conferências feitas, sem problema encontrado | **Quantidade** volta do arquivo exatamente como foi gravada, de 0,00000001 a 999.999.999,5. **Banco com investimentos** não pode ser excluído (chave estrangeira). **CNPJ** conferido no servidor com a mesma conta do navegador, nos dois formatos. |
| B6 | Estrutura revisada | Investimentos têm índices de data e banco; o de banco é o que a exclusão de banco usa. A carteira é calculada em memória, porque o cofre é carregado inteiro na abertura, então não há consulta por ativo que precise de índice. Tipo e operação não têm `CHECK` no arquivo, só a validação do servidor: no SQLite, isso exigiria reconstruir a tabela. Fica para a próxima migração de esquema. |

Testes de banco e servidor (`tests/test_investments_db.py`, 31 testes):

- **CNPJ:** válidos (numéricos e alfanuméricos, com e sem máscara) e inválidos.
- **Regras:** lote válido aceito; 8 combinações inconsistentes recusadas; IR maior que o rendimento.
- **Dados antigos:** cofre criado de backup antigo não é barrado.
- **Nome do ativo:** espaços das pontas.
- **Quantidade:** 5 valores voltando exatamente iguais.
- **Banco com investimentos** não sai.
- **Volume:** 20 mil operações gravadas e abertas.

**Desempenho** (máquina de teste, 20 mil operações):

| Operação | Antes | Agora |
|---|---|---|
| Calcular a carteira | 7,7 ms | 7,4 ms (só até hoje) |
| Histórico da posição aberta, a cada redesenho (por exemplo, passar o mouse no gráfico) | 1,3 ms | 0 ms (só quando a posição ou o cofre mudam) |
| Quantidade em carteira no formulário de resgate | — | 1,3 ms |
| Gravar 20 mil operações de uma vez (servidor, já com as regras novas) | — | 0,30 s |
| Abrir um cofre com 20 mil operações | — | 58 ms |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 263 testes ok (eram 232) |
| Regras do front-end | 93 ok (eram 80) |
| Navegador | 58 ok (eram 54), estáveis em 2 rodadas seguidas com a versão final |
