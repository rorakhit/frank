import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { CoachNote } from '../components'
import { api, type CategorizationRule, type CategorizationSuggestion } from '../api'

const CADENCES = ['', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']

function RuleRow({ rule, onEdit, onDelete }: {
  rule: CategorizationRule
  onEdit: (r: CategorizationRule) => void
  onDelete: (id: string) => void
}) {
  const { tokens: tk } = useTheme()
  return (
    <div className={`flex items-center gap-4 py-4 border-b border-white/5 ${tk.rowHover} transition-colors group`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 font-mono">{rule.pattern}</div>
        <div className="text-xs text-zinc-600 mt-0.5 flex items-center gap-2">
          {rule.category && <span className="text-zinc-500">{rule.category}</span>}
          {rule.is_recurring && rule.cadence && <span className="text-violet-400/70">{rule.cadence}</span>}
          {rule.is_recurring && !rule.cadence && <span className="text-violet-400/70">recurring</span>}
          {rule.is_internal && <span className="text-zinc-600">internal transfer</span>}
          {rule.notes && <><span>·</span><span className="text-zinc-700 italic">{rule.notes}</span></>}
        </div>
      </div>
      <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(rule)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">edit</button>
        <button onClick={() => onDelete(rule.id)} className="text-xs text-zinc-700 hover:text-orange-400 transition-colors">delete</button>
      </div>
    </div>
  )
}

function ConfidencePip({ confidence }: { confidence: number }) {
  const color = confidence >= 80 ? 'bg-emerald-500' : confidence >= 50 ? 'bg-amber-500' : 'bg-zinc-600'
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} shrink-0`} title={`${confidence}% confidence`} />
  )
}

function SuggestionRow({ s, onApprove, onDismiss, onSaveAsRule }: {
  s: CategorizationSuggestion
  onApprove: () => void
  onDismiss: () => void
  onSaveAsRule?: () => void
}) {
  const { tokens: tk } = useTheme()
  const label = s.suggestion_type === 'transaction'
    ? s.transaction_description ?? '—'
    : s.pattern ?? '—'

  return (
    <div className={`flex items-start gap-3 py-4 border-b border-white/5 ${tk.rowHover} transition-colors group`}>
      <ConfidencePip confidence={s.confidence} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 font-mono truncate">{label}</div>
        <div className="text-xs text-zinc-600 mt-0.5 flex flex-wrap items-center gap-2">
          {s.category && <span className="text-zinc-400">{s.category}</span>}
          {s.is_recurring && s.cadence && <span className="text-violet-400/70">{s.cadence}</span>}
          {s.is_recurring && !s.cadence && <span className="text-violet-400/70">recurring</span>}
          {s.is_internal && <span className="text-zinc-600">internal</span>}
          {s.notes && <span className="text-zinc-700 italic">{s.notes}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onApprove} className={`text-xs ${tk.accent} hover:opacity-80 transition-opacity`}>approve</button>
        {s.suggestion_type === 'transaction' && onSaveAsRule && (
          <button onClick={onSaveAsRule} className="text-xs text-violet-400/70 hover:text-violet-300 transition-colors">save as rule</button>
        )}
        <button onClick={onDismiss} className="text-xs text-zinc-700 hover:text-orange-400 transition-colors">dismiss</button>
      </div>
    </div>
  )
}

const blankRule = (): Omit<CategorizationRule, 'id' | 'created_at'> => ({
  pattern: '',
  category: '',
  is_recurring: false,
  cadence: '',
  is_internal: false,
  notes: '',
})

export default function Categorization() {
  const { tokens: tk } = useTheme()
  const qc = useQueryClient()

  const { data: rules = [], isPending: rulesPending } = useQuery({
    queryKey: ['categorization-rules'],
    queryFn: api.categorizationRules,
  })

  const { data: suggestions = [], isPending: suggestionsPending, isFetched: suggestionsFetched } = useQuery({
    queryKey: ['categorization-suggestions'],
    queryFn: api.listSuggestions,
  })

  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(blankRule())
  const [applyResult, setApplyResult] = useState<number | null>(null)
  const [suggestMessage, setSuggestMessage] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.updateCategorizationRule(editing, form)
        : api.createCategorizationRule(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categorization-rules'] })
      setEditing(null)
      setForm(blankRule())
    },
  })

  const deleteMutation = useMutation({
    mutationFn: api.deleteCategorizationRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categorization-rules'] }),
  })

  const applyMutation = useMutation({
    mutationFn: api.applyCategorizationRules,
    onSuccess: (data) => {
      setApplyResult(data.rows_updated)
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['transactions-recent'] })
    },
  })

  const suggestMutation = useMutation({
    mutationFn: api.suggestCategorizations,
    onSuccess: (data) => {
      setSuggestMessage(data.message ?? null)
      qc.invalidateQueries({ queryKey: ['categorization-suggestions'] })
    },
  })

  const approveMutation = useMutation({
    mutationFn: api.approveSuggestion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categorization-suggestions'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['transactions-recent'] })
    },
  })

  const dismissMutation = useMutation({
    mutationFn: api.dismissSuggestion,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categorization-suggestions'] }),
  })

  function startEdit(rule: CategorizationRule) {
    setEditing(rule.id)
    setForm({ pattern: rule.pattern, category: rule.category, is_recurring: rule.is_recurring, cadence: rule.cadence, is_internal: rule.is_internal, notes: rule.notes })
  }

  function cancelEdit() {
    setEditing(null)
    setForm(blankRule())
  }

  // Pre-fill the rule form from a transaction suggestion
  function prefillFromSuggestion(s: CategorizationSuggestion) {
    const pattern = s.transaction_description ?? ''
    setEditing(null)
    setForm({ pattern, category: s.category, is_recurring: s.is_recurring, cadence: s.cadence, is_internal: s.is_internal, notes: s.notes })
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  // Approving a rule suggestion saves it as a real rule
  async function approveRuleSuggestion(s: CategorizationSuggestion) {
    if (!s.pattern) return
    try {
      await api.createCategorizationRule({
        pattern: s.pattern,
        category: s.category,
        is_recurring: s.is_recurring,
        cadence: s.cadence,
        is_internal: s.is_internal,
        notes: s.notes,
      })
      await api.approveSuggestion(s.id)
      qc.invalidateQueries({ queryKey: ['categorization-rules'] })
      qc.invalidateQueries({ queryKey: ['categorization-suggestions'] })
    } catch (e) {
      console.error('approve rule suggestion:', e)
    }
  }

  const showForm = editing !== null || form.pattern.trim() !== ''
  const txnSuggestions = suggestions.filter(s => s.suggestion_type === 'transaction')
  const ruleSuggestions = suggestions.filter(s => s.suggestion_type === 'rule')
  const internalRules = rules.filter(r => r.is_internal)
  const categoryRules = rules.filter(r => !r.is_internal)

  return (
    <div className="max-w-2xl mx-auto px-8 py-16">

      {/* Hero */}
      <div className="mb-10">
        <div className="text-sm text-zinc-500 mb-2 tracking-wide">Rules</div>
        <div
          className="font-bold tracking-tight text-violet-400 leading-none mb-1"
          style={{ fontSize: '56px', textShadow: '0 0 40px rgba(139,92,246,0.2)' }}
        >
          {rules.length}
        </div>
        <div className="text-zinc-500 text-sm mt-1">
          categorization {rules.length === 1 ? 'rule' : 'rules'} · {internalRules.length} internal transfer {internalRules.length === 1 ? 'filter' : 'filters'}
        </div>
      </div>

      <CoachNote>
        Rules match transactions by pattern (case-insensitive substring) and tag them with a category, recurring flag, or internal-transfer flag. Internal transfers are excluded from spend and income totals everywhere. Use "Suggest" to let Claude propose categories for uncategorized transactions — you approve each one before anything is saved.
      </CoachNote>

      {/* Action bar */}
      <div className="flex items-center gap-6 mb-10 flex-wrap">
        <button
          onClick={() => { setSuggestMessage(null); suggestMutation.mutate() }}
          disabled={suggestMutation.isPending}
          className={`text-sm px-4 py-2 rounded-lg border border-white/10 transition-colors ${
            suggestMutation.isPending ? 'text-zinc-600 cursor-not-allowed' : `${tk.accent3} border-violet-500/20 hover:border-violet-500/40`
          }`}
        >
          {suggestMutation.isPending ? 'Asking Claude…' : 'Suggest categories'}
        </button>
        <button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
          className={`text-sm px-4 py-2 rounded-lg border border-white/10 transition-colors ${
            applyMutation.isPending ? 'text-zinc-600 cursor-not-allowed' : `${tk.accent} hover:border-amber-500/30`
          }`}
        >
          {applyMutation.isPending ? 'Applying…' : 'Apply rules to all transactions'}
        </button>
        {applyResult !== null && <span className="text-xs text-zinc-500">{applyResult} rows updated</span>}
        {suggestMessage && <span className="text-xs text-zinc-500">{suggestMessage}</span>}
      </div>

      {/* Pending suggestions */}
      {suggestionsFetched && suggestions.length === 0 && !suggestionsPending && !suggestMutation.isPending && (
        <div className="mb-10 text-sm text-zinc-600">No pending suggestions.</div>
      )}

      {!suggestionsPending && suggestions.length > 0 && (
        <div className="mb-10">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-1">Pending review · {suggestions.length}</div>
          <div className="text-xs text-zinc-700 mb-4 flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" /> ≥80% confidence</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" /> 50–79%</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-600" /> &lt;50%</span>
          </div>

          {txnSuggestions.length > 0 && (
            <div className="mb-6">
              <div className="text-xs text-zinc-700 mb-3">Transaction assignments</div>
              {txnSuggestions.map(s => (
                <SuggestionRow
                  key={s.id}
                  s={s}
                  onApprove={() => approveMutation.mutate(s.id)}
                  onDismiss={() => dismissMutation.mutate(s.id)}
                  onSaveAsRule={() => prefillFromSuggestion(s)}
                />
              ))}
            </div>
          )}

          {ruleSuggestions.length > 0 && (
            <div className="mb-6">
              <div className="text-xs text-zinc-700 mb-3">Proposed rules</div>
              {ruleSuggestions.map(s => (
                <SuggestionRow
                  key={s.id}
                  s={s}
                  onApprove={() => approveRuleSuggestion(s)}
                  onDismiss={() => dismissMutation.mutate(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Existing rules */}
      {!rulesPending && categoryRules.length > 0 && (
        <div className="mb-8">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-4">Categories &amp; Recurring</div>
          {categoryRules.map(r => (
            <RuleRow key={r.id} rule={r} onEdit={startEdit} onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}

      {!rulesPending && internalRules.length > 0 && (
        <div className="mb-8">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-4">Internal Transfers</div>
          {internalRules.map(r => (
            <RuleRow key={r.id} rule={r} onEdit={startEdit} onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}

      {rulesPending && <div className="py-10 text-sm text-zinc-600 text-center">Loading…</div>}

      {/* Add / Edit form */}
      {!showForm && (
        <button
          onClick={() => setForm(f => ({ ...f, pattern: ' ' }))}
          className="text-sm text-zinc-600 hover:text-zinc-300 transition-colors mt-4"
        >
          + add rule
        </button>
      )}

      {showForm && (
        <div className="mt-8 bg-white/5 rounded-2xl p-6 space-y-4">
          <div className="text-sm text-zinc-400 mb-2">{editing ? 'Edit rule' : 'New rule'}</div>

          <div>
            <label className="text-xs text-zinc-600 block mb-1">Pattern (case-insensitive substring match)</label>
            <input
              type="text"
              value={form.pattern}
              onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
              placeholder="e.g. STARBUCKS or RoundUps"
              className="w-full bg-transparent border-b border-white/10 text-zinc-200 text-sm pb-2 focus:outline-none focus:border-amber-500/30 transition-colors placeholder-zinc-700"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-600 block mb-1">Category</label>
            <input
              type="text"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Food and Drink, Bills, Shopping"
              className="w-full bg-transparent border-b border-white/10 text-zinc-200 text-sm pb-2 focus:outline-none focus:border-amber-500/30 transition-colors placeholder-zinc-700"
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_recurring}
                onChange={e => setForm(f => ({ ...f, is_recurring: e.target.checked }))}
                className="accent-violet-400"
              />
              <span className="text-sm text-zinc-400">Recurring</span>
            </label>
            {form.is_recurring && (
              <select
                value={form.cadence}
                onChange={e => setForm(f => ({ ...f, cadence: e.target.value }))}
                className="bg-zinc-900 border border-white/10 text-zinc-300 text-sm rounded px-2 py-1 focus:outline-none"
              >
                {CADENCES.map(c => (
                  <option key={c} value={c}>{c || '— select cadence —'}</option>
                ))}
              </select>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_internal}
              onChange={e => setForm(f => ({ ...f, is_internal: e.target.checked }))}
              className="accent-zinc-500"
            />
            <span className="text-sm text-zinc-400">Internal transfer (exclude from spend/income)</span>
          </label>

          <div>
            <label className="text-xs text-zinc-600 block mb-1">Notes (optional)</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. SoFi vault auto-transfer"
              className="w-full bg-transparent border-b border-white/10 text-zinc-400 text-sm pb-2 focus:outline-none focus:border-amber-500/30 transition-colors placeholder-zinc-700"
            />
          </div>

          <div className="flex gap-4 pt-2">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.pattern.trim()}
              className={`text-sm px-4 py-2 rounded-lg transition-colors ${
                saveMutation.isPending || !form.pattern.trim()
                  ? 'text-zinc-700 cursor-not-allowed'
                  : `${tk.accent} border border-amber-500/20 hover:border-amber-500/40`
              }`}
            >
              {saveMutation.isPending ? 'Saving…' : editing ? 'Update rule' : 'Add rule'}
            </button>
            <button onClick={cancelEdit} className="text-sm text-zinc-600 hover:text-zinc-300 transition-colors">
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
