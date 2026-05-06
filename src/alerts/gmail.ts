import nodemailer from 'nodemailer'
import type { AlertPayload } from '../types.js'

const RECIPIENT = 'ro.rakhit@gmail.com'

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

function formatAlertEmail(payload: AlertPayload): { subject: string; text: string } {
  const { type, data, enrichedContext } = payload

  const subjects: Record<string, string> = {
    large_purchase: `Large purchase: $${data['amount']} at ${data['merchant']}`,
    duplicate_charge: `⚠️ Possible duplicate: $${data['amount']} at ${data['merchant']}`,
    new_subscription: `New subscription detected: ${data['merchant']} $${data['amount']}`,
    daily_spend_exceeded: `Daily spend alert: $${(data['totalSpend'] as number).toFixed(2)} today`,
    credit_30_percent: `[${data['card']}] Credit at 30% utilization (${data['utilization']}%)`,
    credit_50_percent: `⚠️ [${data['card']}] Credit at 50% utilization (${data['utilization']}%)`,
    credit_growing_trend: `⚠️ Credit balance growing two periods in a row`,
    payment_posted: `✅ Payment of $${data['amount']} posted to ${data['merchant']}`,
    paycheck_detected: `💰 Paycheck received: $${data['paycheckAmount']}`,
  }

  const subject = subjects[type] ?? `AutoBudget: ${type}`
  const body = enrichedContext
    ? `${subject}\n\n${enrichedContext}`
    : subject

  return { subject, text: body }
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  try {
    const transport = createTransport()
    const { subject, text } = formatAlertEmail(payload)
    await transport.sendMail({
      from: process.env.GMAIL_USER,
      to: RECIPIENT,
      subject: `[AutoBudget] ${subject}`,
      text,
    })
  } catch (err) {
    console.error('Failed to send alert email:', err)
  }
}

export async function sendEmail(subject: string, body: string): Promise<void> {
  try {
    const transport = createTransport()
    await transport.sendMail({
      from: process.env.GMAIL_USER,
      to: RECIPIENT,
      subject: `[AutoBudget] ${subject}`,
      text: body,
    })
  } catch (err) {
    console.error('Failed to send email:', err)
  }
}
