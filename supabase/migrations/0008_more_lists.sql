-- New managed lists, seeded from existing data
insert into list_options (list_type, name)
  select distinct 'supplier', supplier from purchase_orders where supplier is not null on conflict do nothing;
insert into list_options (list_type, name)
  select distinct 'source', source from purchase_orders where source is not null on conflict do nothing;
insert into list_options (list_type, name)
  select distinct 'delivery_category', category from purchase_orders where category is not null on conflict do nothing;
insert into list_options (list_type, name)
  select distinct 'item_base', base_name from items where base_name is not null on conflict do nothing;
insert into list_options (list_type, name)
  select distinct 'brand', brand from items where brand is not null on conflict do nothing;

-- Payment method captured on the invoice when marked Paid
alter table invoices add column if not exists payment_method text;
