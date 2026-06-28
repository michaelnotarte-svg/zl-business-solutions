import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const ALL_TAGS = ['Stocks', 'Sales', 'Expense', 'Inventory', 'Audit']

export default function UsersAdmin() {
  const { profile: me } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [savedId, setSavedId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: profs }, { data: locs }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('locations').select('name').order('name'),
    ])
    setProfiles(profs ?? [])
    setLocations((locs ?? []).map((l) => l.name))
    setLoading(false)
  }

  function update(id, field, value) {
    setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  function toggleTag(id, tag) {
    setProfiles((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p
        const tags = p.tags?.includes(tag)
          ? p.tags.filter((t) => t !== tag)
          : [...(p.tags ?? []), tag]
        return { ...p, tags }
      })
    )
  }

  async function save(p) {
    setSavingId(p.id)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({
        name: p.name?.trim() || null,
        // Admins span all branches — no fixed location
        location: p.is_admin ? null : (p.location || null),
        tags: p.tags ?? [],
        is_admin: p.is_admin,
      })
      .eq('id', p.id)
    setSavingId(null)
    if (err) { setError(err.message); return }
    setSavedId(p.id)
    setTimeout(() => setSavedId(null), 2000)
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Users</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">
        Assign each user a branch and edit-tags. Reads will be scoped to their branch; tags control which modules they can edit (enforced once RLS lockdown ships).
      </p>

      <div className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-4 py-3 mb-5">
        <p className="text-xs text-blue-800 dark:text-blue-300">
          <span className="font-semibold">Adding a new user:</span> create the account in the Supabase Dashboard → Authentication → Users → "Add user" (tick <span className="font-semibold">Auto Confirm</span>). Their profile appears here automatically — then assign their branch and tags below.
        </p>
      </div>

      {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No users yet.</p>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Name + email */}
                <div className="min-w-44 flex-1">
                  <input
                    type="text"
                    value={p.name ?? ''}
                    onChange={(e) => update(p.id, 'name', e.target.value)}
                    placeholder="Name"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{p.email}{p.id === me?.id ? ' · you' : ''}</p>
                </div>

                {/* Location — admins span all branches */}
                <div>
                  {p.is_admin ? (
                    <span className="inline-block text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg px-2.5 py-1.5">All branches</span>
                  ) : (
                    <select
                      value={p.location ?? ''}
                      onChange={(e) => update(p.id, 'location', e.target.value)}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Branch —</option>
                      {locations.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  )}
                </div>

                {/* Tags */}
                <div className="flex items-center gap-2.5">
                  {ALL_TAGS.map((t) => (
                    <label key={t} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={p.tags?.includes(t) ?? false}
                        onChange={() => toggleTag(p.id, t)}
                        className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      {t}
                    </label>
                  ))}
                </div>

                {/* Admin */}
                <label className={`flex items-center gap-1 text-xs cursor-pointer select-none ${p.id === me?.id ? 'opacity-50 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300'}`}>
                  <input
                    type="checkbox"
                    checked={p.is_admin}
                    disabled={p.id === me?.id}
                    onChange={(e) => update(p.id, 'is_admin', e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500"
                  />
                  <span className={p.is_admin ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>Admin</span>
                </label>

                {/* Save */}
                <button
                  onClick={() => save(p)}
                  disabled={savingId === p.id}
                  className="ml-auto text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg"
                >
                  {savingId === p.id ? 'Saving…' : savedId === p.id ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
