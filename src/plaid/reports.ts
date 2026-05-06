import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { sql } from '../db/client.js'
import { getAggregatesForPeriod } from '../reports/aggregate.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function reportsPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/reports.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function deleteInsightHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  try {
    await sql`DELETE FROM insights WHERE id = ${id}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function saveGoalsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { id, goals } = ((req.body as any)._parsed ?? req.body) as { id: string; goals: string }
  if (!id) return reply.code(400).send({ error: 'id required' })

  try {
    await sql`UPDATE insights SET goals = ${goals ?? null} WHERE id = ${id}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function reportsDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const insights = await sql<Array<Record<string, any>>>`
    SELECT * FROM insights
    ORDER BY period_start DESC
    LIMIT 50
  `

  // Attach category breakdown from transactions for each insight
  const enriched = await Promise.all(insights.map(async insight => {
    const txs = await sql<Array<{ amount: number; category: string | null; is_income: boolean }>>`
      SELECT amount, category, is_income FROM transactions
      WHERE date >= ${insight.period_start} AND date <= ${insight.period_end}
    `

    const spendTx = txs.filter(t => !t.is_income)
    const totalSpend = spendTx.reduce((s, t) => s + Number(t.amount), 0)
    const totalIncome = txs.filter(t => t.is_income).reduce((s, t) => s + Number(t.amount), 0)

    const categoryBreakdown: Record<string, number> = {}
    for (const tx of spendTx) {
      const cat = tx.category ?? 'Other'
      categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + Number(tx.amount)
    }

    const savingsRate = totalIncome > 0
      ? Math.max(0, Math.round(((totalIncome - totalSpend) / totalIncome) * 100 * 100) / 100)
      : 0

    return {
      ...insight,
      total_spend: totalSpend,
      total_income: totalIncome,
      savings_rate: savingsRate,
      category_breakdown: categoryBreakdown,
    }
  }))

  await reply.send(enriched)
}

export async function spendingTransactionsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { days: daysStr } = req.query as { days?: string }
  const days = Math.min(Math.max(parseInt(daysStr ?? '30', 10), 1), 365)
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const txs = await sql`
    SELECT merchant_name, amount, date, category FROM transactions
    WHERE is_income = false AND date >= ${periodStart}
    ORDER BY date DESC
  `

  await reply.send(txs)
}

export async function spendingCategoryHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { days: daysStr, category } = req.query as { days?: string; category?: string }
  if (!category) return reply.code(400).send({ error: 'category required' })

  const days = Math.min(Math.max(parseInt(daysStr ?? '30', 10), 1), 365)
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const txs = await sql`
    SELECT merchant_name, amount, date, category FROM transactions
    WHERE is_income = false AND category = ${category} AND date >= ${periodStart}
    ORDER BY date DESC
  `

  await reply.send(txs)
}

export async function spendingPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/spending.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function spendingDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { days: daysStr } = req.query as { days?: string }
  const days = Math.min(Math.max(parseInt(daysStr ?? '30', 10), 1), 365)
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const periodEnd = new Date().toISOString().split('T')[0]

  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'monthly')

  await reply.send({
    totalSpend: agg.totalSpend,
    totalIncome: agg.totalIncome,
    netSavings: agg.netSavings,
    savingsRate: agg.savingsRate,
    categoryBreakdown: agg.categoryBreakdown,
    largestPurchases: agg.largestPurchases,
    recurringCharges: agg.activeRecurringCharges,
  })
}

export async function creditPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/credit.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function creditDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const periodStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
  const periodEnd = new Date().toISOString().split('T')[0]
  const agg = await getAggregatesForPeriod(periodStart, periodEnd, 'yearly')

  await reply.send({
    creditSummary: agg.creditSummary,
    loanSummary: agg.loanSummary,
  })
}
