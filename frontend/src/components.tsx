import type { ReactNode } from 'react'

// Coach voice — violet, italic, left-bordered
export function CoachNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-violet-500/30 pl-5 py-1 my-6">
      <p className="text-sm text-violet-300/90 italic leading-7">{children}</p>
    </div>
  )
}

// Arc progress indicator — 75% sweep, color shifts with health
export function Arc({
  value,
  max,
  size = 120,
  label,
  sublabel,
}: {
  value: number
  max: number
  size?: number
  label?: string
  sublabel?: string
}) {
  const r = size / 2 - 10
  const circ = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const sweep = 0.75
  const trackLen = circ * sweep
  const fillLen = trackLen * pct

  // orange → amber → emerald as health improves (lower utilization = better)
  const health =
    pct > 0.7 ? '#fb923c'
    : pct > 0.4 ? '#f5a623'
    : '#4ade80'

  const glowColor =
    pct > 0.7 ? 'rgba(251,146,60,0.5)'
    : pct > 0.4 ? 'rgba(245,166,35,0.5)'
    : 'rgba(74,222,128,0.5)'

  return (
    <div className="flex flex-col items-center gap-2">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(135deg)' }}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
            strokeDasharray={`${trackLen} ${circ - trackLen}`}
            strokeLinecap="round"
          />
          {/* Fill */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={health}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${fillLen} ${circ - fillLen}`}
            style={{
              filter: `drop-shadow(0 0 6px ${glowColor})`,
              transition: 'stroke-dasharray 0.8s ease, stroke 0.8s ease',
            }}
          />
        </svg>
        {/* Center label */}
        {label && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="text-sm font-bold text-zinc-200 tabular-nums">{label}</span>
            {sublabel && <span className="text-xs text-zinc-500 mt-0.5">{sublabel}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// Celebration glow — a small upward arc shown next to an improving metric
export function Improving({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium"
      style={{ filter: 'drop-shadow(0 0 6px rgba(74,222,128,0.6))' }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 8 Q5 2 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M6 2 L8 2 L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      {label}
    </span>
  )
}

// Warm background glow — the ambient light behind key content
export function WarmGlow() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background:
          'radial-gradient(ellipse 60% 40% at 55% 30%, rgba(26,20,8,0.9) 0%, transparent 70%)',
      }}
    />
  )
}
