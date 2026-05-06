import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { sql } from '../db/client.js'
import { getAllCategories } from '../db/categories.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function rulesPageHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuthPage(req, reply)) return
  const html = readFileSync(join(__dirname, '../../public/rules.html'), 'utf8')
  await reply.type('text/html').send(html)
}

export async function listRulesHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const data = await sql`
    SELECT * FROM categorization_rules
    ORDER BY priority DESC, created_at ASC
  `
  await reply.send({ rules: data, categories: await getAllCategories() })
}

export async function createRuleHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const body = ((req.body as any)._parsed ?? req.body) as {
    label: string
    match_name_contains?: string
    match_amount_min?: number
    match_amount_max?: number
    match_day_of_week?: number
    category: string
    priority?: number
  }

  if (!body.label || !body.category) {
    return reply.code(400).send({ error: 'label and category are required' })
  }
  if (!(await getAllCategories()).includes(body.category)) {
    return reply.code(400).send({ error: 'Invalid category' })
  }

  try {
    const [data] = await sql`
      INSERT INTO categorization_rules (
        label, match_name_contains, match_amount_min, match_amount_max,
        match_day_of_week, category, priority
      ) VALUES (
        ${body.label},
        ${body.match_name_contains || null},
        ${body.match_amount_min ?? null},
        ${body.match_amount_max ?? null},
        ${body.match_day_of_week ?? null},
        ${body.category},
        ${body.priority ?? 0}
      )
      RETURNING *
    `
    await reply.send({ ok: true, rule: data })
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
}

export async function deleteRuleHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  try {
    await sql`DELETE FROM categorization_rules WHERE id = ${id}`
  } catch (e: any) {
    return reply.code(500).send({ error: e.message })
  }
  await reply.send({ ok: true })
}
