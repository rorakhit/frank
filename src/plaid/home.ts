import type { FastifyRequest, FastifyReply } from 'fastify'
import { sql } from '../db/client.js'
import { checkAuth } from '../auth.js'

export async function homeStatsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString()
  const thirtyDaysAgoDate = thirtyDaysAgo.toISOString().split('T')[0]

  const [accounts, allSnapshots, oldSnapshots, recentTxns, pendingReviewsRow] = await Promise.all([
    sql<Array<{ id: string; type: string; subtype: string | null }>>`
      SELECT id, type, subtype FROM accounts
    `,
    sql<Array<{ account_id: string; balance: number; snapshot_at: string }>>`
      SELECT account_id, balance, snapshot_at FROM balance_snapshots
      ORDER BY snapshot_at DESC
      LIMIT 500
    `,
    sql<Array<{ account_id: string; balance: number; snapshot_at: string }>>`
      SELECT account_id, balance, snapshot_at FROM balance_snapshots
      WHERE snapshot_at <= ${thirtyDaysAgoIso}
      ORDER BY snapshot_at ASC
      LIMIT 500
    `,
    sql<Array<{ amount: number; is_income: boolean }>>`
      SELECT amount, is_income FROM transactions
      WHERE date >= ${thirtyDaysAgoDate}
    `,
    sql<Array<{ count: string }>>`
      SELECT COUNT(*) as count FROM transactions
      WHERE flagged_for_review = true
    `,
  ])

  const pendingReviews = Number(pendingReviewsRow[0]?.count ?? 0)

  // Latest snapshot per account
  const latestByAccount = new Map<string, number>()
  for (const s of allSnapshots) {
    if (!latestByAccount.has(s.account_id)) {
      latestByAccount.set(s.account_id, Number(s.balance))
    }
  }

  // Oldest available snapshot per account (for delta)
  const oldByAccount = new Map<string, number>()
  for (const s of oldSnapshots) {
    if (!oldByAccount.has(s.account_id)) {
      oldByAccount.set(s.account_id, Number(s.balance))
    }
  }

  const acctList = accounts
  const depositoryIds = new Set(acctList.filter(a => a.type === 'depository').map(a => a.id))
  const creditIds = new Set(acctList.filter(a => a.type === 'credit').map(a => a.id))
  const loanIds = new Set(acctList.filter(a => a.type === 'loan' && a.subtype !== 'mortgage').map(a => a.id))

  const sum = (ids: Set<string>, map: Map<string, number>) =>
    [...ids].reduce((t, id) => t + (map.get(id) ?? 0), 0)

  const depositoryNow = sum(depositoryIds, latestByAccount)
  const ccNow = sum(creditIds, latestByAccount)
  const loanNow = sum(loanIds, latestByAccount)
  const netWorth = depositoryNow - ccNow - loanNow

  const depositoryThen = sum(depositoryIds, oldByAccount)
  const ccThen = sum(creditIds, oldByAccount)
  const loanThen = sum(loanIds, oldByAccount)
  const netWorthThen = depositoryThen - ccThen - loanThen
  const netWorthDelta = oldByAccount.size > 0 ? netWorth - netWorthThen : 0

  const ccCardCount = [...creditIds].filter(id => latestByAccount.has(id)).length
  const totalDebt = ccNow + loanNow

  const txns = recentTxns
  const income = txns.filter(t => t.is_income).reduce((s, t) => s + Number(t.amount), 0)
  const expenses = txns.filter(t => !t.is_income).reduce((s, t) => s + Number(t.amount), 0)
  const savingsThisMonth = income - expenses

  await reply.send({
    netWorth: Math.round(netWorth * 100) / 100,
    netWorthDelta: Math.round(netWorthDelta * 100) / 100,
    ccBalance: Math.round(ccNow * 100) / 100,
    ccCardCount,
    totalDebt: Math.round(totalDebt * 100) / 100,
    savingsThisMonth: Math.round(savingsThisMonth * 100) / 100,
    pendingReviews,
  })
}
