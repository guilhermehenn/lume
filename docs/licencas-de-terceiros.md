# Licenças de terceiros

O Lume é distribuído sob a [AGPL-3.0](../LICENSE). Ele usa as bibliotecas, fontes e fontes de
dados abaixo, todas com licenças compatíveis. A lista vale para a versão 1.0; as versões exatas
estão em `backend/uv.lock` e em `frontend/package.json`.

## Back-end (Python)

### Distribuídas com o app

| Biblioteca | Para quê | Licença |
|---|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | API HTTP | MIT |
| [Starlette](https://www.starlette.io/) | base do FastAPI | BSD-3-Clause |
| [Pydantic](https://docs.pydantic.dev/) | validação dos dados | MIT |
| [Uvicorn](https://www.uvicorn.org/) | servidor HTTP | BSD-3-Clause |
| [SQLModel](https://sqlmodel.tiangolo.com/) | banco interno legado | MIT |
| [SQLAlchemy](https://www.sqlalchemy.org/) | base do SQLModel | MIT |
| [Alembic](https://alembic.sqlalchemy.org/) | migrações do banco interno legado | MIT |
| [cryptography](https://cryptography.io/) | AES-GCM, scrypt, HKDF | Apache-2.0 OU BSD-3-Clause |
| [platformdirs](https://github.com/tox-dev/platformdirs) | pasta de dados de cada sistema | MIT |

Além delas vêm as dependências indiretas listadas no `uv.lock` (por exemplo `anyio`, `idna`,
`h11`, `click`), todas com licenças permissivas (MIT, BSD ou Apache-2.0).

### Só no desenvolvimento

| Ferramenta | Licença |
|---|---|
| [pytest](https://pytest.org/) | MIT |
| [HTTPX](https://www.python-httpx.org/) | BSD-3-Clause |
| [Ruff](https://docs.astral.sh/ruff/) | MIT |

## Front-end (JavaScript)

### Incluídas no build

| Biblioteca | Para quê | Licença |
|---|---|---|
| [React](https://react.dev/) e React DOM | interface | MIT |
| [Headless UI](https://headlessui.com/) | folhas, menus e diálogos acessíveis | MIT |
| [react-icons](https://react-icons.github.io/react-icons/) | ícones (conjunto [Lucide](https://lucide.dev/), ISC) | MIT |
| [clsx](https://github.com/lukeed/clsx) | classes CSS | MIT |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | classes CSS | MIT |
| [Zod](https://zod.dev/) | validação do backup | MIT |
| [JSZip](https://stuk.github.io/jszip/) | planilha XLSX | MIT OU GPL-3.0 (usada sob MIT) |

### Só no desenvolvimento e na montagem

| Ferramenta | Licença |
|---|---|
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 |
| [Vite](https://vite.dev/) e `@vitejs/plugin-react` | MIT |
| [Tailwind CSS](https://tailwindcss.com/) e `@tailwindcss/postcss` | MIT |
| [esbuild](https://esbuild.github.io/) | MIT |
| [Playwright](https://playwright.dev/) | Apache-2.0 |
| [PostCSS](https://postcss.org/) | MIT |
| `@types/react`, `@types/react-dom` | MIT |

## Fontes e imagens

| Item | Licença | Arquivo |
|---|---|---|
| Fonte [Inter](https://rsms.me/inter/) | SIL Open Font License 1.1 | `frontend/public/fonts/LICENSE-Inter.txt` |
| Ícone e logotipo do Lume | AGPL-3.0, como o resto do projeto | `frontend/public/favicon.svg` |

## Fontes de dados

O Lume consulta estes serviços públicos e gratuitos (só o back-end, só estes endereços). Os
dados pertencem às respectivas fontes, que são citadas na tela.

| Serviço | Dados | Observação |
|---|---|---|
| [AwesomeAPI](https://docs.awesomeapi.com.br/) | dólar, euro, Bitcoin e Ethereum | API pública e gratuita |
| [Banco Central do Brasil, SGS](https://www3.bcb.gov.br/sgspub/) | Selic meta, CDI, IPCA | dados abertos |
| [InfoMoney](https://www.infomoney.com.br/) | notícias (RSS) | só título, link e horário; o texto fica no site |
| [Money Times](https://www.moneytimes.com.br/) | notícias (RSS) | idem |

## Como manter esta lista

Ao adicionar ou trocar uma dependência, atualize esta página no mesmo pull request. Para conferir
as licenças instaladas:

```bash
# back-end (em backend/)
uv run --with pip-licenses pip-licenses --summary
# front-end (em frontend/)
npx license-checker --summary
```
