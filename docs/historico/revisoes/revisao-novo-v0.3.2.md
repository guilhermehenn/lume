# Revisão do "Novo" (lançamento) — v0.3.2

Escopo: a folha que abre pelo botão **Novo**, pelo atalho **N** ou ao clicar num lançamento.
Ela cobre despesa, receita e investimento, novos ou em edição. Do lado técnico, entram o código
da folha, a gravação no cofre e o banco por trás disso.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | Lançar várias despesas seguidas (o extrato do fim de semana, a feira) obrigava a abrir o Novo de novo a cada uma e escolher banco e data outra vez. | **Salvar e criar outro.** Mantém tipo, banco e data, limpa o resto e volta o foco para o valor. Atalho **Ctrl/⌘ + Shift + Enter**. |
| P2 | Um lançamento salvo errado só podia ser corrigido abrindo e editando, ou excluindo. | **Desfazer** no aviso de toda gravação. Um lançamento novo some; uma edição volta aos valores de antes. |
| P3 | Esc, clique fora ou Cancelar fechavam a folha e o que tinha sido digitado se perdia sem aviso. | **"Descartar este lançamento?"** aparece só quando há algo preenchido. Trocar só o tipo num formulário vazio não conta. Na edição, só pergunta se algo mudou. |
| P4 | A maioria dos lançamentos é de hoje ou de ontem, mas "ontem" exigia abrir o calendário. | Atalhos **Hoje** e **Ontem** ao lado da data. Data no futuro mostra um aviso, sem bloquear (agendar é legítimo). |
| P5 | Sem banco cadastrado (ou sem categoria do tipo), o formulário abria normalmente e só falhava ao salvar. | A folha explica o que falta, com um botão **Cadastrar banco** ou **Cadastrar categoria** que leva à tela certa. O outro tipo continua lançando. |
| P6 | O nome conhecido em "Pago a" preenchia só a categoria. | Preenche também a **forma de pagamento** do último lançamento com esse nome. Nunca passa por cima do que a pessoa escolheu à mão. |
| P7 | Mantido de propósito | O valor primeiro e grande. Investimento no mesmo "Novo". Uma edição não vira investimento (são registros diferentes). |

**Recomendado para a v0.4 (não feito agora):**

- **Transferência entre os próprios bancos.** Hoje vira uma despesa mais uma receita, o que infla "Entrou" e "Saiu" nos relatórios. Precisa de mudança no arquivo do cofre (um grupo que liga as duas pernas). Por isso deve vir junto com a próxima migração do banco (veja B8).
- **Compra parcelada** e **lançamento recorrente** (aluguel, assinaturas).

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | `EntrySheet.tsx` com 695 linhas fazendo tudo. Início, Relatórios e Categorias importavam dele as opções de banco e categoria. | Dividido em `screens/entry/`: `EntrySheet` (folha e regras), `TransactionFields`, `InvestmentFields`, `EntryDateRow`, `investmentForm` (estado e conversão do investimento, testável sem navegador) e `options`. |
| E2 | **Lançamento duplicado.** Clique duplo em Salvar, Enter repetido ou Ctrl+Enter durante a animação de saída gravavam o mesmo lançamento duas vezes: a folha continua montada por 300 ms depois de fechar. | Trava síncrona (`useRef`) em todo envio. Depois de "Salvar e criar outro", uma pausa de 400 ms evita que o segundo clique tente salvar o formulário já limpo. |
| E3 | O total do investimento (quantidade × preço) era copiado para o valor por um `useEffect`. Isso custava uma renderização a mais e mostrava um quadro com o valor antigo. | Calculado no próprio campo que muda, na mesma renderização. |
| E4 | "Pago a": a cada tecla, `lastCategoryFor` percorria todos os lançamentos, e as sugestões faziam outra passada. | `counterpartyMemory`: **uma** passada por mudança na lista, e a consulta é por mapa. Com 20 mil lançamentos, digitar um nome de 27 letras custava 17 ms em buscas; agora custa 0,06 ms, depois de uma montagem de 11 ms (que já existia para as sugestões). |
| E5 | `defaultInvestmentBank` copiava e ordenava todos os investimentos a cada abertura. | Uma passada só. |
| E6 | Removido o que não era usado ou foi substituído | `counterpartySuggestions` e `lastCategoryFor` (viraram `counterpartyMemory`). O `onPick` do `Autocomplete` (o `onChange` já recebe a escolha). O `return null` para lançamento sumido, que fazia a folha desaparecer sem animação. |
| E7 | O front aceitava qualquer data válida (ano 0001, ano 9999). O servidor recusava depois, na sincronização, e o erro aparecia genérico e longe do campo. | `isEntryDate`, com os mesmos anos do servidor (1900–2199). O erro aparece no campo de data. |
| E8 | Um lançamento excluído em outra aba enquanto estava aberto aqui. | Avisa "não existe mais" e fecha. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | Com uma folha aberta, os avisos ficavam **inertes**: o Headless UI desativa o resto do app, inclusive o botão "Desfazer". Também ficavam ocultos para leitores de tela. | Os avisos ficam num portal direto no `<body>`, fora da área desativada. Com uma folha aberta, vão para o canto esquerdo, para não cobrir os botões do rodapé. No celular, aparecem no topo. |
| D2 | Erro de validação deixava o foco no botão Salvar. | O foco vai para o **primeiro campo com problema**: valor, "Pago a", categoria, data… |
| D3 | A dica "Ctrl/⌘ + Enter" mostrava as duas teclas. | Mostra a do sistema: **⌘ + Enter** no Mac, **Ctrl + Enter** no Windows. O botão "Salvar e criar outro" explica o próprio atalho ao passar o mouse. |
| D4 | O seletor de banco não ficava vermelho quando faltava. | Marca o erro como os outros campos. |
| D5 | Erro de data genérico. | "Escolha uma data válida, entre 1900 e 2199." O vencimento do investimento ganhou mensagem própria. |
| D6 | No celular, o rodapé ficava apertado com três botões. | "Cancelar" sai no celular, porque o **X** do topo já fecha. |
| D7 | Data no futuro passava sem nenhuma pista. | Aviso em laranja: "Data no futuro. Confira se é isso mesmo." |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/entry.spec.ts`, 11 testes):**
  - salvar e criar outro: banco e data mantidos, o resto limpo, foco no valor, o atalho, e tudo gravado no cofre depois de recarregar;
  - envio único: clique duplo, Enter repetido com Ctrl+Enter e clique duplo em "criar outro" geram um lançamento cada, também depois de recarregar;
  - descartar: vazio fecha direto; preenchido pergunta; "Continuar editando" preserva o valor; na edição só pergunta se mudou;
  - desfazer: o novo some (também no cofre, depois de recarregar); a edição volta aos valores de antes; desfazer com a folha ainda aberta não a fecha e devolve o foco ao valor;
  - nome lembrado: categoria e forma de pagamento preenchidas, sem passar por cima da escolha manual; receita não usa o que foi lembrado de despesas;
  - foco no primeiro campo com problema;
  - datas: Hoje/Ontem, aviso de futuro, ano 2300 recusado com o foco na data;
  - N abre o último tipo usado; trocar o tipo tira a categoria que não serve (e investimento não a apaga);
  - sem banco e sem categoria do tipo: explicação e botão para o cadastro;
  - N logo depois de salvar: o que se digita cai no valor.
- **Regras (9 testes novos):** total do investimento (aplicação, resgate, fração de cota), instituição padrão, conversão para gravar, edição e resgate a partir da carteira, nome lembrado (data, empate pela criação, maiúsculas, limite, 10 mil lançamentos), `addDays` (virada de ano, fevereiro bissexto, antigo horário de verão) e `isEntryDate`.
- Os testes de lançamento rodaram também com o relógio em **1º de janeiro de 2027**, quando "Ontem" cai no ano anterior.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Lançamento duplicado por clique duplo ou Enter (E2). | Trava de envio. |
| Q2 | "Desfazer" não respondia com a folha aberta (D1). | Avisos fora da área desativada. |
| Q3 | **N logo depois de salvar:** com a folha anterior ainda saindo, o foco ia para o painel e os números digitados se perdiam. Às vezes o N nem abria, porque o foco ainda estava num campo da folha que saía. | Foco inicial explícito no valor. Os atalhos ignoram campos de uma folha que está fechando. |
| Q4 | Pelo atalho Ctrl+Shift+Enter, "Pago a" continuava mostrando o nome anterior: a caixa de sugestões guarda o próprio texto. | Os campos são remontados limpos a cada "criar outro". |
| Q5 | Trocar para Investimento num formulário vazio pedia confirmação ao fechar. | "Tem algo preenchido" compara só os campos visíveis do tipo escolhido. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Toda gravação conferia o cofre inteiro** (`foreign_key_check` e a junção de categorias). Com 100 mil lançamentos, salvar 1 custava 17,7 ms, e o custo crescia com o cofre. | Lotes de até 500 mudanças conferem só as linhas tocadas, usando os índices que já existem: **1,5 ms** com 100 mil lançamentos. Lotes maiores (importação, restauração) conferem tudo: 5 mil lançamentos em 0,08 s. |
| B2 | Se o `COMMIT` falhasse (chave estrangeira adiada), a transação ficava aberta e o erro virava 500. | `ROLLBACK` garantido. O erro vira 422, "dados inconsistentes", e nada fica pela metade. |
| B3 | O servidor aceitava qualquer data válida (ano 0001, ano 9999), o que quebra a ordenação, os meses dos relatórios e o Excel. | Datas de **1900 a 2199**, a mesma regra do front. |
| B4 | "Pago a" só com espaços passava no servidor. | É aparado; vazio é recusado. |
| B5 | Forma de pagamento numa receita era aceita. | Recusada: só vale para despesa. |
| B6 | Excluir um banco que ainda tem lançamentos dava um erro genérico. | Mensagem clara. Mover os lançamentos e excluir o banco **no mesmo lote** continua valendo. |
| B7 | Estrutura revisada | Os índices de data, banco e categoria cobrem as consultas da folha e as novas conferências. `CHECK` em tipo e valor. Chaves UUID. Nada a mudar agora. |

Testes de banco (`tests/test_entries_db.py`, 23 testes):

- **Campos:** valores (zero, negativo, decimal, texto), datas (fora dos anos aceitos, 30 de fevereiro, formatos errados), "Pago a" e observação; texto com SQL, emojis e acentos gravado igual.
- **Referências:** cada tipo de referência quebrada é pego (banco ou categoria inexistente, categoria de outro tipo, banco ou categoria excluídos ainda em uso). Mover lançamentos e excluir o banco no mesmo lote passa.
- **Última barreira:** mesmo com a conferência desligada, o `COMMIT` recusa e desfaz tudo.
- **Repetição e concorrência:** gravar o mesmo lançamento duas vezes não duplica; duas abas lançando ao mesmo tempo, com conflito e nova tentativa, não perdem nada.
- **Desempenho:** gravar 1 não depende do tamanho do cofre.

**Desempenho** (máquina de teste, cofre com 100 mil lançamentos):

| Operação | Antes | Agora |
|---|---|---|
| Gravar 1 lançamento | 17,7 ms | 1,5 ms |
| Gravar 5 mil de uma vez | — | 0,08 s |

**Recomendações para depois (não feitas agora):**

- **B8.** Levar para o próprio esquema as regras que hoje estão no app e no servidor: formato e faixa da data, lista de formas de pagamento, tamanho do "Pago a", e tabelas `STRICT`. Isso exige reconstruir as tabelas. O ideal é fazer junto com a migração da transferência (P7), que já vai mexer no arquivo do cofre.

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 188 testes ok (eram 165) |
| Regras do front-end | 64 ok (eram 55) |
| Navegador | 37 ok (eram 26), estáveis em 3 rodadas seguidas e também com o relógio em 1º de janeiro de 2027 |
