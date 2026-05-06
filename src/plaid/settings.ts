import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { sql } from '../db/client.js'
import { CATEGORIES } from '../types.js'
import { getAllCategories } from '../db/categories.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function settingsPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/settings.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function settingsDataHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const [accountRows, allCategories, custom, creditAccounts, loanAccounts] = await Promise.all([
    sql<Array<{
      id: string; name: string; display_name: string | null; mask: string | null;
      type: string; subtype: string | null; institution_name: string | null
    }>>`
      SELECT a.id, a.name, a.display_name, a.mask, a.type, a.subtype,
             pi.institution_name
      FROM accounts a
      LEFT JOIN plaid_items pi ON pi.id = a.plaid_item_id
      ORDER BY a.name
    `,
    getAllCategories(),
    sql<Array<{ name: string }>>`SELECT name FROM custom_categories ORDER BY name`,
    sql<Array<{ account_id: string; apr: number; credit_limit: number }>>`
      SELECT account_id, apr, credit_limit FROM credit_accounts
    `,
    sql<Array<{ account_id: string; apr: number | null; original_balance: number | null }>>`
      SELECT account_id, apr, original_balance FROM loan_accounts
    `,
  ])

  // Reshape accounts to nest plaid_items.institution_name (matches old shape: plaid_items: { institution_name })
  const accounts = accountRows.map(a => ({
    id: a.id,
    name: a.name,
    display_name: a.display_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    plaid_items: { institution_name: a.institution_name },
  }))

  const aprMap = Object.fromEntries(creditAccounts.map(r => [r.account_id, r]))
  const loanMap = Object.fromEntries(loanAccounts.map(r => [r.account_id, r]))

  await reply.send({
    accounts,
    categories: allCategories,
    systemCategories: CATEGORIES,
    customCategories: custom.map(r => r.name),
    aprMap,
    loanMap,
  })
}

export async function renameAccountHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { account_id, display_name } =
    ((req.body as any)._parsed ?? req.body) as { account_id: string; display_name: string }

  if (!account_id || !display_name?.trim()) {
    return reply.code(400).send({ error: 'account_id and display_name required' })
  }

  try {
    const trimmed = display_name.trim()
    await sql`
      UPDATE accounts SET display_name = ${trimmed}, name = ${trimmed}
      WHERE id = ${account_id}
    `
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function addCategoryHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { name } = ((req.body as any)._parsed ?? req.body) as { name: string }

  if (!name?.trim()) return reply.code(400).send({ error: 'name required' })

  const trimmed = name.trim()
  if ((CATEGORIES as readonly string[]).includes(trimmed)) {
    return reply.code(400).send({ error: 'Category already exists as a system category' })
  }

  try {
    await sql`INSERT INTO custom_categories (name) VALUES (${trimmed})`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true, name: trimmed })
}

export async function deleteCategoryHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { name } = req.params as { name: string }

  if ((CATEGORIES as readonly string[]).includes(name)) {
    return reply.code(400).send({ error: 'Cannot delete a system category' })
  }

  try {
    await sql`DELETE FROM custom_categories WHERE name = ${name}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function updateLoanHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { account_id, apr, original_balance } =
    ((req.body as any)._parsed ?? req.body) as { account_id: string; apr?: number; original_balance?: number }

  if (!account_id) return reply.code(400).send({ error: 'account_id required' })

  const aprVal = apr != null ? Number(apr) : null
  const obVal = original_balance != null ? Number(original_balance) : null

  try {
    await sql`
      INSERT INTO loan_accounts (account_id, apr, original_balance)
      VALUES (${account_id}, ${aprVal}, ${obVal})
      ON CONFLICT (account_id) DO UPDATE SET
        apr = EXCLUDED.apr,
        original_balance = EXCLUDED.original_balance
    `
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}

export async function updateAprHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const { account_id, apr, credit_limit } =
    ((req.body as any)._parsed ?? req.body) as { account_id: string; apr: number; credit_limit: number }

  if (!account_id || isNaN(Number(apr)) || isNaN(Number(credit_limit))) {
    return reply.code(400).send({ error: 'account_id, apr, and credit_limit required' })
  }

  try {
    await sql`
      INSERT INTO credit_accounts (account_id, apr, credit_limit)
      VALUES (${account_id}, ${Number(apr)}, ${Number(credit_limit)})
      ON CONFLICT (account_id) DO UPDATE SET
        apr = EXCLUDED.apr,
        credit_limit = EXCLUDED.credit_limit
    `
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}
