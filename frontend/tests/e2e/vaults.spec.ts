// Cofres, entrada com e-mail e senha, Minha conta e envio por e-mail.

import { createSampleData } from '../../src/data/sample'
import { createVault, EMAIL, expect, mockApi, PASSWORD, PREVIOUS_MONTH, pretendNoVaults, test, TODAY } from './fixtures'

const H = { 'X-App-Request': '1' }

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('entrar: escolher o cofre, senha errada, entrar, sair e voltar', async ({ page }) => {
  const stamp = Date.now()
  const ana = `Ana ${stamp}`
  await createVault(page, { name: ana, firstName: 'Ana', email: 'ana@example.com' })
  await createVault(page, { name: `Bia ${stamp}`, firstName: 'Bia', email: 'bia@example.com' })
  await page.request.delete('/api/session', { headers: H })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Escolha um cofre' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(ana) }).click()
  await expect(page.getByRole('heading', { name: ana })).toBeVisible()
  await page.getByLabel('E-mail').fill('ana@example.com')
  await page.getByLabel('Senha', { exact: true }).fill('senha errada demais')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()
  await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('')

  // A senha de outro cofre não abre este
  await page.getByLabel('E-mail').fill('bia@example.com')
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()

  await page.getByLabel('E-mail').fill('ANA@example.com')
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana')

  // Sair pelo menu da conta
  await page.getByRole('button', { name: 'Conta e cofre' }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await expect(page.getByText('Você saiu do cofre.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Escolha um cofre' })).toBeVisible()
  // Sem sessão, a API de dados recusa
  expect((await page.request.get('/api/vault/data')).status()).toBe(401)

  // Voltar: o e-mail já vem preenchido
  await page.getByRole('button', { name: new RegExp(ana) }).click()
  await expect(page.getByLabel('E-mail')).toHaveValue('ANA@example.com')
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ana')
})

test('esqueci a senha: o código de recuperação troca a senha e entra', async ({ page }) => {
  const { vault, recoveryCode } = await createVault(page)
  await createVault(page)
  await page.request.delete('/api/session', { headers: H })
  await page.goto('/')
  await page.getByRole('button', { name: new RegExp(vault.name) }).click()
  await page.getByRole('button', { name: 'Esqueci a senha' }).click()
  await expect(page.getByRole('heading', { name: 'Esqueceu a senha?' })).toBeVisible()

  // Sem o código: o comando do terminal
  await page.getByRole('button', { name: 'Não tenho o código' }).click()
  await expect(page.getByText(`uv run python -m app.cli redefinir-senha --cofre "${vault.name}"`)).toBeVisible()

  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Código de recuperação').fill('AAAAA-AAAAA-AAAAA-AAAAA')
  await page.getByLabel('Nova senha', { exact: true }).fill('minha senha nova')
  await page.getByLabel('Confirmar nova senha').fill('minha senha nova')
  await page.getByRole('button', { name: 'Trocar a senha e entrar' }).click()
  await expect(page.getByText('E-mail ou código incorretos.')).toBeVisible()

  // Do jeito que alguém digita: minúsculas e espaços no lugar dos traços
  await page.getByLabel('Código de recuperação').fill(recoveryCode.toLowerCase().replaceAll('-', ' '))
  await page.getByRole('button', { name: 'Trocar a senha e entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Guarde seu código de recuperação' })).toBeVisible()
  await expect(page.locator('#recovery-code')).not.toHaveText(recoveryCode)
  await page.getByLabel('Guardei o código em lugar seguro').check()
  await page.getByRole('button', { name: 'Entrar no cofre' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Guilherme')

  // A senha antiga não vale mais; a nova sim
  await page.request.delete('/api/session', { headers: H })
  const old = await page.request.post(`/api/vaults/${vault.id}/session`, { headers: H, data: { email: EMAIL, password: PASSWORD } })
  expect(old.status()).toBe(401)
  const fresh = await page.request.post(`/api/vaults/${vault.id}/session`, { headers: H, data: { email: EMAIL, password: 'minha senha nova' } })
  expect(fresh.status()).toBe(200)
})

test('tela de entrada: idioma, nome repetido e lembrete do código', async ({ page }) => {
  const { vault } = await createVault(page, { keepRecoveryReminder: true })
  await page.goto('/')
  // Lembrete no Início enquanto o código não foi guardado
  await page.getByRole('link', { name: /guarde o código de recuperação/ }).click()
  await expect(page).toHaveURL(/section=recovery/)
  await page.getByRole('button', { name: 'Gerar novo código' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Senha atual').fill('errada errada')
  await sheet.getByRole('button', { name: 'Gerar', exact: true }).click()
  await expect(sheet.getByText('Senha atual incorreta.')).toBeVisible()
  await sheet.getByLabel('Senha atual').fill(PASSWORD)
  await sheet.getByRole('button', { name: 'Gerar', exact: true }).click()
  await expect(sheet.locator('#recovery-code')).toBeVisible()
  await sheet.getByLabel('Guardei o código em lugar seguro').check()
  await sheet.getByRole('button', { name: 'Pronto' }).click()
  await expect(page.getByText(/^Guardado\. Gerado em/)).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('link', { name: /guarde o código de recuperação/ })).toHaveCount(0)

  // Sair, trocar o idioma antes de entrar e tentar criar um cofre com nome repetido
  await page.getByRole('button', { name: 'Conta e cofre' }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByText('You signed out of the vault.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Choose a vault' })).toBeVisible()
  await page.getByRole('button', { name: /Create a new vault/ }).click()
  await page.getByLabel('Vault name').fill(vault.name.toUpperCase())
  await page.getByLabel('First name').fill('Ana')
  await page.getByLabel('Email').fill('ana@example.com')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('There’s already a vault with that name.')).toBeVisible()
  await expect(page.getByLabel('Vault name')).toBeFocused()
  await page.getByRole('button', { name: 'Português' }).click()
  await expect(page.getByRole('heading', { name: 'Cofre e dono' })).toBeVisible()
})

test('cofre novo trazendo os dados da versão anterior (navegador)', async ({ page }) => {
  // Os dados de exemplo vão até o mês de hoje: com o relógio fixado, o "hoje" dos testes.
  const sample = JSON.stringify(createSampleData(TODAY))
  await page.addInitScript((data) => {
    localStorage.setItem('lume.data.v1', data)
    localStorage.setItem(
      'lume.settings.v1',
      JSON.stringify({ language: 'pt', currency: 'BRL', theme: 'dark', name: 'Maria Souza', hideValues: false, onboardingDone: true }),
    )
  }, sample)
  await pretendNoVaults(page)
  await page.goto('/')
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Maria')
  await expect(page.getByLabel('Sobrenome')).toHaveValue('Souza')
  await expect(page.getByLabel('Nome do cofre')).toHaveValue('Pessoal')
  const vaultName = `Pessoal ${Date.now() % 1_000_000}`
  await page.getByLabel('Nome do cofre').fill(vaultName)
  await page.getByLabel('E-mail').fill(`maria-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirmar senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('radio', { name: /Trazer os dados deste navegador/ })).toBeChecked()
  // Clique duplo cria um cofre só (e não mostra "nome repetido")
  await page.getByRole('button', { name: 'Criar cofre' }).dblclick()
  await page.getByLabel('Guardei o código em lugar seguro').check()
  await page.getByRole('button', { name: 'Entrar no cofre' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Maria')
  await page.goto(`/#/transactions?month=${PREVIOUS_MONTH}`)
  await expect(page.getByRole('button', { name: /Netflix/ }).first()).toBeVisible()
  const names = ((await (await page.request.get('/api/vaults')).json()) as { name: string }[]).map((v) => v.name)
  expect(names.filter((n) => n === vaultName).length).toBe(1)
  // Os dados antigos continuam no navegador (nada é apagado)
  expect(await page.evaluate(() => localStorage.getItem('lume.data.v1'))).not.toBeNull()
})

test('sessão expirada: a tela tranca e, ao entrar de novo, nada se perde', async ({ page }) => {
  const { vault } = await createVault(page)
  await page.goto('/#/banks')
  await expect(page.getByRole('heading', { name: 'Bancos' })).toBeVisible()
  // O servidor encerra a sessão (como depois de 2 horas sem uso)
  await page.request.delete('/api/session', { headers: H })

  await page.getByRole('button', { name: 'Novo banco' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel('Nome').fill('Cofrinho')
  await sheet.getByRole('button', { name: 'Salvar', exact: true }).click()

  await expect(page.getByText('Sua sessão expirou. Entre de novo para continuar; nada do que você fez se perdeu.')).toBeVisible()
  await expect(page.getByRole('heading', { name: vault.name })).toBeVisible()
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()

  await expect(page.getByRole('listitem').filter({ hasText: 'Cofrinho' })).toBeVisible()
  await expect(page.getByText('Salvo no cofre')).toBeVisible()
  const saved = (await (await page.request.get('/api/vault/data')).json()) as { data: { banks: { name: string }[] } }
  expect(saved.data.banks.map((b) => b.name)).toContain('Cofrinho')
})

test('outra aba abre outro cofre: esta tranca em vez de gravar no cofre errado', async ({ page, context }) => {
  await createVault(page, { firstName: 'Carla' })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Carla')

  const other = await context.newPage()
  await mockApi(other)
  await createVault(other, { firstName: 'Davi' })
  await other.goto('/')
  await expect(other.getByRole('heading', { level: 1 })).toContainText('Davi')
  // avisa a primeira aba (como o app faz ao entrar num cofre pela tela)
  await other.evaluate(() => new BroadcastChannel('lume.session').postMessage({ type: 'opened', vaultId: 'outro' }))

  await expect(page.getByText('Outra janela abriu um cofre diferente. Escolha um cofre para continuar aqui.')).toBeVisible()
})

test('minha conta: perfil, foto, senha e e-mail para envio', async ({ page }) => {
  await createVault(page)
  await page.goto('/#/account')
  await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible()

  // Perfil
  await page.locator('#acc-first').fill('Gui')
  await page.locator('#acc-last').fill('Henn Silva')
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.getByText('Perfil salvo')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Conta e cofre' })).toContainText('Gui Henn Silva')

  // Trocar o e-mail pede a senha atual
  await page.locator('#acc-email').fill('novo@example.com')
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.locator('#acc-pass')).toBeVisible()
  await page.locator('#acc-pass').fill('senha errada demais')
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.getByText('Senha atual incorreta.')).toBeVisible()
  await page.locator('#acc-pass').fill(PASSWORD)
  await page.getByRole('button', { name: 'Salvar perfil' }).click()
  await expect(page.locator('#acc-pass')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Conta e cofre' })).toBeVisible()
  await page.getByRole('button', { name: 'Conta e cofre' }).click()
  await expect(page.getByRole('menu')).toContainText('novo@example.com')
  await page.keyboard.press('Escape')

  // Foto: um PNG 2×1 é recortado e reduzido
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC', 'base64')
  await page.locator('input[type=file]').setInputFiles({ name: 'eu.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('button', { name: 'Remover foto' })).toBeVisible()
  await expect(page.locator('aside img').first()).toHaveAttribute('src', /^data:image\/jpeg;base64,/)

  // Senha
  await page.getByLabel('Senha atual', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Nova senha', { exact: true }).fill('curta')
  await page.getByRole('button', { name: 'Trocar senha' }).click()
  await expect(page.getByText('Use pelo menos 8 caracteres.')).toBeVisible()
  await page.getByLabel('Nova senha', { exact: true }).fill('outra senha bem comprida')
  await page.getByLabel('Confirmar nova senha').fill('outra senha bem comprida')
  await page.getByRole('button', { name: 'Trocar senha' }).click()
  await expect(page.getByText('Senha trocada')).toBeVisible()

  // E-mail para envio: servidor que não existe → erro amigável no teste
  await expect(page.getByText('Não configurado')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Cópia por e-mail' })).not.toBeChecked()
  await page.locator('#mail-provider').click()
  await page.getByRole('option', { name: 'Outro (SMTP)' }).click()
  await page.locator('#mail-host').fill('localhost')
  await page.locator('#mail-port').fill('1')
  await page.locator('#mail-security').click()
  await page.getByRole('option', { name: 'Nenhuma (só localhost)' }).click()
  await page.locator('#mail-pass').fill('senha-de-app')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByText('E-mail para envio salvo')).toBeVisible()
  await expect(page.getByText(/^Envia por /)).toBeVisible()
  await expect(page.locator('#mail-pass')).toHaveAttribute('placeholder', 'Guardada. Deixe em branco para manter.')
  await page.getByRole('button', { name: 'Enviar teste' }).click()
  await expect(page.getByText(/Não deu para conectar ao servidor de e-mail/)).toBeVisible()
  await page.getByRole('switch', { name: 'Cópia por e-mail' }).click()
  await expect(page.getByRole('switch', { name: 'Cópia por e-mail' })).toBeChecked()
  await page.getByRole('button', { name: 'Remover', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remover' }).click()
  await expect(page.getByText('E-mail para envio removido')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Cópia por e-mail' })).not.toBeChecked()

  // Renomear o cofre
  const renamed = `Família ${Date.now() % 1_000_000}`
  await page.locator('#vault-name').fill(renamed)
  await page.locator('#vault-name').press('Enter')
  await expect(page.getByText('Cofre renomeado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Conta e cofre' })).toContainText(renamed)
})

test('enviar por e-mail sem configurar leva a Minha conta', async ({ page }) => {
  await createVault(page)
  await page.goto('/#/export')
  await page.getByRole('button', { name: /Enviar por e-mail: Backup do cofre/ }).click()
  await expect(page.getByText('Configure o e-mail para envio em Minha conta.')).toBeVisible()
  await page.getByRole('button', { name: 'Configurar' }).click()
  await expect(page).toHaveURL(/#\/account\?section=mail/)
  await expect(page.getByText('E-mail para envio de relatórios')).toBeVisible()
})

test('excluir o cofre pede a senha e volta para a escolha', async ({ page }) => {
  const { vault } = await createVault(page)
  await page.goto('/#/account')
  await page.getByRole('button', { name: 'Excluir cofre' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(vault.name)
  await expect(dialog.getByRole('button', { name: 'Excluir' })).toBeDisabled()
  await dialog.getByLabel('Senha', { exact: true }).fill('senha errada demais')
  await dialog.getByRole('button', { name: 'Excluir' }).click()
  await expect(dialog.getByText('Senha atual incorreta.')).toBeVisible()
  await dialog.getByLabel('Senha', { exact: true }).fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Excluir' }).click()
  await expect(page.getByText('Cofre excluído. Uma cópia de segurança foi guardada.')).toBeVisible()
  const list = (await (await page.request.get('/api/vaults')).json()) as { id: string }[]
  expect(list.map((v) => v.id)).not.toContain(vault.id)
})
