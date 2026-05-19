import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { Arc, CoachNote } from '../components'
import { api, type Goal } from '../api'

const statusLabel: Record<string, { text: string; color: string }> = {
  savings_rate: { text: 'Savings rate',  color: 'text-emerald-400' },
  spending_cap: { text: 'Spending cap',  color: 'text-amber-400' },
  free_text:    { text: 'Intention',     color: 'text-violet-300' },
}

const horizonLabel: Record<string, string> = {
  monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly',
}

function GoalItem({ goal, onDeactivate }: { goal: Goal; onDeactivate: (id: string) => void }) {
  const meta = statusLabel[goal.type] ?? { text: goal.type, color: 'text-zinc-400' }
  const hasTarget = goal.target_value !== null && goal.type !== 'free_text'

  return (
    <div className={`flex items-start gap-6 py-6 border-b border-white/5 ${!goal.active ? 'opacity-40' : ''}`}>
      {hasTarget && goal.type === 'spending_cap' && (
        <Arc
          value={0}
          max={goal.target_value ?? 1}
          size={80}
          label="—"
          sublabel="spent"
        />
      )}
      {hasTarget && goal.type === 'savings_rate' && (
        <Arc
          value={0}
          max={100}
          size={80}
          label="—"
          sublabel="rate"
        />
      )}
      {!hasTarget && (
        <div className="w-20 h-20 flex items-center justify-center shrink-0">
          <div className="w-3 h-3 rounded-full bg-violet-400/40 shadow-[0_0_10px_rgba(167,139,250,0.4)]" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className={`text-xs font-semibold uppercase tracking-widest mb-1 ${meta.color}`}>
          {meta.text} · {horizonLabel[goal.horizon]}
        </div>
        <div className="text-base text-zinc-200 leading-snug mb-1">{goal.description}</div>
        {goal.target_value !== null && (
          <div className="text-sm text-zinc-500">
            Target:{' '}
            <span className="text-zinc-300">
              {goal.type === 'savings_rate' ? `${goal.target_value}%` : `$${goal.target_value}`}
            </span>
            {goal.category && <> · <span className="text-zinc-400">{goal.category}</span></>}
          </div>
        )}
      </div>

      {goal.active && (
        <button
          onClick={() => onDeactivate(goal.id)}
          className="text-xs text-zinc-700 hover:text-red-400 transition-colors shrink-0 mt-1"
        >
          Remove
        </button>
      )}
    </div>
  )
}

const EMPTY_FORM = {
  type: 'spending_cap' as Goal['type'],
  horizon: 'monthly' as Goal['horizon'],
  description: '',
  target_value: '',
  category: '',
}

export default function Goals() {
  const { tokens: tk } = useTheme()
  const qc = useQueryClient()
  const { data: goals = [], isPending } = useQuery({ queryKey: ['goals'], queryFn: api.goals })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const create = useMutation({
    mutationFn: () => api.createGoal({
      type: form.type,
      horizon: form.horizon,
      description: form.description,
      target_value: form.target_value ? parseFloat(form.target_value) : null,
      category: form.category,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      setShowForm(false)
      setForm(EMPTY_FORM)
    },
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => api.deactivateGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const active   = goals.filter(g => g.active)
  const inactive = goals.filter(g => !g.active)

  return (
    <div className="max-w-2xl mx-auto px-8 py-16">

      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm text-zinc-500 mb-3 tracking-wide">Your intentions</div>
          <div
            className="font-bold tracking-tight text-violet-300 leading-none"
            style={{ fontSize: '56px', textShadow: '0 0 60px rgba(167,139,250,0.2)' }}
          >
            {active.length} {active.length === 1 ? 'goal' : 'goals'}
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className={`mt-4 px-4 py-2 text-sm rounded-xl transition-colors ${
            showForm
              ? 'bg-white/5 text-zinc-400 hover:bg-white/10'
              : tk.primaryBtn
          }`}
        >
          {showForm ? 'Cancel' : '+ Set a goal'}
        </button>
      </div>

      <CoachNote>
        {active.length === 0
          ? `Goals give frank something to anchor its guidance to. Without them, the advice is generic. Set even one and the coaching gets personal immediately.`
          : `These intentions shape every insight frank generates. The more specific your goals, the more targeted the guidance becomes.`
        }
      </CoachNote>

      {/* Create form */}
      {showForm && (
        <div className="bg-white/5 rounded-2xl p-6 mb-10">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-5">New goal</div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-zinc-600 block mb-2">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as Goal['type'] }))}
                className={`w-full px-3 py-2 text-sm focus:outline-none ${tk.select}`}
              >
                <option value="spending_cap">Spending cap</option>
                <option value="savings_rate">Savings rate</option>
                <option value="free_text">Free intention</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-600 block mb-2">Horizon</label>
              <select
                value={form.horizon}
                onChange={e => setForm(f => ({ ...f, horizon: e.target.value as Goal['horizon'] }))}
                className={`w-full px-3 py-2 text-sm focus:outline-none ${tk.select}`}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs text-zinc-600 block mb-2">Describe it in your own words</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Keep dining under $300 this month"
              className={`w-full px-3 py-2.5 text-sm focus:outline-none ${tk.input}`}
            />
          </div>

          {form.type !== 'free_text' && (
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-xs text-zinc-600 block mb-2">
                  Target {form.type === 'savings_rate' ? '(%)' : '($)'}
                </label>
                <input
                  type="number"
                  value={form.target_value}
                  onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))}
                  className={`w-full px-3 py-2.5 text-sm focus:outline-none ${tk.input}`}
                />
              </div>
              {form.type === 'spending_cap' && (
                <div>
                  <label className="text-xs text-zinc-600 block mb-2">Category (optional)</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Dining"
                    className={`w-full px-3 py-2.5 text-sm focus:outline-none ${tk.input}`}
                  />
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => create.mutate()}
            disabled={!form.description || create.isPending}
            className={`px-5 py-2.5 text-sm rounded-xl disabled:opacity-40 transition-colors ${tk.primaryBtn}`}
          >
            {create.isPending ? 'Saving…' : 'Save goal'}
          </button>
        </div>
      )}

      {isPending && <div className="text-sm text-zinc-600 py-8">Loading…</div>}

      {active.length > 0 && (
        <div className="mb-10">
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-2">Active</div>
          {active.map(g => (
            <GoalItem key={g.id} goal={g} onDeactivate={id => deactivate.mutate(id)} />
          ))}
        </div>
      )}

      {active.length === 0 && !isPending && !showForm && (
        <div className="text-sm text-zinc-700 text-center py-16">
          No goals set yet. Every intention you add sharpens the coaching.
        </div>
      )}

      {inactive.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-2">Past</div>
          {inactive.map(g => (
            <GoalItem key={g.id} goal={g} onDeactivate={id => deactivate.mutate(id)} />
          ))}
        </div>
      )}

    </div>
  )
}
