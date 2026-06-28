create table expense_categories (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

alter table expense_categories enable row level security;
create policy "open_expense_categories" on expense_categories for all using (true) with check (true);

insert into expense_categories (name) values
  ('Trucking'),
  ('Labor'),
  ('Utilities'),
  ('Supplies'),
  ('Repairs & Maintenance'),
  ('Food & Meals'),
  ('Communication'),
  ('Government Fees'),
  ('Miscellaneous');
