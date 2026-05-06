import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
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

export async function paycheckDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const [{ data: accounts }, { data: recurring }] = await Promise.all([
    db.from('accounts')
      .select('id, name, mask, type, subtype, is_paycheck_account, plaid_items(institution_name)')
      .eq('type', 'depository')
      .order('name'),
    db.from('recurring_charges')
      .select('id, merchant_name, average_amount, frequency, is_pre_allocated, pre_allocated_amount, is_active')
      .eq('is_active', true)
      .order('average_amount', { ascending: false }),
  ])

  await reply.send({ accounts: accounts ?? [], recurring: recurring ?? [] })
}

export async function setPaycheckAccountHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { account_id } = ((req.body as any)._parsed ?? req.body) as { account_id: string }
  if (!account_id) return reply.code(400).send({ error: 'account_id required' })

  // Clear existing, set new
  await db.from('accounts').update({ is_paycheck_account: false }).eq('is_paycheck_account', true)
  const { error } = await db.from('accounts').update({ is_paycheck_account: true }).eq('id', account_id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function removeRecurringHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  const { error } = await db.from('recurring_charges').update({ is_active: false }).eq('id', id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function updateRecurringAllocationHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { id, is_pre_allocated, pre_allocated_amount } =
    ((req.body as any)._parsed ?? req.body) as {
      id: string
      is_pre_allocated: boolean
      pre_allocated_amount?: number | null
    }

  if (!id) return reply.code(400).send({ error: 'id required' })

  const { error } = await db.from('recurring_charges').update({
    is_pre_allocated,
    pre_allocated_amount: pre_allocated_amount ?? null,
  }).eq('id', id)

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function recurringExportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { data: recurring } = await db
    .from('recurring_charges')
    .select('merchant_name, average_amount, last_seen, count')
    .eq('is_active', true)
    .order('average_amount', { ascending: false })

  const lines = ['Merchant,Average Amount,Last Seen,Occurrences']
  for (const r of recurring ?? []) {
    const name = (r.merchant_name ?? 'Unknown').replace(/"/g, '""')
    lines.push(`"${name}",${Number(r.average_amount).toFixed(2)},${r.last_seen ?? ''},${r.count ?? 0}`)
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

  const { data, error } = await db
    .from('paycheck_patterns')
    .insert({ pattern: pattern.trim().toUpperCase() })
    .select('id, pattern')
    .single()

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send(data)
}

export async function removePaycheckPatternHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { id } = req.params as { id: string }
  const { error } = await db.from('paycheck_patterns').delete().eq('id', id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function triggerPaycheckReportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const isRegen = (req.query as Record<string, string>).regen === '1'

  if (isRegen) {
    const { data: lastEvents } = await db
      .from('savings_events')
      .select('period_start, period_end, paycheck_amount')
      .order('created_at', { ascending: false })
      .limit(1)

    if (!lastEvents?.length) return reply.code(404).send({ error: 'No previous paycheck report found to regenerate' })

    const { period_start, period_end, paycheck_amount } = lastEvents[0]
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
      const { data: patterns } = await db.from('paycheck_patterns').select('pattern')
      let effectivePaycheckAmount = Number(paycheck_amount)
      if (patterns?.length) {
        const { data: incomeTxs } = await db
          .from('transactions')
          .select('merchant_name, amount')
          .eq('is_income', true)
          .eq('date', period_end)
        const matching = (incomeTxs ?? []).filter(tx => {
          const name = (tx.merchant_name ?? '').toLowerCase()
          return (patterns ?? []).some(p => name.includes(p.pattern.toLowerCase()))
        })
        if (matching.length) {
          effectivePaycheckAmount = matching.reduce((s, tx) => s + Number(tx.amount), 0)
        }
      }

      const { data: originalInsightRows } = await db
        .from('insights')
        .select('raw_analysis')
        .eq('period_start', period_start)
        .eq('period_end', period_end)
        .eq('period_type', 'biweekly')
        .is('key_findings->label', null)
        .order('generated_at', { ascending: true })
        .limit(1)

      const { data: txs } = await db
        .from('transactions')
        .select('merchant_name, amount, date, category, is_income, is_recurring')
        .gte('date', effectivePeriodStart)
        .lte('date', period_end)
        .order('date', { ascending: false })

      const originalInsight = originalInsightRows?.[0]
      const agg = await getAggregatesForPeriod(effectivePeriodStart, period_end, 'biweekly')
      const [narrative, savingsRec, allocation] = await Promise.all([
        generateNarrativeForRegen(agg, originalInsight?.raw_analysis ?? null, (txs ?? []) as any),
        getSavingsRecommendationForRegen(effectivePaycheckAmount, agg),
        getPaycheckAllocationForRegen(effectivePaycheckAmount, agg),
      ])
      const label = `Regen ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`

      await db.from('insights').insert({
        period_start: effectivePeriodStart,
        period_end,
        period_type: 'biweekly',
        raw_analysis: narrative,
        key_findings: { savings_recommendation: savingsRec, paycheck_allocation: allocation, label },
      })
    })
    return
  }

  const { data: patterns } = await db.from('paycheck_patterns').select('pattern')
  if (!patterns?.length) return reply.code(400).send({ error: 'No paycheck patterns configured' })

  const { data: incomeTxs } = await db
    .from('transactions')
    .select('*')
    .eq('is_income', true)
    .order('date', { ascending: false })
    .limit(200)

  const matching = (incomeTxs ?? []).filter(tx => {
    const name = ((tx.merchant_name as string | null) ?? '').toLowerCase()
    return patterns.some(p => name.includes(p.pattern.toLowerCase()))
  })

  if (!matching.length) return reply.code(404).send({ error: 'No matching paycheck deposits found' })

  // Take the most recent date and sum all same-day matches
  const latestDate = matching[0].date
  const group = matching.filter(tx => tx.date === latestDate)
  const totalAmount = group.reduce((s: number, tx: any) => s + Number(tx.amount), 0)
  const combined = { ...group[0], amount: totalAmount, date: latestDate }

  await reply.send({ ok: true, transaction: { amount: totalAmount, date: latestDate } })

  setImmediate(async () => {
    await handlePaycheckDetected(combined as any)
  })
}
