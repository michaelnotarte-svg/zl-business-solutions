// Generic CSV export. rows = array of flat objects; columns inferred from `headers`
// (array of { key, label }) or from the first row's keys.
export function downloadCSV(filename, rows, headers) {
  if (!rows || rows.length === 0) return
  const cols = headers || Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    cols.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
