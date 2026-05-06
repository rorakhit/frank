import { checkAuth, checkAuthPage } from '../auth.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
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
  const { data } = await db
    .from('categorization_rules')
    .select('*')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
  await reply.send({ rules: data ?? [], categories: await getAllCategories() })
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

  const { data, error } = await db.from('categorization_rules').insert({
    label: body.label,
    match_name_contains: body.match_name_contains || null,
    match_amount_min: body.match_amount_min ?? null,
    match_amount_max: body.match_amount_max ?? null,
    match_day_of_week: body.match_day_of_week ?? null,
    category: body.category,
    priority: body.priority ?? 0,
  }).select().single()

  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true, rule: data })
}

export async function deleteRuleHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return
  const { id } = req.params as { id: string }
  const { error } = await db.from('categorization_rules').delete().eq('id', id)
  if (error) return reply.code(500).send({ error: error.message })
  await reply.send({ ok: true })
}
