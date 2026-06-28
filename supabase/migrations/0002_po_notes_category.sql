alter table purchase_orders
  add column if not exists category text,
  add column if not exists notes    text;
