import 'dotenv/config'
import Fastify from 'fastify'
import staticPlugin from '@fastify/static'
import formbody from '@fastify/formbody'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { webhookHandler } from './plaid/webhook.js'
import { linkHandler, linkTokenHandler, linkedAccountsHandler, linkExchangeHandler, oauthReturnHandler, repairWebhooksHandler, syncAllHandler, refreshNotionHandler, setupGetHandler, setupPostHandler } from './plaid/link.js'
import { reviewPageHandler, reviewTransactionsHandler, reviewCorrectHandler, merchantTransactionsHandler, correctTransactionHandler, confirmTransactionHandler, confirmMerchantHandler } from './plaid/review.js'
import { rulesPageHandler, listRulesHandler, createRuleHandler, deleteRuleHandler } from './plaid/rules.js'
import { settingsPageHandler, settingsDataHandler, renameAccountHandler, addCategoryHandler, deleteCategoryHandler, updateAprHandler, updateLoanHandler } from './plaid/settings.js'
import { paycheckPageHandler, paycheckDataHandler, setPaycheckAccountHandler, updateRecurringAllocationHandler, removeRecurringHandler } from './plaid/paycheck.js'
import { appleCardPageHandler, appleCardStatusHandler, appleCardImportHandler } from './plaid/apple-card.js'
import { homeStatsHandler } from './plaid/home.js'
import { authHandler, logoutHandler } from './auth.js'
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

app.get('/', async (_req, reply) => {
  const { readFileSync } = await import('fs')
  const { join: pjoin } = await import('path')
  const html = readFileSync(pjoin(__dirname, '../public/index.html'), 'utf8')
  await reply.type('text/html').send(html)
})
app.post('/auth', authHandler)
app.get('/auth/logout', logoutHandler)
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))
app.get('/home/stats', homeStatsHandler)
app.post('/webhook', webhookHandler)
app.get('/link', linkHandler)
app.get('/link/token', linkTokenHandler)
app.get('/link/accounts', linkedAccountsHandler)
app.post('/link/repair-webhooks', repairWebhooksHandler)
app.post('/link/sync-all', syncAllHandler)
app.post('/link/refresh-notion', refreshNotionHandler)
app.post('/link/exchange', linkExchangeHandler)
app.get('/oauth-return', oauthReturnHandler)
app.get('/setup', setupGetHandler)
app.post('/setup', setupPostHandler)
app.get('/review', reviewPageHandler)
app.get('/review/transactions', reviewTransactionsHandler)
app.post('/review/correct', reviewCorrectHandler)
app.get('/review/merchant/:merchant', merchantTransactionsHandler)
app.post('/review/correct-transaction', correctTransactionHandler)
app.post('/review/confirm-transaction', confirmTransactionHandler)
app.post('/review/confirm-merchant', confirmMerchantHandler)
app.get('/rules', rulesPageHandler)
app.get('/rules/list', listRulesHandler)
app.post('/rules/create', createRuleHandler)
app.delete('/rules/:id', deleteRuleHandler)
app.get('/settings', settingsPageHandler)
app.get('/settings/data', settingsDataHandler)
app.post('/settings/rename-account', renameAccountHandler)
app.post('/settings/add-category', addCategoryHandler)
app.delete('/settings/category/:name', deleteCategoryHandler)
app.post('/settings/update-apr', updateAprHandler)
app.post('/settings/update-loan', updateLoanHandler)
app.get('/paycheck', paycheckPageHandler)
app.get('/paycheck/data', paycheckDataHandler)
app.post('/paycheck/set-account', setPaycheckAccountHandler)
app.post('/paycheck/update-recurring', updateRecurringAllocationHandler)
app.delete('/paycheck/remove-recurring/:id', removeRecurringHandler)
app.get('/apple-card', appleCardPageHandler)
app.get('/apple-card/status', appleCardStatusHandler)
app.post('/apple-card/import', appleCardImportHandler)

const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
startCronJobs()
