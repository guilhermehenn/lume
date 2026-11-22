# Publicar no GitHub

Checklist do mantenedor para publicar o Lume em `github.com/guilhermehenn/lume` e lançar a 1.0.
Faça uma vez, na ordem.

## 1. Preparar a pasta

Na pasta do projeto (a mesma onde você roda o Lume):

1. **Adicione o texto da licença.** O arquivo `LICENSE` precisa ter o texto oficial da AGPL-3.0:

   ```bash
   curl -o LICENSE https://www.gnu.org/licenses/agpl-3.0.txt
   ```

   No Windows, use o PowerShell:
   `Invoke-WebRequest https://www.gnu.org/licenses/agpl-3.0.txt -OutFile LICENSE`.
   (Outra forma: depois de criar o repositório, **Add file → Create new file**, digite `LICENSE`,
   clique em **Choose a license template** e escolha **GNU Affero General Public License v3.0**.)

2. **Confira as versões travadas do back-end:**

   ```bash
   cd backend
   uv lock          # deve terminar sem mudanças
   uv run pytest
   ```

3. **Confira o que vai para o Git.** O `.gitignore` já deixa de fora `.env`, `.venv/`,
   `node_modules/`, `frontend/dist/`, bancos de dados e logs. O `frontend/package-lock.json`
   (criado pelo `npm install`) **deve** ir para o Git.

## 2. Criar o repositório

1. Em [github.com/new](https://github.com/new): nome `lume`, **Public**, **sem** README, licença ou
   `.gitignore` (eles já existem no projeto).
2. Envie o código (no Windows, use o **Git Bash**, que vem com o Git):

   ```bash
   git init -b main
   git add .
   git update-index --chmod=+x *.command setup/*.sh scripts/*.sh   # executáveis no macOS
   git status                    # confira: nada de .env, .db, dist/ ou node_modules/
   git commit -s -m "feat: Lume 1.0.0"
   git remote add origin https://github.com/guilhermehenn/lume.git
   git push -u origin main
   ```

3. Em **Actions**, confira se o **CI** rodou e passou. O badge do README passa a mostrar o estado.

## 3. Configurar o repositório

Em **Settings**:

| Onde | O que fazer |
|---|---|
| General → About (na página inicial, ícone ⚙️) | Descrição: "App de finanças pessoais de código aberto, local e privado. Windows e macOS." Tópicos: `finance`, `personal-finance`, `finanças-pessoais`, `brasil`, `imposto-de-renda`, `local-first`, `privacy`, `fastapi`, `react`, `sqlite` |
| General → Features | Ligue **Issues** e **Discussions**; desligue **Wiki** (a documentação está em `docs/`) |
| General → Pull Requests | Deixe só **Allow squash merging**; ligue **Automatically delete head branches** |
| General → Social preview | Envie `docs/img/inicio.png` (aparece quando o link é compartilhado) |
| Branches → Add rule (ou Rulesets) para `main` | Exigir pull request com 1 aprovação, exigir os checks do CI (Back-end, Front-end, Testes no navegador), bloquear *force push* |
| Code security | Ligue **Private vulnerability reporting**, **Dependabot alerts** e **Dependabot security updates** |
| Actions → General | *Workflow permissions*: **Read repository contents** (o workflow de release pede a escrita que precisa) |

Em **Issues → Labels**, crie (ou confira) os rótulos usados pelos modelos: `bug`, `sugestão`,
`triagem`, `good first issue`, `help wanted`, `documentação`, `tradução`.

Em **Discussions**, crie as categorias **Perguntas**, **Ideias** e **Mostre seu uso**.

## 4. Lançar a 1.0.0

```bash
git tag -a v1.0.0 -m "Lume 1.0.0"
git push origin v1.0.0
```

O workflow **Release** confere a versão, monta a interface, gera `lume-v1.0.0.zip` e publica a
release com as notas do `CHANGELOG.md`. Depois:

1. Abra a release, confira as notas e o ZIP.
2. Baixe o ZIP e instale numa máquina limpa (Windows e macOS), seguindo o README.
3. Marque a release como **Latest**, se ainda não estiver.

## 5. Depois do lançamento

- Fixe uma issue "Roteiro" com os itens da seção [Roteiro](../README.md#roteiro), para a
  comunidade comentar e votar.
- Marque algumas issues simples com `good first issue`.
- Responda issues e PRs com regularidade; o [SECURITY.md](../SECURITY.md) promete confirmar
  relatos de segurança em até 7 dias.

## Licenciamento: uma decisão para o futuro

Com a AGPL-3.0 e o DCO (o `Signed-off-by` dos commits), cada pessoa que contribui continua dona do
que escreveu e licencia sob a AGPL. Isso é o mais comum e o mais simples para atrair
contribuições.

Se um dia você quiser **vender licenças comerciais** do Lume (licenciamento duplo) ou mudar a
licença, vai precisar da permissão de todas as pessoas que contribuíram. Para manter essa porta
aberta, adote um **CLA** (Contributor License Agreement) **antes** de aceitar as primeiras
contribuições externas, por exemplo com o [CLA Assistant](https://cla-assistant.io/). Isso não é
aconselhamento jurídico: para decidir, converse com um advogado da área.
