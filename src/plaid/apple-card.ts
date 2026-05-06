import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APPLE_CARD_PLAID_ID = 'apple-card-manual'

function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0])
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h.trim()] = (cols[i] ?? '').trim() })
    return row
  })
}

function splitCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

async function ensureAppleCardAccount(): Promise<string> {
  const { data: existing } = await db
    .from('accounts')
    .select('id')
    .eq('plaid_account_id', APPLE_CARD_PLAID_ID)
    .single()

  if (existing) return existing.id

  const { data: created, error } = await db
    .from('accounts')
    .insert({
      plaid_account_id: APPLE_CARD_PLAID_ID,
      name: 'Apple Card',
      type: 'credit',
      subtype: 'credit card',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return created!.id
}

export async function appleCardPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/apple-card.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function appleCardStatusHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { data: acct } = await db
    .from('accounts')
    .select('id')
    .eq('plaid_account_id', APPLE_CARD_PLAID_ID)
    .single()

  if (!acct) return reply.send({ exists: false, count: 0 })

  const { count } = await db
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', acct.id)

  await reply.send({ exists: true, count: count ?? 0 })
}

export async function appleCardImportHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { csv } = ((req.body as any)._parsed ?? req.body) as { csv: string }
  if (!csv) return reply.code(400).send({ error: 'csv required' })

  const rows = parseCSV(csv)
  if (!rows.length) return reply.code(400).send({ error: 'No rows found in CSV' })

  const accountId = await ensureAppleCardAccount()

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    const type = row['Type'] ?? ''
    if (type === 'Payment') { skipped++; continue }

    const txDate = row['Transaction Date'] ?? ''
    const description = row['Description'] ?? ''
    const merchant = row['Merchant'] || description
    const category = row['Category'] || null
    const amountRaw = row['Amount (USD)'] ?? ''

    if (!txDate || !amountRaw) { skipped++; continue }

    // Apple Card amounts: negative = purchase (expense), positive = refund/credit
    const amountNum = parseFloat(amountRaw)
    if (isNaN(amountNum)) { skipped++; continue }

    // Normalize date from MM/DD/YYYY to YYYY-MM-DD
    const dateParts = txDate.split('/')
    if (dateParts.length !== 3) { skipped++; continue }
    const isoDate = `${dateParts[2]}-${dateParts[0].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}`

    // Expenses stored as positive amounts, refunds/credits as negative (income)
    const storedAmount = Math.abs(amountNum)
    const isIncome = amountNum > 0

    // Deterministic dedup key
    const dedupKey = `apple-card-${isoDate}-${amountRaw.replace('.', '_')}-${description.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`

    const { error } = await db.from('transactions').insert({
      plaid_transaction_id: dedupKey,
      account_id: accountId,
      amount: storedAmount,
      merchant_name: merchant,
      date: isoDate,
      category,
      is_recurring: false,
      is_income: isIncome,
      flagged_for_review: false,
    })

    if (error) {
      if (error.code === '23505') { skipped++ } // duplicate
      else { errors.push(`${merchant} ${txDate}: ${error.message}`) }
    } else {
      imported++
    }
  }

  // Recompute Apple Card balance from all transactions and snapshot it
  const { data: txns } = await db
    .from('transactions')
    .select('amount, is_income')
    .eq('account_id', accountId)

  if (txns && txns.length > 0) {
    const balance = txns.reduce((sum, t) => sum + (t.is_income ? -Number(t.amount) : Number(t.amount)), 0)
    await db.from('balance_snapshots').insert({ account_id: accountId, balance: Math.max(0, balance) })
  }

  await reply.send({ imported, skipped, errors })
}
