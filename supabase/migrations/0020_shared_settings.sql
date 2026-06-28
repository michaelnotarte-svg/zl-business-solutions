-- ============================================================
-- SHARED SETTINGS
-- Moves the previously per-device (localStorage) settings that
-- SHOULD agree across devices — stock thresholds (per branch),
-- business info (per branch), and currency (global) — into a
-- table. Theme stays per-device (personal preference).
--
-- The frontend keeps its synchronous getters: it hydrates the
-- localStorage cache from here at login, and writes back here
-- (admin only) when a setting is saved.
-- ============================================================

create table if not exists app_settings (
  scope       text not null,            -- branch/location name, or 'global'
  key         text not null,            -- 'thresholds' | 'business' | 'currency'
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (scope, key)
);

alter table app_settings enable row level security;

drop policy if exists "app_settings_select" on app_settings;
create policy "app_settings_select" on app_settings for select
  using (auth.role() = 'authenticated');

-- Shared settings are admin-managed (one change affects everyone).
drop policy if exists "app_settings_modify" on app_settings;
create policy "app_settings_modify" on app_settings for all
  using (public.is_admin()) with check (public.is_admin());
