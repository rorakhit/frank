import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { Arc, CoachNote, Improving } from '../components'
import { api, type PaydownStrategy } from '../api'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function payoffDate(loan: { origination_date: string; term_months: number }) {
  const d = new Date(loan.origination_date)
  d.setMonth(d.getMonth() + loan.term_months)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function PaydownCoach({ strategy }: { strategy: PaydownStrategy }) {
  const { tokens: tk } = useTheme()
  const fmtRate = (r: number) => r === 0 ? '0%' : `${(r * 100).toFixed(2)}%`
  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split('-')
    return new Date(+y, +m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="mt-12 space-y-8">
      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Paydown strategy</div>

      <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">{strategy.narrative ?? ''}</p>

      {!!strategy.free_cash_flow && (
        <div className="text-sm text-zinc-500">
          Estimated free cash flow: <span className={`font-medium ${strategy.free_cash_flow > 0 ? tk.accent2 : 'text-orange-400'}`}>{fmt(strategy.free_cash_flow)}/mo</span>
        </div>
      )}

      {(strategy.priority ?? []).length > 0 && (
        <div className="space-y-4">
          <div className="text-xs text-zinc-700 uppercase tracking-widest">Priority order</div>
          {(strategy.priority ?? []).map((item, i) => (
            <div key={item.name} className="flex items-start gap-4 py-4 border-b border-white/5">
              <div className="text-2xl font-bold text-zinc-700 w-6 shrink-0">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-sm font-medium text-zinc-200">{item.name}</span>
                  <span className="text-xs text-zinc-500">{fmt(item.balance)} · {fmtRate(item.rate)} APR</span>
                </div>
                <div className="text-xs text-zinc-600 mt-1">{item.reasoning}</div>
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  <span className="text-xs text-zinc-600">Min: {fmt(item.min_payment)}/mo</span>
                  <span className={`text-xs font-medium ${tk.accent}`}>Recommended: {fmt(item.recommended_payment)}/mo</span>
                  {item.months_to_payoff > 0 && (
                    <span className="text-xs text-zinc-600">{item.months_to_payoff} months to payoff</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(strategy.milestones ?? []).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-700 uppercase tracking-widest mb-3">Milestones</div>
          {(strategy.milestones ?? []).map((m, i) => (
            <div key={i} className="flex items-baseline gap-3 text-sm">
              <span className="text-zinc-600 shrink-0">{fmtMonth(m.target_month)}</span>
              <span className="text-zinc-400">{m.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Debt() {
  const { tokens: tk } = useTheme()
  const [strategy, setStrategy] = useState<PaydownStrategy | null>(null)
  const [strategyDate, setStrategyDate] = useState<string | null>(null)
  const [coaching, setCoaching] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)

  useEffect(() => {
    api.getDebtCoach().then(rec => {
      if (rec?.strategy) {
        setStrategy(rec.strategy)
        setStrategyDate(rec.generated_at)
      }
    }).catch(() => {})
  }, [])

  const { data: loans = [] }   = useQuery({ queryKey: ['loans'],           queryFn: api.loans })
  const { data: credits = [] } = useQuery({ queryKey: ['credit-accounts'], queryFn: api.creditAccounts })

  const totalLoanDebt    = loans.reduce((s, l) => s + l.estimated_balance, 0)
  const totalCreditDebt  = credits.reduce((s, c) => s + c.current_balance, 0)
  const totalCreditLimit = credits.reduce((s, c) => s + c.credit_limit, 0)
  const overallUtil      = totalCreditLimit > 0 ? totalCreditDebt / totalCreditLimit : 0
  const totalDebt        = totalLoanDebt + totalCreditDebt

  return (
    <div className="max-w-2xl mx-auto px-8 py-16">

      <div className="mb-2">
        <div className="text-sm text-zinc-500 mb-3 tracking-wide">Total debt</div>
        <div
          className="font-bold tracking-tight text-orange-400 leading-none"
          style={{ fontSize: '72px', textShadow: '0 0 60px rgba(251,146,60,0.2)' }}
        >
          {fmt(totalDebt)}
        </div>
      </div>

      <div className="text-base text-zinc-400 leading-relaxed mb-2">
        <span className="text-zinc-200 font-medium">{fmt(totalLoanDebt)}</span> in loans,{' '}
        <span className="text-zinc-200 font-medium">{fmt(totalCreditDebt)}</span> on credit —{' '}
        {overallUtil < 0.3
          ? <span className={`font-medium ${tk.accent2}`}>{(overallUtil * 100).toFixed(0)}% utilization. You're in good shape.</span>
          : overallUtil < 0.7
            ? <span className="font-medium text-amber-400">{(overallUtil * 100).toFixed(0)}% utilization. Room to improve.</span>
            : <span className="font-medium text-orange-400">{(overallUtil * 100).toFixed(0)}% utilization. Worth prioritizing.</span>
        }
      </div>

      <CoachNote>
        {totalDebt === 0
          ? `No debt on the books. That's a strong position — now the question is what to do with the cash flow.`
          : overallUtil < 0.3
            ? `Your credit utilization is healthy. The loans are the story — every extra dollar toward the highest-rate one compounds in your favor faster than you'd expect.`
            : `Credit utilization above 30% affects your score and costs you options. Getting that number down is one of the highest-leverage moves available to you right now.`
        }
      </CoachNote>

      {totalDebt > 0 && (
        <div className="mb-10">
          <button
            onClick={async () => {
              setCoaching(true)
              setCoachError(null)
              try {
                const s = await api.generateDebtCoach()
                setStrategy(s)
                setStrategyDate(new Date().toISOString())
              } catch {
                setCoachError('Failed to generate strategy. Try again.')
              } finally {
                setCoaching(false)
              }
            }}
            disabled={coaching}
            className={`text-sm px-4 py-2 rounded-lg border border-white/10 transition-colors ${
              coaching ? 'text-zinc-600 cursor-not-allowed' : `${tk.accent3} border-violet-500/20 hover:border-violet-500/40`
            }`}
          >
            {coaching ? 'Thinking…' : strategy ? 'Regenerate strategy' : 'Generate paydown strategy'}
          </button>
          {strategyDate && !coaching && (
            <span className="text-xs text-zinc-600">
              last generated {new Date(strategyDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
          {coachError && <div className="text-xs text-orange-400 mt-2">{coachError}</div>}
          {strategy && <PaydownCoach strategy={strategy} />}
        </div>
      )}

      {/* Credit cards — arc grid */}
      {credits.length > 0 && (
        <div className="mb-14">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-8">Credit cards</div>
          <div className="flex flex-wrap gap-10">
            {credits.map(c => {
              const util = c.credit_limit > 0 ? c.current_balance / c.credit_limit : 0
              return (
                <div key={c.id} className="flex flex-col items-center gap-3">
                  <Arc
                    value={c.current_balance}
                    max={c.credit_limit}
                    size={130}
                    label={`${(util * 100).toFixed(0)}%`}
                    sublabel="used"
                  />
                  <div className="text-center">
                    <div className="text-sm font-medium text-zinc-200">{c.name}</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {fmt(c.current_balance)} of {fmt(c.credit_limit)}
                    </div>
                    {c.minimum_payment > 0 && (
                      <div className="text-xs text-zinc-600 mt-0.5">Min {fmt(c.minimum_payment)}/mo</div>
                    )}
                    {util < 0.3 && <div className="mt-1"><Improving label="healthy" /></div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Loans — vertical list with progress arcs */}
      {loans.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-6">Installment loans</div>
          <div className="space-y-8">
            {loans.map(loan => {
              const paidPct = Math.max(0, Math.min(1, 1 - loan.estimated_balance / loan.original_amount))
              return (
                <div key={loan.id} className="flex items-center gap-8">
                  <Arc
                    value={loan.original_amount - loan.estimated_balance}
                    max={loan.original_amount}
                    size={100}
                    label={`${(paidPct * 100).toFixed(0)}%`}
                    sublabel="paid"
                  />
                  <div className="flex-1">
                    <div className="text-base font-semibold text-zinc-200 mb-1">{loan.name}</div>
                    <div className="text-sm text-zinc-500">
                      {loan.lender}
                      {loan.interest_rate > 0
                        ? ` · ${(loan.interest_rate * 100).toFixed(2)}% APR`
                        : ' · 0% interest'}
                    </div>
                    <div className="text-sm text-zinc-500 mt-0.5">
                      {fmt(loan.estimated_balance)} remaining · payoff {payoffDate(loan)}
                    </div>
                    <div className="text-sm text-zinc-600 mt-0.5">{fmt(loan.minimum_payment)}/mo minimum</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loans.length === 0 && credits.length === 0 && (
        <div className="text-sm text-zinc-600 text-center py-12">No debt accounts.</div>
      )}

    </div>
  )
}
