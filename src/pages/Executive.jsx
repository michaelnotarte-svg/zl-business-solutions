import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { money, getThresholds, stockStatus } from '../lib/settings'
import { fetchMovements } from '../lib/inventory'

const num = (x) => Number(x) || 0
const kg = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const COLORS = ['#3b82f6', '#a855f7', '#14b8a6', '#f59e0b', '#ef4444']

function monthKey(d) { return (d || '').slice(0, 7) }
function lastMonths(n) {
  const out = []
  const base = new Date(); base.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(base); m.setMonth(base.getMonth() - i)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export default function Executive() {
  const { isAdmin } = useAuth()
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  async function load() {
    setLoading(true)
    setError('')
    const [{ data: locRows }, { data: agg, error: aggErr }] = await Promise.all([
      supabase.from('locations').select('name').order('name'),
      supabase.rpc('exec_summary'),
    ])
    if (aggErr) { setError(aggErr.message); setLoading(false); return }
    const locations = (locRows ?? []).map((l) => l.name)

    // Per-location current inventory flags (admin bypasses RLS so fetchMovements(loc) works)
    const flags = {}
    await Promise.all(locations.map(async (loc) => {
      const moves = await fetchMovements(loc)
      const byItem = {} // item_id -> { boxes, kilos }
      for (const m of moves) {
        const o = byItem[m.item_id] || (byItem[m.item_id] = { boxes: 0, kilos: 0 })
        o.boxes += m.boxes; o.kilos += m.kilos
      }
      const th = getThresholds(loc)
      const c = { Critical: 0, Low: 0, Sufficient: 0 }
      for (const id in byItem) {
        if (Math.abs(byItem[id].kilos) < 0.005) continue // depleted, not counted (matches Inventory)
        c[stockStatus(byItem[id].boxes, th)]++
      }
      flags[loc] = c
    }))

    setD({ locations, agg: agg ?? {}, flags })
    setLoading(false)
  }

  if (!isAdmin) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">Executive Summary is available to admins only.</p>
  if (error) return <p className="text-sm text-red-500 text-center py-20">Failed to load: {error}</p>
  if (loading || !d) return <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-20">Loading…</p>

  const { locations, agg, flags } = d
  const months = lastMonths(6)
  const thisM = months[months.length - 1]
  const prevM = months[months.length - 2]

  // ── Sales by location / month (from RPC) ──
  const salesLM = {} // loc -> month -> total
  for (const r of agg.sales_by_loc_month ?? []) {
    const loc = r.location || '—'
    salesLM[loc] = salesLM[loc] || {}
    salesLM[loc][r.month] = (salesLM[loc][r.month] ?? 0) + num(r.total)
  }
  const salesMonth = (m) => locations.reduce((s, loc) => s + (salesLM[loc]?.[m] ?? 0), 0)
  const totalSalesThis = salesMonth(thisM)
  const totalSalesPrev = salesMonth(prevM)
  const salesDelta = totalSalesPrev > 0 ? ((totalSalesThis - totalSalesPrev) / totalSalesPrev) * 100 : null

  // ── Expenses by loc / month (from RPC) ──
  const expLM = {}
  for (const r of agg.expenses_by_loc_month ?? []) {
    const loc = r.location || '—'
    expLM[loc] = expLM[loc] || {}
    expLM[loc][r.month] = (expLM[loc][r.month] ?? 0) + num(r.total)
  }
  const expLoc = (loc) => expLM[loc]?.[thisM] ?? 0
  const totalExpThis = locations.reduce((s, loc) => s + expLoc(loc), 0)

  // ── Stocks in / transferred (this month) by loc (from RPC) ──
  const stocksIn = {}, stocksXfer = {}
  for (const r of agg.stock_by_loc_month ?? []) {
    if (r.month !== thisM) continue
    const loc = r.location || '—'
    if (r.transfer) stocksXfer[loc] = (stocksXfer[loc] ?? 0) + num(r.kilos)
    else stocksIn[loc] = (stocksIn[loc] ?? 0) + num(r.kilos)
  }

  // ── Unpaid by loc (from RPC; BN excluded server-side) ──
  const unpaid = {} // loc -> {count, amount}
  let unpaidCountAll = 0, unpaidAmtAll = 0
  for (const r of agg.unpaid ?? []) {
    const loc = r.location || '—'
    unpaid[loc] = { count: num(r.count), amount: num(r.amount) }
    unpaidCountAll += num(r.count); unpaidAmtAll += num(r.amount)
  }

  // ── Top customers & items (from RPC) ──
  const topCustomers = (agg.top_customers ?? []).map((r) => [r.name, num(r.amount)])
  const topItems = (agg.top_items ?? []).map((r) => [r.name, { amount: num(r.amount), kilos: num(r.kilos) }])

  const salesSeries = locations.map((loc, i) => ({ name: loc, color: COLORS[i % COLORS.length], values: months.map((m) => salesLM[loc]?.[m] ?? 0) }))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Executive Summary</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500">All branches · current month ({thisM}) unless noted · admin only</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Kpi label="Total Sales (mo)" value={money(totalSalesThis)} accent="blue"
          sub={salesDelta == null ? 'no prior month' : `${salesDelta >= 0 ? '▲' : '▼'} ${Math.abs(salesDelta).toFixed(1)}% vs ${prevM}`}
          subColor={salesDelta == null ? '' : salesDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
        <Kpi label="Total Expenses (mo)" value={money(totalExpThis)} accent="amber" />
        <Kpi label="Unpaid Invoices" value={unpaidCountAll} accent="red" sub="Unpaid + Partial" />
        <Kpi label="Unpaid Amount" value={money(unpaidAmtAll)} accent="red" sub="outstanding balance" />
      </div>

      {/* Monthly sales trend */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Monthly Sales Trend</h2>
          <div className="flex gap-3 text-xs">
            {salesSeries.map((s) => (
              <span key={s.name} className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}
              </span>
            ))}
          </div>
        </div>
        <BarChart months={months} series={salesSeries} />
      </div>

      {/* Per-branch breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {locations.map((loc) => {
          const f = flags[loc] || { Critical: 0, Low: 0, Sufficient: 0 }
          const up = unpaid[loc] || { count: 0, amount: 0 }
          return (
            <div key={loc} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-800 dark:text-gray-100 text-sm">📍 {loc}</div>
              <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Stat label="Sales (mo)" value={money(salesLM[loc]?.[thisM] ?? 0)} />
                <Stat label="Expenses (mo)" value={money(expLoc(loc))} />
                <Stat label="Stocks in (mo)" value={`${kg(stocksIn[loc] ?? 0)} kg`} />
                <Stat label="Transferred (mo)" value={`${kg(stocksXfer[loc] ?? 0)} kg`} />
                <Stat label="Unpaid" value={`${up.count} · ${money(up.amount)}`} />
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Inventory flags</span>
                  <div className="flex gap-1.5 mt-1">
                    <Flag n={f.Critical} cls="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" label="Crit" />
                    <Flag n={f.Low} cls="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" label="Low" />
                    <Flag n={f.Sufficient} cls="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" label="OK" />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Top customers & items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopTable title="Top Customers" rows={topCustomers.map(([n, v]) => [n, money(v)])} />
        <TopTable title="Top Items" rows={topItems.map(([n, v]) => [n, `${money(v.amount)} · ${kg(v.kilos)} kg`])} />
      </div>
    </div>
  )
}

// ── Inline grouped bar chart (no dependency) ──
function BarChart({ months, series }) {
  const W = 620, H = 200, padL = 44, padB = 22, padT = 8
  const max = Math.max(1, ...series.flatMap((s) => s.values))
  const groups = months.length
  const groupW = (W - padL - 8) / groups
  const barW = Math.max(4, (groupW - 6) / Math.max(1, series.length))
  const y = (v) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 4} y1={y(max * t)} y2={y(max * t)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="1" />
          <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="9">{kg(max * t)}</text>
        </g>
      ))}
      {months.map((m, gi) => (
        <g key={m}>
          {series.map((s, si) => {
            const v = s.values[gi]
            const x = padL + gi * groupW + 3 + si * barW
            return <rect key={si} x={x} y={y(v)} width={barW - 1} height={Math.max(0, H - padB - y(v))} fill={s.color} rx="1" />
          })}
          <text x={padL + gi * groupW + groupW / 2} y={H - 8} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize="9">{m.slice(2)}</text>
        </g>
      ))}
    </svg>
  )
}

const KPI_ACCENT = {
  blue: 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10',
  amber: 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
  red: 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10',
}
function Kpi({ label, value, sub, subColor, accent }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${KPI_ACCENT[accent] ?? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      {sub && <p className={`text-[11px] ${subColor || 'text-gray-400 dark:text-gray-500'}`}>{sub}</p>}
    </div>
  )
}
function Stat({ label, value }) {
  return (
    <div>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <p className="font-semibold text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  )
}
function Flag({ n, cls, label }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{n} {label}</span>
}
function TopTable({ title, rows }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.length === 0 ? (
            <tr><td className="px-4 py-3 text-gray-400 dark:text-gray-500">No data</td></tr>
          ) : rows.map(([name, val], i) => (
            <tr key={i}>
              <td className="px-4 py-2.5 text-gray-800 dark:text-gray-100">{i + 1}. {name}</td>
              <td className="px-4 py-2.5 text-right font-medium text-gray-700 dark:text-gray-200">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
