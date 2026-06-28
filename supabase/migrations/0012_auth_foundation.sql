-- ============================================================
-- AUTH FOUNDATION: locations + profiles + auto-profile trigger
-- RLS stays OPEN for now — lockdown happens in a later migration
-- once login is verified working (per sequencing plan).
-- ============================================================

-- Branch locations
create table if not exists locations (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  created_at timestamptz not null default now()
);
alter table locations enable row level security;
create policy "open_locations" on locations for all using (true) with check (true);

insert into locations (name) values ('Iloilo'), ('Bacolod') on conflict do nothing;

-- User profiles (1:1 with auth.users)
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  username   text unique,
  email      text,
  location   text,                       -- matches locations.name
  tags       text[] not null default '{}',  -- e.g. {Stocks,Sales,Expense} — gates WRITES later
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "open_profiles" on profiles for all using (true) with check (true);

-- Auto-create a profile whenever a new auth user is created.
-- Owner's email is bootstrapped as admin automatically.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email = 'michaelnotarte@gmail.com'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for any auth users created before this migration
insert into public.profiles (id, email, name, is_admin)
select id, email, split_part(email, '@', 1), email = 'michaelnotarte@gmail.com'
from auth.users
on conflict (id) do nothing;

-- Ensure owner is admin even if profile already existed
update public.profiles set is_admin = true where email = 'michaelnotarte@gmail.com';
