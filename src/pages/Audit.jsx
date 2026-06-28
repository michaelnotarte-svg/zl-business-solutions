import { useEffect, useState } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// Tables the audit/recycle features cover (must match the SQL whitelist).
const TABLES = [
  ['invoices', 'Sales (invoices)'],
  ['invoice_lines', 'Sales lines'],
  ['partial_payments', 'Payments'],
  ['purchase_orders', 'Stocks (deliveries)'],
  ['stock_entries', 'Stock lines'],
  ['expenses', 'Expenses'],
  ['customers', 'Customers'],
  ['items', 'Items'],
  ['inventory_adjustments', 'Inventory adjustments'],
  ['oversell_overrides', 'Oversell overrides'],
]
const LABEL = Object.fromEntries(TABLES.map(([k, v]) => [k, v]))

const ACTION_STYLE = {
  INSERT:      'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  UPDATE:      'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  SOFT_DELETE: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  RESTORE:     'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  DELETE:      'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200',
}
// Group SOFT_DELETE + DELETE under "deleted" for the summary
const bucketOf = (a) => (a === 'INSERT' ? 'added' : a === 'UPDATE' ? 'edited' : a === 'RESTORE' ? 'restored' : 'deleted')

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const fmtTime = (ts) => new Date(ts).toLocaleString()

// Best-effort one-line label for a row's JSON snapshot.
function rowLabel(j) {
  if (!j) return ''
  return j.invoice_number || j.po_number || j.display_name || j.business_name || j.name || j.description || j.reason || j.id?.slice(0, 8) || ''
}

export default function Audit() {
  const { canAudit, isAdmin, profileName } = useAuth()
  const [tab, setTab] = useState('logs')

  if (!canAudit) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">The Audit view requires the Audit tag.</p>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Audit</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500">Activity logs and deleted-record recovery.</p>
      </div>

      <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden mb-5">
        {[['logs', 'Activity Logs'], ['recycle', 'Recycle Bin']].map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm font-medium ${tab === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'logs'
        ? <Logs profileName={profileName} />
        : <Recycle isAdmin={isAdmin} profileName={profileName} />}
    </div>
  )
}

// ── Activity Logs ───────────────────────────────────────────
function Logs({ profileName }) {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [table, setTable] = useState('All')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openUser, setOpenUser] = useState(null)

  useEffect(() => { load() }, [from, to, table])

  async function load() {
    setLoading(true)
    const data = await selectAll(() => {
      let q = supabase.from('audit_log').select('*')
        .gte('changed_at', `${from}T00:00:00`).lte('changed_at', `${to}T23:59:59`)
        .order('changed_at', { ascending: false })
      if (table !== 'All') q = q.eq('table_name', table)
      return q
    })
    setRows(data)
    setLoading(false)
  }

  // Per-user summary
  const byUser = {}
  for (const r of rows) {
    const u = r.user_id || 'system'
    const s = byUser[u] || (byUser[u] = { added: 0, edited: 0, deleted: 0, restored: 0, total: 0 })
    s[bucketOf(r.action)]++; s.total++
  }
  const users = Object.entries(byUser).sort((a, b) => b[1].total - a[1].total)
  const userRows = openUser ? rows.filter((r) => (r.user_id || 'system') === openUser) : []

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        <Field label="Category">
          <select value={table} onChange={(e) => setTable(e.target.value)} className={inputCls}>
            <option value="All">All categories</option>
            {TABLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      {loading ? <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading…</p> : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 mb-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-right px-4 py-3">Added</th>
                  <th className="text-right px-4 py-3">Edited</th>
                  <th className="text-right px-4 py-3">Deleted</th>
                  <th className="text-right px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {users.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-gray-400 dark:text-gray-500 py-8">No activity in this range.</td></tr>
                ) : users.map(([uid, s]) => (
                  <tr key={uid} onClick={() => setOpenUser(openUser === uid ? null : uid)}
                    className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700/40 ${openUser === uid ? 'bg-blue-50 dark:bg-gray-700/40' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">{uid === 'system' ? 'system' : profileName(uid)}</td>
                    <td className="px-4 py-2.5 text-right text-green-700 dark:text-green-400">{s.added || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-blue-700 dark:text-blue-400">{s.edited || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-red-600 dark:text-red-400">{s.deleted || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-200">{s.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {openUser && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200">
                {openUser === 'system' ? 'system' : profileName(openUser)} · {userRows.length} entries
              </div>
              <table className="w-full text-sm">
                <thead className="text-gray-400 dark:text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">Action</th>
                    <th className="text-left px-4 py-2">Category</th>
                    <th className="text-left px-4 py-2">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {userRows.slice(0, 300).map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtTime(r.changed_at)}</td>
                      <td className="px-4 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLE[r.action] ?? ''}`}>{r.action}</span></td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{LABEL[r.table_name] ?? r.table_name}</td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{rowLabel(r.new_data || r.old_data)} {r.location ? <span className="text-gray-400 dark:text-gray-500 text-xs">· {r.location}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Recycle Bin ─────────────────────────────────────────────
function Recycle({ isAdmin, profileName }) {
  const [table, setTable] = useState('invoices')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [table])

  async function load() {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('list_deleted', { p_table: table })
    if (err) setError(err.message)
    setRows((data ?? []).map((j) => (typeof j === 'string' ? JSON.parse(j) : j)))
    setLoading(false)
  }

  async function restore(id) {
    setBusy(id)
    const { error: err } = await supabase.rpc('restore_row', { p_table: table, p_id: id })
    setBusy(null)
    if (err) { setError(err.message); return }
    load()
  }

  async function hardDelete(id) {
    if (!window.confirm('Permanently delete this record? This cannot be undone.')) return
    setBusy(id)
    const { error: err } = await supabase.rpc('hard_delete_row', { p_table: table, p_id: id })
    setBusy(null)
    if (err) { setError(err.message); return }
    load()
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Category">
          <select value={table} onChange={(e) => setTable(e.target.value)} className={inputCls}>
            {TABLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Record</th>
              <th className="text-left px-4 py-3">Deleted</th>
              <th className="text-left px-4 py-3">By</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={4} className="text-center text-gray-400 dark:text-gray-500 py-8">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-gray-400 dark:text-gray-500 py-8">Nothing deleted here.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{rowLabel(r)} {r.location ? <span className="text-gray-400 dark:text-gray-500 text-xs">· {r.location}</span> : null}</td>
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.deleted_at ? fmtTime(r.deleted_at) : '—'}</td>
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{profileName(r.deleted_by)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => restore(r.id)} disabled={busy === r.id}
                    className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-3 py-1 rounded-lg">Restore</button>
                  <button onClick={() => hardDelete(r.id)} disabled={busy === r.id}
                    className="ml-2 text-xs border border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 rounded-lg">Delete forever</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}
