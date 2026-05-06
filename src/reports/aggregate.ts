import { db } from '../db/client.js'
import type { PeriodAggregates, CreditSummary, CreditCardSummary, LoanSummary, LoanAccountSummary, RecurringCharge, SavingsEvent } from '../types.js'

export function calculateSavingsRate(income: number, spend: number): number {
  if (income === 0) return 0
  const rate = ((income - spend) / income) * 100
  return Math.max(0, Math.round(rate * 100) / 100)
}

export function calculateMonthlyInterest(balance: number, apr: number): number {
  return (balance * apr) / 100 / 12
}

export function estimatePayoffMonths(balance: number, apr: number): number {
  if (balance === 0) return 0
  const monthlyRate = apr / 100 / 12
  const minPayment = Math.max(25, balance * 0.02)
  if (monthlyRate === 0) return Math.ceil(balance / minPayment)
  return Math.ceil(
    -Math.log(1 - (monthlyRate * balance) / minPayment) / Math.log(1 + monthlyRate)
  )
}

export function getCreditUtilizationLevel(utilization: number): 'ok' | 'warning' | 'danger' {
  if (utilization >= 50) return 'danger'
  if (utilization >= 30) return 'warning'
  return 'ok'
}

async function getCreditSummary(): Promise<CreditSummary> {
  const { data: creditAccts } = await db
    .from('credit_accounts')
    .select('account_id, apr, credit_limit, is_variable_rate, accounts(name, mask)')

  const cards: CreditCardSummary[] = []

  for (const ca of creditAccts ?? []) {
    const { data: snapshots } = await db
      .from('balance_snapshots')
      .select('balance, snapshot_at')
      .eq('account_id', ca.account_id)
      .order('snapshot_at', { ascending: false })
      .limit(1)

    const balance = Number(snapshots?.[0]?.balance ?? 0)
    const limit = Number(ca.credit_limit)
    const apr = Number(ca.apr)
    const utilization = limit > 0 ? Math.round((balance / limit) * 100) : 0
    const acct = ca.accounts as unknown as { name: string; mask: string | null }

    cards.push({
      accountId: ca.account_id,
      name: acct.name,
      mask: acct.mask,
      balance,
      limit,
      utilization,
      apr,
      monthlyInterest: calculateMonthlyInterest(balance, apr),
      payoffMonths: estimatePayoffMonths(balance, apr),
      isVariableRate: ca.is_variable_rate,
    })
  }

  const { data: recentSnapshots } = await db
    .from('balance_snapshots')
    .select('account_id, balance, snapshot_at')
    .in('account_id', cards.map(c => c.accountId))
    .order('snapshot_at', { ascending: false })
    .limit(cards.length * 3)

  let trend: CreditSummary['trend'] = 'unknown'
  if (recentSnapshots && recentSnapshots.length >= cards.length * 2) {
    const byAccount: Record<string, number[]> = {}
    for (const snap of recentSnapshots) {
      if (!byAccount[snap.account_id]) byAccount[snap.account_id] = []
      if (byAccount[snap.account_id].length < 2) byAccount[snap.account_id].push(Number(snap.balance))
    }
    const totalCurrent = Object.values(byAccount).reduce((s, v) => s + (v[0] ?? 0), 0)
    const totalPrior = Object.values(byAccount).reduce((s, v) => s + (v[1] ?? 0), 0)
    if (totalCurrent > totalPrior * 1.01) trend = 'growing'
    else if (totalCurrent < totalPrior * 0.99) trend = 'shrinking'
    else trend = 'stable'
  }

  const totalBalance = cards.reduce((s, c) => s + c.balance, 0)
  const totalLimit = cards.reduce((s, c) => s + c.limit, 0)

  return {
    cards,
    totalBalance,
    totalLimit,
    totalUtilization: totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : 0,
    totalMonthlyInterest: cards.reduce((s, c) => s + c.monthlyInterest, 0),
    trend,
  }
}

async function getLoanSummary(periodStart: string): Promise<LoanSummary> {
  const { data: loanAccts } = await db
    .from('accounts')
    .select('id, name, mask, subtype')
    .eq('type', 'loan')

  const { data: loanMeta } = await db
    .from('loan_accounts')
    .select('account_id, apr, original_balance')

  const metaMap = Object.fromEntries((loanMeta ?? []).map(r => [r.account_id, r]))

  const loans: LoanAccountSummary[] = []

  for (const acct of loanAccts ?? []) {
    const meta = metaMap[acct.id]

    const { data: latestSnap } = await db
      .from('balance_snapshots')
      .select('balance')
      .eq('account_id', acct.id)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .single()

    const { data: yearStartSnap } = await db
      .from('balance_snapshots')
      .select('balance')
      .eq('account_id', acct.id)
      .lte('snapshot_at', periodStart)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .single()

    const currentBalance = Number(latestSnap?.balance ?? 0)
    const yearStartBalance = yearStartSnap ? Number(yearStartSnap.balance) : null
    const principalPaid = yearStartBalance !== null ? Math.max(0, yearStartBalance - currentBalance) : null
    const apr = meta?.apr ? Number(meta.apr) : null

    // Estimate interest paid as avg balance × monthly rate × months elapsed
    let estimatedInterestPaid: number | null = null
    if (apr !== null && yearStartBalance !== null) {
      const avgBalance = (yearStartBalance + currentBalance) / 2
      const monthsElapsed = Math.max(1, Math.round(
        (new Date().getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24 * 30)
      ))
      estimatedInterestPaid = (avgBalance * apr) / 100 / 12 * monthsElapsed
    }

    const projectedPayoffMonths = apr !== null && currentBalance > 0
      ? estimatePayoffMonths(currentBalance, apr)
      : null

    loans.push({
      accountId: acct.id,
      name: acct.name,
      mask: acct.mask,
      subtype: acct.subtype,
      currentBalance,
      originalBalance: meta?.original_balance ? Number(meta.original_balance) : null,
      apr,
      yearStartBalance,
      principalPaidThisYear: principalPaid,
      estimatedInterestPaidThisYear: estimatedInterestPaid,
      projectedPayoffMonths,
    })
  }

  return {
    loans,
    totalCurrentBalance: loans.reduce((s, l) => s + l.currentBalance, 0),
    totalPrincipalPaidThisYear: loans.reduce((s, l) => s + (l.principalPaidThisYear ?? 0), 0),
  }
}

export async function getAggregatesForPeriod(
  periodStart: string,
  periodEnd: string,
  periodType: 'biweekly' | 'monthly' | 'yearly'
): Promise<PeriodAggregates> {
  const { data: txs } = await db
    .from('transactions')
    .select('amount, category, merchant_name, date, is_income')
    .gte('date', periodStart)
    .lte('date', periodEnd)
    .order('amount', { ascending: false })

  const allTx = txs ?? []
  const spendTx = allTx.filter(t => !t.is_income)
  const incomeTx = allTx.filter(t => t.is_income)

  const totalSpend = spendTx.reduce((s, t) => s + Number(t.amount), 0)
  const totalIncome = incomeTx.reduce((s, t) => s + Number(t.amount), 0)

  const categoryBreakdown: Record<string, number> = {}
  for (const tx of spendTx) {
    const cat = tx.category ?? 'Other'
    categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + Number(tx.amount)
  }

  const largestPurchases = spendTx.slice(0, 10).map(t => ({
    merchant: t.merchant_name ?? 'Unknown',
    amount: Number(t.amount),
    date: t.date,
    category: t.category ?? 'Other',
  }))

  const { data: recurringRaw } = await db
    .from('recurring_charges')
    .select('*')
    .eq('is_active', true)

  const { data: savingsEventsRaw } = await db
    .from('savings_events')
    .select('*')
    .gte('created_at', periodStart)
    .lte('created_at', periodEnd)

  const [creditSummary, loanSummary] = await Promise.all([
    getCreditSummary(),
    getLoanSummary(periodStart),
  ])
  const savingsRate = calculateSavingsRate(totalIncome, totalSpend)

  return {
    periodStart,
    periodEnd,
    periodType,
    totalSpend,
    totalIncome,
    netSavings: totalIncome - totalSpend,
    savingsRate,
    categoryBreakdown,
    largestPurchases,
    activeRecurringCharges: (recurringRaw ?? []) as RecurringCharge[],
    creditSummary,
    loanSummary,
    savingsEvents: (savingsEventsRaw ?? []) as SavingsEvent[],
  }
}
