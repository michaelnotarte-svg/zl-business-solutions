import { useEffect, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, selectAll } from '../lib/supabase'
import { fetchListNames, STORAGE_FALLBACK } from '../lib/lists'
import ManageListModal from '../components/ManageListModal'
import { useAuth } from '../lib/auth'

const EMPTY_FORM = {
  po_number: '',
  date: new Date().toISOString().slice(0, 10),
  storage: 'Everest',
  from_storage: '',
  supplier: '',
  source: '',
  category: '',
  notes: '',
}

export default function PurchaseOrders() {
  const navigate = useNavigate()
  const { activeLocation, canWrite } = useAuth()
  const canEdit = canWrite('Stocks')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [storageOptions, setStorageOptions] = useState(STORAGE_FALLBACK)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [supplierOptions, setSupplierOptions] = useState([])
  const [sourceOptions, setSourceOptions] = useState([])
  const [manageList, setManageList] = useState(null) // list_type | null

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [whFilter, setWhFilter] = useState('All')
  const [catFilter, setCatFilter] = useState('All')
  const [viewMode, setViewMode] = useState('summary') // 'summary' | 'items'
  const [loadAll, setLoadAll] = useState(false) // false = last 30 days, true = full history
  const [page, setPage] = useState(1)
  const [openGroups, setOpenGroups] = useState({}) // expanded Everest date-groups
  const PAGE_SIZE = 50
  const recentCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const anyFilter = !!search || whFilter !== 'All' || catFilter !== 'All' || !!dateFrom || !!dateTo
  function resetFilters() { setSearch(''); setWhFilter('All'); setCatFilter('All'); setDateFrom(''); setDateTo('') }

  useEffect(() => { fetchOrders(); loadLists() }, [activeLocation, loadAll])
  // Reset to the first page whenever the view or filters change
  useEffect(() => { setPage(1) }, [search, whFilter, catFilter, dateFrom, dateTo, viewMode, loadAll])

  async function loadLists() {
    setStorageOptions(await fetchListNames('storage', STORAGE_FALLBACK, activeLocation))
    setCategoryOptions(await fetchListNames('delivery_category', []))
    setSupplierOptions(await fetchListNames('supplier', []))
    setSourceOptions(await fetchListNames('source', []))
  }
  const loadStorage = loadLists

  async function fetchOrders() {
    setLoading(true)
    const sel = '*, stock_entries(boxes, kilos, storage, items(name))'
    const base = () => supabase.from('purchase_orders').select(sel).eq('location', activeLocation).order('date', { ascending: false })
    const rows = loadAll
      ? await selectAll(base) // full history, paginated past the 1000-row cap
      : ((await base().gte('date', recentCutoff)).data ?? []) // last 30 days only

    const enriched = rows.map((po) => {
      const entries = po.stock_entries ?? []
      const storages = [...new Set(entries.map((e) => e.storage).filter(Boolean))]
      return {
        ...po,
        lineCount:  entries.length,
        totalBoxes: entries.reduce((s, e) => s + (Number(e.boxes) || 0), 0),
        totalKilos: entries.reduce((s, e) => s + (Number(e.kilos) || 0), 0),
        itemList:   [...new Set(entries.map((e) => e.items?.name).filter(Boolean))].join(', '),
        warehouse:  storages.length ? storages.join(', ') : (po.storage ?? '—'),
        storages:   storages.length ? storages : (po.storage ? [po.storage] : []),
      }
    })
    setOrders(enriched)
    setLoading(false)
  }

  const filtered = orders.filter((o) => {
    const q = search.toLowerCase()
    const searchOK = !q || (
      o.po_number?.toLowerCase().includes(q) ||
      o.supplier?.toLowerCase().includes(q) ||
      o.source?.toLowerCase().includes(q) ||
      o.category?.toLowerCase().includes(q) ||
      o.itemList?.toLowerCase().includes(q)
    )
    const dateOK = (!dateFrom || o.date >= dateFrom) && (!dateTo || o.date <= dateTo)
    const whOK = whFilter === 'All' || (o.storages ?? []).includes(whFilter)
    const catOK = catFilter === 'All' || o.category === catFilter
    return searchOK && dateOK && whOK && catOK
  })

  // KPIs over the filtered set
  const kpiCount = filtered.length
  const kpiTransfers = filtered.filter((o) => o.category === 'Transfer' || o.from_storage).length
  const kpiIncoming = kpiCount - kpiTransfers
  const kpiKilos = filtered.reduce((s, o) => s + o.totalKilos, 0)
  const kpiBoxes = filtered.reduce((s, o) => s + o.totalBoxes, 0)

  // Summary view: Everest (landing) grouped by date; other warehouses
  // (e.g. FishingPort, distribution) shown one row per item.
  const summaryRows = buildSummaryRows(filtered)
  const listLen = viewMode === 'summary' ? summaryRows.length : filtered.length

  // Client-side pagination of the rendered list
  const totalPages = Math.max(1, Math.ceil(listLen / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const summaryPage = summaryRows.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)
  const poPage = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.date) { setError('Date is required.'); return }
    const isTransfer = form.category === 'Transfer'
    if (isTransfer) {
      if (!form.from_storage) { setError('From warehouse is required for a transfer.'); return }
      if (form.from_storage === form.storage) { setError('From and To warehouses must be different.'); return }
    }
    setSaving(true)
    setError('')
    const payload = {
      po_number: form.po_number.trim() || null,
      location: activeLocation,
      date: form.date,
      storage: form.storage,
      from_storage: isTransfer ? form.from_storage : null,
      supplier: isTransfer ? null : (form.supplier.trim() || null),
      source: isTransfer ? null : (form.source.trim() || null),
      category: form.category.trim() || null,
      notes: form.notes.trim() || null,
    }
    const { data, error: err } = await supabase
      .from('purchase_orders')
      .insert(payload)
      .select()
      .single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setModalOpen(false)
    navigate(`/stocks/${data.id}`)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Stocks</h1>
        {canEdit && (
        <button
          onClick={openAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + New Delivery
        </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Deliveries</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{kpiCount}</p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">{kpiIncoming} incoming · {kpiTransfers} transfer</p>
        </div>
        <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Kilos</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{(kpiKilos / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-medium">t</span></p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">{kpiKilos.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</p>
        </div>
        <div className="rounded-xl border border-teal-200 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Boxes</p>
          <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{kpiBoxes.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Period</p>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-1">{loadAll ? 'All history' : 'Last 30 days'}</p>
          {(dateFrom || dateTo) && <p className="text-[11px] text-gray-400 dark:text-gray-500">{dateFrom || '…'} → {dateTo || 'now'}</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search ref, supplier, source, item…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-44 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="All">All Warehouses</option>
          {storageOptions.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="All">All Categories</option>
          {categoryOptions.map((c) => <option key={c}>{c}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400 text-xs">→</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {[['summary', 'Summary'], ['items', 'Items']].map(([v, label]) => (
            <button key={v} onClick={() => setViewMode(v)} className={`px-3 py-2 text-sm font-medium ${viewMode === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>{label}</button>
          ))}
        </div>
        {anyFilter && <button onClick={resetFilters} className="text-xs text-blue-600 hover:underline self-center">Reset filters</button>}
        <div className="flex items-center gap-2 text-xs self-center ml-auto">
          <span className="text-gray-400 dark:text-gray-500">{loadAll ? 'All history' : 'Last 30 days'}{!loading && ` · ${filtered.length}`}</span>
          <button onClick={() => setLoadAll((v) => !v)} className="text-blue-600 hover:underline">{loadAll ? 'Show recent' : 'Show all'}</button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">No deliveries match the current filters.</p>
      ) : viewMode === 'items' ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">Warehouse</th>
                <th className="text-right px-4 py-3">Boxes</th>
                <th className="text-right px-4 py-3">Kilos</th>
                <th className="text-left px-4 py-3">Ref #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {poPage.flatMap((o) => {
                const entries = o.stock_entries ?? []
                if (entries.length === 0) return [(
                  <tr key={o.id} onClick={() => navigate(`/stocks/${o.id}`)} className="hover:bg-blue-50 dark:hover:bg-gray-700/40 cursor-pointer border-t-2 border-gray-200 dark:border-gray-700">
                    <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200">{o.date}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{o.category ?? '—'}</td>
                    <td colSpan={5} className="px-4 py-2.5 text-gray-400 dark:text-gray-500 italic">no items</td>
                  </tr>
                )]
                return entries.map((e, idx) => (
                  <tr key={o.id + '-' + idx} onClick={() => navigate(`/stocks/${o.id}`)} className={`hover:bg-blue-50 dark:hover:bg-gray-700/40 cursor-pointer ${idx === 0 ? 'border-t-2 border-gray-200 dark:border-gray-700' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200">{idx === 0 ? o.date : ''}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{idx === 0 ? (o.category ?? '—') : ''}</td>
                    <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{e.items?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{e.storage}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{e.boxes != null ? Number(e.boxes).toLocaleString() : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{Number(e.kilos).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500">{idx === 0 ? (o.po_number || '—') : ''}</td>
                  </tr>
                ))
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Warehouse</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Boxes</th>
                <th className="text-right px-4 py-3">Kilos</th>
                <th className="text-left px-4 py-3">Item(s)</th>
                <th className="text-left px-4 py-3">Ref / #</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {summaryPage.map((r) => {
                const items = r.isGroup ? [...r.items].join(', ') : (r.item || '—')
                const cats = r.isGroup ? [...r.categories] : (r.category ? [r.category] : [])
                const open = r.isGroup && !!openGroups[r.key]
                const refText = r.isGroup ? `${r.children.length} ${r.children.length === 1 ? 'item' : 'items'}` : (r.ref || '—')
                const onRowClick = r.isGroup
                  ? () => setOpenGroups((s) => ({ ...s, [r.key]: !s[r.key] }))
                  : () => r.po?.id && navigate(`/stocks/${r.po.id}`)
                return (
                <Fragment key={r.key}>
                <tr onClick={onRowClick} className="hover:bg-blue-50 dark:hover:bg-gray-700/40 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">
                    {r.isGroup && <span className="inline-block w-3 mr-1 text-gray-400 dark:text-gray-500">{open ? '▾' : '▸'}</span>}{r.date}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.warehouse}</td>
                  <td className="px-4 py-3">
                    {cats.length
                      ? cats.map((c) => <span key={c} className={`inline-block mr-1 px-2 py-0.5 rounded-full text-xs font-medium ${c === 'Transfer' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' : 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'}`}>{c}</span>)
                      : <span className="text-gray-400 dark:text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{r.boxes > 0 ? r.boxes.toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{r.kilos > 0 ? r.kilos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={items}>{items}</td>
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500">{refText}</td>
                </tr>
                {open && r.children.map((c, i) => (
                  <tr key={`${r.key}-c${i}`} onClick={(e) => { e.stopPropagation(); navigate(`/stocks/${c.poId}`) }} className="bg-gray-50/60 dark:bg-gray-900/40 hover:bg-blue-50 dark:hover:bg-gray-700/40 cursor-pointer text-xs">
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-gray-400 dark:text-gray-500">{c.category || ''}</td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{c.boxes > 0 ? c.boxes.toLocaleString() : '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{c.kilos > 0 ? c.kilos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-2 pl-8 text-gray-700 dark:text-gray-200">{c.item || '—'}</td>
                    <td className="px-4 py-2 text-gray-400 dark:text-gray-500">{c.ref || '—'}</td>
                  </tr>
                ))}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {!loading && listLen > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-gray-400 dark:text-gray-500 text-xs">
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, listLen)} of {listLen}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40">←</button>
            <span className="px-2 text-gray-500 dark:text-gray-400 text-xs">Page {pageSafe} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages} className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/40">→</button>
          </div>
        </div>
      )}

      {/* New PO Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{form.category === 'Transfer' ? 'New Stock Transfer' : 'New Stock Delivery'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-4 space-y-3">
              {error && <p className="text-red-500 text-xs">{error}</p>}

              {/* Category first — drives the rest of the form */}
              <ManagedSelect label="Category" value={form.category} onChange={(v) => set('category', v)} options={categoryOptions} onManage={() => setManageList('delivery_category')} />

              <div className="grid grid-cols-2 gap-3">
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">{form.category === 'Transfer' ? 'To Warehouse *' : 'Storage *'}</label>
                    <button type="button" onClick={() => setManageList('storage')} className="text-[11px] text-blue-600 hover:underline">Manage</button>
                  </div>
                  <select
                    value={form.storage}
                    onChange={(e) => set('storage', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {storageOptions.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {form.category === 'Transfer' ? (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">From Warehouse *</label>
                  <select
                    value={form.from_storage}
                    onChange={(e) => set('from_storage', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select source warehouse…</option>
                    {storageOptions.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Stock will be deducted from here and added to the destination warehouse.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <ManagedSelect label="Source" value={form.source} onChange={(v) => set('source', v)} options={sourceOptions} onManage={() => setManageList('source')} />
                  <ManagedSelect label="Supplier" value={form.supplier} onChange={(v) => set('supplier', v)} options={supplierOptions} onManage={() => setManageList('supplier')} />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Field label="Ref # (optional)" value={form.po_number} onChange={(v) => set('po_number', v)} />
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {saving ? 'Creating…' : 'Create & Add Items →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manageList && (
        <ManageListModal
          listType={manageList}
          title={LIST_TITLES[manageList] ?? 'Manage List'}
          onClose={() => setManageList(null)}
          onChange={loadLists}
        />
      )}
    </div>
  )
}

// Everest is the landing warehouse → group its intake by date. Other
// warehouses (e.g. FishingPort, distribution/customer-facing) are shown one
// row per item, since stock arrives there piecemeal (often as transfers).
const LANDING_WAREHOUSE = 'Everest'

function buildSummaryRows(orders) {
  const everest = new Map() // date -> aggregated group
  const others = []
  for (const o of orders) {
    const entries = (o.stock_entries ?? [])
    const list = entries.length ? entries : [null] // keep empty deliveries visible
    for (const e of list) {
      const storage = (e && e.storage) || o.storage || '—'
      const boxes = e ? (Number(e.boxes) || 0) : 0
      const kilos = e ? (Number(e.kilos) || 0) : 0
      const item = e ? (e.items?.name || null) : null
      if (storage === LANDING_WAREHOUSE) {
        let g = everest.get(o.date)
        if (!g) { g = { isGroup: true, key: `EV|${o.date}`, date: o.date, warehouse: LANDING_WAREHOUSE, boxes: 0, kilos: 0, items: new Set(), categories: new Set(), pos: new Set(), children: [] }; everest.set(o.date, g) }
        g.boxes += boxes; g.kilos += kilos
        if (item) g.items.add(item)
        if (o.category) g.categories.add(o.category)
        g.pos.add(o)
        g.children.push({ item, boxes, kilos, ref: o.po_number, poId: o.id, category: o.category })
      } else {
        others.push({ isGroup: false, key: `PO|${o.id}|${others.length}`, date: o.date, warehouse: storage, category: o.category, boxes, kilos, item, po: o, ref: o.po_number })
      }
    }
  }
  const everestRows = [...everest.values()].map((g) => ({ ...g, pos: [...g.pos] }))
  return [...everestRows, ...others].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.warehouse.localeCompare(b.warehouse)))
}

const LIST_TITLES = {
  storage: 'Manage Storage Locations',
  source: 'Manage Sources',
  supplier: 'Manage Suppliers',
  delivery_category: 'Manage Categories',
}

function ManagedSelect({ label, value, onChange, options, onManage }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
        <button type="button" onClick={onManage} className="text-[11px] text-blue-600 hover:underline">Manage</button>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— None —</option>
        {options.map((o) => <option key={o}>{o}</option>)}
        {value && !options.includes(value) && <option>{value}</option>}
      </select>
    </div>
  )
}

function Field({ label, value, onChange }) {
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
