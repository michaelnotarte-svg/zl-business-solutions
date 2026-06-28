import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCompanyName, POWERED_BY } from '../lib/settings'

// Public portfolio demo account (read the README for details).
const DEMO_EMAIL = 'demo@zlbs.app'
const DEMO_PASSWORD = 'ZLdemo2026!'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function fillDemo() {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setError('')
  }

  async function handleLogin(e) {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Email and password are required.'); return }
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message)
    }
    // On success, onAuthStateChange in AuthProvider takes over — no redirect needed.
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{getCompanyName()}</h1>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{POWERED_BY}</p>
        </div>

        <form onSubmit={handleLogin} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm px-6 py-6 space-y-4">
          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
            <button
              type="button"
              onClick={fillDemo}
              className="w-full text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              Use demo account
            </button>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center mt-1">
              Portfolio demo · {DEMO_EMAIL} / {DEMO_PASSWORD}
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
