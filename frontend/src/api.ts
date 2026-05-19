export interface Institution {
  id: string
  source: string
  display_name: string
  last_scraped_at: string | null
  last_scrape_ok: boolean | null
  last_scrape_error: string | null
}

export interface Account {
  id: string
  institution_id: string
  display_name: string
  name: string
  type: string
  mask: string
  latest_balance: number | null
  balance_at: string | null
}

export interface Transaction {
  id: string
  date: string
  amount: number
  direction: 'debit' | 'credit'
  description: string
  category: string
  is_income: boolean
  is_recurring: boolean
  is_internal: boolean
  notes: string
}

export interface CategorizationSuggestion {
  id: string
  suggestion_type: 'transaction' | 'rule'
  status: 'pending' | 'approved' | 'dismissed'
  transaction_description: string | null
  transaction_date: string | null
  transaction_amount: number | null
  transaction_direction: string | null
  pattern: string | null
  category: string
  is_recurring: boolean
  cadence: string
  is_internal: boolean
  confidence: number
  notes: string
  created_at: string
  reviewed_at: string | null
}

export interface CategorizationRule {
  id: string
  pattern: string
  category: string
  is_recurring: boolean
  cadence: string
  is_internal: boolean
  notes: string
  created_at: string
}

export interface Loan {
  id: string
  name: string
  lender: string
  original_amount: number
  interest_rate: number
  term_months: number
  minimum_payment: number
  origination_date: string
  account_source: string
  notes: string
  estimated_balance: number
}

export interface CreditAccount {
  id: string
  name: string
  lender: string
  credit_limit: number
  current_balance: number
  interest_rate: number
  minimum_payment: number
  due_day: number
  notes: string
}

export interface DebtItem {
  name: string
  balance: number
  rate: number
  min_payment: number
  recommended_payment: number
  reasoning: string
  months_to_payoff: number
}

export interface PaydownMilestone {
  description: string
  target_month: string
}

export interface PaydownStrategy {
  narrative: string
  priority: DebtItem[]
  milestones: PaydownMilestone[]
  free_cash_flow: number
}

export interface Insight {
  id: string
  period_start: string
  period_end: string
  period_type: 'biweekly' | 'monthly' | 'yearly'
  raw_analysis: string
  key_findings: string[]
  thinking_text: string
  model: string
  input_tokens: number
  output_tokens: number
  generated_at: string
}

export interface Goal {
  id: string
  type: 'savings_rate' | 'spending_cap' | 'free_text'
  horizon: 'monthly' | 'quarterly' | 'yearly'
  description: string
  target_value: number | null
  category: string
  active: boolean
  created_at: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

export const api = {
  institutions: () => get<Institution[]>('/api/institutions'),
  accounts: () => get<Account[]>('/api/accounts'),
  transactions: (start?: string, end?: string) => {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    return get<Transaction[]>(`/api/transactions?${params}`)
  },
  loans: () => get<Loan[]>('/api/loans'),
  creditAccounts: () => get<CreditAccount[]>('/api/credit-accounts'),
  insights: () => get<Insight[]>('/api/insights'),
  goals: () => get<Goal[]>('/api/goals'),
  createGoal: (g: Omit<Goal, 'id' | 'active' | 'created_at'>) =>
    fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g) }).then(r => r.json() as Promise<Goal>),
  deactivateGoal: (id: string) =>
    fetch(`/api/goals/${id}`, { method: 'DELETE' }),
  generateInsight: (period: string) =>
    fetch('/api/insights/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period }) }).then(r => r.json() as Promise<Insight>),
  categorizationRules: () => get<CategorizationRule[]>('/api/categorization-rules'),
  createCategorizationRule: (r: Omit<CategorizationRule, 'id' | 'created_at'>) =>
    fetch('/api/categorization-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) }).then(res => res.json() as Promise<CategorizationRule>),
  updateCategorizationRule: (id: string, r: Omit<CategorizationRule, 'id' | 'created_at'>) =>
    fetch(`/api/categorization-rules/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) }).then(res => res.json() as Promise<CategorizationRule>),
  deleteCategorizationRule: (id: string) =>
    fetch(`/api/categorization-rules/${id}`, { method: 'DELETE' }),
  applyCategorizationRules: () =>
    fetch('/api/categorization-rules/apply', { method: 'POST' }).then(r => r.json() as Promise<{ rows_updated: number }>),
  suggestCategorizations: () =>
    fetch('/api/categorize/suggest', { method: 'POST' }).then(r => r.json() as Promise<{ assignments: CategorizationSuggestion[], rules: CategorizationSuggestion[], message?: string }>),
  listSuggestions: () => get<CategorizationSuggestion[]>('/api/categorize/suggestions'),
  approveSuggestion: (id: string) =>
    fetch(`/api/categorize/suggestions/${id}/approve`, { method: 'POST' }).then(r => r.json() as Promise<CategorizationSuggestion>),
  dismissSuggestion: (id: string) =>
    fetch(`/api/categorize/suggestions/${id}/dismiss`, { method: 'POST' }),
  getDebtCoach: () =>
    fetch('/api/debt/coach').then(r => r.json() as Promise<{ generated_at: string; strategy: PaydownStrategy } | null>),
  setTransactionNote: (id: string, note: string) =>
    fetch(`/api/transactions/${id}/notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) }),
  generateDebtCoach: () =>
    fetch('/api/debt/coach', { method: 'POST' }).then(r => r.json() as Promise<PaydownStrategy>),
}
