## O que muda

<!-- Uma ou duas frases. Por que esta mudança é necessária? -->

Closes #

## Como testar

<!-- Passos para quem revisa conferir na tela, se fizer sentido. -->

1.

## Capturas de tela

<!-- Para mudanças visuais: antes e depois, tema escuro e claro. Use "Ocultar valores" (H). -->

## Checklist

- [ ] O PR resolve uma coisa só.
- [ ] Testes novos cobrem a mudança (`uv run pytest`, `npm run test:unit`, `npm run test:e2e`).
- [ ] `uv run ruff check .`, `uv run ruff format --check .` e `npm run typecheck` passam.
- [ ] Textos novos estão em `pt.ts`, `en.ts` e `es.ts`.
- [ ] Mudança no formato do cofre tem migração e teste com um cofre antigo.
- [ ] `docs/` e `README.md` continuam corretos.
- [ ] `CHANGELOG.md` tem uma linha em **Não lançado**.
- [ ] Os commits estão assinados (`git commit -s`), conforme o [CONTRIBUTING.md](../CONTRIBUTING.md).
