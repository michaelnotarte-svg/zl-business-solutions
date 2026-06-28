import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV = [
  { to: '/snapshot',   label: 'Daily Snapshot', icon: '📊' },
  { to: '/executive',  label: 'Executive Summary', icon: '📈', adminOnly: true },
  { to: '/invoices',   label: 'Invoices',   icon: '🧾' },
  { to: '/stocks',     label: 'Stocks',     icon: '📦' },
  { to: '/inventory',  label: 'Inventory',  icon: '🏬' },
  { to: '/customers',  label: 'Customers',  icon: '👥' },
  { to: '/items',      label: 'Items',      icon: '🥩' },
  { to: '/expenses',   label: 'Expenses',   icon: '💸' },
  { to: '/audit',      label: 'Audit',      icon: '🗂️', auditOnly: true },
  { to: '/settings',   label: 'Settings',   icon: '⚙️' },
]

export default function Layout() {
  const { profile, isAdmin, canAudit, signOut, locations, activeLocation, setActiveLocation } = useAuth()
  const [open, setOpen] = useState(false) // mobile drawer
  const nav = NAV.filter((n) => (!n.adminOnly || isAdmin) && (!n.auditOnly || canAudit))

  const BranchControl = isAdmin ? (
    <select
      value={activeLocation}
      onChange={(e) => setActiveLocation(e.target.value)}
      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {(locations.length ? locations : [activeLocation]).map((l) => <option key={l}>{l}</option>)}
    </select>
  ) : (
    <p className="inline-block bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-medium px-2 py-0.5 rounded-full">📍 {activeLocation}</p>
  )

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center gap-3 h-14 px-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="text-2xl leading-none text-gray-600 dark:text-gray-300">☰</button>
        <p className="font-bold text-gray-800 dark:text-gray-100">ZL Business Solutions</p>
        <div className="ml-auto">{BranchControl}</div>
      </header>

      {/* Drawer overlay (mobile only) */}
      {open && <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />}

      {/* Sidebar — off-canvas drawer on mobile, static on md+ */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transform transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Logo + branch */}
        <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">ZL</p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-100 leading-tight">Business Solutions</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="md:hidden text-xl leading-none text-gray-400 dark:text-gray-500">✕</button>
          </div>
          <div className="mt-2">{BranchControl}</div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white'
                }`
              }
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer — current user */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{profile?.name ?? profile?.email ?? '—'}</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                {isAdmin ? 'Admin' : (profile?.tags?.length ? profile.tags.join(', ') : 'Staff')}
                {profile?.location ? ` · ${profile.location}` : ''}
              </p>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0"
            >
              Sign out
            </button>
          </div>
          <p className="text-[10px] text-gray-300 dark:text-gray-600">v0.2</p>
        </div>
      </aside>

      {/* Main content — pushed below the mobile top bar */}
      <main className="flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  )
}
