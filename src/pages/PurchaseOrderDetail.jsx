import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchListNames, STORAGE_FALLBACK } from '../lib/lists'
import ManageListModal from '../components/ManageListModal'
import { fetchMovements, onHandMap, lookup, inStockItemIds, avgKgBox } from '../lib/inventory'
import { useAuth } from '../lib/auth'
import AttributionNote from '../components/AttributionNote'

const EMPTY_LINE = {
  item_id: '',
  storage: 'Everest',
  batch_number: '',
  boxes: '',
  kilos: '',
}

function buildItemName(base, brand) {
  const b = base.trim()
  const br = brand.trim()
  return br ? `${b} - ${br}` : b
}

export default function PurchaseOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { activeLocation, canWrite } = useAuth()
  const canEdit = canWrite('Stocks')

  const [po, setPo] = useState(null)
  const [lines, setLines] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  // PO header edit
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerForm, setHeaderForm] = useState({})
  const [savingHeader, setSavingHeader] = useState(false)

  // Line item modal
  const [lineModal, setLineModal] = useState(false)
  const [lineForm, setLineForm] = useState(EMPTY_LINE)
  const [editLineId, setEditLineId] = useState(null)
  const [savingLine, setSavingLine] = useState(false)
  const [lineError, setLineError] = useState('')
  const [storageOverride, setStorageOverride] = useState(false)

  const [storageOptions, setStorageOptions] = useState(STORAGE_FALLBACK)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [supplierOptions, setSupplierOptions] = useState([])
  const [sourceOptions, setSourceOptions] = useState([])
  const [manageList, setManageList] = useState(null)

  // Quick-add item
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddForm, setQuickAddForm] = useState({ base_name: '', brand: '' })
  const [quickAddSaving, setQuickAddSaving] = useState(false)
  const [quickAddError, setQuickAddError] = useState('')

  const [deleteLineTarget, setDeleteLineTarget] = useState(null)
  const [deletePOConfirm, setDeletePOConfirm] = useState(false)

  const [invMap, setInvMap] = useState(new Map())
  const [showAllItems, setShowAllItems] = useState(false)

  useEffect(() => {
    fetchAll()
    loadStorage()
    loadInventory()
  }, [id, activeLocation])

  async function loadInventory() {
    setInvMap(onHandMap(await fetchMovements(activeLocation)))
  }

  async function loadStorage() {
    setStorageOptions(await fetchListNames('storage', STORAGE_FALLBACK, activeLocation))
    setCategoryOptions(await fetchListNames('delivery_category', []))
    setSupplierOptions(await fetchListNames('supplier', []))
    setSourceOptions(await fetchListNames('source', []))
  }

  async function fetchAll() {
    setLoading(true)
    const [{ data: poData }, { data: linesData }, { data: itemsData }] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('id', id).single(),
      supabase
        .from('stock_entries')
        .select('*, items(name)')
        .eq('po_id', id)
        .order('created_at'),
      supabase.from('items').select('id, name').eq('location', activeLocation).order('name'),
    ])
    setPo(poData)
    setHeaderForm({
      po_number: poData?.po_number ?? '',
      date: poData?.date ?? '',
      storage: poData?.storage ?? 'Everest',
      supplier: poData?.supplier ?? '',
      source: poData?.source ?? '',
      category: poData?.category ?? '',
      notes: poData?.notes ?? '',
    })
    setLines(linesData ?? [])
    setItems(itemsData ?? [])
    setLoading(false)
  }

  // ── Header ──────────────────────────────────────────────
  async function saveHeader(e) {
    e.preventDefault()
    setSavingHeader(true)
    await supabase.from('purchase_orders').update({
      po_number: headerForm.po_number,
      date: headerForm.date,
      storage: headerForm.storage,
      supplier: headerForm.supplier || null,
      source: headerForm.source || null,
      category: headerForm.category || null,
      notes: headerForm.notes || null,
    }).eq('id', id)
    setSavingHeader(false)
    setEditingHeader(false)
    fetchAll()
  }

  // ── Lines ────────────────────────────────────────────────
  async function openAddLine() {
    setLineForm({ ...EMPTY_LINE, storage: po?.storage ?? 'Everest' })
    setEditLineId(null)
    setLineError('')
    setStorageOverride(false)
    setLineModal(true)
  }

  async function generateBatchNumber(itemId) {
    if (!itemId) return ''
    const { count } = await supabase
      .from('stock_entries')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
    return String((count ?? 0) + 1)
  }

  async function handleItemChange(itemId) {
    const batch = await generateBatchNumber(itemId)
    setLineForm((f) => ({ ...f, item_id: itemId, batch_number: batch }))
  }

  function handleQuickAddItem(rawName) {
    // Pre-fill the typed text as the base item name; brand entered separately
    setQuickAddForm({ base_name: rawName.trim(), brand: '' })
    setQuickAddError('')
    setQuickAddOpen(true)
  }

  async function saveQuickAddItem(e) {
    e.preventDefault()
    if (!quickAddForm.base_name.trim()) { setQuickAddError('Item name is required.'); return }
    setQuickAddSaving(true)
    setQuickAddError('')
    const { data, error: err } = await supabase
      .from('items')
      .insert({
        name: buildItemName(quickAddForm.base_name, quickAddForm.brand),
        base_name: quickAddForm.base_name.trim(),
        brand: quickAddForm.brand.trim() || null,
        location: activeLocation,
      })
      .select('id, name')
      .single()
    setQuickAddSaving(false)
    if (err) { setQuickAddError(err.message); return }
    // Refresh the dropdown list, then select the new item
    const { data: itemsData } = await supabase.from('items').select('id, name').eq('location', activeLocation).order('name')
    setItems(itemsData ?? [])
    handleItemChange(data.id)
    setQuickAddOpen(false)
  }

  function openEditLine(line) {
    setLineForm({
      item_id: line.item_id,
      storage: line.storage,
      batch_number: line.batch_number,
      boxes: line.boxes ?? '',
      kilos: line.kilos ?? '',
    })
    setEditLineId(line.id)
    setLineError('')
    setStorageOverride(line.storage !== (po?.storage ?? 'Everest'))
    setLineModal(true)
  }

  async function saveLine(e) {
    e.preventDefault()
    if (!lineForm.item_id) { setLineError('Select an item.'); return }
    if (!lineForm.batch_number.toString().trim()) { setLineError('Pick an item so a batch number can be assigned.'); return }
    if (!lineForm.kilos || Number(lineForm.kilos) <= 0) { setLineError('Kilos must be greater than 0.'); return }
    if (lineForm.boxes !== '' && Number(lineForm.boxes) < 0) { setLineError('Boxes cannot be negative.'); return }
    setSavingLine(true)
    setLineError('')
    const payload = {
      po_id: id,
      item_id: lineForm.item_id,
      storage: lineForm.storage,
      batch_number: lineForm.batch_number.toString().trim(),
      boxes: lineForm.boxes ? Number(lineForm.boxes) : null,
      kilos: Number(lineForm.kilos),
      date: po?.date ?? new Date().toISOString().slice(0, 10),
    }
    let err
    if (editLineId) {
      ;({ error: err } = await supabase.from('stock_entries').update(payload).eq('id', editLineId))
    } else {
      ;({ error: err } = await supabase.from('stock_entries').insert(payload))
    }
    setSavingLine(false)
    if (err) { setLineError(err.message); return }
    setLineModal(false)
    fetchAll()
  }

  async function deleteLine() {
    if (!deleteLineTarget) return
    await supabase.from('stock_entries').delete().eq('id', deleteLineTarget.id)
    setDeleteLineTarget(null)
    fetchAll()
  }

  async function deletePO() {
    await supabase.from('purchase_orders').delete().eq('id', id)
    navigate('/stocks')
  }

  // ── Totals ───────────────────────────────────────────────
  const totalBoxes = lines.reduce((s, l) => s + (Number(l.boxes) || 0), 0)
  const totalKilos = lines.reduce((s, l) => s + (Number(l.kilos) || 0), 0)

  if (loading) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">Loading…</p>
  if (!po) return <p className="text-sm text-red-400 text-center py-20">PO not found.</p>

  // Inventory awareness on the line form
  const isTransfer = !!po.from_storage
  const availWarehouse = isTransfer ? po.from_storage : lineForm.storage
  const lineAvail = lookup(invMap, lineForm.item_id, availWarehouse)
  const inStock = inStockItemIds(invMap, availWarehouse)
  const comboItems = isTransfer && !showAllItems
    ? items.filter((i) => inStock.has(i.id) || i.id === lineForm.item_id)
    : items

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back */}
      <button onClick={() => navigate('/stocks')} className="text-sm text-blue-600 hover:underline">
        ← Back to Stocks
      </button>

      {/* ── PO Header Card ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Delivery <span className="text-blue-700">{po.po_number}</span>
          </h2>
          <div className="flex gap-2">
            {!editingHeader && canEdit && (
              <>
                <button
                  onClick={() => setEditingHeader(true)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Edit
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setDeletePOConfirm(true)}
                  className="text-sm text-red-500 hover:underline"
                >
                  Delete Delivery
                </button>
              </>
            )}
          </div>
        </div>

        {editingHeader ? (
          <form onSubmit={saveHeader} className="px-6 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <HField label="Ref #" value={headerForm.po_number} onChange={(v) => setHeaderForm({ ...headerForm, po_number: v })} />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date</label>
                <input
                  type="date"
                  value={headerForm.date}
                  onChange={(e) => setHeaderForm({ ...headerForm, date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Storage</label>
                  <button type="button" onClick={() => setManageList('storage')} className="text-[11px] text-blue-600 hover:underline">Manage</button>
                </div>
                <select
                  value={headerForm.storage}
                  onChange={(e) => setHeaderForm({ ...headerForm, storage: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {storageOptions.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <HSelect label="Source" value={headerForm.source} onChange={(v) => setHeaderForm({ ...headerForm, source: v })} options={sourceOptions} onManage={() => setManageList('source')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <HSelect label="Supplier" value={headerForm.supplier} onChange={(v) => setHeaderForm({ ...headerForm, supplier: v })} options={supplierOptions} onManage={() => setManageList('supplier')} />
              <HSelect label="Category" value={headerForm.category} onChange={(v) => setHeaderForm({ ...headerForm, category: v })} options={categoryOptions} onManage={() => setManageList('delivery_category')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                rows={2}
                value={headerForm.notes}
                onChange={(e) => setHeaderForm({ ...headerForm, notes: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={savingHeader} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {savingHeader ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingHeader(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Date" value={po.date} />
            {po.from_storage
              ? <InfoRow label="Transfer" value={`${po.from_storage} → ${po.storage}`} />
              : <InfoRow label="Storage" value={po.storage} />}
            {!po.from_storage && <InfoRow label="Source" value={po.source} />}
            {!po.from_storage && <InfoRow label="Supplier" value={po.supplier} />}
            <InfoRow label="Category" value={po.category} />
            {po.notes && (
              <div className="col-span-2 sm:col-span-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Notes</span>
                <p className="text-gray-700 dark:text-gray-200 mt-0.5">{po.notes}</p>
              </div>
            )}
            <div className="col-span-2 sm:col-span-3"><AttributionNote record={po} /></div>
          </div>
        )}
      </div>

      {/* ── Stock Entries ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Stock Entries</h3>
          {canEdit && <button
            onClick={openAddLine}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            + Add Item
          </button>}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No items yet. Add the first one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-4 py-3">Batch #</th>
                  <th className="text-left px-4 py-3">Storage</th>
                  <th className="text-right px-4 py-3">Boxes</th>
                  <th className="text-right px-4 py-3">Kilos</th>
                  <th className="text-right px-4 py-3">Kg/Box</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{l.items?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">{l.batch_number}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${l.storage === 'Everest' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}`}>
                        {l.storage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{l.boxes != null ? Number(l.boxes).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{Number(l.kilos).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{l.boxes > 0 ? (Number(l.kilos) / Number(l.boxes)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{l.date}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canEdit && <button onClick={() => openEditLine(l)} className="text-blue-600 hover:underline text-xs mr-3">Edit</button>}
                      {canEdit && <button onClick={() => setDeleteLineTarget(l)} className="text-red-500 hover:underline text-xs">Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900 text-sm font-semibold text-gray-700 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wide">Totals</td>
                  <td className="px-4 py-3 text-right">{totalBoxes.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totalKilos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</td>
                  <td className="px-4 py-3 text-right">{totalBoxes > 0 ? (totalKilos / totalBoxes).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Line Item Modal ── */}
      {lineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editLineId ? 'Edit Stock Entry' : 'Add Stock Entry'}</h2>
              <button onClick={() => setLineModal(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={saveLine} className="px-6 py-4 space-y-3">
              {lineError && <p className="text-red-500 text-xs">{lineError}</p>}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Item *</label>
                  {isTransfer && (
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer">
                      <input type="checkbox" checked={showAllItems} onChange={(e) => setShowAllItems(e.target.checked)} className="h-3 w-3 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                      Show all items
                    </label>
                  )}
                </div>
                <ItemCombobox
                  items={comboItems}
                  value={lineForm.item_id}
                  onSelect={handleItemChange}
                  onQuickAdd={handleQuickAddItem}
                />
                {lineForm.item_id && (
                  <p className={`text-[11px] mt-1 ${lineAvail.kilos <= 0 ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                    On hand @ {availWarehouse}: <span className="font-semibold">{lineAvail.boxes.toLocaleString(undefined, { maximumFractionDigits: 2 })} box</span> · <span className="font-semibold">{lineAvail.kilos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</span>
                    {lineAvail.boxes > 0 && <> · avg {avgKgBox(lineAvail).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/box</>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Storage *</label>
                    <button
                      type="button"
                      onClick={() => {
                        setStorageOverride((v) => {
                          const next = !v
                          if (!next) setLineForm((f) => ({ ...f, storage: po?.storage ?? 'Everest' }))
                          return next
                        })
                      }}
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      {storageOverride ? 'Use delivery default' : 'Override'}
                    </button>
                  </div>
                  <select
                    value={lineForm.storage}
                    disabled={!storageOverride}
                    onChange={(e) => setLineForm({ ...lineForm, storage: e.target.value })}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${storageOverride ? 'border-gray-300 dark:border-gray-600' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed'}`}
                  >
                    {storageOptions.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Batch # (auto)</label>
                  <input
                    type="text"
                    value={lineForm.batch_number}
                    readOnly
                    tabIndex={-1}
                    placeholder="Select an item"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <LField label="Boxes" value={lineForm.boxes} onChange={(v) => setLineForm({ ...lineForm, boxes: v })} type="number" />
                <LField label="Kilos *" value={lineForm.kilos} onChange={(v) => setLineForm({ ...lineForm, kilos: v })} type="number" />
              </div>

              {(lineForm.boxes || lineForm.kilos) && (
                <p className="text-xs text-right text-gray-500 dark:text-gray-400">
                  Avg per box:{' '}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {Number(lineForm.boxes) > 0 && Number(lineForm.kilos) > 0
                      ? `${(Number(lineForm.kilos) / Number(lineForm.boxes)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg/box`
                      : '—'}
                  </span>
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setLineModal(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={savingLine} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {savingLine ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manageList && (
        <ManageListModal
          listType={manageList}
          title={DETAIL_LIST_TITLES[manageList] ?? 'Manage List'}
          onClose={() => setManageList(null)}
          onChange={loadStorage}
        />
      )}

      {/* Quick-add Item Modal */}
      {quickAddOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">New Item</h2>
              <button onClick={() => setQuickAddOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={saveQuickAddItem} className="px-6 py-4 space-y-3">
              {quickAddError && <p className="text-red-500 text-xs">{quickAddError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Item *</label>
                <input
                  type="text"
                  autoFocus
                  value={quickAddForm.base_name}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, base_name: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Brand</label>
                <input
                  type="text"
                  value={quickAddForm.brand}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, brand: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {quickAddForm.base_name.trim() && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Saved as: <span className="font-semibold text-gray-700 dark:text-gray-200">{buildItemName(quickAddForm.base_name, quickAddForm.brand)}</span>
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setQuickAddOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
                <button type="submit" disabled={quickAddSaving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {quickAddSaving ? 'Saving…' : 'Save & Select'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Line Confirmation */}
      {deleteLineTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Delete this entry?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-700 dark:text-gray-200">{deleteLineTarget.items?.name}</span> — Batch {deleteLineTarget.batch_number} will be removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteLineTarget(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={deleteLine} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete PO Confirmation */}
      {deletePOConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Delete this delivery?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Delivery <span className="font-medium text-gray-700 dark:text-gray-200">{po.po_number}</span> and all its stock entries will be permanently deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletePOConfirm(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={deletePO} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Delete Delivery</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
      <p className="text-gray-800 dark:text-gray-100 mt-0.5">{value ?? '—'}</p>
    </div>
  )
}

const DETAIL_LIST_TITLES = {
  storage: 'Manage Storage Locations',
  source: 'Manage Sources',
  supplier: 'Manage Suppliers',
  delivery_category: 'Manage Categories',
}

function HField({ label, value, onChange }) {
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

function HSelect({ label, value, onChange, options, onManage }) {
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

function LField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

function ItemCombobox({ items, value, onSelect, onQuickAdd }) {
  const selected = items.find((i) => i.id === value)
  const [query, setQuery] = useState(selected ? selected.name : '')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sel = items.find((i) => i.id === value)
    setQuery(sel ? sel.name : '')
  }, [value, items])

  const q = query.toLowerCase().trim()
  const filtered = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items
  const exactMatch = items.some((i) => i.name.toLowerCase() === q)

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        placeholder="Type to search items…"
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-52 overflow-y-auto text-sm">
          {filtered.map((i) => (
            <li
              key={i.id}
              onMouseDown={() => { onSelect(i.id); setOpen(false) }}
              className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700/40 ${i.id === value ? 'bg-blue-50 font-medium' : ''}`}
            >
              {i.name}
            </li>
          ))}
          {q && !exactMatch && (
            <li
              onMouseDown={() => { onQuickAdd(query); setOpen(false) }}
              className="px-3 py-2 cursor-pointer text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700/40 border-t border-gray-100 dark:border-gray-700"
            >
              + Add “{query.trim()}” as new item
            </li>
          )}
          {filtered.length === 0 && !q && (
            <li className="px-3 py-2 text-gray-400 dark:text-gray-500">No items yet — type a name to add one.</li>
          )}
        </ul>
      )}
    </div>
  )
}
