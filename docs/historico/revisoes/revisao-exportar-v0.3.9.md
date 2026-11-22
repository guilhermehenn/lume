# Revisão de Exportar — v0.3.9

Escopo: a tela **Exportar** e tudo o que ela gera:

- pacote para o contador (.xlsx);
- planilhas simples (CSV de lançamentos e de investimentos);
- relatório anual para imprimir, salvar em PDF ou mandar por e-mail (tela `/print`);
- cópia de segurança (.json) e a volta dela em Configurações → Restaurar backup;
- envio por e-mail dos arquivos e a "Cópia por e-mail".

Do lado técnico, entram os geradores (`exporters.ts`, `xlsx.ts`, `csv.ts`, `annualReport.ts`, `backup.ts`), a formatação de datas e números, o envio (`mail.ts` e a rota `POST /api/mail/send`) e o que o servidor aceita receber.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **O ano que abria era o mais recente com algum lançamento**, mesmo que fosse um ano futuro (um lançamento agendado para 2027 abria 2027). E ignorava a época da declaração. | Abre no ano da declaração: até junho, o ano anterior; depois, o ano atual. Nunca um ano futuro. A mesma regra vale em Relatórios → Investimentos e no relatório anual aberto sem ano. |
| P2 | **Não dava para saber o que havia no ano antes de baixar.** A planilha avisava quando o ano estava vazio, mas os CSVs baixavam um arquivo só com o cabeçalho, e o relatório abria todo zerado. | Ao lado do ano: "2026: 120 lançamentos e 22 operações de investimento" (ou "Nada registrado em 2025"). Nenhum arquivo vazio é gerado: cada botão avisa o que falta ("Não há receitas nem despesas em 2020."). O relatório anual de um ano vazio mostra um aviso, que não sai na impressão. |
| P3 | O aviso de privacidade dizia "sem enviar nada para a internet", ao lado de botões que mandam por e-mail. | "Os arquivos são gerados neste computador. Só saem dele se você mandar por e-mail." Saiu da barra do ano e foi para o fim da tela. |
| P4 | **Backup gerado pelo Lume era recusado na hora de restaurar.** A restauração aceitava até 50 MB, e um cofre com 100 mil lançamentos gera 50,4 MB. A mensagem dizia "backup incompleto ou com dados inválidos". | Aceita até 256 MB (um cofre cheio, nos tetos do servidor, dá cerca de 120 MB). O backup passou a ser JSON compacto, 27% menor. Acima do teto, a mensagem diz o tamanho do arquivo e o limite. |
| P5 | O seletor de ano dava a entender que o backup era só daquele ano. | A descrição diz "de todos os anos" e onde restaurar (Configurações → Restaurar backup). |
| P6 | A aba **Bancos** da planilha trazia só o saldo em 31/12 do ano. Para contas, a ficha Bens e Direitos pede o do ano anterior e o do ano. | Nova coluna "Saldo em 31/12 do ano anterior" e uma linha no Leia-me explicando. |
| P7 | O Leia-me dizia "Valores em reais" mesmo com a moeda em dólar ou euro. | "Moeda: Dólar americano (US$)", conforme a moeda escolhida. |
| P8 | Relatório anual: o título repetia a marca ("Lume: dados para o Imposto de Renda 2026") sem dizer o que era; o PGBL aparecia com "?" no código; faltavam o resultado de vendas e resgates e o IR retido dos rendimentos, que já estavam na planilha e na tela de Relatórios. | Título "Relatório anual 2026", com a frase "Resumo do ano e dados para a declaração do Imposto de Renda". PGBL com "—" no grupo e no código. Coluna "Resultado no ano" (só quando houve venda ou resgate) e coluna "IR retido" nos rendimentos, com total. |
| P9 | **E-mail:** o limite de 20 MB de anexos vira cerca de 27 MB depois de codificado, acima dos 25 MB por mensagem do Gmail e do Yahoo. O provedor recusava com uma mensagem genérica, e o arquivo inteiro já tinha sido enviado ao servidor do Lume antes de falhar. | Limite de 15 MB (cerca de 20 MB codificados), conferido no navegador antes de enviar: "O arquivo tem 18,3 MB e o limite para e-mail é 15 MB. Baixe o arquivo e envie de outro jeito." O servidor confere de novo, antes de decodificar. |
| P10 | Mantido de propósito | O separador do CSV segue o idioma (ponto e vírgula em português e espanhol, vírgula em inglês). O backup leva tudo, como está na tela, inclusive o que ainda está sendo salvo (é o que a pessoa vê, e salva os dados mesmo sem conexão com o Lume). Os arquivos só são gerados no clique. |

**Recomendado para depois (não feito agora):**

- **Backup compactado** (.zip) para mandar por e-mail: 100 mil lançamentos dão 37 MB em JSON e cerca de 4 MB compactados. Pede que a restauração aceite o .zip.
- **Exportar um período** (um trimestre, um mês) e o relatório personalizado em Excel.
- **Lembrete em março**: "hora de gerar o pacote para o contador", com o ano certo já escolhido.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | **O CSV de 100 mil lançamentos levava 6,5 s.** Cada data criava um `Intl.DateTimeFormat` novo, o que também acontecia no app inteiro em `formatMonth`, `formatNumber`, `formatPercent` e nas contagens das traduções. Além disso, cada linha montava um mapa novo de bancos e procurava a categoria na lista inteira. | Formatadores guardados e reaproveitados (`lib/intl.ts`, usado por datas, números, porcentagens e traduções). Bancos e categorias em mapas montados uma vez por arquivo, e cada data formatada uma vez por arquivo. **0,23 s** (28 vezes mais rápido). CSV de investimentos: 0,90 → 0,06 s. |
| E2 | A aba "Resumo mensal" e o resumo do relatório anual percorriam a lista inteira 13 vezes (12 meses e o total). A tela Exportar fazia isso **a cada desenho**, só para saber se o ano tinha dados, e ainda recalculava os anos disponíveis. | `yearTotals`: os 12 meses e o total numa passada, com os mesmos números de `periodSummary` (com teste). `yearCounts`: lançamentos e operações de cada ano numa passada, guardado até os dados mudarem. Trocar de ano não recalcula nada. |
| E3 | A aba Bancos procurava, para cada banco, se havia algum lançamento e alguma operação com ele (duas buscas na lista inteira por banco). | Um conjunto de bancos usados, montado numa passada. |
| E4 | Código repetido: o ano inicial de Relatórios; rendimentos e IR retido por tipo na aba Investimentos; uma cópia de `toISODate`; o nome do backup montado em dois lugares, os dois com a data errada. | `defaultTaxYear`, `yearEarnings` e `backupFilename` em um lugar só, usados por todas as telas. |
| E5 | Planilha: a letra da coluna era calculada em cada célula, e todo texto passava por cinco substituições mesmo sem nada para trocar. | Letras calculadas uma vez por aba; texto sem caractere especial sai direto. A montagem do XML ficou cerca de 10% mais rápida (o resto do tempo é a compactação do .xlsx). |
| E6 | A restauração lia e conferia o arquivo inteiro duas vezes: ao escolher o arquivo (para mostrar a data) e ao confirmar. Com 120 mil registros, 2 × 1,3 s. | O arquivo lido e conferido fica guardado até a confirmação. Com o JSON compacto, uma leitura de 0,85 s. |
| E7 | O endereço do arquivo baixado era liberado 2 s depois do clique. Com arquivos grandes e disco lento, o download podia sair cortado. | 60 s. |
| E8 | Datas antes de 01/03/1900 iam para o Excel com um dia a mais (o Excel conta um 29/02/1900 que não existiu). | Corrigido, com teste nas datas de borda. |
| E9 | No CSV de investimentos, a quantidade saía com `String(valor)`: 0,00000001 BTC virava "1e-8", que o Excel lê como texto ou notação científica. | `csvQuantity`: até 8 casas, sem notação científica, com vírgula ou ponto conforme o separador. |
| E10 | O nome do backup, a data no texto do e-mail e o "Gerado em" do relatório usavam a data de Greenwich (`toISOString`): depois das 21h, em Brasília, saía a data de amanhã. | Data deste computador (`todayISO`). |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | **Relatório anual no celular:** os quatro números do topo se sobrepunham ("R$ 55.857,54" por cima de "R$ 32.931,54"); a tabela era cortada na margem; as duas tabelas de categorias ficavam espremidas lado a lado; o "Gerado em" ocupava uma coluna estreita em quatro linhas, e o título também quebrava em quatro. | No celular: números em 2 × 2, tabelas que rolam de lado dentro do próprio quadro (a página não rola), tabelas de categorias uma embaixo da outra, cabeçalho empilhado, título menor e margens de 20 px. A impressão continua como antes (quatro números numa linha, tabelas lado a lado). |
| D2 | Na tabela "Mês a mês", os meses sem movimento mostravam cinco "R$ 0,00". | Um traço: os meses com valores saltam aos olhos. O total continua com os valores. |
| D3 | Na barra do topo, o aviso de privacidade disputava espaço com o ano; no celular, quebrava em duas linhas entre o seletor e o link. | Ao lado do ano, o que há nele (lido por leitores de tela quando o ano muda). O aviso de privacidade fica no fim da tela. |
| D4 | O relatório de um ano vazio abria todo zerado, sem explicação. | Aviso "Não há lançamentos em 2015." acima do relatório, que não sai na impressão. |
| D5 | "Arquivo grande demais para mandar por e-mail." não dizia o tamanho nem o que fazer. Um backup grande demais para restaurar aparecia como "incompleto ou com dados inválidos". | As duas mensagens dizem o tamanho do arquivo, o limite e o que fazer. |
| D6 | Mantido | Um botão de baixar e um de e-mail para cada arquivo (o de e-mail diz qual arquivo envia, para leitores de tela). |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/export.spec.ts`, 4 testes):**
  - o ano que abre (até junho, o anterior); o que há em cada ano; CSV de investimentos com 0,00000001; nenhum CSV vazio baixado em anos só com lançamentos ou só com operações; o aviso de privacidade;
  - backup às 23h30 em Brasília (já dia seguinte em Greenwich): nome com a data daqui, JSON compacto, os mesmos registros e a quantidade de cripto exata;
  - e-mail com um backup de uns 18 MB: aviso com o tamanho e **nenhuma** chamada a `/api/mail/send`;
  - relatório anual de um ano vazio com aviso; no celular, nada passando da tela, os quatro números sem sobreposição e o PGBL com "—".
- O teste de Exportar que já existia confere o novo título do relatório.
- **Regras (`tests/unit/export.test.ts`, 15 testes):**
  - os 12 meses e o total numa passada iguais a `periodSummary`, com 3 mil lançamentos e 1.500 operações aleatórios;
  - contagem por ano, anos disponíveis e o ano que abre (janeiro, junho, julho, novembro, sem ano anterior, com ano futuro, sem nada);
  - rendimentos do ano com IR retido;
  - CSV: quantidade sem notação científica (de 0,00000001 a 10²¹), texto que parece fórmula vira texto e número negativo continua número, 100 mil linhas em menos de 2,5 s;
  - planilha: datas de 1900 a 2199 no Excel, Leia-me com a moeda, Bancos com o saldo dos dois anos, caracteres de controle e símbolos do XML;
  - backup compacto que volta igual e nome com a data daqui; tamanho de arquivo legível;
  - relatório anual: título, data local, traço nos meses sem movimento, PGBL, coluna de resultado só com venda, IR retido com total, texto escapado no HTML do e-mail, ano vazio.
- Toda a suíte do navegador rodou também com o relógio em 1º de janeiro de 2027 e em 15 de junho de 2026 (época da declaração). Os testes de Exportar rodaram 5 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | CSV de 100 mil lançamentos em 6,5 s (E1). | 0,23 s, com teste de tempo. |
| Q2 | Backup de cofre grande recusado na restauração (P4). | Teto de 256 MB, com teste de que o servidor aceita o mesmo tamanho. |
| Q3 | Backup, e-mail e relatório com a data de amanhã depois das 21h (E10). | Data deste computador, com teste no navegador às 23h30 em Brasília. |
| Q4 | CSVs vazios baixados (P2). | Aviso no lugar do arquivo. |
| Q5 | "1e-8" no CSV (E9) e datas de 1900 no Excel (E8). | Corrigidos, com teste. |
| Q6 | Números sobrepostos e tabela cortada no relatório anual no celular (D1). | Corrigidos, com teste no celular. |
| Q7 | E-mail com arquivo grande: enviado inteiro ao servidor e recusado depois pelo provedor (P9). | Barrado no navegador, com teste de que nada é enviado. |
| Q8 | Com o relógio em janeiro de 2027, o teste "cofre novo trazendo os dados da versão anterior" falhava sempre: os dados de exemplo eram montados com a data real, e o teste procurava o mês anterior à data fixada. Problema do teste, não do app. | Os dados de exemplo usam o "hoje" dos testes (`TODAY` em `fixtures.ts`). |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **O servidor aceitava corpo de requisição de qualquer tamanho.** O envio de e-mail aceitava 10 anexos de 30 MB em base64 e decodificava tudo antes de conferir o tamanho (centenas de MB de memória). A recusa saía como 502, como se o servidor de e-mail tivesse recusado, e gastava uma das 20 tentativas permitidas em 10 minutos. | Teto de 256 MB para qualquer corpo, conferido pelo `Content-Length` antes de ler (413). No e-mail, o tamanho em base64 é conferido antes de decodificar (413 `mail-too-big`, com o limite na mensagem), sem gastar tentativa. Um anexo absurdo nem é aceito. |
| B2 | Fidelidade do backup (conferência, sem problema encontrado). Valores testados: datas 01/01/1900, 31/12/2199 e 29/02; 1 centavo e o valor máximo (R$ 99.999.999.999,99); saldo inicial negativo e positivo no máximo; quantidade 0,00000001 e 999.999.999,5; emoji, japonês, aspas, ponto e vírgula e texto que parece fórmula; observação de 500 e nome de 120 caracteres; rendimento sem quantidade. | Criar um cofre a partir do backup e restaurar o backup por cima de outro cofre: tudo volta idêntico, nem um centavo de diferença. |
| B3 | Volume | Restaurar 100 mil lançamentos (o mesmo lote que o navegador manda): 1,5 s para gravar, 0,17 s para abrir. |
| B4 | Limites coerentes entre as pontas | Um cofre cheio (tetos de `MAX_ITEMS`) dá cerca de 120 MB de JSON, abaixo dos 256 MB do navegador, que são iguais ao teto do servidor. O limite de anexos é o mesmo no navegador e no servidor. Os dois casos têm teste que lê a constante do front-end. |
| B5 | Estrutura revisada | A exportação usa os dados que já estão na memória (carregados ao entrar), sem consulta ao banco: não há índice a criar. O backup .json é uma cópia lógica, que restaura em qualquer cofre e em qualquer versão nova; os backups automáticos continuam sendo cópias do arquivo SQLite, verificadas. Os dois se completam. |

Testes de banco e servidor (`tests/test_export_db.py`, 10 testes):

- **Fidelidade:** backup com valores extremos volta igual; restaurar por cima de outro cofre volta igual.
- **Volume:** 100 mil lançamentos restaurados e abertos.
- **E-mail:** anexo grande demais recusado antes de decodificar; vários anexos que somados passam do limite; anexo no limite passa e 25 recusas seguidas não gastam tentativas; anexo absurdo nem é aceito; limite igual ao do navegador.
- **Corpo:** acima do teto, recusado sem ler; o teto cabe o maior backup aceito pelo navegador.

**Desempenho** (máquina de teste, cofre com 100 mil lançamentos e 20 mil operações):

| Operação | Antes | Agora |
|---|---|---|
| CSV de lançamentos do ano | 6,5 s | 0,23 s |
| CSV de investimentos do ano | 0,90 s | 0,06 s |
| Abas do pacote para o contador | 339 ms | cerca de 200 ms |
| Pacote .xlsx completo (abas, XML e compactação) | 2,7 s | 2,2 a 2,6 s (o resto é a compactação) |
| Resumo do ano (relatório anual) | 12 ms | 5 ms |
| Tela Exportar, a cada desenho | 16 ms | nada (2,8 ms só quando os dados mudam) |
| Tamanho do backup | 50,4 MB | 36,8 MB |
| Ler e conferir o backup ao restaurar | 2 × 1,3 s | 1 × 0,85 s |
| Restaurar 100 mil lançamentos (servidor) | — | 1,5 s para gravar, 0,17 s para abrir |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 341 testes ok (eram 331) |
| Regras do front-end | 138 ok (eram 123) |
| Navegador | 84 ok (eram 80), estáveis em 2 rodadas seguidas com a versão final, e também com o relógio em 1º/01/2027 e em 15/06/2026 |
