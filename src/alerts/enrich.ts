import { anthropic } from '../categorize/claude.js'
import { sql } from '../db/client.js'

export async function enrichAlertContext(
  alertType: string,
  data: Record<string, unknown>
): Promise<string> {
  try {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const sinceStr = since.toISOString().split('T')[0]

    const recentTx = await sql<Array<{ category: string | null; amount: number; date: string; merchant_name: string | null }>>`
      SELECT category, amount, date, merchant_name
      FROM transactions
      WHERE date >= ${sinceStr} AND is_income = false
      ORDER BY date DESC
    `

    const categoryTotals: Record<string, number> = {}
    for (const tx of recentTx) {
      const cat = tx.category ?? 'Other'
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + Number(tx.amount)
    }

    const prompt = `You are a personal finance advisor. Write 2-4 sentences of specific, actionable context for this alert.

Alert type: ${alertType}
Alert data: ${JSON.stringify(data)}

Spending summary (last 30 days by category):
${Object.entries(categoryTotals).map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`).join('\n')}

Be specific and practical. Reference actual numbers from the data. No preamble or sign-off.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })

    return message.content[0].type === 'text' ? message.content[0].text : ''
  } catch {
    return ''
  }
}
