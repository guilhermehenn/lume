# API local

O back-end do Lume é uma API HTTP feita com FastAPI, servida em `http://127.0.0.1:8765` (porta
configurável). Ela existe para a interface do próprio Lume: **não é uma API pública** e pode
mudar entre versões menores. Ainda assim, está documentada para quem quer depurar, testar ou
escrever ferramentas locais.

Com o app aberto, a documentação interativa (OpenAPI) fica em
`http://127.0.0.1:8765/api/docs`, e o esquema em `/api/openapi.json`.

## Sumário

- [Convenções](#convenções)
- [Proteções em toda requisição](#proteções-em-toda-requisição)
- [Autenticação](#autenticação)
- [Erros](#erros)
- [Rotas](#rotas)
- [Lote de mudanças](#lote-de-mudanças)
- [Exemplos](#exemplos)

## Convenções

| Item | Regra |
|---|---|
| Prefixo | todas as rotas começam com `/api` |
| Formato | JSON (UTF-8) na entrada e na saída |
| Nomes | `camelCase` (`baseRevision`, `bankId`) |
| Dinheiro | centavos inteiros |
| Datas | `AAAA-MM-DD` para lançamentos; ISO 8601 em UTC para carimbos de tempo |
| Campos extras | recusados (`422 invalid`) nos corpos das rotas de cofre e de conta |
| Cache | respostas da API não são guardadas em cache (`Cache-Control: no-store`) |

## Proteções em toda requisição

Um site qualquer aberto no navegador consegue mandar requisições para `127.0.0.1`. O middleware
de `backend/app/api/security.py` bloqueia isso:

1. **Host**: só `127.0.0.1`, `localhost` e `[::1]` (contra *DNS rebinding*). Outro host → `400`.
2. **Cabeçalho próprio**: toda escrita (`POST`, `PUT`, `PATCH`, `DELETE`) em `/api` exige
   `X-App-Request: 1`. O navegador não deixa outro site enviar esse cabeçalho sem CORS, que o
   servidor nunca libera. Sem ele → `403`.
3. **Origem**: se o navegador mandar `Origin`, ela precisa ser o próprio endereço do Lume.
4. **Tamanho**: corpo acima de 256 MB é recusado antes de ser lido (`413`).
5. **Cabeçalhos de segurança** em todas as respostas: CSP rígida, `X-Content-Type-Options:
   nosniff`, proibição de iframes. A página `/api/docs` carrega arquivos de um CDN e por isso fica
   sem CSP.

## Autenticação

- `POST /api/vaults/{id}/session` (entrar), `POST /api/vaults` (criar) e
  `POST /api/vaults/{id}/recover` (esqueci a senha) devolvem o cookie de sessão
  **`lume_session`** (`HttpOnly`, `SameSite=Strict`, `Path=/`).
- O cookie vale até 2 h sem uso ou 24 h no total. As sessões ficam só na memória do servidor:
  fechar o Lume encerra todas.
- Há um cookie por navegador. Entrar em outro cofre encerra a sessão anterior.
- Rotas que leem ou gravam o cofre aceitam o cabeçalho opcional **`X-Vault-Id`**: se o cofre da
  sessão for outro (outra aba trocou de cofre), a resposta é `409 vault-changed` e nada é gravado.
- Erros de senha contam para o **limite de tentativas** do cofre: 5 livres em 15 minutos; depois
  a espera dobra a cada erro (15 s, 30 s, 60 s…) até 5 min. A resposta `429 throttled` traz
  `retryAfter` (segundos) e o cabeçalho `Retry-After`.

## Erros

As rotas de cofre e de conta respondem erros neste formato:

```json
{
  "detail": {
    "code": "conflict",
    "message": "Os dados mudaram em outra janela.",
    "revision": 42
  }
}
```

`retryAfter` aparece em erros com espera; `revision`, em conflitos de gravação. A interface
mostra a mensagem traduzida a partir do `code`.

| HTTP | `code` | Quando |
|---|---|---|
| 401 | `unauthenticated` | sem sessão, ou a sessão venceu |
| 401 | `bad-credentials` | e-mail ou senha errados |
| 401 | `bad-recovery` | código de recuperação errado |
| 403 | `bad-password` | senha atual errada (trocar senha, trocar e-mail, excluir cofre) |
| 404 | `not-found` | cofre inexistente |
| 409 | `conflict` | `baseRevision` diferente da revisão atual do cofre |
| 409 | `vault-changed` | `X-Vault-Id` diferente do cofre da sessão |
| 409 | `unreadable`, `corrupted` | arquivo do cofre ilegível ou com chave danificada |
| 409 | `too-new` | cofre criado por uma versão mais nova do Lume |
| 409 | `mail-not-configured` | e-mail de envio não configurado |
| 409 | `mail-password-lost` | a senha de app precisa ser digitada de novo (depois de `redefinir-senha`) |
| 413 | `mail-too-big` | anexos acima de 15 MB |
| 422 | `invalid` | corpo inválido (campo, tipo, limite ou regra de negócio) |
| 422 | outros | regras de cadastro, como `invalid-email`, `weak-password-short`, `photo-too-big` |
| 429 | `throttled` | muitas tentativas de senha; veja `retryAfter` |
| 429 | `mail-limit` | mais de 20 e-mails em 10 minutos |
| 502 | `mail-*` | o servidor de e-mail recusou ou não respondeu |
| 503 | `storage` | erro de disco, ou não foi possível fazer a cópia de segurança antes de trocar os dados |

## Rotas

### Sistema e mercado (sem sessão)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/health` | `{status, service, app, version}`; usado pelos scripts para saber se o Lume já está aberto |
| GET | `/api/system/info` | versões (app, Python, SQLite), sistema operacional, pasta de dados e estado do banco interno |
| GET | `/api/market?refresh=` | cotações (dólar, euro, Bitcoin, Ethereum) e indicadores (Selic, CDI, IPCA 12 meses), com fonte, horário e se estão desatualizados |
| GET | `/api/news?refresh=` | notícias dos RSS do InfoMoney e do Money Times |
| GET | `/api/backups` | backups do banco interno legado |
| POST | `/api/backups` | cria um backup do banco interno legado (`201`) |

`refresh=true` força uma busca nova, respeitando um intervalo mínimo para não sobrecarregar as
fontes.

### Cofres e sessão

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/vaults` | | lista de cofres: `id`, `name`, `ownerFirstName`, `ownerLastName`, `initials`, `emailHint` (e-mail mascarado), `photo`, `createdAt`, `lastOpenedAt`, `entries`, `status` (`ok`, `needs-update`, `too-new`, `error`) |
| POST | `/api/vaults` | `name`, `firstName`, `lastName`, `email`, `password`, `data?`, `settings?` | `201`, sessão e `recoveryCode` (mostrado uma única vez) |
| POST | `/api/vaults/{id}/session` | `email`, `password` | sessão (veja abaixo) |
| POST | `/api/vaults/{id}/recover` | `email`, `recoveryCode`, `newPassword` | sessão e um `recoveryCode` novo |
| GET | `/api/session` | | sessão atual |
| DELETE | `/api/session` | | `204`; apaga o cookie |

A **sessão** tem o formato `{vault, account, settings, revision}`: o resumo do cofre, os dados do
dono (sem a senha), as configurações e a revisão atual.

### Dados do cofre (com sessão)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/vault/data` | | `{revision, data}`, lidos numa única transação |
| POST | `/api/vault/changes` | [lote de mudanças](#lote-de-mudanças) | `{revision}` (a nova) |
| GET | `/api/vault/backups` | | `{count, latest: {createdAt, reason} \| null}` |
| PUT | `/api/vault/settings` | só as chaves que mudam (`language`, `currency`, `theme`, `hideValues`, `onboardingDone`, `emailCopies`) | configurações completas |
| PATCH | `/api/vault` | `name` | resumo do cofre |
| POST | `/api/vault/delete` | `password` | `204`; backup e o arquivo vai para `cofres/lixeira/` |

### Minha conta (com sessão)

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/api/account` | | dono e e-mail de envio (sem senhas) |
| PUT | `/api/account` | `firstName`, `lastName`, `email`, `photo?`, `currentPassword?` | conta atualizada. Sem `photo`, a foto fica; `photo: null` remove. Trocar o e-mail exige `currentPassword` |
| POST | `/api/account/password` | `currentPassword`, `newPassword` | `{closedSessions}`: as outras sessões encerradas |
| POST | `/api/account/recovery-code` | `currentPassword` | `{recoveryCode}` novo; o anterior deixa de valer |
| POST | `/api/account/recovery-code/confirm` | | marca o código como guardado |
| PUT | `/api/account/mail` | `provider`, `host`, `port`, `security`, `username`, `fromName`, `password?` | e-mail de envio. `password` ausente mantém a guardada; `""` apaga |
| DELETE | `/api/account/mail` | | `204` |
| POST | `/api/account/mail/test` | | `{to}`: manda um e-mail de teste |
| POST | `/api/mail/send` | `subject`, `text`, `html?`, `attachments[]` (`filename`, `contentType`, `data` em base64) | `{to}` |

`provider`: `gmail`, `outlook`, `office365`, `yahoo`, `icloud` ou `custom` (os quatro primeiros
já sabem servidor, porta e segurança). `security`: `starttls`, `ssl` ou `none` (este só para
servidores no próprio computador). Envio: até 10 anexos e 15 MB somados.

## Lote de mudanças

Toda gravação de dados passa por `POST /api/vault/changes`. A interface calcula o que mudou
desde a última gravação e manda um lote só:

```json
{
  "baseRevision": 41,
  "upserts": {
    "transactions": [
      {
        "id": "7d0c4c1e-2b7a-4f5e-9a51-3f0e7a1b2c3d",
        "kind": "expense",
        "amount": 4590,
        "date": "2026-11-21",
        "bankId": "…",
        "categoryId": "…",
        "counterparty": "Mercado Bom Preço",
        "paymentMethod": "pix",
        "note": null,
        "createdAt": "2026-11-21T18:30:00Z",
        "updatedAt": "2026-11-21T18:30:00Z"
      }
    ]
  },
  "deletes": {
    "reports": ["…"]
  }
}
```

| Campo | Significado |
|---|---|
| `baseRevision` | a revisão em que a interface se baseou |
| `upserts` | registros novos ou alterados, por coleção (`banks`, `categories`, `transactions`, `investments`, `reports`) |
| `deletes` | ids excluídos, por coleção |
| `restore` | `true` para dados que já existiam (backup restaurado, "Desfazer"): valem a integridade e os limites, mas não as regras dos formulários |
| `checkpoint` | `before-restore`, `before-sample` ou `before-reset`: o servidor faz uma cópia verificada do cofre antes de gravar; se a cópia falhar, nada é gravado (`503 storage`) |

Como o servidor aplica o lote:

1. Confere o formato. Um lote que grava e exclui o mesmo registro, ou traz duas versões dele, é
   recusado.
2. Abre uma transação (`BEGIN IMMEDIATE`) e compara `baseRevision` com a revisão do cofre.
   Diferente → `409 conflict` com a revisão atual. A interface busca os dados, aplica as mudanças
   pendentes por cima e tenta de novo.
3. Grava com `INSERT … ON CONFLICT (id) DO UPDATE` e as exclusões.
4. Confere as regras: nomes sem repetição, banco e categoria existentes, categoria do mesmo tipo
   do lançamento, banco ou categoria excluídos sem uso, limites de quantidade. Lotes de até 500
   mudanças conferem só as linhas tocadas; lotes maiores conferem o cofre inteiro.
5. Soma 1 à revisão e faz o `COMMIT`. Qualquer falha desfaz tudo (`ROLLBACK`): o lote é aplicado
   inteiro ou não é aplicado.

## Exemplos

Pelo terminal, com o Lume aberto (troque a porta se mudou a sua):

```bash
# O Lume está no ar?
curl http://127.0.0.1:8765/api/health

# Entrar num cofre (o cookie fica em cookies.txt)
curl -c cookies.txt -H "X-App-Request: 1" -H "Content-Type: application/json" \
  -d '{"email":"voce@exemplo.com","password":"sua senha"}' \
  http://127.0.0.1:8765/api/vaults/<id>/session

# Ler os dados
curl -b cookies.txt http://127.0.0.1:8765/api/vault/data

# Sair
curl -b cookies.txt -X DELETE -H "X-App-Request: 1" http://127.0.0.1:8765/api/session
```

O id de cada cofre aparece em `GET /api/vaults` ou em `uv run python -m app.cli cofres`.
