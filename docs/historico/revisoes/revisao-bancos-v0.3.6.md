# Revisão de Bancos — v0.3.6

Escopo: a tela **Bancos**:

- saldo de hoje (e o previsto);
- lista de bancos, com o principal;
- busca;
- cadastro e edição;
- exclusão, com os lançamentos indo para outro banco.

Do lado técnico, entram o modelo de banco, a contagem de uso, a exclusão e o que ela manda gravar, o backup e o que o servidor confere antes de gravar.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **Excluir um banco com lançamentos fazia o saldo total cair.** Os lançamentos iam para o outro banco, mas o saldo inicial sumia: juntar o Nubank (saldo inicial de R$ 4.500) ao Itaú baixava o total em R$ 4.500. | A exclusão virou uma **junção**: o saldo inicial vai junto, e o saldo total não muda. O diálogo diz isso antes de confirmar: "O saldo inicial (R$ 4.500,00) vai junto." |
| P2 | Excluir o banco principal deixava o app sem principal. Os novos lançamentos passavam a vir com o primeiro banco da lista (Banco do Brasil, do catálogo), não com o que recebeu o dinheiro. | O banco escolhido passa a ser o principal, e o diálogo avisa: "Itaú passa a ser o principal." |
| P3 | Relatórios salvos que filtravam só o banco excluído perdiam o filtro e passavam a mostrar **todos os bancos**. | Passam a filtrar o banco de destino, para onde foram os lançamentos. |
| P4 | **Nomes repetidos eram aceitos** ("Nubank" e "nubank"): dois bancos iguais nos filtros e no formulário de lançamento, sem como saber qual é qual. | Recusado sem diferença de acento ou maiúsculas ("Itau" = "Itaú"), na tela e no servidor. |
| P5 | Os 15 bancos do catálogo sem uso ocupavam a maior parte da tela, cada um com "R$ 0,00". | Ficam recolhidos em "Mostrar 15 bancos sem uso". A busca procura em todos. |
| P6 | Não havia caminho do banco para os lançamentos dele. | **"Ver lançamentos"** no menu do banco abre Lançamentos já filtrado. |
| P7 | Excluir o único banco com lançamentos pedia um destino que não existia: botão desabilitado, sem explicação. | O diálogo explica que é preciso criar outro banco antes. |
| P8 | Excluir um banco sem lançamentos, mas com saldo inicial, tirava esse valor do total sem avisar. | Aviso no diálogo: "O saldo inicial de R$ 70,00 deixa de contar no saldo total." |
| P9 | Depois de excluir, o aviso dizia só "Banco excluído". | "Nubank excluído. 109 lançamentos foram para Itaú.", com Desfazer. O destino já vem sugerido (o principal, quando não é o banco que sai). |
| P10 | Mantido de propósito | O saldo continua **calculado** pelos lançamentos, sem edição direta, e o saldo inicial continua sem data. |

**Recomendado para depois (não feito agora):**

- **Conferir com o extrato:** informar o saldo que o app do banco mostra e ver a diferença, com atalho para lançar o ajuste.
- **Cartão de crédito** como tipo de conta, com fatura, fechamento e vencimento.
- **Saldo inicial com data**, para quem começa a usar o Lume no meio do mês.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | Tela, linha, formulário e diálogo de exclusão num arquivo de 362 linhas. | `screens/banks/`: `Banks.tsx` (tela e linha), `BankSheet.tsx`, `DeleteBankDialog.tsx` e `list.ts`, com busca, ordem e separação entre em uso e sem uso, testáveis sem navegador. |
| E2 | A busca usava `toLowerCase().includes`: "itau" não achava "Itaú". | A normalização sem acento saiu de `screens/transactions/list.ts` para `lib/text.ts` e é usada por Lançamentos, Bancos e pela regra de nome repetido. |
| E3 | A lista de tipos de banco existia duas vezes (tela e modelo). | `BANK_KINDS` exportado do modelo. |
| E4 | Para contar o uso, a tela montava uma cópia com todos os lançamentos e operações. O diálogo de exclusão contava de novo, com duas filtragens, a cada redesenho. | `bankUsageCounts`, numa passada e sem cópia. O diálogo recebe a conta da tela. |
| E5 | As seções eram montadas com condições encadeadas (`others.length && used.length ? …`), e a regra "em uso" rodava duas vezes por banco. | `splitByUse`, numa passada. |
| E6 | A exclusão recriava todos os relatórios salvos, mesmo os que não filtravam o banco. Os lançamentos movidos não registravam a alteração (`updatedAt`). | Só o que muda é recriado. Lançamentos movidos e o banco de destino registram a alteração. |
| E7 | Ordem por nome com `localeCompare` sem regra. | `Intl.Collator` sem diferença de maiúsculas e com números ("Banco 2" antes de "Banco 10"). |
| E8 | O foco inicial da folha usava `autoFocus`, que falha quando a folha anterior ainda está fechando. | `initialFocus` da folha, como no Novo. |
| E9 | Removido o que não era usado | Traduções sem uso (`banks.balance`, e `banks.othersTitle`, que deu lugar a "Sem uso", nos três idiomas). O avatar repetido no cabeçalho da folha (D3). |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | **No celular, o selo "Principal" escondia o nome do banco ("N…")**, e a segunda linha cortava justamente o número de lançamentos. | No celular, só a estrela (o texto continua para leitores de tela), e a segunda linha mostra só o uso. Tipo e código aparecem a partir do tablet. |
| D2 | O código COMPE aparecia solto na linha ("· 260"). | "Cód. 260", no fim da linha. |
| D3 | A folha mostrava o avatar do banco duas vezes (no cabeçalho e no topo). | Só o grande, no topo. |
| D4 | Fechar a folha com algo digitado perdia tudo sem perguntar. | "Descartar este banco?" (ou "Descartar as alterações?"), com "Continuar editando", como no Novo. |
| D5 | Digitar "1" no código deixava "1". Para "Dinheiro em espécie", o campo de código não fazia sentido. | Completa para "001" ao sair do campo. O tipo "Dinheiro em espécie" esconde o campo. |
| D6 | Nome repetido só aparecia como problema depois, nos filtros. | Mensagem no campo ("Já existe um banco com esse nome."), com o foco de volta no nome. |
| D7 | Busca sem resultado deixava a pessoa sem saída; o cofre sem bancos não tinha atalho para criar um. | Botão **Limpar busca**; no cofre vazio, **Novo banco** ali mesmo. |
| D8 | O diálogo de exclusão não dizia o que aconteceria com o saldo inicial e com o principal. | Lista o que vai acontecer antes de confirmar. Os destinos aparecem em ordem alfabética. |
| D9 | Acessibilidade | Seções com título para leitores de tela; o botão que mostra os bancos sem uso diz se está aberto (`aria-expanded`). |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/banks.spec.ts`, 7 testes):**
  - bancos sem uso recolhidos e abertos;
  - busca sem acento e pelo código;
  - "Limpar busca";
  - nome repetido com o foco de volta no campo;
  - código "1" virando "001";
  - "Dinheiro em espécie" sem código;
  - descartar com "Continuar editando";
  - exclusão do principal: o que o diálogo avisa, botão travado até escolher, aviso final, saldo total igual, o que ficou gravado no cofre (lido pela API) e Desfazer;
  - banco sem lançamentos com saldo inicial;
  - "Ver lançamentos";
  - celular: nome e uso sem corte e sem rolagem para o lado;
  - único banco com lançamentos.
- O teste de Bancos que já existia passou a conferir o destino sugerido e o novo aviso.
- **Regras (`tests/unit/banks.test.ts`, 11 testes):**
  - código COMPE;
  - nome repetido (com acento, maiúsculas, espaços e acento combinado);
  - limite de bancos;
  - junção com o saldo total igual, destino com saldo inicial e principal;
  - o que muda e o que fica igual (lançamentos não movidos continuam o mesmo objeto);
  - relatórios salvos;
  - exatamente o que vai para o servidor (7 mudanças);
  - exclusão sem lançamentos;
  - teto do saldo inicial na junção;
  - 20 mil lançamentos movidos;
  - busca e ordem;
  - o que conta como "em uso";
  - backup com as regras do servidor.
- Os testes de Bancos, do Início, dos fluxos principais e das outras telas rodaram também com o relógio em 1º de janeiro de 2027. Os de Bancos rodaram 5 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Saldo total caindo na exclusão com junção (P1) e relatório salvo passando a mostrar todos os bancos (P3). | Junção completa, com testes de saldo calculado na tela, no modelo e no arquivo do cofre. |
| Q2 | **O backup aceitava o que o servidor recusa:** código com letras ("abc") e nome só de espaços. A restauração parecia dar certo e falhava depois, ao gravar. | Recusado na leitura do arquivo, com a mesma regra do servidor. |
| Q3 | Nome e uso cortados no celular (D1). | Corrigido e conferido no teste (o texto não pode ser maior que o espaço). |
| Q4 | Dois testes antigos do servidor criavam dois bancos com o mesmo nome. | Ajustados à regra nova. |
| Q5 | Observação | O teste de entrada no cofre (senha errada) falhou uma vez numa rodada com um servidor extra ligado, que deixava a máquina mais carregada. Passou 4 vezes seguidas sozinho e em todas as rodadas completas seguintes. Não tem relação com Bancos. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Sem teto ao gravar.** O backup aceita até 500 bancos (e 500 categorias, 200 mil lançamentos, 100 mil operações, 200 relatórios), mas a gravação não tinha limite. Um cofre com 501 bancos funcionava normalmente, e o backup dele **não podia ser restaurado**. | Os mesmos tetos ao gravar (`MAX_ITEMS`, usado também pelo modelo do backup; um teste confere que os dois batem). A tela avisa ao chegar no limite. Custo: 0,2 a 0,4 ms com 200 mil lançamentos, porque a contagem usa um índice. |
| B2 | Nome de banco só com espaços era aceito pelo servidor (o tamanho mínimo contava os espaços). | Espaços das pontas saem antes de conferir; nome vazio é recusado. |
| B3 | O servidor aceitava código "1", "12" ou vazio. | Gravações novas exigem 3 dígitos (`bank_rules`). Cofres antigos com código curto continuam abrindo. |
| B4 | Nomes repetidos | Regra no servidor, comparada com o que já está gravado (`bank_key`, a mesma normalização do navegador). Bancos excluídos no mesmo lote não contam, e trocar os nomes de dois bancos numa gravação só vale. Repetidos vindos de versões anteriores continuam editáveis sem trocar o nome; o que a regra barra são nomes novos. |
| B5 | **A junção precisa ser tudo ou nada.** | Exclusão, lançamentos movidos e banco de destino vão numa transação só. Faltando um lançamento, a gravação inteira é recusada e nada muda (nem o saldo inicial do destino). Como as exclusões vêm antes, o destino vira principal no mesmo lote sem bater no índice de principal único. |
| B6 | Conferências feitas, sem problema encontrado | **Saldo total calculado direto no arquivo** igual antes e depois da junção. Categoria de outro tipo continua barrada nos lançamentos movidos. **20 mil lançamentos movidos** numa gravação: 0,32 s. |
| B7 | Estrutura revisada | Não há índice por nome nem regra de nome único no arquivo: a tabela tem no máximo 500 linhas (lidas inteiras na conferência, em microssegundos), e a comparação sem acento não existe no SQLite (`NOCASE` só cobre letras sem acento). Um índice único também travaria cofres antigos com nomes repetidos. Tipo e código continuam sem `CHECK`, só com a validação do servidor: no SQLite, isso exigiria reconstruir a tabela. Fica para a próxima migração de esquema, como já recomendado na revisão de Investimentos. |

Testes de banco e servidor (`tests/test_banks_db.py`, 27 testes):

- **Nome:** espaços das pontas; nome vazio.
- **Código:** 5 formatos recusados e 3 aceitos; cofre antigo com código curto.
- **Nomes repetidos:** 5 grafias do mesmo nome recusadas; espaço no meio faz outro nome; repetição no mesmo lote; renomear para o de outro banco; trocar os nomes de dois bancos; excluir e criar com o mesmo nome; cofre antigo com repetidos; mesma normalização do navegador.
- **Limites:** 500 bancos e o 501º recusado; tetos iguais aos do backup.
- **Junção:** principal movido com saldo total igual no arquivo; junção pela metade recusada inteira; 20 mil lançamentos; categoria conferida nos movidos.

**Desempenho** (máquina de teste):

| Operação | Antes | Agora |
|---|---|---|
| Contar o uso dos bancos (100 mil lançamentos + 20 mil operações) | 3,2 ms | 2,9 ms |
| Diálogo de exclusão aberto, a cada redesenho | 1,8 ms (contava de novo) | 0 ms (recebe a conta da tela) |
| Excluir um banco com 20 mil lançamentos (montar a mudança e as diferenças a gravar, com 100 mil no cofre) | 75 ms | 59 ms |
| Gravar a junção de 20 mil lançamentos (servidor) | — | 0,32 s |
| Conferir os tetos ao gravar (200 mil lançamentos) | — | 0,2 a 0,4 ms |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 290 testes ok (eram 263) |
| Regras do front-end | 104 ok (eram 93) |
| Navegador | 65 ok (eram 58), estáveis em 2 rodadas seguidas com a versão final |
