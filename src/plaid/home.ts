import type { FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../db/client.js'
import { checkAuth } from '../auth.js'

export async function homeStatsHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!checkAuth(req, reply)) return

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const thirtyDaysAgoDate = thirtyDaysAgo.toISOString().split('T')[0]

  const [
    { data: accounts },
    { data: allSnapshots },
    { data: oldSnapshots },
    { data: recentTxns },
    { count: pendingReviews },
  ] = await Promise.all([
    db.from('accounts').select('id, type, subtype'),
    db.from('balance_snapshots')
      .select('account_id, balance, snapshot_at')
      .order('snapshot_at', { ascending: false })
      .limit(500),
    db.from('balance_snapshots')
      .select('account_id, balance, snapshot_at')
      .lte('snapshot_at', thirtyDaysAgo.toISOString())
      .order('snapshot_at', { ascending: true })
      .limit(500),
    db.from('transactions')
      .select('amount, is_income')
      .gte('date', thirtyDaysAgoDate),
    db.from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('flagged_for_review', true),
  ])

  // Latest snapshot per account
  const latestByAccount = new Map<string, number>()
  for (const s of allSnapshots ?? []) {
    if (!latestByAccount.has(s.account_id)) {
      latestByAccount.set(s.account_id, Number(s.balance))
    }
  }

  // Oldest available snapshot per account (for delta)
  const oldByAccount = new Map<string, number>()
  for (const s of oldSnapshots ?? []) {
    if (!oldByAccount.has(s.account_id)) {
      oldByAccount.set(s.account_id, Number(s.balance))
    }
  }

  const acctList = accounts ?? []
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

  const txns = recentTxns ?? []
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
    pendingReviews: pendingReviews ?? 0,
  })
}
