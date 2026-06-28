-- Warehouse promoted to the invoice (parent) level
alter table invoices add column if not exists storage text;

-- FIFO batch allocations per sales line (for accurate batch inventory + COGS)
create table invoice_line_allocations (
  id           uuid primary key default uuid_generate_v4(),
  line_id      uuid not null references invoice_lines (id) on delete cascade,
  invoice_id   uuid references invoices (id) on delete cascade,
  item_id      uuid references items (id),
  storage      text,
  batch_number text,
  boxes        numeric(10, 2),
  kilos        numeric(10, 3),
  date         date,
  created_at   timestamptz not null default now()
);
create index on invoice_line_allocations (item_id);
create index on invoice_line_allocations (line_id);
create index on invoice_line_allocations (date);
alter table invoice_line_allocations enable row level security;
create policy "open_invoice_line_allocations" on invoice_line_allocations for all using (true) with check (true);
