import cron from 'node-cron'
import { runMonthlyReport, runYearlyReport } from './generate.js'

export function startCronJobs(): void {
  cron.schedule('0 8 1 * *', async () => {
    const now = new Date()
    const month = now.getMonth()
    const year = now.getFullYear()
    const reportMonth = month === 0 ? 12 : month
    const reportYear = month === 0 ? year - 1 : year
    console.log(`Running monthly report for ${reportYear}-${reportMonth}`)
    await runMonthlyReport(reportYear, reportMonth).catch(console.error)
  })

  cron.schedule('0 8 1 1 *', async () => {
    const year = new Date().getFullYear() - 1
    console.log(`Running yearly report for ${year}`)
    await runYearlyReport(year).catch(console.error)
  })

  console.log('Cron jobs started: monthly (1st @ 8am), yearly (Jan 1 @ 8am)')
}
