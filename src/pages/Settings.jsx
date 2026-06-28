import { useState, useEffect } from 'react'
import ManageListModal from '../components/ManageListModal'
import UsersAdmin from '../components/UsersAdmin'
import { useAuth } from '../lib/auth'
import {
  APP_VERSION,
  CURRENCY_OPTIONS,
  getTheme, setTheme,
  getCurrency, setCurrency,
  getBusiness, setBusiness,
  getThresholds, setThresholds,
  money,
} from '../lib/settings'

const TABS = ['Appearance', 'Business', 'Data', 'About']

const DATA_LISTS = [
  { type: 'storage',           label: 'Storage Locations' },
  { type: 'payment_method',    label: 'Payment Methods' },
  { type: 'item_category',     label: 'Item Categories' },
  { type: 'item_base',         label: 'Item Names' },
  { type: 'brand',             label: 'Brands' },
  { type: 'supplier',          label: 'Suppliers' },
  { type: 'source',            label: 'Sources' },
  { type: 'delivery_category', label: 'Delivery Categories' },
]

export default function Settings() {
  const { isAdmin, activeLocation } = useAuth()
  const tabs = isAdmin ? [...TABS, 'Users'] : TABS
  const [tab, setTab] = useState('Appearance')

  const [theme, setThemeState] = useState(getTheme())
  const [currency, setCurrencyState] = useState(getCurrency())
  const [business, setBusinessState] = useState(getBusiness(activeLocation))
  const [savedBiz, setSavedBiz] = useState(false)
  const [thresh, setThreshState] = useState(getThresholds(activeLocation))

  // Re-read per-branch settings when the active branch changes
  useEffect(() => {
    setBusinessState(getBusiness(activeLocation))
    setThreshState(getThresholds(activeLocation))
  }, [activeLocation])

  function changeThresh(k, v) {
    const next = { ...thresh, [k]: Number(v) || 0 }
    setThreshState(next)
    setThresholds(next, activeLocation)
  }

  const [manageList, setManageList] = useState(null) // { type, label } | null

  function chooseTheme(t) {
    setThemeState(t)
    setTheme(t)
  }

  function chooseCurrency(sym) {
    setCurrencyState(sym)
    setCurrency(sym)
  }

  function saveBusiness(e) {
    e.preventDefault()
    setBusiness(business, activeLocation)
    setSavedBiz(true)
    setTimeout(() => setSavedBiz(false), 2000)
  }

  function bizField(k, v) {
    setBusinessState((b) => ({ ...b, [k]: v }))
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-6">Settings</h1>

      {/* Tabs — scroll horizontally on small screens */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === t
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Appearance ── */}
      {tab === 'Appearance' && (
        <div className="space-y-6">
          <Section title="Theme" desc="Choose how the app looks on this device.">
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              {['light', 'dark'].map((t) => (
                <button
                  key={t}
                  onClick={() => chooseTheme(t)}
                  className={`px-5 py-2 text-sm font-medium capitalize ${
                    theme === t ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  {t === 'light' ? '☀ Light' : '☾ Dark'}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Currency" desc="Symbol used for all money amounts. Applies as pages reload.">
            <select
              value={currency}
              onChange={(e) => chooseCurrency(e.target.value)}
              className="w-full max-w-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c.symbol} value={c.symbol}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Preview: <span className="font-semibold text-gray-700 dark:text-gray-200">{money(1234.5)}</span></p>
          </Section>

          <Section title="Stock Level Thresholds" desc={`Per-branch (${activeLocation}). Item-level on-hand #boxes drive the inventory status flags. Sufficient is anything above the Low line.`}>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">🔴 Critical at/below (boxes)</label>
                <input type="number" step="any" value={thresh.critical} onChange={(e) => changeThresh('critical', e.target.value)}
                  className="w-36 sm:w-40 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">🟠 Low at/below (boxes)</label>
                <input type="number" step="any" value={thresh.low} onChange={(e) => changeThresh('low', e.target.value)}
                  className="w-36 sm:w-40 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 pb-2">🟢 Sufficient &gt; {thresh.low} boxes</p>
            </div>
          </Section>
        </div>
      )}

      {/* ── Business ── */}
      {tab === 'Business' && (
        <form onSubmit={saveBusiness} className="space-y-4 max-w-lg">
          <Section title="Business Information" desc={`Per-branch (${activeLocation}). Shown on invoice headers and printouts (future).`}>
            <div className="space-y-3">
              <BizInput label="Company Name" value={business.name ?? ''} onChange={(v) => bizField('name', v)} />
              <BizInput label="Address" value={business.address ?? ''} onChange={(v) => bizField('address', v)} />
              <div className="grid grid-cols-2 gap-3">
                <BizInput label="Phone" value={business.phone ?? business.contact ?? ''} onChange={(v) => bizField('phone', v)} />
                <BizInput label="Email" value={business.email ?? ''} onChange={(v) => bizField('email', v)} />
              </div>
            </div>
          </Section>
          <div className="flex items-center gap-3">
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
              Save
            </button>
            {savedBiz && <span className="text-sm text-green-600">Saved ✓</span>}
          </div>
        </form>
      )}

      {/* ── Data ── */}
      {tab === 'Data' && (
        <Section title="Manage Lists" desc="Edit the dropdown options used across the app.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DATA_LISTS.map((l) => (
              <button
                key={l.type}
                onClick={() => setManageList(l)}
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-sm text-gray-700 dark:text-gray-200"
              >
                {l.label}
                <span className="text-blue-600 text-xs">Manage →</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* ── About ── */}
      {tab === 'About' && (
        <Section title="About" desc="">
          <dl className="text-sm divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <Row k="App" v="ZL Business Solutions" />
            <Row k="Version" v={APP_VERSION} />
            <Row k="Stack" v="React · Vite · Tailwind · Supabase · Vercel" />
            <Row k="Location" v="Iloilo, Philippines" />
          </dl>
        </Section>
      )}

      {/* ── Users (admin only) ── */}
      {tab === 'Users' && isAdmin && <UsersAdmin />}

      {manageList && (
        <ManageListModal
          listType={manageList.type}
          title={`Manage ${manageList.label}`}
          onClose={() => setManageList(null)}
          onChange={() => {}}
        />
      )}
    </div>
  )
}

function Section({ title, desc, children }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
      {desc && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">{desc}</p>}
      {!desc && <div className="mb-3" />}
      {children}
    </div>
  )
}

function BizInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between px-4 py-2.5 bg-white dark:bg-gray-800">
      <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
      <dd className="text-gray-800 dark:text-gray-100 font-medium text-right">{v}</dd>
    </div>
  )
}
