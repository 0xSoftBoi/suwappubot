import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bank } from '../../lib/bankApi'
import { useDirectory, useMandates, useMyResources } from '../../hooks/bank/useBankDomains'
import { BankPage, Btn, Card, Chip, Empty, ErrorBox, QueryState, Row, Tabs } from '../../components/bank/BankUI'

export function Agents() {
  const [tab, setTab] = useState<'mandates' | 'resources' | 'directory'>('mandates')
  const qc = useQueryClient()
  const mandates = useMandates()
  const resources = useMyResources()
  const directory = useDirectory()
  const revoke = useMutation({ mutationFn: (id: string) => bank.revokeMandate(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'mandates'] }) })
  const toggle = useMutation({ mutationFn: ({ id, a }: { id: string; a: 'enable' | 'disable' }) => bank.setResource(id, a), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bank', 'resources'] }) })
  return (
    <BankPage title="Agents">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mandates', label: 'Mandates' }, { id: 'resources', label: 'My resources' }, { id: 'directory', label: 'Directory' }]} />
      {tab === 'mandates' && (
        <>
          {revoke.isError && <ErrorBox error={revoke.error} />}
          <QueryState query={mandates} isEmpty={(d) => d.length === 0} empty={<Empty title="No mandates" hint="A mandate lets an agent spend within limits you set." />}>
            {(l) => <div className="space-y-2">{l.map((m) => (
              <Card key={m.id}>
                <div className="flex justify-between"><p className="text-sm font-semibold">Mandate</p><Chip status={m.status} /></div>
                <Row label="Assets" value={(m.allowedAssets ?? []).join(', ') || 'Any'} />
                <Row label="Hosts" value={(m.allowedHosts ?? []).join(', ') || 'Any'} />
                {m.expiresAt && <Row label="Expires" value={new Date(m.expiresAt).toLocaleString()} />}
                {m.status === 'active' && <Btn variant="danger" className="w-full mt-2" disabled={revoke.isPending} onClick={() => { if (window.confirm('Revoke this mandate? The agent can no longer spend.')) revoke.mutate(m.id) }}>Revoke</Btn>}
              </Card>
            ))}</div>}
          </QueryState>
        </>
      )}
      {tab === 'resources' && (
        <>
          {toggle.isError && <ErrorBox error={toggle.error} />}
          <QueryState query={resources} isEmpty={(d) => d.length === 0} empty={<Empty title="No priced resources" />}>
            {(l) => <div className="space-y-2">{l.map((r) => (
              <Card key={r.id}>
                <div className="flex justify-between gap-2"><p className="text-sm font-semibold truncate">{r.title}</p><Chip status={r.status} /></div>
                <Row label="Asset" value={`${r.asset} · ${r.chain}`} /><Row label="Slug" value={r.slug} mono />
                <Btn variant="ghost" className="w-full mt-2" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, a: r.status === 'active' ? 'disable' : 'enable' })}>{r.status === 'active' ? 'Disable' : 'Enable'}</Btn>
              </Card>
            ))}</div>}
          </QueryState>
        </>
      )}
      {tab === 'directory' && (
        <QueryState query={directory} isEmpty={(d) => d.length === 0} empty={<Empty title="Nothing listed yet" />}>
          {(l) => <Card className="divide-y divide-suwappu-sakura-mid/20 !py-1">{l.map((r) => <div key={r.id} className="py-2.5"><p className="text-sm font-medium">{r.title}</p>{r.description && <p className="text-[11px] text-suwappu-text-secondary break-words">{r.description}</p>}<p className="text-[11px] text-suwappu-text-secondary">{r.asset} · {r.chain}</p></div>)}</Card>}
        </QueryState>
      )}
    </BankPage>
  )
}
