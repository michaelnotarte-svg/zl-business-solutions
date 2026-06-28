-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- CUSTOMERS
-- ============================================================
create table customers (
  id            uuid primary key default uuid_generate_v4(),
  business_name text,
  owner_name    text,
  address       text,
  contact       text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index on customers (business_name);

alter table customers enable row level security;
create policy "open_customers" on customers for all using (true) with check (true);

-- ============================================================
-- ITEMS
-- ============================================================
create table items (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  category   text,
  unit       text not null default 'box',
  created_at timestamptz not null default now()
);

alter table items enable row level security;
create policy "open_items" on items for all using (true) with check (true);

-- ============================================================
-- PURCHASE ORDERS
-- ============================================================
create table purchase_orders (
  id         uuid primary key default uuid_generate_v4(),
  po_number  text unique not null,
  date       date not null,
  source     text,
  supplier   text,
  created_at timestamptz not null default now()
);

create index on purchase_orders (date);

alter table purchase_orders enable row level security;
create policy "open_purchase_orders" on purchase_orders for all using (true) with check (true);

-- ============================================================
-- STOCK ENTRIES
-- ============================================================
create type storage_location as enum ('Everest', 'FishingPort');

create table stock_entries (
  id           uuid primary key default uuid_generate_v4(),
  po_id        uuid not null references purchase_orders (id) on delete cascade,
  item_id      uuid not null references items (id),
  storage      storage_location not null,
  batch_number text not null,
  boxes        numeric(10, 2),
  kilos        numeric(10, 3),
  date         date not null,
  created_at   timestamptz not null default now()
);

create index on stock_entries (date);
create index on stock_entries (item_id);
create index on stock_entries (batch_number);
create index on stock_entries (po_id);

alter table stock_entries enable row level security;
create policy "open_stock_entries" on stock_entries for all using (true) with check (true);

-- ============================================================
-- INVOICES
-- ============================================================
create type sale_type as enum ('Walk-in', 'Delivery', 'Out-of-Town');
create type invoice_status as enum ('Paid', 'Unpaid', 'Partial');

create table invoices (
  id             uuid primary key default uuid_generate_v4(),
  invoice_number text unique not null,
  customer_id    uuid references customers (id),
  date           date not null,
  sale_type      sale_type not null,
  status         invoice_status not null default 'Unpaid',
  created_at     timestamptz not null default now()
);

create index on invoices (date);
create index on invoices (invoice_number);
create index on invoices (customer_id);

alter table invoices enable row level security;
create policy "open_invoices" on invoices for all using (true) with check (true);

-- ============================================================
-- INVOICE LINES
-- ============================================================
create table invoice_lines (
  id           uuid primary key default uuid_generate_v4(),
  invoice_id   uuid not null references invoices (id) on delete cascade,
  item_id      uuid not null references items (id),
  storage      storage_location not null,
  batch_number text not null,
  unit_price   numeric(10, 4) not null,
  boxes        numeric(10, 2),
  kilos        numeric(10, 3) not null,
  amount       numeric(12, 4) generated always as (unit_price * kilos) stored,
  created_at   timestamptz not null default now()
);

create index on invoice_lines (invoice_id);
create index on invoice_lines (item_id);
create index on invoice_lines (batch_number);

alter table invoice_lines enable row level security;
create policy "open_invoice_lines" on invoice_lines for all using (true) with check (true);

-- ============================================================
-- EXPENSES
-- ============================================================
create table expenses (
  id          uuid primary key default uuid_generate_v4(),
  date        date not null,
  description text not null,
  amount      numeric(12, 2) not null,
  week_ending date,
  day_of_week text,
  category    text,
  created_at  timestamptz not null default now()
);

create index on expenses (date);

alter table expenses enable row level security;
create policy "open_expenses" on expenses for all using (true) with check (true);

-- ============================================================
-- PARTIAL PAYMENTS
-- ============================================================
create type payment_mode as enum (
  'Cash', 'A.R.', 'Check', 'Bank Transfer', 'Bank Deposit', 'GCash'
);

create table partial_payments (
  id                uuid primary key default uuid_generate_v4(),
  invoice_id        uuid not null references invoices (id) on delete cascade,
  amount_paid       numeric(12, 2) not null,
  date_paid         date not null,
  mode_of_payment   payment_mode not null,
  deposit_date      date,
  remaining_balance numeric(12, 2),
  created_at        timestamptz not null default now()
);

create index on partial_payments (invoice_id);
create index on partial_payments (date_paid);

alter table partial_payments enable row level security;
create policy "open_partial_payments" on partial_payments for all using (true) with check (true);

-- ============================================================
-- DEPOSIT SLIPS
-- ============================================================
create table deposit_slips (
  id        uuid primary key default uuid_generate_v4(),
  date      date not null,
  amount    numeric(12, 2) not null,
  bank      text,
  reference text,
  created_at timestamptz not null default now()
);

create index on deposit_slips (date);

alter table deposit_slips enable row level security;
create policy "open_deposit_slips" on deposit_slips for all using (true) with check (true);
