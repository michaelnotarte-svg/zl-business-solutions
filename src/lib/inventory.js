import { supabase, selectAll } from './supabase'

const num = (x) => Number(x) || 0

// Single source of truth for inventory movements, used by the Inventory page
// and the on-hand helpers in the entry forms.
// Pass `location` to scope everything to one branch.
// Returns an array of { date, item_id, item, batch, storage, boxes, kilos, type }.
export async function fetchMovements(location = null) {
  const archB = () => {
    let q = supabase.from('inventory_archive').select('snapshot_date, item_id, batch_number, storage, boxes, kilos, items(name)')
    return location ? q.eq('location', location) : q
  }
  const stockB = () => {
    let q = supabase.from('stock_entries').select('date, item_id, batch_number, storage, boxes, kilos, items(name), purchase_orders!inner(from_storage, location)')
    return location ? q.eq('purchase_orders.location', location) : q
  }
  // Sales come from FIFO batch allocations (per batch), not the raw line
  const salesB = () => {
    let q = supabase.from('invoice_line_allocations').select('date, item_id, batch_number, storage, boxes, kilos, items(name), invoices!inner(location)')
    return location ? q.eq('invoices.location', location) : q
  }
  const adjB = () => {
    let q = supabase.from('inventory_adjustments').select('date, item_id, batch_number, storage, boxes, kilos, items(name)')
    return location ? q.eq('location', location) : q
  }

  const [arch, stock, sales, adj] = await Promise.all([
    selectAll(archB), selectAll(stockB), selectAll(salesB), selectAll(adjB),
  ])

  const m = []
  for (const r of arch ?? [])
    m.push({ date: r.snapshot_date, item_id: r.item_id, item: r.items?.name ?? '—', batch: r.batch_number ?? '—', storage: r.storage, boxes: num(r.boxes), kilos: num(r.kilos), type: 'Opening' })

  for (const r of stock ?? []) {
    const from = r.purchase_orders?.from_storage
    const base = { date: r.date, item_id: r.item_id, item: r.items?.name ?? '—', batch: r.batch_number ?? '—' }
    if (from) {
      // Transfer: into destination (line storage), out of the from warehouse
      m.push({ ...base, storage: r.storage, boxes: num(r.boxes), kilos: num(r.kilos), type: 'Transfer In' })
      m.push({ ...base, storage: from, boxes: -num(r.boxes), kilos: -num(r.kilos), type: 'Transfer Out' })
    } else {
      m.push({ ...base, storage: r.storage, boxes: num(r.boxes), kilos: num(r.kilos), type: 'Stock Dump' })
    }
  }

  for (const r of sales ?? [])
    m.push({ date: r.date, item_id: r.item_id, item: r.items?.name ?? '—', batch: r.batch_number ?? '—', storage: r.storage, boxes: -num(r.boxes), kilos: -num(r.kilos), type: 'Sale' })

  for (const r of adj ?? [])
    m.push({ date: r.date, item_id: r.item_id, item: r.items?.name ?? '—', batch: r.batch_number ?? '—', storage: r.storage, boxes: num(r.boxes), kilos: num(r.kilos), type: 'Adjustment' })

  return m.filter((x) => x.date)
}

// Build a Map keyed `${item_id}|${storage}` -> { boxes, kilos } as of an optional date.
export function onHandMap(moves, asOf) {
  const map = new Map()
  for (const mv of moves) {
    if (asOf && mv.date > asOf) continue
    const k = `${mv.item_id}|${mv.storage}`
    const o = map.get(k) || { boxes: 0, kilos: 0 }
    o.boxes += mv.boxes
    o.kilos += mv.kilos
    map.set(k, o)
  }
  return map
}

export function lookup(map, itemId, storage) {
  return map.get(`${itemId}|${storage}`) || { boxes: 0, kilos: 0 }
}

// Set of item_ids that have positive kilos at a given storage.
export function inStockItemIds(map, storage) {
  const ids = new Set()
  for (const [k, v] of map) {
    const [itemId, st] = k.split('|')
    if (st === storage && v.kilos > 0) ids.add(itemId)
  }
  return ids
}

export function avgKgBox(onhand) {
  return onhand.boxes > 0 ? onhand.kilos / onhand.boxes : 0
}

// Normal kg/box per item from inflows (stock/opening/transfer-in/positive adj).
export function itemAvgMap(moves) {
  const acc = {}
  for (const m of moves) {
    if (m.type === 'Sale') continue
    if (m.boxes > 0 && m.kilos > 0) {
      if (!acc[m.item_id]) acc[m.item_id] = { k: 0, b: 0 }
      acc[m.item_id].k += m.kilos
      acc[m.item_id].b += m.boxes
    }
  }
  const out = {}
  for (const id in acc) out[id] = acc[id].b > 0 ? acc[id].k / acc[id].b : 0
  return out
}

// FIFO-allocate a sale of `kilos`/`boxes` for item+storage across available batches
// (oldest first). Returns [{ batch_number, kilos, boxes }]. Excess (oversell) lands
// on the newest batch. `excludeLineId` ignores an existing line's allocations (for edits).
export async function allocateFIFO({ itemId, storage, kilos, boxes, excludeLineId }) {
  const moves = await fetchMovements()

  // Available before sales, per batch (+ earliest date for FIFO ordering)
  const batchMap = {}
  for (const m of moves) {
    if (m.item_id !== itemId || m.storage !== storage || m.type === 'Sale') continue
    if (!batchMap[m.batch]) batchMap[m.batch] = { kilos: 0, date: m.date }
    batchMap[m.batch].kilos += m.kilos
    if (m.date < batchMap[m.batch].date) batchMap[m.batch].date = m.date
  }

  // Subtract existing sale allocations (excluding the line being edited)
  const { data: allocs } = await supabase
    .from('invoice_line_allocations')
    .select('batch_number, kilos, line_id')
    .eq('item_id', itemId)
    .eq('storage', storage)
  for (const a of allocs ?? []) {
    if (excludeLineId && a.line_id === excludeLineId) continue
    const b = a.batch_number ?? '—'
    if (!batchMap[b]) batchMap[b] = { kilos: 0, date: '9999-12-31' }
    batchMap[b].kilos -= num(a.kilos)
  }

  const batches = Object.entries(batchMap)
    .map(([batch, v]) => ({ batch, kilos: v.kilos, date: v.date }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  let remK = num(kilos)
  const result = []
  for (const b of batches) {
    if (remK <= 1e-9) break
    if (b.kilos <= 1e-9) continue
    const take = Math.min(b.kilos, remK)
    result.push({ batch_number: b.batch, kilos: take })
    remK -= take
  }
  // Oversell remainder → newest batch (or a placeholder if no batches exist)
  if (remK > 1e-9) {
    const lastBatch = batches.length ? batches[batches.length - 1].batch : '—'
    const existing = result.find((r) => r.batch_number === lastBatch)
    if (existing) existing.kilos += remK
    else result.push({ batch_number: lastBatch, kilos: remK })
  }
  if (result.length === 0) result.push({ batch_number: '—', kilos: num(kilos) })

  // Distribute boxes proportionally to kilos
  const totalK = result.reduce((s, r) => s + r.kilos, 0) || 1
  const totalBoxes = boxes ? num(boxes) : 0
  for (const r of result) r.boxes = totalBoxes ? totalBoxes * (r.kilos / totalK) : null

  return result
}
