# Visão geral do produto

## O que é

O Lume é um app de finanças pessoais de código aberto que roda **no computador da pessoa**, com
a interface no navegador. Ele organiza despesas, receitas, investimentos e bancos, mostra para
onde o dinheiro vai e gera o que o contador precisa para a declaração do Imposto de Renda.

Não há servidor na nuvem, cadastro em site nem assinatura: os dados ficam em arquivos no próprio
computador, com backup automático.

## Problema

Quem quer controlar as próprias finanças costuma escolher entre:

- **planilhas**, que dão controle total mas exigem montar fórmulas, abas e gráficos e quebram
  com facilidade;
- **apps de banco ou de finanças na nuvem**, práticos, mas que guardam dados sensíveis em
  servidores de terceiros, cobram assinatura ou dependem de integração com bancos.

O Lume fica no meio: a praticidade de um app, com os dados sob controle da pessoa.

## Para quem

| Perfil | O que procura |
|---|---|
| Pessoa que controla as próprias contas | Registrar gastos em segundos, saber quanto sobrou no mês e o saldo de cada banco |
| Investidor pessoa física | Carteira pelo custo médio, rendimentos e a ficha Bens e Direitos pronta para o IR |
| Família ou casal | Um cofre para a casa, separado do cofre de cada pessoa |
| Autônomo ou pequena empresa | Um cofre só para o negócio, com relatórios por categoria e exportação para o contador |
| Quem se preocupa com privacidade | Nada sai do computador sem uma ação explícita |

## Princípios

1. **Os dados são da pessoa.** Ficam em arquivos locais, num formato aberto (SQLite e JSON), e
   podem ser exportados a qualquer momento.
2. **Nada se perde.** Backup automático e verificado, cópia antes de qualquer operação que
   troque muitos dados, e Desfazer nas exclusões.
3. **Simples primeiro.** Lançar um gasto leva poucos segundos; as telas falam a língua de quem
   usa, não a de quem programa.
4. **Correto com dinheiro.** Valores em centavos inteiros, datas sem fuso, regras de negócio com
   teste.
5. **Seguro por padrão.** Servidor só no próprio computador, senha por cofre, nenhuma requisição
   a sites de terceiros a partir da interface.
6. **Aberto.** Código sob AGPL-3.0, documentado e com testes, para que qualquer pessoa possa
   auditar, melhorar e adaptar.

## Escopo da versão 1.0

| Área | Incluído |
|---|---|
| Cofres | Vários cofres por computador, cada um com dono, e-mail, senha, código de recuperação e foto |
| Lançamentos | Despesas e receitas com banco, categoria, data, forma de pagamento e observação; busca e filtros |
| Investimentos | 16 tipos, aplicação, resgate e rendimento; carteira pelo custo médio; códigos do IR |
| Bancos e categorias | Cadastros prontos (18 bancos, 24 categorias), edição, junção ao excluir |
| Relatórios | Visão geral, por categoria, 12 meses, IR e personalizado com relatórios salvos |
| Exportar | Planilha para o contador, CSVs, relatório anual, backup em JSON, envio por e-mail |
| Início | Resumo do mês, saldos, cotações, indicadores e notícias |
| Configurações | Idioma (pt, en, es), moeda de exibição, tema, ocultar valores, backup e restauração |
| Plataformas | Windows 10/11 e macOS 12+, com scripts de configuração e de inicialização |

## Fora do escopo da 1.0

Os itens abaixo estão no [roteiro](../README.md#roteiro) ou foram descartados de propósito:

- orçamento e metas; lançamentos recorrentes; compras parceladas e transferências entre bancos
  na interface;
- importar extratos (OFX, CSV);
- acesso pelo celular ou por outros computadores da rede (o servidor escuta só em `127.0.0.1`);
- sincronização na nuvem e conexão automática com bancos (Open Finance);
- criptografia do arquivo do cofre (veja [Segurança](seguranca.md#limites-conhecidos));
- instalador assinado (hoje a instalação usa scripts).

## Requisitos não funcionais

| Requisito | Meta na 1.0 |
|---|---|
| Plataformas | Windows 10/11 e macOS 12 ou mais novo, com um navegador atualizado (os testes automáticos usam Edge e Chrome) |
| Volume | Até 200 mil lançamentos e 100 mil operações de investimento por cofre |
| Desempenho | Abrir um cofre cheio em poucos segundos; telas respondem sem travar com 100 mil lançamentos |
| Disponibilidade | Funciona sem internet; só cotações, notícias e envio de e-mail precisam dela |
| Durabilidade | Gravação confirmada sobrevive a queda de energia; backup diário com retenção |
| Idiomas | Português (Brasil), inglês e espanhol, com as mesmas chaves de tradução |
| Acessibilidade | Navegação por teclado, foco visível, rótulos nos campos, "reduzir movimento" respeitado |
| Privacidade | Nenhum dado enviado a terceiros sem ação explícita; sem telemetria |

## Glossário

| Termo | Significado |
|---|---|
| **Cofre** | Um conjunto de dados independente (bancos, categorias, lançamentos, investimentos, relatórios e configurações), guardado num arquivo SQLite próprio, com dono e senha. |
| **Dono** | A pessoa cadastrada no cofre: nome, e-mail, foto e senha. Um cofre tem um dono só. |
| **Código de recuperação** | Código de 20 caracteres mostrado ao criar o cofre; permite criar uma senha nova sem perder dados. |
| **Lançamento** | Uma despesa ou receita, com valor, data, banco e categoria. |
| **Operação** | Um movimento de investimento: aplicação, resgate ou rendimento. |
| **Posição** | O quanto se tem de um ativo numa data, calculado pelas operações (custo médio). |
| **Banco principal** | O banco sugerido em novos lançamentos. Só um por cofre. |
| **Junção** | Excluir um banco ou categoria em uso movendo os lançamentos para outro, sem mudar totais. |
| **Revisão** | Número que aumenta a cada gravação no cofre; evita que duas janelas sobrescrevam uma à outra. |
| **Backup** | Cópia do cofre: automática (arquivo `.db`, na pasta de backups) ou manual (arquivo `.json`, baixado pelo app). |
| **Pasta de dados** | Onde ficam cofres, backups, cache e logs (`%LOCALAPPDATA%\Lume` no Windows, `~/Library/Application Support/Lume` no macOS). |
