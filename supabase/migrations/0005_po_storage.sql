-- Storage now lives at the delivery (parent) level.
-- Child stock_entries keep their own storage (defaults to parent, overridable).
alter table purchase_orders add column if not exists storage storage_location;
