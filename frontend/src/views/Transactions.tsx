import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { CoachNote } from '../components'
import { api } from '../api'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function daysAgo(days: number) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const RANGES = [{ label: '30 days', days: 30 }, { label: '60 days', days: 60 }, { label: '90 days', days: 90 }]

// Color per category — a small warm dot, not a badge
const categoryDot: Record<string, string> = {
  'Food and Drink': 'bg-orange-400',
  'Dining':         'bg-orange-400',
  'Travel':         'bg-sky-400',
  'Shopping':       'bg-violet-400',
  'Entertainment':  'bg-pink-400',
  'Healthcare':     'bg-emerald-400',
  'Bills':          'bg-amber-400',
  'Income':         'bg-emerald-400',
}

function categoryColor(cat: string) {
  for (const [key, cls] of Object.entries(categoryDot)) {
    if (cat.toLowerCase().includes(key.toLowerCase())) return cls
  }
  return 'bg-zinc-600'
}

function TransactionRow({ tx, tk, onNoteSaved }: {
  tx: import('../api').Transaction
  tk: import('../theme').ThemeTokens
  onNoteSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tx.notes)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function save() {
    if (draft === tx.notes) { setEditing(false); return }
    setSaving(true)
    await api.setTransactionNote(tx.id, draft)
    setSaving(false)
    setEditing(false)
    onNoteSaved()
  }

  return (
    <div className={`py-4 border-b border-white/5 ${tk.rowHover} transition-colors group`}>
      <div className="flex items-center gap-4">
        <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${categoryColor(tx.category)}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-zinc-200 truncate">{tx.description || '—'}</div>
          <div className="text-xs text-zinc-600 mt-0.5 flex items-center gap-2">
            <span>{tx.date.slice(0, 10)}</span>
            {tx.category && <><span>·</span><span>{tx.category}</span></>}
            {tx.is_recurring && <span className="text-violet-400/70">recurring</span>}
            {tx.is_internal && <span className="text-zinc-700">transfer</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => { setEditing(true); setDraft(tx.notes); setTimeout(() => inputRef.current?.focus(), 0) }}
            className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
          >
            {tx.notes ? 'edit note' : 'add note'}
          </button>
          <div className={`text-sm font-semibold tabular-nums ${tx.direction === 'credit' ? tk.accent2 : 'text-zinc-300'}`}>
            {tx.direction === 'credit' ? '+' : '−'}{fmt(tx.amount)}
          </div>
        </div>
      </div>
      {tx.notes && !editing && (
        <div className="ml-6 mt-1 text-xs text-violet-300/60 italic">{tx.notes}</div>
      )}
      {editing && (
        <div className="ml-6 mt-2 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            onBlur={save}
            placeholder="Add a note for AI context…"
            className="flex-1 bg-transparent border-b border-violet-500/30 text-xs text-zinc-300 pb-1 focus:outline-none focus:border-violet-500/60 placeholder-zinc-700"
          />
          {saving && <span className="text-xs text-zinc-600">saving…</span>}
        </div>
      )}
    </div>
  )
}

export default function Transactions() {
  const { tokens: tk } = useTheme()
  const [rangeDays, setRangeDays] = useState(30)
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<'all' | 'debit' | 'credit'>('all')

  const start = daysAgo(rangeDays)
  const { data: txns = [], isPending, refetch } = useQuery({
    queryKey: ['transactions', start],
    queryFn: () => api.transactions(start),
  })

  const [showInternal, setShowInternal] = useState(false)

  const filtered = txns.filter(tx => {
    if (!showInternal && tx.is_internal) return false
    if (dirFilter !== 'all' && tx.direction !== dirFilter) return false
    if (search && !tx.description.toLowerCase().includes(search.toLowerCase()) &&
        !tx.category.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const externalFiltered = filtered.filter(t => !t.is_internal)
  const totalSpend  = externalFiltered.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0)
  const totalIncome = externalFiltered.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0)
  const net         = totalIncome - totalSpend

  return (
    <div className="max-w-2xl mx-auto px-8 py-16">

      {/* Search — big, centered, prominent */}
      <input
        type="text"
        placeholder="Search transactions…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-transparent border-b border-white/10 text-zinc-200 text-lg placeholder-zinc-700 pb-3 mb-10 focus:outline-none focus:border-amber-500/30 transition-colors"
      />

      {/* Period selector */}
      <div className="flex gap-6 mb-8">
        {RANGES.map(r => (
          <button key={r.days} onClick={() => setRangeDays(r.days)}
            className={`text-sm transition-colors ${
              rangeDays === r.days ? `${tk.accent} font-semibold` : 'text-zinc-600 hover:text-zinc-300'
            }`}>
            {r.label}
          </button>
        ))}
        <div className="ml-auto flex gap-5 items-center">
          {(['all', 'debit', 'credit'] as const).map(d => (
            <button key={d} onClick={() => setDirFilter(d)}
              className={`text-sm capitalize transition-colors ${
                dirFilter === d ? `${tk.accent} font-semibold` : 'text-zinc-600 hover:text-zinc-300'
              }`}>
              {d === 'all' ? 'All' : d === 'debit' ? 'Spending' : 'Income'}
            </button>
          ))}
          <button onClick={() => setShowInternal(v => !v)}
            className={`text-sm transition-colors ${
              showInternal ? 'text-zinc-400' : 'text-zinc-700 hover:text-zinc-500'
            }`}>
            transfers
          </button>
        </div>
      </div>

      {/* Summary sentence */}
      <div className="text-base text-zinc-400 leading-relaxed mb-2">
        You spent{' '}
        <span className="text-zinc-200 font-medium">{fmt(totalSpend)}</span>
        {' '}and earned{' '}
        <span className={`font-medium ${tk.accent2}`}>{fmt(totalIncome)}</span>
        {' '}— a{' '}
        {net >= 0
          ? <span className={`font-semibold ${tk.accent2}`}>{fmt(net)} surplus</span>
          : <span className="font-semibold text-orange-400">{fmt(Math.abs(net))} deficit</span>
        }
        {' '}over {rangeDays} days.
      </div>

      <CoachNote>
        {net >= 0
          ? `You came out ahead this period. That gap between earning and spending is where financial momentum lives — the wider it gets, the faster everything else moves.`
          : `Spending outpaced income this period. That's worth understanding, not judging. Look for the story in the transactions below — one or two categories usually tell it.`
        }
      </CoachNote>

      {/* Transaction list */}
      <div>
        {isPending && <div className="py-10 text-sm text-zinc-600 text-center">Loading…</div>}
        {!isPending && filtered.map((tx) => (
          <TransactionRow key={tx.id} tx={tx} tk={tk} onNoteSaved={() => refetch()} />
        ))}
        {!isPending && filtered.length === 0 && (
          <div className="py-10 text-sm text-zinc-600 text-center">Nothing here.</div>
        )}
      </div>

    </div>
  )
}
