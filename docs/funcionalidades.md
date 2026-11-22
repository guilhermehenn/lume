# Funcionalidades

Especificação da versão 1.0, tela por tela: o que cada uma faz, as regras que valem e os
limites. Os limites de tamanho e quantidade são conferidos no navegador **e** no servidor (veja
[Modelo de dados](dados.md#limites)).

## Sumário

- [Cofres e entrada](#cofres-e-entrada)
- [Início](#início)
- [Lançamentos](#lançamentos)
- [Novo lançamento](#novo-lançamento)
- [Investimentos](#investimentos)
- [Bancos](#bancos)
- [Categorias](#categorias)
- [Relatórios](#relatórios)
- [Exportar](#exportar)
- [Envio por e-mail](#envio-por-e-mail)
- [Minha conta](#minha-conta)
- [Configurações](#configurações)
- [Regras que valem em todo o app](#regras-que-valem-em-todo-o-app)

## Cofres e entrada

Ao abrir, o Lume mostra a lista de cofres deste computador (o mais usado por último primeiro) ou,
se não houver nenhum, o assistente de criação.

**Criar cofre**, em passos: nome do cofre, dados do dono (nome, sobrenome, e-mail), senha e como
começar:

| Opção | O que entra no cofre |
|---|---|
| Trazer os dados deste navegador | Os dados da v0.2 guardados no navegador (aparece só se existirem). Nada é apagado do navegador. |
| Começar do zero | Os bancos e as categorias mais comuns. |
| Dados de exemplo | Seis meses de lançamentos e investimentos fictícios. |

Ao criar, o Lume mostra o **código de recuperação** uma única vez (copiar, baixar `.txt` ou
anotar).

**Entrar:** e-mail e senha do cofre. A tela sugere o último e-mail usado naquele cofre.

**Esqueci a senha:** e-mail + código de recuperação + senha nova. O código usado deixa de valer e
o Lume mostra um novo.

| Regra | Valor |
|---|---|
| Nome do cofre | 1 a 60 caracteres; único no computador, sem diferenciar maiúsculas nem acentos |
| Nome do dono | até 40 caracteres; sobrenome até 60 |
| E-mail | formato de e-mail, até 254 caracteres |
| Senha | 8 a 200 caracteres, sem espaço no começo nem no fim |
| Código de recuperação | 20 caracteres em 4 grupos (`XXXXX-XXXXX-XXXXX-XXXXX`), sem diferenciar maiúsculas |
| Tentativas erradas | 5 livres; depois espera de 15 s, 30 s, 60 s… até 5 min (por cofre) |
| Sessão | termina após 2 h sem uso ou 24 h no total; a tela tranca e nada do que estava na memória se perde |

## Início

- Saudação com o nome do dono.
- **Resumo do mês:** entrou, saiu e sobrou (com o percentual guardado). "Entrou" e "Saiu" abrem
  Lançamentos filtrado no mês.
- **Saldo de hoje** nos bancos e o **previsto** com os lançamentos futuros do mês.
- **Mercado:** dólar, euro, Bitcoin, Ethereum, Selic meta, CDI e IPCA 12 meses, com a fonte de
  cada um. Sem internet, mostra o último valor conhecido marcado como desatualizado.
- **Notícias** de investimentos (InfoMoney e Money Times).
- **Últimos lançamentos** e **Próximos** (os com data futura).
- **Boas-vindas** na primeira vez: escolher o banco principal e o saldo inicial, ou explorar com
  dados de exemplo.
- Lembrete para guardar o código de recuperação, enquanto ele não for confirmado.

| Dado | Atualiza |
|---|---|
| Cotações e indicadores | a cada 1 min (nova tentativa em 30 s se a internet cair) |
| Notícias | a cada 15 min (nova tentativa em 2 min) |

## Lançamentos

Lista única de despesas, receitas e operações de investimento, agrupada por dia (Hoje, Ontem,
Amanhã; os futuros marcados).

- Troca de mês, filtro por tipo, **banco** e **categoria**. Os filtros ficam no endereço da
  página (dá para voltar e compartilhar entre abas).
- **Busca** sem acento por nome, categoria, banco, observação ou **valor** ("45,90"), em todos os
  meses.
- Totais do mês (entradas, saídas, resultado) continuam visíveis ao filtrar por tipo.
- Mostra 300 itens por vez, com **Mostrar mais**.
- Clicar num item abre a edição; excluir tem **Desfazer**.

**Regra do saldo:** o saldo "de hoje" considera só lançamentos com data até hoje; os futuros
entram no "previsto".

## Novo lançamento

Abre pelo botão **Novo** ou pela tecla **N**. Três tipos: despesa, receita e investimento (veja
[Investimentos](#investimentos)).

| Campo | Despesa | Receita |
|---|---|---|
| Valor | obrigatório, maior que zero | obrigatório, maior que zero |
| Pago a / Recebido de | obrigatório, até 120 caracteres | obrigatório, até 120 caracteres |
| Categoria | de despesa | de receita |
| Banco | obrigatório (sugere o principal) | obrigatório |
| Data | obrigatória, com atalhos Hoje e Ontem | obrigatória |
| Forma de pagamento | Pix, débito, crédito, boleto, dinheiro ou transferência (opcional) | não se aplica |
| Observação | até 500 caracteres | até 500 caracteres |

- O valor é digitado como no app do banco: os centavos entram pela direita.
- Sugere nomes já usados; ao escolher um, preenche a categoria e a forma de pagamento do último
  lançamento com aquele nome.
- **Salvar e criar outro** mantém banco e data. Depois de salvar, o aviso tem **Desfazer**.
- Avisa quando a data está no futuro (não impede).
- Fechar com algo preenchido pede confirmação.
- Datas aceitas: de 1900 a 2199. Valor máximo: 99.999.999.999,99.

## Investimentos

**Tipos (16):** poupança, CDB, LCI/LCA, CRI/CRA, debênture, Tesouro Direto, ações, FII, Fiagro,
ETF, BDR, fundos, previdência, criptomoedas, ouro e outros.

**Operações:** aplicação, resgate e rendimento. Cada tipo pede só os campos que o contador
precisa e mostra o **Grupo/Código** da ficha Bens e Direitos (IR 2026).

| Regra | Detalhe |
|---|---|
| Quantidade | obrigatória nos tipos negociados por cotas (ações, FII, ETF, BDR, cripto…) |
| Rendimento | sem quantidade, preço nem taxas; tipo do rendimento (dividendo, JCP, juros, rendimento de FII, outro) e IR retido opcional |
| IR retido e taxas | não podem passar do valor da operação |
| Tesouro Direto | título obrigatório (Selic, IPCA+, Prefixado, Renda+, Educa+) |
| CNPJ | numérico ou alfanumérico (padrão novo da Receita), com dígitos verificadores conferidos |
| Resgate | o formulário mostra quanto havia em carteira na data |
| Data futura | operações futuras não entram na carteira de hoje |

**Carteira:** posição por ativo pelo **custo médio** até hoje, rendimentos do ano e resultado em
vendas e resgates (resgate acima do custo vira ganho). O gráfico por tipo filtra a carteira. Cada
posição abre os números, atalhos de aplicação, resgate e rendimento já preenchidos e o histórico.
Posições encerradas aparecem à parte, com o resultado.

## Bancos

- Vem com os 18 principais bancos do Brasil, com código COMPE.
- Saldo de hoje e previsto por banco e no total. O principal e os mais usados aparecem primeiro;
  bancos sem uso ficam recolhidos.
- Busca sem acento, pelo nome ou pelo código. **Ver lançamentos** abre a lista filtrada.
- Tipos: conta corrente, banco digital, poupança, corretora, dinheiro e outro.

| Regra | Detalhe |
|---|---|
| Nome | 1 a 60 caracteres; não se repete (sem diferenciar acentos e maiúsculas) |
| Código COMPE | opcional, 3 dígitos |
| Saldo inicial | pode ser negativo |
| Principal | só um por cofre |
| Excluir banco sem uso | exclusão simples, com Desfazer |
| Excluir banco com lançamentos | **junção**: lançamentos, operações, saldo inicial e o posto de principal vão para o banco escolhido; relatórios salvos passam a filtrar o destino. O saldo total não muda. Com Desfazer |

## Categorias

- 16 de despesa e 8 de receita prontas, com ícone e cor; os nomes delas aparecem traduzidos.
- Abas de despesas e receitas (a aba fica no endereço), com o número de lançamentos e o total do
  mês. **Ver lançamentos** abre a lista filtrada.

| Regra | Detalhe |
|---|---|
| Nome | até 60 caracteres; não se repete dentro do mesmo tipo (inclusive com o nome traduzido das prontas) |
| Tipo | travado quando a categoria já tem lançamentos |
| Excluir categoria em uso | move os lançamentos para outra do mesmo tipo ("Outras despesas" ou "Outras receitas" vem sugerida), com Desfazer |

## Relatórios

| Aba | Conteúdo |
|---|---|
| Visão geral | Entradas, saídas e resultado do período, com as datas à vista e médias por mês (períodos de 2 meses ou mais) |
| Por categoria | Participação de cada categoria; clicar abre o detalhe no personalizado |
| 12 meses | Evolução mês a mês |
| Investimentos (IR) | Posição em 31/12, resultado de vendas e resgates no ano, rendimentos com IR retido |
| Personalizado | Filtros (período, tipos, bancos, categorias, texto), busca sem acento, agrupamento por categoria, banco, mês ou nome, exportação CSV e relatórios salvos |

- Períodos rápidos: este mês, mês passado, últimos 3 e 12 meses, este ano e ano passado. Um
  relatório salvo com período rápido é recalculado ao abrir ("Este mês" abre sempre no mês atual).
- **Salvar alterações** e **Salvar como novo**. Nome do relatório: até 60 caracteres, sem repetir.
- Tudo imprime ou vira PDF pelo navegador, com a aba e o período no topo.
- Até 200 relatórios salvos por cofre.

## Exportar

| Arquivo | Conteúdo |
|---|---|
| Pacote para o contador (`lume-ir-AAAA.xlsx`) | Leia-me; Posição 31-12 com Grupo/Código, CNPJ, quantidade, preço médio e custo em 31/12 dos dois anos; Rendimentos com IR retido; Lançamentos; Investimentos; Resumo mensal; Por categoria; Bancos com o saldo em 31/12 dos dois anos |
| CSVs (`lume-lancamentos-AAAA.csv`, `lume-investimentos-AAAA.csv`) | Lançamentos e investimentos do ano, com proteção contra fórmulas |
| Relatório anual | Para imprimir, salvar em PDF ou mandar por e-mail, com o resultado do ano e o IR retido |
| Backup (`lume-backup-AAAA-MM-DD.json`) | Todos os dados e configurações do cofre, para restaurar em qualquer cofre |

- Abre no **ano da declaração**: até junho, o ano anterior.
- Mostra quantos lançamentos e operações cada ano tem e avisa em vez de gerar arquivo vazio.
- Tudo é gerado no próprio computador.
- Os códigos do IR são sugestões; o contador confere.

## Envio por e-mail

Disponível em Exportar, nos relatórios personalizados e no relatório anual, depois de configurar
o e-mail de envio em Minha conta. O Lume usa a **conta de e-mail do próprio usuário** (SMTP) e
manda para o e-mail do cofre.

| Regra | Valor |
|---|---|
| Anexos | até 15 MB somados, no máximo 10 por mensagem |
| Envios | até 20 a cada 10 minutos por cofre |
| Segurança | STARTTLS ou SSL/TLS (sem criptografia só para servidores no próprio computador) |
| Cópia por e-mail | se ligada, todo arquivo baixado também é enviado |

## Minha conta

- Nome, sobrenome, e-mail e foto (até 300 KB). Trocar o e-mail pede a senha atual.
- **Senha de acesso:** trocar a senha encerra as outras sessões do cofre.
- **Código de recuperação:** gerar um novo (pede a senha; o anterior deixa de valer).
- **E-mail para envio de relatórios:** serviço (Gmail, Outlook.com, Microsoft 365, Yahoo, iCloud ou outro),
  servidor, porta, segurança, usuário e senha de app; **Enviar teste**; remover pede confirmação.
- **Renomear** o cofre, **Trocar de cofre**, **Sair** e **Excluir cofre** (pede a senha; o arquivo
  vai para a lixeira da pasta de dados, com backup antes).
- Sair e trocar de cofre gravam antes o que falta; se o Lume não responder, a tela pergunta antes
  de descartar.

## Configurações

| Item | Detalhe |
|---|---|
| Idioma | Português (Brasil), inglês, espanhol |
| Moeda de exibição | Real, dólar ou euro. Muda só como os valores aparecem; nada é convertido |
| Tema | Escuro, claro ou o do sistema |
| Ocultar valores | Também pela tecla **H** ou pelo olho na barra. Esconde valores e percentuais e mantém as proporções dos gráficos |
| Backup | Fazer backup (`.json`) e restaurar um backup (até 256 MB) |
| Dados de exemplo | Troca os dados do cofre pelos de exemplo |
| Apagar tudo | Deixa o cofre vazio |
| Última cópia | Data da cópia automática mais recente e quantas há |
| Sobre | Versão, licença e link para o código |

Antes de restaurar, carregar o exemplo ou apagar tudo, o Lume guarda uma **cópia verificada** do
cofre; sem a cópia, nada é trocado. Cada aviso diz o que vai sair e o que vai entrar, e a troca
pode ser desfeita pelo aviso na tela.

## Regras que valem em todo o app

**Atalhos de teclado**

| Tecla | Ação |
|---|---|
| N | Novo lançamento |
| / | Buscar |
| H | Ocultar ou mostrar valores |
| Ctrl/⌘ + Enter | Salvar |
| Ctrl/⌘ + Shift + Enter | Salvar e criar outro |

**Gravação e várias janelas**

- Cada ação aparece na hora; a gravação no cofre acontece logo depois, em segundo plano.
- Sem conexão com o servidor local, as mudanças ficam na memória e o Lume tenta de novo; a barra
  lateral mostra "Sem conexão com o Lume" e fechar a aba pede confirmação.
- Várias abas do mesmo cofre se mantêm atualizadas. Se duas gravam ao mesmo tempo, a mais recente
  vence, item a item.
- Abrir outro cofre numa aba tranca as outras abas daquele navegador.

**Quantidades máximas por cofre:** 500 bancos, 500 categorias, 200 mil lançamentos, 100 mil
operações de investimento e 200 relatórios salvos.
