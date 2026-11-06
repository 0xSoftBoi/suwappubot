import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import type { Address, Hex } from 'viem'
import { usePersistentState } from '../../../lib/persist'
import { short } from '../contracts'

/**
 * Off-chain operator metadata, kept strictly local (browser storage) and
 * labelled as such in the UI: counterparty labels/notes (address book) and
 * payment references keyed by tx hash (the contract has no memo field).
 * Export/import lets a team share one book.
 */

type Contact = { label: string; note?: string }
type Book = Record<string, Contact> // lowercase address → contact
type Refs = Record<string, string> // lowercase tx hash → reference

type Ctx = {
  name: (a?: string) => string
  contact: (a?: string) => Contact | undefined
  setContact: (a: Address, c: Contact | null) => void
  book: Book
  importBook: (json: string) => number
  exportBook: () => string
  refOf: (tx?: string) => string | undefined
  setRef: (tx: Hex, ref: string) => void
  refs: Refs
}

const LocalCtx = createContext<Ctx | null>(null)

export function LocalMetaProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = usePersistentState<Book>('commons:v2:book', {})
  const [refs, setRefs] = usePersistentState<Refs>('commons:v2:refs', {})

  const name = useCallback((a?: string) => (a ? book[a.toLowerCase()]?.label || short(a) : '—'), [book])
  const contact = useCallback((a?: string) => (a ? book[a.toLowerCase()] : undefined), [book])
  const setContact = useCallback(
    (a: Address, c: Contact | null) =>
      setBook((b) => {
        const next = { ...b }
        if (!c || !c.label.trim()) delete next[a.toLowerCase()]
        else next[a.toLowerCase()] = { label: c.label.trim().slice(0, 60), note: c.note?.slice(0, 280) }
        return next
      }),
    [setBook],
  )
  const exportBook = useCallback(() => JSON.stringify({ kind: 'suwappu-commons-addressbook', version: 1, contacts: book }, null, 2), [book])
  const importBook = useCallback(
    (json: string) => {
      const parsed = JSON.parse(json) as { contacts?: Book }
      const incoming = parsed.contacts ?? (parsed as unknown as Book)
      let n = 0
      const clean: Book = {}
      for (const [addr, c] of Object.entries(incoming)) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || typeof c?.label !== 'string') continue
        clean[addr.toLowerCase()] = { label: c.label.slice(0, 60), note: typeof c.note === 'string' ? c.note.slice(0, 280) : undefined }
        n++
      }
      setBook((b) => ({ ...b, ...clean }))
      return n
    },
    [setBook],
  )
  const refOf = useCallback((tx?: string) => (tx ? refs[tx.toLowerCase()] : undefined), [refs])
  const setRef = useCallback((tx: Hex, ref: string) => {
    if (!ref.trim()) return
    setRefs((r) => ({ ...r, [tx.toLowerCase()]: ref.trim().slice(0, 120) }))
  }, [setRefs])

  const value = useMemo(
    () => ({ name, contact, setContact, book, importBook, exportBook, refOf, setRef, refs }),
    [name, contact, setContact, book, importBook, exportBook, refOf, setRef, refs],
  )
  return <LocalCtx.Provider value={value}>{children}</LocalCtx.Provider>
}

export function useLocalMeta(): Ctx {
  const c = useContext(LocalCtx)
  if (!c) throw new Error('useLocalMeta outside LocalMetaProvider')
  return c
}

/** Inline editor for a counterparty's label + note. */
export function ContactEditor({ address }: { address: Address }) {
  const { contact, setContact } = useLocalMeta()
  const c = contact(address)
  return (
    <div className="grid gap-1.5 rounded border border-terminal-border/60 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-terminal-text-muted">Address book · local</span>
        <span className="font-mono text-[10px] text-terminal-text-muted">{address}</span>
      </div>
      <input
        defaultValue={c?.label ?? ''}
        key={`l-${address}-${c?.label ?? ''}`}
        placeholder="Label, e.g. Acme Supplies"
        onBlur={(e) => setContact(address, { label: e.target.value, note: c?.note })}
        className="terminal-theme-control h-7 rounded px-2 text-terminal-text"
      />
      <input
        defaultValue={c?.note ?? ''}
        key={`n-${address}-${c?.note ?? ''}`}
        placeholder="Note (terms agreed off-chain, contact person…)"
        onBlur={(e) => c?.label && setContact(address, { label: c.label, note: e.target.value })}
        className="terminal-theme-control h-7 rounded px-2 text-terminal-text-secondary"
      />
    </div>
  )
}

/** Address-book export / import for team sharing. */
export function AddressBookTools() {
  const { book, exportBook, importBook } = useLocalMeta()
  const count = Object.keys(book).length
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-terminal-text-muted">
      <span>{count} labelled counterpart{count === 1 ? 'y' : 'ies'} (local)</span>
      <button
        type="button"
        className="text-terminal-accent hover:underline disabled:opacity-40"
        disabled={!count}
        onClick={() => {
          const blob = new Blob([exportBook()], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `commons-addressbook-${new Date().toISOString().slice(0, 10)}.json`
          a.click()
          URL.revokeObjectURL(url)
        }}
      >
        Export
      </button>
      <label className="cursor-pointer text-terminal-accent hover:underline">
        Import
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const n = importBook(await f.text())
              toast.success(`Imported ${n} contact${n === 1 ? '' : 's'}`)
            } catch {
              toast.error('Not a valid address-book file')
            }
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}
