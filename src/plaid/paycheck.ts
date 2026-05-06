import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { sql } from '../db/client.js'
import { handlePaycheckDetected } from '../reports/generate.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function paycheckPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/paycheck.html'), 'utf8')
  await reply.type('text/html').send(html)
}

async function getRecurringByMerchant() {
  const txs = await sql<Array<{ merchant_name: string | null; amount: number; date: string }>>`
    SELECT merchant_name, amount, date FROM transactions
    WHERE is_recurring = true AND is_income = false
    ORDER BY date DESC
  `

  const map = new Map<string, { merchant_name: string; total: number; count: number; last_seen: string; amounts: number[] }>()
  for (const tx of txs) {
    const key = tx.merchant_name ?? 'Unknown'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { merchant_name: key, total: Number(tx.amount), count: 1, last_seen: tx.date, amounts: [Number(tx.amount)] })
    } else {
      existing.total += Number(tx.amount)
      existing.count++
      existing.amounts.push(Number(tx.amount))
      if (tx.date > existing.last_seen) existing.last_seen = tx.date
    }
  }

  return Array.from(map.values())
    .map(r => ({ merchant_name: r.merchant_name, average_amount: r.total / r.count, last_seen: r.last_seen, count: r.count }))
    .sort((a, b) => b.average_amount - a.average_amount)
}

export async function paycheckDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const [patterns, recurring] = await Promise.all([
    sql<Array<{ id: string; pattern: string }>>`SELECT id, pattern FROM paycheck_patterns ORDER BY created_at`,
    getRecurringByMerchant(),
  ])

  await reply.send({ patterns, recurring })
}

export async function recurringExportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const recurring = await getRecurringByMerchant()
  const lines = ['Merchant,Average Amount,Last Seen,Occurrences']
  for (const r of recurring) {
    lines.push(`"${r.merchant_name.replace(/"/g, '""')}",${r.average_amount.toFixed(2)},${r.last_seen},${r.count}`)
  }

  await reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', 'attachment; filename="recurring-charges.csv"')
    .send(lines.join('\n'))
}

export async function addPaycheckPatternHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { pattern } = ((req.body as any)._parsed ?? req.body) as { pattern: string }
  if (!pattern?.trim()) return reply.code(400).send({ error: 'pattern required' })

  try {
    const [data] = await sql<Array<{ id: string; pattern: string }>>`
      INSERT INTO paycheck_patterns (pattern) VALUES (${pattern.trim().toUpperCase()})
      RETURNING id, pattern
    `
    await reply.send(data)
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
}

export async function removePaycheckPatternHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { id } = req.params as { id: string }
  try {
    await sql`DELETE FROM paycheck_patterns WHERE id = ${id}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function removeRecurringHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  try {
    await sql`UPDATE recurring_charges SET is_active = false WHERE id = ${id}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function triggerPaycheckReportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const isRegen = (req.query as Record<string, string>).regen === '1'

  if (isRegen) {
    const lastEvent = await sql<Array<{ period_start: string; period_end: string; paycheck_amount: number }>>`
      SELECT period_start, period_end, paycheck_amount FROM savings_events
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (!lastEvent.length) return reply.code(404).send({ error: 'No previous paycheck report found to regenerate' })

    const { period_start, period_end, paycheck_amount } = lastEvent[0]
    await reply.send({ ok: true, regen: true, transaction: { amount: paycheck_amount, date: period_end } })

    setImmediate(async () => {
      const { getAggregatesForPeriod } = await import('../reports/aggregate.js')
      const { generateNarrativeForRegen, getSavingsRecommendationForRegen, getPaycheckAllocationForRegen } = await import('../reports/generate.js')

      // Fix bad stored dates: period_start must be before period_end
      let effectivePeriodStart = period_start
      if (effectivePeriodStart >= period_end) {
        const d = new Date(period_end)
        d.setUTCDate(d.getUTCDate() - 14)
        effectivePeriodStart = d.toISOString().split('T')[0]
      }

      // Re-derive paycheck amount from all pattern-matching income on period_end
      // (stored paycheck_amount may only reflect one of several split deposits)
      const patterns = await sql<Array<{ pattern: string }>>`SELECT pattern FROM paycheck_patterns`
      let effectivePaycheckAmount = Number(paycheck_amount)
      if (patterns.length) {
        const incomeTxs = await sql<Array<{ merchant_name: string | null; amount: number }>>`
          SELECT merchant_name, amount FROM transactions
          WHERE is_income = true AND date = ${period_end}
        `
        const matching = incomeTxs.filter(tx => {
          const name = (tx.merchant_name ?? '').toLowerCase()
          return patterns.some(p => name.includes(p.pattern.toLowerCase()))
        })
        if (matching.length) {
          effectivePaycheckAmount = matching.reduce((s, tx) => s + Number(tx.amount), 0)
        }
      }

      const [originalInsightRows, txs] = await Promise.all([
        sql<Array<{ raw_analysis: string }>>`
          SELECT raw_analysis FROM insights
          WHERE period_start = ${period_start}
            AND period_end = ${period_end}
            AND period_type = 'biweekly'
            AND key_findings->'label' IS NULL
          ORDER BY generated_at ASC
          LIMIT 1
        `,
        sql<Array<{ merchant_name: string | null; amount: number; date: string; category: string | null; is_income: boolean; is_recurring: boolean }>>`
          SELECT merchant_name, amount, date, category, is_income, is_recurring FROM transactions
          WHERE date >= ${effectivePeriodStart} AND date <= ${period_end}
          ORDER BY date DESC
        `,
      ])
      const originalInsight = originalInsightRows[0]

      const agg = await getAggregatesForPeriod(effectivePeriodStart, period_end, 'biweekly')
      const [narrative, savingsRec, allocation] = await Promise.all([
        generateNarrativeForRegen(agg, originalInsight?.raw_analysis ?? null, txs),
        getSavingsRecommendationForRegen(effectivePaycheckAmount, agg),
        getPaycheckAllocationForRegen(effectivePaycheckAmount, agg),
      ])
      const label = `Regen ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`
      const keyFindings = JSON.stringify({ savings_recommendation: savingsRec, paycheck_allocation: allocation, label })
      await sql`
        INSERT INTO insights (period_start, period_end, period_type, raw_analysis, key_findings)
        VALUES (
          ${effectivePeriodStart},
          ${period_end},
          'biweekly',
          ${narrative},
          ${keyFindings}::jsonb
        )
      `
    })
    return
  }

  const patterns = await sql<Array<{ pattern: string }>>`SELECT pattern FROM paycheck_patterns`
  if (!patterns.length) return reply.code(400).send({ error: 'No paycheck patterns configured' })

  const incomeTxs = await sql<Array<Record<string, any>>>`
    SELECT * FROM transactions
    WHERE is_income = true
    ORDER BY date DESC
    LIMIT 200
  `

  const matching = incomeTxs.filter(tx => {
    const name = ((tx.merchant_name as string | null) ?? '').toLowerCase()
    return patterns.some(p => name.includes(p.pattern.toLowerCase()))
  })

  if (!matching.length) return reply.code(404).send({ error: 'No matching paycheck deposits found' })

  // Take the most recent date and sum all same-day matches
  const latestDate = matching[0].date
  const group = matching.filter(tx => tx.date === latestDate)
  const totalAmount = group.reduce((s, tx) => s + Number(tx.amount), 0)
  const combined = { ...group[0], amount: totalAmount, date: latestDate }

  await reply.send({ ok: true, transaction: { amount: totalAmount, date: latestDate } })

  setImmediate(async () => {
    await handlePaycheckDetected(combined as any)
  })
}
