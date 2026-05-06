import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { plaidClient } from './client.js'
import { db } from '../db/client.js'
import { syncTransactions } from './sync.js'
import { writeNotionHomepage } from '../reports/notion.js'
import { CountryCode, Products } from 'plaid'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function createLinkToken() {
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: 'ro' },
    client_name: 'AutoBudget',
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
  const { data: items } = await db
    .from('plaid_items')
    .select('id, institution_name, accounts(name, type, subtype, mask)')
    .order('created_at', { ascending: true })

  // Group multiple items at the same institution into one entry
  const grouped: Record<string, { institution_name: string; accounts: unknown[] }> = {}
  for (const item of items ?? []) {
    if (!grouped[item.institution_name]) {
      grouped[item.institution_name] = { institution_name: item.institution_name, accounts: [] }
    }
    grouped[item.institution_name].accounts.push(...((item.accounts as unknown[]) ?? []))
  }

  await reply.send(Object.values(grouped))
}

export async function repairWebhooksHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const webhookUrl = process.env.PLAID_WEBHOOK_URL
  if (!webhookUrl) return reply.code(400).send({ error: 'PLAID_WEBHOOK_URL not set' })

  const { data: items } = await db.from('plaid_items').select('id, plaid_item_id, access_token, institution_name')
  if (!items?.length) return reply.send({ updated: [] })

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

export async function refreshNotionHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  await reply.send({ started: true })
  setImmediate(async () => {
    const { writeFlaggedTransactions, writeRecentTransactions } = await import('../reports/notion.js')
    await Promise.all([
      writeFlaggedTransactions().catch(console.error),
      writeRecentTransactions().catch(console.error),
    ])
    console.log('Notion pages refreshed')
  })
}

export async function syncAllHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { data: items } = await db.from('plaid_items').select('id, institution_name')
  if (!items?.length) return reply.send({ results: [] })

  await reply.send({ started: items.map(i => i.institution_name) })

  setImmediate(async () => {
    for (const item of items) {
      try {
        const stats = await syncTransactions(item.id)
        console.log(`Sync complete for ${item.institution_name}:`, stats)
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

  const { data: item, error } = await db
    .from('plaid_items')
    .insert({ plaid_item_id: item_id, access_token, institution_id, institution_name })
    .select()
    .single()

  if (error) return reply.code(500).send({ error: error.message })

  for (const acct of accounts) {
    // Skip if an account with the same mask + type already exists at this institution
    // (prevents duplicates when the same card appears under a second linked item)
    if (acct.mask) {
      const { data: existing } = await db
        .from('accounts')
        .select('id')
        .eq('mask', acct.mask)
        .eq('type', acct.type)
        .neq('plaid_account_id', acct.id)
        .limit(1)
      if (existing?.length) continue
    }

    await db.from('accounts').upsert({
      plaid_item_id: item.id,
      plaid_account_id: acct.id,
      name: acct.name,
      type: acct.type,
      subtype: acct.subtype,
      mask: acct.mask,
    }, { onConflict: 'plaid_account_id' })
  }

  setImmediate(() => syncTransactions(item.id).catch(console.error))

  await reply.send({ ok: true, institution: institution_name, accounts: accounts.length })
}

export async function setupGetHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return

  const [{ data: creditAccounts }, { data: existingAprs }] = await Promise.all([
    db.from('accounts').select('id, name, mask').eq('type', 'credit'),
    db.from('credit_accounts').select('account_id, apr, credit_limit'),
  ])

  const aprMap = Object.fromEntries((existingAprs ?? []).map(r => [r.account_id, r]))
  const accounts = (creditAccounts ?? []).map(a => ({ ...a, ...aprMap[a.id] }))

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
    await db.from('credit_accounts').upsert(ca, { onConflict: 'account_id' })
  }

  if (body['target_type'] && body['target_value']) {
    await db.from('savings_goals').insert({
      target_type: body['target_type'],
      target_value: parseFloat(body['target_value']),
    })
  }

  await writeNotionHomepage().catch(() => {})

  await reply.send({ ok: true, message: 'Setup complete' })
}
