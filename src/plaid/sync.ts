import { plaidClient } from './client.js'
import { sql } from '../db/client.js'
import { categorizeTransaction } from '../categorize/categorize.js'
import type { Transaction } from 'plaid'

async function getAccountId(plaidAccountId: string): Promise<string | null> {
  const [data] = await sql<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE plaid_account_id = ${plaidAccountId} LIMIT 1
  `
  return data?.id ?? null
}

async function matchRule(rawName: string, amount: number, date: string): Promise<string | null> {
  const rules = await sql<Array<{
    match_name_contains: string | null
    match_amount_min: number | null
    match_amount_max: number | null
    match_day_of_week: number | null
    category: string
  }>>`
    SELECT * FROM categorization_rules ORDER BY priority DESC
  `

  for (const rule of rules) {
    if (rule.match_name_contains && !rawName.toLowerCase().includes(rule.match_name_contains.toLowerCase())) continue
    if (rule.match_amount_min !== null && amount < rule.match_amount_min) continue
    if (rule.match_amount_max !== null && amount > rule.match_amount_max) continue
    if (rule.match_day_of_week !== null && new Date(date + 'T12:00:00').getDay() !== rule.match_day_of_week) continue
    return rule.category
  }
  return null
}

async function storeTransaction(tx: Transaction, accountId: string): Promise<void> {
  const merchantName = tx.merchant_name ?? tx.name ?? 'Unknown'
  const rawName = tx.name ?? merchantName
  const amount = Math.abs(tx.amount)
  const isIncome = tx.amount < 0  // Plaid: negative = money in

  let category: string | null = null
  let confidence: number | null = null
  let flagged = false

  if (!isIncome) {
    const ruleMatch = await matchRule(rawName, amount, tx.date)
    if (ruleMatch) {
      category = ruleMatch
      confidence = 100
      flagged = false
    } else {
      const result = await categorizeTransaction(merchantName, amount, tx.date)
      category = result.category
      confidence = result.confidence
      flagged = result.confidence < 80
    }
  } else {
    category = 'Income'
    confidence = 100
  }

  const rawJson = JSON.stringify(tx)

  await sql`
    INSERT INTO transactions (
      plaid_transaction_id, account_id, amount, merchant_name, date,
      category, category_confidence, is_income, flagged_for_review, raw_plaid_data
    ) VALUES (
      ${tx.transaction_id}, ${accountId}, ${amount}, ${merchantName}, ${tx.date},
      ${category}, ${confidence}, ${isIncome}, ${flagged}, ${rawJson}::jsonb
    )
    ON CONFLICT (plaid_transaction_id) DO UPDATE SET
      account_id = EXCLUDED.account_id,
      amount = EXCLUDED.amount,
      merchant_name = EXCLUDED.merchant_name,
      date = EXCLUDED.date,
      category = EXCLUDED.category,
      category_confidence = EXCLUDED.category_confidence,
      is_income = EXCLUDED.is_income,
      flagged_for_review = EXCLUDED.flagged_for_review,
      raw_plaid_data = EXCLUDED.raw_plaid_data
  `
}

export async function syncTransactions(plaidItemId: string): Promise<{ added: number; modified: number; removed: number }> {
  const [item] = await sql<Array<{ id: string; access_token: string; cursor: string | null }>>`
    SELECT * FROM plaid_items WHERE id = ${plaidItemId} LIMIT 1
  `

  if (!item) throw new Error(`plaid_item not found: ${plaidItemId}`)

  let cursor: string | undefined = item.cursor ?? undefined
  let hasMore = true
  let added = 0, modified = 0, removed = 0

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: item.access_token,
      cursor,
      count: 500,
    })

    const { added: newTx, modified: modTx, removed: remTx, next_cursor, has_more } = response.data

    for (const tx of newTx) {
      const accountId = await getAccountId(tx.account_id)
      if (!accountId) continue
      await storeTransaction(tx, accountId)
      added++
    }

    for (const tx of modTx) {
      const accountId = await getAccountId(tx.account_id)
      if (!accountId) continue
      await storeTransaction(tx, accountId)
      modified++
    }

    for (const tx of remTx) {
      await sql`DELETE FROM transactions WHERE plaid_transaction_id = ${tx.transaction_id}`
      removed++
    }

    cursor = next_cursor
    hasMore = has_more
  }

  await sql`UPDATE plaid_items SET cursor = ${cursor ?? null} WHERE id = ${plaidItemId}`

  await snapshotBalances(item.access_token)

  return { added, modified, removed }
}

async function snapshotBalances(accessToken: string): Promise<void> {
  try {
    const response = await plaidClient.accountsGet({ access_token: accessToken })

    for (const plaidAcct of response.data.accounts) {
      const [acct] = await sql<Array<{ id: string }>>`
        SELECT id FROM accounts WHERE plaid_account_id = ${plaidAcct.account_id} LIMIT 1
      `

      if (!acct) continue

      // For loans and credit: current balance = amount owed
      // For depository: current balance = funds available
      const balance = plaidAcct.balances.current ?? plaidAcct.balances.available ?? 0
      await sql`
        INSERT INTO balance_snapshots (account_id, balance)
        VALUES (${acct.id}, ${Math.abs(balance)})
      `
    }
  } catch (err) {
    console.error('Balance snapshot failed:', err)
  }
}
