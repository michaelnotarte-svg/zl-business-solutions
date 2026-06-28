import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { money } from '../lib/settings'
import { downloadCSV } from '../lib/csv'
import ReportLetterhead from '../components/ReportLetterhead'

const num = (x) => Number(x) || 0
const kg = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const bxn = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

function custName(inv) {
  if (!inv.customers) return '—'
  return inv.customers.display_name || inv.customers.business_name || '—'
}

function mopOf(inv) {
  return inv.payment_method || (inv.status === 'Unpaid' ? 'A.R.' : '—')
}

export default function Snapshot() {
  const { activeLocation } = useAuth()
  const [date, setDate] = useState('')
  const [invoices, setInvoices] = useState([])
  const [expenses, setExpenses] = useState([])
  const [stock, setStock] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { initDate() }, [activeLocation])
  useEffect(() => { if (date) fetchDay() }, [date, activeLocation]) // eslint-disable-line

  async function initDate() {
    const { data } = await supabase.from('invoices').select('date').eq('location', activeLocation).order('date', { ascending: false }).limit(1)
    setDate(data?.[0]?.date || new Date().toISOString().slice(0, 10))
  }

  async function fetchDay() {
    setLoading(true)
    const [inv, exp, st] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, customers(display_name, business_name), invoice_lines(*, items(name))')
        .eq('date', date)
        .eq('location', activeLocation)
        .order('invoice_number'),
      supabase.from('expenses').select('description, category, amount').eq('date', date).eq('location', activeLocation).order('amount', { ascending: false }),
      supabase.from('stock_entries').select('boxes, kilos, item_id, storage, batch_number, items(name), purchase_orders!inner(source, location)').eq('date', date).eq('purchase_orders.location', activeLocation),
    ])
    setInvoices(inv.data ?? [])
    setExpenses(exp.data ?? [])
    setStock(st.data ?? [])
    setLoading(false)
  }

  // ── Aggregations ─────────────────────────────────────────
  const lines = invoices.flatMap((inv) => (inv.invoice_lines ?? []).map((l) => ({ inv, l })))
  const boxesSold = lines.reduce((s, { l }) => s + num(l.boxes), 0)
  const kilosSold = lines.reduce((s, { l }) => s + num(l.kilos), 0)
  const salesAmount = lines.reduce((s, { l }) => s + num(l.amount), 0)
  const invTotal = (inv) => (inv.invoice_lines ?? []).reduce((s, l) => s + num(l.amount), 0)

  const expenseTotal = expenses.reduce((s, e) => s + num(e.amount), 0)

  const stockKilos = stock.reduce((s, r) => s + num(r.kilos), 0)
  const stockBoxes = stock.reduce((s, r) => s + num(r.boxes), 0)
  const stockItems = new Set(stock.map((r) => r.item_id)).size
  const stockBySource = Object.values(
    stock.reduce((acc, r) => {
      const src = r.purchase_orders?.source || '—'
      const key = `${src}→${r.storage}`
      if (!acc[key]) acc[key] = { src, storage: r.storage, kilos: 0 }
      acc[key].kilos += num(r.kilos)
      return acc
    }, {})
  )

  const bySaleType = Object.entries(
    invoices.reduce((acc, inv) => {
      acc[inv.sale_type] = (acc[inv.sale_type] || 0) + invTotal(inv)
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  const byMOP = Object.entries(
    invoices.reduce((acc, inv) => {
      const m = mopOf(inv)
      acc[m] = (acc[m] || 0) + invTotal(inv)
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])

  function printPDF() {
    const wasDark = document.documentElement.classList.contains('dark')
    if (wasDark) document.documentElement.classList.remove('dark')
    window.print()
    if (wasDark) document.documentElement.classList.add('dark')
  }

  function exportCSV() {
    const rows = lines.map(({ inv, l }) => ({
      OR: inv.invoice_number,
      Customer: custName(inv),
      Item: l.items?.name ?? '',
      UP: l.unit_price,
      Boxes: l.boxes,
      Kgs: l.kilos,
      Amount: num(l.amount).toFixed(2),
      MOP: mopOf(inv),
    }))
    downloadCSV(`daily_snapshot_${date}.csv`, rows, [
      { key: 'OR', label: 'OR no.' },
      { key: 'Customer', label: 'Customer Name' },
      { key: 'Item', label: 'Item' },
      { key: 'UP', label: 'U.P.' },
      { key: 'Boxes', label: 'Boxes' },
      { key: 'Kgs', label: 'Kgs' },
      { key: 'Amount', label: 'Amount' },
      { key: 'MOP', label: 'MOP' },
    ])
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Controls (hidden in print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Daily Snapshot</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={exportCSV} className="text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40">⬇ Excel/CSV</button>
          <button onClick={printPDF} className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-2 rounded-lg">🖨 Print / PDF</button>
        </div>
      </div>

      {/* Printable report */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 print:border-0 print:p-0">
        {/* Report header */}
        <ReportLetterhead date={date} subtitle="Daily Snapshot" />

        {loading ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">Loading…</p>
        ) : (
          <>
            {/* KPI subheaders */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Card title="Sales" accent="blue">
                <Stat label="Amount" value={money(salesAmount)} big />
                <Stat label="Boxes sold" value={bxn(boxesSold)} />
                <Stat label="Kilos sold" value={`${kg(kilosSold)} kg`} />
              </Card>
              <Card title="Expenses" accent="red">
                <Stat label="Total" value={money(expenseTotal)} big />
              </Card>
              <Card title="Stocks Received" accent="green">
                <Stat label="Total kilos" value={`${kg(stockKilos)} kg`} big />
                <Stat label="Boxes" value={bxn(stockBoxes)} />
                <Stat label="Items" value={stockItems} />
                {stockBySource.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                    {stockBySource.map((s, i) => (
                      <div key={i}>{s.src} → {s.storage}: {kg(s.kilos)} kg</div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Sale type + MOP breakdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <MiniTable title="Sales by Type" rows={bySaleType} />
              <MiniTable title="Sales by Payment Method" rows={byMOP} />
            </div>

            {/* Sales breakout */}
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Sales Breakout</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">OR no.</th>
                    <th className="text-left px-3 py-2">Customer Name</th>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">U.P.</th>
                    <th className="text-right px-3 py-2">Boxes</th>
                    <th className="text-right px-3 py-2">Kgs</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">MOP</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-gray-400 dark:text-gray-500 py-8">No sales on this date.</td></tr>
                  ) : invoices.map((inv) => (inv.invoice_lines ?? []).map((l, idx) => (
                    <tr key={l.id} className={`${idx === 0 ? 'border-t-2 border-gray-200 dark:border-gray-700' : ''}`}>
                      <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">{idx === 0 ? inv.invoice_number : ''}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{idx === 0 ? custName(inv) : ''}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{l.items?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{bxn(l.unit_price)}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{bxn(l.boxes)} Boxes</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{kg(l.kilos)} kgs</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(l.amount)}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{idx === 0 ? mopOf(inv) : ''}</td>
                    </tr>
                  )))}
                </tbody>
                {lines.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-900 font-semibold text-gray-700 dark:text-gray-200 border-t-2 border-gray-200 dark:border-gray-700">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Totals</td>
                      <td className="px-3 py-2 text-right">{bxn(boxesSold)}</td>
                      <td className="px-3 py-2 text-right">{kg(kilosSold)}</td>
                      <td className="px-3 py-2 text-right">{money(salesAmount)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Expenses breakout */}
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2 mt-6">Expenses Breakout</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {expenses.length === 0 ? (
                    <tr><td colSpan={3} className="text-center text-gray-400 dark:text-gray-500 py-8">No expenses on this date.</td></tr>
                  ) : expenses.map((e, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{e.description}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{e.category ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-900 font-semibold text-gray-700 dark:text-gray-200 border-t-2 border-gray-200 dark:border-gray-700">
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Total</td>
                      <td className="px-3 py-2 text-right">{money(expenseTotal)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Stock movements breakout */}
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2 mt-6">Stock Movements Breakout</h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-left px-3 py-2">Batch #</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Warehouse</th>
                    <th className="text-right px-3 py-2">Boxes</th>
                    <th className="text-right px-3 py-2">Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {stock.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 dark:text-gray-500 py-8">No stock received on this date.</td></tr>
                  ) : stock.map((s, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100">{s.items?.name ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{s.batch_number ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{s.purchase_orders?.source ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{s.storage}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{bxn(s.boxes)}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{kg(s.kilos)}</td>
                    </tr>
                  ))}
                </tbody>
                {stock.length > 0 && (
                  <tfoot className="bg-gray-50 dark:bg-gray-900 font-semibold text-gray-700 dark:text-gray-200 border-t-2 border-gray-200 dark:border-gray-700">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Totals</td>
                      <td className="px-3 py-2 text-right">{bxn(stockBoxes)}</td>
                      <td className="px-3 py-2 text-right">{kg(stockKilos)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const ACCENT = {
  blue:  'border-blue-200 dark:border-blue-500/30',
  red:   'border-red-200 dark:border-red-500/30',
  green: 'border-green-200 dark:border-green-500/30',
}

function Card({ title, accent, children }) {
  return (
    <div className={`rounded-xl border ${ACCENT[accent]} bg-white dark:bg-gray-800 px-5 py-4`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Stat({ label, value, big }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`${big ? 'text-lg font-bold' : 'text-sm font-medium'} text-gray-800 dark:text-gray-100`}>{value}</span>
    </div>
  )
}

function MiniTable({ title, rows }) {
  const total = rows.reduce((s, [, v]) => s + v, 0)
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.length === 0 ? (
            <tr><td className="px-4 py-2 text-gray-400 dark:text-gray-500">—</td></tr>
          ) : rows.map(([k, v]) => (
            <tr key={k}>
              <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{k}</td>
              <td className="px-4 py-2 text-right font-medium text-gray-800 dark:text-gray-100">{money(v)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
            <tr>
              <td className="px-4 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Total</td>
              <td className="px-4 py-2 text-right font-bold text-gray-800 dark:text-gray-100">{money(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
