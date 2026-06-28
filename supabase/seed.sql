-- ============================================================
-- ZL Business Solutions — DEMO SEED (portfolio data, Iloilo branch)
-- Safe to run once against a FRESH database (after all migrations).
-- Generates realistic meat/seafood distribution data:
--   ~20 items, ~15 customers, stock deliveries, ~120 invoices with
--   per-batch FIFO allocations, partial payments, and weekly expenses.
--
-- Audit triggers are disabled during the load so the Audit log starts
-- clean (only real user actions appear). They are re-enabled at the end.
--
-- NOTE: the entire data load runs inside ONE DO block. The Supabase SQL
-- Editor uses a pooled connection, so a TEMP table would not reliably
-- survive across separate statements — keeping it inside a single block
-- guarantees it lives on one connection for the whole load.
-- ============================================================

-- ── 1. Silence audit triggers during the bulk load ─────────────
do $$
declare t text;
  tables text[] := array['customers','items','purchase_orders','stock_entries',
    'invoices','invoice_lines','partial_payments','inventory_adjustments',
    'expenses','oversell_overrides'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I disable trigger z_audit', t);
  end loop;
end $$;

-- ── 2. Items, customers, stock, invoices, payments, expenses ───
do $$
declare
  v_start date := date '2026-03-01';
  v_today date := date '2026-06-28';
  v_iid uuid; v_cat text; v_st text; v_po_id uuid; v_date date;
  v_boxes numeric; v_kgbox numeric; v_kilos numeric; v_batch text; v_seq int := 0;
  v_inv_id uuid; v_line_id uuid; v_price numeric;
  v_sale text; v_status text; v_pm text;
  v_sell numeric; v_sellboxes numeric; v_total numeric; v_first_st text;
  v_paid numeric; v_r numeric; v_b record;
  v_d date; v_cidx int; v_amt numeric; v_ed date;
  d int; li int; nlines int; n int; w int; e int; nexp int;
  v_item_ids uuid[]; v_cust_ids uuid[];
  v_suppliers  text[] := array['Monterey','Pacific Meat Traders','Visayan Cold Storage','Fishport Direct','CDO Foodsphere'];
  v_sources    text[] := array['Manila','Cebu','Local','Bacolod'];
  v_sale_types text[] := array['Walk-in','Walk-in','Walk-in','Delivery','Delivery','Out-of-Town'];
  v_modes      text[] := array['Cash','Check','Bank Transfer','GCash','Bank Deposit'];
  v_cats  text[] := array['Trucking','Labor','Utilities','Supplies','Repairs & Maintenance','Food & Meals','Communication','Government Fees','Miscellaneous'];
  v_descs text[] := array['Fuel & toll','Warehouse wages','Electric bill','Packaging & ice','Freezer repair','Staff meals','Load & internet','Permit renewal','Office supplies'];
begin
  -- Batch tracker (drives FIFO sale allocation); lives only inside this block.
  drop table if exists _batches;
  create temp table _batches (
    item_id uuid, storage text, batch_number text,
    kilos numeric, boxes numeric, date date
  );

  -- Items (name = "base - brand" when a brand exists)
  insert into items (name, base_name, brand, category, location) values
    ('Beef Brisket','Beef Brisket',null,'Beef','Iloilo'),
    ('Beef Short Plate - Aussie','Beef Short Plate','Aussie','Beef','Iloilo'),
    ('Beef Cubes','Beef Cubes',null,'Beef','Iloilo'),
    ('Beef Tapa','Beef Tapa',null,'Beef','Iloilo'),
    ('Pork Belly','Pork Belly',null,'Pork','Iloilo'),
    ('Pork Shoulder','Pork Shoulder',null,'Pork','Iloilo'),
    ('Pork Liempo','Pork Liempo',null,'Pork','Iloilo'),
    ('Pork Ribs','Pork Ribs',null,'Pork','Iloilo'),
    ('Chicken Leg Quarters - Bounty','Chicken Leg Quarters','Bounty','Chicken','Iloilo'),
    ('Chicken Wings - Bounty','Chicken Wings','Bounty','Chicken','Iloilo'),
    ('Chicken Breast - Magnolia','Chicken Breast','Magnolia','Chicken','Iloilo'),
    ('Whole Chicken - Bounty','Whole Chicken','Bounty','Chicken','Iloilo'),
    ('Bangus','Bangus',null,'Seafood','Iloilo'),
    ('Tilapia','Tilapia',null,'Seafood','Iloilo'),
    ('Galunggong','Galunggong',null,'Seafood','Iloilo'),
    ('Shrimp','Shrimp',null,'Seafood','Iloilo'),
    ('Squid','Squid',null,'Seafood','Iloilo'),
    ('Hotdog - Purefoods','Hotdog','Purefoods','Processed','Iloilo'),
    ('Tocino - CDO','Tocino','CDO','Processed','Iloilo'),
    ('Longganisa','Longganisa',null,'Processed','Iloilo');

  -- Customers
  insert into customers (business_name, display_name, owner_name, address, contact, type, location) values
    ('Aling Nena''s Carinderia','Aling Nena''s Carinderia','Nena Reyes','La Paz, Iloilo City','0917-555-0101','Customer','Iloilo'),
    ('JK Grocery','JK Grocery','Jun Katigbak','Jaro, Iloilo City','0917-555-0102','Customer','Iloilo'),
    ('Sea Breeze Restaurant','Sea Breeze Restaurant','Maria Lopez','Villa, Arevalo','0917-555-0103','Customer','Iloilo'),
    ('Golden Wok Eatery','Golden Wok Eatery','Chen Li','Iloilo City Proper','0917-555-0104','Customer','Iloilo'),
    ('Iloilo Fresh Mart','Iloilo Fresh Mart','Ramon Cruz','Mandurriao, Iloilo City','0917-555-0105','Customer','Iloilo'),
    ('Tatay Boy''s Lechon','Tatay Boy''s Lechon','Rodel Sanchez','Pavia, Iloilo','0917-555-0106','Customer','Iloilo'),
    ('Pavia Market Stall 12','Pavia Market Stall 12','Lita Gono','Pavia Public Market','0917-555-0107','Customer','Iloilo'),
    ('Molo Mansion Cafe','Molo Mansion Cafe','Anna Villar','Molo, Iloilo City','0917-555-0108','Customer','Iloilo'),
    ('La Paz Batchoy House','La Paz Batchoy House','Ted Aguirre','La Paz, Iloilo City','0917-555-0109','Customer','Iloilo'),
    ('Jaro Bakeshop & Deli','Jaro Bakeshop & Deli','Ising Defensor','Jaro, Iloilo City','0917-555-0110','Customer','Iloilo'),
    ('Oton Seafood Grill','Oton Seafood Grill','Bert Ong','Oton, Iloilo','0917-555-0111','Customer','Iloilo'),
    ('Metro Supermart','Metro Supermart','Procurement Dept','Mandurriao, Iloilo City','0917-555-0112','Customer','Iloilo'),
    ('Robinsons Place Deli','Robinsons Place Deli','Procurement Dept','Iloilo City Proper','0917-555-0113','Customer','Iloilo'),
    ('Guimaras Ferry Canteen','Guimaras Ferry Canteen','Joy Gabon','Jordan, Guimaras','0917-555-0114','Customer','Iloilo'),
    ('Miag-ao Resort Kitchen','Miag-ao Resort Kitchen','Carlo Tan','Miag-ao, Iloilo','0917-555-0115','Customer','Iloilo');

  select array_agg(id order by name) into v_item_ids from items where location = 'Iloilo';
  select array_agg(id) into v_cust_ids from customers where location = 'Iloilo';

  -- Stock deliveries: 16 early (days 0-18) + 4 restocks (days 40-80).
  for d in 1..20 loop
    if d <= 16 then
      v_date := v_start + (floor(random()*19))::int;
    else
      v_date := v_start + 40 + (floor(random()*40))::int;
    end if;

    insert into purchase_orders (po_number, date, source, supplier, category, storage, location)
    values ('PO-' || lpad(d::text, 4, '0'), v_date,
            v_sources[1 + floor(random()*array_length(v_sources,1))::int],
            v_suppliers[1 + floor(random()*array_length(v_suppliers,1))::int],
            'Stock', 'Everest', 'Iloilo')
    returning id into v_po_id;

    nlines := 5 + floor(random()*5)::int;
    for li in 1..nlines loop
      v_iid := v_item_ids[1 + floor(random()*array_length(v_item_ids,1))::int];
      select category into v_cat from items where id = v_iid;
      v_st := case when v_cat = 'Seafood' then 'FishingPort' else 'Everest' end;

      v_boxes := 25 + floor(random()*40)::int;
      v_kgbox := round((18 + random()*6)::numeric, 1);
      v_kilos := round(v_boxes * v_kgbox, 3);
      v_seq   := v_seq + 1;
      v_batch := 'B' || to_char(v_date,'YYMMDD') || '-' || lpad(v_seq::text, 3, '0');

      insert into stock_entries (po_id, item_id, storage, batch_number, boxes, kilos, date)
      values (v_po_id, v_iid, v_st, v_batch, v_boxes, v_kilos, v_date);

      insert into _batches (item_id, storage, batch_number, kilos, boxes, date)
      values (v_iid, v_st, v_batch, v_kilos, v_boxes, v_date);
    end loop;
  end loop;

  -- Invoices, lines, FIFO allocations, payments
  for n in 1..120 loop
    v_date := v_start + 21 + (floor(random()*(v_today - (v_start + 21))))::int;
    v_sale := v_sale_types[1 + floor(random()*array_length(v_sale_types,1))::int];

    insert into invoices (invoice_number, customer_id, date, sale_type, status, location)
    values ('INV-' || lpad(n::text, 4, '0'),
            v_cust_ids[1 + floor(random()*array_length(v_cust_ids,1))::int],
            v_date, v_sale::sale_type, 'Unpaid'::invoice_status, 'Iloilo')
    returning id into v_inv_id;

    v_total := 0; v_first_st := null;
    nlines := 1 + floor(random()*3)::int;
    for li in 1..nlines loop
      v_iid := v_item_ids[1 + floor(random()*array_length(v_item_ids,1))::int];

      select item_id, storage, batch_number, kilos, boxes, ctid
        into v_b
        from _batches
       where item_id = v_iid and kilos > 5
       order by date
       limit 1;
      continue when not found;

      select category into v_cat from items where id = v_iid;
      v_price := case v_cat
                   when 'Beef'    then 280 + floor(random()*140)
                   when 'Pork'    then 220 + floor(random()*100)
                   when 'Chicken' then 140 + floor(random()*60)
                   when 'Seafood' then 160 + floor(random()*140)
                   else                180 + floor(random()*80)
                 end;

      v_sell := least(v_b.kilos, 20 + floor(random()*60)::int);
      v_sellboxes := round(v_b.boxes * (v_sell / v_b.kilos), 2);
      if v_first_st is null then v_first_st := v_b.storage; end if;

      insert into invoice_lines (invoice_id, item_id, storage, batch_number, unit_price, boxes, kilos)
      values (v_inv_id, v_iid, v_b.storage, v_b.batch_number, v_price, v_sellboxes, v_sell)
      returning id into v_line_id;

      insert into invoice_line_allocations (line_id, invoice_id, item_id, storage, batch_number, boxes, kilos, date)
      values (v_line_id, v_inv_id, v_iid, v_b.storage, v_b.batch_number, v_sellboxes, v_sell, v_date);

      update _batches set kilos = kilos - v_sell, boxes = boxes - v_sellboxes
       where ctid = v_b.ctid;

      v_total := v_total + round(v_sell * v_price, 2);
    end loop;

    if v_total = 0 then continue; end if;

    v_r := random();
    if v_r < 0.55 then
      v_status := 'Paid';
      v_pm := case when v_sale = 'Walk-in' then 'Cash'
                   else v_modes[1 + floor(random()*array_length(v_modes,1))::int] end;
      if random() < 0.5 then
        insert into partial_payments (invoice_id, amount_paid, date_paid, mode_of_payment, remaining_balance, deposit_date)
        values (v_inv_id, v_total, least(v_date + (1+floor(random()*15))::int, v_today), v_pm, 0,
                case when v_pm in ('Bank Deposit','Bank Transfer') then least(v_date + (1+floor(random()*15))::int, v_today) end);
      end if;
    elsif v_r < 0.8 then
      v_status := 'Partial';
      v_pm := null;
      v_paid := round((v_total * (0.3 + random()*0.4))::numeric, 2);
      insert into partial_payments (invoice_id, amount_paid, date_paid, mode_of_payment, remaining_balance)
      values (v_inv_id, v_paid, least(v_date + (1+floor(random()*15))::int, v_today),
              v_modes[1 + floor(random()*array_length(v_modes,1))::int], round(v_total - v_paid, 2));
    else
      v_status := 'Unpaid';
      v_pm := null;
    end if;

    update invoices set status = v_status::invoice_status, payment_method = v_pm, storage = v_first_st
     where id = v_inv_id;
  end loop;

  -- Weekly expenses across categories
  for w in 0..16 loop
    v_d := v_start + w*7;
    exit when v_d > v_today;
    nexp := 3 + floor(random()*4)::int;
    for e in 1..nexp loop
      v_cidx := 1 + floor(random()*array_length(v_cats,1))::int;
      v_amt  := 500 + floor(random()*7500);
      v_ed   := least(v_d + (floor(random()*6))::int, v_today);
      insert into expenses (date, description, amount, category, week_ending, day_of_week, location)
      values (v_ed, v_descs[v_cidx], v_amt, v_cats[v_cidx], v_d + 6, trim(to_char(v_ed,'Day')), 'Iloilo');
    end loop;
  end loop;

  drop table if exists _batches;
end $$;

-- ── 3. Re-enable audit triggers ────────────────────────────────
do $$
declare t text;
  tables text[] := array['customers','items','purchase_orders','stock_entries',
    'invoices','invoice_lines','partial_payments','inventory_adjustments',
    'expenses','oversell_overrides'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable trigger z_audit', t);
  end loop;
end $$;

-- ── Summary ────────────────────────────────────────────────────
select 'items' t, count(*) from items
union all select 'customers', count(*) from customers
union all select 'purchase_orders', count(*) from purchase_orders
union all select 'stock_entries', count(*) from stock_entries
union all select 'invoices', count(*) from invoices
union all select 'invoice_lines', count(*) from invoice_lines
union all select 'invoice_line_allocations', count(*) from invoice_line_allocations
union all select 'partial_payments', count(*) from partial_payments
union all select 'expenses', count(*) from expenses
order by 1;
