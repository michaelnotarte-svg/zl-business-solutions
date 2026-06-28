create table inventory_adjustments (
  id           uuid primary key default uuid_generate_v4(),
  date         date not null,
  item_id      uuid not null references items (id),
  batch_number text,
  storage      text not null,
  boxes        numeric(10, 2),
  kilos        numeric(10, 3) not null,
  reason       text,
  created_at   timestamptz not null default now()
);
create index on inventory_adjustments (date);
create index on inventory_adjustments (item_id);
alter table inventory_adjustments enable row level security;
create policy "open_inventory_adjustments" on inventory_adjustments for all using (true) with check (true);
