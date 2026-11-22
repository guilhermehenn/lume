# Lume v0.3 — cofres, Minha conta e envio por e-mail

Pedido do autor e o que foi decidido.

| # | Pedido | Decisão |
|---|---|---|
| Bug 1 | O "+" do botão **Novo** estava fora de esquadro (muito à esquerda) | Ícone e texto alinhados no mesmo eixo, com respiro igual dos dois lados; botão maior (44 px). |
| 1 | Tudo meio pequeno; barra lateral achatada | Fonte base 15 px e toda a escala tipográfica subiu um passo. Cartões, linhas de tabela, campos e botões mais altos (botão médio 40 px, campos 40–48 px). Barra lateral mais larga (276 px), itens de 40 px, ícones de 20 px. Conteúdo até 1320 px. No Início, cotações e indicadores em grades separadas (o Bitcoin não corta mais). |
| 2 | Cursor de mãozinha em tudo que é clicável | Regra global: botões habilitados, links, seletores, chaves, abas, opções, campos de data/arquivo/cor. Itens desabilitados mantêm a seta. |
| 3 | Menu "Minha conta" (nome, sobrenome, e-mail, foto, senha) | Menu da conta na base da barra lateral (avatar, nome e cofre) com **Minha conta**, **Trocar de cofre** e **Sair**. A tela tem Perfil (foto recortada e reduzida para 256 px; trocar o e-mail pede a senha atual), Senha de acesso (com medidor de força; encerra outras sessões), E-mail para envio e Cofre (renomear, trocar, sair, excluir com senha). |
| 4 | "Criar banco" com usuário e senha; ao abrir, escolher/criar e entrar com e-mail e senha | Chamado de **cofre** na interface, porque "Bancos" já são Nubank, Itaú etc. Cada cofre é um arquivo SQLite separado, com dono, e-mail e senha. Ao abrir: lista de cofres (foto ou iniciais, nome, dono, lançamentos, último acesso) + **Criar novo cofre**; com um só cofre, vai direto para a senha. Criação em 3 passos: cofre e dono → senha → como começar (dados deste navegador, do zero ou exemplo). O mesmo e-mail pode ser dono de vários cofres; a senha de um não abre outro. |
| 5 | Enviar os relatórios em cópia para o e-mail do usuário | Envio pela **conta de e-mail do próprio usuário** (SMTP com senha de app), configurado em Minha conta, com botão de teste. Botão **Enviar por e-mail** ao lado de cada arquivo em Exportar, no relatório personalizado e no relatório anual (vai no corpo do e-mail e anexo em HTML). Opção **Cópia por e-mail**: todo arquivo baixado também é enviado. |

## Decisões de produto

- **Senha não recuperável pelo app.** Não há servidor do Lume para mandar link de
  recuperação. O caminho é o comando `redefinir-senha` no terminal, no próprio computador,
  com o app fechado (backup antes). A tela de entrada mostra o comando pronto.
- **O arquivo do cofre não é criptografado.** A senha protege o acesso pelo Lume. Criptografar
  o arquivo inteiro exigiria SQLCipher (dependência nativa difícil de instalar no Windows) e
  tornaria qualquer esquecimento de senha uma perda total. Fica para avaliar numa versão
  futura. A senha de app do e-mail, essa sim, é criptografada.
- **Sessão de 2 horas sem uso.** Ao expirar, a tela tranca sem perder nada: o que não foi
  salvo é aplicado depois de entrar de novo.
- **Importação da v0.2 sem apagar nada.** Os dados do navegador continuam lá. A importação
  também recupera as cópias que a v0.2 guardava quando não conseguia ler os dados (ver
  "Correção" abaixo).
- **Outlook.com:** a Microsoft vem desligando o SMTP com senha em contas pessoais. O app
  avisa na ajuda do serviço e o teste mostra o erro de forma clara.

## Correção encontrada nos testes

Na v0.2, **Bancos → Novo banco** criava o banco sem id (`{ ...input }` com `id: undefined`
apagava o id gerado). Ao recarregar a página, a validação recusava os dados, a v0.2 guardava
uma cópia em `lume.data.corrupt.*` e começava do zero. Corrigido em `model.ts` (teste
unitário cobre), e a importação conserta e recupera essas cópias.

## Fora da v0.3 (backlog)

Cartão de crédito com fatura, parcelas, recorrências, orçamento por categoria, metas,
importação de extrato (OFX/CSV), criptografia do arquivo do cofre, compartilhar um cofre
entre duas pessoas (hoje: um dono por cofre).

## Qualidade

- Back-end: 139 testes (cofres, criptografia, sessões, limites, migração, e-mail com servidor
  SMTP local de verdade, API de ponta a ponta, terminal).
- Front-end: 54 testes de regras (inclui diferenças, junção e reaplicação das alterações) e
  25 testes no navegador contra o back-end real: criar cofre, entrar, senha errada, sair,
  importar da v0.2, sessão expirada sem perda, outra aba em outro cofre, Minha conta
  (perfil, foto, senha, e-mail de envio), excluir cofre e todos os fluxos da v0.2.
