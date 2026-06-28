import { supabase } from './supabase'

// Returns an array of option names for a given list_type.
// Falls back to `fallback` if the table is empty (e.g. before the migration runs).
// When `location` is given, returns shared entries (location null) plus that
// branch's own entries — used for 'storage' so each branch sees its warehouses.
export async function fetchListNames(listType, fallback = [], location = null) {
  let q = supabase
    .from('list_options')
    .select('name, location')
    .eq('list_type', listType)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  const { data } = await q
  let rows = data ?? []
  if (location) rows = rows.filter((r) => !r.location || r.location === location)
  const names = rows.map((r) => r.name)
  return names.length ? names : fallback
}

export const STORAGE_FALLBACK = ['Everest', 'FishingPort']
export const PAYMENT_FALLBACK = ['Cash', 'A.R.', 'Check', 'Bank Transfer', 'Bank Deposit', 'GCash']
