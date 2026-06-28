import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money } from '../lib/settings'
import { fetchListNames, STORAGE_FALLBACK, PAYMENT_FALLBACK } from '../lib/lists'
import ManageListModal from '../components/ManageListModal'
import { fetchMovements, onHandMap, lookup, inStockItemIds, avgKgBox, itemAvgMap, allocateFIFO } from '../lib/inventory'
import { useAuth } from '../lib/auth'
import AttributionNote from '../components/AttributionNote'

const SALE_TYPES = ['Walk-in', 'Delivery', 'Out-of-Town']
const STATUSES = ['Unpaid', 'Partial', 'Paid']

const STATUS_STYLE = {
  Paid: 'bg-green-100 text-green-700',
  Unpaid: 'bg-red-100 text-red-700',
  Partial: 'bg-yellow-100 text-yellow-700',
}

const EMPTY_LINE = {
  item_id: '',
  unit_price: '',
  boxes: '',
  kilos: '',
  storage: '', // per-line warehouse override; defaults to the invoice's warehouse
}

const EMPTY_PAYMENT = {
  amount_paid: '',
  date_paid: new Date().toISOString().slice(0, 10),
  mode_of_payment: 'Cash',
  deposit_date: '',
  remaining_balance: '',
}

function fmt(n) {
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { activeLocation, canWrite } = useAuth()
  const canEdit = canWrite('Sales')

  const [inv, setInv] = useState(null)
  const [lines, setLines] = useState([])
  const [payments, setPayments] = useState([])
  const [customers, setCustomers] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  // Header edit
  const [editingHeader, setEditingHeader] = useState(false)
  const [headerForm, setHeaderForm] = useState({})
  const [savingHeader, setSavingHeader] = useState(false)

  // Line modal
  const [lineModal, setLineModal] = useState(false)
  const [lineForm, setLineForm] = useState(EMPTY_LINE)
  const [editLineId, setEditLineId] = useState(null)
  const [savingLine, setSavingLine] = useState(false)
  const [lineError, setLineError] = useState('')
  const [deleteLineTarget, setDeleteLineTarget] = useState(null)

  // Payment modal
  const [payModal, setPayModal] = useState(false)
  const [payForm, setPayForm] = useState(EMPTY_PAYMENT)
  const [editPayId, setEditPayId] = useState(null)
  const [savingPay, setSavingPay] = useState(false)
  const [payError, setPayError] = useState('')
  const [deletePayTarget, setDeletePayTarget] = useState(null)

  const [deleteInvConfirm, setDeleteInvConfirm] = useState(false)

  const [storageOptions, setStorageOptions] = useState(STORAGE_FALLBACK)
  const [paymentOptions, setPaymentOptions] = useState(PAYMENT_FALLBACK)
  const [manageList, setManageList] = useState(null) // 'storage' | 'payment_method' | null

  const [invMap, setInvMap] = useState(new Map())
  const [avgMap, setAvgMap] = useState({})
  const [showAllItems, setShowAllItems] = useState(false)
  const [oversell, setOversell] = useState(null) // { requested, available } | null

  useEffect(() => { fetchAll(); loadLists(); loadInventory() }, [id, activeLocation])

  async function loadLists() {
    setStorageOptions(await fetchListNames('storage', STORAGE_FALLBACK, activeLocation))
    setPaymentOptions(await fetchListNames('payment_method', PAYMENT_FALLBACK))
  }

  async function loadInventory() {
    const moves = await fetchMovements(activeLocation)
    setInvMap(onHandMap(moves))
    setAvgMap(itemAvgMap(moves))
  }

  const invStorage = inv?.storage || ''
  const lineStorage = lineForm.storage || invStorage // per-line override, defaults to the invoice's warehouse
  const isBN = inv?.customers?.type === 'BN'
  const lineAvail = lookup(invMap, lineForm.item_id, lineStorage)
  const inStock = inStockItemIds(invMap, lineStorage)
  const itemsForDropdown = items.filter(
    (i) => showAllItems || inStock.has(i.id) || i.id === lineForm.item_id
  )

  // Health check: this line's kg/box vs the "normal" kg/box. Prefer the actual
  // on-hand ratio for this item+warehouse (what the helper above shows) so that
  // depleting exactly to the on-hand reads as normal; fall back to the item's
  // global inflow average when there's no stock on hand (e.g. oversell).
  const entryBoxes = Number(lineForm.boxes) || 0
  const entryKilos = Number(lineForm.kilos) || 0
  const entryAvg = entryBoxes > 0 ? entryKilos / entryBoxes : 0
  const onHandAvg = lineAvail.boxes > 0 ? avgKgBox(lineAvail) : 0
  const normalAvg = onHandAvg || avgMap[lineForm.item_id] || 0
  const deviation = normalAvg > 0 && entryAvg > 0 ? Math.abs(entryAvg - normalAvg) / normalAvg : null
  const health = deviation == null ? 'unknown' : deviation <= 0.1 ? 'ok' : deviation <= 0.25 ? 'warn' : 'bad'

  async function fetchAll() {
    setLoading(true)
    const [{ data: invData }, { data: linesData }, { data: paymentsData }, { data: custData }, { data: itemsData }] =
      await Promise.all([
        supabase.from('invoices').select('*, customers(business_name, display_name, type)').eq('id', id).single(),
        supabase.from('invoice_lines').select('*, items(name)').eq('invoice_id', id).order('created_at'),
        supabase.from('partial_payments').select('*').eq('invoice_id', id).order('date_paid'),
        supabase.from('customers').select('id, business_name, display_name').eq('location', activeLocation).order('business_name'),
        supabase.from('items').select('id, name').eq('location', activeLocation).order('name'),
      ])
    setInv(invData)
    setHeaderForm({
      invoice_number: invData?.invoice_number ?? '',
      customer_id: invData?.customer_id ?? '',
      date: invData?.date ?? '',
      storage: invData?.storage ?? 'Everest',
      sale_type: invData?.sale_type ?? 'Walk-in',
      notes: invData?.notes ?? '',
    })
    setLines(linesData ?? [])
    setPayments(paymentsData ?? [])
    setCustomers(custData ?? [])
    setItems(itemsData ?? [])
    setLoading(false)
  }

  // ── Header ───────────────────────────────────────────────
  async function saveHeader(e) {
    e.preventDefault()
    setSavingHeader(true)
    await supabase.from('invoices').update({
      invoice_number: headerForm.invoice_number,
      customer_id: headerForm.customer_id || null,
      date: headerForm.date,
      storage: headerForm.storage,
      sale_type: headerForm.sale_type,
      notes: headerForm.notes?.trim() || null,
    }).eq('id', id)
    setSavingHeader(false)
    setEditingHeader(false)
    fetchAll()
    loadInventory()
  }

  // ── Lines ─────────────────────────────────────────────────
  function openAddLine() {
    setLineForm({ ...EMPTY_LINE, storage: inv?.storage || '' })
    setEditLineId(null)
    setLineError('')
    setLineModal(true)
  }

  function openEditLine(l) {
    setLineForm({
      item_id: l.item_id,
      unit_price: l.unit_price,
      boxes: l.boxes ?? '',
      kilos: l.kilos,
      storage: l.storage ?? '',
    })
    setEditLineId(l.id)
    setLineError('')
    setLineModal(true)
  }

  function saveLine(e) {
    e.preventDefault()
    if (!lineForm.item_id) { setLineError('Select an item.'); return }
    if (!lineForm.kilos || Number(lineForm.kilos) <= 0) { setLineError('Kilos is required.'); return }
    if (isBN) {
      if (!lineForm.boxes) { setLineError('Boxes is required for BN entries.'); return }
    } else if (!lineForm.unit_price) {
      setLineError('Unit price is required.'); return
    }
    if (!lineStorage) { setLineError('Set the invoice warehouse first (Edit the header), or pick one for this line.'); return }

    // Over-sell guard (against on-hand at the line's warehouse)
    const avail = lookup(invMap, lineForm.item_id, lineStorage)
    const reqKilos = Number(lineForm.kilos)
    const reqBoxes = lineForm.boxes ? Number(lineForm.boxes) : 0
    if (reqKilos > avail.kilos + 1e-9 || reqBoxes > avail.boxes + 1e-9) {
      setOversell({ requested: { kilos: reqKilos, boxes: reqBoxes }, available: avail })
      return
    }
    doSaveLine(false)
  }

  async function doSaveLine(isOverride) {
    setSavingLine(true)
    setLineError('')
    const storage = lineForm.storage || inv.storage
    const item_id = lineForm.item_id
    const kilos = Number(lineForm.kilos)
    const boxes = lineForm.boxes ? Number(lineForm.boxes) : null

    // FIFO-allocate across batches
    const allocs = await allocateFIFO({ itemId: item_id, storage, kilos, boxes: boxes || 0, excludeLineId: editLineId })
    const batchList = [...new Set(allocs.map((a) => a.batch_number))].join(', ')

    const linePayload = {
      invoice_id: id, item_id, storage, batch_number: batchList,
      unit_price: lineForm.unit_price ? Number(lineForm.unit_price) : null, boxes, kilos,
    }

    let lineId = editLineId
    let err
    if (editLineId) {
      ;({ error: err } = await supabase.from('invoice_lines').update(linePayload).eq('id', editLineId))
      if (!err) await supabase.from('invoice_line_allocations').delete().eq('line_id', editLineId)
    } else {
      const { data, error: e2 } = await supabase.from('invoice_lines').insert(linePayload).select('id').single()
      err = e2
      lineId = data?.id
    }
    if (err) { setSavingLine(false); setLineError(err.message); setOversell(null); return }

    // Write the FIFO allocation rows
    const allocRows = allocs.map((a) => ({
      line_id: lineId, invoice_id: id, item_id, storage,
      batch_number: a.batch_number, boxes: a.boxes, kilos: a.kilos, date: inv.date,
    }))
    await supabase.from('invoice_line_allocations').insert(allocRows)

    if (isOverride) {
      const avail = lookup(invMap, item_id, storage)
      await supabase.from('oversell_overrides').insert({
        invoice_id: id, invoice_number: inv?.invoice_number ?? null,
        location: activeLocation,
        item_id, item_name: items.find((i) => i.id === item_id)?.name ?? '',
        storage, requested_kilos: kilos, available_kilos: avail.kilos,
        requested_boxes: boxes, available_boxes: avail.boxes,
      })
    }

    setSavingLine(false)
    setOversell(null)
    setLineModal(false)
    await recomputeStatus()
    fetchAll()
    loadInventory()
  }

  async function deleteLine() {
    if (!deleteLineTarget) return
    await supabase.from('invoice_lines').delete().eq('id', deleteLineTarget.id)
    setDeleteLineTarget(null)
    await recomputeStatus()
    fetchAll()
    loadInventory()
  }

  // Derive invoice status from current line totals vs payments and persist it.
  async function recomputeStatus() {
    const [{ data: ls }, { data: ps }] = await Promise.all([
      supabase.from('invoice_lines').select('amount').eq('invoice_id', id),
      supabase.from('partial_payments').select('amount_paid').eq('invoice_id', id),
    ])
    const total = (ls ?? []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
    const paid = (ps ?? []).reduce((s, p) => s + (Number(p.amount_paid) || 0), 0)
    const status = total - paid <= 0.01 ? 'Paid' : (paid > 0.01 ? 'Partial' : 'Unpaid')
    await supabase.from('invoices').update({ status }).eq('id', id)
  }

  // ── Payments ──────────────────────────────────────────────
  function openAddPayment() {
    const remaining = totalAmount - totalPaid
    setPayForm({ ...EMPTY_PAYMENT, remaining_balance: remaining > 0 ? fmt(remaining).replace(/,/g, '') : '0' })
    setEditPayId(null)
    setPayError('')
    setPayModal(true)
  }

  function openEditPayment(p) {
    setPayForm({
      amount_paid: p.amount_paid,
      date_paid: p.date_paid,
      mode_of_payment: p.mode_of_payment,
      deposit_date: p.deposit_date ?? '',
      remaining_balance: p.remaining_balance ?? '',
    })
    setEditPayId(p.id)
    setPayError('')
    setPayModal(true)
  }

  async function savePayment(e) {
    e.preventDefault()
    if (!payForm.amount_paid) { setPayError('Amount is required.'); return }
    setSavingPay(true)
    setPayError('')
    const payload = {
      invoice_id: id,
      amount_paid: Number(payForm.amount_paid),
      date_paid: payForm.date_paid,
      mode_of_payment: payForm.mode_of_payment,
      deposit_date: payForm.deposit_date || null,
      remaining_balance: payForm.remaining_balance ? Number(payForm.remaining_balance) : null,
    }
    let err
    if (editPayId) {
      ;({ error: err } = await supabase.from('partial_payments').update(payload).eq('id', editPayId))
    } else {
      ;({ error: err } = await supabase.from('partial_payments').insert(payload))
    }
    setSavingPay(false)
    if (err) { setPayError(err.message); return }
    setPayModal(false)
    await recomputeStatus()
    fetchAll()
  }

  async function deletePayment() {
    if (!deletePayTarget) return
    await supabase.from('partial_payments').delete().eq('id', deletePayTarget.id)
    setDeletePayTarget(null)
    await recomputeStatus()
    fetchAll()
  }

  async function deleteInvoice() {
    await supabase.from('invoices').delete().eq('id', id)
    navigate('/invoices')
  }

  // ── Totals ────────────────────────────────────────────────
  const totalAmount = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount_paid) || 0), 0)
  const balance = totalAmount - totalPaid

  if (loading) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">Loading…</p>
  if (!inv) return <p className="text-sm text-red-400 text-center py-20">Invoice not found.</p>

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button onClick={() => navigate('/invoices')} className="text-sm text-blue-600 hover:underline">
        ← Back to Invoices
      </button>

      {/* ── Invoice Header ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              Invoice <span className="text-blue-700">#{inv.invoice_number}</span>
            </h2>
            {!editingHeader && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[inv.status]}`}>
                {inv.status}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {!editingHeader && canEdit && (
              <>
                <button onClick={() => setEditingHeader(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
                <span className="text-gray-300">|</span>
                <button onClick={() => setDeleteInvConfirm(true)} className="text-sm text-red-500 hover:underline">Delete</button>
              </>
            )}
          </div>
        </div>

        {editingHeader ? (
          <form onSubmit={saveHeader} className="px-6 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <F label="Invoice #" value={headerForm.invoice_number} onChange={(v) => setHeaderForm({ ...headerForm, invoice_number: v })} />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date</label>
                <input type="date" value={headerForm.date} onChange={(e) => setHeaderForm({ ...headerForm, date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Customer *</label>
              <select value={headerForm.customer_id} onChange={(e) => setHeaderForm({ ...headerForm, customer_id: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Select a customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.display_name || c.business_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Warehouse</label>
                <select value={headerForm.storage} onChange={(e) => setHeaderForm({ ...headerForm, storage: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {storageOptions.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Sale Type</label>
                <select value={headerForm.sale_type} onChange={(e) => setHeaderForm({ ...headerForm, sale_type: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {SALE_TYPES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
              <textarea rows={2} value={headerForm.notes} onChange={(e) => setHeaderForm({ ...headerForm, notes: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={savingHeader} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {savingHeader ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingHeader(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-5 gap-x-8 gap-y-3 text-sm">
            <InfoRow label="Date" value={inv.date} />
            <InfoRow label="Customer" value={inv.customers ? (inv.customers.display_name || inv.customers.business_name) : 'Walk-in'} />
            <InfoRow label="Warehouse" value={inv.storage ?? '—'} />
            <InfoRow label="Sale Type" value={inv.sale_type} />
            <InfoRow label="Status" value={inv.status} />
            {inv.notes && (
              <div className="col-span-2 sm:col-span-5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Notes</span>
                <p className="text-gray-700 dark:text-gray-200 mt-0.5">{inv.notes}</p>
              </div>
            )}
            <div className="col-span-2 sm:col-span-5"><AttributionNote record={inv} /></div>
          </div>
        )}
      </div>

      {/* ── Line Items ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Line Items</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">{lines.length} item{lines.length !== 1 ? 's' : ''} · <span className="font-semibold text-gray-700 dark:text-gray-200">{money(totalAmount)}</span></span>
          </div>
          {canEdit && <button onClick={openAddLine} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
            + Add Item
          </button>}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-4 py-3">Batch(es)</th>
                  <th className="text-right px-4 py-3">Boxes</th>
                  <th className="text-right px-4 py-3">Kilos</th>
                  <th className="text-right px-4 py-3">Unit Price</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{l.items?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">{l.batch_number}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{l.boxes != null ? Number(l.boxes).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{fmt(l.kilos)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{money(l.unit_price)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-100">{money(l.amount)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canEdit && <button onClick={() => openEditLine(l)} className="text-blue-600 hover:underline text-xs mr-3">Edit</button>}
                      {canEdit && <button onClick={() => setDeleteLineTarget(l)} className="text-red-500 hover:underline text-xs">Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 font-semibold text-gray-700 dark:text-gray-200 text-sm">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wide">Invoice Total</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{money(totalAmount)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Payments / AR ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Payments</h3>
          </div>
          {canEdit && <button onClick={openAddPayment} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
            + Add Payment
          </button>}
        </div>

        {payments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Date Paid</th>
                  <th className="text-left px-4 py-3">Mode</th>
                  <th className="text-left px-4 py-3">Deposit Date</th>
                  <th className="text-right px-4 py-3">Amount Paid</th>
                  <th className="text-right px-4 py-3">Remaining</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{p.date_paid}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{p.mode_of_payment}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.deposit_date ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-700">{money(p.amount_paid)}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{p.remaining_balance != null ? `${money(p.remaining_balance)}` : '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canEdit && <button onClick={() => openEditPayment(p)} className="text-blue-600 hover:underline text-xs mr-3">Edit</button>}
                      {canEdit && <button onClick={() => setDeletePayTarget(p)} className="text-red-500 hover:underline text-xs">Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Running balance footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-10 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Total Paid: <span className="font-semibold text-gray-800 dark:text-gray-100">{money(totalPaid)}</span></span>
          <span className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
            Balance: {money(balance)}
          </span>
        </div>
      </div>

      {/* ── Line Item Modal ── */}
      {lineModal && (
        <Modal title={editLineId ? 'Edit Line Item' : 'Add Line Item'} onClose={() => setLineModal(false)}>
          <form onSubmit={saveLine} className="space-y-3">
            {lineError && <p className="text-red-500 text-xs">{lineError}</p>}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Item *</label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={showAllItems} onChange={(e) => setShowAllItems(e.target.checked)} className="h-3 w-3 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                  Show all items
                </label>
              </div>
              <select value={lineForm.item_id} onChange={(e) => setLineForm({ ...lineForm, item_id: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select item…</option>
                {itemsForDropdown.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              {lineForm.item_id && (
                <p className={`text-[11px] mt-1 ${lineAvail.kilos <= 0 ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                  On hand @ {lineStorage || '—'}: <span className="font-semibold">{lineAvail.boxes.toLocaleString(undefined, { maximumFractionDigits: 2 })} box</span> · <span className="font-semibold">{lineAvail.kilos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</span>
                  {lineAvail.boxes > 0 && <> · avg {avgKgBox(lineAvail).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/box</>}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Warehouse</label>
              <select value={lineForm.storage} onChange={(e) => setLineForm({ ...lineForm, storage: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {storageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Defaults to the invoice's warehouse ({invStorage || '—'}); override to draw this item from a different one.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Boxes" value={lineForm.boxes} onChange={(v) => setLineForm({ ...lineForm, boxes: v })} type="number" />
              <F label="Kilos *" value={lineForm.kilos} onChange={(v) => setLineForm({ ...lineForm, kilos: v })} type="number" />
              <F label={isBN ? "Unit Price" : "Unit Price *"} value={lineForm.unit_price} onChange={(v) => setLineForm({ ...lineForm, unit_price: v })} type="number" />
            </div>

            {/* kg/box auto-compute + health block */}
            {entryAvg > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                <span className={`inline-block h-8 w-8 rounded-md ${health === 'ok' ? 'bg-green-500' : health === 'warn' ? 'bg-amber-500' : health === 'bad' ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <div className="text-xs">
                  <p className="text-gray-700 dark:text-gray-200 font-medium">{entryAvg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/box</p>
                  <p className="text-gray-400 dark:text-gray-500">
                    {normalAvg > 0
                      ? <>normal ≈ {normalAvg.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/box · {health === 'ok' ? 'within range' : health === 'warn' ? `${(deviation * 100).toFixed(0)}% off — check` : `${(deviation * 100).toFixed(0)}% off — verify entry`}</>
                      : 'no reference avg for this item yet'}
                  </p>
                </div>
              </div>
            )}

            {lineForm.kilos && lineForm.unit_price && (
              <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
                Amount: <span className="font-semibold text-gray-800 dark:text-gray-100">{money(Number(lineForm.kilos) * Number(lineForm.unit_price))}</span>
              </p>
            )}
            <ModalActions onCancel={() => setLineModal(false)} saving={savingLine} />
          </form>
        </Modal>
      )}

      {/* ── Oversell override confirmation ── */}
      {oversell && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">⚠ Not enough stock</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Selling <span className="font-medium text-gray-700 dark:text-gray-200">{oversell.requested.kilos.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg</span>
              {oversell.requested.boxes ? <> / {oversell.requested.boxes} box</> : null} but only{' '}
              <span className="font-medium text-gray-700 dark:text-gray-200">{oversell.available.kilos.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg</span>
              {' '}/ {oversell.available.boxes.toLocaleString(undefined, { maximumFractionDigits: 2 })} box on hand at {lineStorage}.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">This override will be logged for admin approval.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setOversell(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={() => doSaveLine(true)} disabled={savingLine} className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {savingLine ? 'Saving…' : 'Override & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payment Modal ── */}
      {payModal && (
        <Modal title={editPayId ? 'Edit Payment' : 'Add Payment'} onClose={() => setPayModal(false)}>
          <form onSubmit={savePayment} className="space-y-3">
            {payError && <p className="text-red-500 text-xs">{payError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <F label="Amount Paid *" value={payForm.amount_paid} onChange={(v) => setPayForm({ ...payForm, amount_paid: v })} type="number" />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date Paid</label>
                <input type="date" value={payForm.date_paid} onChange={(e) => setPayForm({ ...payForm, date_paid: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Mode of Payment</label>
                <button type="button" onClick={() => setManageList('payment_method')} className="text-[11px] text-blue-600 hover:underline">Manage</button>
              </div>
              <select value={payForm.mode_of_payment} onChange={(e) => setPayForm({ ...payForm, mode_of_payment: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {paymentOptions.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Deposit Date</label>
                <input type="date" value={payForm.deposit_date} onChange={(e) => setPayForm({ ...payForm, deposit_date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <F label="Remaining Balance" value={payForm.remaining_balance} onChange={(v) => setPayForm({ ...payForm, remaining_balance: v })} type="number" />
            </div>
            <ModalActions onCancel={() => setPayModal(false)} saving={savingPay} />
          </form>
        </Modal>
      )}

      {/* ── Confirm Dialogs ── */}
      {deleteLineTarget && (
        <Confirm
          title="Delete line item?"
          message={`${deleteLineTarget.items?.name} — Batch ${deleteLineTarget.batch_number} will be removed.`}
          onCancel={() => setDeleteLineTarget(null)}
          onConfirm={deleteLine}
        />
      )}
      {deletePayTarget && (
        <Confirm
          title="Delete payment?"
          message={`${money(deletePayTarget.amount_paid)} on ${deletePayTarget.date_paid} will be removed.`}
          onCancel={() => setDeletePayTarget(null)}
          onConfirm={deletePayment}
        />
      )}
      {deleteInvConfirm && (
        <Confirm
          title="Delete this invoice?"
          message={`Invoice #${inv.invoice_number} and all its lines and payments will be permanently deleted.`}
          onCancel={() => setDeleteInvConfirm(false)}
          onConfirm={deleteInvoice}
          destructive
        />
      )}

      {manageList && (
        <ManageListModal
          listType={manageList}
          title={manageList === 'storage' ? 'Manage Storage Locations' : 'Manage Payment Methods'}
          onClose={() => setManageList(null)}
          onChange={loadLists}
        />
      )}
    </div>
  )
}

// ── Shared small components ───────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</span>
      <p className="text-gray-800 dark:text-gray-100 mt-0.5">{value ?? '—'}</p>
    </div>
  )
}

function F({ label, value, onChange, type = 'text' }) {
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

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function ModalActions({ onCancel, saving }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
      <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function Confirm({ title, message, onCancel, onConfirm, destructive = true }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
          <button onClick={onConfirm} className={`text-white text-sm font-medium px-4 py-2 rounded-lg ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
