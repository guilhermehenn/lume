# Desenvolvimento

Guia para quem vai mexer no código: ambiente, estrutura, convenções, testes, traduções,
integração contínua e como lançar uma versão. Antes de abrir um pull request, leia também o
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Sumário

- [Ambiente](#ambiente)
- [Rodar em modo de desenvolvimento](#rodar-em-modo-de-desenvolvimento)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Convenções de código](#convenções-de-código)
- [Testes](#testes)
- [Traduções](#traduções)
- [Mudar o formato do cofre](#mudar-o-formato-do-cofre)
- [Adicionar uma rota na API](#adicionar-uma-rota-na-api)
- [Dependências](#dependências)
- [Integração contínua](#integração-contínua)
- [Lançar uma versão](#lançar-uma-versão)

## Ambiente

| Ferramenta | Versão | Para quê |
|---|---|---|
| Git | qualquer recente | código |
| [uv](https://docs.astral.sh/uv/) | recente | Python 3.13, dependências e execução do back-end |
| Node.js | 22 LTS ou mais novo | interface, testes de regras e testes no navegador |
| Edge ou Chrome | atualizado | testes no navegador (Playwright usa o navegador instalado) |
| Editor | VS Code recomendado | o repositório traz `.vscode/` e `.editorconfig` |

Os scripts `configurar-windows.bat` e `configurar-macos.command` instalam tudo isso. Para
preparar à mão:

```bash
git clone https://github.com/guilhermehenn/lume.git
cd lume
cp .env.example .env            # Windows: copy .env.example .env

cd backend
uv sync                          # cria .venv com Python 3.13 e as dependências travadas
uv run python -m app.cli setup   # pasta de dados, banco interno e primeiro backup
cd ../frontend
npm install
npm run build                    # gera frontend/dist, servido pelo back-end
```

> Para não misturar os dados de desenvolvimento com os seus, use outra pasta de dados no `.env`
> (`APP_DATA_DIR`) ou outro `APP_NAME`.

## Rodar em modo de desenvolvimento

Dois terminais:

```bash
# 1) Back-end (na raiz do projeto)
./iniciar-macos.command          # ou iniciar-windows.bat; ou, em backend/: uv run python -m app

# 2) Interface com recarga automática (em frontend/)
npm run dev                      # http://localhost:5173, repassa /api para 127.0.0.1:8765
```

A documentação interativa da API fica em `http://127.0.0.1:8765/api/docs`.

## Estrutura do repositório

```text
lume/
├── .github/              CI, modelos de issue e PR, Dependabot
├── backend/              API local (Python 3.13 + FastAPI + SQLite)
│   ├── app/
│   │   ├── api/          rotas HTTP e o middleware de segurança
│   │   ├── vaults/       cofres: arquivo, senhas, sessões, validação, casos de uso
│   │   ├── services/     backup, cotações, notícias, e-mail, acesso remoto
│   │   ├── core/         configuração (.env), caminhos, logs
│   │   ├── domain/       regras puras (dinheiro)
│   │   ├── data/         banco interno legado (SQLModel + Alembic)
│   │   ├── web/          página de espera quando a interface não foi montada
│   │   ├── cli.py        linha de comando (doctor, backup, restore, redefinir-senha…)
│   │   └── main.py       criação do app FastAPI
│   ├── tests/            pytest
│   ├── pyproject.toml    dependências e configuração do ruff e do pytest
│   └── uv.lock           versões travadas (vai para o Git)
├── frontend/             interface (React 19 + TypeScript + Vite + Tailwind CSS 4)
│   ├── src/
│   │   ├── app/          estrutura, rotas, atalhos, saída e troca de cofre, versão
│   │   ├── screens/      telas
│   │   ├── ui/           componentes (folhas, campos, gráficos, avisos)
│   │   ├── api/          chamadas ao back-end
│   │   ├── data/         modelo, regras, cálculos, exportação, sessão, gravação
│   │   ├── i18n/         pt, en, es
│   │   └── lib/          dinheiro, datas, CSV, XLSX, períodos, texto
│   ├── tests/unit/       testes de regras (node --test)
│   ├── tests/e2e/        testes no navegador (Playwright)
│   └── scripts/          executor dos testes de regras, servidor dos E2E
├── setup/                scripts de configuração (PowerShell e Bash)
├── scripts/              scripts de inicialização
└── docs/                 esta documentação
```

A arquitetura (camadas, fluxo de dados, decisões) está em [arquitetura.md](arquitetura.md).

## Convenções de código

### Gerais

- **Dinheiro em centavos inteiros.** Nunca `float` (no Python, `Decimal` só para converter).
- **Datas de lançamento** como texto `AAAA-MM-DD`; carimbos de tempo em UTC, ISO 8601.
- **Ids** UUID, criados no navegador.
- **Comentários em português**, explicando o porquê (o quê o código já diz).
- **Mesma regra nos dois lados:** validações do navegador (`src/data/backup.ts`, `model.ts`) e do
  servidor (`app/vaults/models.py`) andam juntas, com teste que confere constantes iguais (por
  exemplo `MAX_ITEMS`, `MAIL_MAX_BYTES`, `CATEGORY_KEYS`).

### Back-end (Python)

- `ruff format` (linha de 100) e `ruff check` com as regras `E, F, I, UP, B, SIM, S`.
- Camadas: `api` só traduz HTTP; regras e casos de uso ficam em `vaults/` e `services/`.
- Erros de negócio levantam `VaultError(code, message)`; a rota converte o `code` em status HTTP
  (veja [API](api.md#erros)).
- SQL com parâmetros (`?`), nunca com texto montado a partir de dados do usuário.
- Acesso à internet só por `services/remote.py`, que confere a lista de endereços.

### Front-end (TypeScript/React)

- TypeScript `strict`; sem `any` sem justificativa.
- Estilo do código existente: 2 espaços, aspas simples, sem ponto e vírgula.
- **Estado:** as telas leem com `useData()`/`useSettings()` e alteram só pelas `actions` do store
  (`src/data/store.ts`). Toda alteração passa por uma função pura de `model.ts`.
- **Regras sem React:** cálculos e filtros em módulos puros (`list.ts`, `selectors.ts`,
  `exporters.ts`, `lib/period.ts`), testáveis com `node --test`.
- **Formatação por idioma** pelo `i18n` (datas, números, moeda). Formatadores do `Intl` são
  reaproveitados (`lib/intl.ts`).
- **Acessibilidade:** botões com nome, campos com rótulo, foco visível, teclado em tudo e
  animações desligadas com "reduzir movimento".
- **Nada de fora:** sem CDN, fontes externas ou chamadas a outros sites (a CSP bloqueia e os
  testes falham).

### Commits e branches

[Conventional Commits](https://www.conventionalcommits.org/pt-br/) em português
(`feat(relatorios): …`, `fix: …`), com `Signed-off-by` (`git commit -s`). Branches a partir do
`main`: `feat/…`, `fix/…`, `docs/…`.

## Testes

| Suíte | Onde | Comando | O que cobre |
|---|---|---|---|
| Back-end | `backend/tests/` | `uv run pytest` | cofres, API, segurança, backups, migrações, regras de dados, e-mail, cotações e notícias (com a rede simulada) |
| Lint | `backend/` | `uv run ruff check .` e `uv run ruff format --check .` | estilo e erros comuns |
| Tipos | `frontend/` | `npm run typecheck` | TypeScript |
| Regras | `frontend/tests/unit/` | `npm run test:unit` | modelo, cálculos, listas, exportação, períodos, traduções (mesmas chaves nos três idiomas) |
| Navegador | `frontend/tests/e2e/` | `npm run build && npm run test:e2e` | fluxos completos de cada tela, no back-end de verdade |

Na versão 1.0 são 371 testes no back-end, 146 de regras e 95 no navegador.

### Testes no navegador (E2E)

- Rodam no **build** (`frontend/dist`), servido pelo **back-end de verdade** numa pasta de dados
  temporária (`scripts/e2e-server.mjs`, porta 4173). Cotações e notícias são simuladas.
- Falham com qualquer erro no console ou violação de CSP.
- Variáveis úteis:

| Variável | Efeito |
|---|---|
| `LUME_BROWSER` | `msedge` ou `chrome` (padrão: Edge no Windows, Chrome nos demais) |
| `LUME_CHROME_PATH` | caminho de um navegador específico |
| `LUME_E2E_NOW` | fixa o relógio do navegador, por exemplo `2027-01-01T10:00:00` |
| `LUME_E2E_PYTHON` | usa este Python em vez de `uv run` para subir o back-end |

- Regras que dependem da data (virada de mês e de ano, "Hoje", ano da declaração) devem passar
  também com o relógio fixado em datas difíceis:

```bash
LUME_E2E_NOW=2027-01-01T10:00:00 npm run test:e2e   # primeiro dia do ano
LUME_E2E_NOW=2026-06-15T21:30:00 npm run test:e2e   # noite (UTC já é o dia seguinte)
```

- Para caçar testes instáveis: `npx playwright test --repeat-each=5`.
- Um arquivo ou um teste: `npx playwright test tests/e2e/banks.spec.ts -g "junção"`.

### O que testar

- Toda correção de erro vem com um teste que falhava antes.
- Regra nova: teste de regra (rápido) e, se tiver tela, um teste no navegador do fluxo principal.
- Mudança no servidor que grava dados: teste de API **e** teste direto no arquivo do cofre.
- Mudança de formato: teste abrindo um cofre da versão anterior.

## Traduções

Os textos ficam em `frontend/src/i18n/`: `pt.ts` (referência), `en.ts` e `es.ts`. Um teste
confere que os três têm **as mesmas chaves**.

- Toda frase nova entra nos três arquivos no mesmo pull request.
- Variáveis entre chaves: `'{count} lançamentos'`.
- Plurais com sufixos `_zero`, `_one` e `_other`. Em português, 0 usa a forma do singular nas regras
  do `Intl`, então frases com zero precisam de `_zero` ("Nenhum banco", não "0 banco").
- Datas, números e moeda são formatados pelo idioma; nunca monte "R$" à mão.
- Escreva como quem usa fala: direto, sem jargão, sem "por favor" demais. Mensagens de erro dizem o
  que aconteceu e o que fazer.

Quer traduzir para um idioma novo? Abra uma issue antes: além do arquivo de textos, o idioma
precisa entrar nas configurações (`language`), no servidor (`models.py`) e nos testes.

## Mudar o formato do cofre

O esquema do cofre é versionado por `PRAGMA user_version` e evolui por migrações em
`backend/app/vaults/store.py`.

1. Some 1 a `SCHEMA_VERSION` e acrescente a migração em `_MIGRATIONS`:

   ```python
   SCHEMA_VERSION = 3

   _MIGRATIONS: dict[int, str] = {
       1: """...""",
       2: """...""",
       # v1.1: comentário dizendo o que muda e por quê.
       3: """
       ALTER TABLE transactions ADD COLUMN tags TEXT;
       """,
   }
   ```

2. Prefira mudanças **aditivas** (colunas novas com valor padrão, tabelas novas). Para mudar uma
   coluna, crie a nova, copie os dados e deixe a antiga, ou recrie a tabela na mesma migração.
3. Atualize as leituras e gravações em `store.py`, a validação em `models.py` e, no front, os tipos
   (`types.ts`), a validação do backup (`backup.ts`) e a gravação (`sync.ts`).
4. Escreva testes: um cofre criado na versão anterior abre, migra e mantém os dados; a migração
   roda só uma vez; um backup `.json` antigo continua restaurando.
5. Registre a mudança em [dados.md](dados.md#migrações) e no `CHANGELOG.md`. Mudança de formato
   pede versão **MENOR** (ou **MAIOR**, se backups antigos deixarem de restaurar).

O Lume já faz backup antes de migrar, confere a senha antes de mexer no arquivo e recusa cofres de
versões mais novas (`too-new`).

## Adicionar uma rota na API

1. Caso de uso em `app/vaults/service.py` (ou num serviço), levantando `VaultError` com um `code`.
2. Rota em `app/api/routes/`, com corpo pydantic `extra="forbid"` e `max_length` em todo texto.
3. Se o `code` for novo, inclua-o em `_STATUS` (senão vira `422`) e na tradução das mensagens de
   erro no front.
4. Chamada em `frontend/src/api/` (o `client.ts` já manda `X-App-Request` e trata erros).
5. Testes de API em `backend/tests/` e o fluxo em `frontend/tests/e2e/`.
6. Documente em [api.md](api.md).

## Dependências

- Toda dependência nova precisa de uma issue antes, com o motivo e o peso que ela traz.
- Licença compatível com a AGPL-3.0: MIT, BSD, ISC, Apache-2.0, OFL (fontes) e similares.
- Back-end: `uv add <pacote>` (ou `uv add --dev`), que atualiza `pyproject.toml` e `uv.lock`.
- Front-end: `npm install <pacote>`; prefira o que o navegador já faz.
- Atualize [licencas-de-terceiros.md](licencas-de-terceiros.md).

## Integração contínua

`.github/workflows/ci.yml` roda em todo push no `main` e em todo pull request:

| Job | O quê |
|---|---|
| Back-end | `uv sync --locked`, `ruff check`, `ruff format --check` e `pytest`, em Ubuntu, Windows e macOS |
| Front-end | `npm install`, `typecheck`, `test:unit` e `build` |
| Testes no navegador | E2E com o Chrome do Ubuntu, usando o build do job anterior; guarda os resultados se falhar |

O Dependabot (`.github/dependabot.yml`) abre PRs mensais para as dependências do front-end e as
actions. Para o back-end, rode `uv lock --upgrade` num PR de manutenção.

## Lançar uma versão

O Lume segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/).

1. Atualize a versão em **todos** estes arquivos:

   | Arquivo | Campo |
   |---|---|
   | `frontend/src/app/version.ts` | `APP_VERSION` |
   | `frontend/package.json` | `version` |
   | `backend/app/__init__.py` | `__version__` |
   | `backend/pyproject.toml` | `version` |
   | `backend/uv.lock` | rode `uv lock` em `backend/` depois de mudar o `pyproject.toml` |

2. No `CHANGELOG.md`, mova o que está em **Não lançado** para uma seção nova
   `## [X.Y.Z] - AAAA-MM-DD` e atualize os links no fim do arquivo.
3. Rode todas as suítes (inclusive E2E com `LUME_E2E_NOW` em datas difíceis).
4. Faça o commit (`chore: versão X.Y.Z`), crie a tag e envie:

   ```bash
   git tag -a vX.Y.Z -m "Lume X.Y.Z"
   git push origin main --tags
   ```

5. O workflow `.github/workflows/release.yml` confere se a tag bate com a versão do código, monta a
   interface, empacota `lume-vX.Y.Z.zip` (com `frontend/dist` já pronto) e publica a release com as
   notas do `CHANGELOG.md`.
6. Confira a release no GitHub e teste o ZIP numa máquina limpa (Windows e macOS).
