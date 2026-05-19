import { Component, type ReactNode } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { ThemeProvider, useTheme } from './theme'
import { WarmGlow } from './components'

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto px-8 py-16">
          <div className="text-sm text-zinc-600 mb-2">Something went wrong on this page.</div>
          <div className="text-xs text-zinc-700 font-mono">{(this.state.error as Error).message}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs text-zinc-500 hover:text-zinc-300 mt-4 block"
          >reload page</button>
        </div>
      )
    }
    return this.props.children
  }
}
import Dashboard from './views/Dashboard'
import Transactions from './views/Transactions'
import Insights from './views/Insights'
import Debt from './views/Debt'
import Goals from './views/Goals'
import Categorization from './views/Categorization'

const nav = [
  { to: '/',                label: 'Dashboard' },
  { to: '/transactions',    label: 'Transactions' },
  { to: '/insights',        label: 'Insights' },
  { to: '/debt',            label: 'Debt' },
  { to: '/goals',           label: 'Goals' },
  { to: '/categorization',  label: 'Rules' },
]

function Shell() {
  const { tokens: tk } = useTheme()

  return (
    <div className={`min-h-screen ${tk.pageBg} text-zinc-100 flex relative`}>
      <WarmGlow />

      {/* Sidebar */}
      <nav className={`w-48 shrink-0 border-r ${tk.sidebarBorder} ${tk.sidebar} flex flex-col py-8 px-5 relative z-10`}>
        {/* Logo */}
        <div className="mb-10">
          <div
            className={`text-2xl font-bold tracking-tight ${tk.logo}`}
            style={{ textShadow: '0 0 30px rgba(245,166,35,0.4)' }}
          >
            frank
          </div>
          <div className="text-xs text-zinc-700 mt-0.5">personal finance</div>
        </div>

        {/* Nav */}
        <div className="flex flex-col gap-0.5 flex-1">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-2.5 text-sm transition-colors rounded-lg ${isActive ? tk.navActive : tk.navInactive}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Bottom mark */}
        <div className="text-xs text-zinc-800 px-3">frank · yours</div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-auto relative z-10">
        <Routes>
          <Route path="/"             element={<PageErrorBoundary><Dashboard /></PageErrorBoundary>} />
          <Route path="/transactions" element={<PageErrorBoundary><Transactions /></PageErrorBoundary>} />
          <Route path="/insights"     element={<PageErrorBoundary><Insights /></PageErrorBoundary>} />
          <Route path="/debt"         element={<PageErrorBoundary><Debt /></PageErrorBoundary>} />
          <Route path="/goals"        element={<PageErrorBoundary><Goals /></PageErrorBoundary>} />
          <Route path="/categorization" element={<PageErrorBoundary><Categorization /></PageErrorBoundary>} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  )
}
