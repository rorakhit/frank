import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { getAllCategories } from '../db/categories.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function reviewPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/review.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function reviewTransactionsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { data } = await db
    .from('transactions')
    .select('merchant_name, category, category_confidence, amount, date, is_income, raw_plaid_data')
    .eq('is_income', false)
    .order('date', { ascending: false })

  if (!data) return reply.send([])

  // Group by merchant
  const merchantMap = new Map<string, {
    merchant: string
    category: string
    minConfidence: number
    count: number
    totalAmount: number
    sample: Array<{ amount: number; date: string; rawName: string }>
  }>()

  for (const tx of data) {
    const name = tx.merchant_name ?? 'Unknown'
    const rawName = (tx.raw_plaid_data as any)?.name ?? name
    const existing = merchantMap.get(name)
    if (!existing) {
      merchantMap.set(name, {
        merchant: name,
        category: tx.category ?? 'Other',
        minConfidence: tx.category_confidence ?? 0,
        count: 1,
        totalAmount: Number(tx.amount),
        sample: [{ amount: Number(tx.amount), date: tx.date, rawName }],
      })
    } else {
      existing.count++
      existing.totalAmount += Number(tx.amount)
      if ((tx.category_confidence ?? 0) < existing.minConfidence) {
        existing.minConfidence = tx.category_confidence ?? 0
        existing.category = tx.category ?? 'Other'
      }
      if (existing.sample.length < 3 && !existing.sample.some(s => s.amount === Number(tx.amount))) {
        existing.sample.push({ amount: Number(tx.amount), date: tx.date, rawName })
      }
    }
  }

  const result = Array.from(merchantMap.values())
    .sort((a, b) => a.minConfidence - b.minConfidence || b.count - a.count)

  await reply.send({ merchants: result, categories: await getAllCategories() })
}

export async function reviewCorrectHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { merchant_name, category } =
    ((req.body as any)._parsed ?? req.body) as { merchant_name: string; category: string }

  if (!merchant_name || !category) {
    return reply.code(400).send({ error: 'merchant_name and category required' })
  }

  if (!(await getAllCategories()).includes(category)) {
    return reply.code(400).send({ error: 'Invalid category' })
  }

  const { error, count } = await db
    .from('transactions')
    .update({ category, category_confidence: 100, flagged_for_review: false })
    .eq('merchant_name', merchant_name)

  if (error) return reply.code(500).send({ error: error.message })

  await reply.send({ ok: true, merchant: merchant_name, category, updated: count })
}

export async function merchantTransactionsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { merchant } = req.params as { merchant: string }

  const { data } = await db
    .from('transactions')
    .select('plaid_transaction_id, amount, date, category, category_confidence, raw_plaid_data')
    .eq('merchant_name', merchant)
    .eq('is_income', false)
    .order('date', { ascending: false })
    .limit(100)

  const transactions = (data ?? []).map(tx => ({
    id: tx.plaid_transaction_id,
    amount: Number(tx.amount),
    date: tx.date,
    category: tx.category ?? 'Other',
    confidence: tx.category_confidence ?? 0,
    rawName: (tx.raw_plaid_data as any)?.name ?? merchant,
  }))

  await reply.send({ transactions })
}

export async function correctTransactionHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { plaid_transaction_id, category } =
    ((req.body as any)._parsed ?? req.body) as { plaid_transaction_id: string; category: string }

  if (!plaid_transaction_id || !category) {
    return reply.code(400).send({ error: 'plaid_transaction_id and category are required' })
  }
  if (!(await getAllCategories()).includes(category)) {
    return reply.code(400).send({ error: 'Invalid category' })
  }

  const { error } = await db
    .from('transactions')
    .update({ category, category_confidence: 100, flagged_for_review: false })
    .eq('plaid_transaction_id', plaid_transaction_id)

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function confirmTransactionHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { plaid_transaction_id } =
    ((req.body as any)._parsed ?? req.body) as { plaid_transaction_id: string }

  if (!plaid_transaction_id) return reply.code(400).send({ error: 'plaid_transaction_id required' })

  const { error } = await db
    .from('transactions')
    .update({ category_confidence: 100, flagged_for_review: false })
    .eq('plaid_transaction_id', plaid_transaction_id)

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}

export async function confirmMerchantHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { merchant_name } =
    ((req.body as any)._parsed ?? req.body) as { merchant_name: string }

  if (!merchant_name) return reply.code(400).send({ error: 'merchant_name required' })

  const { error, count } = await db
    .from('transactions')
    .update({ category_confidence: 100, flagged_for_review: false })
    .eq('merchant_name', merchant_name)
    .lt('category_confidence', 100)

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true, confirmed: count })
}
