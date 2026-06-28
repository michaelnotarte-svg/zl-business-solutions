import { useEffect, useState, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { fetchListNames, STORAGE_FALLBACK } from '../lib/lists'
import ManageListModal from '../components/ManageListModal'
import { getThresholds, stockStatus } from '../lib/settings'
import { useAuth } from '../lib/auth'
import { downloadCSV } from '../lib/csv'
import { fetchMovements } from '../lib/inventory'
import ReportLetterhead from '../components/ReportLetterhead'

const STATUS_STYLE = {
  'Critical':   'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'Low':        'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Sufficient': 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
}

function addDays(iso, n) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const num = (x) => Number(x) || 0
const kg = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const bx = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

const TYPE_STYLE = {
  'Opening':      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  'Stock Dump':   'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  'Sale':         'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'Adjustment':   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Transfer In':  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'Transfer Out': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
}

const PAGE_SIZE = 25

const EMPTY_ADJ = {
  date: new Date().toISOString().slice(0, 10),
  item_id: '',
  storage: 'Everest',
  batch_number: '',
  boxes: '',
  kilos: '',
  reason: '',
}

export default function Inventory() {
  const [moves, setMoves] = useState([])
  const [items, setItems] = useState([])
  const [storageOptions, setStorageOptions] = useState(STORAGE_FALLBACK)
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('warehouse') // 'landing' | 'warehouse'
  const [asOf, setAsOf] = useState('')
  const [expandBatch, setExpandBatch] = useState(false)
  const [sortBy, setSortBy] = useState('boxes') // 'item' | 'kilos' | 'boxes'

  // Ledger filters
  const [fStorage, setFStorage] = useState('All')
  const [fItem, setFItem] = useState('')
  const [lFrom, setLFrom] = useState('')
  const [lTo, setLTo] = useState('')
  const [lPage, setLPage] = useState(1)

  // Adjustment modal
  const [adjOpen, setAdjOpen] = useState(false)
  const [adjForm, setAdjForm] = useState(EMPTY_ADJ)
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjError, setAdjError] = useState('')

  const [manageStorage, setManageStorage] = useState(false)
  const [overrides, setOverrides] = useState([])
  const { isAdmin, activeLocation, canWrite } = useAuth()
  const canAdjust = canWrite('Inventory')

  useEffect(() => { fetchAll(); loadOverrides() }, [activeLocation])

  async function loadOverrides() {
    const { data } = await supabase
      .from('oversell_overrides')
      .select('*')
      .eq('status', 'pending')
      .eq('location', activeLocation)
      .order('created_at', { ascending: false })
    setOverrides(data ?? [])
  }

  async function approveOverride(idv) {
    await supabase.from('oversell_overrides').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', idv)
    loadOverrides()
  }

  async function fetchAll() {
    setLoading(true)
    const [valid, itemRes, storages] = await Promise.all([
      fetchMovements(activeLocation),
      supabase.from('items').select('id, name').eq('location', activeLocation).order('name'),
      fetchListNames('storage', STORAGE_FALLBACK, activeLocation),
    ])

    setMoves(valid)
    setItems(itemRes.data ?? [])
    setStorageOptions(storages)

    const maxDate = valid.reduce((mx, x) => (x.date > mx ? x.date : mx), '')
    setAsOf(maxDate || new Date().toISOString().slice(0, 10))
    setLoading(false)
  }

  // Storage columns: managed list first, then any extras found in data
  const storages = [
    ...storageOptions,
    ...[...new Set(moves.map((m) => m.storage))].filter((s) => s && !storageOptions.includes(s)),
  ]

  // Shared filters (warehouse + item) applied to snapshot, depleted, and ledger
  const fmoves = moves
    .filter((m) => fStorage === 'All' || m.storage === fStorage)
    .filter((m) => !fItem || m.item.toLowerCase().includes(fItem.toLowerCase()))

  // Movements up to the "as of" date
  const upto = fmoves.filter((m) => m.date <= asOf)

  const thresholds = getThresholds(activeLocation)

  // ── Aggregations ─────────────────────────────────────────
  function aggregate(rows, keyFn) {
    const map = new Map()
    for (const m of rows) {
      const k = keyFn(m)
      if (!map.has(k))
        map.set(k, { item: m.item, item_id: m.item_id, batch: m.batch, boxes: 0, kilos: 0, per: {}, batches: new Set(), batchKilos: {} })
      const o = map.get(k)
      o.boxes += m.boxes
      o.kilos += m.kilos
      o.batches.add(m.batch)
      o.batchKilos[m.batch] = (o.batchKilos[m.batch] ?? 0) + m.kilos
      if (!o.per[m.storage]) o.per[m.storage] = { boxes: 0, kilos: 0 }
      o.per[m.storage].boxes += m.boxes
      o.per[m.storage].kilos += m.kilos
    }
    return [...map.values()].sort((a, b) => a.item.localeCompare(b.item) || String(a.batch).localeCompare(String(b.batch)))
  }

  const landingAll = aggregate(upto, (m) => m.item_id)
  const warehouseAll = aggregate(upto, (m) => (expandBatch ? `${m.item_id}|${m.batch}` : m.item_id))

  // Depleted (≈0) stock is shown in the "Depleted" section, not the on-hand table.
  // Negatives (oversold) stay visible as an error state.
  const EPS = 0.005
  const hasStock = (o) => Math.abs(o.kilos) >= EPS
  const sorter = sortBy === 'item'
    ? (a, b) => a.item.localeCompare(b.item)
    : sortBy === 'kilos'
      ? (a, b) => b.kilos - a.kilos || a.item.localeCompare(b.item)
      : (a, b) => b.boxes - a.boxes || a.item.localeCompare(b.item)
  const landing = landingAll.filter(hasStock).sort(sorter)
  const warehouse = warehouseAll.filter(hasStock).sort(sorter)

  // Item-level on-hand totals + status (across batches/warehouses, as of date).
  // Status is driven by #boxes; depleted-detection (below) stays on kilos.
  // Keep the full (unfiltered) kilo map for depleted-detection below.
  const itemKilos = Object.fromEntries(landingAll.map((o) => [o.item_id, o.kilos]))
  const itemBoxes = Object.fromEntries(landingAll.map((o) => [o.item_id, o.boxes]))
  const statusOf = (itemId) => stockStatus(itemBoxes[itemId] ?? 0, thresholds)
  const statusCounts = { Critical: 0, Low: 0, Sufficient: 0 }
  for (const o of landing) statusCounts[stockStatus(o.boxes, thresholds)]++

  // Items depleted on the selected date (crossed from >0 to <=0)
  const itemKilosAt = (cutoff) => {
    const map = {}
    for (const m of fmoves) {
      if (m.date <= cutoff) map[m.item_id] = (map[m.item_id] ?? 0) + m.kilos
    }
    return map
  }
  const nameOf = {}
  for (const m of fmoves) nameOf[m.item_id] = m.item
  const prevKilos = itemKilosAt(addDays(asOf, -1))
  const depletedToday = Object.keys(itemKilos)
    .filter((id) => (prevKilos[id] ?? 0) > 1e-9 && (itemKilos[id] ?? 0) <= 1e-9)
    .map((id) => ({ id, name: nameOf[id], before: prevKilos[id] ?? 0, now: itemKilos[id] ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Ledger with running totals ───────────────────────────
  const asc = fmoves
    .map((m, i) => ({ ...m, _i: i }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i))
  const run = {}
  for (const m of asc) {
    if (!run[m.item_id]) run[m.item_id] = { box: 0, kilos: 0 }
    run[m.item_id].box += m.boxes
    run[m.item_id].kilos += m.kilos
    m.runBox = run[m.item_id].box
    m.runKilos = run[m.item_id].kilos
  }
  const ledgerFiltered = asc
    .filter((m) => (!lFrom || m.date >= lFrom))
    .filter((m) => (!lTo || m.date <= lTo))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._i - a._i))
  const lTotalPages = Math.max(1, Math.ceil(ledgerFiltered.length / PAGE_SIZE))
  const lPageSafe = Math.min(lPage, lTotalPages)
  const ledgerPage = ledgerFiltered.slice((lPageSafe - 1) * PAGE_SIZE, lPageSafe * PAGE_SIZE)

  // ── CSV export (inventory as of) ─────────────────────────
  function exportCSV() {
    const rows = aggregate(upto, (m) => `${m.item_id}|${m.batch}|${m.storage}`).map((o) => ({
      Item: o.item,
      Batch: o.batch,
      Storage: Object.keys(o.per)[0] ?? '',
      Boxes: o.boxes,
      Kilos: o.kilos,
    }))
    downloadCSV(`inventory_as_of_${asOf}.csv`, rows, [
      { key: 'Item', label: 'Item' },
      { key: 'Batch', label: 'Batch #' },
      { key: 'Storage', label: 'Storage' },
      { key: 'Boxes', label: '#Box' },
      { key: 'Kilos', label: '#Kilos' },
    ])
  }

  // ── Adjustment ───────────────────────────────────────────
  async function saveAdjustment(e) {
    e.preventDefault()
    if (!adjForm.item_id) { setAdjError('Select an item.'); return }
    if (adjForm.kilos === '' && adjForm.boxes === '') { setAdjError('Enter a box and/or kilo amount.'); return }
    setAdjSaving(true)
    setAdjError('')
    const { error: err } = await supabase.from('inventory_adjustments').insert({
      location: activeLocation,
      date: adjForm.date,
      item_id: adjForm.item_id,
      storage: adjForm.storage,
      batch_number: adjForm.batch_number.trim() || null,
      boxes: adjForm.boxes === '' ? null : Number(adjForm.boxes),
      kilos: adjForm.kilos === '' ? 0 : Number(adjForm.kilos),
      reason: adjForm.reason.trim() || null,
    })
    setAdjSaving(false)
    if (err) { setAdjError(err.message); return }
    setAdjOpen(false)
    fetchAll()
  }

  const neg = (n) => n < 0

  function printPDF() {
    const wasDark = document.documentElement.classList.contains('dark')
    if (wasDark) document.documentElement.classList.remove('dark')
    window.print()
    if (wasDark) document.documentElement.classList.add('dark')
  }

  if (loading) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">Loading…</p>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Print-only letterhead */}
      <div className="hidden print:block mb-4">
        <ReportLetterhead date={asOf} subtitle={`Inventory as of ${asOf}`} />
      </div>

      {/* Header */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Inventory</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">Computed from opening balances, deliveries, sales, and adjustments.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={printPDF} className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
            🖨 Print / PDF
          </button>
          <button onClick={exportCSV} className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">
            ⬇ Export CSV
          </button>
          {canAdjust && (
            <button
              onClick={() => { setAdjForm({ ...EMPTY_ADJ, storage: storages[0] ?? 'Everest' }); setAdjError(''); setAdjOpen(true) }}
              className="text-sm bg-amber-600 hover:bg-amber-700 text-white font-medium px-3 py-2 rounded-lg"
            >
              ± Adjust
            </button>
          )}
        </div>
      </div>

      {/* Pending oversell overrides (admin only) */}
      {isAdmin && overrides.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-200 dark:border-amber-500/30 flex items-center gap-2">
            <span className="text-amber-600 dark:text-amber-400">⚠</span>
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">Pending Oversell Approvals ({overrides.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-amber-700/70 dark:text-amber-300/70 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Invoice</th>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-left px-4 py-2">Storage</th>
                <th className="text-right px-4 py-2">Requested</th>
                <th className="text-right px-4 py-2">Available</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-200/60 dark:divide-amber-500/20">
              {overrides.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{o.date}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{o.invoice_number ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-800 dark:text-gray-100">{o.item_name}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{o.storage}</td>
                  <td className="px-4 py-2 text-right text-red-600 dark:text-red-400">{kg(o.requested_kilos)} kg</td>
                  <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{kg(o.available_kilos)} kg</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => approveOverride(o.id)} className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium px-3 py-1 rounded-lg">Approve</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Controls */}
      <div className="no-print flex flex-wrap items-center gap-3 mb-5">
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {[['warehouse', 'Warehouse'], ['landing', 'Summary']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium ${view === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">As of</label>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {view === 'warehouse' && (
          <button
            onClick={() => setExpandBatch((v) => !v)}
            className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40"
          >
            {expandBatch ? '▾ Collapse batches' : '▸ Expand by batch'}
          </button>
        )}
      </div>

      {/* Shared filters (drive snapshot + ledger) */}
      <div className="no-print flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Filter by item…"
          value={fItem}
          onChange={(e) => { setFItem(e.target.value); setLPage(1) }}
          className="flex-1 min-w-44 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={fStorage}
          onChange={(e) => { setFStorage(e.target.value); setLPage(1) }}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="All">All Warehouses</option>
          {storages.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="item">Sort: Item name</option>
          <option value="kilos">Sort: Kilos</option>
          <option value="boxes">Sort: Boxes</option>
        </select>
        {(fItem || fStorage !== 'All' || lFrom || lTo) && (
          <button onClick={() => { setFItem(''); setFStorage('All'); setLFrom(''); setLTo(''); setLPage(1) }} className="text-xs text-blue-600 hover:underline self-center">Reset filters</button>
        )}
      </div>

      {/* Status KPI cards (item-level) */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {['Critical', 'Low', 'Sufficient'].map((st) => (
          <div key={st} className={`rounded-xl border px-4 py-3 ${st === 'Critical' ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10' : st === 'Low' ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' : 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10'}`}>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{st}</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{statusCounts[st]}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">items</p>
          </div>
        ))}
      </div>

      {/* ── Inventory table ── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 mb-8">
        {view === 'landing' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-right px-4 py-3">#Box</th>
                <th className="text-right px-4 py-3">#Kilos</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Storage</th>
                <th className="text-left px-4 py-3">Batches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {landing.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 dark:text-gray-500 py-10">No inventory as of this date.</td></tr>
              ) : landing.map((o) => (
                <tr key={o.item_id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/40 ${neg(o.kilos) ? 'bg-red-50 dark:bg-red-500/10' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{o.item}</td>
                  <td className={`px-4 py-3 text-right ${neg(o.boxes) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-200'}`}>{bx(o.boxes)}</td>
                  <td className={`px-4 py-3 text-right ${neg(o.kilos) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-200'}`}>{kg(o.kilos)}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[statusOf(o.item_id)]}`}>{statusOf(o.item_id)}</span></td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{Object.keys(o.per).join(', ')}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs font-mono">{Object.keys(o.batchKilos).filter((b) => Math.abs(o.batchKilos[b]) >= 0.005).sort().join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th rowSpan={2} className="text-left px-4 py-2 align-bottom">Item</th>
                {expandBatch && <th rowSpan={2} className="text-left px-4 py-2 align-bottom">Batch #</th>}
                <th rowSpan={2} className="text-right px-4 py-2 align-bottom">#Box</th>
                <th rowSpan={2} className="text-right px-4 py-2 align-bottom">#Kilos</th>
                <th rowSpan={2} className="text-left px-4 py-2 align-bottom">Status</th>
                {storages.map((s) => (
                  <th key={s} colSpan={2} className="text-center px-4 py-2 border-l border-gray-200 dark:border-gray-700">{s}</th>
                ))}
              </tr>
              <tr>
                {storages.map((s) => (
                  <Fragment key={s}>
                    <th className="text-right px-4 py-1.5 border-l border-gray-200 dark:border-gray-700 font-normal normal-case">#Box</th>
                    <th className="text-right px-4 py-1.5 font-normal normal-case">#Kilos</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {warehouse.length === 0 ? (
                <tr><td colSpan={5 + storages.length * 2} className="text-center text-gray-400 dark:text-gray-500 py-10">No inventory as of this date.</td></tr>
              ) : warehouse.map((o, idx) => (
                <tr key={idx} className={`hover:bg-gray-50 dark:hover:bg-gray-700/40 ${neg(o.kilos) ? 'bg-red-50 dark:bg-red-500/10' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{o.item}</td>
                  {expandBatch && <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{o.batch}</td>}
                  <td className={`px-4 py-3 text-right ${neg(o.boxes) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-200'}`}>{bx(o.boxes)}</td>
                  <td className={`px-4 py-3 text-right ${neg(o.kilos) ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-200'}`}>{kg(o.kilos)}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[statusOf(o.item_id)]}`}>{statusOf(o.item_id)}</span></td>
                  {storages.map((s) => {
                    const p = o.per[s]
                    return (
                      <Fragment key={s}>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 border-l border-gray-100 dark:border-gray-700">{p ? bx(p.boxes) : ''}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{p ? kg(p.kilos) : ''}</td>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Depleted on selected date ── */}
      <div className="mb-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">📉</span>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Depleted on {asOf} ({depletedToday.length})</span>
        </div>
        {depletedToday.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No items hit zero on this date.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 dark:text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Item</th>
                <th className="text-right px-4 py-2">Kilos before</th>
                <th className="text-right px-4 py-2">Kilos now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {depletedToday.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">{d.name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{kg(d.before)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${d.now < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{kg(d.now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Ledger ── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Movement Ledger</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">Item &amp; warehouse filters shared with the snapshot above</span>
      </div>
      <div className="no-print flex flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">From</label>
          <input
            type="date"
            value={lFrom}
            onChange={(e) => { setLFrom(e.target.value); setLPage(1) }}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">To</label>
          <input
            type="date"
            value={lTo}
            onChange={(e) => { setLTo(e.target.value); setLPage(1) }}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {(lFrom || lTo) && <button onClick={() => { setLFrom(''); setLTo(''); setLPage(1) }} className="text-xs text-blue-600 hover:underline">clear</button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Item</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Storage</th>
              <th className="text-right px-4 py-3">#Box</th>
              <th className="text-right px-4 py-3">#Kilos</th>
              <th className="text-right px-4 py-3">Running Box</th>
              <th className="text-right px-4 py-3">Running Kilos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {ledgerPage.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 dark:text-gray-500 py-10">No movements.</td></tr>
            ) : ledgerPage.map((m, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 even:bg-gray-50/40 dark:even:bg-gray-900/30">
                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{m.date}</td>
                <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{m.item}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[m.type]}`}>{m.type}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{m.storage}</td>
                <td className={`px-4 py-2.5 text-right ${neg(m.boxes) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{m.boxes >= 0 ? bx(m.boxes) : `(${bx(-m.boxes)})`}</td>
                <td className={`px-4 py-2.5 text-right ${neg(m.kilos) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{m.kilos >= 0 ? kg(m.kilos) : `(${kg(-m.kilos)})`}</td>
                <td className="px-4 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200">{bx(m.runBox)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200">{kg(m.runKilos)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {lTotalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-sm">
            <span className="text-gray-400 dark:text-gray-500 text-xs">
              {(lPageSafe - 1) * PAGE_SIZE + 1}–{Math.min(lPageSafe * PAGE_SIZE, ledgerFiltered.length)} of {ledgerFiltered.length}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setLPage((p) => Math.max(1, p - 1))} disabled={lPageSafe <= 1} className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40">←</button>
              <span className="px-2 text-gray-500 dark:text-gray-400 text-xs">Page {lPageSafe} / {lTotalPages}</span>
              <button onClick={() => setLPage((p) => Math.min(lTotalPages, p + 1))} disabled={lPageSafe >= lTotalPages} className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40">→</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Adjustment Modal ── */}
      {adjOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">Manual Adjustment</h2>
              <button onClick={() => setAdjOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={saveAdjustment} className="px-6 py-4 space-y-3">
              {adjError && <p className="text-red-500 text-xs">{adjError}</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400">Use positive values to add stock, negative to remove. Aligns logged inventory with the physical count.</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date *</label>
                  <input type="date" value={adjForm.date} onChange={(e) => setAdjForm({ ...adjForm, date: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Storage *</label>
                  <select value={adjForm.storage} onChange={(e) => setAdjForm({ ...adjForm, storage: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {storages.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Item *</label>
                <select value={adjForm.item_id} onChange={(e) => setAdjForm({ ...adjForm, item_id: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Batch #</label>
                  <input type="text" value={adjForm.batch_number} onChange={(e) => setAdjForm({ ...adjForm, batch_number: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">#Box ±</label>
                  <input type="number" step="any" value={adjForm.boxes} onChange={(e) => setAdjForm({ ...adjForm, boxes: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">#Kilos ±</label>
                  <input type="number" step="any" value={adjForm.kilos} onChange={(e) => setAdjForm({ ...adjForm, kilos: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Reason</label>
                <input type="text" value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  placeholder="e.g. physical count correction, spoilage"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setAdjOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={adjSaving} className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {adjSaving ? 'Saving…' : 'Save Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manageStorage && (
        <ManageListModal listType="storage" title="Manage Storage Locations" onClose={() => setManageStorage(false)} onChange={fetchAll} />
      )}
    </div>
  )
}
