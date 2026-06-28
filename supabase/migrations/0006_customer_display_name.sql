-- Display name shown throughout the app (falls back to business_name when empty)
alter table customers add column if not exists display_name text;
