# Operação

Guia para instalar, abrir, atualizar, configurar, fazer backup, restaurar, desinstalar e
resolver problemas.

## Sumário

- [Requisitos](#requisitos)
- [Instalar](#instalar)
- [Abrir o app](#abrir-o-app)
- [Primeiro uso](#primeiro-uso)
- [Atualizar](#atualizar)
- [Configuração (.env)](#configuração-env)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Backups e restauração](#backups-e-restauração)
- [Linha de comando](#linha-de-comando)
- [E-mail para envio de relatórios](#e-mail-para-envio-de-relatórios)
- [Cotações e notícias](#cotações-e-notícias)
- [Registros (logs)](#registros-logs)
- [Desinstalar](#desinstalar)
- [Problemas comuns](#problemas-comuns)

## Requisitos

| Item | Mínimo |
|---|---|
| Sistema | Windows 10 ou 11; macOS 12 (Monterey) ou mais novo |
| Espaço | cerca de 2 GB livres (ferramentas, dependências e dados) |
| Internet | na instalação; depois, só para cotações, notícias e envio de e-mail |
| Navegador | Edge, Chrome ou Safari atualizados |

O script de configuração instala o que faltar. Com o ZIP da versão, só o [uv](https://docs.astral.sh/uv/)
(que traz o Python 3.13): a interface já vem compilada. Com o repositório clonado, também o Git e
o Node.js LTS. Ele usa só fontes oficiais (winget, Homebrew, astral.sh) e não muda configurações
de segurança do sistema.

## Instalar

Baixe o ZIP da [última versão](https://github.com/guilhermehenn/lume/releases/latest) ou clone o
repositório:

```bash
git clone https://github.com/guilhermehenn/lume.git
```

O script de configuração instala as dependências, prepara a pasta de dados, faz o primeiro backup
e verifica tudo. Com o repositório clonado, ele também monta a interface e roda os testes. Pode rodar de novo quando quiser: o que já
existe é mantido. Cada execução grava um log em `setup/logs/`.

### Windows 10/11

1. Se baixou o ZIP: antes de extrair, clique com o botão direito nele → **Propriedades** →
   marque **Desbloquear** → OK. Isso evita alertas do Windows nos scripts.
2. Extraia (ou clone) numa pasta curta e **fora do OneDrive**, por exemplo `C:\Projetos\lume`.
3. Clique duas vezes em **`configurar-windows.bat`**.
   - Pode aparecer o pedido de permissão de administrador (UAC) para instalar Git e Node.js.
   - Se aparecer "O Windows protegeu o computador", clique em **Mais informações → Executar
     assim mesmo**.

Opções (no Prompt de Comando, na pasta do projeto):

```bat
configurar-windows.bat -InstalarVSCode   :: também instala o VS Code
configurar-windows.bat -PularTestes      :: não roda os testes no final
configurar-windows.bat -SemFerramentas   :: não instala programas, só prepara o projeto
```

### macOS

1. Extraia (ou clone) numa pasta **fora do iCloud Drive**, por exemplo `~/Projetos/lume`.
2. **Na primeira vez**, rode pelo Terminal:

   ```bash
   cd ~/Projetos/lume
   bash configurar-macos.command
   ```

   O macOS bloqueia o clique duplo em scripts baixados da internet; o setup tira esse bloqueio
   dos scripts do projeto e, depois disso, o clique duplo funciona.
3. Se o Homebrew não estiver instalado, o script pergunta antes de instalar (pede a senha do Mac).

Opções:

```bash
bash configurar-macos.command --sim              # responde "sim" às perguntas
bash configurar-macos.command --com-vscode       # também instala o VS Code
bash configurar-macos.command --pular-testes     # não roda os testes no final
bash configurar-macos.command --sem-ferramentas  # não instala programas, só prepara o projeto
```

> Se a montagem da interface falhar, o setup avisa e usa a versão já montada que vem no ZIP de
> cada versão (`frontend/dist`), então o app abre mesmo assim.

## Abrir o app

| Sistema | Como abrir |
|---|---|
| Windows | clique duas vezes em **`iniciar-windows.bat`** |
| macOS | clique duas vezes em **`iniciar-macos.command`** |

O navegador abre em **http://127.0.0.1:8765**. Para encerrar, feche a janela do terminal (ou
`Ctrl+C`). Se o app já estiver aberto, o atalho só abre o navegador. Se a porta estiver ocupada,
o Lume usa a próxima livre e mostra o endereço.

## Primeiro uso

1. O Lume pede para criar o primeiro **cofre**: nome do cofre, seu nome, e-mail e uma senha.
2. Escolha como começar: **Trazer os dados deste navegador** (aparece se você usou a v0.2 neste
   navegador), **Começar do zero** ou **Dados de exemplo**.
3. Guarde o **código de recuperação** que aparece ao criar (copie, baixe o `.txt` ou anote) **fora
   do computador**. Com ele você cria uma senha nova em **Esqueci a senha**, sem perder nada.

Nas próximas vezes, aparece a lista de cofres: clique no seu e entre com e-mail e senha. Por
segurança, o Lume pede a senha de novo depois de 2 horas sem uso (nada se perde).

## Atualizar

### Da 0.3.x para a 1.0

1. Feche o Lume.
2. Atualize os arquivos do projeto: `git pull`, ou extraia o ZIP novo por cima da pasta antiga
   (seus dados ficam na pasta de dados, não na do projeto).
3. Rode o script de configuração de novo (`configurar-windows.bat` ou `configurar-macos.command`).
4. Abra o Lume. Se o formato de algum cofre mudou, o Lume faz backup e atualiza o cofre na
   primeira entrada.

A 1.0 não muda o formato do cofre (esquema 2, o mesmo da 0.3.1 em diante).

### Da 0.2 para a 1.0

1. Siga os passos acima.
2. Abra o Lume **no mesmo navegador** que você usava e crie o cofre escolhendo **Trazer os dados
   deste navegador**. Os dados antigos continuam no navegador; nada é apagado.

Na importação, o Lume procura também as cópias que a v0.2 guardava à parte quando não conseguia
ler os dados (erro dos bancos criados sem identificador), conserta os bancos e traz a versão com
mais lançamentos.

> A importação lê os dados que o navegador guardou para o endereço `http://127.0.0.1:8765`. Se a
> v0.2 rodava em outra porta, abra o Lume nessa mesma porta (`APP_PORT`) para importar.

### Voltar para uma versão anterior

Um cofre aberto por uma versão mais nova pode ter sido atualizado e não abrir na antiga (o Lume
avisa "versão mais nova"). Para voltar: instale a versão antiga e restaure um backup do cofre
feito antes da atualização (`pre-migration`), como em [Restaurar](#restaurar-pelo-terminal).

## Configuração (.env)

O setup copia `.env.example` para `.env` na pasta do projeto. Depois de mudar algo, feche e abra o
Lume de novo.

| Chave | Padrão | O que faz |
|---|---|---|
| `APP_NAME` | `Lume` | Identificador do app e nome da pasta de dados. Só letras sem acento, números, espaço, ponto, hífen ou sublinhado. **Mudar este nome faz o app usar uma pasta de dados nova (vazia).** |
| `APP_DISPLAY_NAME` | `Lume` | Nome mostrado na tela |
| `APP_PORT` | `8765` | Porta local. O endereço é sempre `127.0.0.1` |
| `APP_DATA_DIR` | vazio | Pasta de dados. Vazio = padrão do sistema. Pastas sincronizadas são recusadas |
| `APP_BACKUP_EXTRA_DIR` | vazio | Pasta extra que recebe uma cópia de cada backup (nuvem, pendrive). Vazio = desligado |
| `APP_BACKUP_KEEP_DAILY` | `7` | Quantos dias guardam o último backup do dia |
| `APP_BACKUP_KEEP_WEEKLY` | `4` | Quantas semanas guardam o último backup da semana |
| `APP_OPEN_BROWSER` | `true` | Abrir o navegador ao iniciar |
| `APP_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` ou `ERROR` |

Exemplos de `APP_BACKUP_EXTRA_DIR`:

```ini
# Windows (OneDrive)
APP_BACKUP_EXTRA_DIR=C:\Users\voce\OneDrive\Backups-Lume
# macOS (iCloud Drive)
APP_BACKUP_EXTRA_DIR=~/Library/Mobile Documents/com~apple~CloudDocs/Backups-Lume
```

## Onde ficam os dados

| Sistema | Pasta de dados |
|---|---|
| Windows | `%LOCALAPPDATA%\Lume\` |
| macOS | `~/Library/Application Support/Lume/` |

| Caminho | O que é |
|---|---|
| `cofres/<id>.db` | um arquivo por cofre |
| `cofres/lixeira/` | cofres excluídos pelo app |
| `backups/cofres/<id>/` | backups de cada cofre |
| `lume.db`, `backups/` | banco interno legado (v0.2) e os backups dele |
| `cache/`, `logs/` | cotações e notícias em cache; registros |

O formato de cada arquivo está em [Modelo de dados](dados.md).

## Backups e restauração

### Automáticos

- **Quando:** ao abrir o app, uma vez por dia, de cada cofre; e antes de migrar o formato, de
  redefinir a senha, de excluir um cofre, de restaurar um backup, de carregar o exemplo ou de
  apagar tudo (sem a cópia, nada é trocado).
- **Retenção:** os 3 mais recentes, mais o último de cada um dos 7 dias e o último de cada uma
  das 4 semanas.
- **Verificação:** cada backup é conferido (`integrity_check`) antes de valer.
- **Fora do computador:** defina `APP_BACKUP_EXTRA_DIR`.
- **Configurações** mostra a data da última cópia do cofre aberto e quantas há.

### Manual, pelo app

**Configurações → Fazer backup** (ou **Exportar → Cópia de segurança**) baixa
`lume-backup-AAAA-MM-DD.json`, com todos os dados e configurações do cofre. Para restaurar:
**Configurações → Restaurar backup**, em qualquer cofre. Aceita arquivos de até 256 MB (um cofre
cheio, com 200 mil lançamentos e 100 mil operações, tem cerca de 120 MB). A restauração pode ser
desfeita pelo aviso na tela, e o Lume guarda uma cópia do cofre antes.

### Restaurar pelo terminal

Use quando o cofre não abre ou para voltar a um backup automático (`.db`). **Feche o Lume antes.**
Na pasta `backend/`:

```bash
uv run python -m app.cli backups --cofre "Pessoal"                # lista os backups do cofre
uv run python -m app.cli restore --latest --cofre "Pessoal"       # volta para o mais recente
uv run python -m app.cli restore <arquivo.db> --cofre "Pessoal"   # volta para um backup escolhido
```

- O cofre pode ser indicado pelo nome ou pelo começo do id.
- Antes de restaurar, o estado atual é salvo como backup `pre-restore`.
- O comando pede que você digite `SIM` para confirmar (`--yes` pula a pergunta).
- **Sem `--cofre`**, `restore` e `backups` agem sobre o banco interno legado (`lume.db`), não
  sobre os cofres.

## Linha de comando

Todos os comandos rodam na pasta `backend/`, com `uv run python -m app.cli <comando>`.

| Comando | O que faz |
|---|---|
| `doctor` | Verifica se está tudo saudável: versões do Python e do SQLite, pasta de dados gravável, banco interno, backups e porta |
| `info` | Mostra caminhos e configurações em uso |
| `setup` | Prepara pastas, `.env`, banco interno e primeiro backup (o script de configuração já roda) |
| `cofres` | Lista os cofres com id, nome, dono, número de lançamentos e estado |
| `backup [--cofre X]` | Cria um backup agora |
| `backups [--cofre X]` | Lista os backups |
| `restore (<arquivo> \| --latest) [--cofre X] [--yes]` | Restaura um backup (app fechado) |
| `redefinir-senha --cofre X` | Cria uma senha nova sem a antiga (app fechado) |

**Esqueci a senha e não tenho o código de recuperação:** feche o Lume e rode
`uv run python -m app.cli redefinir-senha --cofre "Nome"`. O comando faz backup, pede a senha nova
duas vezes e gera uma chave nova para o cofre. Depois, entre no Lume, gere um código de
recuperação novo em **Minha conta** e digite de novo a senha de app do e-mail de envio, se usar.
(Existe a opção `--senha`, que evita a pergunta, mas deixa a senha no histórico do terminal.)

## E-mail para envio de relatórios

Em **Minha conta → E-mail para envio de relatórios**, o Lume usa a **sua conta de e-mail** (SMTP)
para mandar os arquivos para o e-mail do cofre. Nada passa por servidores do Lume.

| Serviço | O que fazer |
|---|---|
| Gmail | Ative a verificação em duas etapas e crie uma **senha de app** em myaccount.google.com/apppasswords. Use essa senha, não a normal |
| Outlook.com / Hotmail | Ative a verificação em duas etapas e crie uma senha de app em account.microsoft.com/security. A Microsoft vem desligando o SMTP em contas pessoais; se o teste falhar, use outro serviço |
| Microsoft 365 (trabalho) | A empresa pode bloquear o SMTP. Se o teste falhar, fale com a TI |
| Yahoo, iCloud | Gere uma senha de app nas configurações de segurança da conta |
| Outro | Informe servidor, porta e segurança (STARTTLS ou SSL/TLS) |

Use **Enviar teste** para conferir. Depois, ligue **Cópia por e-mail** (em Configurações) se
quiser receber automaticamente cada arquivo que baixar.

Limites: 20 e-mails a cada 10 minutos por cofre; anexos de até 15 MB somados (codificados, ficam
abaixo dos 25 MB por mensagem do Gmail e do Yahoo).

## Cotações e notícias

O back-end busca os dados, guarda em cache e entrega à interface. Várias abas abertas fazem uma
busca só.

| Dado | Fonte | Atualiza | Sem internet |
|---|---|---|---|
| Dólar, euro, Bitcoin, Ethereum | AwesomeAPI | a cada 1 min | último valor, marcado como desatualizado; nova tentativa em 30 s |
| Selic meta, CDI, IPCA 12 meses | Banco Central (SGS) | a cada 1 min (o BC publica uma vez por dia) | idem |
| Notícias | RSS do InfoMoney e do Money Times | a cada 15 min | últimas notícias ou um aviso; nova tentativa em 2 min |

O resto do app funciona normalmente sem internet.

## Registros (logs)

| Onde | O quê |
|---|---|
| `logs/` na pasta de dados | registros do servidor (nível em `APP_LOG_LEVEL`) |
| `setup/logs/` na pasta do projeto | um log por execução do script de configuração |
| Janela do terminal do Lume | o mesmo que vai para `logs/`, ao vivo |

Antes de anexar um registro a uma issue, confira se não há e-mails, nomes ou caminhos pessoais.

## Desinstalar

1. Feche o Lume.
2. Faça um backup (`.json`) de cada cofre que quiser guardar.
3. Apague a pasta do projeto.
4. Para apagar também os dados, apague a pasta de dados (`%LOCALAPPDATA%\Lume` ou
   `~/Library/Application Support/Lume`). **Isso apaga cofres e backups para sempre.**

Git, uv, Node.js e VS Code continuam instalados; remova-os pelo sistema se não for usá-los.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "uv não encontrado" ao abrir | Rode o script de configuração de novo; se persistir, reinicie o computador |
| "Faltam bibliotecas" ao abrir | Rode o script de configuração de novo (a versão nova tem dependências novas) |
| A porta 8765 está ocupada | O Lume usa a próxima livre e mostra o endereço. Os dados ficam nos cofres, então nada muda |
| Esqueci a senha do cofre | Na entrada, **Esqueci a senha**: e-mail + código de recuperação + senha nova. Sem o código: [`redefinir-senha`](#linha-de-comando) |
| "Sua sessão expirou" | O Lume pede a senha depois de 2 horas sem uso. Entre de novo; nada se perde |
| "Muitas tentativas" | Espere o tempo indicado; ele cresce a cada erro, até 5 minutos |
| "Este cofre foi criado por uma versão mais nova" | Atualize o Lume |
| "Sem conexão com o Lume" na barra lateral | A janela do terminal foi fechada ou o computador dormiu. Não feche a aba: abra o Lume de novo e entre no mesmo cofre; o que estava pendente é gravado |
| O teste de e-mail falha | Confira a senha **de app** (não a normal), o servidor e a porta. Outlook.com pode não aceitar SMTP |
| Cotações não aparecem | Verifique a internet. O Lume tenta de novo sozinho |
| Meus lançamentos sumiram | Confira se entrou no cofre certo (menu da conta → Trocar de cofre). Os backups ficam em `backups/cofres/` |
| macOS: "não é possível abrir" no clique duplo | Rode uma vez pelo Terminal: `bash configurar-macos.command` |
| A interface não montou no setup | O setup usa a versão pronta do ZIP. Veja o log em `setup/logs/` |
| "A pasta de dados parece estar sincronizada com a nuvem" | Mude `APP_DATA_DIR` para uma pasta local; use `APP_BACKUP_EXTRA_DIR` para mandar cópias à nuvem |
| Erro durante o setup | Veja o log mais recente em `setup/logs/` e rode o script de novo. Persistiu? [Abra uma issue](https://github.com/guilhermehenn/lume/issues/new?template=bug_report.yml) |
