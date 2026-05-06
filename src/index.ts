import 'dotenv/config'
import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import formbody from '@fastify/formbody'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { webhookHandler, checkWebhookHealth } from './plaid/webhook.js'
import { linkHandler, linkTokenHandler, linkedAccountsHandler, linkExchangeHandler, oauthReturnHandler, repairWebhooksHandler, syncAllHandler, setupGetHandler, setupPostHandler, itemStatusHandler, reauthTokenHandler } from './plaid/link.js'
import { reviewTransactionsHandler, reviewCorrectHandler, merchantTransactionsHandler, correctTransactionHandler, confirmTransactionHandler, confirmMerchantHandler, toggleRecurringHandler, allTransactionsHandler } from './plaid/review.js'
import { rulesPageHandler, listRulesHandler, createRuleHandler, deleteRuleHandler } from './plaid/rules.js'
import { settingsDataHandler, renameAccountHandler, addCategoryHandler, deleteCategoryHandler, updateAprHandler, updateLoanHandler } from './plaid/settings.js'
import { paycheckDataHandler, addPaycheckPatternHandler, removePaycheckPatternHandler, removeRecurringHandler, triggerPaycheckReportHandler, recurringExportHandler } from './plaid/paycheck.js'
import { appleCardStatusHandler, appleCardImportHandler, appleCardBalanceHandler } from './plaid/apple-card.js'
import { homeStatsHandler } from './plaid/home.js'
import { reportsPageHandler, reportsDataHandler, saveGoalsHandler, deleteInsightHandler, spendingPageHandler, spendingDataHandler, spendingCategoryHandler, spendingTransactionsHandler, creditPageHandler, creditDataHandler } from './plaid/reports.js'
import { authHandler, logoutHandler, checkAuthPage } from './auth.js'
import { startCronJobs } from './reports/cron.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: true })

// Capture raw body buffer before JSON parsing — needed for Plaid webhook verification
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (_req, body, done) => {
    try {
      const buf = body as Buffer
      done(null, { _raw: buf, _parsed: JSON.parse(buf.toString()) })
    } catch (err) {
      done(err as Error, undefined)
    }
  }
)

await app.register(formbody)
await app.register(staticPlugin, {
  root: join(__dirname, '../public'),
  prefix: '/public/',
})

function servePage(name: string, auth = false) {
  return async (req: any, reply: any) => {
    if (auth && !checkAuthPage(req, reply)) return
    const html = readFileSync(join(__dirname, `../public/${name}`), 'utf8')
    await reply.type('text/html').send(html)
  }
}

app.get('/', servePage('index.html'))
app.get('/demo', servePage('demo.html'))
app.get('/accounts', servePage('accounts.html', true))
app.post('/auth', authHandler)
app.get('/auth/logout', logoutHandler)
app.get('/health', async () => {
  const webhook = await checkWebhookHealth()
  return { status: webhook.healthy ? 'ok' : 'degraded', ts: new Date().toISOString(), webhook }
})

// Home
app.get('/home/stats', homeStatsHandler)

// Webhook + Plaid link
app.post('/webhook', webhookHandler)
app.get('/link', servePage('link.html', true))
app.get('/link/token', linkTokenHandler)
app.get('/link/accounts', linkedAccountsHandler)
app.post('/link/repair-webhooks', repairWebhooksHandler)
app.post('/link/sync-all', syncAllHandler)
app.get('/link/status', itemStatusHandler)
app.post('/link/reauth-token', reauthTokenHandler)
app.post('/link/exchange', linkExchangeHandler)
app.get('/oauth-return', servePage('oauth-return.html'))
app.get('/setup', setupGetHandler)
app.post('/setup', setupPostHandler)

// Accounts page — transactions, rules, paycheck, settings
app.get('/review/transactions', reviewTransactionsHandler)
app.get('/review/all', allTransactionsHandler)
app.post('/review/correct', reviewCorrectHandler)
app.get('/review/merchant/:merchant', merchantTransactionsHandler)
app.post('/review/correct-transaction', correctTransactionHandler)
app.post('/review/confirm-transaction', confirmTransactionHandler)
app.post('/review/confirm-merchant', confirmMerchantHandler)
app.post('/review/toggle-recurring', toggleRecurringHandler)
app.get('/rules/list', listRulesHandler)
app.post('/rules/create', createRuleHandler)
app.delete('/rules/:id', deleteRuleHandler)
app.get('/settings/data', settingsDataHandler)
app.post('/settings/rename-account', renameAccountHandler)
app.post('/settings/add-category', addCategoryHandler)
app.delete('/settings/category/:name', deleteCategoryHandler)
app.get('/paycheck/data', paycheckDataHandler)
app.post('/paycheck/add-pattern', addPaycheckPatternHandler)
app.delete('/paycheck/remove-pattern/:id', removePaycheckPatternHandler)
app.delete('/paycheck/remove-recurring/:id', removeRecurringHandler)
app.post('/paycheck/trigger-report', triggerPaycheckReportHandler)
app.get('/paycheck/recurring-export', recurringExportHandler)

// Reports
app.get('/reports', reportsPageHandler)
app.get('/reports/data', reportsDataHandler)
app.post('/reports/save-goals', saveGoalsHandler)
app.delete('/reports/insight/:id', deleteInsightHandler)

// Spending
app.get('/spending', spendingPageHandler)
app.get('/spending/data', spendingDataHandler)
app.get('/spending/category', spendingCategoryHandler)
app.get('/spending/transactions', spendingTransactionsHandler)

// Credit (includes Apple Card)
app.get('/credit', creditPageHandler)
app.get('/credit/data', creditDataHandler)
app.post('/settings/update-apr', updateAprHandler)
app.post('/settings/update-loan', updateLoanHandler)
app.get('/apple-card/status', appleCardStatusHandler)
app.post('/apple-card/import', appleCardImportHandler)
app.post('/apple-card/balance', appleCardBalanceHandler)

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
startCronJobs()
