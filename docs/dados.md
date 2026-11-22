# Modelo de dados

Como o Lume guarda os dados: a pasta de dados, o arquivo do cofre, os formatos de valores, os
limites, o formato do backup e como o esquema evolui.

## Sumário

- [Pasta de dados](#pasta-de-dados)
- [O arquivo do cofre](#o-arquivo-do-cofre)
- [Tabelas](#tabelas)
- [Formatos](#formatos)
- [Limites](#limites)
- [Configurações do cofre](#configurações-do-cofre)
- [Formato do backup (JSON)](#formato-do-backup-json)
- [Backups automáticos](#backups-automáticos)
- [Migrações](#migrações)
- [O que fica no navegador](#o-que-fica-no-navegador)
- [Banco interno legado (lume.db)](#banco-interno-legado-lumedb)

## Pasta de dados

| Sistema | Pasta padrão |
|---|---|
| Windows | `%LOCALAPPDATA%\Lume\` |
| macOS | `~/Library/Application Support/Lume/` |

A pasta pode ser trocada com `APP_DATA_DIR` no `.env` (veja [Operação](operacao.md#configuração-env)).
O app **recusa** pastas sincronizadas (OneDrive, iCloud Drive, Dropbox, Google Drive): a
sincronização pode corromper um SQLite aberto.

```text
Lume/
├── cofres/
│   ├── <id>.db              um arquivo por cofre
│   ├── <id>.db-wal, -shm    arquivos temporários do SQLite (modo WAL) enquanto o cofre está aberto
│   └── lixeira/             cofres excluídos pelo app (nada é apagado de verdade)
├── backups/
│   ├── cofres/<id>/         backups de cada cofre
│   └── *.db                 backups do banco interno legado
├── lume.db                  banco interno legado (v0.2)
├── cache/                   cotações e notícias
└── logs/                    registros do servidor
```

`<id>` é um UUID em hexadecimal, sem hífens (32 caracteres). O servidor confere esse formato
(`^[0-9a-f]{32}$`) antes de usar o id num caminho.

## O arquivo do cofre

Cada cofre é um banco **SQLite** autocontido, acessado com o módulo `sqlite3` da biblioteca
padrão do Python (`backend/app/vaults/store.py`).

| Propriedade | Valor |
|---|---|
| Diário | `journal_mode=WAL`: leituras não esperam gravações |
| Durabilidade | `synchronous=FULL`: uma gravação confirmada sobrevive a queda de energia |
| Integridade | `foreign_keys=ON` em toda conexão; chaves estrangeiras conferidas no `COMMIT` |
| Concorrência | `busy_timeout` de 10 s; gravações com `BEGIN IMMEDIATE` |
| Marca do arquivo | `PRAGMA application_id = 0x4C554D45` ("LUME") |
| Versão do esquema | `PRAGMA user_version` (atual: **2**) |
| Permissão | só o usuário dono do arquivo (macOS) |
| Criação | atômica: grava `<id>.creating` e só renomeia para `<id>.db` quando está pronto e fechado |

Um cofre é um documento: copiar, mover ou fazer backup é mexer num arquivo. Qualquer ferramenta
de SQLite consegue abri-lo (veja [Segurança](seguranca.md#limites-conhecidos)).

## Tabelas

### `meta`

Pares chave → valor sobre o próprio arquivo.

| Chave | Conteúdo |
|---|---|
| `vault_id` | id do cofre |
| `name` | nome do cofre |
| `created_at`, `last_opened_at` | datas em UTC (ISO 8601) |
| `revision` | número da última gravação (veja [API](api.md#lote-de-mudanças)) |

### `owner`

O dono do cofre (uma linha).

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | |
| `first_name`, `last_name` | TEXT | |
| `email` | TEXT | e-mail de acesso |
| `photo` | TEXT | imagem JPEG, PNG ou WebP em `data:` URL, até 300 KB |
| `password_hash` | TEXT | scrypt, com sal e parâmetros |
| `key_wrap` | TEXT | chave de dados embrulhada pela senha (AES-GCM) |
| `recovery_hash`, `recovery_wrap` | TEXT | hash do código de recuperação e a chave de dados embrulhada por ele |
| `recovery_created_at`, `recovery_confirmed_at` | TEXT | quando o código foi gerado e quando o dono confirmou que guardou |
| `created_at`, `updated_at`, `password_changed_at` | TEXT | UTC |

### `settings`

Chave → valor em JSON. Uma linha por configuração (veja [Configurações do cofre](#configurações-do-cofre)).

### `mail_settings`

E-mail de envio de relatórios (no máximo uma linha, `id = 1`): `provider`, `host`, `port`,
`security` (`starttls`, `ssl` ou `none`), `username`, `from_name`, `password_enc` (senha de app
criptografada com a chave de dados) e `updated_at`.

### `banks`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | TEXT PK | |
| `name` | TEXT | 1 a 60 caracteres, único sem diferenciar acentos e maiúsculas |
| `code` | TEXT | código COMPE, 3 dígitos (opcional) |
| `kind` | TEXT | `checking`, `digital`, `savings`, `broker`, `cash`, `other` |
| `color` | TEXT | cor de destaque |
| `initial_balance` | INTEGER | centavos; pode ser negativo |
| `is_primary` | INTEGER | 0/1; índice único parcial `ux_banks_one_primary` garante um só |
| `created_at`, `updated_at` | TEXT | |

### `categories`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | TEXT PK | |
| `kind` | TEXT | `expense` ou `income` (`CHECK`) |
| `name_key` | TEXT | chave do catálogo (uma das 24 prontas), traduzida na tela |
| `name` | TEXT | nome dado pelo usuário (até 60); usado quando não há `name_key` |
| `icon`, `color` | TEXT | |
| `created_at`, `updated_at` | TEXT | |

### `transactions`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | TEXT PK | |
| `kind` | TEXT | `expense` ou `income` |
| `amount` | INTEGER | centavos, maior que zero (`CHECK`) |
| `date` | TEXT | `AAAA-MM-DD`, de 1900 a 2199 |
| `bank_id` | TEXT FK → `banks` | |
| `category_id` | TEXT FK → `categories` | categoria do mesmo tipo do lançamento |
| `counterparty` | TEXT | quem pagou ou recebeu, até 120 caracteres |
| `payment_method` | TEXT | só em despesa: `pix`, `debit`, `credit`, `boleto`, `cash`, `transfer` |
| `note` | TEXT | até 500 caracteres |
| `created_at`, `updated_at` | TEXT | |

Índices: `date`, `bank_id`, `category_id`.

### `investments`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | TEXT PK | |
| `operation` | TEXT | `contribution` (aplicação), `redemption` (resgate), `earning` (rendimento) |
| `type` | TEXT | `savings`, `cdb`, `lci_lca`, `cri_cra`, `debenture`, `treasury`, `stock`, `fii`, `fiagro`, `etf`, `bdr`, `fund`, `pension`, `crypto`, `gold`, `other` |
| `amount` | INTEGER | centavos, maior que zero |
| `date` | TEXT | `AAAA-MM-DD` |
| `bank_id` | TEXT FK → `banks` | banco ou corretora |
| `asset` | TEXT | nome ou código do ativo, até 80 caracteres |
| `quantity` | REAL | cotas; obrigatória nos tipos por cotas |
| `unit_price`, `fees`, `tax_withheld` | INTEGER | centavos |
| `issuer`, `issuer_cnpj` | TEXT | emissor e CNPJ (numérico ou alfanumérico) |
| `indexer`, `rate`, `maturity` | TEXT | renda fixa: `cdi`, `ipca`, `prefixed`, `selic`, `other`; taxa; vencimento |
| `daily_liquidity`, `incentivized`, `fixed_income_etf` | INTEGER | 0/1 |
| `fund_class`, `plan`, `crypto_class`, `treasury_title`, `earning_kind` | TEXT | detalhes por tipo |
| `note` | TEXT | até 500 caracteres |
| `created_at`, `updated_at` | TEXT | |

Índices: `date`, `bank_id`.

### `reports`

Relatórios salvos: `id`, `name` (até 60, único), `filters` (JSON: período, `preset`, tipos,
bancos, categorias, texto), `group_by` (`category`, `bank`, `month`, `counterparty`) e
`created_at`.

## Formatos

| Dado | Formato | Por quê |
|---|---|---|
| Dinheiro | **centavos inteiros** (`INTEGER`) | sem erro de arredondamento; `float` nunca é usado para dinheiro |
| Data de lançamento | texto `AAAA-MM-DD` | o dia do lançamento não depende de fuso horário |
| Carimbos de tempo | ISO 8601 em UTC | |
| Ids | UUID | podem ser criados no navegador e facilitam mesclar dados |
| Booleanos | `0`/`1` no SQLite, `true`/`false` na API | |
| Nomes na API | `camelCase` (`bankId`); no SQLite, `snake_case` (`bank_id`) | conversão automática |

## Limites

Os mesmos tetos valem ao gravar, ao criar um cofre com dados e ao restaurar um backup, para que
todo cofre possa ser exportado e restaurado (`MAX_ITEMS` em `backend/app/vaults/models.py` e em
`frontend/src/data/backup.ts`).

| Coleção | Máximo por cofre |
|---|---|
| Bancos | 500 |
| Categorias | 500 |
| Lançamentos | 200.000 |
| Operações de investimento | 100.000 |
| Relatórios salvos | 200 |

| Outro limite | Valor |
|---|---|
| Valor de um lançamento | 99.999.999.999,99 (`MAX_CENTS`) |
| Datas | anos de 1900 a 2199 |
| Arquivo de backup (`.json`) | 256 MB (um cofre cheio tem cerca de 120 MB) |
| Corpo de uma requisição | 256 MB |
| Foto do dono | 300 KB |

## Configurações do cofre

Guardadas na tabela `settings`, uma linha por chave, com o valor em JSON. Na leitura, cada valor
é conferido sozinho: um valor estragado volta ao padrão sem levar os outros; chaves desconhecidas
ficam no arquivo e não aparecem.

| Chave no arquivo | Na API e no backup | Valores | Padrão |
|---|---|---|---|
| `language` | `language` | `pt`, `en`, `es` | `pt` |
| `currency` | `currency` | `BRL`, `USD`, `EUR` (só a exibição) | `BRL` |
| `theme` | `theme` | `dark`, `light`, `system` | `dark` |
| `hide_values` | `hideValues` | booleano | `false` |
| `onboarding_done` | `onboardingDone` | booleano | `false` |
| `email_copies` | `emailCopies` | booleano: manda por e-mail cada arquivo exportado | `false` |

## Formato do backup (JSON)

Gerado em **Configurações → Fazer backup** ou **Exportar → Cópia de segurança**
(`lume-backup-AAAA-MM-DD.json`), e lido por **Restaurar backup**.

```json
{
  "app": "lume",
  "format": 1,
  "exportedAt": "2026-11-21T18:30:00.000Z",
  "data": {
    "version": 1,
    "banks": [],
    "categories": [],
    "transactions": [],
    "investments": [],
    "reports": []
  },
  "settings": {
    "language": "pt",
    "currency": "BRL",
    "theme": "dark",
    "hideValues": false,
    "onboardingDone": true,
    "emailCopies": false
  }
}
```

- Os registros seguem as colunas das [tabelas](#tabelas), em `camelCase`.
- `format` só muda se o arquivo deixar de ser compatível. A leitura exige `"app": "lume"`.
- O arquivo é conferido inteiro (tipos, limites, referências entre bancos, categorias e
  lançamentos) antes de qualquer gravação. Antes de trocar os dados, o servidor faz uma cópia
  verificada do cofre.
- O backup **não** contém o dono, a senha, o código de recuperação nem o e-mail de envio: ele
  pode ser restaurado em qualquer cofre. Configurações inválidas no arquivo são ignoradas; os
  dados, não: um arquivo com dados inválidos é recusado inteiro.

## Backups automáticos

Feitos pela API de backup do SQLite, conferidos com `PRAGMA integrity_check` e só então
renomeados para o nome final.

| Quando | Motivo no nome do arquivo |
|---|---|
| Ao abrir o app, uma vez por dia, para cada cofre | `auto` |
| Pelo terminal (`backup`) | `manual` |
| Antes de migrar o esquema | `pre-migration` |
| Antes de criar uma senha nova com o código de recuperação | `before-recovery` |
| Antes de redefinir a senha pelo terminal ou de apagar tudo pelo app | `before-reset` |
| Antes de restaurar um backup ou carregar o exemplo pelo app | `before-restore`, `before-sample` |
| Antes de restaurar um backup pelo terminal | `pre-restore` |
| Antes de excluir o cofre | `before-delete` |

**Retenção:** os 3 mais recentes, mais o último de cada um dos 7 últimos dias e o último de cada
uma das 4 últimas semanas (`APP_BACKUP_KEEP_DAILY`, `APP_BACKUP_KEEP_WEEKLY`). Uma cópia extra
pode ir para outra pasta (`APP_BACKUP_EXTRA_DIR`).

## Migrações

O esquema evolui por migrações numeradas no dicionário `_MIGRATIONS` de
`backend/app/vaults/store.py`, aplicadas em ordem até `SCHEMA_VERSION`:

| Versão | Lume | Mudança |
|---|---|---|
| 1 | 0.3.0 | Esquema inicial |
| 2 | 0.3.1 | Colunas do código de recuperação, índice do banco principal único, `application_id` |

Regras:

- a senha do dono é conferida **antes** de migrar;
- o app faz um backup antes de migrar;
- cada migração roda numa transação; se falhar, o arquivo fica como estava;
- um cofre com `user_version` maior que o do app é recusado (`too-new`), sem alterações.

Como escrever uma migração: [Desenvolvimento](desenvolvimento.md#mudar-o-formato-do-cofre).

## O que fica no navegador

O navegador (`localStorage`) guarda só o que é útil antes de entrar num cofre:

| Chave | Conteúdo |
|---|---|
| `lume.prefs.v1` | idioma e tema da tela de entrada |
| `lume.lastEmail.<id>` | último e-mail usado em cada cofre |
| `lume.data.v1`, `lume.settings.v1` | dados da v0.2, nunca apagados; usados só para importar ao criar um cofre |

## Banco interno legado (`lume.db`)

O `lume.db` (SQLModel + Alembic, em `backend/app/data/`) vem da v0.2 e continua sendo criado,
migrado e copiado como antes. **Os dados do app não ficam nele**: ficam nos cofres. Ele guarda
modelos de compras parceladas e transferências que ainda não chegaram aos cofres e será revisto
quando essas funções entrarem no [roteiro](../README.md#roteiro).
