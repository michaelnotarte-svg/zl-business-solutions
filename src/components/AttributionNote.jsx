import { useAuth } from '../lib/auth'

const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : null)

// Small "Added by … / Edited by …" note for detail views (lower-right).
// Expects a record carrying created_by/created_at/updated_by/updated_at.
export default function AttributionNote({ record, className = '' }) {
  const { profileName } = useAuth()
  if (!record) return null
  const added = record.created_by || record.created_at
  const edited = record.updated_at && record.updated_at !== record.created_at
  if (!added && !edited) return null
  return (
    <div className={`text-right text-[11px] leading-relaxed text-gray-400 dark:text-gray-500 ${className}`}>
      {added && <div>Added by {profileName(record.created_by)}{record.created_at ? ` · ${fmt(record.created_at)}` : ''}</div>}
      {edited && <div>Edited by {profileName(record.updated_by)} · {fmt(record.updated_at)}</div>}
    </div>
  )
}
