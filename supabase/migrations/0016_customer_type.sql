-- Customer type: 'Customer' (regular, priced) or 'BN' (owner's draw / internal, price optional)
alter table customers add column if not exists type text not null default 'Customer';
update customers set type = 'Customer' where type is null;
