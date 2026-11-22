// Boas-vindas de um cofre começado do zero: banco principal e quanto tem nele hoje.

import { useRef, useState } from 'react'
import { LuSparkles } from 'react-icons/lu'
import { primaryBank } from '../../data/model'
import { actions, updateSettings, useData } from '../../data/store'
import { useI18n } from '../../i18n'
import { MoneyField, Select } from '../../ui/inputs'
import { Button, Group, Row } from '../../ui/primitives'
import { Sheet } from '../../ui/Sheet'
import { toast } from '../../ui/toast'
import { bankOptions } from '../entry/options'

export function Onboarding() {
  const data = useData()
  const i18n = useI18n()
  const { t } = i18n
  const [open, setOpen] = useState(true)
  // Sem palpite: o banco vem escolhido só se o cofre já tiver um principal.
  const [bankId, setBankId] = useState<string | undefined>(() => primaryBank(data)?.id)
  const [balance, setBalance] = useState(0)
  /** Clique duplo ou Esc durante a animação não repetem a gravação. */
  const done = useRef(false)

  const finish = () => {
    if (done.current) return
    done.current = true
    updateSettings({ onboardingDone: true })
    setOpen(false)
  }
  const start = () => {
    const bank = data.banks.find((b) => b.id === bankId)
    if (!bank || done.current) return
    actions.saveBank({ ...bank, isPrimary: true, initialBalance: balance })
    finish()
  }
  const sample = () => {
    if (done.current) return
    actions.loadSample()
    finish()
    toast(t('settings.sampleLoaded'))
  }

  return (
    <Sheet
      open={open}
      onClose={finish}
      size="sm"
      closeLabel={t('common.close')}
      title={
        <span className="flex items-center gap-2">
          <LuSparkles className="size-4 text-gold" aria-hidden />
          {t('home.onboarding.title')}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={sample}>
            {t('home.onboarding.sample')}
          </Button>
          <span className="flex-1" />
          <Button onClick={finish}>{t('home.onboarding.skip')}</Button>
          <Button variant="primary" onClick={start} disabled={!bankId}>
            {t('home.onboarding.start')}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-[15px] text-label-2">{t('home.onboarding.body')}</p>
      <div className="space-y-5">
        <Group footer={t('home.onboarding.bankHint')}>
          <Row label={t('home.onboarding.bankLabel')} htmlFor="onb-bank" stacked>
            <div className="flex w-full">
              <Select id="onb-bank" label={t('home.onboarding.bankLabel')} value={bankId} options={bankOptions(data)} placeholder={t('form.morePlaceholder')} onChange={setBankId} className="-ml-2" />
            </div>
          </Row>
        </Group>
        <Group footer={t('home.onboarding.balanceHint')}>
          <Row label={t('home.onboarding.balanceLabel')} htmlFor="onb-balance">
            <MoneyField id="onb-balance" value={balance} allowNegative onChange={setBalance} format={(v) => i18n.money(v)} />
          </Row>
        </Group>
      </div>
    </Sheet>
  )
}
