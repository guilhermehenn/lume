# Revisão de Ocultar valores, Minha conta, Trocar de cofre e Sair — v0.3.11

Escopo:

- **Ocultar valores**: o olho na barra lateral (e no topo, no celular), a tecla H e a chave em Configurações;
- **Minha conta**: perfil e foto, senha de acesso, código de recuperação, e-mail para envio, nome do cofre, excluir o cofre;
- **Trocar de cofre** e **Sair**: pelo menu da conta e por Minha conta, com o que acontece nas outras abas.

Do lado técnico, entram as sessões no servidor (memória, cookie, limite de tentativas), a gravação pendente na hora de sair e as mensagens entre abas.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **Sair e Trocar de cofre jogavam fora o que ainda não tinha sido gravado.** Uma alteração feita segundos antes, com a gravação ainda a caminho (ou com o Lume sem responder), se perdia sem aviso. | Antes de sair, o Lume grava o que falta e só então fecha o cofre. Se não conseguir (o Lume não responde), nada sai da memória e aparece um aviso: "Ficar e esperar" ou "Sair e descartar". |
| P2 | **Sair numa janela fazia as outras dizerem "Outra janela abriu um cofre diferente"**, o que não era verdade. Excluir o cofre numa janela dava a mesma mensagem nas outras. | "Você saiu deste cofre em outra janela. Entre de novo para continuar; o que você fez aqui não se perdeu." A tela já abre a entrada do mesmo cofre. Se o cofre foi excluído, as outras janelas dizem isso. |
| P3 | **Depois de trocar o e-mail de acesso, a tela de entrada continuava sugerindo o antigo**, e a primeira tentativa dava "E-mail ou senha incorretos". | A tela de entrada sugere o e-mail novo. |
| P4 | **Ocultar valores deixava escapar números**: "Você guardou 55% do que entrou" no Início (com o percentual dá para deduzir valores) e o saldo inicial no aviso de excluir um banco. | Os dois aparecem como "•••••". Foram conferidas todas as telas com o modo ligado. |
| P5 | Remover o e-mail para envio era imediato e apagava a senha de app guardada, que é chata de gerar de novo. | Pede confirmação e diz o que se perde. |
| P6 | **Minha conta mostrava "18 · 24 · {transactions} · {investments} · {reports}"**: o texto da contagem mudou em Configurações na v0.3.10, e Minha conta não acompanhou. Num cofre vazio, saía "0 banco · 0 categoria". | Uma função só para a contagem, usada nas duas telas. Com zero: "nenhum banco · nenhuma categoria…". |
| P7 | Renomear o cofre com o nome de outro mostrava "Algo deu errado. Tente de novo." | "Já existe um cofre com esse nome." |
| P8 | No celular, o nome do cofre aberto não aparecia em lugar nenhum. | O menu da conta mostra "Cofre: Pessoal" (no computador também). |
| P9 | O texto sobre a sessão falava só das 2 horas sem uso; o limite de 24 horas não aparecia. | "…depois de 2 horas sem uso (e, no máximo, a cada 24 horas)." |
| P10 | Mantido de propósito | "Trocar de cofre" e "Sair" continuam separados: trocar leva direto à escolha; sair diz que saiu. Sair encerra a sessão em todas as abas (o cookie é um só). Com "Ocultar valores", barras e gráficos mantêm as proporções sem números; os formulários de edição mostram o valor (é preciso ver o que se edita); o relatório para imprimir mostra os valores, porque é um documento. |

**Recomendado para depois (não feito agora):**

- **Sair sozinho** depois de um tempo sem uso escolhido pela pessoa (hoje são 2 horas fixas).
- **Começar com os valores ocultos** ao abrir o app.
- **Ver as sessões abertas** (navegadores) e encerrar uma delas.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | `signOut` chamava o logout e limpava a memória na hora, sem olhar o que faltava gravar. As duas telas que saem (menu e Minha conta) chamavam direto. | `saveNow()` no store grava o que falta e espera (até 8 s). `signOut` devolve `'done'` ou `'unsaved'` e aceita `force`. `app/leave.tsx` reúne `leave()` e o aviso (`LeaveDialog`), montado uma vez; cliques repetidos enquanto grava não fazem nada. |
| E2 | A mensagem entre abas `{ type: 'closed' }` não dizia por quê. | Leva o cofre e se ele foi excluído; motivo novo `closedElsewhere`. |
| E3 | A contagem do cofre estava escrita em dois lugares, e um quebrou (P6). | `vaultStats()` em `app/vaultStats.ts`. |
| E4 | Renomear lia o nome do estado da tela no momento em que o campo perdia o foco. | Lê o valor do próprio campo. Esc desiste e volta o nome salvo. |
| E5 | Senha atual vazia dava "Senha atual incorreta." | "Digite a senha atual." |
| E6 | O erro `name-taken` não tinha tradução em Minha conta. | Traduzido (P7). |
| E7 | O botão do olho tinha `aria-pressed` e um nome que mudava ao mesmo tempo: leitores de tela diziam "Mostrar valores, pressionado". | O nome diz a ação ("Ocultar valores" / "Mostrar valores"), sem `aria-pressed`. |
| E8 | A máscara de valores era interna a um componente. | `MASK` exportada e usada também nos textos que levam valor (P4). |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | O menu da conta mostrava nome e e-mail, mas não o cofre aberto. | Terceira linha: "Cofre: …". |
| D2 | Trocar de cofre mostrava o aviso "Escolha o cofre que quer abrir." logo acima do título "Escolha um cofre". | Sem o aviso repetido. |
| D3 | A dica da foto ("JPG, PNG ou WebP…") ficava no pé do perfil, depois de "Salvar perfil", longe do botão da foto. | Junto do botão. |
| D4 | O aviso de alterações não salvas (novo) | "Ficar e esperar" é o caminho seguro; "Sair e descartar" (ou "Trocar e descartar") aparece em vermelho. O texto diz como saber quando está salvo ("Salvo no cofre"). |
| D5 | Remover o e-mail de envio (novo aviso) | Diz que a senha de app guardada se perde e que a cópia por e-mail é desligada. |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/account.spec.ts`, 6 testes):**
  - sair sem conexão: o aviso aparece, "Ficar e esperar" mantém o cofre aberto; com a conexão de volta, os dados são gravados e sair funciona sem perguntar;
  - sair logo depois de uma alteração, com a gravação lenta: o que estava indo é gravado antes de sair (antes, se perdia); trocar de cofre não repete o título;
  - sair numa aba: a outra tranca com "Você saiu deste cofre em outra janela", abre a entrada do mesmo cofre e volta para onde estava;
  - trocar o e-mail: o menu mostra o cofre, e a tela de entrada sugere o e-mail novo;
  - ocultar valores: o botão diz a ação, "Você guardou ••••• do que entrou", nenhum valor nem percentual em 8 telas, e H volta tudo;
  - Minha conta: contagem do cofre por extenso, nome de outro cofre recusado com a mensagem certa, Esc desiste, remover o e-mail pede confirmação (cancelar mantém).
- O teste de Minha conta que já existia confirma a remoção do e-mail.
- **Regras (`tests/unit/account.test.ts`, 3 testes):** gravar agora com tudo salvo; sair com algo por gravar devolve "unsaved" sem mudar nada, e "descartar" limpa a memória; contagem com zero, um e vários.
- Toda a suíte do navegador rodou também com o relógio em 1º de janeiro de 2027 e em 15 de junho de 2026. Os testes desta revisão rodaram 5 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Alteração perdida ao sair logo depois de fazê-la, ou sem conexão (P1). | Grava antes; sem conexão, pergunta. Com teste das duas situações. |
| Q2 | Aviso errado nas outras abas ao sair ou excluir (P2). | Corrigido, com teste com duas abas. |
| Q3 | E-mail antigo sugerido na entrada depois de trocar (P3). | Corrigido, com teste. |
| Q4 | Percentual e saldo inicial à mostra com "Ocultar valores" (P4). | Mascarados, com teste em 8 telas. |
| Q5 | Contagem quebrada em Minha conta e "0 banco" (P6). | Corrigidas, com teste nas regras e no navegador. |
| Q6 | "Algo deu errado" ao renomear para um nome em uso (P7). | Mensagem certa, com teste. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Sessões vencidas ficavam na memória do servidor, com a chave de dados do cofre, até o Lume fechar.** Elas só saíam quando o mesmo cookie voltava, e abas fechadas nunca voltam. | As vencidas saem a cada sessão nova e a cada troca de senha. |
| B2 | "Senha trocada. 2 outras sessões foram encerradas" contava sessões que já tinham vencido. | Conta só as que ainda valiam. |
| B3 | Troca de e-mail (conferências, sem problema encontrado) | Com a senha errada, nada é gravado, nem o nome enviado junto. Os erros entram no limite de tentativas do cofre: do 6º em diante, nem a senha certa passa até acabar a espera. O mesmo e-mail com maiúsculas e espaços não pede senha. Depois da troca, o e-mail antigo não entra mais. |
| B4 | Sair (conferências) | Apaga o cookie (`Max-Age=0`) e encerra a sessão; depois disso, dados e sessão dão 401. Sair de novo não dá erro. Sem o cabeçalho do app, o pedido é recusado e a sessão continua. |
| B5 | Ocultar valores | É configuração de cada cofre (tabela `settings`, por chave): ligar num cofre não muda o outro. |
| B6 | Excluir o cofre | Encerra as sessões de todas as abas, guarda a cópia `before-delete` e libera o nome para um cofre novo. |
| B7 | Lista de cofres (tela de entrada, depois de sair ou trocar) | Cada cofre é aberto para contar os lançamentos: com 20 cofres de 100 mil lançamentos, 16 ms. Não precisou mudar. |

Testes de banco e servidor (`tests/test_account_db.py`, 13 testes):

- **Sessões:** vencidas saem da memória; a troca de senha conta só as que valiam.
- **Minha conta:** troca de e-mail com senha errada não grava nada; mesmo e-mail sem senha; limite de tentativas; e-mail novo entra e o antigo não; 3 formas de nome repetido, nome com espaços e nome vazio; ocultar valores por cofre; excluir encerra as sessões e libera o nome.
- **Volume:** lista de 20 cofres grandes.
- **API:** sair apaga o cookie e encerra a sessão, de forma idempotente e só com o cabeçalho do app.

**Desempenho** (máquina de teste):

| Operação | Antes | Agora |
|---|---|---|
| Lista de cofres (20 cofres × 100 mil lançamentos) | 16 ms | 16 ms (conferido, sem mudança) |
| Sessões na memória depois de 5 abas fechadas e vencidas | 5, com as chaves dos cofres | 0 |
| Sair logo depois de uma alteração | a alteração a caminho se perdia | espera gravar (milissegundos; no máximo 8 s) |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 371 testes ok (eram 358) |
| Regras do front-end | 146 ok (eram 143) |
| Navegador | 94 ok (eram 88), estáveis em 2 rodadas seguidas com a versão final, e também com o relógio em 1º/01/2027 e em 15/06/2026 |
