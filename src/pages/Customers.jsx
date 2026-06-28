import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const EMPTY_FORM = {
  type: 'Customer',
  business_name: '',
  display_name: '',
  owner_name: '',
  address: '',
  contact: '',
  notes: '',
}

export default function Customers() {
  const { activeLocation, canWrite } = useAuth()
  const canEdit = canWrite('Sales')
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchCustomers()
  }, [activeLocation])

  async function fetchCustomers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('location', activeLocation)
      .order('business_name', { ascending: true })
    if (!error) setCustomers(data)
    setLoading(false)
  }

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase()
    return (
      c.business_name?.toLowerCase().includes(q) ||
      c.display_name?.toLowerCase().includes(q) ||
      c.owner_name?.toLowerCase().includes(q) ||
      c.contact?.toLowerCase().includes(q)
    )
  })

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setError('')
    setModalOpen(true)
  }

  function openEdit(c) {
    setForm({
      type: c.type ?? 'Customer',
      business_name: c.business_name ?? '',
      display_name: c.display_name ?? '',
      owner_name: c.owner_name ?? '',
      address: c.address ?? '',
      contact: c.contact ?? '',
      notes: c.notes ?? '',
    })
    setEditId(c.id)
    setError('')
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.business_name.trim()) {
      setError('Business name is required.')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      type: form.type,
      business_name: form.business_name.trim(),
      location: activeLocation,
      display_name: form.display_name.trim() || null,
      owner_name: form.owner_name.trim() || null,
      address: form.address.trim() || null,
      contact: form.contact.trim() || null,
      notes: form.notes.trim() || null,
    }
    let err
    if (editId) {
      ;({ error: err } = await supabase.from('customers').update(payload).eq('id', editId))
    } else {
      ;({ error: err } = await supabase.from('customers').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setModalOpen(false)
    fetchCustomers()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await supabase.from('customers').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    fetchCustomers()
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">Customers</h1>
        {canEdit && (
        <button
          onClick={openAdd}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Add Customer
        </button>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by name, owner, or contact…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">No customers found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Display Name</th>
                <th className="text-left px-4 py-3">Business Name</th>
                <th className="text-left px-4 py-3">Owner</th>
                <th className="text-left px-4 py-3">Contact</th>
                <th className="text-left px-4 py-3">Address</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.type === 'BN' ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'}`}>{c.type ?? 'Customer'}</span></td>
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{c.display_name || c.business_name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{c.business_name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{c.owner_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{c.contact ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-xs truncate">{c.address ?? '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && <button
                      onClick={() => openEdit(c)}
                      className="text-blue-600 hover:underline text-xs mr-3"
                    >
                      Edit
                    </button>}
                    {canEdit && <button
                      onClick={() => setDeleteTarget(c)}
                      className="text-red-500 hover:underline text-xs"
                    >
                      Delete
                    </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{editId ? 'Edit Customer' : 'Add Customer'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-4 space-y-3">
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Type</label>
                <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
                  {['Customer', 'BN'].map((t) => (
                    <button type="button" key={t} onClick={() => setForm({ ...form, type: t })} className={`px-4 py-1.5 text-sm font-medium ${form.type === t ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}>{t}</button>
                  ))}
                </div>
                {form.type === 'BN' && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Owner's draw / internal — prices are optional on invoices.</p>}
              </div>
              <Field label="Business Name *" value={form.business_name} onChange={(v) => setForm({ ...form, business_name: v })} />
              <div>
                <Field label="Display Name" value={form.display_name} onChange={(v) => setForm({ ...form, display_name: v })} />
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Shown throughout the app. Defaults to Business Name if left blank.</p>
              </div>
              <Field label="Owner Name" value={form.owner_name} onChange={(v) => setForm({ ...form, owner_name: v })} />
              <Field label="Contact" value={form.contact} onChange={(v) => setForm({ ...form, contact: v })} />
              <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Delete customer?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-700 dark:text-gray-200">{deleteTarget.business_name}</span> will be permanently removed.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">
                Cancel
              </button>
              <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
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
