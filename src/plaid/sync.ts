import { plaidClient } from './client.js'
import { db } from '../db/client.js'
import { categorizeTransaction } from '../categorize/categorize.js'
import { writeFlaggedTransactions, writeRecentTransactions } from '../reports/notion.js'
import type { Transaction } from 'plaid'

async function getAccountId(plaidAccountId: string): Promise<string | null> {
  const { data } = await db
    .from('accounts')
    .select('id')
    .eq('plaid_account_id', plaidAccountId)
    .single()
  return data?.id ?? null
}

async function matchRule(rawName: string, amount: number, date: string): Promise<string | null> {
  const { data: rules } = await db
    .from('categorization_rules')
    .select('*')
    .order('priority', { ascending: false })

  for (const rule of rules ?? []) {
    if (rule.match_name_contains && !rawName.toLowerCase().includes(rule.match_name_contains.toLowerCase())) continue
    if (rule.match_amount_min !== null && amount < rule.match_amount_min) continue
    if (rule.match_amount_max !== null && amount > rule.match_amount_max) continue
    if (rule.match_day_of_week !== null && new Date(date + 'T12:00:00').getDay() !== rule.match_day_of_week) continue
    return rule.category as string
  }
  return null
}

async function storeTransaction(tx: Transaction, accountId: string): Promise<void> {
  const merchantName = tx.merchant_name ?? tx.name ?? 'Unknown'
  const rawName = tx.name ?? merchantName
  const amount = Math.abs(tx.amount)
  const isIncome = tx.amount < 0  // Plaid: negative = money in

  let category = null
  let confidence = null
  let isRecurring = false
  let flagged = false

  if (!isIncome) {
    const ruleMatch = await matchRule(rawName, amount, tx.date)
    if (ruleMatch) {
      category = ruleMatch
      confidence = 100
      isRecurring = false
      flagged = false
    } else {
      const result = await categorizeTransaction(merchantName, amount, tx.date)
      category = result.category
      confidence = result.confidence
      isRecurring = result.is_recurring
      flagged = result.confidence < 80
    }
  } else {
    category = 'Income'
    confidence = 100
  }

  const { error } = await db.from('transactions').upsert({
    plaid_transaction_id: tx.transaction_id,
    account_id: accountId,
    amount,
    merchant_name: merchantName,
    date: tx.date,
    category,
    category_confidence: confidence,
    is_recurring: isRecurring,
    is_income: isIncome,
    flagged_for_review: flagged,
    raw_plaid_data: tx as unknown as Record<string, unknown>,
  }, { onConflict: 'plaid_transaction_id' })

  if (error) throw error


  if (isRecurring && merchantName) {
    await db.from('recurring_charges').upsert({
      merchant_name: merchantName,
      average_amount: amount,
      last_seen: tx.date,
    }, { onConflict: 'merchant_name' })
  }
}

export async function syncTransactions(plaidItemId: string): Promise<{ added: number; modified: number; removed: number }> {
  const { data: item, error } = await db
    .from('plaid_items')
    .select('*')
    .eq('id', plaidItemId)
    .single()

  if (error || !item) throw new Error(`plaid_item not found: ${plaidItemId}`)

  let cursor = item.cursor ?? undefined
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
      await db.from('transactions').delete().eq('plaid_transaction_id', tx.transaction_id)
      removed++
    }

    cursor = next_cursor
    hasMore = has_more
  }

  await db.from('plaid_items').update({ cursor }).eq('id', plaidItemId)

  await snapshotBalances(item.access_token)

  await Promise.all([
    writeFlaggedTransactions().catch(console.error),
    writeRecentTransactions().catch(console.error),
  ])

  return { added, modified, removed }
}

async function snapshotBalances(accessToken: string): Promise<void> {
  try {
    const response = await plaidClient.accountsGet({ access_token: accessToken })
    const snapshots = []

    for (const plaidAcct of response.data.accounts) {
      const { data: acct } = await db
        .from('accounts')
        .select('id')
        .eq('plaid_account_id', plaidAcct.account_id)
        .single()

      if (!acct) continue

      // For loans and credit: current balance = amount owed
      // For depository: current balance = funds available
      const balance = plaidAcct.balances.current ?? plaidAcct.balances.available ?? 0
      snapshots.push({ account_id: acct.id, balance: Math.abs(balance) })
    }

    if (snapshots.length > 0) {
      await db.from('balance_snapshots').insert(snapshots)
    }
  } catch (err) {
    console.error('Balance snapshot failed:', err)
  }
}
