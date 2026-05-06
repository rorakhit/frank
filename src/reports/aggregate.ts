import { sql } from '../db/client.js'
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
  const creditAccts = await sql<Array<{
    account_id: string
    apr: number
    credit_limit: number
    is_variable_rate: boolean
    name: string
    mask: string | null
  }>>`
    SELECT ca.account_id, ca.apr, ca.credit_limit, ca.is_variable_rate,
           a.name, a.mask
    FROM credit_accounts ca
    LEFT JOIN accounts a ON a.id = ca.account_id
  `

  const cards: CreditCardSummary[] = []

  for (const ca of creditAccts) {
    const snapshots = await sql<Array<{ balance: number; snapshot_at: string }>>`
      SELECT balance, snapshot_at FROM balance_snapshots
      WHERE account_id = ${ca.account_id}
      ORDER BY snapshot_at DESC
      LIMIT 1
    `

    const balance = Number(snapshots[0]?.balance ?? 0)
    const limit = Number(ca.credit_limit)
    const apr = Number(ca.apr)
    const utilization = limit > 0 ? Math.round((balance / limit) * 100) : 0

    cards.push({
      accountId: ca.account_id,
      name: ca.name,
      mask: ca.mask,
      balance,
      limit,
      utilization,
      apr,
      monthlyInterest: calculateMonthlyInterest(balance, apr),
      payoffMonths: estimatePayoffMonths(balance, apr),
      isVariableRate: ca.is_variable_rate,
    })
  }

  const cardAccountIds = cards.map(c => c.accountId)
  const recentSnapshots = cardAccountIds.length > 0
    ? await sql<Array<{ account_id: string; balance: number; snapshot_at: string }>>`
        SELECT account_id, balance, snapshot_at FROM balance_snapshots
        WHERE account_id = ANY(${cardAccountIds})
        ORDER BY snapshot_at DESC
        LIMIT ${cards.length * 3}
      `
    : []

  let trend: CreditSummary['trend'] = 'unknown'
  if (recentSnapshots.length >= cards.length * 2) {
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
  const loanAccts = await sql<Array<{ id: string; name: string; mask: string | null; subtype: string | null }>>`
    SELECT id, name, mask, subtype FROM accounts WHERE type = 'loan'
  `

  const loanMeta = await sql<Array<{ account_id: string; apr: number | null; original_balance: number | null }>>`
    SELECT account_id, apr, original_balance FROM loan_accounts
  `

  const metaMap = Object.fromEntries(loanMeta.map(r => [r.account_id, r]))

  const loans: LoanAccountSummary[] = []

  for (const acct of loanAccts) {
    const meta = metaMap[acct.id]

    const [latestSnap] = await sql<Array<{ balance: number }>>`
      SELECT balance FROM balance_snapshots
      WHERE account_id = ${acct.id}
      ORDER BY snapshot_at DESC
      LIMIT 1
    `

    const [yearStartSnap] = await sql<Array<{ balance: number }>>`
      SELECT balance FROM balance_snapshots
      WHERE account_id = ${acct.id} AND snapshot_at <= ${periodStart}
      ORDER BY snapshot_at DESC
      LIMIT 1
    `

    const currentBalance = Number(latestSnap?.balance ?? 0)
    const yearStartBalance = yearStartSnap ? Number(yearStartSnap.balance) : null
    const principalPaid = yearStartBalance !== null ? Math.max(0, yearStartBalance - currentBalance) : null
    const apr = meta?.apr != null ? Number(meta.apr) : null

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
      originalBalance: meta?.original_balance != null ? Number(meta.original_balance) : null,
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
  const allTx = await sql<Array<{
    amount: number
    category: string | null
    merchant_name: string | null
    date: string
    is_income: boolean
  }>>`
    SELECT amount, category, merchant_name, date, is_income FROM transactions
    WHERE date >= ${periodStart} AND date <= ${periodEnd}
    ORDER BY amount DESC
  `

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

  // Build recurring charges from manually-flagged transactions
  const recurringTxs = await sql<Array<{ merchant_name: string | null; amount: number; date: string; account_id: string | null }>>`
    SELECT merchant_name, amount, date, account_id FROM transactions
    WHERE is_recurring = true AND is_income = false
    ORDER BY date DESC
  `

  const recurringMap = new Map<string, { merchant_name: string; average_amount: number; last_seen: string; account_id: string | null }>()
  for (const tx of recurringTxs) {
    const key = tx.merchant_name ?? 'Unknown'
    if (!recurringMap.has(key)) {
      recurringMap.set(key, { merchant_name: key, average_amount: Number(tx.amount), last_seen: tx.date, account_id: tx.account_id })
    }
  }
  const recurringRaw = Array.from(recurringMap.values())

  const savingsEventsRaw = await sql<Array<any>>`
    SELECT * FROM savings_events
    WHERE created_at >= ${periodStart} AND created_at <= ${periodEnd}
  `

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
    activeRecurringCharges: recurringRaw as unknown as RecurringCharge[],
    creditSummary,
    loanSummary,
    savingsEvents: savingsEventsRaw as SavingsEvent[],
  }
}
