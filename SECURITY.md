# Política de segurança

O Lume guarda dados financeiros pessoais. Levamos a segurança a sério, e relatos responsáveis
são muito bem-vindos.

## Versões com correções de segurança

| Versão | Recebe correções |
|---|---|
| 1.0.x | ✅ |
| 0.x | ❌ (atualize para a 1.0) |

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub:

1. Vá em [Security → Report a vulnerability](https://github.com/guilhermehenn/lume/security/advisories/new).
2. Descreva o problema, os passos para reproduzir, a versão do Lume, o sistema operacional e o
   impacto que você imagina.
3. Se tiver uma prova de conceito, anexe. Use só dados de teste, nunca dados reais.

### O que esperar

| Etapa | Prazo-alvo |
|---|---|
| Confirmação de recebimento | até 7 dias |
| Avaliação inicial (confirmado ou não, gravidade) | até 14 dias |
| Correção ou plano de correção para falhas graves | até 30 dias |

O Lume é mantido por voluntários; os prazos são metas, não garantias. Você recebe notícias do
andamento e, se quiser, crédito no aviso de segurança e no `CHANGELOG.md` quando a correção sair.

Pedimos que não divulgue a falha antes da correção (ou antes de 90 dias do relato, o que vier
primeiro) e que não acesse, altere ou apague dados de outras pessoas.

## Escopo

**Dentro do escopo:**

- o servidor local: autenticação, sessões, limite de tentativas, proteção contra outros sites
  (Host, Origin, cabeçalho `X-App-Request`, CSP);
- a integridade dos cofres: gravação, validação, migrações, backups e restauração;
- a criptografia da chave do cofre, do código de recuperação e da senha de app do e-mail;
- o envio de e-mail e o acesso do back-end à internet (lista fixa de endereços);
- os scripts de configuração e de inicialização.

**Fora do escopo (limites conhecidos):**

- Quem já tem acesso à conta do usuário no computador. O arquivo do cofre **não é
  criptografado**, por decisão de projeto; veja [docs/seguranca.md](docs/seguranca.md).
- Ataques que exigem acesso físico ao computador ou um sistema operacional já comprometido.
- Vulnerabilidades em dependências sem um caminho de exploração no Lume. Mesmo assim, avise:
  atualizamos a dependência.
- Expor o Lume na rede de propósito (por exemplo, com um proxy reverso). O servidor foi feito
  para escutar só em `127.0.0.1`.

## Boas práticas para quem usa o Lume

- Use uma senha forte para cada cofre e guarde o código de recuperação fora do computador.
- Proteja a conta do computador com senha e ative a criptografia do disco (BitLocker no Windows,
  FileVault no macOS).
- Guarde os backups em local seguro: eles têm os mesmos dados do cofre.
- Mantenha o Lume atualizado.

O modelo de ameaças completo está em [docs/seguranca.md](docs/seguranca.md).
