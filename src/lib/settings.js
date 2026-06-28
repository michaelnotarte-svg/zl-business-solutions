// App settings. Theme is per-device; currency, business info and stock
// thresholds are SHARED via the app_settings table (migration 0020) and
// mirrored into localStorage so the getters below stay synchronous.

import { supabase } from './supabase'

const THEME_KEY = 'pos.theme'
const CURRENCY_KEY = 'pos.currency'
const BUSINESS_KEY = 'pos.business'
const BRANDING_KEY = 'pos.branding'   // global: company name, logo, colors (logo/colors added later)
const ADMIN_KEY = 'pos.admin'
const THRESH_KEY = 'pos.box_thresholds' // box-based (old 'pos.thresholds' held kg values)

export const APP_VERSION = '0.2.0'

// Default app title until an admin sets the company name, and the fixed credit.
export const DEFAULT_COMPANY = 'ZL Business Solutions'
export const POWERED_BY = 'Powered by ZL Solutions'

export const CURRENCY_OPTIONS = [
  { symbol: '₱', label: '₱  Philippine Peso (PHP)' },
  { symbol: '$', label: '$  US Dollar (USD)' },
  { symbol: '€', label: '€  Euro (EUR)' },
  { symbol: '£', label: '£  British Pound (GBP)' },
  { symbol: '¥', label: '¥  Japanese Yen (JPY)' },
]

// ── Theme ────────────────────────────────────────────────
export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light'
}

export function applyTheme(theme) {
  const t = theme || getTheme()
  document.documentElement.classList.toggle('dark', t === 'dark')
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

// ── Shared settings (Supabase app_settings) ──────────────
// Fire-and-forget upsert; non-admins fail RLS silently and keep a local copy.
function pushSetting(scope, key, value) {
  supabase.from('app_settings')
    .upsert({ scope: scope || 'global', key, value }, { onConflict: 'scope,key' })
    .then(() => {}, () => {})
}

// Hydrate the localStorage cache from the shared table (called once at login).
export async function loadSharedSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('scope, key, value')
    if (error || !data) return
    for (const r of data) {
      if (r.key === 'currency') localStorage.setItem(CURRENCY_KEY, r.value)
      else if (r.key === 'thresholds') localStorage.setItem(`${THRESH_KEY}.${r.scope}`, JSON.stringify(r.value))
      else if (r.key === 'business') localStorage.setItem(`${BUSINESS_KEY}.${r.scope}`, JSON.stringify(r.value))
      else if (r.key === 'branding') localStorage.setItem(BRANDING_KEY, JSON.stringify(r.value))
    }
  } catch { /* offline / table missing → fall back to local cache */ }
}

// ── Currency ─────────────────────────────────────────────
export function getCurrency() {
  return localStorage.getItem(CURRENCY_KEY) || '₱'
}

export function setCurrency(symbol) {
  localStorage.setItem(CURRENCY_KEY, symbol)
  pushSetting('global', 'currency', symbol)
}

// Formats a number as currency using the active symbol (2 decimals).
export function money(n) {
  const sym = getCurrency()
  const amount = Number(n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${sym}${amount}`
}

// ── Business info (per branch) ───────────────────────────
const bizKey = (loc) => (loc ? `${BUSINESS_KEY}.${loc}` : BUSINESS_KEY)

export function getBusiness(location) {
  try {
    return (
      JSON.parse(localStorage.getItem(bizKey(location))) ||
      JSON.parse(localStorage.getItem(BUSINESS_KEY)) || // legacy/global fallback
      {}
    )
  } catch {
    return {}
  }
}

export function setBusiness(obj, location) {
  localStorage.setItem(bizKey(location), JSON.stringify(obj))
  pushSetting(location, 'business', obj)
}

// ── Branding (global: company name, logo, colors) ────────
// One identity per deployment, shown as the app title in the sidebar/login.
// Logo + colors will be added to this same object in a later pass.
export function getBranding() {
  try {
    return JSON.parse(localStorage.getItem(BRANDING_KEY)) || {}
  } catch {
    return {}
  }
}

export function setBranding(obj) {
  localStorage.setItem(BRANDING_KEY, JSON.stringify(obj))
  pushSetting('global', 'branding', obj)
}

// App title: the configured company name, or the default until one is set.
export function getCompanyName() {
  const name = getBranding().companyName
  return name && name.trim() ? name.trim() : DEFAULT_COMPANY
}

// ── Admin mode (placeholder for real role-based auth) ────
export function getAdminMode() {
  return localStorage.getItem(ADMIN_KEY) === '1'
}

export function setAdminMode(on) {
  localStorage.setItem(ADMIN_KEY, on ? '1' : '0')
}

// ── Inventory stock-level thresholds (item-level total #boxes, per branch) ──
const threshKey = (loc) => (loc ? `${THRESH_KEY}.${loc}` : THRESH_KEY)
const DEFAULT_THRESH = { critical: 10, low: 50 }

export function getThresholds(location) {
  try {
    return (
      JSON.parse(localStorage.getItem(threshKey(location))) ||
      JSON.parse(localStorage.getItem(THRESH_KEY)) || // global fallback
      DEFAULT_THRESH
    )
  } catch {
    return DEFAULT_THRESH
  }
}

export function setThresholds(obj, location) {
  localStorage.setItem(threshKey(location), JSON.stringify(obj))
  pushSetting(location, 'thresholds', obj)
}

// Returns 'Critical' | 'Low' | 'Sufficient' for a given #boxes value.
export function stockStatus(boxes, t) {
  const th = t || getThresholds()
  if (boxes <= th.critical) return 'Critical'
  if (boxes <= th.low) return 'Low'
  return 'Sufficient'
}
