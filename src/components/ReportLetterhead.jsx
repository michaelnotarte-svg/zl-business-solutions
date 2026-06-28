import { getBusiness } from '../lib/settings'
import { useAuth } from '../lib/auth'

// Reusable letterhead for all printable reports:
//   business name + address + email/phone on the left, date on the upper-right.
export default function ReportLetterhead({ date, subtitle }) {
  const { activeLocation } = useAuth()
  const b = getBusiness(activeLocation)
  const phone = b.phone || b.contact
  const prettyDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
      })
    : ''

  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 leading-tight">
            {b.name || 'Business Name'}
          </h2>
          {b.address && <p className="text-sm text-gray-600 dark:text-gray-300">{b.address}</p>}
          {(b.email || phone) && (
            <p className="text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
              {b.email && <span>✉ {b.email}</span>}
              {phone && <span>✆ {phone}</span>}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {subtitle && <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{subtitle}</p>}
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{prettyDate}</p>
        </div>
      </div>
      <hr className="mt-3 border-gray-200 dark:border-gray-700" />
    </div>
  )
}
