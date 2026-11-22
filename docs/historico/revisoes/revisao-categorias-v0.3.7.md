# Revisão de Categorias — v0.3.7

Escopo: a tela **Categorias**:

- abas de despesas e receitas;
- cartões com o uso e o total do mês;
- cadastro e edição (nome, tipo, cor e ícone);
- exclusão, com os lançamentos indo para outra categoria.

Do lado técnico, entram o modelo de categoria, a ordem usada também nos formulários, as grades de cor e ícone, a exclusão e o que ela manda gravar, o backup e o que o servidor confere antes de gravar.

Cada papel listou o que encontrou. A coluna "Feito" diz o que foi aplicado nesta versão.

## 1. Produto (Analista de Produto Sênior)

| # | Achado | Decisão / Feito |
|---|---|---|
| P1 | **Nomes repetidos no mesmo tipo eram aceitos**: dava para criar outro "Mercado", ou "Groceries", que é o próprio Mercado com o app em inglês. Nos formulários, as duas apareciam iguais. | Recusado sem diferença de acento ou maiúsculas, comparando também com o nome das categorias do app nos três idiomas. Receita e despesa com o mesmo nome continuam valendo (são listas separadas). |
| P2 | Ao excluir uma categoria em uso, o destino vinha vazio. | **"Outras despesas"** (ou "Outras receitas") já vem sugerida. Dá para trocar antes de confirmar. |
| P3 | Relatórios salvos que filtravam só a categoria excluída passavam a mostrar **todas**. | Passam a filtrar a categoria que recebeu os lançamentos. |
| P4 | Excluir a única categoria do tipo que tem lançamentos pedia um destino que não existia, com o botão desabilitado e sem explicação. | O diálogo explica que é preciso criar outra antes. |
| P5 | Não havia caminho da categoria para os lançamentos dela. | **"Ver lançamentos"** no menu do cartão abre Lançamentos já filtrado (tipo e categoria). |
| P6 | A aba de receitas não ficava no endereço: recarregar voltava para despesas, e não dava para abrir a tela já em receitas. | `?kind=income` no endereço. |
| P7 | Depois de excluir, o aviso dizia só "Categoria excluída". | "Categoria excluída. 23 lançamentos foram para Outras despesas.", com Desfazer. |
| P8 | Mantido de propósito | Ordem alfabética, com "Outras …" no fim. O total do cartão é o do mês inteiro, como no resumo do Início. |

**Recomendado para depois (não feito agora):**

- **Arquivar categoria:** ela sai dos formulários, mas continua nos relatórios e nos lançamentos antigos (hoje, a única saída é excluir e mover).
- **Limite mensal por categoria**, com aviso ao chegar perto.
- **Subcategorias** (ex.: Transporte › Combustível), para quem quer mais detalhe sem perder o total.

## 2. Código (Engenheiro de Software Sênior)

| # | Achado | Feito |
|---|---|---|
| E1 | Tela, formulário e diálogo de exclusão num arquivo de 261 linhas. | `screens/categories/`: `Categories.tsx` (tela e cartão), `CategorySheet.tsx` e `DeleteCategoryDialog.tsx`. |
| E2 | A ordem das categorias existia duas vezes (na tela e nos formulários de lançamento). | `categoriesByName`, usado nos dois, com `Intl.Collator` (acento e números na ordem certa: "Item 2" antes de "Item 10"). |
| E3 | O formulário e o diálogo contavam os lançamentos da categoria passando pela lista inteira **a cada redesenho** (4,9 ms com 100 mil lançamentos, a cada tecla digitada no nome). | A tela já tinha a conta (`categoryUsageCounts`, numa passada) e agora a passa adiante. |
| E4 | O mês do total vinha de `currentMonth()` lido no desenho: com a tela aberta na virada do mês, ficava no mês anterior. | Usa o relógio do app (`useToday`), como Início, Lançamentos e Bancos. |
| E5 | A exclusão recriava todos os relatórios salvos e não registrava a alteração (`updatedAt`) nos lançamentos movidos. | Só o que muda é recriado, e os movidos registram a alteração (como em Bancos). |
| E6 | A lista de ícones morava na camada de interface, e o modelo aceitava qualquer texto como ícone. | A lista foi para `data/catalog.ts`. O modelo só aceita ícone da grade, com uma exceção: um ícone antigo continua valendo enquanto não for trocado. |
| E7 | **Defeito da v0.3.6:** a regra de nome repetido de Bancos travava, no navegador, a edição de um banco antigo já repetido mesmo sem trocar o nome (o servidor deixava). | A regra vale quando o nome muda, em bancos e em categorias, no navegador e no servidor. |
| E8 | Removido o que não era usado | O apelido `CATEGORY_ICON_CHOICES`. O caminho que mostrava o erro de tipo travado embaixo do campo Nome, que deixou de existir com o tipo travado de verdade (D4). `autoFocus` trocado por `initialFocus` da folha, como no Novo e em Bancos. |

## 3. Design e UX (Designer Sênior + Especialista em UX/UI; ajustes pelo Engenheiro de Frontend)

| # | Achado | Feito |
|---|---|---|
| D1 | **A grade de ícones do formulário estava numa coluna só:** 52 ícones um embaixo do outro, com muita rolagem para escolher. A linha do formulário encolhia a grade até a largura de um ícone. | A grade ocupa a largura toda: 10 ícones por linha no computador. |
| D2 | Para leitores de tela, os ícones se chamavam "dumbbell", "cart" (em inglês) e as cores, "#0A84FF". | Nomes nos três idiomas ("Haltere", "Carrinho de compras", "Azul"). Os ícones mostram o nome ao passar o mouse. |
| D3 | As grades de cor e de ícone tinham 13 e 52 paradas no Tab: era preciso apertar Tab dezenas de vezes para chegar ao Salvar. | Cada grade é uma parada só; as setas, Home e End trocam a escolha. Vale também para a cor em Bancos. |
| D4 | **O tipo "travado" só estava travado para o mouse:** pelo teclado dava para trocar, e o erro só aparecia ao salvar, embaixo do campo Nome. | Travado de verdade (opções desabilitadas), com a explicação embaixo. |
| D5 | O cartão só abria a edição: excluir exigia abrir o formulário. | Menu "…" no cartão (Editar, Ver lançamentos, Excluir), como em Bancos. |
| D6 | Fechar o formulário com algo mudado perdia tudo sem perguntar. | "Descartar esta categoria?" (ou "Descartar as alterações?"), como no Novo e em Bancos. |
| D7 | No diálogo de exclusão, o rótulo "Mover lançamentos para" quebrava em duas linhas e cortava o destino ("Outras des…"). | Rótulo em cima e o destino na largura toda. Também em Bancos. |
| D8 | Nome repetido sem aviso; lista vazia sem saída; nome longo cortado sem como ler. | Mensagem no campo com o foco de volta; **Nova categoria** na lista vazia; o nome inteiro aparece ao passar o mouse. |

## 4. QA (QA Sênior; correções pelo Engenheiro de Software)

Novos testes, além dos que já existiam:

- **Navegador (`tests/e2e/categories.spec.ts`, 8 testes):**
  - total do mês e uso em cada cartão; "Outras despesas" no fim;
  - aba de receitas no endereço, mantida ao recarregar;
  - grade de ícones lado a lado; uma parada no Tab; setas trocando o ícone; nomes traduzidos;
  - "Groceries" recusado como repetido de "Mercado", com o foco de volta no campo;
  - descartar;
  - tipo travado também pelo teclado;
  - exclusão com "Outras despesas" sugerida, aviso final, relatório salvo e lançamentos conferidos no cofre (lidos pela API), e Desfazer;
  - "Ver lançamentos";
  - celular sem nada passando da tela;
  - única categoria do tipo com lançamentos;
  - **restaurar um backup de versão anterior** (código de banco com 1 dígito, bancos e categorias com o mesmo nome).
- O teste de categorias que já existia passou a escolher o ícone pelo nome em português ("Haltere").
- **Regras (`tests/unit/categories.test.ts`, 9 testes):**
  - nome repetido (catálogo em outro idioma, acento, maiúsculas, outro tipo);
  - edição sem trocar o nome, inclusive de repetidas antigas;
  - ícone fora da grade;
  - limite de categorias;
  - exclusão: o que muda e o que fica igual, relatórios salvos, exatamente o que vai para o servidor e 20 mil lançamentos movidos;
  - ordem da lista;
  - marca de restauração no lote.
- Os testes de Categorias, Bancos, Lançamentos, das outras telas e dos fluxos principais rodaram também com o relógio em 1º de janeiro de 2027. Os de Categorias rodaram 5 vezes seguidas com 6 navegadores em paralelo.

Problemas que os testes acharam e que foram corrigidos:

| # | Problema | Correção |
|---|---|---|
| Q1 | **Restaurar um backup de versão anterior podia falhar logo depois** (defeito das v0.3.5 e v0.3.6). A tela dizia "Backup restaurado", mas a gravação era recusada ("Não deu para salvar a última alteração") e os dados voltavam ao que estavam. Bastava, por exemplo, um banco com código "1" ou dois bancos com o mesmo nome, coisas que versões anteriores gravavam. | Ver B1. O teste novo falha sem a correção (conferido) e passa com ela. |
| Q2 | Grade de ícones numa coluna (D1) e tipo travado só para o mouse (D4). | Corrigidos, com teste. |
| Q3 | Edição de banco antigo com nome repetido travada no navegador (E7). | Corrigido, com teste novo em `tests/unit/banks.test.ts`. |
| Q4 | Achado nas capturas de tela desta revisão: o menu novo do cartão fazia, no celular, um nome longo alargar a coluna além da tela. | Coluna presa à largura da tela; teste no celular. |

## 5. Banco (DBA Sênior; soluções pelo Engenheiro de Software)

| # | Achado | Feito |
|---|---|---|
| B1 | **Restaurar e "Desfazer" passavam pelas regras dos formulários.** As regras novas (investimentos na v0.3.5, bancos na v0.3.6, categorias agora) valem para o que é digitado. Os dados de um backup, ou os que "Desfazer" devolve, já existiam e foram gravados por versões que tinham outras regras. Criar um cofre a partir de um backup já aceitava esses dados; restaurar no cofre aberto, não. | O lote vai marcado como restauração (`restore`). O servidor dispensa só as regras dos formulários (quantidade, código de banco, nomes repetidos etc.). Continuam valendo banco e categoria existentes, tipo da categoria, tetos do cofre, banco principal único e revisão. Testado nos dois sentidos: o lote antigo é recusado sem a marca e aceito com ela, e a integridade continua barrando com a marca. |
| B2 | Categoria **sem nome e sem chave do catálogo** era aceita e aparecia em branco em todas as listas. | Recusada em gravações novas. |
| B3 | A chave do catálogo aceitava qualquer texto; uma chave desconhecida aparecia na tela como o caminho da tradução ("categoryNames.xyz"). | Só as 24 chaves do app. Um teste confere que a lista do servidor é a mesma de `src/data/catalog.ts`. |
| B4 | Nome com espaços sobrando era gravado assim. | Espaços das pontas saem antes de gravar. |
| B5 | Nomes repetidos | Regra no servidor dentro de cada tipo: nome dado (sem acento e sem diferença de maiúsculas) ou a mesma chave do catálogo duas vezes. Repetições antigas continuam editáveis sem trocar o nome; trocar nomes entre duas categorias numa gravação só vale. O nome traduzido das categorias do app depende do idioma e é comparado no navegador. |
| B6 | Conferências feitas, sem problema encontrado | **Mudar o tipo** de uma categoria em uso é recusado pelo servidor. **Exclusão pela metade** (faltando um lançamento) é recusada inteira, sem mudar nada. **Mover para categoria de outro tipo** é recusado. As conferências de categoria usam o índice `ix_transactions_category`, sem varrer a tabela (o teste lê o plano do SQLite). **Teto de 500 categorias** ao gravar, desde a v0.3.6. **20 mil lançamentos movidos** numa gravação: 0,34 a 0,38 s. |
| B7 | Estrutura revisada | Categorias é a única tabela com `CHECK` no tipo. Não há índice único de nome: os nomes traduzidos não estão no arquivo, e cofres antigos podem ter repetição (mesmo motivo de Bancos). O ícone é texto livre de até 30 caracteres; um ícone desconhecido aparece como "…", sem erro, e o navegador só oferece os da grade. |

Testes de banco e servidor (`tests/test_categories_db.py`, 21 testes):

- **Nome:** espaços das pontas; 3 formas de categoria sem nome; chave desconhecida; chaves iguais às do app.
- **Nomes repetidos:** 4 grafias recusadas; mesmo nome em outro tipo; mesma chave duas vezes; repetidas antigas editáveis; trocar nomes, excluir e criar no mesmo lote.
- **Exclusão:** movendo numa gravação só; pela metade; para outro tipo; 20 mil lançamentos; plano de consulta com o índice.
- **Restauração:** lote antigo aceito só com a marca; integridade e tetos mantidos.

**Desempenho** (máquina de teste, 100 mil lançamentos):

| Operação | Antes | Agora |
|---|---|---|
| Saber se a categoria tem lançamentos (formulário e diálogo, a cada redesenho) | 4,9 ms | 0 ms (a tela já tem a conta) |
| Excluir categoria movendo 20 mil lançamentos (montar a mudança e as diferenças a gravar) | 65 a 85 ms | 65 a 85 ms (igual, agora registrando a alteração nos movidos) |
| Conferir nome repetido ao salvar | — | menos de 0,1 ms |
| Gravar a exclusão com 20 mil lançamentos movidos (servidor) | — | 0,34 a 0,38 s |

## Números finais

| Suíte | Resultado |
|---|---|
| Back-end | 311 testes ok (eram 290) |
| Regras do front-end | 114 ok (eram 104) |
| Navegador | 73 ok (eram 65), estáveis em 2 rodadas seguidas com a versão final |
