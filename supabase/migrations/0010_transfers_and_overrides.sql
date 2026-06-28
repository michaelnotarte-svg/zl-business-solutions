-- Transfers: the "from" warehouse on a delivery (destination stays in `storage`)
alter table purchase_orders add column if not exists from_storage text;

-- Ensure a "Transfer" delivery category exists
insert into list_options (list_type, name) values ('delivery_category', 'Transfer') on conflict do nothing;

-- Oversell override approval log
create table oversell_overrides (
  id              uuid primary key default uuid_generate_v4(),
  date            date not null default current_date,
  invoice_id      uuid references invoices (id) on delete set null,
  invoice_number  text,
  item_id         uuid references items (id),
  item_name       text,
  storage         text,
  requested_kilos numeric(10, 3),
  available_kilos numeric(10, 3),
  requested_boxes numeric(10, 2),
  available_boxes numeric(10, 2),
  status          text not null default 'pending',
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
alter table oversell_overrides enable row level security;
create policy "open_oversell_overrides" on oversell_overrides for all using (true) with check (true);
