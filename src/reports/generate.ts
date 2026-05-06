import { anthropic } from '../categorize/claude.js'
import { sql } from '../db/client.js'
import { getAggregatesForPeriod } from './aggregate.js'
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
  const [goalRow] = await sql<Array<{ target_type: string; target_value: number }>>`
    SELECT target_type, target_value FROM savings_goals
    ORDER BY created_at DESC
    LIMIT 1
  `

  const savingsGoalDesc = goalRow
    ? goalRow.target_type === 'percentage'
      ? `${goalRow.target_value}% of paycheck ($${(paycheckAmount * Number(goalRow.target_value) / 100).toFixed(2)})`
      : `$${Number(goalRow.target_value).toFixed(2)} fixed per paycheck`
    : '$100/month'

  const [allRecurring, latestGoalsRows] = await Promise.all([
    sql<Array<{ merchant_name: string | null; average_amount: number | null }>>`
      SELECT merchant_name, average_amount FROM recurring_charges WHERE is_active = true
    `,
    sql<Array<{ goals: string }>>`
      SELECT goals FROM insights
      WHERE goals IS NOT NULL
      ORDER BY generated_at DESC
      LIMIT 1
    `,
  ])
  const latestGoals = latestGoalsRows[0]

  const recurringTotal = allRecurring.reduce((s, r) => s + Number(r.average_amount ?? 0), 0)

  const recurringLines = allRecurring.length
    ? allRecurring.map(r => `  ${r.merchant_name}: ~$${Number(r.average_amount).toFixed(2)}/mo`).join('\n')
    : '  None'

  const creditLines = agg.creditSummary.cards
    .map(c => `  ${c.name}: $${c.balance.toFixed(2)} balance / $${c.limit.toFixed(2)} limit (${c.utilization}% util, ${c.apr}% APR, $${c.monthlyInterest.toFixed(2)}/mo interest)`)
    .join('\n') || '  None'

  const goalsSection = latestGoals?.goals
    ? `\nActive goals from last planning session:\n${latestGoals.goals}\n`
    : ''

  const prompt = `You are a personal finance advisor helping someone allocate their paycheck.

Paycheck (combined from split direct deposit): $${paycheckAmount.toFixed(2)}

Recurring charges across all accounts (monthly averages, pro-rate ~2 weeks for this period):
${recurringLines}
Recurring total / mo: ~$${recurringTotal.toFixed(2)} (~$${(recurringTotal / 2).toFixed(2)} this period)

Savings goal: ${savingsGoalDesc}

Credit card balances:
${creditLines}

Average daily spend last period: $${(agg.totalSpend / 14).toFixed(2)}/day
${goalsSection}
Suggest a specific allocation for this paycheck. Format as a short list:
- Savings: $X — [one-line reason]
- Bills buffer: $X — [covers which charges this period]
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

export async function generateNarrativeForRegen(
  agg: PeriodAggregates,
  originalNarrative: string | null,
  transactions: Array<{ merchant_name: string | null; amount: number; date: string; category: string | null; is_income: boolean; is_recurring: boolean }>
): Promise<string> {
  const contextStr = formatAggregatesForPrompt(agg)

  const txLines = transactions
    .map(t => {
      const flags = [t.is_income ? 'income' : null, t.is_recurring ? 'recurring' : null].filter(Boolean).join(', ')
      return `  ${t.date}  ${(t.merchant_name ?? 'Unknown').padEnd(35)}  $${Number(t.amount).toFixed(2).padStart(8)}  ${t.category ?? 'Uncategorized'}${flags ? `  [${flags}]` : ''}`
    })
    .join('\n')

  const txSection = transactions.length
    ? `\nFull transaction list for this period:\n${txLines}`
    : '\nNo transactions found for this period.'

  const priorSection = originalNarrative
    ? `\n\nOriginal report for this period (written when transactions were first synced):\n"""\n${originalNarrative}\n"""\n\nSome transactions may have been re-categorized, recurring flags updated, or new transactions synced since then.`
    : ''

  const prompt = `You are a personal finance advisor. This is a REGENERATED analysis of the same paycheck period, run after the user updated their transaction data (re-categorizations, recurring flag changes, etc.).${priorSection}

Current aggregates:
${contextStr}
${txSection}

Write a 3-5 paragraph plain-English analysis covering:
1. Overall spending health — use the transaction list to call out specific merchants or patterns worth noting
2. Notable category trends (good and bad) — if re-categorizations changed the picture from the original, call that out
3. Credit health — utilization level, whether it's moving in the right direction, interest cost context
4. 2-3 specific, actionable recommendations grounded in actual transactions

Be direct and honest. Use exact dollar amounts. If the original report exists, briefly note what changed or was corrected. No preamble or sign-off.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}

export const getSavingsRecommendationForRegen = getSavingsRecommendation
export const getPaycheckAllocationForRegen = getPaycheckAllocation

export async function handlePaycheckDetected(tx: Transaction): Promise<void> {
  const lastEvent = await sql<Array<{ created_at: string; period_end: string }>>`
    SELECT created_at, period_end FROM savings_events
    ORDER BY created_at DESC
    LIMIT 1
  `

  const lastPeriodEnd = lastEvent[0]?.period_end
  const defaultStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  let periodStart = defaultStart
  if (lastPeriodEnd) {
    const d = new Date(lastPeriodEnd)
    d.setUTCDate(d.getUTCDate() + 1)
    periodStart = d.toISOString().split('T')[0]
  }
  const periodEnd = tx.date
  // Guard: if period collapsed (same-day or backwards), fall back to 14 days prior
  if (periodStart >= periodEnd) {
    periodStart = new Date(new Date(periodEnd).getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  }

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'biweekly')
  const [narrative, savingsRec, allocation] = await Promise.all([
    generateNarrative(agg, 'biweekly'),
    getSavingsRecommendation(tx.amount, agg),
    getPaycheckAllocation(tx.amount, agg),
  ])

  const keyFindings = JSON.stringify({ savings_recommendation: savingsRec, paycheck_allocation: allocation })
  await sql`
    INSERT INTO insights (period_start, period_end, period_type, raw_analysis, key_findings)
    VALUES (${periodStart}, ${periodEnd}, 'biweekly', ${narrative}, ${keyFindings}::jsonb)
  `

  await sql`
    INSERT INTO savings_events (paycheck_amount, period_start, period_end, notes)
    VALUES (${tx.amount}, ${periodStart}, ${periodEnd}, ${savingsRec})
  `

  if (agg.creditSummary.trend === 'growing') {
    const priorSnapshots = await sql<Array<{ account_id: string; balance: number; snapshot_at: string }>>`
      SELECT account_id, balance, snapshot_at FROM balance_snapshots
      ORDER BY snapshot_at DESC
      LIMIT ${agg.creditSummary.cards.length * 4}
    `

    const byAccount: Record<string, number[]> = {}
    for (const snap of priorSnapshots) {
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

  const baseUrl = process.env.APP_URL ?? 'https://rorakhit-autobudget.up.railway.app'
  const emailBody = [
    `Paycheck received: $${Number(tx.amount).toFixed(2)}`,
    '',
    `Period: ${periodStart} → ${periodEnd}`,
    `  Spend: $${agg.totalSpend.toFixed(2)}   Top: ${topCategories}`,
    `  Credit utilization: ${agg.creditSummary.totalUtilization}%`,
    '',
    `── Paycheck allocation ──`,
    allocation,
    '',
    `── Savings recommendation ──`,
    savingsRec,
    '',
    `── Analysis ──`,
    narrative,
    '',
    `Full report: ${baseUrl}/reports`,
  ].join('\n')

  await sendEmail(`Paycheck: $${Number(tx.amount).toFixed(2)}`, emailBody)
}

export async function runMonthlyReport(year: number, month: number): Promise<void> {
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'monthly')
  const narrative = await generateNarrative(agg, 'monthly')

  await sql`
    INSERT INTO insights (period_start, period_end, period_type, raw_analysis)
    VALUES (${periodStart}, ${periodEnd}, 'monthly', ${narrative})
  `

  const topCategories = Object.entries(agg.categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`)
    .join('\n')

  const baseUrl = process.env.APP_URL ?? 'https://rorakhit-autobudget.up.railway.app'
  const emailBody = [
    `${year}-${String(month).padStart(2, '0')} Monthly Report`,
    '',
    `Income: $${agg.totalIncome.toFixed(2)}   Spend: $${agg.totalSpend.toFixed(2)}   Saved: $${agg.netSavings.toFixed(2)} (${agg.savingsRate}%)`,
    '',
    `Top categories:`,
    topCategories,
    '',
    `Credit utilization: ${agg.creditSummary.totalUtilization}%  Interest/mo: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`,
    '',
    `── Analysis ──`,
    narrative,
    '',
    `Full report: ${baseUrl}/reports`,
  ].join('\n')

  await sendEmail(`Monthly Report: ${year}-${String(month).padStart(2, '0')}`, emailBody)
}

export async function runYearlyReport(year: number): Promise<void> {
  const periodStart = `${year}-01-01`
  const periodEnd = `${year}-12-31`

  const priorAgg = await getAggregatesForPeriod(`${year - 1}-01-01`, `${year - 1}-12-31`, 'yearly')
  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'yearly')
  agg.priorPeriod = priorAgg

  const narrative = await generateNarrative(agg, 'yearly')

  await sql`
    INSERT INTO insights (period_start, period_end, period_type, raw_analysis)
    VALUES (${periodStart}, ${periodEnd}, 'yearly', ${narrative})
  `

  const baseUrl = process.env.APP_URL ?? 'https://rorakhit-autobudget.up.railway.app'
  const emailBody = [
    `${year} Year in Review`,
    '',
    `Total income: $${agg.totalIncome.toFixed(2)}`,
    `Total spend: $${agg.totalSpend.toFixed(2)}`,
    `Net savings: $${agg.netSavings.toFixed(2)}`,
    `Savings rate: ${agg.savingsRate}%`,
    `Avg monthly interest: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`,
    '',
    narrative,
    '',
    `Full report: ${baseUrl}/reports`,
  ].join('\n')

  await sendEmail(`${year} Year in Review`, emailBody)
}
