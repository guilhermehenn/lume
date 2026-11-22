# Revisão de Configurações — v0.3.10

Escopo: a tela **Configurações**:

- atalho para Minha conta;
- idioma, moeda e tema;
- ocultar valores;
- seus dados: fazer backup, restaurar backup, carregar dados de exemplo e apagar tudo, com os avisos e o "Desfazer";
- atalhos de teclado e "Sobre".

Do lado técnico, entram a gravação das configurações no cofre (tabela `settings`), o lote que troca tudo de uma vez (restauração, exemplo, apagar), o "Desfazer" e as cópias automáticas do cofre.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **Restaurar um backup, carregar o exemplo e apagar tudo trocavam o cofre inteiro sem cópia no servidor.** Isso contraria um princípio do próprio Lume ("backup antes de qualquer restauração"). O "Desfazer" só fica na tela por 7 segundos; depois, restava a cópia diária, feita ao abrir o app, talvez horas antes. Quem restaurasse o arquivo errado e fechasse o aviso perdia o dia. | Antes de gravar uma dessas trocas, o servidor faz uma **cópia verificada do cofre** (motivos `before-restore`, `before-sample`, `before-reset`), com a retenção de sempre. Se a cópia falhar (disco cheio, por exemplo), **nada é gravado** e a tela volta ao que está salvo. |
| P2 | **Desfazer uma restauração voltava os dados, mas não idioma, tema, moeda e "ocultar valores" trazidos pelo backup.** Um backup de outra pessoa deixava a tela em inglês e em dólar, mesmo depois de desfazer. | Desfazer volta tudo como era. Se outra alteração acontecer depois da restauração, o "Desfazer" passa a ser o dela, como antes. |
| P3 | Os avisos não diziam o que ia sair nem o que ia entrar ("os dados atuais serão trocados pelos do arquivo de 20 de nov."), nem que idioma, tema e moeda também mudam ao restaurar. | Restaurar: os dados de agora e os do arquivo ("2 lançamentos e 1 operação de investimento" → "120 lançamentos e 22 operações"), a data **e a hora** do arquivo, e que idioma, tema e moeda vêm junto. Apagar tudo: o que será apagado. Os três dizem que o Lume guarda uma cópia antes. |
| P4 | "Carregar dados de exemplo" aparecia em vermelho, como perigoso, mesmo com o cofre vazio. E, com dados reais, não sugeria alternativa. | Vermelho só com dados no cofre. Nesse caso, o aviso sugere criar um cofre só para testar. Com o cofre vazio, só explica o que entra. "Apagar tudo" num cofre vazio diz que não há o que apagar e não oferece backup. |
| P5 | A contagem "18 bancos · 24 categorias · 142 lançamentos" não tinha singular ("1 bancos"), somava as operações de investimento como se fossem lançamentos e não contava os relatórios salvos. | "18 bancos · 24 categorias · 120 lançamentos · 22 operações de investimento · nenhum relatório salvo", no singular e no plural, nos três idiomas. |
| P6 | O Lume prometia backup diário, mas não havia como ver se ele estava acontecendo. | Embaixo de "Seus dados": "Última cópia do cofre: 21 de nov. de 2026, 14:02. 5 cópias guardadas neste computador." Atualiza depois de cada gravação. |
| P7 | "Sobre" mostrava "Open source" com o ícone do GitHub, sem link e sem repositório (a licença ainda não foi definida). | Saiu. O texto de "Sobre" já diz que o Lume é de código aberto. |
| P8 | Mantido de propósito | Restaurar traz também as configurações do backup (agora o aviso diz isso). "Fazer backup" continua aqui e em Exportar. |

**Recomendado para depois (não feito agora):**

- **Restaurar uma cópia automática pelo próprio app**, escolhendo da lista (hoje, só pelo terminal).
- **Abrir a pasta de cópias** do cofre a partir da tela.
- **Escolher a pasta de cópia extra** (OneDrive, iCloud, pendrive) pela tela, em vez do arquivo `.env`.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | `Settings.tsx` reexportava `APP_VERSION`, que ninguém importava dali, com os imports fora de ordem. | Removido. Imports organizados. |
| E2 | Se carregar o exemplo ou apagar tudo falhasse, a mensagem era "O backup está incompleto ou com dados inválidos". | Mensagem de backup só na restauração; nos outros, "Algo deu errado. Tente de novo." |
| E3 | A data do backup no aviso vinha de `exportedAt.slice(0, 10)`, a data de Greenwich: um backup feito às 23h30 aparecia como do dia seguinte. E não tinha hora. | Data e hora no fuso deste computador (`formatDateTime`, `i18n.dateTime`), com o formatador guardado e reaproveitado. |
| E4 | Escolher um backup grande deixava a tela parada por um ou dois segundos, sem retorno. | O botão vira "Lendo o arquivo…", com indicador, até o aviso abrir. |
| E5 | O atalho "Ctrl/⌘ + Enter" aparecia igual em todo sistema, com o rótulo "Salvar". | Mostra o do sistema ("⌘ Enter" no Mac, "Ctrl + Enter" nos outros) e diz "Salvar o formulário aberto". |
| E6 | A troca de tudo não tinha como pedir a cópia ao servidor. | `Pending.checkpoint`: vai no lote junto com as mudanças (sem corrida entre a cópia e a gravação). Ao juntar lotes, fica o primeiro motivo, pois a primeira cópia tem o estado de antes de tudo. |
| E7 | O "Desfazer" guardava só os dados. | Guarda também as configurações de antes da restauração; qualquer outra alteração encerra o desfazer delas, junto com o dos dados. |
| E8 | O texto do aviso era recalculado a cada desenho, a partir dos dados da tela. | É montado ao abrir, então continua o mesmo enquanto o aviso some, depois de confirmar. |
| E9 | Botões soltos, montados um a um. | `ActionRow`: uma linha-botão com ícone, título e descrição, em que o título é o nome do botão e a descrição é lida à parte. `Row` ganhou `stackOnMobile`. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | "Seus dados" tinha quatro botões numa fileira, com "Apagar tudo" sozinho numa segunda linha, colado às ações seguras. | Uma linha por ação, com ícone, título e o que ela faz. "Apagar tudo" foi para um grupo próprio, **Apagar dados**, separado das outras. |
| D2 | No celular, o seletor de tema ficava espremido ao lado do rótulo: ícones sumindo, "Claro" e "Sistema" colados. | No celular, rótulo em cima e seletor na largura toda. |
| D3 | No celular, "Minha conta · Nome, foto, e-m…" era cortado. | O texto quebra a linha. |
| D4 | O ícone da contagem de dados era laranja, a cor de alerta do app, sem haver alerta. | Neutro. |
| D5 | O aviso de exemplo era vermelho com o cofre vazio (P4). | Vermelho só quando apaga algo. |
| D6 | O rodapé de "Seus dados" falava do backup diário só como promessa. | Diz quando o Lume copia o cofre (todo dia e antes das trocas) e mostra a última cópia. |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/settings.spec.ts`, 4 testes):**
  - restaurar às 23h30 de Brasília (já dia seguinte em Greenwich): o aviso mostra "20 de nov. de 2026, 23:30", os dados de agora e os do arquivo, e que idioma, tema e moeda vêm junto; a tela vira inglês e dólar; "Desfazer" volta português, real, tema escuro e os dados; recarregando, continua assim; o servidor guardou uma cópia `before-restore`;
  - apagar tudo: o aviso conta o que sai e oferece backup; depois, a contagem zera, o servidor guarda uma cópia `before-reset` e o rodapé mostra uma cópia a mais; com o cofre vazio, o aviso diz isso e não oferece backup; o exemplo num cofre vazio não fala em troca;
  - **sem a cópia, nada é apagado**: com o servidor recusando por falta de cópia, a tela avisa e volta ao que está salvo, e o cofre continua com tudo;
  - celular: nada passando da tela, tema na largura toda, texto de Minha conta inteiro; atalho de salvar do sistema; arquivo que não é JSON.
- O teste de "apagar tudo" que já existia confere a contagem nova.
- **Regras (`tests/unit/settings.test.ts`, 5 testes):** o motivo da cópia no lote e na junção de lotes; desfazer a restauração volta dados e configurações (e não volta duas vezes); outra alteração encerra o desfazer das configurações; data e hora locais; contagens no singular e no plural nos três idiomas.
- Toda a suíte do navegador rodou também com o relógio em 1º de janeiro de 2027 e em 15 de junho de 2026. Os testes de Configurações rodaram 5 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Desfazer a restauração deixava a tela no idioma e na moeda do backup (P2). | Corrigido, com teste nas regras e no navegador (inclusive depois de recarregar). |
| Q2 | Backup feito à noite aparecia no aviso com a data do dia seguinte (E3). | Data e hora locais, com teste às 23h30 em Brasília. |
| Q3 | Mensagem de "backup inválido" ao falhar o exemplo ou o apagar (E2). | Corrigida. |
| Q4 | Seletor de tema e texto de Minha conta espremidos no celular (D2, D3). | Corrigidos, com teste no celular. |
| Q5 | "1 bancos", "1 categorias" (P5). | Singular e plural, com teste. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Troca de tudo sem cópia** (P1). | Cópia verificada (`integrity_check`) antes de gravar, na pasta de backups do cofre e na pasta extra, se houver. Falhou: 503 `storage` e nenhuma linha muda (com teste: mesma revisão, mesmos dados). Motivo desconhecido é recusado. Um lote comum não faz cópia. |
| B2 | **Um valor estragado na tabela `settings` fazia todas as configurações voltarem ao padrão** (idioma, tema, moeda). Isso acontecia com um valor editado à mão ou vindo de uma versão mais nova do Lume. | Cada valor é conferido sozinho: o estragado volta ao padrão e os outros ficam. Chaves desconhecidas continuam no arquivo, intactas, para uma versão futura. |
| B3 | Estrutura revisada | A tabela chave → valor é o certo aqui: cada janela grava só a chave que mudou, então duas janelas mudando coisas diferentes não se atropelam (com teste, com duas sessões). Os valores são conferidos ao gravar (idiomas, moedas, temas, sim/não); uma chave desconhecida é recusada (422). As configurações não precisam de revisão, porque a gravação é por chave. |
| B4 | Lista de cópias | `GET /api/vault/backups`: quantas cópias o cofre tem e a mais recente, lendo só a pasta, sem abrir o banco. Pede sessão. |
| B5 | Volume | Apagar tudo com 100 mil lançamentos, já com a cópia: 0,68 s no servidor. |

Testes de banco e servidor (`tests/test_settings_db.py`, 17 testes):

- **Configurações:** valor estragado e valor que não é JSON; chave desconhecida preservada; gravar uma chave sem mexer nas outras; 5 valores inválidos ou chaves desconhecidas recusados; duas janelas gravando chaves diferentes.
- **Cópia:** os três motivos (a cópia tem os dados de antes e está íntegra); sem a cópia, nada é gravado; lote comum sem cópia e motivo desconhecido recusado; apagar tudo com 100 mil lançamentos; cofre sem nenhuma cópia.
- **API:** lista de cópias pede sessão; valor inválido dá 422; a cópia pelo lote aparece na lista.

**Desempenho** (máquina de teste):

| Operação | Antes | Agora |
|---|---|---|
| Apagar tudo, 100 mil lançamentos (servidor) | 0,33 s, sem cópia | 0,68 s, com a cópia verificada |
| Montar o lote de "apagar tudo" no navegador (100 mil lançamentos) | — | 34 ms |
| Ler as configurações | uma consulta; um valor ruim zerava tudo | uma consulta, valor a valor |
| Ver as cópias do cofre | não havia | leitura da pasta, sem abrir o banco |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 358 testes ok (eram 341) |
| Regras do front-end | 143 ok (eram 138) |
| Navegador | 88 ok (eram 84), estáveis em 2 rodadas seguidas com a versão final, e também com o relógio em 1º/01/2027 e em 15/06/2026 |
