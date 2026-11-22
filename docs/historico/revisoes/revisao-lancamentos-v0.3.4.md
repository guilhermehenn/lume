# Revisão de Lançamentos — v0.3.4

Escopo: a tela **Lançamentos**:

- lista do mês agrupada por dia;
- troca de mês;
- filtro por tipo;
- busca;
- totais;
- abertura de um lançamento para editar.

Do lado técnico, entram o código da tela, as regras de filtro e busca, a gravação de edições e exclusões feitas a partir dela, e a validação do que vai para o cofre.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **O filtro de tipo zerava os outros totais.** Ao escolher "Despesas", o "Entrou" passava a mostrar R$ 0,00, como se não tivesse entrado nada no mês. | Os totais mostram o mês (ou a busca) inteiro. O filtro de tipo só muda a lista, e os totais dos outros tipos ficam esmaecidos. |
| P2 | Não havia como ver "quanto gastei no Nubank" ou "em Mercado" no mês. | Filtros de **banco** e **categoria**. A lista de categorias acompanha o tipo escolhido: categoria de despesa sai ao trocar para Receitas. |
| P3 | Os filtros se perdiam ao recarregar, e outras telas não tinham como abrir a lista já filtrada. | Tudo fica no endereço da página (`?month=`, `?q=`, `?kind=`, `?bank=`, `?category=`). Recarregar, voltar e links mantêm a tela como estava. |
| P4 | A busca não achava pelo **valor** ("45,90") nem pelo emissor de um investimento. | Agora acha, inclusive "R$ 1.234,56" e "1,234.56". O texto da caixa diz o que a busca alcança. |
| P5 | A busca procura em **todos os meses**, mas a tela não dizia isso. Os totais continuavam rotulados como se fossem do mês, e dias de outro ano apareciam sem o ano. | Aparece "23 resultados em todos os meses". Os totais viram "Entrou (busca)" etc. Dias de outro ano mostram o ano. |
| P6 | **Meses grandes:** a lista parava em 600 lançamentos sem avisar, enquanto a contagem embaixo dizia 700. | Mostra 300 por vez, com **Mostrar mais (N restantes)**. |
| P7 | Lançamentos futuros não se distinguiam dos outros. | Dias rotulados como Hoje, Ontem e **Amanhã**, e uma marca "futuro" nos dias depois de hoje. |
| P8 | Busca sem resultado deixava a pessoa sem saída. | Botão **Limpar filtros**, ali e ao lado dos filtros. |
| P9 | Mantido de propósito | A busca continua valendo para todos os meses (normalmente se procura algo sem lembrar quando foi). A lista continua única: despesas, receitas e investimentos juntos. |

**Recomendado para depois (não feito agora):**

- **Seleção em lote:** excluir vários lançamentos ou trocar a categoria de vários de uma vez.
- **Exportar a lista filtrada** (CSV/Excel) direto daqui.
- Período maior que um mês na lista.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | Regras de filtro, totais e busca misturadas com a tela, sem como testar sem navegador. | `screens/transactions/`: a tela e `list.ts`, com as regras puras de mês, filtros, totais, agrupamento por dia e busca. 8 testes novos usam esse arquivo direto. |
| E2 | Para mostrar um mês, a tela **ordenava todos os lançamentos** e depois filtrava: 57 ms com 100 mil, a cada mudança. | `monthEntries` separa só o mês e ordena só ele: **1,6 ms**. |
| E3 | **Busca:** cada tecla normalizava o texto de todos os lançamentos (~150 ms por tecla com 100 mil). | Um índice com o texto já normalizado deixa cada tecla em **~5 ms**. A primeira tecla monta o índice (~0,25 s com 100 mil; ~25 ms com 10 mil). Depois de uma gravação, só o lançamento que mudou é normalizado de novo. Texto sem acento pula a parte cara da normalização. |
| E4 | O atalho **"/" vindo de outra tela** dependia de uma espera fixa de 60 ms. Num computador lento, a lista ainda não existia e a busca não recebia o foco. | O pedido de foco fica guardado até a lista aparecer. |
| E5 | A caixa de busca não acompanhava o endereço (voltar no navegador, link com `?q=`). | Acompanha. |
| E6 | Removido o que não era usado | Traduções sem uso (`transactions.inUseTitle`, `othersTitle` e `allMonths`, nos três idiomas). O contador de linhas alterado durante o desenho da lista (agora calculado uma vez por mudança). Caracteres de acento colados no código (ilegíveis no editor) trocados pela faixa Unicode escrita. `dayLabel` saiu da linha de lançamento e foi para a tela que o usa. |
| E7 | A troca de mês calculava "este mês" por conta própria e não acompanhava a virada do dia. | Recebe o mês de hoje da tela, que usa o mesmo relógio do Início. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | No celular, os três totais lado a lado cortavam os valores ("R$ 10…"). | No celular, uma linha por total, com o rótulo e o valor lado a lado. |
| D2 | No celular, "Investimentos" saía cortado no seletor de tipo. | Vira "Invest." no celular. |
| D3 | Os títulos dos dias eram `h3` sem nenhum `h2` antes: leitores de tela pulavam um nível. | Viraram `h2`. Cada dia é uma região com o nome do dia. |
| D4 | Não ficava claro quais filtros estavam ligados. | Filtro ligado ganha contorno azul, e "Limpar filtros" aparece enquanto houver algum. |
| D5 | Durante a busca, a troca de mês ficava apagada sem explicação. | "N resultados em todos os meses" ao lado dos filtros, com aviso para leitores de tela (`role=status`). |
| D6 | O texto da busca prometia menos do que ela faz. | "Buscar por nome, categoria, banco, observação ou valor". |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/transactions.spec.ts`, 7 testes):**
  - filtro de tipo sem zerar os outros totais;
  - banco e categoria no endereço, categoria saindo ao trocar o tipo, recarregar e "Limpar filtros";
  - busca sem acento por nome, observação, emissor, banco e valor, com o ano nos dias de outro ano e a troca de mês travada;
  - Hoje, Amanhã e a marca "futuro";
  - a caixa acompanhando o endereço;
  - **o que a tela soma é o que está gravado no cofre**, conferido lendo a API depois de excluir pela tela;
  - 700 lançamentos com "Mostrar mais";
  - endereço com valores inválidos (mês 13, tipo, banco e categoria que não existem);
  - "/" vindo do Início.
- **Regras (8 testes novos):**
  - leitura de valores (17 formatos);
  - normalização do texto;
  - mês com primeiro e último dia, na mesma ordem da lista completa;
  - totais (o rendimento não entra) e saldo do dia;
  - banco e categoria (categoria deixa os investimentos de fora);
  - busca por nome, observação, banco, emissor e valor;
  - desempenho com 100 mil;
  - backup com as regras do servidor.
- Os testes de Lançamentos, do Início, do Novo e dos fluxos principais rodaram também com o relógio em 1º de janeiro de 2027 e com 4 testes em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Totais zerados com filtro de tipo (P1). | Totais sem o filtro de tipo. |
| Q2 | Lista parando em 600 sem aviso (P6). | "Mostrar mais". |
| Q3 | "/" vindo de outra tela nem sempre focava a busca (E4). | Pedido de foco guardado. |
| Q4 | **Fragilidade da v0.3.2:** num computador lento, o segundo clique de um clique duplo em "Salvar e criar outro" chegava depois da pausa de 400 ms e tentava salvar o formulário recém-limpo, mostrando "Digite um valor maior que zero". Achado com o relógio fixo e a máquina carregada. | O segundo clique de um clique duplo é ignorado, por mais lento que o computador esteja. Ctrl/⌘ + Enter segurado também não repete. |
| Q5 | Busca em outro ano sem o ano no dia (P5). | Ano no rótulo. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **A data e hora de criação aceitava qualquer texto** de até 40 caracteres ("ontem"). Ela decide a ordem dos lançamentos do mesmo dia, e um texto qualquer embaralha essa ordem para sempre. | O servidor só aceita data e hora ISO 8601 válidas (como o navegador gera), e recusa "2026-02-30T10:00" ou "25:00". Ao restaurar um backup antigo com esse campo estragado, o front troca o valor por uma data neutra em vez de recusar o arquivo inteiro. |
| B2 | **Lote ambíguo:** um envio que gravava e excluía o mesmo lançamento, ou trazia duas versões dele, tinha um resultado que dependia da ordem interna de gravação. | Recusado com 422 e mensagem clara. Excluir o mesmo id duas vezes é inofensivo e vira uma exclusão só. O app nunca manda esses lotes (a fila junta tudo por registro), mas o servidor não depende disso. |
| B3 | O backup aceitava datas fora de 1900–2199, que o servidor recusa desde a v0.3.2. A restauração parecia dar certo e falhava depois, ao gravar. | Recusado na leitura do arquivo, com a mesma regra do servidor. |
| B4 | Conferências feitas, sem problema encontrado | **Datas são texto sem fuso:** os totais por mês calculados no arquivo batem com a tela, inclusive em 31/01, 29/02, 31/12, 1900 e 2199. **Editar não muda a posição** do lançamento (`ON CONFLICT DO UPDATE` mantém a linha). **Excluir 20 mil de 100 mil** de uma vez: 0,13 s. |
| B5 | Estrutura revisada | Lançamentos têm índices de data, banco e categoria. A lista filtra em memória porque o cofre é carregado inteiro na abertura. O índice de data não é usado por nenhuma consulta hoje; ele fica, porque é o que permite a carga por ano recomendada na revisão do Início. |

Testes de banco e servidor (`tests/test_transactions_db.py`, 19 testes):

- **Datas:** totais por mês no arquivo; ordem mantida ao editar.
- **Data e hora:** 5 formatos válidos e 7 inválidos.
- **Lotes:** gravar e excluir o mesmo id; duas versões no mesmo lote; excluir repetido ou inexistente; resposta 422 da API.
- **Volume:** excluir 20 mil de uma vez.

**Desempenho** (máquina de teste, 100 mil lançamentos):

| Operação | Antes | Agora |
|---|---|---|
| Montar um mês | 57 ms | 1,6 ms |
| Busca, por tecla | ~150 ms | ~5 ms (a primeira monta o índice: ~0,25 s) |
| Excluir 20 mil lançamentos de uma vez | — | 0,13 s |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 232 testes ok (eram 213) |
| Regras do front-end | 80 ok (eram 72) |
| Navegador | 54 ok (eram 47), estáveis em 2 rodadas seguidas com a versão final |
