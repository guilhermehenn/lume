# Revisão da entrada (cofre e dono) — v0.3.1

Escopo: tudo o que acontece antes de o app abrir. Inclui a escolha de cofre, a entrada com
e-mail e senha, a criação do cofre e do dono, "Esqueci a senha" e as boas-vindas. Do lado
técnico, entram o código e o banco por trás disso.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **Esqueci a senha só pelo terminal.** Para quem não é técnico, esquecer a senha era quase perder o cofre. | **Código de recuperação.** Ele é mostrado uma vez ao criar o cofre, com opções de copiar, baixar `.txt` e confirmar "Guardei o código". Em "Esqueci a senha", e-mail + código + senha nova trocam a senha sem perder nada. O código usado deixa de valer e um novo aparece na hora. O comando do terminal continua em "Não tenho o código". |
| P2 | Cofres criados na v0.3.0 não têm código. | Em Minha conta, **Código de recuperação → Gerar novo código** (pede a senha atual). No Início, um lembrete discreto aparece até o código ser guardado. |
| P3 | Dois cofres podiam ter o mesmo nome. Na lista eles ficavam iguais, e o terminal (`--cofre "Pessoal"`) ficava ambíguo. | Nome **único**, sem diferenciar maiúsculas, acentos e espaços. A checagem acontece na tela e no servidor. |
| P4 | Sem como trocar o idioma antes de entrar (o português vinha do navegador). | Rodapé da tela de entrada com **Português · English · Español** e a versão do Lume. |
| P5 | "Outros cofres" aparecia mesmo com um cofre só. | Agora é **"Todos os cofres"**, que leva à lista com a opção de criar outro. |
| P6 | Mantido de propósito | Pedir e-mail **e** senha (você pediu assim). Um cofre só vai direto para a senha. Sessão de 2 horas sem uso. |

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | `Gate.tsx` com 520 linhas fazendo tudo. | Dividido em `screens/gate/`: `Gate` (moldura), `VaultList`, `LoginPanel`, `CreateWizard`, `RecoveryCodeCard`, `errors`. |
| E2 | Campos de senha e e-mail eram importados de uma tela por outra (`Account` → `Gate`). | Movidos para `ui/fields.tsx`, componentes de interface compartilhados. |
| E3 | Clique duplo em "Criar cofre" podia mandar dois pedidos: o estado "ocupado" só muda na renderização seguinte. | Trava síncrona (`useRef`) nos três formulários. No servidor, uma trava no nome impede dois cofres iguais mesmo com duas abas. |
| E4 | A entrada abria o arquivo 3 vezes e **contava todos os lançamentos** só para saber se o arquivo estava legível. | `registry.status()` só lê a versão e o dono. |
| E5 | A atualização de formato do arquivo acontecia **antes** de conferir a senha, ou seja, quem errasse a senha podia disparar uma migração. | Agora confere primeiro e migra depois (com backup). |
| E6 | O código de recuperação usava scrypt (lento de propósito), que só faz sentido para senhas escolhidas por gente. | Com 100 bits aleatórios, o código usa HKDF-SHA256. **Criar cofre: 0,27 s → 0,13 s. Trocar senha pelo código: 0,40 s → 0,14 s.** |
| E7 | Embrulho da chave sem os parâmetros do scrypt: mudar esses parâmetros no futuro quebraria cofres antigos. | Formato `v2` guarda N, r e p. O `v1` continua abrindo. |
| E8 | Removido o que não era usado | `store.needs_migration`, `getSnapshot`, `formatTime`; o `busy_timeout` aparecia duplicado; o versionamento de app foi para `app/version.ts`. |
| E9 | Erros de disco (cheio, arquivo travado por antivírus) viravam "erro 500". | Viram `503 storage`, com mensagem clara na tela. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | Erro de digitação no e-mail (`gmial.com`, `hotmial.com`, `.con`) passava sem aviso, e o e-mail é o login. | **"Você quis dizer …@gmail.com?"** clicável, para os domínios mais comuns. |
| D2 | Caps Lock ligado gerava "senha incorreta" sem pista. | Aviso **"Caps Lock está ligado"** nos campos de senha. |
| D3 | Depois de um erro, a mensagem continuava ali enquanto a pessoa corrigia, e escondia a dica do campo. | O erro some ao editar o campo. |
| D4 | O foco ficava no botão depois de um erro de validação. | O foco vai para o **primeiro campo com erro**. |
| D5 | O foco inicial caía no nome do cofre, que já vem preenchido. | O foco vai para o **primeiro campo vazio**. |
| D6 | "Splash" piscava rápido quando o servidor respondia na hora. | Só aparece se a abertura passar de 350 ms. |
| D7 | Código de recuperação quebrava no meio de um grupo em telas estreitas. | A quebra só acontece entre os grupos (`7GK88 - NYFDE - …`). |
| D8 | Opção de "como começar" sem anel de foco pelo teclado. | Anel de foco visível (`has-[:focus-visible]`). |
| D9 | "Esse cofre não existe mais" deixava a pessoa presa na tela de senha. | Volta para a lista, já atualizada. |
| D10 | Com espera por excesso de tentativas, a mensagem duplicava a contagem do botão. | Só o botão mostra a contagem. |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (26 testes, todos repetidos 2 vezes sem falha):**
  - primeiro uso com sugestão de e-mail, validações, código obrigatório e download do `.txt`;
  - código errado e depois o certo digitado em minúsculas e com espaços; senha antiga recusada e a nova aceita;
  - lembrete no Início, gerar código novo em Minha conta (senha errada e depois a certa) e o lembrete sumindo;
  - idioma trocado antes de entrar e mantido ao recarregar;
  - nome repetido recusado, com foco no campo;
  - clique duplo em "Criar cofre" criando um cofre só.
- **Regras (55 testes):** sugestão de e-mail (acerta os erros comuns, não sugere nada para domínio próprio) e regras de senha.
- **Servidor:** recuperação pela API (código errado 401, senha fraca, código novo, cookie) e erro de disco virando 503.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | Trocar o banco principal podia falhar se o novo principal viesse antes do antigo na lista (o novo índice único do banco reclamava no meio). | Gravação em ordem: quem deixa de ser principal grava primeiro. |
| Q2 | Senha com acento digitada em outra "forma" Unicode (ex.: teclado do macOS) não abria o cofre. | Senhas normalizadas (NFKC), com compatibilidade para senhas já gravadas. |
| Q3 | Nomes com caracteres invisíveis (inversão de texto, nulo) podiam disfarçar um cofre na lista. | Esses caracteres são removidos. Emojis compostos (👨‍👩‍👧) continuam. |
| Q4 | E-mail com maiúsculas ou espaços em volta: o login funcionava, mas o e-mail não era normalizado em Unicode. | Normalizado na criação e na entrada. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | `synchronous=NORMAL`: numa queda de energia, as últimas gravações confirmadas podiam sumir (sem corromper). Em dados financeiros, isso pesa. | `synchronous=FULL`. Custo medido: gravar 1 lançamento leva cerca de 6 ms. |
| B2 | **Criação não atômica:** o arquivo final ia sendo escrito aos poucos. Uma falha no meio (disco cheio) ou uma listagem ao mesmo tempo via um "cofre ilegível". | Tudo vai para `<id>.creating`, que só vira `<id>.db` pronto e fechado. Sobras de uma criação interrompida são apagadas ao abrir o app. |
| B3 | "Um só banco principal" era garantido só pelo app. | Índice único parcial no banco (`ux_banks_one_primary`). A migração corrige dados antigos que tivessem dois. |
| B4 | Arquivo sem identificação. | `PRAGMA application_id` = "LUME": um cofre é reconhecível mesmo fora da pasta. |
| B5 | Migrações divididas por `;`: um `;` dentro de texto quebraria o script. | Divisão com `sqlite3.complete_statement`. |
| B6 | `SELECT * FROM owner` → classe: uma coluna nova de versão futura derrubaria a leitura. | Lê só as colunas conhecidas. |
| B7 | Esquema v2 | Colunas do código de recuperação no dono; migração com backup antes, testada a partir de um arquivo da v0.3.0 de verdade. |

Testes de banco (`tests/test_vault_db.py`, 23 testes):

- **Formato e criação:**
  - formato, marca, WAL, `integrity_check`, chaves estrangeiras e `CHECK`;
  - falha no meio da criação não deixa nada;
  - a lista nunca vê um cofre pela metade;
  - sobras de criação interrompida são limpas;
  - 4 criações simultâneas com o mesmo nome dão 1 cofre.
- **Migração e integridade:**
  - migração do formato 1 com dados ruins (senha errada não migra);
  - corrupção no meio do arquivo é detectada ao abrir;
  - SQLite que não é cofre aparece como ilegível.
- **Concorrência, queda e disco:**
  - duas gravações simultâneas: uma vence, a outra recebe "conflito";
  - leitura não espera gravação em andamento;
  - **processo morto no meio de gravações em sequência**: arquivo íntegro, e cada revisão confirmada tem exatamente o seu lançamento;
  - **disco cheio**: a gravação inteira é desfeita e nada fica pela metade.
- **Texto e senhas:**
  - texto com SQL, emojis, acentos decompostos e caracteres invisíveis;
  - senha em outra forma Unicode e senha antiga sem normalização.
- **Código de recuperação:** do começo ao fim, inclusive a senha do e-mail de envio continuando a abrir.

**Desempenho** (máquina de teste):

| Operação | Tempo |
|---|---|
| Criar cofre com 20 mil lançamentos | 0,48 s |
| Carregar os 20 mil | 0,34 s |
| Gravar 1 alteração | 6 ms |
| Listar 26 cofres | 8 ms |
| Entrar | 0,13 s |

**Recomendações para depois (não feitas agora):**

- Tabelas `STRICT`. Exige reconstruir as tabelas; a validação do app já cobre os tipos.
- Criptografar o arquivo inteiro (SQLCipher): dependência nativa e risco de perda total ao esquecer a senha.
- Guardar as sessões em disco, para sobreviver a um reinício do Lume. Hoje pede a senha de novo, sem perder dados.

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 165 testes ok (eram 139) |
| Regras do front-end | 55 ok (eram 54) |
| Navegador | 26 ok (eram 25), estáveis em 2 rodadas seguidas |
