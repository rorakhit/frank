import { useQuery } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { CoachNote, Improving } from '../components'
import { api, type Account, type Institution } from '../api'

function fmt(n: number | null) {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor(diff / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ago`
  if (h >= 1) return `${h}h ago`
  return `${m}m ago`
}

const typeLabel: Record<string, string> = {
  CHECKING: 'Checking', SAVINGS: 'Savings', SAVING: 'Savings',
  CARD: 'Credit Card', CREDIT_CARD_LOAN: 'Credit Card', INSTALLMENT_LOAN: 'Loan',
}

function AccountRow({ account }: { account: Account }) {
  const { tokens: tk } = useTheme()
  const isAsset = !['CARD', 'CREDIT_CARD_LOAN', 'INSTALLMENT_LOAN'].includes(account.type)
  return (
    <div className={`flex items-center justify-between py-4 border-b border-white/5 ${tk.rowHover} transition-colors`}>
      <div>
        <div className="text-base text-zinc-200 font-medium">{account.name}</div>
        <div className="text-sm text-zinc-500 mt-0.5">
          {account.display_name} ···{account.mask} · {typeLabel[account.type] ?? account.type}
        </div>
      </div>
      <div className={`text-xl font-bold tabular-nums ${
        account.latest_balance !== null
          ? isAsset ? tk.accent : tk.caution
          : 'text-zinc-700'
      }`}>
        {fmt(account.latest_balance)}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { tokens: tk } = useTheme()
  const { data: accounts = [] }     = useQuery({ queryKey: ['accounts'],           queryFn: api.accounts })
  const { data: institutions = [] } = useQuery({ queryKey: ['institutions'],        queryFn: api.institutions })
  const { data: txns = [] }         = useQuery({ queryKey: ['transactions-recent'], queryFn: () => api.transactions() })

  const totalAssets = accounts
    .filter(a => !['CARD', 'CREDIT_CARD_LOAN', 'INSTALLMENT_LOAN'].includes(a.type))
    .reduce((sum, a) => sum + (a.latest_balance ?? 0), 0)

  const externalTxns = txns.filter(t => !t.is_internal)
  const totalSpend  = externalTxns.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0)
  const totalIncome = externalTxns.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0)
  const net = totalIncome - totalSpend

  return (
    <div className="relative min-h-screen">
      <div className="max-w-2xl mx-auto px-8 py-16 relative z-10">

        {/* Hero */}
        <div className="mb-2">
          <div className="text-sm text-zinc-500 mb-3 tracking-wide">Total cash &amp; savings</div>
          <div
            className="font-bold tracking-tight text-amber-400 leading-none mb-1"
            style={{ fontSize: '72px', textShadow: '0 0 60px rgba(245,166,35,0.25)' }}
          >
            {fmt(totalAssets)}
          </div>
        </div>

        {/* Spend/income sentence */}
        <div className="text-base text-zinc-400 leading-relaxed mb-2">
          You spent{' '}
          <span className="text-zinc-200 font-medium">{fmt(totalSpend)}</span>
          {' '}and brought in{' '}
          <span className={`font-medium ${tk.accent2}`}>{fmt(totalIncome)}</span>
          {' '}this period —{' '}
          {net >= 0
            ? <><span className={`font-semibold ${tk.accent2}`}>{fmt(net)} surplus</span>.</>
            : <><span className="font-semibold text-orange-400">{fmt(Math.abs(net))} over</span>.</>
          }
        </div>

        {net >= 0 && (
          <div className="mb-6">
            <Improving label={`${fmt(net)} ahead this period`} />
          </div>
        )}

        <CoachNote>
          {institutions.length > 0
            ? `Your accounts are syncing from ${institutions.map(i => i.display_name).join(', ')}. Frank is watching your patterns — the more history it has, the sharper its guidance gets.`
            : `Connect your first account to get started. Frank works best with a full picture of where your money actually goes.`
          }
        </CoachNote>

        {/* Accounts */}
        <div className="mb-12">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-1">Accounts</div>
          {accounts.map(a => <AccountRow key={a.id} account={a} />)}
        </div>

        {/* Sync status */}
        <div className="mb-12">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-4">Last sync</div>
          <div className="space-y-3">
            {institutions.map(inst => (
              <div key={inst.id} className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">{inst.display_name}</span>
                <div className="flex items-center gap-3">
                  {inst.last_scraped_at && (
                    <span className="text-xs text-zinc-600">{timeAgo(inst.last_scraped_at)}</span>
                  )}
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    inst.last_scrape_ok === true  ? 'bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]' :
                    inst.last_scrape_ok === false ? 'bg-red-400' : 'bg-zinc-700'
                  }`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent transactions */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Recent</div>
            <span className="text-xs text-zinc-600">{txns.length} transactions</span>
          </div>
          <div>
            {txns.slice(0, 10).map((tx, i) => (
              <div key={i} className={`flex items-center justify-between py-3.5 border-b border-white/5 ${tk.rowHover} transition-colors`}>
                <div>
                  <div className="text-sm text-zinc-300">{tx.description || '—'}</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{tx.date}
                    {tx.category && <> · {tx.category}</>}
                  </div>
                </div>
                <div className={`text-sm font-semibold tabular-nums ${tx.direction === 'credit' ? tk.accent2 : 'text-zinc-400'}`}>
                  {tx.direction === 'credit' ? '+' : '−'}{fmt(tx.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
