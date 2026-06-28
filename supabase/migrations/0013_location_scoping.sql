-- ============================================================
-- PHASE 2: location scoping — location column on core tables.
-- All existing data belongs to Iloilo. Bacolod starts empty.
-- Child tables (invoice_lines, stock_entries, partial_payments,
-- invoice_line_allocations) inherit location via their parent.
-- ============================================================

alter table items                 add column if not exists location text;
alter table customers             add column if not exists location text;
alter table purchase_orders       add column if not exists location text;
alter table invoices              add column if not exists location text;
alter table expenses              add column if not exists location text;
alter table inventory_archive     add column if not exists location text;
alter table inventory_adjustments add column if not exists location text;
alter table oversell_overrides    add column if not exists location text;

-- Stamp all existing rows as Iloilo
update items                 set location = 'Iloilo' where location is null;
update customers             set location = 'Iloilo' where location is null;
update purchase_orders       set location = 'Iloilo' where location is null;
update invoices              set location = 'Iloilo' where location is null;
update expenses              set location = 'Iloilo' where location is null;
update inventory_archive     set location = 'Iloilo' where location is null;
update inventory_adjustments set location = 'Iloilo' where location is null;
update oversell_overrides    set location = 'Iloilo' where location is null;

create index if not exists items_location_idx            on items (location);
create index if not exists customers_location_idx        on customers (location);
create index if not exists purchase_orders_location_idx  on purchase_orders (location);
create index if not exists invoices_location_idx         on invoices (location);
create index if not exists expenses_location_idx         on expenses (location);

-- Managed lists: null location = shared across branches;
-- storage (warehouses) entries belong to a specific branch.
alter table list_options add column if not exists location text;
update list_options set location = 'Iloilo' where list_type = 'storage' and location is null;
