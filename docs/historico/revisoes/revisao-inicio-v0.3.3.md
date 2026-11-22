# Revisão do Início — v0.3.3

Escopo: a tela **Início**, com saudação, resumo do mês, saldo nos bancos, mercado, notícias,
últimos lançamentos, boas-vindas de um cofre novo e lembrete do código de recuperação. Do lado
técnico, entram o código da tela, as cotações e notícias buscadas pelo back-end e a leitura do
cofre que alimenta os números.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **O saldo misturava o futuro.** Um aluguel lançado para o mês que vem já saía do "Saldo total" hoje. | **Saldo hoje** conta só até hoje. Quando há lançamentos com data futura, aparece abaixo: "Com os lançamentos futuros: R$ …". A tela Bancos mostra os mesmos números. |
| P2 | Lançamentos futuros iam para o topo de "Últimos lançamentos" e ficavam ali até a data chegar. | "Últimos" vai só até hoje. Os futuros aparecem em **Próximos**: os 3 mais perto, com o total ao lado. |
| P3 | O resumo do mês não levava aos detalhes. | **Entrou** e **Saiu** abrem os lançamentos do mês já filtrados. |
| P4 | Com o app aberto de um dia para o outro, saudação, data e mês do resumo ficavam parados ("Bom dia" à noite; resumo de novembro em dezembro). | A tela acompanha o relógio, inclusive na virada do mês. |
| P5 | As boas-vindas vinham com o **Nubank escolhido por palpite**. Era fácil clicar em "Começar" e marcar como principal um banco que a pessoa nem usa. | Nada vem escolhido (só o principal, se já houver). "Começar" só funciona com um banco escolhido, e há um **Pular** explícito. |
| P6 | As fontes das cotações (AwesomeAPI e Banco Central) não apareciam. | Linha discreta "Fontes: …" abaixo do mercado. |
| P7 | Cofre sem bancos: o cartão de saldos ficava vazio, sem explicação. | "Cadastre seus bancos para ver os saldos aqui", com link para Bancos. |
| P8 | Mantido de propósito | Mercado e notícias no Início. A ordem dos cartões. O "Sobrou" como receitas menos despesas (o investido aparece à parte). |

**Recomendado para depois (não feito agora):**

- **Patrimônio no Início:** saldo nos bancos mais o investido (pelo custo), num número só.
- **Meta de gastos do mês**, com a barra do resumo mostrando quanto falta.
- A **transferência entre os próprios bancos**, já recomendada na revisão do "Novo".

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | `Home.tsx` com 416 linhas fazendo tudo. | Dividido em `screens/home/`: `Home` (página, resumo, saldos, lançamentos, lembrete), `Market` (mercado e notícias) e `Onboarding` (boas-vindas). |
| E2 | Para mostrar 6 lançamentos, o Início **ordenava todos** a cada mudança. Com 100 mil, isso levava 78 ms; somado aos saldos e ao resumo, eram ~90 ms a cada gravação. | `homeEntries` guarda só os que vão aparecer (últimos e próximos): **3 ms**. `balanceOverview` calcula o saldo de hoje e o previsto numa passada só. O Início inteiro recalcula em ~13 ms. |
| E3 | Toda volta ao Início buscava cotações e notícias de novo e mostrava o esqueleto piscando. | A última resposta fica guardada. Voltar mostra os valores na hora, e uma nova busca só acontece depois de 30 s. |
| E4 | Clicar rápido entre páginas (ou voltar no navegador) no meio da animação gerava um **erro não tratado** na página. | `withViewTransition`: uma animação interrompida por outra não é erro. Vale também para a troca de tema. |
| E5 | Abrir o cofre (back-end) convertia o nome de cada coluna em cada linha: 1,1 milhão de conversões com 100 mil lançamentos, ou **1,6 s**. | Os nomes são convertidos uma vez por coleção e as linhas são lidas como tuplas: **0,2 s**. |
| E6 | Removido o que não era usado | `totalBalance` e `_from_row` (sem uso depois das mudanças), a tradução `home.indicators` e o código repetido que montava a lista de lançamentos. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | Na primeira vez sem internet, o servidor responde com listas vazias. O mercado aparecia como uma **seção em branco**. | Mostra o aviso "Sem conexão com as cotações agora." |
| D2 | Sem conexão, as notícias diziam "Nenhuma notícia por enquanto". | "Não deu para buscar as notícias agora." |
| D3 | Com o Lume (servidor) fora do ar depois de abrir, os valores antigos continuavam na tela sem nenhuma pista. | Ícone "Pode estar desatualizado", que agora é lido por leitores de tela (antes não tinha papel de imagem). |
| D4 | Mês só com despesas dizia "Nenhum lançamento neste mês.". | "Nenhuma receita neste mês ainda." |
| D5 | Mês vazio mostrava a barra **toda verde**, como se tivesse guardado tudo. | Trilho neutro enquanto não há nada lançado. |
| D6 | Notícia com fuso errado no feed aparecia como "em 3 horas". | Vira "agora", tanto no servidor quanto na tela. Nenhum horário passado aparece mais no futuro. |
| D7 | Os links das notícias abrem em outra aba sem avisar quem usa leitor de tela. | O nome do link inclui "(abre em outra aba)". |
| D8 | Acessibilidade dos cartões | Os cartões são nomeados pelos seus títulos, e o mercado e as notícias avisam quando estão carregando (`aria-busy`). |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/home.spec.ts`, 10 testes):**
  - saldo de hoje, previsto e próximos (em ordem), com o mesmo número em Bancos e o previsto escondido ao ocultar valores;
  - Entrou e Saiu levando à lista filtrada, com "voltar" no meio;
  - mês só com despesas;
  - cofre sem bancos;
  - primeira vez sem internet;
  - servidor caindo depois de abrir;
  - voltar ao Início sem piscar e sem nova busca;
  - notícia "do futuro";
  - **relógio**: tarde virando noite e novembro virando dezembro com a tela aberta;
  - boas-vindas sem palpite, com Pular.
- **Regras (8 testes novos):** saldo de hoje e previsto (igual ao cálculo antigo "até a data"); últimos e próximos iguais a ordenar tudo, em 2 mil lançamentos com empates de data e de criação, e bem mais rápidos com 100 mil; período do dia nas viradas de hora; mês só com despesas; tempo relativo nunca no futuro.
- Os testes do Início, do Novo e dos fluxos principais rodaram também com o relógio em **1º de janeiro de 2027** (virada de ano).

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Erro não tratado ao navegar rápido entre páginas (E4). | Animação interrompida tratada. |
| Q2 | **Regressão da v0.3.2:** ao trocar o tipo para Investimento e já digitar o valor, os números iam para o botão de tipo, porque o foco só mudava no quadro seguinte. Achado por um teste que falhava às vezes. | O foco vai para o valor na hora. Novo teste para isso. |
| Q3 | Mercado em branco na primeira vez sem internet (D1). | Aviso de sem conexão. |
| Q4 | Saudação e mês parados com o app aberto (P4). | A tela acompanha o relógio. |
| Q5 | Uma cotação "NaN" vinda do provedor gerava JSON inválido. O mercado inteiro dava **erro 500** até a próxima atualização boa. | Números inválidos (NaN, infinito, zero ou negativo) são recusados um a um; o resto continua. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Leitura do cofre sem transação.** Revisão e cada tabela eram lidas em instantes diferentes. Uma gravação de outra aba no meio podia trazer a revisão antiga com dados novos, ou lançamentos apontando para um banco que a leitura de bancos não viu. O teste reproduziu: revisão 1 com um banco da revisão 2. | `read_snapshot`: uma transação de leitura só (o WAL dá um retrato fixo do arquivo). |
| B2 | Abrir o cofre: 1,6 s com 100 mil lançamentos (E5). | 0,2 s. |
| B3 | **Cache de cotações e notícias** (arquivos em `cache/`, fora dos cofres): várias abas faziam várias buscas ao mesmo tempo, todas gravando no **mesmo arquivo temporário**, o que podia estragar o cache. | Uma busca por vez: quem chega junto espera a mesma resposta. Temporário com nome único, apagado se a gravação falhar. |
| B4 | Sem internet, **cada pedido esperava até 6 s** pelo limite da rede, mesmo com o último valor guardado. | Resposta na hora com o último valor (marcado como desatualizado). Nova tentativa só depois de 30 s (cotações) ou 2 min (notícias). |
| B5 | Cache gravado "no futuro" (o relógio do computador voltou) nunca vencia. | Vale como vencido. |
| B6 | Arquivo de cache estragado (vazio, lista no lugar de objeto, número inválido). | Ignorado sem erro. Testado caso a caso. |
| B7 | Estrutura revisada | O Início não grava nada. Os números saem do retrato carregado na abertura. O cache fica fora do cofre de propósito: são dados públicos, compartilhados entre cofres. Nada a mudar no esquema. |

Testes de banco e servidor (`tests/test_home_data.py`, 25 testes):

- **Mercado e notícias:** oito abas ao mesmo tempo geram uma busca só; sem internet, ninguém espera e a nova tentativa respeita o intervalo; sem internet e sem cache, a segunda resposta é imediata; o botão Atualizar respeita o intervalo mínimo; cotação e indicador inválidos (NaN, infinito, zero, negativo) com a resposta continuando JSON válido; cache no futuro; cache estragado (5 formas); nenhum temporário sobrando; a API sem internet; notícia com data no futuro.
- **Leitura do cofre:** retrato de um instante só, com uma gravação no meio; tipos preservados (sim/não, filtros dos relatórios) e campos vazios omitidos; 100 mil lançamentos.

**Desempenho** (máquina de teste):

| Operação | Antes | Agora |
|---|---|---|
| Abrir o cofre com 100 mil lançamentos (servidor) | 1,6 s | 0,2 s |
| Recalcular o Início a cada gravação (100 mil) | ~90 ms | ~13 ms |
| Últimos lançamentos (100 mil) | 78 ms | 3 ms |
| Cotações sem internet, por pedido | até 6 s | imediato |

**Recomendação para depois (não feita agora):**

- Com 100 mil lançamentos, a resposta de abertura tem 24 MB. No próprio computador isso é rápido. Se cofres desse tamanho ficarem comuns, vale carregar por ano ou comprimir a resposta.

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 213 testes ok (eram 188) |
| Regras do front-end | 72 ok (eram 64) |
| Navegador | 47 ok (eram 37), estáveis em 2 rodadas seguidas com a versão final |
