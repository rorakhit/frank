import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
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
