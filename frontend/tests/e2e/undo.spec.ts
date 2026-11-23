import { expect, loadSample, mockApi, skipOnboarding, test } from './fixtures'

test('um aviso antigo não desfaz uma alteração mais recente', async ({ page }) => {
  await mockApi(page)
  await skipOnboarding(page)
  // Mantém os avisos de ação na tela durante o teste, mesmo em máquinas mais lentas.
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, timeout === 7000 ? 30000 : timeout, ...args)) as typeof window.setTimeout
  })
  await loadSample(page)
  const sampleToast = page.getByText('Dados de exemplo carregados', { exact: true }).locator('..')
  await expect(sampleToast.getByRole('button', { name: 'Desfazer' })).toBeVisible()
  const stats = page.locator('main').getByText(/^\d+ bancos? · /)
  const beforeReset = await stats.textContent()
  expect(beforeReset).toBeTruthy()

  await page.getByRole('button', { name: 'Apagar tudo' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar tudo' }).click()
  const resetToast = page.getByText('Dados apagados', { exact: true }).locator('..')
  await expect(resetToast.getByRole('button', { name: 'Desfazer' })).toBeVisible()
  await expect(sampleToast).toBeVisible()
  await expect(sampleToast.getByRole('button', { name: 'Desfazer' })).toHaveCount(0)

  await resetToast.getByRole('button', { name: 'Desfazer' }).click()
  await expect(stats).toHaveText(beforeReset!)
})
