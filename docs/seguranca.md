# Segurança

Como o Lume protege os dados, contra o quê, e o que fica fora do alcance dele. Para relatar uma
falha, siga o [SECURITY.md](../SECURITY.md).

## Sumário

- [O que está em jogo](#o-que-está-em-jogo)
- [Modelo de ameaças](#modelo-de-ameaças)
- [Proteções](#proteções)
- [Criptografia](#criptografia)
- [Acesso à internet](#acesso-à-internet)
- [Limites conhecidos](#limites-conhecidos)
- [Recomendações para quem usa](#recomendações-para-quem-usa)
- [Checklist para quem contribui](#checklist-para-quem-contribui)

## O que está em jogo

| Ativo | Onde fica | Sensibilidade |
|---|---|---|
| Lançamentos, investimentos, bancos e relatórios | arquivo do cofre (`cofres/<id>.db`) e backups | alta: revela renda, gastos e patrimônio |
| E-mail, nome e foto do dono | arquivo do cofre | média |
| Senha do cofre | só o hash scrypt, no arquivo do cofre | alta |
| Código de recuperação | só o hash, no arquivo do cofre; o código fica com o usuário | alta |
| Senha de app do e-mail | criptografada no arquivo do cofre | alta: permite enviar e-mails pela conta do usuário |
| Sessão | cookie no navegador e memória do servidor | alta enquanto vale |

## Modelo de ameaças

| Ameaça | Exemplo | Protegido? |
|---|---|---|
| Outro site aberto no navegador tenta ler ou gravar no Lume | página maliciosa faz `fetch('http://127.0.0.1:8765/api/…')` | ✅ Host, Origin, cabeçalho `X-App-Request`, cookie `SameSite=Strict`, sem CORS |
| *DNS rebinding* | domínio que passa a apontar para `127.0.0.1` | ✅ só os hosts `127.0.0.1`, `localhost` e `[::1]` |
| Outro aparelho da rede tenta acessar | celular na mesma rede Wi-Fi | ✅ o servidor escuta só em `127.0.0.1` |
| Alguém tenta adivinhar a senha pela tela | tentativas em sequência | ✅ espera crescente depois de 5 erros |
| Alguém usa o computador destrancado com o Lume aberto | sessão esquecida aberta | ⚠️ a sessão vence em 2 h sem uso; **Ocultar valores** ajuda em público |
| Injeção de script pelos dados | nome de lançamento com `<script>` | ✅ React escapa o texto; CSP bloqueia scripts que não sejam do app |
| Injeção de fórmula em planilha | lançamento chamado `=HYPERLINK(...)` exportado para CSV | ✅ células que começam com `=`, `+`, `-`, `@` são neutralizadas |
| Arquivo de backup adulterado | JSON com dados inválidos ou enormes | ✅ validação completa e limites antes de gravar; cópia do cofre antes de trocar |
| Feed RSS malicioso | entidades XML externas | ✅ o leitor de RSS não aceita entidades externas |
| Resposta adulterada de cotação | número infinito ou absurdo | ✅ valores NaN e infinitos são recusados |
| Perda de dados por queda de energia ou erro | desligar no meio de uma gravação | ✅ transações, `synchronous=FULL`, backups verificados |
| Quem tem acesso à conta do usuário no sistema | outro usuário com a mesma conta, malware | ❌ fora do escopo; veja [Limites conhecidos](#limites-conhecidos) |

## Proteções

### Servidor local

- Escuta **somente em `127.0.0.1`**; a porta é configurável, o endereço não.
- Middleware próprio (`backend/app/api/security.py`, sem dependências):
  - **Host** permitido: `127.0.0.1`, `localhost`, `[::1]`;
  - **escrita** em `/api` exige `X-App-Request: 1`, que outro site não consegue enviar sem CORS
    (e o servidor nunca libera CORS);
  - **Origin**, quando presente, precisa ser o próprio Lume;
  - corpo acima de 256 MB é recusado antes de ser lido.
- Cabeçalhos em todas as respostas: CSP, `X-Content-Type-Options: nosniff`, bloqueio de iframes
  (`frame-ancestors 'none'`) e `Cache-Control: no-store` na API.

### Política de conteúdo (CSP)

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'self'
```

A interface não carrega nada de fora: fontes, ícones e estilos vão no próprio build. Os testes
no navegador **falham** se aparecer qualquer violação de CSP ou erro no console.

### Contas, senhas e sessões

| Item | Como funciona |
|---|---|
| Senha | 8 a 200 caracteres, normalizada (NFKC, para acentos funcionarem em qualquer teclado) e guardada como hash **scrypt** (N=2¹⁵, r=8, p=1) com sal |
| Entrada | tempo de resposta parecido para e-mail certo ou errado, para não revelar o e-mail do cofre |
| Tentativas | 5 erros livres por cofre em 15 minutos; depois 15 s, 30 s, 60 s… até 5 min |
| Sessão | token aleatório de 256 bits num cookie `HttpOnly` e `SameSite=Strict`; 2 h sem uso ou 24 h no máximo; só em memória |
| Trocar senha | encerra as outras sessões do cofre |
| Código de recuperação | 100 bits aleatórios em base32 de Crockford; guardado só como hash; uso único |
| Esqueci a senha sem o código | só pelo terminal, com o app fechado (`redefinir-senha`), o que exige acesso ao computador |
| Ações sensíveis | trocar o e-mail de acesso, gerar código novo e excluir o cofre pedem a senha atual |

### Integridade dos dados

- Toda gravação acontece numa transação, com conferência de revisão: duas janelas não se
  sobrescrevem às cegas.
- As regras de negócio são conferidas no navegador **e** no servidor.
- Chaves estrangeiras e índices únicos no próprio SQLite são a última barreira.
- Backups verificados com `integrity_check` antes de valerem; cópia automática antes de qualquer
  troca de dados em massa.

## Criptografia

| O quê | Como |
|---|---|
| Chave de dados do cofre | 32 bytes aleatórios, gerados ao criar o cofre |
| Chave embrulhada pela senha | AES-GCM com chave derivada da senha por scrypt (formato `v2`, que guarda os parâmetros) |
| Chave embrulhada pelo código de recuperação | AES-GCM com chave derivada por HKDF-SHA256 (formato `r1`) |
| Senha de app do e-mail | AES-GCM com a chave de dados |
| Biblioteca | [`cryptography`](https://cryptography.io/) (Apache-2.0/BSD) |

A chave de dados só existe na memória do servidor enquanto há uma sessão aberta. Trocar a senha
re-embrulha a mesma chave; redefinir pelo terminal gera uma chave nova (e a senha do e-mail
precisa ser digitada de novo).

## Acesso à internet

A **interface** não acessa nenhum site de terceiros (a CSP impede). Só o **back-end** acessa a
internet, e só nestes endereços (`ALLOWED_PREFIXES` em `backend/app/services/remote.py`):

| Endereço | Para quê |
|---|---|
| `https://economia.awesomeapi.com.br/` | cotações de moedas e criptomoedas |
| `https://api.bcb.gov.br/dados/serie/` | Selic, CDI e IPCA (Banco Central, SGS) |
| `https://www.infomoney.com.br/` | notícias (RSS) |
| `https://www.moneytimes.com.br/` | notícias (RSS) |

Nenhum dado do usuário vai nessas requisições. Além delas, o Lume só se conecta ao servidor SMTP
que o próprio usuário configurar, e só quando ele manda um e-mail. Não há telemetria, análise de
uso nem verificação de atualização.

## Limites conhecidos

Estas são decisões de projeto da versão 1.0, não falhas:

1. **O arquivo do cofre não é criptografado.** A senha protege o acesso **pelo Lume**. Quem tiver
   acesso à conta do usuário no sistema consegue abrir o `.db` com qualquer programa de SQLite.
   Criptografar o arquivo exigiria uma versão especial do SQLite (SQLCipher), mais difícil de
   instalar nos dois sistemas, e uma senha perdida significaria dados perdidos. A proteção
   recomendada é a do próprio sistema: senha na conta e disco criptografado.
2. **Backups têm os mesmos dados do cofre**, sem criptografia. A cópia extra
   (`APP_BACKUP_EXTRA_DIR`) numa pasta de nuvem fica sujeita à segurança dessa nuvem.
3. **O servidor não usa HTTPS.** O tráfego não sai do computador (`127.0.0.1`), então não há rede
   para interceptar.
4. **Quem controla o computador controla o Lume.** Malware, um sistema comprometido ou alguém
   com a conta do usuário pode ler arquivos, a memória do servidor e o que é digitado.
5. **`redefinir-senha` pelo terminal** troca a senha sem a anterior. É o caminho de recuperação de
   quem perdeu o código, e só funciona para quem já tem acesso aos arquivos.
6. **Expor o Lume na rede** (proxy reverso, túnel) não é suportado e anula várias proteções.

## Recomendações para quem usa

- Senha forte e diferente para cada cofre; código de recuperação guardado fora do computador.
- Senha na conta do computador e criptografia do disco ligada (BitLocker no Windows, FileVault no
  macOS).
- Backups em local seguro; se usar `APP_BACKUP_EXTRA_DIR` numa nuvem, ative a verificação em duas
  etapas nessa conta.
- No e-mail de envio, use uma **senha de app**, nunca a senha principal da conta.
- Mantenha o Lume atualizado.

## Checklist para quem contribui

- [ ] Nada novo é carregado de fora pela interface (fontes, imagens, scripts, estilos).
- [ ] Toda chamada nova à internet passa por `remote.py` e está na lista de endereços.
- [ ] Rotas novas que gravam passam pelo middleware (estão em `/api`) e exigem sessão quando
      mexem num cofre.
- [ ] Entradas novas têm limite de tamanho no navegador e no servidor.
- [ ] Nenhum segredo (senha, código, chave) aparece em log, mensagem de erro ou resposta.
- [ ] Texto vindo do usuário nunca vira HTML sem escape, nem célula de planilha sem proteção.
- [ ] Dependência nova tem licença compatível e foi discutida numa issue.
