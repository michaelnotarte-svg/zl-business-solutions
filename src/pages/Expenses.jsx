import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import AttributionNote from '../components/AttributionNote'
import { money } from '../lib/settings'

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  description: '',
  amount: '',
  category: '',
  is_recurring: false,
}

const PAGE_SIZE = 10

function fmt(n) {
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Returns [start, end] ISO strings for week (Mon–Sun), month, and quarter containing `now`
function periodRanges(now) {
  const y = now.getFullYear()
  const m = now.getMonth()

  // Week: Monday → Sunday
  const dow = (now.getDay() + 6) % 7 // 0 = Monday
  const monday = new Date(y, m, now.getDate() - dow)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)

  // Quarter
  const q = Math.floor(m / 3)

  return {
    week:    [localISO(monday), localISO(sunday)],
    month:   [localISO(new Date(y, m, 1)), localISO(new Date(y, m + 1, 0))],
    quarter: [localISO(new Date(y, q * 3, 1)), localISO(new Date(y, q * 3 + 3, 0))],
  }
}

export default function Expenses() {
  const { activeLocation, canWrite } = useAuth()
  const canEdit = canWrite('Expense')
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editRec, setEditRec] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const [catModalOpen, setCatModalOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  const [catError, setCatError] = useState('')
  const [deleteCatTarget, setDeleteCatTarget] = useState(null)

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [search, setSearch] = useState('')
  const hasDateFilter = !!(dateFrom || dateTo)
  const anyFilter = hasDateFilter || catFilter !== 'All' || !!search
  const [page, setPage] = useState(1)

  function resetFilters() {
    setDateFrom(''); setDateTo(''); setCatFilter('All'); setSearch(''); setPage(1)
  }

  useEffect(() => { fetchAll() }, [activeLocation])

  async function fetchAll() {
    setLoading(true)
    const [{ data: expData }, { data: catData }] = await Promise.all([
      supabase.from('expenses').select('*').eq('location', activeLocation).order('date', { ascending: false }),
      supabase.from('expense_categories').select('*').order('name'),
    ])
    setExpenses(expData ?? [])
    setCategories(catData ?? [])
    setLoading(false)
  }

  async function fetchCategories() {
    const { data } = await supabase.from('expense_categories').select('*').order('name')
    setCategories(data ?? [])
  }

  const filtered = expenses.filter((e) => {
    const q = search.toLowerCase()
    const matchSearch = !q || e.description?.toLowerCase().includes(q) || e.category?.toLowerCase().includes(q)
    const matchCat = catFilter === 'All' || e.category === catFilter
    const matchDate = (!dateFrom || e.date >= dateFrom) && (!dateTo || e.date <= dateTo)
    return matchSearch && matchCat && matchDate
  })

  // Recurring entries always pinned at top (independent of the date filter)
  const recurring = expenses.filter((e) => e.is_recurring)
  // Regular entries respect the date filter, newest first (query already sorts desc)
  const regular = filtered.filter((e) => !e.is_recurring)
  const regularTotal = regular.reduce((s, e) => s + Number(e.amount), 0)
  const monthTotal = filtered.reduce((s, e) => s + Number(e.amount), 0)

  const totalPages = Math.max(1, Math.ceil(regular.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pagedRegular = regular.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  // ── KPI totals (always based on today, independent of the month filter) ──
  const ranges = periodRanges(new Date())
  const sumRange = ([start, end]) =>
    expenses.reduce((s, e) => (e.date >= start && e.date <= end ? s + Number(e.amount) : s), 0)
  const kpiWeek    = sumRange(ranges.week)
  const kpiMonth   = sumRange(ranges.month)
  const kpiQuarter = sumRange(ranges.quarter)

  // ── Expense CRUD ─────────────────────────────────────────
  function set(field, value) { setForm((f) => ({ ...f, [field]: value })) }

  function openAdd() {
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) })
    setEditId(null)
    setEditRec(null)
    setError('')
    setModalOpen(true)
  }

  function openEdit(e) {
    setForm({
      date: e.date,
      description: e.description,
      amount: e.amount,
      category: e.category ?? '',
      is_recurring: e.is_recurring ?? false,
    })
    setEditId(e.id)
    setEditRec(e)
    setError('')
    setModalOpen(true)
  }

  async function handleSave(ev) {
    ev.preventDefault()
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (!form.amount) { setError('Amount is required.'); return }
    setSaving(true)
    setError('')
    const payload = {
      location: activeLocation,
      date: form.date,
      description: form.description.trim(),
      amount: Number(form.amount),
      category: form.category || null,
      is_recurring: form.is_recurring,
    }
    let err
    if (editId) {
      ;({ error: err } = await supabase.from('expenses').update(payload).eq('id', editId))
    } else {
      ;({ error: err } = await supabase.from('expenses').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setModalOpen(false)
    fetchAll()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.from('expenses').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    fetchAll()
  }

  // ── Category CRUD ─────────────────────────────────────────
  async function handleAddCategory(ev) {
    ev.preventDefault()
    if (!newCatName.trim()) { setCatError('Name is required.'); return }
    setSavingCat(true)
    setCatError('')
    const { error: err } = await supabase.from('expense_categories').insert({ name: newCatName.trim() })
    setSavingCat(false)
    if (err) { setCatError(err.message); return }
    setNewCatName('')
    fetchCategories()
  }

  async function handleDeleteCategory() {
    if (!deleteCatTarget) return
    await supabase.from('expense_categories').delete().eq('id', deleteCatTarget.id)
    setDeleteCatTarget(null)
    fetchCategories()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Expenses</h1>
        {canEdit && (
        <button
          onClick={openAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Add Expense
        </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="This Week" sublabel={`${ranges.week[0]} → ${ranges.week[1]}`} value={kpiWeek} accent="blue" />
        <KpiCard label="This Month" sublabel={ranges.month[0].slice(0, 7)} value={kpiMonth} accent="indigo" />
        <KpiCard label="This Quarter" sublabel={`Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`} value={kpiQuarter} accent="teal" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <input
          type="text"
          placeholder="Search description or category…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 min-w-44 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={catFilter}
          onChange={(e) => { setCatFilter(e.target.value); setPage(1) }}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Categories</option>
          {categories.map((c) => <option key={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-gray-400 text-xs">→</span>
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {anyFilter && <button onClick={resetFilters} className="text-xs text-blue-600 hover:underline">Reset filters</button>}
        {anyFilter && (
          <span className="ml-auto text-sm font-semibold text-gray-700 dark:text-gray-200">Total: {money(monthTotal)}</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">Loading…</p>
      ) : (
        <>
          {/* ── Recurring (pinned) ── */}
          {recurring.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/40">
              <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                <span className="text-amber-600">🔁</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Recurring</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-amber-100">
                  {recurring.map((e) => (
                    <ExpenseRow key={e.id} e={e} canEdit={canEdit} onEdit={openEdit} onDelete={setDeleteTarget} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Regular (paginated) ── */}
          {regular.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">No expenses found.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="text-left px-5 py-3">Date</th>
                    <th className="text-left px-5 py-3">Description</th>
                    <th className="text-left px-5 py-3">Category</th>
                    <th className="text-right px-5 py-3">Amount</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {pagedRegular.map((e) => (
                    <ExpenseRow key={e.id} e={e} canEdit={canEdit} onEdit={openEdit} onDelete={setDeleteTarget} />
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <td colSpan={3} className="px-5 py-3 text-right text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wide font-semibold">
                      {hasDateFilter ? 'Range Total' : 'Grand Total'}
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-gray-800 dark:text-gray-100">{money(regularTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-sm">
                  <span className="text-gray-400 dark:text-gray-500 text-xs">
                    Showing {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, regular.length)} of {regular.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={pageSafe <= 1}
                      className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      ←
                    </button>
                    <span className="px-2 text-gray-500 dark:text-gray-400 text-xs">Page {pageSafe} / {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={pageSafe >= totalPages}
                      className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editId ? 'Edit Expense' : 'Add Expense'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-4 space-y-3">
              {error && <p className="text-red-500 text-xs">{error}</p>}

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Description *</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Amount *</label>
                <input
                  type="number"
                  step="any"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Category</label>
                  <button
                    type="button"
                    onClick={() => { setCatError(''); setNewCatName(''); setCatModalOpen(true) }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Manage categories
                  </button>
                </div>
                <select
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— None —</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={(e) => set('is_recurring', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">Recurring expense</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500">(pinned at top of the list)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {editRec && <AttributionNote record={editRec} className="pt-1" />}
            </form>
          </div>
        </div>
      )}

      {/* ── Manage Categories Modal ── */}
      {catModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Manage Categories</h2>
              <button onClick={() => setCatModalOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Add new */}
              <form onSubmit={handleAddCategory} className="flex gap-2">
                <input
                  type="text"
                  placeholder="New category name…"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={savingCat}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg"
                >
                  Add
                </button>
              </form>
              {catError && <p className="text-red-500 text-xs">{catError}</p>}

              {/* List */}
              <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                {categories.length === 0 && (
                  <li className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">No categories yet.</li>
                )}
                {categories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <span className="text-sm text-gray-700 dark:text-gray-200">{c.name}</span>
                    <button
                      onClick={() => setDeleteCatTarget(c)}
                      className="text-red-400 hover:text-red-600 text-xs"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex justify-end">
                <button onClick={() => setCatModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Expense Confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Delete expense?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-700 dark:text-gray-200">{deleteTarget.description}</span> — {money(deleteTarget.amount)} will be removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Category Confirm ── */}
      {deleteCatTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Remove category?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-700 dark:text-gray-200">{deleteCatTarget.name}</span> will be removed. Existing expenses using this category are not affected.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteCatTarget(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={handleDeleteCategory} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const ACCENTS = {
  blue:   'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10',
  indigo: 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10',
  teal:   'border-teal-200 bg-teal-50 dark:border-teal-500/30 dark:bg-teal-500/10',
}

function ExpenseRow({ e, canEdit, onEdit, onDelete }) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
      <td className="px-5 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{e.date}</td>
      <td className="px-5 py-3 text-gray-800 dark:text-gray-100">{e.description}</td>
      <td className="px-5 py-3">
        {e.category
          ? <span className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-2 py-0.5 rounded-full">{e.category}</span>
          : <span className="text-gray-400 dark:text-gray-500">—</span>}
      </td>
      <td className="px-5 py-3 text-right font-medium text-gray-800 dark:text-gray-100">{money(e.amount)}</td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {canEdit && <button onClick={() => onEdit(e)} className="text-blue-600 hover:underline text-xs mr-3">Edit</button>}
        {canEdit && <button onClick={() => onDelete(e)} className="text-red-500 hover:underline text-xs">Delete</button>}
      </td>
    </tr>
  )
}

function KpiCard({ label, sublabel, value, accent }) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${ACCENTS[accent] ?? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{money(value)}</p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{sublabel}</p>
    </div>
  )
}
