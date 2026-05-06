import { anthropic } from './claude.js'
import { CATEGORIES, type Category, type CategorizationResult } from '../types.js'
import { getAllCategories } from '../db/categories.js'
import { db } from '../db/client.js'

interface HistoryEntry {
  category: string
  amount: number
  date: string
}

interface CategorizationInput {
  merchantName: string
  amount: number
  date: string
  history: HistoryEntry[]
  allCategories: string[]
}

export function buildCategorizationPrompt(input: CategorizationInput): string {
  const { merchantName, amount, date, history, allCategories } = input
  const historyText = history.length > 0
    ? `Previous transactions at this merchant:\n${history.map(h => `  - ${h.date}: $${h.amount} → ${h.category}`).join('\n')}`
    : 'No previous transactions at this merchant.'

  return `Categorize this bank transaction. Return JSON only, no other text.

Transaction:
- Merchant: ${merchantName}
- Amount: $${amount.toFixed(2)}
- Date: ${date}

${historyText}

Valid categories: ${allCategories.join(', ')}

Rules:
- Income: salary, direct deposit, ACH credit from employer
- Savings Transfer: transfer to savings account
- Credit Payment: payment to credit card

Return this exact JSON shape:
{
  "category": "<one of the valid categories>",
  "confidence": <integer 0-100>,
  "is_recurring": <true if this appears monthly/weekly>,
  "reasoning": "<one sentence>"
}`
}

export function parseCategorizationResponse(raw: string): CategorizationResult {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const parsed = JSON.parse(cleaned) as {
      category: string
      confidence: number
      is_recurring: boolean
      reasoning: string
    }
    const category = parsed.category as Category
    return {
      category,
      confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence))),
      is_recurring: Boolean(parsed.is_recurring),
      reasoning: parsed.reasoning ?? '',
    }
  } catch {
    return { category: 'Other', confidence: 0, is_recurring: false, reasoning: 'Parse error' }
  }
}

async function getMerchantHistory(merchantName: string): Promise<HistoryEntry[]> {
  const since = new Date()
  since.setDate(since.getDate() - 90)

  const { data } = await db
    .from('transactions')
    .select('category, amount, date')
    .eq('merchant_name', merchantName)
    .gte('date', since.toISOString().split('T')[0])
    .not('category', 'is', null)
    .order('date', { ascending: false })
    .limit(20)

  return (data ?? []).map(r => ({
    category: r.category as string,
    amount: Number(r.amount),
    date: r.date,
  }))
}

export async function categorizeTransaction(
  merchantName: string,
  amount: number,
  date: string
): Promise<CategorizationResult> {
  const [history, allCategories] = await Promise.all([
    getMerchantHistory(merchantName),
    getAllCategories(),
  ])
  const prompt = buildCategorizationPrompt({ merchantName, amount, date, history, allCategories })

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  return parseCategorizationResponse(raw)
}
