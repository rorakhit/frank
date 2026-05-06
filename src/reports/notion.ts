import { Client } from '@notionhq/client'
import { db } from '../db/client.js'
import type { PeriodAggregates } from '../types.js'

if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN must be set')
if (!process.env.NOTION_ROOT_PAGE_ID) throw new Error('NOTION_ROOT_PAGE_ID must be set')

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ROOT_PAGE_ID = process.env.NOTION_ROOT_PAGE_ID

async function getOrCreatePage(semanticId: string, title: string, parentId: string): Promise<string> {
  const { data } = await db
    .from('notion_pages')
    .select('notion_page_id')
    .eq('id', semanticId)
    .single()

  if (data) return data.notion_page_id

  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
  })

  await db.from('notion_pages').insert({ id: semanticId, notion_page_id: page.id })
  return page.id
}

async function getOrCreateReportsFolder(): Promise<string> {
  return getOrCreatePage('reports_folder', '📅 Reports', ROOT_PAGE_ID)
}

function h1(text: string) {
  return { object: 'block' as const, type: 'heading_1' as const, heading_1: { rich_text: [{ text: { content: text } }] } }
}
function h2(text: string) {
  return { object: 'block' as const, type: 'heading_2' as const, heading_2: { rich_text: [{ text: { content: text } }] } }
}
function para(text: string) {
  return { object: 'block' as const, type: 'paragraph' as const, paragraph: { rich_text: [{ text: { content: text } }] } }
}
function bullet(text: string) {
  return { object: 'block' as const, type: 'bulleted_list_item' as const, bulleted_list_item: { rich_text: [{ text: { content: text } }] } }
}
function divider() {
  return { object: 'block' as const, type: 'divider' as const, divider: {} }
}
function callout(text: string, emoji: string) {
  return {
    object: 'block' as const, type: 'callout' as const,
    callout: { rich_text: [{ text: { content: text } }], icon: { emoji } },
  }
}

async function replacePageContent(pageId: string, blocks: object[]): Promise<void> {
  let cursor: string | undefined
  do {
    const existing = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 })
    for (const block of existing.results) {
      await notion.blocks.delete({ block_id: block.id })
    }
    cursor = existing.has_more ? existing.next_cursor ?? undefined : undefined
  } while (cursor)

  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + 100) as any,
    })
  }
}

function buildHomepageBlocks(): object[] {
  return [
    h1('📊 AutoBudget'),
    para('Personal automated budget tracker — real-time transaction categorization, credit health tracking, and savings planning.'),
    divider(),
    h2('Navigation'),
    callout('These pages live as subpages below. Click into each one from the sidebar.', '👇'),
    bullet('🏠 Overview — Current month spend, savings rate, top categories, subscription total, credit snapshot. Refreshed every paycheck.'),
    bullet('💳 Credit Health — Per-card breakdown: balance, limit, utilization %, APR, monthly interest, estimated payoff. Cards sorted by APR for avalanche paydown. Refreshed every paycheck.'),
    bullet('💰 Savings Plan — Savings goal, per-paycheck recommended transfer, history of recommended vs. actual savings. Refreshed every paycheck.'),
    bullet('📈 Historical — Month-over-month spend, savings rate, and credit utilization trends. Refreshed monthly.'),
    bullet('📅 Reports — Individual report pages: one per biweekly period (paycheck-triggered), one per month (1st of month), one per year (Jan 1). Never overwritten.'),
    bullet('🚩 Flagged Transactions — Transactions Claude categorized with < 80% confidence. Review and correct these to improve future categorization.'),
    divider(),
    h2('How It Works'),
    bullet('Bank accounts connected via Plaid — all transactions flow in automatically.'),
    bullet('Every transaction is categorized by Claude AI using your merchant history.'),
    bullet('Paychecks trigger a biweekly report + savings recommendation delivered by email.'),
    bullet('Monthly and yearly reports run automatically on the 1st and Jan 1.'),
    bullet('Gmail alerts fire for large purchases, duplicate charges, and credit thresholds.'),
    divider(),
    para(`Set up: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`),
  ]
}

function buildOverviewBlocks(agg: PeriodAggregates): object[] {
  const utilEmoji = agg.creditSummary.totalUtilization >= 50 ? '🚨' : agg.creditSummary.totalUtilization >= 30 ? '⚠️' : '✅'
  return [
    h1('🏠 Overview'),
    para(`Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`),
    divider(),
    h2('This Period'),
    bullet(`Total spend: $${agg.totalSpend.toFixed(2)}`),
    bullet(`Total income: $${agg.totalIncome.toFixed(2)}`),
    bullet(`Net savings: $${agg.netSavings.toFixed(2)}`),
    bullet(`Savings rate: ${agg.savingsRate}%`),
    divider(),
    h2('Top Spending Categories'),
    ...Object.entries(agg.categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, amt]) => bullet(`${cat}: $${amt.toFixed(2)}`)),
    divider(),
    h2('Subscriptions'),
    bullet(`Active recurring charges: ${agg.activeRecurringCharges.length}`),
    bullet(`Estimated monthly total: $${agg.activeRecurringCharges.reduce((s, r) => s + (r.average_amount ?? 0), 0).toFixed(2)}`),
    divider(),
    h2('Credit Snapshot'),
    callout(
      `${utilEmoji} Total utilization: ${agg.creditSummary.totalUtilization}% | Balance: $${agg.creditSummary.totalBalance.toFixed(2)} | Monthly interest: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`,
      utilEmoji
    ),
  ]
}

function buildCreditHealthBlocks(agg: PeriodAggregates): object[] {
  const blocks: object[] = [
    h1('💳 Credit Health'),
    para(`Last updated: ${new Date().toLocaleDateString()}`),
    divider(),
  ]

  const totalUtil = agg.creditSummary.totalUtilization
  const totalEmoji = totalUtil >= 50 ? '🚨' : totalUtil >= 30 ? '⚠️' : '✅'
  blocks.push(callout(
    `Overall utilization: ${totalUtil}% | Total balance: $${agg.creditSummary.totalBalance.toFixed(2)} / $${agg.creditSummary.totalLimit.toFixed(2)} limit`,
    totalEmoji
  ))
  blocks.push(bullet(`Balance trend: ${agg.creditSummary.trend}`))
  blocks.push(bullet(`Total monthly interest: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`))
  blocks.push(divider())

  const sortedCards = [...agg.creditSummary.cards].sort((a, b) => b.apr - a.apr)

  for (const [i, card] of sortedCards.entries()) {
    const emoji = card.utilization >= 50 ? '🚨' : card.utilization >= 30 ? '⚠️' : '✅'
    blocks.push(h2(`${emoji} ${card.name}${card.mask ? ` ····${card.mask}` : ''}${i === 0 ? ' ← Pay this first' : ''}`))
    blocks.push(bullet(`Balance: $${card.balance.toFixed(2)} / $${card.limit.toFixed(2)} limit`))
    blocks.push(bullet(`Utilization: ${card.utilization}%`))
    blocks.push(bullet(`APR: ${card.apr}%${card.isVariableRate ? ' (variable)' : ''}`))
    blocks.push(bullet(`Monthly interest: $${card.monthlyInterest.toFixed(2)}`))
    blocks.push(bullet(`Estimated payoff: ${card.payoffMonths} months at minimum payments`))
  }

  return blocks
}

function buildSavingsPlanBlocks(agg: PeriodAggregates): object[] {
  const blocks: object[] = [
    h1('💰 Savings Plan'),
    para(`Last updated: ${new Date().toLocaleDateString()}`),
    divider(),
  ]

  const events = agg.savingsEvents
  if (events.length > 0) {
    const latest = events[events.length - 1]
    blocks.push(h2('Latest Paycheck Recommendation'))
    blocks.push(para(latest.notes ?? 'No recommendation yet.'))
    blocks.push(divider())
    blocks.push(h2('Paycheck History'))
    for (const ev of [...events].reverse().slice(0, 10)) {
      const actual = ev.actual_amount != null ? `$${ev.actual_amount.toFixed(2)} saved` : 'not yet confirmed'
      blocks.push(bullet(`${ev.created_at.split('T')[0]}: paycheck $${ev.paycheck_amount.toFixed(2)} → recommended $${ev.recommended_amount?.toFixed(2) ?? '?'} → ${actual}`))
    }
  } else {
    blocks.push(para('No paycheck data yet. Connect your accounts and wait for the next paycheck.'))
  }

  return blocks
}

function buildHistoricalBlocks(agg: PeriodAggregates): object[] {
  return [
    h1('📈 Historical'),
    para(`Last updated: ${new Date().toLocaleDateString()}`),
    divider(),
    h2('This Period vs Prior'),
    bullet(`Spend: $${agg.totalSpend.toFixed(2)}${agg.priorPeriod ? ` (prior: $${agg.priorPeriod.totalSpend.toFixed(2)})` : ''}`),
    bullet(`Savings rate: ${agg.savingsRate}%${agg.priorPeriod ? ` (prior: ${agg.priorPeriod.savingsRate}%)` : ''}`),
    bullet(`Credit utilization: ${agg.creditSummary.totalUtilization}%${agg.priorPeriod ? ` (prior: ${agg.priorPeriod.creditSummary.totalUtilization}%)` : ''}`),
  ]
}

function buildReportBlocks(agg: PeriodAggregates, narrative: string, periodType: 'biweekly' | 'monthly' | 'yearly'): object[] {
  const title = periodType === 'yearly'
    ? `${agg.periodStart.slice(0, 4)} Year in Review`
    : periodType === 'monthly'
    ? `${agg.periodStart.slice(0, 7)} Monthly Report`
    : `${agg.periodStart} – ${agg.periodEnd}`

  const blocks: object[] = [
    h1(title),
    divider(),
    h2('Summary'),
    bullet(`Period: ${agg.periodStart} → ${agg.periodEnd}`),
    bullet(`Total income: $${agg.totalIncome.toFixed(2)}`),
    bullet(`Total spend: $${agg.totalSpend.toFixed(2)}`),
    bullet(`Net: $${agg.netSavings.toFixed(2)}`),
    bullet(`Savings rate: ${agg.savingsRate}%`),
    divider(),
    h2('Spending by Category'),
    ...Object.entries(agg.categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => bullet(`${cat}: $${amt.toFixed(2)}`)),
    divider(),
    h2('Credit'),
    bullet(`Total utilization: ${agg.creditSummary.totalUtilization}% (${agg.creditSummary.trend})`),
    bullet(`Total balance: $${agg.creditSummary.totalBalance.toFixed(2)}`),
    bullet(`Monthly interest: $${agg.creditSummary.totalMonthlyInterest.toFixed(2)}`),
    divider(),
    h2('Largest Purchases'),
    ...agg.largestPurchases.slice(0, 5).map(p => bullet(`$${p.amount.toFixed(2)} — ${p.merchant} (${p.category}) on ${p.date}`)),
    divider(),
    h2('Recurring Charges Audit'),
    bullet(`Active subscriptions: ${agg.activeRecurringCharges.length}`),
    ...agg.activeRecurringCharges.slice(0, 15).map(r => bullet(`${r.merchant_name}: ~$${r.average_amount?.toFixed(2) ?? '?'} ${r.frequency ?? ''}`)),
    divider(),
    h2('Analysis'),
    ...narrative.split('\n\n').map(p => para(p)),
  ]

  return blocks
}

export async function writeNotionHomepage(): Promise<void> {
  const blocks = buildHomepageBlocks()
  await replacePageContent(ROOT_PAGE_ID, blocks)
}

export async function writeNotionReport(
  agg: PeriodAggregates,
  narrative: string,
  periodType: 'biweekly' | 'monthly' | 'yearly'
): Promise<string> {
  const reportsFolder = await getOrCreateReportsFolder()

  const pageTitle = periodType === 'yearly'
    ? `${agg.periodStart.slice(0, 4)} Year in Review`
    : periodType === 'monthly'
    ? `${agg.periodStart.slice(0, 7)} Monthly Report`
    : `${agg.periodStart} – ${agg.periodEnd}`

  const page = await notion.pages.create({
    parent: { page_id: reportsFolder },
    properties: {
      title: { title: [{ text: { content: pageTitle } }] },
    },
  })

  const blocks = buildReportBlocks(agg, narrative, periodType)
  await notion.blocks.children.append({ block_id: page.id, children: blocks as any })

  return `https://notion.so/${page.id.replace(/-/g, '')}`
}

export async function updateNotionDashboards(agg: PeriodAggregates): Promise<void> {
  const overviewId = await getOrCreatePage('overview', '🏠 Overview', ROOT_PAGE_ID)
  const creditId = await getOrCreatePage('credit_health', '💳 Credit Health', ROOT_PAGE_ID)
  const savingsId = await getOrCreatePage('savings_plan', '💰 Savings Plan', ROOT_PAGE_ID)

  await replacePageContent(overviewId, buildOverviewBlocks(agg))
  await replacePageContent(creditId, buildCreditHealthBlocks(agg))
  await replacePageContent(savingsId, buildSavingsPlanBlocks(agg))

  if (agg.periodType === 'monthly' || agg.periodType === 'yearly') {
    const historicalId = await getOrCreatePage('historical', '📈 Historical', ROOT_PAGE_ID)
    await replacePageContent(historicalId, buildHistoricalBlocks(agg))
  }
}

function notionCell(text: string): object[] {
  return text ? [{ type: 'text', text: { content: text } }] : []
}

function notionTableRow(cells: string[]): object {
  return { type: 'table_row', table_row: { cells: cells.map(notionCell) } }
}

export async function writeRecentTransactions(): Promise<void> {
  const { data } = await db
    .from('transactions')
    .select('merchant_name, amount, date, category, category_confidence, is_income, flagged_for_review, accounts(name, mask)')
    .order('date', { ascending: false })
    .limit(100)

  const pageId = await getOrCreatePage('recent_transactions', '🔍 Recent Transactions', ROOT_PAGE_ID)

  // Clear existing content
  let cursor: string | undefined
  do {
    const existing = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 })
    for (const block of existing.results) await notion.blocks.delete({ block_id: block.id })
    cursor = existing.has_more ? existing.next_cursor ?? undefined : undefined
  } while (cursor)

  if (!data?.length) {
    await notion.blocks.children.append({ block_id: pageId, children: [bullet('No transactions yet.')] as any })
    return
  }

  const headerRow = notionTableRow(['Date', 'Merchant', 'Amount', 'Category', 'Conf %', 'Account', 'Notes'])
  const dataRows = data.map(tx => {
    const account = (tx.accounts as any)
    const acctLabel = account ? `${account.name}${account.mask ? ' ···' + account.mask : ''}` : ''
    const notes = [tx.flagged_for_review ? '🚩' : '', tx.is_income ? '↓ income' : ''].filter(Boolean).join(' ')
    return notionTableRow([
      tx.date,
      tx.merchant_name ?? '',
      `$${Number(tx.amount).toFixed(2)}`,
      tx.category ?? '',
      tx.is_income ? '—' : `${tx.category_confidence ?? 0}%`,
      acctLabel,
      notes,
    ])
  })

  // Create table with header + first batch of rows (Notion limit: 100 children per request)
  const firstBatch = dataRows.slice(0, 99)
  const createResp = await notion.blocks.children.append({
    block_id: pageId,
    children: [{ type: 'table', table: { table_width: 7, has_column_header: true, has_row_header: false, children: [headerRow, ...firstBatch] } }] as any,
  })
  const tableId = (createResp.results[0] as any).id

  for (let i = 99; i < dataRows.length; i += 100) {
    await notion.blocks.children.append({ block_id: tableId, children: dataRows.slice(i, i + 100) as any })
  }
}

export async function writeFlaggedTransactions(): Promise<void> {
  const { data } = await db
    .from('transactions')
    .select('merchant_name, amount, date, category, category_confidence')
    .eq('flagged_for_review', true)
    .order('date', { ascending: false })
    .limit(200)

  const flaggedId = await getOrCreatePage('flagged_transactions', '🚩 Flagged Transactions', ROOT_PAGE_ID)

  // Clear existing content
  let cursor: string | undefined
  do {
    const existing = await notion.blocks.children.list({ block_id: flaggedId, start_cursor: cursor, page_size: 100 })
    for (const block of existing.results) await notion.blocks.delete({ block_id: block.id })
    cursor = existing.has_more ? existing.next_cursor ?? undefined : undefined
  } while (cursor)

  if (!data?.length) {
    await notion.blocks.children.append({ block_id: flaggedId, children: [bullet('No flagged transactions.')] as any })
    return
  }

  const headerRow = notionTableRow(['Date', 'Merchant', 'Amount', 'Best Guess Category', 'Confidence'])
  const dataRows = data.map(tx => notionTableRow([
    tx.date,
    tx.merchant_name ?? '',
    `$${Number(tx.amount).toFixed(2)}`,
    tx.category ?? '',
    `${tx.category_confidence ?? 0}%`,
  ]))

  const firstBatch = dataRows.slice(0, 99)
  const createResp = await notion.blocks.children.append({
    block_id: flaggedId,
    children: [{ type: 'table', table: { table_width: 5, has_column_header: true, has_row_header: false, children: [headerRow, ...firstBatch] } }] as any,
  })
  const tableId = (createResp.results[0] as any).id

  for (let i = 99; i < dataRows.length; i += 100) {
    await notion.blocks.children.append({ block_id: tableId, children: dataRows.slice(i, i + 100) as any })
  }
}
