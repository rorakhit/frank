// ── Database row types ──────────────────────────────────────────────────────

export interface PlaidItem {
  id: string
  plaid_item_id: string
  access_token: string
  institution_id: string
  institution_name: string
  cursor: string | null
  created_at: string
}

export interface Account {
  id: string
  plaid_item_id: string
  plaid_account_id: string
  name: string
  type: string
  subtype: string | null
  mask: string | null
}

export interface Transaction {
  id: string
  plaid_transaction_id: string
  account_id: string
  amount: number
  merchant_name: string | null
  date: string
  category: string | null
  category_confidence: number | null
  is_recurring: boolean
  is_income: boolean
  flagged_for_review: boolean
  raw_plaid_data: Record<string, unknown>
  created_at: string
}

export interface RecurringCharge {
  id: string
  merchant_name: string
  average_amount: number | null
  frequency: string | null
  last_seen: string | null
  first_seen: string | null
  is_active: boolean
}

export interface CreditAccount {
  id: string
  account_id: string
  apr: number
  credit_limit: number
  is_variable_rate: boolean
  updated_at: string
}

export interface Insight {
  id: string
  period_start: string
  period_end: string
  period_type: 'biweekly' | 'monthly' | 'yearly'
  raw_analysis: string | null
  key_findings: Record<string, unknown> | null
  generated_at: string
}

export interface BalanceSnapshot {
  id: string
  account_id: string
  balance: number
  snapshot_at: string
}

export interface SavingsGoal {
  id: string
  target_type: 'fixed' | 'percentage'
  target_value: number | null
  created_at: string
}

export interface SavingsEvent {
  id: string
  paycheck_amount: number
  recommended_amount: number | null
  actual_amount: number | null
  period_start: string | null
  period_end: string | null
  notes: string | null
  created_at: string
}

// ── Categorization ──────────────────────────────────────────────────────────

export const CATEGORIES = [
  'Groceries', 'Dining', 'Food Delivery', 'Transport', 'Entertainment',
  'Shopping', 'Subscriptions', 'Utilities', 'Rent/Housing', 'Healthcare',
  'Travel', 'Income', 'Savings Transfer', 'Credit Payment', 'Loan Repayment',
  'Condo Fee', 'Dog', 'Hair', 'Interest', 'Investments', 'Software Projects', 'Other',
] as const

export type Category = typeof CATEGORIES[number]

export interface CategorizationResult {
  category: Category
  confidence: number
  is_recurring: boolean
  reasoning: string
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export type AlertType =
  | 'large_purchase'
  | 'duplicate_charge'
  | 'new_subscription'
  | 'daily_spend_exceeded'
  | 'credit_30_percent'
  | 'credit_50_percent'
  | 'credit_growing_trend'
  | 'payment_posted'
  | 'paycheck_detected'

export interface AlertPayload {
  type: AlertType
  data: Record<string, unknown>
  enrichedContext?: string
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface CreditCardSummary {
  accountId: string
  name: string
  mask: string | null
  balance: number
  limit: number
  utilization: number
  apr: number
  monthlyInterest: number
  payoffMonths: number
  isVariableRate: boolean
}

export interface CreditSummary {
  cards: CreditCardSummary[]
  totalBalance: number
  totalLimit: number
  totalUtilization: number
  totalMonthlyInterest: number
  trend: 'growing' | 'shrinking' | 'stable' | 'unknown'
}

export interface LoanAccountSummary {
  accountId: string
  name: string
  mask: string | null
  subtype: string | null
  currentBalance: number
  originalBalance: number | null
  apr: number | null
  yearStartBalance: number | null
  principalPaidThisYear: number | null
  estimatedInterestPaidThisYear: number | null
  projectedPayoffMonths: number | null
}

export interface LoanSummary {
  loans: LoanAccountSummary[]
  totalCurrentBalance: number
  totalPrincipalPaidThisYear: number
}

export interface PeriodAggregates {
  periodStart: string
  periodEnd: string
  periodType: 'biweekly' | 'monthly' | 'yearly'
  totalSpend: number
  totalIncome: number
  netSavings: number
  savingsRate: number
  categoryBreakdown: Record<string, number>
  largestPurchases: Array<{ merchant: string; amount: number; date: string; category: string }>
  activeRecurringCharges: RecurringCharge[]
  creditSummary: CreditSummary
  loanSummary: LoanSummary
  savingsEvents: SavingsEvent[]
  priorPeriod?: PeriodAggregates
}
