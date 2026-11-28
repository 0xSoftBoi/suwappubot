import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank, formatMinor } from '../../lib/bankApi'
import { useBankAccounts } from '../../hooks/bank/useBankCore'
import { useFeatures, useSegments } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, ErrorBox, Field, QueryState, Row, Select } from '../../components/bank/BankUI'
import { AccountSelect } from '../../components/bank/AccountSelect'
import { a11yToast } from '@/lib/a11yToast'

export function BankSettings() {
  const accounts = useBankAccounts()
  const segments = useSegments()
  const qc = useQueryClient()
  const [id, setId] = useState('')
  const features = useFeatures(id || undefined)
  const [seg, setSeg] = useState('')
  const dec = accounts.data?.find((a) => a.id === id)?.decimals ?? 6
  const save = useMutation({ mutationFn: () => bank.setSegment(id, seg || null), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bank', 'features', id] }); a11yToast.success('Profile updated') } })
  return (
    <BankPage title="Bank settings">
      <Card className="space-y-3">
        <Field label="Account"><AccountSelect accounts={accounts.data ?? []} value={id} onChange={(v) => { setId(v); setSeg('') }} /></Field>
        {accounts.isError && <ErrorBox error={accounts.error} onRetry={() => void accounts.refetch()} />}
        <Field label="Profile">
          <Select value={seg} onChange={(e) => setSeg(e.target.value)} disabled={!id}>
            <option value="">{features.data?.segment ? `Current: ${features.data.segment}` : 'Default (no profile)'}</option>
            {(segments.data ?? []).map((s) => <option key={s.segment} value={s.segment}>{s.title}</option>)}
          </Select>
        </Field>
        {segments.isError && <ErrorBox error={segments.error} />}
        {save.isError && <ErrorBox error={save.error} />}
        <Btn className="w-full" disabled={!id || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : seg ? 'Apply profile' : 'Clear profile'}</Btn>
      </Card>
      {id && (
        <QueryState query={features} rows={2}>
          {(f) => (
            <>
              <Card>
                <p className="text-sm font-semibold mb-1">Features</p>
                {Object.entries(f.features).map(([k, on]) => <Row key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()} value={<Chip status={on ? 'on' : 'off'} tone={on ? 'good' : 'neutral'} />} />)}
              </Card>
              {f.limits && <Card><p className="text-sm font-semibold mb-1">Limits</p><Row label="Per transaction" value={formatMinor(f.limits.perTxMinor, dec)} /><Row label="Per day" value={formatMinor(f.limits.dailyMinor, dec)} /></Card>}
              {f.profile?.onboardingChecklist?.length ? <Card><p className="text-sm font-semibold mb-1">Getting started</p><ul className="text-sm space-y-1 list-disc pl-5">{f.profile.onboardingChecklist.map((c) => <li key={c}>{c.replace(/_/g, ' ')}</li>)}</ul></Card> : null}
            </>
          )}
        </QueryState>
      )}
    </BankPage>
  )
}
