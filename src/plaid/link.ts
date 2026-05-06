import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { plaidClient } from './client.js'
import { sql } from '../db/client.js'
import { syncTransactions } from './sync.js'
import { runPaycheckCheckForTransactions } from './webhook.js'
import { CountryCode, Products } from 'plaid'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

type PlaidErrorCode = string | null | undefined

const __dirname = dirname(fileURLToPath(import.meta.url))

async function createLinkToken() {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: 'ro' },
    client_name: 'GhostPaper',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL!,
    ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
  })
  return response.data.link_token
}

export async function linkHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const token = await createLinkToken()
  const html = readFileSync(join(__dirname, '../../public/link.html'), 'utf8')
    .replace('__LINK_TOKEN__', token)
  await reply.type('text/html').send(html)
}

export async function linkTokenHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const link_token = await createLinkToken()
  await reply.send({ link_token })
}

export async function linkedAccountsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const itemRows = await sql<Array<{ id: string; institution_name: string }>>`
    SELECT id, institution_name FROM plaid_items
    ORDER BY created_at ASC
  `

  // Fetch accounts for all items
  const itemIds = itemRows.map(i => i.id)
  const accountRows = itemIds.length > 0
    ? await sql<Array<{ plaid_item_id: string; name: string; type: string; subtype: string | null; mask: string | null }>>`
        SELECT plaid_item_id, name, type, subtype, mask FROM accounts
        WHERE plaid_item_id = ANY(${itemIds})
      `
    : []

  const accountsByItem: Record<string, unknown[]> = {}
  for (const a of accountRows) {
    if (!accountsByItem[a.plaid_item_id]) accountsByItem[a.plaid_item_id] = []
    accountsByItem[a.plaid_item_id].push({ name: a.name, type: a.type, subtype: a.subtype, mask: a.mask })
  }

  // Group multiple items at the same institution into one entry
  const grouped: Record<string, { institution_name: string; accounts: unknown[] }> = {}
  for (const item of itemRows) {
    if (!grouped[item.institution_name]) {
      grouped[item.institution_name] = { institution_name: item.institution_name, accounts: [] }
    }
    grouped[item.institution_name].accounts.push(...(accountsByItem[item.id] ?? []))
  }

  await reply.send(Object.values(grouped))
}

export async function repairWebhooksHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const webhookUrl = process.env.PLAID_WEBHOOK_URL
  if (!webhookUrl) return reply.code(400).send({ error: 'PLAID_WEBHOOK_URL not set' })

  const items = await sql<Array<{ id: string; plaid_item_id: string; access_token: string; institution_name: string }>>`
    SELECT id, plaid_item_id, access_token, institution_name FROM plaid_items
  `
  if (!items.length) return reply.send({ updated: [] })

  const results = await Promise.all(items.map(async item => {
    try {
      await plaidClient.itemWebhookUpdate({ access_token: item.access_token, webhook: webhookUrl })
      return { institution: item.institution_name, ok: true }
    } catch (err: any) {
      return { institution: item.institution_name, ok: false, error: err?.message }
    }
  }))

  await reply.send({ updated: results })
}

export async function syncAllHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const items = await sql<Array<{ id: string; institution_name: string }>>`
    SELECT id, institution_name FROM plaid_items
  `
  if (!items.length) return reply.send({ results: [] })

  await reply.send({ started: items.map(i => i.institution_name) })

  setImmediate(async () => {
    for (const item of items) {
      try {
        const stats = await syncTransactions(item.id)
        console.log(`Sync complete for ${item.institution_name}:`, stats)

        if (stats.added + stats.modified > 0) {
          const acctRows = await sql<Array<{ id: string }>>`
            SELECT id FROM accounts WHERE plaid_item_id = ${item.id}
          `
          const accountIds = acctRows.map(a => a.id)
          const recentTx = accountIds.length > 0
            ? await sql<Array<any>>`
                SELECT * FROM transactions
                WHERE account_id = ANY(${accountIds})
                ORDER BY created_at DESC
                LIMIT ${stats.added + stats.modified}
              `
            : []

          await runPaycheckCheckForTransactions(recentTx).catch(err =>
            console.error(`Paycheck check failed for ${item.institution_name}:`, err)
          )
        }
      } catch (err) {
        console.error(`Sync failed for ${item.institution_name}:`, err)
      }
    }
  })
}

export async function linkExchangeHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { public_token, institution_id, institution_name, accounts } =
    ((req.body as any)._parsed ?? req.body) as {
      public_token: string
      institution_id: string
      institution_name: string
      accounts: Array<{ id: string; name: string; type: string; subtype: string; mask: string }>
    }

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token })
  const { access_token, item_id } = exchangeResponse.data

  let item: { id: string }
  try {
    const [created] = await sql<Array<{ id: string }>>`
      INSERT INTO plaid_items (plaid_item_id, access_token, institution_id, institution_name)
      VALUES (${item_id}, ${access_token}, ${institution_id}, ${institution_name})
      RETURNING id
    `
    item = created
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }

  for (const acct of accounts) {
    // Skip if an account with the same mask + type already exists at this institution
    // (prevents duplicates when the same card appears under a second linked item)
    if (acct.mask) {
      const existing = await sql<Array<{ id: string }>>`
        SELECT id FROM accounts
        WHERE mask = ${acct.mask}
          AND type = ${acct.type}
          AND plaid_account_id <> ${acct.id}
        LIMIT 1
      `
      if (existing.length) continue
    }

    await sql`
      INSERT INTO accounts (plaid_item_id, plaid_account_id, name, type, subtype, mask)
      VALUES (${item.id}, ${acct.id}, ${acct.name}, ${acct.type}, ${acct.subtype}, ${acct.mask})
      ON CONFLICT (plaid_account_id) DO UPDATE SET
        plaid_item_id = EXCLUDED.plaid_item_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        mask = EXCLUDED.mask
    `
  }

  setImmediate(() => syncTransactions(item.id).catch(console.error))

  await reply.send({ ok: true, institution: institution_name, accounts: accounts.length })
}

export async function setupGetHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return

  const [creditAccounts, existingAprs] = await Promise.all([
    sql<Array<{ id: string; name: string; mask: string | null }>>`
      SELECT id, name, mask FROM accounts WHERE type = 'credit'
    `,
    sql<Array<{ account_id: string; apr: number; credit_limit: number }>>`
      SELECT account_id, apr, credit_limit FROM credit_accounts
    `,
  ])

  const aprMap = Object.fromEntries(existingAprs.map(r => [r.account_id, r]))
  const accounts = creditAccounts.map(a => ({ ...a, ...aprMap[a.id] }))

  const html = readFileSync(join(__dirname, '../../public/setup.html'), 'utf8')
    .replace('__ACCOUNTS_JSON__', JSON.stringify(accounts))

  await reply.type('text/html').send(html)
}

export async function oauthReturnHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/oauth-return.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function setupPostHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return

  const body = req.body as Record<string, string>

  const creditAccounts = Object.keys(body)
    .filter(k => k.startsWith('apr_'))
    .map(k => {
      const accountId = k.replace('apr_', '')
      return {
        account_id: accountId,
        apr: parseFloat(body[k]),
        credit_limit: parseFloat(body[`limit_${accountId}`] ?? '0'),
      }
    })
    .filter(ca => !isNaN(ca.apr) && ca.apr > 0)

  for (const ca of creditAccounts) {
    await sql`
      INSERT INTO credit_accounts (account_id, apr, credit_limit)
      VALUES (${ca.account_id}, ${ca.apr}, ${ca.credit_limit})
      ON CONFLICT (account_id) DO UPDATE SET
        apr = EXCLUDED.apr,
        credit_limit = EXCLUDED.credit_limit
    `
  }

  if (body['target_type'] && body['target_value']) {
    await sql`
      INSERT INTO savings_goals (target_type, target_value)
      VALUES (${body['target_type']}, ${parseFloat(body['target_value'])})
    `
  }

  await reply.send({ ok: true, message: 'Setup complete' })
}

export async function itemStatusHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const items = await sql<Array<{ id: string; plaid_item_id: string; access_token: string; institution_name: string }>>`
    SELECT id, plaid_item_id, access_token, institution_name FROM plaid_items
    ORDER BY created_at ASC
  `

  if (!items.length) return reply.send([])

  const results = await Promise.all(items.map(async item => {
    try {
      const res = await plaidClient.itemGet({ access_token: item.access_token })
      const error = res.data.item.error as { error_code: PlaidErrorCode } | null
      const errorCode = error?.error_code ?? null
      return {
        id: item.id,
        institution_name: item.institution_name,
        healthy: errorCode === null,
        error_code: errorCode,
        needs_reauth: errorCode === 'ITEM_LOGIN_REQUIRED',
      }
    } catch (err: any) {
      const errorCode: PlaidErrorCode = err?.response?.data?.error_code ?? 'UNKNOWN'
      return {
        id: item.id,
        institution_name: item.institution_name,
        healthy: false,
        error_code: errorCode,
        needs_reauth: errorCode === 'ITEM_LOGIN_REQUIRED',
      }
    }
  }))

  await reply.send(results)
}

export async function reauthTokenHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { item_id } = ((req.body as any)._parsed ?? req.body) as { item_id: string }
  if (!item_id) return reply.code(400).send({ error: 'item_id required' })

  const [item] = await sql<Array<{ access_token: string }>>`
    SELECT access_token FROM plaid_items WHERE id = ${item_id} LIMIT 1
  `

  if (!item) return reply.code(404).send({ error: 'Item not found' })

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: 'ro' },
    client_name: 'GhostPaper',
    country_codes: [CountryCode.Us],
    language: 'en',
    access_token: item.access_token,
    webhook: process.env.PLAID_WEBHOOK_URL!,
    ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
  })

  await reply.send({ link_token: response.data.link_token })
}
