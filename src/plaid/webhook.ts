import type { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'
import { createHash } from 'crypto'
import { plaidClient } from './client.js'
import { sql } from '../db/client.js'
import { syncTransactions } from './sync.js'
import { checkAlertsForTransaction } from '../alerts/rules.js'
import { handlePaycheckDetected } from '../reports/generate.js'

interface RawBody {
  _raw: Buffer
  _parsed: Record<string, unknown>
}

async function verifyPlaidSignature(token: string, rawBody: Buffer, log: FastifyRequest['log']): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(token)
    if (!header.kid) {
      log.warn('Plaid webhook: missing kid in JWS header')
      return false
    }
    let keyResponse
    try {
      keyResponse = await plaidClient.webhookVerificationKeyGet({ key_id: header.kid })
    } catch (err: any) {
      log.error({ err, kid: header.kid }, 'Plaid webhook: failed to fetch verification key')
      return false
    }
    let jwk
    try {
      jwk = await jose.importJWK(keyResponse.data.key as jose.JWK)
    } catch (err: any) {
      log.error({ err }, 'Plaid webhook: failed to import JWK')
      return false
    }
    let payload
    try {
      ;({ payload } = await jose.compactVerify(token, jwk))
    } catch (err: any) {
      log.error({ err }, 'Plaid webhook: JWS compactVerify failed')
      return false
    }
    const claims = JSON.parse(new TextDecoder().decode(payload)) as { request_body_sha256: string }
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    if (claims.request_body_sha256 !== bodyHash) {
      log.error({ expected: claims.request_body_sha256, got: bodyHash }, 'Plaid webhook: body hash mismatch')
      return false
    }
    return true
  } catch (err: any) {
    log.error({ err }, 'Plaid webhook: unexpected verification error')
    return false
  }
}

async function getPlaidItemByPlaidId(plaidItemId: string): Promise<string | null> {
  const [data] = await sql<Array<{ id: string }>>`
    SELECT id FROM plaid_items WHERE plaid_item_id = ${plaidItemId} LIMIT 1
  `
  return data?.id ?? null
}

async function getAccountIdsForItem(itemId: string): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE plaid_item_id = ${itemId}
  `
  return rows.map(a => a.id)
}

export async function runPaycheckCheckForTransactions(txs: Record<string, unknown>[]): Promise<void> {
  if (!txs.length) return

  const patterns = await sql<Array<{ pattern: string }>>`SELECT pattern FROM paycheck_patterns`
  if (!patterns.length) return

  const matchingDeposits = txs.filter(tx => {
    if (!tx['is_income']) return false
    const name = ((tx['merchant_name'] as string) ?? '').toLowerCase()
    return patterns.some(p => name.includes(p.pattern.toLowerCase()))
  })

  if (!matchingDeposits.length) return

  // Group by date — same-day matches from split direct deposit = one paycheck
  const byDate: Record<string, Record<string, unknown>[]> = {}
  for (const tx of matchingDeposits) {
    const date = tx['date'] as string
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(tx)
  }

  const latestDate = Object.keys(byDate).sort().at(-1)!
  const group = byDate[latestDate]
  const totalAmount = group.reduce((s, tx) => s + Number(tx['amount']), 0)

  // Skip if we already processed a paycheck for this exact deposit date
  const existingForDate = await sql<Array<{ id: string }>>`
    SELECT id FROM savings_events
    WHERE period_end = ${latestDate}
    LIMIT 1
  `

  if (!existingForDate.length) {
    // Use first tx as representative but override amount with combined total
    await handlePaycheckDetected({ ...(group[0] as any), amount: totalAmount, date: latestDate })
  }
}

export async function checkWebhookHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const res = await plaidClient.webhookVerificationKeyGet({ key_id: 'health-check-probe' })
    // If we get any response (even a key-not-found), the API is reachable
    return { healthy: true }
  } catch (err: any) {
    const code = err?.response?.data?.error_code
    // INVALID_INPUT means the API is up but the key_id didn't exist — that's fine
    if (code === 'INVALID_INPUT' || code === 'INVALID_FIELD') return { healthy: true }
    return { healthy: false, error: code ?? err?.message ?? 'unknown' }
  }
}

export async function webhookHandler(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['plaid-verification-token'] as string | undefined
  const body = req.body as RawBody

  if (!token) {
    req.log.warn('Plaid webhook: missing plaid-verification-token header')
    return reply.code(401).send({ error: 'Missing verification token' })
  }

  const valid = await verifyPlaidSignature(token, body._raw, req.log)
  if (!valid) return reply.code(401).send({ error: 'Invalid webhook signature' })

  const event = body._parsed
  const webhookType = event['webhook_type'] as string
  const webhookCode = event['webhook_code'] as string
  const plaidItemId = event['item_id'] as string

  req.log.info({ webhookType, webhookCode }, 'Plaid webhook received')

  await reply.send({ ok: true })  // Acknowledge immediately

  // Process asynchronously after reply
  setImmediate(async () => {
    try {
      if (webhookType === 'TRANSACTIONS' && webhookCode === 'SYNC_UPDATES_AVAILABLE') {
        const itemId = await getPlaidItemByPlaidId(plaidItemId)
        if (!itemId) return

        const stats = await syncTransactions(itemId)
        req.log.info(stats, 'Transaction sync complete')

        if (stats.added + stats.modified === 0) return

        const accountIds = await getAccountIdsForItem(itemId)
        if (!accountIds.length) return

        const recentTx = await sql<Array<any>>`
          SELECT * FROM transactions
          WHERE account_id = ANY(${accountIds})
          ORDER BY created_at DESC
          LIMIT ${stats.added + stats.modified}
        `

        for (const tx of recentTx) {
          await checkAlertsForTransaction(tx)
        }

        await runPaycheckCheckForTransactions(recentTx)
      }
    } catch (err) {
      req.log.error(err, 'Webhook processing error')
    }
  })
}
