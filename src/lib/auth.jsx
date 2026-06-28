import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadSharedSettings, getConfig } from './settings'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locations, setLocations] = useState([])
  const [names, setNames] = useState({}) // user id -> display name
  const [multiBranch, setMultiBranch] = useState(false)
  const [activeLocation, setActiveLocationState] = useState(localStorage.getItem('pos.activeLocation') || 'Iloilo')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    let active = true
    Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('locations').select('name').order('name'),
      supabase.rpc('profile_names'),
      loadSharedSettings(), // hydrate shared settings into the localStorage cache
    ]).then(([{ data: prof }, { data: locs }, { data: nm }]) => {
      if (!active) return
      const locNames = (locs ?? []).map((l) => l.name)
      setProfile(prof ?? null)
      setLocations(locNames)
      setNames(Object.fromEntries((nm ?? []).map((u) => [u.id, u.name])))

      // Branch mode (config hydrated by loadSharedSettings above).
      const cfg = getConfig()
      const multi = cfg.multiBranch === true
      setMultiBranch(multi)
      if (!multi) {
        // Single-branch: everyone is pinned to the one branch.
        setActiveLocationState(cfg.defaultLocation || prof?.location || locNames[0] || 'Main')
      } else if (prof && !prof.is_admin && prof.location) {
        // Multi-branch: staff are locked to their assigned branch; admin keeps last choice.
        setActiveLocationState(prof.location)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [session?.user?.id])

  function setActiveLocation(loc) {
    // Only admins may switch branches, and only when multi-branch is enabled.
    if (!multiBranch || !profile?.is_admin) return
    localStorage.setItem('pos.activeLocation', loc)
    setActiveLocationState(loc)
  }

  const value = {
    session,
    profile,
    loading,
    isAdmin: !!profile?.is_admin,
    location: profile?.location ?? null,
    tags: profile?.tags ?? [],
    // Audit/recycle-bin access: admin, or holds the 'Audit' tag
    canAudit: !!profile?.is_admin || (profile?.tags ?? []).includes('Audit'),
    // Resolve a user id → display name (loaded once via profile_names RPC)
    profileName: (id) => (id ? (names[id] ?? '—') : '—'),
    // Can the current user write to a module? Admin always; else must hold the tag.
    // Pass one tag or an array (any-match).
    canWrite: (mods) => {
      if (profile?.is_admin) return true
      const have = profile?.tags ?? []
      const need = Array.isArray(mods) ? mods : [mods]
      return need.some((m) => have.includes(m))
    },
    locations,
    multiBranch,
    activeLocation,
    setActiveLocation,
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
