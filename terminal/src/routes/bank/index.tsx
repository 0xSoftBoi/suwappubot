import { lazy, Suspense } from 'react'
import { useLayoutEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { BankHome } from './BankHome'
import { AccountDetail } from './AccountDetail'
import { Send, Claim } from './Send'
import { Convert } from './Convert'

const lz = <K extends string>(f: () => Promise<Record<K, React.ComponentType>>, k: K) => lazy(() => f().then((m) => ({ default: m[k] })))
const Earn = lz(() => import('./Earn'), 'Earn')
const Credit = lz(() => import('./Credit'), 'Credit')
const Ramps = lz(() => import('./Ramps'), 'Ramps')
const Cards = lz(() => import('./Cards'), 'Cards')
const Payments = lz(() => import('./Payments'), 'Payments')
const Payroll = lz(() => import('./Payroll'), 'Payroll')
const Business = lz(() => import('./Business'), 'Business')
const Agents = lz(() => import('./Agents'), 'Agents')
const Privacy = lz(() => import('./Privacy'), 'Privacy')
const Developers = lz(() => import('./Developers'), 'Developers')
const BankSettings = lz(() => import('./BankSettings'), 'BankSettings')

/**
 * The claim token is a bearer secret. Once the page has read it (router state keeps it for this view), swap
 * the address bar to /bank/claim so it is not left in history, screenshots, shared URLs, or later Referers.
 */
function ClaimGate() {
  useLayoutEffect(() => { window.history.replaceState(window.history.state, '', '/bank/claim') }, [])
  return <Claim />
}

export function BankRoutes() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm text-terminal-text-secondary animate-pulse">Loading…</div>}>
      <Routes>
        <Route index element={<BankHome />} />
        <Route path="accounts/:id" element={<AccountDetail />} />
        <Route path="send" element={<Send />} />
        <Route path="claim/:token" element={<ClaimGate />} />
        <Route path="convert" element={<Convert />} />
        <Route path="earn" element={<Earn />} />
        <Route path="credit" element={<Credit />} />
        <Route path="add" element={<Ramps />} />
        <Route path="cashout" element={<Ramps />} />
        <Route path="cards" element={<Cards />} />
        <Route path="payments" element={<Payments />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="business" element={<Business />} />
        <Route path="agents" element={<Agents />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="developers" element={<Developers />} />
        <Route path="settings" element={<BankSettings />} />
        <Route path="*" element={<Navigate to="/bank" replace />} />
      </Routes>
    </Suspense>
  )
}
