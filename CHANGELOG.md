# Histórico de versões

Todas as mudanças relevantes do Lume ficam registradas aqui. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e as versões seguem o
[Versionamento Semântico](https://semver.org/lang/pt-BR/): MAIOR quando o formato do cofre ou a
API mudam de um jeito incompatível, MENOR para funcionalidades novas, CORREÇÃO para correções.

## [Não lançado]

## [1.0.0] - 2026-11-21

Primeira versão pública e de código aberto.

### Adicionado

- Licença **AGPL-3.0** e aviso de copyright (`NOTICE`).
- Documentação técnica em `docs/`: visão geral do produto, funcionalidades, operação,
  arquitetura, modelo de dados, API local, segurança, desenvolvimento e licenças de terceiros.
- Arquivos da comunidade: `README.md` para o GitHub, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, modelos de issue e de pull request, `CODEOWNERS` e Dependabot.
- Integração contínua no GitHub Actions: testes do back-end (Windows, macOS e Linux), checagem de
  tipos, testes de regras, montagem e testes no navegador. Releases publicadas a partir da tag,
  com o ZIP pronto para instalar.
- Configurações → Sobre: link para o código-fonte e a licença.

### Mudado

- Versão 1.0.0 em todo o projeto. Metadados de licença e repositório em `package.json` e
  `pyproject.toml`.
- Documentos das versões anteriores movidos para `docs/historico/`.

## [0.3.11] - 2026-11-21

### Corrigido

- Sair e trocar de cofre gravam antes o que falta; sem conexão com o Lume, perguntam em vez de
  descartar.
- Sair numa janela tranca as outras com o aviso certo.
- Depois de trocar o e-mail de acesso, a tela de entrada sugere o e-mail novo.
- "Ocultar valores" esconde também o percentual guardado do mês e o saldo no aviso de excluir banco.
- A contagem do cofre em Minha conta voltou a aparecer por extenso.
- Sessões vencidas saem da memória do servidor, com a chave do cofre.

### Adicionado

- Confirmação para remover o e-mail de envio; o menu da conta mostra o cofre aberto.

## [0.3.10] - 2026-11-21

### Adicionado

- Cópia verificada do cofre antes de restaurar um backup, carregar o exemplo ou apagar tudo. Sem
  a cópia, nada é trocado.
- Configurações mostra a última cópia do cofre; os avisos dizem o que sai e o que entra.

### Corrigido

- Desfazer uma restauração volta também idioma, tema e moeda.
- Um valor de configuração estragado não leva mais os outros de volta ao padrão.

## [0.3.9] - 2026-11-21

### Adicionado

- Exportar abre no ano da declaração e mostra o que há em cada ano; a aba Bancos da planilha traz
  o saldo em 31/12 dos dois anos; o relatório anual traz o resultado do ano e o IR retido.

### Mudado

- CSV de 100 mil lançamentos 28 vezes mais rápido; backup em JSON compacto (27% menor).

### Corrigido

- Restauração de backups grandes (acima de 50 MB), datas de amanhã em nomes de arquivo depois das
  21h, quantidades em notação científica no CSV e e-mails grandes demais.

## [0.3.8] - 2026-11-20

### Adicionado

- Relatórios salvos com período relativo ("Este mês"), "Salvar como novo", detalhe de uma
  categoria com um clique, busca sem acento e resultado de vendas no ano.

## [0.3.7] - 2026-11-20

### Adicionado

- Categorias sem nome repetido, destino sugerido ao excluir e "Ver lançamentos".

## [0.3.6] - 2026-11-20

### Corrigido

- Excluir um banco com lançamentos não muda mais o saldo total (junção de bancos).

### Adicionado

- Bancos sem nome repetido, bancos sem uso recolhidos e "Ver lançamentos".

## [0.3.5] - 2026-11-20

### Corrigido

- A carteira não conta operações com data futura; resgate acima do custo vira ganho; código do IR
  de ETFs.

### Adicionado

- Filtro da carteira pelo gráfico e posições encerradas com o resultado.

## [0.3.4] - 2026-11-20

### Adicionado

- Filtros de banco e categoria, busca pelo valor e filtros no endereço da página.

### Corrigido

- O filtro de tipo não zera mais os outros totais do mês.

## [0.3.3] - 2026-11-20

### Corrigido

- O saldo de hoje não conta lançamentos futuros, que passam a aparecer em "Próximos".

## [0.3.2] - 2026-11-20

### Adicionado

- "Salvar e criar outro", Desfazer depois de salvar, atalhos Hoje e Ontem.

## [0.3.1] - 2026-11-20

### Adicionado

- Código de recuperação do cofre, nome de cofre único e idioma na tela de entrada.

## [0.3.0] - 2026-11-19

### Adicionado

- Cofres: cada um é um arquivo SQLite com dono, e-mail e senha. Minha conta, troca de cofre e
  envio de relatórios pelo e-mail do próprio usuário.

## [0.2.0] - 2026-11-18

### Adicionado

- Interface completa no navegador (Início, Lançamentos, Investimentos, Bancos, Categorias,
  Relatórios, Exportar e Configurações), com os dados guardados no próprio navegador.

[Não lançado]: https://github.com/guilhermehenn/lume/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guilhermehenn/lume/releases/tag/v1.0.0
[0.3.11]: docs/historico/revisoes/revisao-conta-v0.3.11.md
[0.3.10]: docs/historico/revisoes/revisao-configuracoes-v0.3.10.md
[0.3.9]: docs/historico/revisoes/revisao-exportar-v0.3.9.md
[0.3.8]: docs/historico/revisoes/revisao-relatorios-v0.3.8.md
[0.3.7]: docs/historico/revisoes/revisao-categorias-v0.3.7.md
[0.3.6]: docs/historico/revisoes/revisao-bancos-v0.3.6.md
[0.3.5]: docs/historico/revisoes/revisao-investimentos-v0.3.5.md
[0.3.4]: docs/historico/revisoes/revisao-lancamentos-v0.3.4.md
[0.3.3]: docs/historico/revisoes/revisao-inicio-v0.3.3.md
[0.3.2]: docs/historico/revisoes/revisao-novo-v0.3.2.md
[0.3.1]: docs/historico/revisoes/revisao-entrada-v0.3.1.md
[0.3.0]: docs/historico/produto-v0.3.md
[0.2.0]: docs/historico/produto-v0.2.md
