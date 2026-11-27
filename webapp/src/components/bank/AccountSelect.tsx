import { formatMinor, type BankAccount } from '../../lib/bankApi'
import { Select } from './BankUI'

export const accountLabel = (a: BankAccount) => `${a.label || a.kind} · ${a.asset} on ${a.chain}`

export function AccountSelect({ accounts, value, onChange, exclude }: { accounts: BankAccount[]; value: string; onChange: (id: string) => void; exclude?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select account</option>
      {accounts.filter((a) => a.id !== exclude).map((a) => (
        <option key={a.id} value={a.id}>
          {accountLabel(a)} ({formatMinor(a.balanceMinor, a.decimals)})
        </option>
      ))}
    </Select>
  )
}
