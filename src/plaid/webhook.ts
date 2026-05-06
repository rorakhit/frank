import type { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'
import { createHash } from 'crypto'
import { plaidClient } from './client.js'
import { db } from '../db/client.js'
import { syncTransactions } from './sync.js'
import { checkAlertsForTransaction } from '../alerts/rules.js'
import { handlePaycheckDetected } from '../reports/generate.js'

interface RawBody {
  _raw: Buffer
  _parsed: Record<string, unknown>
}

async function verifyPlaidSignature(token: string, rawBody: Buffer): Promise<boolean> {
  try {
    const header = jose.decodeProtectedHeader(token)
    if (!header.kid) return false
    const keyResponse = await plaidClient.webhookVerificationKeyGet({ key_id: header.kid })
    const jwk = await jose.importJWK(keyResponse.data.key as jose.JWK)
    const { payload } = await jose.compactVerify(token, jwk)
    const claims = JSON.parse(new TextDecoder().decode(payload)) as { request_body_sha256: string }
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    return claims.request_body_sha256 === bodyHash
  } catch {
    return false
  }
}

async function getPlaidItemByPlaidId(plaidItemId: string): Promise<string | null> {
  const { data } = await db
    .from('plaid_items')
    .select('id')
    .eq('plaid_item_id', plaidItemId)
    .single()
  return data?.id ?? null
}

export async function webhookHandler(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers['plaid-verification-token'] as string | undefined
  const body = req.body as RawBody

  if (!token) return reply.code(401).send({ error: 'Missing verification token' })

  const valid = await verifyPlaidSignature(token, body._raw)
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

        // Fetch recent transactions across all accounts belonging to this item
        const { data: itemAccounts } = await db
          .from('accounts')
          .select('id')
          .eq('plaid_item_id', itemId)

        const accountIds = (itemAccounts ?? []).map(a => a.id)
        if (!accountIds.length) return

        const { data: recentTx } = await db
          .from('transactions')
          .select('*')
          .in('account_id', accountIds)
          .order('created_at', { ascending: false })
          .limit(stats.added + stats.modified)

        for (const tx of recentTx ?? []) {
          await checkAlertsForTransaction(tx)
        }

        // Fire paycheck report only from the designated paycheck account, at most once per 5 days
        const { data: paycheckAccounts } = await db
          .from('accounts')
          .select('id')
          .eq('is_paycheck_account', true)

        const paycheckAccountIds = new Set((paycheckAccounts ?? []).map(a => a.id))

        const paycheckDeposit = (recentTx ?? []).find(
          tx => tx.is_income && Number(tx.amount) >= 500 && paycheckAccountIds.has(tx.account_id)
        )

        if (paycheckDeposit) {
          const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
          const { data: recentReport } = await db
            .from('savings_events')
            .select('id')
            .gte('created_at', fiveDaysAgo)
            .limit(1)
            .single()

          if (!recentReport) {
            await handlePaycheckDetected(paycheckDeposit)
          }
        }
      }
    } catch (err) {
      req.log.error(err, 'Webhook processing error')
    }
  })
}
