import { createContext, useContext, useState, type ReactNode } from 'react'

// Single living theme — frank's identity
export type ThemeName = 'frank'

export interface ThemeTokens {
  name: ThemeName
  pageBg: string
  sidebar: string
  sidebarBorder: string
  accent: string       // amber — primary, wealth, warmth
  accent2: string      // emerald — growth, positive
  accent3: string      // violet — coach voice
  caution: string      // orange — attention, not shame
  heading: string
  logo: string
  section: string
  rowDivider: string
  surface: string
  formPanel: string
  navActive: string
  navInactive: string
  primaryBtn: string
  input: string
  select: string
  progressTrack: string
  badge: string
  accentBadge: string
  rowHover: string
  tableHead: string
}

const frank: ThemeTokens = {
  name: 'frank',
  pageBg: 'bg-[#0d0f14]',
  sidebar: 'bg-[#0d0f14]',
  sidebarBorder: 'border-white/5',
  accent: 'text-amber-400',
  accent2: 'text-emerald-400',
  accent3: 'text-violet-300',
  caution: 'text-orange-400',
  heading: 'text-amber-400/80',
  logo: 'text-amber-400',
  section: 'pb-8 mb-8',
  rowDivider: 'divide-white/5',
  surface: 'bg-white/5',
  formPanel: 'bg-white/5 rounded-2xl',
  navActive: 'text-amber-400 font-semibold',
  navInactive: 'text-zinc-500 hover:text-zinc-200',
  primaryBtn: 'bg-amber-500 hover:bg-amber-400 text-[#0d0f14] font-bold',
  input: 'bg-white/5 border border-white/10 rounded-xl text-zinc-200 focus:border-amber-500/40 placeholder-zinc-600',
  select: 'bg-white/5 border border-white/10 rounded-xl text-zinc-200',
  progressTrack: 'bg-white/10',
  badge: 'text-zinc-500',
  accentBadge: 'text-amber-400/80 font-medium',
  rowHover: 'hover:bg-white/3',
  tableHead: 'border-white/5 text-zinc-600',
}

export const THEMES: Record<ThemeName, ThemeTokens> = { frank }

interface ThemeContextValue {
  tokens: ThemeTokens
}

const ThemeContext = createContext<ThemeContextValue>({ tokens: frank })

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={{ tokens: frank }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
