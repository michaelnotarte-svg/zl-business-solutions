-- Clean version — manual snapshot table, no triggers
drop trigger if exists trg_stock_entry_insert on stock_entries;
drop trigger if exists trg_stock_entry_update on stock_entries;
drop function if exists fn_stock_entry_insert();
drop function if exists fn_stock_entry_update();
drop table if exists inventory_archive;

create table inventory_archive (
  id            uuid primary key default uuid_generate_v4(),
  snapshot_date date not null,
  item_id       uuid not null references items (id),
  batch_number  text not null,
  storage       storage_location not null,
  boxes         numeric(10, 2),
  kilos         numeric(10, 3) not null,
  notes         text,
  created_at    timestamptz not null default now()
);

create index on inventory_archive (snapshot_date);
create index on inventory_archive (item_id);
create index on inventory_archive (batch_number);

alter table inventory_archive enable row level security;
create policy "open_inventory_archive" on inventory_archive for all using (true) with check (true);
