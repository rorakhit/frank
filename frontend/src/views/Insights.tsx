import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from '../theme'
import { api, type Insight } from '../api'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n)
}

function InsightDetail({ insight }: { insight: Insight }) {
  const { tokens: tk } = useTheme()
  const [showThinking, setShowThinking] = useState(false)

  const periodLabel = insight.period_type.charAt(0).toUpperCase() + insight.period_type.slice(1)
  const dateRange   = `${insight.period_start.slice(0, 10)} – ${insight.period_end.slice(0, 10)}`

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-xl mx-auto px-10 py-14">

        {/* Masthead */}
        <div className="mb-10 pb-8 border-b border-white/5">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-3">{periodLabel} · {dateRange}</div>
          <div className="text-xs text-zinc-700">
            {insight.model || 'unknown model'}
            {insight.input_tokens > 0 && (
              <> · <span className={tk.accent3}>{fmt(insight.input_tokens)}</span> in / <span className={tk.accent3}>{fmt(insight.output_tokens)}</span> out</>
            )}
          </div>
        </div>

        {/* Analysis — the essay */}
        <div className="mb-12">
          <p className="text-base text-zinc-300 leading-[1.9] whitespace-pre-wrap">{insight.raw_analysis}</p>
        </div>

        {/* Key findings — numbered, accent-rotated */}
        {insight.key_findings?.length > 0 && (
          <div className="mb-12">
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-6">Key findings</div>
            <div className="space-y-6">
              {insight.key_findings.map((f, i) => {
                const numColor = i % 3 === 0 ? tk.accent : i % 3 === 1 ? tk.accent2 : tk.accent3
                return (
                  <div key={i} className="flex gap-4">
                    <span className={`text-lg font-bold shrink-0 tabular-nums leading-tight ${numColor}`} style={{
                      textShadow: i % 3 === 0 ? '0 0 20px rgba(245,166,35,0.4)'
                               : i % 3 === 1 ? '0 0 20px rgba(74,222,128,0.4)'
                               : '0 0 20px rgba(167,139,250,0.4)'
                    }}>
                      {i + 1}
                    </span>
                    <p className="text-sm text-zinc-300 leading-7 pt-0.5">{f}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Claude's reasoning — collapsible, understated */}
        {insight.thinking_text && (
          <div>
            <button
              onClick={() => setShowThinking(v => !v)}
              className="flex items-center gap-2 text-xs text-zinc-600 hover:text-violet-400 transition-colors mb-4"
            >
              <span>{showThinking ? '▾' : '▸'}</span>
              How I got here
            </button>
            {showThinking && (
              <div className="border-l border-violet-500/20 pl-5">
                <p className="text-xs text-zinc-600 leading-6 whitespace-pre-wrap font-mono">{insight.thinking_text}</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

export default function Insights() {
  const { tokens: tk } = useTheme()
  const qc = useQueryClient()
  const { data: insights = [], isPending } = useQuery({ queryKey: ['insights'], queryFn: api.insights })
  const [selected, setSelected] = useState<Insight | null>(null)
  const [period, setPeriod] = useState<'biweekly' | 'monthly' | 'yearly'>('biweekly')

  const generate = useMutation({
    mutationFn: () => api.generateInsight(period),
    onSuccess: (ins) => {
      qc.invalidateQueries({ queryKey: ['insights'] })
      setSelected(ins)
    },
  })

  const activeInsight = selected ?? insights[0] ?? null

  return (
    <div className="flex h-screen">
      {/* Left column — index */}
      <div className="w-56 shrink-0 border-r border-white/5 flex flex-col bg-[#0d0f14]">
        <div className="p-5 border-b border-white/5">
          <div className="text-xs text-zinc-600 uppercase tracking-widest mb-4">Generate</div>
          <div className="flex gap-2">
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as typeof period)}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-300 focus:outline-none"
            >
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 ${tk.primaryBtn}`}
            >
              {generate.isPending ? '…' : 'Run'}
            </button>
          </div>
          {generate.isPending && (
            <p className="text-xs text-zinc-600 mt-2">Analyzing, ~30s…</p>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {isPending && <div className="p-5 text-xs text-zinc-600">Loading…</div>}
          {insights.map(ins => {
            const isActive = activeInsight?.id === ins.id
            return (
              <button
                key={ins.id}
                onClick={() => setSelected(ins)}
                className={`w-full text-left px-5 py-4 border-b border-white/5 transition-colors hover:bg-white/3 ${
                  isActive ? 'border-l-2 border-l-amber-500/60 pl-4' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold capitalize ${isActive ? tk.accent : 'text-zinc-400'}`}>
                    {ins.period_type}
                  </span>
                  <span className="text-xs text-zinc-700">{ins.generated_at.slice(0, 10)}</span>
                </div>
                <div className="text-xs text-zinc-600">{ins.period_start.slice(0, 10)} – {ins.period_end.slice(0, 10)}</div>
                {ins.key_findings?.length > 0 && (
                  <div className="mt-1.5 text-xs text-zinc-600 line-clamp-2 leading-4">{ins.key_findings[0]}</div>
                )}
              </button>
            )
          })}
          {!isPending && insights.length === 0 && (
            <div className="p-5 text-xs text-zinc-600">No insights yet.</div>
          )}
        </div>
      </div>

      {/* Right — reading pane */}
      {activeInsight
        ? <InsightDetail insight={activeInsight} />
        : (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-sm text-zinc-700">Run your first insight to begin.</span>
          </div>
        )
      }
    </div>
  )
}
