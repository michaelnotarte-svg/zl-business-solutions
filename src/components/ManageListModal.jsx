import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Reusable editor for any list_options list.
 * Props:
 *   listType  - e.g. 'storage' | 'payment_method' | 'item_category'
 *   title     - heading shown in the modal
 *   onClose   - called when the modal should close
 *   onChange  - called after any add/remove so the parent can refetch options
 */
export default function ManageListModal({ listType, title, onClose, onChange }) {
  const { activeLocation } = useAuth()
  const branchScoped = listType === 'storage'
  const [options, setOptions] = useState([])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('list_options')
      .select('*')
      .eq('list_type', listType)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    const rows = (data ?? []).filter((r) => !branchScoped || !r.location || r.location === activeLocation)
    setOptions(rows)
    setLoading(false)
  }

  async function add(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError('')
    const nextOrder = (options.reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0) || 0) + 1
    const { error: err } = await supabase
      .from('list_options')
      .insert({ list_type: listType, name: name.trim(), sort_order: nextOrder, location: branchScoped ? activeLocation : null })
    setSaving(false)
    if (err) { setError(err.message); return }
    setName('')
    await load()
    onChange?.()
  }

  async function remove() {
    if (!deleteTarget) return
    await supabase.from('list_options').delete().eq('id', deleteTarget.id)
    setDeleteTarget(null)
    await load()
    onChange?.()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70]">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <form onSubmit={add} className="flex gap-2">
            <input
              type="text"
              placeholder="New entry…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              Add
            </button>
          </form>
          {error && <p className="text-red-500 text-xs">{error}</p>}

          <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            {loading ? (
              <li className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">Loading…</li>
            ) : options.length === 0 ? (
              <li className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">No entries yet.</li>
            ) : (
              options.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <span className="text-sm text-gray-700 dark:text-gray-200">{o.name}</span>
                  <button onClick={() => setDeleteTarget(o)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                </li>
              ))
            )}
          </ul>

          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Done</button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Remove entry?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              <span className="font-medium text-gray-700 dark:text-gray-200">{deleteTarget.name}</span> will be removed from the list. Existing records that already use it are not affected.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800">Cancel</button>
              <button onClick={remove} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
