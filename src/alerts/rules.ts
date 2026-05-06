import { sql } from '../db/client.js'
import type { Transaction } from '../types.js'
import { sendAlert } from './gmail.js'
import { enrichAlertContext } from './enrich.js'

export function isLargePurchase(amount: number): boolean {
  return amount > 200
}

export function isDuplicateCharge(
  merchantName: string,
  amount: number,
  recentTransactions: Array<{ merchant_name: string | null; amount: number; created_at: string }>
): boolean {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  return recentTransactions.some(tx =>
    tx.merchant_name === merchantName &&
    Math.round(Number(tx.amount) * 100) === Math.round(amount * 100) &&
    new Date(tx.created_at).getTime() > cutoff
  )
}

export function isDailySpendExceeded(totalSpend: number): boolean {
  return totalSpend > 300
}

export function getCreditUtilization(balance: number, limit: number): number {
  if (limit === 0) return 0
  return Math.round((balance / limit) * 100)
}

async function getTodaySpend(excludeTransactionId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const rows = await sql<Array<{ amount: number }>>`
    SELECT amount FROM transactions
    WHERE date = ${today} AND is_income = false AND plaid_transaction_id <> ${excludeTransactionId}
  `
  return rows.reduce((sum, tx) => sum + Number(tx.amount), 0)
}

async function getRecentTransactionsForMerchant(
  merchantName: string,
  excludeId: string
): Promise<Array<{ merchant_name: string | null; amount: number; created_at: string }>> {
  const rows = await sql<Array<{ merchant_name: string | null; amount: number; created_at: string }>>`
    SELECT merchant_name, amount, created_at FROM transactions
    WHERE merchant_name = ${merchantName} AND plaid_transaction_id <> ${excludeId}
    ORDER BY created_at DESC
    LIMIT 10
  `
  return rows
}

async function getCreditAccountsWithBalances(): Promise<Array<{
  name: string; mask: string | null; balance: number; limit: number; apr: number
}>> {
  const creditAccts = await sql<Array<{ account_id: string; apr: number; credit_limit: number; name: string; mask: string | null }>>`
    SELECT ca.account_id, ca.apr, ca.credit_limit, a.name, a.mask
    FROM credit_accounts ca
    LEFT JOIN accounts a ON a.id = ca.account_id
  `

  const results = []
  for (const ca of creditAccts) {
    const snapshots = await sql<Array<{ balance: number }>>`
      SELECT balance FROM balance_snapshots
      WHERE account_id = ${ca.account_id}
      ORDER BY snapshot_at DESC
      LIMIT 1
    `

    const balance = Number(snapshots[0]?.balance ?? 0)
    results.push({ name: ca.name, mask: ca.mask, balance, limit: Number(ca.credit_limit), apr: Number(ca.apr) })
  }
  return results
}

export async function checkAlertsForTransaction(tx: Transaction): Promise<void> {
  if (tx.is_income) return

  const merchant = tx.merchant_name ?? 'Unknown'

  if (isLargePurchase(tx.amount)) {
    await sendAlert({
      type: 'large_purchase',
      data: { merchant, amount: tx.amount, date: tx.date },
    })
  }

  const recent = await getRecentTransactionsForMerchant(merchant, tx.plaid_transaction_id)
  if (isDuplicateCharge(merchant, tx.amount, recent)) {
    await sendAlert({
      type: 'duplicate_charge',
      data: { merchant, amount: tx.amount },
    })
  }

  if (tx.is_recurring) {
    const [existing] = await sql<Array<{ first_seen: string }>>`
      SELECT first_seen FROM recurring_charges
      WHERE merchant_name = ${merchant}
      LIMIT 1
    `
    if (existing?.first_seen === tx.date) {
      await sendAlert({
        type: 'new_subscription',
        data: { merchant, amount: tx.amount },
      })
    }
  }

  if (tx.category === 'Credit Payment') {
    await sendAlert({
      type: 'payment_posted',
      data: { merchant, amount: tx.amount },
    })
  }

  const todaySpend = await getTodaySpend(tx.plaid_transaction_id) + tx.amount
  if (isDailySpendExceeded(todaySpend)) {
    const enriched = await enrichAlertContext('daily_spend_exceeded', { totalSpend: todaySpend })
    await sendAlert({
      type: 'daily_spend_exceeded',
      data: { totalSpend: todaySpend },
      enrichedContext: enriched,
    })
  }

  const creditAccounts = await getCreditAccountsWithBalances()
  for (const card of creditAccounts) {
    const util = getCreditUtilization(card.balance, card.limit)
    if (util >= 50) {
      const enriched = await enrichAlertContext('credit_50_percent', { card, utilization: util })
      await sendAlert({ type: 'credit_50_percent', data: { card: card.name, utilization: util }, enrichedContext: enriched })
    } else if (util >= 30) {
      const enriched = await enrichAlertContext('credit_30_percent', { card, utilization: util })
      await sendAlert({ type: 'credit_30_percent', data: { card: card.name, utilization: util }, enrichedContext: enriched })
    }
  }
}
