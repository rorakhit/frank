import { google } from 'googleapis'
import type { AlertPayload } from '../types.js'

const RECIPIENT = 'ro.rakhit@gmail.com'

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  )
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

function makeRawMessage(from: string, to: string, subject: string, body: string): string {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join('\r\n')
  return Buffer.from(message).toString('base64url')
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

  const subject = subjects[type] ?? `GhostPaper: ${type}`
  const body = enrichedContext
    ? `${subject}\n\n${enrichedContext}`
    : subject

  return { subject, text: body }
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  try {
    const gmail = getGmailClient()
    const { subject, text } = formatAlertEmail(payload)
    const raw = makeRawMessage(
      process.env.GMAIL_USER!,
      RECIPIENT,
      `[GhostPaper] ${subject}`,
      text,
    )
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
  } catch (err) {
    console.error('Failed to send alert email:', err)
  }
}

export async function sendEmail(subject: string, body: string): Promise<void> {
  try {
    const gmail = getGmailClient()
    const raw = makeRawMessage(
      process.env.GMAIL_USER!,
      RECIPIENT,
      `[GhostPaper] ${subject}`,
      body,
    )
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
  } catch (err) {
    console.error('Failed to send email:', err)
  }
}
