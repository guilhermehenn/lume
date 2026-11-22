# Lume v0.2 — especificação de produto e UX

Escopo desta versão: **o front-end completo, com os dados salvos no próprio navegador**.
A ligação com o banco SQLite do back-end é o próximo passo (v0.3). O back-end já entrega
cotações e notícias.

## 1. Avaliação do Analista de Produto

Pontos da ideia original e o que foi ajustado:

| # | Ideia original | Decisão de produto |
|---|---|---|
| 0 | Início com dólar, Bitcoin e notícias | Mercado: Dólar, Euro, Bitcoin, Ethereum + Selic, CDI e IPCA 12 meses. Notícias de investimentos (InfoMoney e Money Times, via RSS). Também: resumo do mês, saldo nos bancos e últimos lançamentos. Ibovespa ficou de fora: não há fonte oficial gratuita sem chave. |
| 1 | Cadastro de bancos com os principais pré-cadastrados | 18 bancos com código COMPE. Banco principal é único e vem selecionado nos formulários. Saldo de cada banco é calculado. Excluir banco em uso pede para onde mover os lançamentos. |
| 2 | Categorias por tipo | Tipos se chamam **Receitas** e **Despesas** (termos do contador). 16 categorias de despesa e 8 de receita pré-cadastradas, com ícone e cor. Excluir categoria em uso pede outra para receber os lançamentos. |
| 3 | Despesa: valor, banco, destinatário, categoria, anotação | Mais **data** (obrigatória, padrão hoje) e **forma de pagamento** (Pix, débito, crédito, boleto, dinheiro, transferência). "Destinatário" vira **Pago a**, com sugestões do histórico. |
| 4 | Entrada: valor, banco, origem, categoria, anotação | Mais **data**. "Origem" vira **Recebido de**, com sugestões. |
| 5 | Investimento: valor, banco, tipo | Mais **data** e **operação** (Aplicação, Resgate, Rendimento). Campos mudam conforme o tipo (tabela abaixo) e cada tipo traz a sugestão de Grupo/Código da ficha Bens e Direitos do IRPF. |
| 6 | Relatórios padrão e personalizados | Visão geral, Por categoria, Evolução (12 meses), Investimentos e Personalizado (filtros + agrupamento, salvável). |
| 7 | Exportação para o contador | Pacote **.xlsx** com abas (lançamentos, investimentos, posição por ativo, proventos, resumo mensal, por categoria), **.csv**, **backup .json** e relatório para **imprimir/PDF**. |
| 8 | Configurações: idioma, moeda, tema | Mais: seu nome (saudação), ocultar valores, backup/restauração dos dados do navegador, dados de exemplo e "apagar tudo". Moeda muda só a exibição (não converte valores). |

**Fora da v0.2 (backlog):** cartão de crédito com fatura, compras parceladas, recorrências,
orçamento por categoria, metas, importação de extrato (OFX/CSV), integração com o SQLite.

**Risco desta fase:** os dados ficam no armazenamento do navegador, ligados ao endereço
`http://127.0.0.1:8765`. Outro navegador ou outra porta não enxergam os mesmos dados. Por
isso a tela de Configurações tem backup e restauração em JSON, e a v0.3 leva tudo para o
banco local com backup automático.

## 2. Investimentos: campos por tipo

Comuns a todos: operação, data, valor, instituição (banco/corretora), observação.
Rendimento pede também o tipo (dividendos, JCP, juros/cupom, rendimento de FII, outro) e o IR retido.

| Tipo | Campos extras | Bens e Direitos (sugestão) | Tributação |
|---|---|---|---|
| Poupança | — | 04 · 01 | Isento |
| CDB / RDB / LC | Emissor, CNPJ do emissor, indexador, taxa, vencimento, liquidez diária | 04 · 02 | Tributável |
| LCI / LCA | Idem CDB | 04 · 03 | Isento |
| CRI / CRA | Idem CDB | 04 · 03 | Isento |
| Debêntures | Idem CDB + "incentivada" | 04 · 02 (incentivada: 04 · 03) | Conforme o tipo |
| Tesouro Direto | Título, vencimento, quantidade, preço unitário, taxa | 04 · 02 | Tributável |
| Ações | Ticker, quantidade, preço unitário, taxas | 03 · 01 | Renda variável |
| FII | Ticker, CNPJ do fundo, quantidade, preço unitário, taxas | 07 · 03 | Renda variável |
| Fiagro | Idem FII | 07 · 02 | Renda variável |
| ETF | Ticker, quantidade, preço unitário, taxas, "renda fixa" | 07 · 08 se renda fixa | Renda variável |
| BDR | Ticker, quantidade, preço unitário, taxas | 04 · 04 | Renda variável |
| Fundos | Nome, CNPJ do fundo, classe (RF/multimercado ou ações), cotas | 07 · 01 ou 07 · 04 | Conforme a classe |
| Previdência | Plano (PGBL ou VGBL), CNPJ da seguradora | VGBL: 99 · 06 · PGBL: não entra em Bens | — |
| Criptoativos | Ativo, quantidade, preço unitário, corretora, taxas | 08 · 01 Bitcoin · 02 altcoins · 03 stablecoins | Ganho de capital |
| Ouro (ativo financeiro) | Quantidade (g), preço unitário | 04 · 05 | — |
| COE / Outros | Descrição, emissor | 04 · 99 | — |

Os códigos são sugestões para facilitar o trabalho do contador, nunca substituem a conferência dele.

## 3. Termos (UX)

| Português | English | Español |
|---|---|---|
| Início | Home | Inicio |
| Lançamentos | Transactions | Movimientos |
| Despesa / Despesas | Expense / Expenses | Gasto / Gastos |
| Receita / Receitas | Income | Ingreso / Ingresos |
| Investimento | Investment | Inversión |
| Aplicação · Resgate · Rendimento | Contribution · Redemption · Earnings | Aporte · Rescate · Rendimiento |
| Pago a · Recebido de | Paid to · Received from | Pagado a · Recibido de |
| Bancos · Categorias | Banks · Categories | Bancos · Categorías |
| Relatórios · Exportar · Configurações | Reports · Export · Settings | Informes · Exportar · Ajustes |

Regras de escrita: frases curtas, verbo no início dos botões ("Salvar", "Excluir banco"),
sem jargão na tela principal, números sempre alinhados (tabulares).

## 4. Telas (UX)

- **Estrutura:** barra lateral translúcida com a marca, botão **Novo** (menu: despesa,
  receita, investimento; atalho `N`), navegação e o olho de ocultar valores.
- **Formulários:** sempre numa folha (sheet) central, com o valor grande no topo,
  digitado como no app do banco (os centavos entram pela direita), e os campos em lista
  agrupada estilo iOS. Um seletor no topo troca entre despesa, receita e investimento.
- **Listas:** lançamentos agrupados por dia ("Hoje", "Ontem", data), ícone da categoria,
  valor à direita (verde entra, vermelho sai, roxo investimento).
- **Movimento:** transições de 200–400 ms com curvas suaves, conteúdo entrando com leve
  deslocamento e desfoque, números que contam até o valor, gráficos que crescem. Tudo
  desliga com "reduzir movimento" do sistema.
- **Tema:** escuro por padrão (preto puro, cartões grafite), claro e "seguir o sistema".
- **Acessibilidade:** navegação por teclado, foco visível, diálogos que prendem o foco,
  contraste AA, nada comunicado só por cor (sinal + e − nos valores).

## 5. QA e revisão de usabilidade

**Testes automatizados:** 43 testes de regras e cálculos (dinheiro, datas, CSV, bancos,
categorias, lançamentos, investimentos, custo médio, códigos do IR, backup, dados de
exemplo, traduções e exportação) e 17 testes de ponta a ponta no navegador (boas-vindas,
cotações e notícias, back-end fora do ar, despesa, receita, investimento, validações,
Tesouro e CNPJ, bancos, categorias, filtros e busca, relatórios, exportação, idioma, tema,
ocultar valores, backup, sincronização entre abas e tela estreita). A planilha do contador
foi aberta e conferida com uma biblioteca de Excel (abas, datas, moeda, totais).

**Defeitos encontrados e corrigidos:**

| Onde | Defeito | Correção |
|---|---|---|
| Bancos | Código "0a77" virava "07" (cortava antes de limpar) | Limpa os dígitos e depois corta em 3 |
| Textos | Anos saíam como "2.026" | Ano nunca recebe separador de milhar |
| Diálogos | O texto trocava durante a animação de fechar | O diálogo guarda o último conteúdo até sumir |
| Novo lançamento | Ao trocar para Investimento, o foco ficava no seletor | O foco volta para o valor |
| Investimento | Valor automático podia usar dados antigos ao digitar rápido | Atualização funcional e cálculo derivado |
| Atalho N | Ignorado logo depois de fechar uma folha | Diálogos fechando não bloqueiam o atalho |

**Revisão de Produto, UX/UI e Marketing (aplicada):**

- Datas e meses com maiúscula só na primeira letra ("Sexta-feira, 20 de novembro"); mês
  no meio da frase em minúsculo em português e espanhol ("Resumo de novembro de 2026").
- Celular: "Sobrou" em destaque numa linha própria; entrou e saiu lado a lado, sem cortar.
- Bancos separados em **Em uso** e **Outros bancos** (os 18 pré-cadastrados não poluem a lista).
- Cores únicas por tipo de investimento (FII e cripto, Tesouro e ouro estavam parecidos).
- Total do dia em Lançamentos só quando há mais de um lançamento no dia.
- "Atualizado agora" em vez de "este minuto"; zeros em cinza nos relatórios.
- Formas de pagamento alinhadas ao rótulo; botão **Novo** no estado vazio do Início.
- Dados de exemplo com saldos realistas (primeira impressão de quem explora).

**Para as próximas versões (backlog):** gravar no SQLite (v0.3), cartão de crédito com
fatura, parcelas, lançamentos recorrentes, transferência entre bancos, orçamento por
categoria, metas e importação de extrato (OFX/CSV).
