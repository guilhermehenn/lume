# Como contribuir com o Lume

Obrigado pelo interesse! O Lume é mantido por voluntários, e toda ajuda conta: relatar um
erro, sugerir uma ideia, melhorar um texto, traduzir ou escrever código.

Ao participar, você concorda em seguir o [código de conduta](CODE_OF_CONDUCT.md).

## Sumário

- [Formas de contribuir](#formas-de-contribuir)
- [Antes de começar](#antes-de-começar)
- [Preparar o ambiente](#preparar-o-ambiente)
- [Fluxo de trabalho](#fluxo-de-trabalho)
- [Padrões do projeto](#padrões-do-projeto)
- [Testes](#testes)
- [Checklist do pull request](#checklist-do-pull-request)
- [Licença das contribuições](#licença-das-contribuições)

## Formas de contribuir

| Quero… | Como |
|---|---|
| Relatar um erro | Abra uma [issue de erro](https://github.com/guilhermehenn/lume/issues/new?template=bug_report.yml) com os passos para reproduzir. |
| Sugerir uma funcionalidade | Abra uma [issue de sugestão](https://github.com/guilhermehenn/lume/issues/new?template=feature_request.yml) contando o problema que ela resolve. |
| Relatar uma falha de segurança | **Não abra uma issue pública.** Siga o [SECURITY.md](SECURITY.md). |
| Tirar uma dúvida | Use as [Discussions](https://github.com/guilhermehenn/lume/discussions). |
| Melhorar a documentação | Abra um pull request direto: textos em `docs/` e nos `README`. |
| Traduzir | Os textos ficam em `frontend/src/i18n/` (`pt.ts`, `en.ts`, `es.ts`). Veja [Traduções](docs/desenvolvimento.md#traduções). |
| Escrever código | Escolha uma issue com o rótulo `good first issue` ou `help wanted` e comente que vai pegar. |

## Antes de começar

- **Procure antes** nas issues e nas discussions: talvez alguém já esteja tratando do assunto.
- **Para mudanças grandes**, como uma tela nova, uma mudança no formato do cofre ou uma
  dependência nova, abra antes uma issue para combinar a abordagem. Isso evita trabalho perdido.
- **Uma coisa por pull request.** É mais fácil revisar, testar e desfazer se for preciso.

## Preparar o ambiente

Você vai precisar de Git, [uv](https://docs.astral.sh/uv/) (que instala o Python 3.13) e Node.js 22
ou mais novo. Os scripts `configurar-windows.bat` e `configurar-macos.command` instalam tudo.

```bash
git clone https://github.com/<seu-usuario>/lume.git
cd lume/backend && uv sync && cd ..
cd frontend && npm install && npm run build && cd ..
```

O guia completo está em [docs/desenvolvimento.md](docs/desenvolvimento.md).

## Fluxo de trabalho

1. Faça um **fork** e crie um branch a partir do `main`:
   `feat/orcamento-por-categoria`, `fix/saldo-com-data-futura`, `docs/guia-de-backup`.
2. Faça commits pequenos, com mensagem no formato
   [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português:

   ```text
   feat(relatorios): comparar com o período anterior
   fix(lancamentos): busca pelo valor com centavos
   docs: como restaurar um backup pelo terminal
   ```

   Tipos mais usados: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`.
3. Assine cada commit (veja [Licença das contribuições](#licença-das-contribuições)):
   `git commit -s`.
4. Rode os testes (abaixo) e abra o **pull request** para o `main`, preenchendo o modelo.
5. A integração contínua roda os testes no GitHub. Um mantenedor revisa, e podem aparecer
   pedidos de ajuste. Depois de aprovado, o PR entra com *squash merge*.

## Padrões do projeto

Os principais estão abaixo; o detalhe fica em [docs/desenvolvimento.md](docs/desenvolvimento.md).

- **Dinheiro em centavos inteiros**, nunca `float`. Datas de lançamento como texto `AAAA-MM-DD`,
  sem hora nem fuso.
- **Regras de negócio em funções puras** (`frontend/src/data/model.ts`, `backend/app/vaults/models.py`),
  com teste. As telas só leem o estado e chamam as `actions` do store.
- **As mesmas regras nos dois lados:** o que o navegador valida, o servidor também valida.
  Quando mudar um limite ou uma regra, mude nos dois e cubra com teste.
- **Todo texto da interface fica nas traduções**, nos três idiomas, com as mesmas chaves (há
  teste que confere). Escreva em português claro e direto, sem jargão.
- **Acessibilidade:** botões com nome, campos com rótulo, navegação por teclado e foco visível.
- **Segurança:** o front-end nunca fala com sites de terceiros (a CSP bloqueia); acesso à
  internet só pelo back-end, nos endereços da lista em `backend/app/services/remote.py`.
- **Sem dependências novas sem conversa.** Toda biblioteca precisa ter licença compatível com a
  AGPL-3.0 (MIT, BSD, ISC, Apache-2.0) e justificar o peso que traz.
- **Formatação:** `ruff format` no Python; no front, siga o estilo existente (2 espaços, sem
  ponto e vírgula, aspas simples). Comentários em português, explicando o porquê.
- **Mudança no formato do cofre** exige migração em `backend/app/vaults/store.py`
  (`_MIGRATIONS`), com teste de um cofre antigo abrindo na versão nova.

## Testes

```bash
# Back-end (pasta backend/)
uv run pytest
uv run ruff check . && uv run ruff format --check .

# Front-end (pasta frontend/)
npm run typecheck
npm run test:unit
npm run build && npm run test:e2e   # para mudanças na interface
```

Toda correção de erro deve vir com um teste que falhava antes dela. Mudanças na interface devem
ter teste no navegador (`frontend/tests/e2e/`). Para regras que dependem da data, rode também
com o relógio fixado: `LUME_E2E_NOW=2027-01-01T10:00:00 npm run test:e2e`.

## Checklist do pull request

- [ ] O PR resolve uma coisa só e cita a issue (`Closes #123`), se houver.
- [ ] Testes novos cobrem a mudança, e todos passam.
- [ ] Textos novos estão em `pt.ts`, `en.ts` e `es.ts`.
- [ ] A documentação em `docs/` e o `README.md` continuam corretos.
- [ ] O `CHANGELOG.md` tem uma linha na seção **Não lançado**.
- [ ] Mudanças visuais têm capturas de tela (tema escuro e claro; janela estreita, se fizer diferença).
- [ ] Os commits estão assinados (`Signed-off-by`).

## Licença das contribuições

O Lume é distribuído sob a [AGPL-3.0](LICENSE). Ao enviar uma contribuição, você concorda que
ela seja distribuída sob essa mesma licença.

Cada commit deve ter a linha `Signed-off-by: Seu Nome <seu@email>` (o `git commit -s` coloca
sozinho). Ela é a sua declaração, nos termos do
[Developer Certificate of Origin 1.1](https://developercertificate.org/), de que você escreveu
a contribuição ou tem o direito de enviá-la sob a licença do projeto.
