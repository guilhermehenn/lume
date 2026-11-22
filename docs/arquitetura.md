# Arquitetura do Lume (v1.0)

Como o código está organizado e por quê. Resumo visual: [img/stack.png](img/stack.png). Para o
formato dos arquivos, veja [Modelo de dados](dados.md); para as rotas, [API local](api.md); para
as proteções, [Segurança](seguranca.md).

## Visão geral

```text
Navegador (React)  ──HTTP, só 127.0.0.1──▶  FastAPI (Python)  ──▶  cofres/<id>.db (SQLite)
   interface, regras,                        validação, sessões,     um arquivo por cofre,
   estado em memória                         gravação, backups       backups verificados
                                                   │
                                                   └──▶ internet (lista fixa): cotações e notícias;
                                                        SMTP do usuário, quando ele envia e-mail
```

O back-end serve a interface montada (`frontend/dist`) e a API em `/api`. Os scripts
`iniciar-…` sobem o servidor e abrem o navegador.

## Princípios

1. **Local primeiro.** Roda no computador do usuário, com o banco num arquivo local.
2. **Pronto para a nuvem.** As regras de negócio não dependem de FastAPI nem de SQL.
   Para ir à nuvem, troca-se o entorno (PostgreSQL, container, login), não o núcleo.
3. **Dados nunca se perdem.** Backup automático, verificado e com retenção; backup antes
   de qualquer atualização do banco e antes de qualquer restauração.
4. **Seguro por padrão.** Servidor só em 127.0.0.1, proteção contra outros sites
   (Host, Origin e cabeçalho próprio), corpo de requisição com teto (256 MB, o bastante para
   restaurar um cofre cheio), cabeçalhos de segurança, dados com permissão restrita ao
   usuário no macOS.
5. **Testado e aberto.** Regras com teste nos dois lados, testes no navegador contra o back-end
   de verdade e código sob AGPL-3.0.

## Camadas do back-end

| Pasta | Papel | Pode importar |
|---|---|---|
| `app/domain/` | Regras puras sem dependências (`money.py`: centavos, conversões com `Decimal`) | só a biblioteca padrão |
| `app/data/` | Banco interno legado (`lume.db`, da v0.2): modelos SQLModel, conexão, migrations (Alembic). Os dados do app ficam nos cofres | domain, core |
| `app/vaults/` | Cofres: arquivo SQLite por cofre (`store.py`), lista e validações (`registry.py`), senhas e chaves (`crypto.py`), sessões e limites de tentativas (`sessions.py`), casos de uso (`service.py`), backup diário e migrações (`maintenance.py`), validação dos dados (`models.py`) | services, core |
| `app/services/` | Backup, cotações (`market.py`), notícias (`news.py`), envio de e-mail por SMTP (`mailer.py`) e acesso remoto com lista de endereços permitidos e cache (`remote.py`: uma busca por vez, nova tentativa só depois de um intervalo quando a internet cai, números NaN/infinito recusados) | core |
| `app/api/` | Rotas HTTP e segurança. Só traduz HTTP | todas acima |
| `app/core/` | Configuração (`.env`), caminhos da pasta de dados (platformdirs), logging | — |
| `app/web/` | Página provisória servida quando `frontend/dist` ainda não foi montado | — |
| `app/cli.py`, `app/launcher.py` | Linha de comando (`doctor`, `backup`, `restore`, `redefinir-senha`…) e inicialização (porta livre, navegador, backup diário) | todas acima |

## Front-end

| Pasta | Papel |
|---|---|
| `src/app/` | Estrutura e navegação (`App.tsx`, `Layout.tsx`, `router.ts`), atalhos, folha de lançamento (`entrySheet.ts`), envio por e-mail (`mail.ts`), sair e trocar de cofre com gravação antes (`leave.tsx`), contagem do cofre para Minha conta (`vaultStats.ts`) e versão e endereço do repositório (`version.ts`) |
| `src/api/` | Chamadas ao back-end: `client.ts` (erros com código, cabeçalhos, aviso de sessão perdida) e `vault.ts` (cofres, dados, conta, e-mail) |
| `src/data/` | Modelo (`types.ts`), regras puras (`model.ts`), cálculos (`selectors.ts`), investimentos e códigos do IR (`investments.ts`), exportação (`exporters.ts`), relatório anual (`annualReport.ts`), backup com validação (`backup.ts`), sessão (`session.ts`), gravação por diferenças (`sync.ts`), o estado em memória (`store.ts`) e o pouco que fica no navegador (`prefs.ts`) |
| `src/screens/` | Telas. Leem com `useData()`/`useSettings()` e alteram só pelas `actions` do store. A folha de lançamento fica em `screens/entry/` (folha, campos de despesa/receita e de investimento, data com Hoje/Ontem, opções de banco e categoria); o Início, em `screens/home/` (página, mercado e notícias, boas-vindas); Lançamentos, em `screens/transactions/` (tela e `list.ts`, com as regras de mês, filtros, totais e busca, testáveis sem navegador); Investimentos, em `screens/investments/` (tela e `PositionRow.tsx`, a posição com o histórico e os atalhos já preenchidos); Bancos, em `screens/banks/` (tela, `BankSheet.tsx`, `DeleteBankDialog.tsx` e `list.ts`, com busca, ordem e o que está em uso, testáveis sem navegador); Categorias, em `screens/categories/` (tela, `CategorySheet.tsx` e `DeleteCategoryDialog.tsx`); Relatórios, em `screens/reports/` (a tela com as abas guarda o período, o ano e os filtros do personalizado entre uma aba e outra; uma peça por aba e `parts.tsx`). Períodos ("Este mês", "Últimos 3 meses"…) sem React em `lib/period.ts`. Comparação de texto sem acento em `lib/text.ts`; os ícones de categoria e os nomes das cores ficam em `data/catalog.ts` |
| `src/ui/` | Componentes: folha (sheet), campos, controle segmentado, gráficos em SVG, avisos |
| `src/i18n/` | Dicionários pt/en/es com as mesmas chaves (conferido por teste) e formatação por idioma |
| `src/lib/` | Dinheiro em centavos, datas `AAAA-MM-DD`, CSV com proteção contra fórmulas, gerador de XLSX, formatadores do `Intl` reaproveitados (`intl.ts`), períodos (`period.ts`), texto sem acento (`text.ts`) |

- **Estado:** um store externo (`useSyncExternalStore`) com o `DataState` inteiro. Toda
  alteração passa por uma função pura de `model.ts`, que valida e devolve um estado novo.
  Exclusões e restaurações podem ser desfeitas pelo aviso na tela.
- **Persistência:** os dados ficam no cofre (SQLite, no back-end). Ao entrar, o app
  carrega o estado inteiro (`GET /api/vault/data`); cada ação atualiza a tela na hora e
  `sync.ts` calcula o que mudou (inclusões/alterações e exclusões por id), junta as mudanças
  pendentes e manda em ordem (`POST /api/vault/changes`) com a **revisão** em que se baseou.
  - Outra aba gravou antes (409): o app busca o que está salvo, aplica as alterações
    pendentes por cima (o mais recente vence, item a item) e tenta de novo.
  - O Lume não respondeu: as alterações ficam na memória e o app tenta de novo, cada vez
    mais devagar; a barra lateral mostra "Sem conexão com o Lume". Fechar a aba com algo
    pendente pede confirmação.
  - Sessão expirada (401): a tela tranca; ao entrar de novo **no mesmo cofre**, o que faltava
    salvar é aplicado e gravado.
  - Sair e trocar de cofre (`app/leave.tsx`) gravam antes o que falta (`saveNow`); se o Lume
    não responder, nada sai da memória e a tela pergunta ("Ficar e esperar" ou "Sair e
    descartar"). As outras abas trancam com o motivo certo (saiu em outra janela, ou o cofre foi
    excluído) e, ao entrar de novo, continuam de onde pararam.
  - Abas se avisam por `BroadcastChannel` (dados mudaram, configurações, entrou em outro
    cofre). O cookie é um só por navegador: se outra aba abre outro cofre, esta tranca; e o
    cabeçalho `X-Vault-Id` faz o servidor recusar (409 `vault-changed`) qualquer gravação de
    uma aba que ainda mostra o cofre antigo.
  - O navegador guarda só idioma e tema (para as telas antes de entrar) e o último e-mail
    usado em cada cofre. Os dados da v0.2 (`lume.data.v1`) nunca são apagados; servem para
    a importação ao criar um cofre.
- **Exportar** (`exporters.ts`, funções puras): bancos e categorias consultados por mapas
  montados uma vez por arquivo; os 12 meses e o total do ano numa passada (`yearTotals`, os
  mesmos números de `periodSummary`, com teste); quantos lançamentos e operações cada ano tem
  numa passada (`yearCounts`, memorizado na tela); o ano que abre é o da declaração
  (`defaultTaxYear`: até junho, o ano anterior; também em Relatórios e no relatório anual).
  Arquivo vazio não é gerado (o app avisa). Formatadores do `Intl` são guardados e
  reaproveitados (`lib/intl.ts`): criar um por data deixava o CSV de 100 mil linhas 28 vezes
  mais lento. Quantidades saem sem notação científica (`csvQuantity`); datas no Excel contam
  o 29/02/1900 que não existiu. O backup é JSON compacto, com o nome na data deste computador
  (`backupFilename`), e a restauração aceita até 256 MB (`BACKUP_MAX_BYTES`), lendo e
  conferindo o arquivo uma vez só.
- **Rotas por hash** (`#/transactions`): funcionam servidas pelo FastAPI sem configuração.
- **Movimento:** animações em CSS (`fx-*` em `index.css`) e View Transitions entre páginas
  e temas. Tudo desliga com "reduzir movimento" do sistema.
- **Testes:** `tests/unit` (node --test, sem navegador) e `tests/e2e` (Playwright no build
  servido pelo **back-end de verdade** numa pasta de dados temporária,
  `scripts/e2e-server.mjs`; cotações e notícias simuladas; falha com erro no console ou
  violação de CSP). A integração contínua (`.github/workflows/ci.yml`) roda tudo em cada pull
  request; veja [Desenvolvimento](desenvolvimento.md#testes).

## Regras de ouro

- Dinheiro em **centavos inteiros** (`int`); `Decimal` para conversões. Nunca `float`.
- Data do lançamento é **DATE** (sem hora, sem fuso). Carimbos de tempo em UTC.
- Chaves primárias **UUID** (facilita sincronizar e migrar no futuro).
- No banco interno (`lume.db`), todas as tabelas pertencem a um `user`. Nos cofres, o dono é
  o próprio arquivo (um cofre = um dono).
- Compras parceladas e transferências existem só nos modelos do banco interno legado
  (`installment_group_id`, `transfer_group_id`), ainda não nos cofres nem na interface. Quando
  entrarem (veja o roteiro), a regra é: diferença de centavos na última parcela
  (R$ 100 em 3x = 33,33 + 33,33 + 33,34) e transferência como dois lançamentos ligados.
- Excluir um banco com lançamentos é uma **junção** feita numa gravação só: os lançamentos e as
  operações vão para o banco escolhido, junto com o saldo inicial e o posto de principal, e os
  relatórios salvos que filtravam o banco passam a filtrar o destino. O saldo total não muda.
- Só bibliotecas com licença compatível com a AGPL-3.0 (MIT, BSD, ISC, Apache-2.0, OFL), listadas
  em [licencas-de-terceiros.md](licencas-de-terceiros.md).

## Cofres

**Decisão:** cada cofre é um arquivo SQLite próprio (`<dados>/cofres/<uuid>.db`), acessado
com o `sqlite3` da biblioteca padrão e esquema versionado por `PRAGMA user_version`
(migrações no dicionário `_MIGRATIONS` de `store.py`, com backup antes de migrar).

Por que não colocar tudo no `lume.db` com SQLModel/Alembic:

- **Isolamento de verdade:** cofres de pessoas diferentes não dividem tabelas; copiar, fazer
  backup, mover para a lixeira ou restaurar é mexer em um arquivo.
- **Menos peças no caminho dos dados:** o formato é pequeno e estável (bancos, categorias,
  lançamentos, investimentos, relatórios, configurações, dono, e-mail de envio). Upserts
  usam `INSERT … ON CONFLICT (id) DO UPDATE`, que também existe no PostgreSQL.
- O `lume.db` da v0.2 continua como estava (backup e migrations do app); nada foi apagado.

Detalhes:

| Assunto | Como funciona |
|---|---|
| Arquivo | WAL, `synchronous=FULL` (gravação confirmada sobrevive a queda de energia), `foreign_keys=ON`, `application_id` = "LUME", permissão só do usuário (macOS); id de cofre validado (`^[0-9a-f]{32}$`) antes de virar caminho |
| Criação | atômica: grava em `<id>.creating` e só renomeia para `<id>.db` pronto e fechado; sobras são apagadas ao abrir o app. Nome único (sem diferenciar maiúsculas e acentos), conferido sob trava |
| Dono e senha | senha normalizada (NFKC) e **scrypt** (N=2^15, r=8, p=1); login em tempo parecido para e-mail certo ou errado; a senha é conferida **antes** de qualquer migração do arquivo |
| Código de recuperação | 100 bits em base32 de Crockford (`XXXXX-XXXXX-XXXXX-XXXXX`); embrulha a mesma chave de dados com HKDF-SHA256 + AES-GCM (formato `r1`). Usado uma vez: ao trocar a senha com ele, sai um novo. Mesmo limite de tentativas da entrada |
| Chave de dados | 32 bytes aleatórios, guardados "embrulhados" com AES-GCM por uma chave derivada da senha (scrypt; formato `v2` guarda os parâmetros, `v1` continua abrindo); só existem em memória enquanto há sessão. Hoje protegem a senha de app do e-mail |
| Trocar senha | re-embrulha a mesma chave (a senha do e-mail continua valendo) e encerra as outras sessões |
| Esqueci a senha | só pelo terminal, com o app fechado: `redefinir-senha` (backup antes; chave nova; a senha do e-mail precisa ser digitada de novo) |
| Sessão | cookie `lume_session` (`HttpOnly`, `SameSite=Strict`), em memória no servidor: 2 h sem uso, 24 h no máximo. As vencidas saem da memória (com a chave do cofre) a cada sessão nova e a cada troca de senha, que conta só as que ainda valiam. Sair apaga o cookie e encerra a sessão para todas as abas |
| Tentativas | 5 erros livres por cofre; depois espera 15 s, 30 s, 60 s… até 5 min |
| Gravação | `POST /api/vault/changes` com `baseRevision`; tudo numa transação; revisão +1. Lotes de até 500 mudanças conferem só as linhas tocadas (banco e categoria existem, categoria do mesmo tipo, banco/categoria excluídos sem uso); lotes maiores conferem o cofre todo (`foreign_key_check`). As chaves estrangeiras adiadas são a última barreira no `COMMIT` (falhou: `ROLLBACK` e `422`). Banco principal único garantido também por índice único parcial (`ux_banks_one_primary`). Nome de banco não se repete (sem diferença de acento ou maiúsculas, `bank_key`), conferido com o que já está no cofre; um nome repetido vindo de versão anterior não trava a edição daquele banco. Categorias seguem a mesma regra dentro de cada tipo (`category_key`: nome dado ou chave do catálogo; o nome traduzido das do catálogo é comparado no navegador, nos três idiomas), e relatórios salvos também (`_NAME_RULES`, uma regra só para as três coleções, com `text_key`). Relatório salvo só filtra por banco e categoria que existem. Os tetos do backup (`MAX_ITEMS`: 500 bancos, 500 categorias, 200 mil lançamentos, 100 mil operações, 200 relatórios) valem também ao gravar, para que todo cofre possa ser restaurado |
| Esquema | v1 (v0.3.0) → v2 (v0.3.1): colunas do código de recuperação, índice do banco principal e `application_id`. Erros de disco viram `503 storage` |
| Leitura | `GET /api/vault/data` lê revisão e dados numa única transação de leitura (`read_snapshot`): uma gravação de outra aba no meio não aparece pela metade. Nomes das colunas convertidos uma vez por coleção (100 mil lançamentos: ~0,2 s) |
| Validação | modelos pydantic com as mesmas regras do front (`app/vaults/models.py` e `src/data/backup.ts`): datas de 1900 a 2199, data e hora de criação/alteração em ISO 8601, nome de quem paga/recebe sem espaços sobrando, forma de pagamento só em despesa; nos investimentos gravados (`investment_rules`, só em `POST /api/vault/changes`, para que cofres antigos continuem abrindo): quantidade obrigatória nos tipos por cotas, rendimento sem quantidade, preço nem taxas, tipo de rendimento e IR retido só em rendimento, IR retido e taxas no máximo o valor, título do Tesouro obrigatório e CNPJ válido, numérico ou alfanumérico (letras e números nas 12 primeiras posições, dígitos verificadores pelo módulo 11 com o valor ASCII − 48); nos bancos gravados (`bank_rules`), código COMPE com 3 dígitos; nos relatórios salvos (`report_rules`), período em ordem e filtros sem repetição, com o período relativo (`preset`: "Este mês" etc.) guardado para ser recalculado ao abrir; nas categorias gravadas (`category_rules`), nome ou chave do catálogo (uma das 24 de `CATEGORY_KEYS`, iguais às de `src/data/catalog.ts`, com teste). Essas regras dos formulários não valem para um lote marcado `restore` (backup restaurado ou "Desfazer"), que volta os dados como eram, com a mesma integridade e os mesmos tetos de sempre; um lote que que grava e exclui o mesmo registro, ou traz duas versões dele, é recusado |
| Trocar tudo | restaurar um backup, carregar o exemplo e apagar tudo mandam `checkpoint` no lote (`before-restore`, `before-sample`, `before-reset`): o servidor faz uma cópia verificada do cofre antes de gravar, com a retenção de sempre; se a cópia falhar, nada é gravado (503 `storage`). `GET /api/vault/backups` diz quantas cópias o cofre tem e a mais recente |
| Configurações | tabela chave → valor (JSON), gravada por chave (duas janelas que mudam chaves diferentes não se atropelam). Na leitura, cada valor é conferido sozinho: um estragado volta ao padrão sem levar os outros; chaves desconhecidas ficam no arquivo |
| Excluir | backup "before-delete" e o arquivo vai para `cofres/lixeira/` |
| E-mail | SMTP da conta do usuário (STARTTLS/SSL; sem criptografia só para localhost), 20 envios por 10 min, anexos até 15 MB somados (codificados ficam abaixo dos 25 MB do Gmail e do Yahoo). O navegador confere o tamanho antes de enviar (`MAIL_MAX_BYTES`, igual a `mailer.MAX_ATTACHMENTS_BYTES`, com teste); o servidor confere de novo pelo tamanho em base64, antes de decodificar e sem gastar uma tentativa do limite (413 `mail-too-big`) |

## Backups

- Backups criados pela API de backup do SQLite, verificados com `integrity_check` e só então
  renomeados para o nome final.
- Cofres: `.../Lume/backups/cofres/<id>/`, um automático por dia ao abrir o app, e antes de
  migrar, de redefinir a senha, de excluir, de restaurar um backup, de carregar o exemplo e de
  apagar tudo. Banco interno: `.../Lume/backups/`.
- Retenção: 3 mais recentes + último de cada um dos 7 dias + último de cada uma das 4 semanas.
- Cópia extra opcional para OneDrive, iCloud ou pendrive (`APP_BACKUP_EXTRA_DIR`).
- A pasta de dados **nunca** fica em pasta sincronizada: o app recusa.

## Caminho para a nuvem (quando e se houver)

1. Cofres viram linhas de uma tabela (ou um schema por cofre) no PostgreSQL; o SQL de
   `store.py` já usa upsert compatível.
2. O login por cofre já existe; na nuvem ganha recuperação de senha por e-mail.
3. Empacotar a API num container; hospedar o `frontend/dist`.

Alternativa: app instalável (PyInstaller + assinatura no Mac e no Windows).
