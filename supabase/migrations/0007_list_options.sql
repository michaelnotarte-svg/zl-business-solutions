-- Generic editable lists (storage, payment methods, item categories, …)
create table if not exists list_options (
  id         uuid primary key default uuid_generate_v4(),
  list_type  text not null,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (list_type, name)
);
alter table list_options enable row level security;
create policy "open_list_options" on list_options for all using (true) with check (true);

insert into list_options (list_type, name, sort_order) values
  ('storage','Everest',1),('storage','FishingPort',2)
on conflict do nothing;

insert into list_options (list_type, name, sort_order) values
  ('payment_method','Cash',1),('payment_method','A.R.',2),('payment_method','Check',3),
  ('payment_method','Bank Transfer',4),('payment_method','Bank Deposit',5),('payment_method','GCash',6)
on conflict do nothing;

insert into list_options (list_type, name)
  select distinct 'item_category', category from items where category is not null
on conflict do nothing;

-- Make enum-backed columns user-extensible
alter table stock_entries     alter column storage type text;
alter table purchase_orders   alter column storage type text;
alter table invoice_lines     alter column storage type text;
alter table inventory_archive alter column storage type text;
alter table partial_payments  alter column mode_of_payment type text;
