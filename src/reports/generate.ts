import { anthropic } from '../categorize/claude.js'
import { db } from '../db/client.js'
import { getAggregatesForPeriod } from './aggregate.js'
import { writeNotionReport, updateNotionDashboards } from './notion.js'
import { sendEmail } from '../alerts/gmail.js'
import type { PeriodAggregates, Transaction } from '../types.js'

function formatAggregatesForPrompt(agg: PeriodAggregates): string {
  const lines = [
    `Period: ${agg.periodStart} to ${agg.periodEnd} (${agg.periodType})`,
    `Total income: $${agg.totalIncome.toFixed(2)}`,
    `Total spend: $${agg.totalSpend.toFixed(2)}`,
    `Net savings: $${agg.netSavings.toFixed(2)}`,
    `Savings rate: ${agg.savingsRate}%`,
    '',
    'Spending by category:',
    ...Object.entries(agg.categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`),
    '',
    'Credit summary:',
    `  Total balance: $${agg.creditSummary.totalBalance.toFixed(2)}`,
    `  Total utilization: ${agg.creditSummary.totalUtilization}%`,
    `  Monthly interest cost: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`,
    `  Balance trend: ${agg.creditSummary.trend}`,
    ...agg.creditSummary.cards.map(c =>
      `  ${c.name}: $${c.balance.toFixed(2)} / $${c.limit.toFixed(2)} (${c.utilization}% util, ${c.apr}% APR)`
    ),
  ]

  if (agg.loanSummary.loans.length > 0) {
    lines.push('', 'Loans:')
    lines.push(`  Total loan balance: $${agg.loanSummary.totalCurrentBalance.toFixed(2)}`)
    if (agg.loanSummary.totalPrincipalPaidThisYear > 0) {
      lines.push(`  Principal paid this year: $${agg.loanSummary.totalPrincipalPaidThisYear.toFixed(2)}`)
    }
    for (const loan of agg.loanSummary.loans) {
      const parts = [`$${loan.currentBalance.toFixed(2)}`]
      if (loan.apr !== null) parts.push(`${loan.apr}% APR`)
      if (loan.principalPaidThisYear !== null) parts.push(`$${loan.principalPaidThisYear.toFixed(2)} paid down this year`)
      if (loan.estimatedInterestPaidThisYear !== null) parts.push(`~$${loan.estimatedInterestPaidThisYear.toFixed(2)} interest paid this year`)
      if (loan.projectedPayoffMonths !== null) parts.push(`payoff in ~${loan.projectedPayoffMonths}mo`)
      lines.push(`  ${loan.name}${loan.subtype ? ` (${loan.subtype})` : ''}: ${parts.join(', ')}`)
    }
  }

  if (agg.priorPeriod) {
    lines.push('', 'Prior period comparison:')
    lines.push(`  Prior spend: $${agg.priorPeriod.totalSpend.toFixed(2)}`)
    lines.push(`  Prior savings rate: ${agg.priorPeriod.savingsRate}%`)
    lines.push(`  Prior credit utilization: ${agg.priorPeriod.creditSummary.totalUtilization}%`)
  }

  return lines.join('\n')
}

async function generateNarrative(agg: PeriodAggregates, promptType: 'biweekly' | 'monthly' | 'yearly'): Promise<string> {
  const contextStr = formatAggregatesForPrompt(agg)

  const prompts: Record<string, string> = {
    biweekly: `You are a personal finance advisor reviewing someone's spending for the past two weeks.

${contextStr}

Write a 3-5 paragraph plain-English analysis covering:
1. Overall spending health this period
2. Notable category trends (good and bad)
3. Credit health — utilization level, whether it's moving in the right direction, interest cost context
4. 2-3 specific, actionable recommendations

Be direct and honest. Use exact dollar amounts from the data. No preamble or sign-off.`,

    monthly: `You are a personal finance advisor reviewing someone's full month of spending.

${contextStr}

Write a 4-6 paragraph plain-English analysis covering:
1. Month summary — income vs spend, savings rate vs prior month
2. Category breakdown — what grew, what shrank, what to watch
3. Credit health — utilization trend, interest paid, which card to prioritize
4. Subscription audit — any concerning recurring charges
5. 3-5 specific, actionable recommendations for next month

Be direct and specific. Use exact dollar amounts. Acknowledge effort where improvement happened. No preamble.`,

    yearly: `You are a personal finance coach reviewing someone's full year of financial data.

${contextStr}

Write a 5-7 paragraph year-end retrospective covering:
1. The year in numbers — income, spend, savings rate, overall trajectory
2. What went well — specific improvements vs prior year, wins to be proud of (use exact numbers)
3. What still needs work — honest assessment of persistent challenges, no shame just facts
4. Credit journey — where utilization started, where it ended, interest paid across the year
5. Loan progress — principal paid down, interest cost, which loans are closest to payoff (skip if no loans)
6. Savings performance — did they hit their goal? By how much?
7. 2-3 specific focus areas for the coming year

Tone: a coach who has seen all the data. Warm, honest, and direct. Celebrate genuine wins. Be real about challenges. End with belief in their ability to improve. Use exact numbers throughout.`,
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompts[promptType] }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}

async function getSavingsRecommendation(
  paycheckAmount: number,
  agg: PeriodAggregates
): Promise<string> {
  const creditLines = agg.creditSummary.cards
    .map(c => `  ${c.name}: $${c.balance.toFixed(2)} balance, ${c.apr}% APR, $${c.monthlyInterest.toFixed(2)}/mo interest`)
    .join('\n')

  const recurringTotal = agg.activeRecurringCharges.reduce((s, r) => s + (r.average_amount ?? 0), 0)

  const prompt = `You are a personal finance advisor. Recommend a savings transfer amount for this paycheck.

Paycheck received: $${paycheckAmount.toFixed(2)}
Estimated upcoming recurring charges: $${recurringTotal.toFixed(2)}/month
Average daily spend this period: $${(agg.totalSpend / 14).toFixed(2)}/day

Credit card balances:
${creditLines}

Write 2-3 sentences: state the recommended savings amount and your specific reasoning for it.
Be concrete. Factor in credit obligations. No preamble.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}

async function getPaycheckAllocation(paycheckAmount: number, agg: PeriodAggregates): Promise<string> {
  const { data: goalRow } = await db
    .from('savings_goals')
    .select('target_type, target_value')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const savingsGoalDesc = goalRow
    ? goalRow.target_type === 'percentage'
      ? `${goalRow.target_value}% of paycheck ($${(paycheckAmount * goalRow.target_value / 100).toFixed(2)})`
      : `$${Number(goalRow.target_value).toFixed(2)} fixed per paycheck`
    : '$100/month'

  const { data: allRecurring } = await db
    .from('recurring_charges')
    .select('merchant_name, average_amount, is_pre_allocated, pre_allocated_amount')
    .eq('is_active', true)

  const preAllocated = (allRecurring ?? []).filter(r => r.is_pre_allocated)
  const discretionary = (allRecurring ?? []).filter(r => !r.is_pre_allocated)

  const preTotal = preAllocated.reduce((s, r) => s + Number(r.pre_allocated_amount ?? r.average_amount ?? 0), 0)
  const discTotal = discretionary.reduce((s, r) => s + Number(r.average_amount ?? 0), 0)

  const preLines = preAllocated.length
    ? preAllocated.map(r => `  ${r.merchant_name}: $${Number(r.pre_allocated_amount ?? r.average_amount).toFixed(2)}`).join('\n')
    : '  None'

  const discLines = discretionary.length
    ? discretionary.map(r => `  ${r.merchant_name}: ~$${Number(r.average_amount).toFixed(2)}`).join('\n')
    : '  None'

  const creditLines = agg.creditSummary.cards
    .map(c => `  ${c.name}: $${c.balance.toFixed(2)} balance / $${c.limit.toFixed(2)} limit (${c.utilization}% util, ${c.apr}% APR, $${c.monthlyInterest.toFixed(2)}/mo interest)`)
    .join('\n') || '  None'

  const remaining = paycheckAmount - preTotal

  const prompt = `You are a personal finance advisor helping someone allocate their paycheck.

Paycheck: $${paycheckAmount.toFixed(2)}

Pre-allocated (auto-handled, dedicated accounts — do not include in advice):
${preLines}
Pre-allocated total: $${preTotal.toFixed(2)}

Remaining after pre-allocated: $${remaining.toFixed(2)}

Discretionary recurring charges to cover from remaining (monthly averages, pro-rated ~2 weeks):
${discLines}
Discretionary total / mo: ~$${discTotal.toFixed(2)} (~$${(discTotal / 2).toFixed(2)} this period)

Savings goal: ${savingsGoalDesc}

Credit card balances:
${creditLines}

Average daily spend last period: $${(agg.totalSpend / 14).toFixed(2)}/day

From the remaining $${remaining.toFixed(2)}, suggest a specific allocation. Format as a short list:
- Savings: $X — [one-line reason]
- Discretionary bills buffer: $X — [covers which charges]
- [Credit card] payment: $X — [whether to pay minimum, more, or hold]
- Spending money: $X

End with one sentence: should they increase their credit card payment this period, and by how much if so.
Use exact dollar amounts. No preamble.`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}

export async function handlePaycheckDetected(tx: Transaction): Promise<void> {
  const { data: lastEvent } = await db
    .from('savings_events')
    .select('created_at, period_end')
    .order('created_at', { ascending: false })
    .limit(1)

  const periodStart = lastEvent?.[0]?.period_end ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const periodEnd = tx.date

  const { data: creditAccts } = await db
    .from('credit_accounts')
    .select('account_id')

  for (const ca of creditAccts ?? []) {
    const { data: allTx } = await db
      .from('transactions')
      .select('amount, is_income, category')
      .eq('account_id', ca.account_id)

    const balance = (allTx ?? []).reduce((sum, t) => {
      if (t.category === 'Credit Payment') return sum - Number(t.amount)
      if (!t.is_income) return sum + Number(t.amount)
      return sum
    }, 0)

    await db.from('balance_snapshots').insert({
      account_id: ca.account_id,
      balance: Math.max(0, balance),
    })
  }

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'biweekly')
  const [narrative, savingsRec, allocation] = await Promise.all([
    generateNarrative(agg, 'biweekly'),
    getSavingsRecommendation(tx.amount, agg),
    getPaycheckAllocation(tx.amount, agg),
  ])

  await db.from('insights').insert({
    period_start: periodStart,
    period_end: periodEnd,
    period_type: 'biweekly',
    raw_analysis: narrative,
    key_findings: { savings_recommendation: savingsRec, paycheck_allocation: allocation },
  })

  await db.from('savings_events').insert({
    paycheck_amount: tx.amount,
    period_start: periodStart,
    period_end: periodEnd,
    notes: savingsRec,
  })

  const notionPageUrl = await writeNotionReport(agg, narrative, 'biweekly')
  await updateNotionDashboards(agg)

  if (agg.creditSummary.trend === 'growing') {
    const { data: priorSnapshots } = await db
      .from('balance_snapshots')
      .select('account_id, balance, snapshot_at')
      .order('snapshot_at', { ascending: false })
      .limit(agg.creditSummary.cards.length * 4)

    const byAccount: Record<string, number[]> = {}
    for (const snap of priorSnapshots ?? []) {
      if (!byAccount[snap.account_id]) byAccount[snap.account_id] = []
      if (byAccount[snap.account_id].length < 3) byAccount[snap.account_id].push(Number(snap.balance))
    }

    const grewTwoPeriods = Object.values(byAccount).every(
      balances => balances.length >= 3 && balances[0] > balances[1] && balances[1] > balances[2]
    )

    if (grewTwoPeriods) {
      const { enrichAlertContext } = await import('../alerts/enrich.js')
      const { sendAlert } = await import('../alerts/gmail.js')
      const enriched = await enrichAlertContext('credit_growing_trend', {
        trend: 'growing',
        totalBalance: agg.creditSummary.totalBalance,
        totalUtilization: agg.creditSummary.totalUtilization,
      })
      await sendAlert({ type: 'credit_growing_trend', data: { totalBalance: agg.creditSummary.totalBalance }, enrichedContext: enriched })
    }
  }

  const topCategories = Object.entries(agg.categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, amt]) => `${cat}: $${amt.toFixed(2)}`)
    .join(', ')

  const emailBody = [
    `Paycheck received: $${tx.amount.toFixed(2)}`,
    '',
    `Period summary (${periodStart} → ${periodEnd}):`,
    `  Total spend: $${agg.totalSpend.toFixed(2)}`,
    `  Top categories: ${topCategories}`,
    `  Credit utilization: ${agg.creditSummary.totalUtilization}%`,
    '',
    `How to allocate this paycheck:`,
    allocation,
    '',
    `Savings recommendation:`,
    savingsRec,
    '',
    `Full report: ${notionPageUrl}`,
  ].join('\n')

  await sendEmail(`Paycheck received: $${tx.amount.toFixed(2)}`, emailBody)
}

export async function runMonthlyReport(year: number, month: number): Promise<void> {
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'monthly')
  const narrative = await generateNarrative(agg, 'monthly')

  await db.from('insights').insert({
    period_start: periodStart,
    period_end: periodEnd,
    period_type: 'monthly',
    raw_analysis: narrative,
  })

  await writeNotionReport(agg, narrative, 'monthly')
  await updateNotionDashboards(agg)
}

export async function runYearlyReport(year: number): Promise<void> {
  const periodStart = `${year}-01-01`
  const periodEnd = `${year}-12-31`

  const priorAgg = await getAggregatesForPeriod(`${year - 1}-01-01`, `${year - 1}-12-31`, 'yearly')
  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'yearly')
  agg.priorPeriod = priorAgg

  const narrative = await generateNarrative(agg, 'yearly')

  await db.from('insights').insert({
    period_start: periodStart,
    period_end: periodEnd,
    period_type: 'yearly',
    raw_analysis: narrative,
  })

  const notionPageUrl = await writeNotionReport(agg, narrative, 'yearly')

  const highlights = [
    `${year} Year in Review`,
    '',
    `Total income: $${agg.totalIncome.toFixed(2)}`,
    `Total spend: $${agg.totalSpend.toFixed(2)}`,
    `Net savings: $${agg.netSavings.toFixed(2)}`,
    `Average savings rate: ${agg.savingsRate}%`,
    `Total interest paid: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}/mo average`,
    '',
    `Full report: ${notionPageUrl}`,
    '',
    narrative.split('\n').slice(0, 6).join('\n'),
  ].join('\n')

  await sendEmail(`${year} Year in Review`, highlights)
}
