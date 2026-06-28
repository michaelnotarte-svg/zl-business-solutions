import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// PostgREST caps a single response at 1000 rows. For tables that exceed that
// (invoices, allocations, …) page through with .range() and concatenate.
// `build` must return a *fresh* query builder each call so filters reapply.
export async function selectAll(build, pageSize = 1000) {
  let from = 0
  const all = []
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}
