-- ============================================================
-- EXECUTIVE SUMMARY RPC
-- Server-side aggregation for the admin dashboard. The Iloilo
-- backfill pushed invoice counts to ~25k; pulling every row to
-- the browser to aggregate was too slow. This returns only the
-- pre-aggregated figures the dashboard needs.
-- ============================================================

create or replace function exec_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not is_admin() then
    raise exception 'exec_summary is admin only';
  end if;

  with inv as (
    select
      i.id,
      i.location,
      date_trunc('month', i.date)::date as mth,
      coalesce(sum(l.amount), 0) as total,
      coalesce((select sum(p.amount_paid) from partial_payments p where p.invoice_id = i.id), 0) as paid,
      c.type as ctype,
      coalesce(nullif(c.display_name, ''), nullif(c.business_name, ''), 'Walk-in') as cname
    from invoices i
    left join invoice_lines l on l.invoice_id = i.id
    left join customers c on c.id = i.customer_id
    group by i.id, i.location, date_trunc('month', i.date), c.type, c.display_name, c.business_name
  )
  select jsonb_build_object(
    'sales_by_loc_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'location', location, 'month', to_char(mth, 'YYYY-MM'), 'total', t)), '[]'::jsonb)
      from (select location, mth, sum(total) t from inv group by location, mth) s
    ),
    'expenses_by_loc_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'location', location, 'month', to_char(m, 'YYYY-MM'), 'total', amt)), '[]'::jsonb)
      from (select location, date_trunc('month', date)::date m, sum(amount) amt
            from expenses group by location, date_trunc('month', date)) e
    ),
    'stock_by_loc_month', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'location', location, 'month', to_char(m, 'YYYY-MM'),
        'transfer', is_transfer, 'kilos', kl)), '[]'::jsonb)
      from (
        select po.location, date_trunc('month', po.date)::date m,
               (po.from_storage is not null) as is_transfer, sum(se.kilos) kl
        from purchase_orders po
        join stock_entries se on se.po_id = po.id
        group by po.location, date_trunc('month', po.date), (po.from_storage is not null)
      ) st
    ),
    'unpaid', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'location', location, 'count', cnt, 'amount', amt)), '[]'::jsonb)
      from (
        select location, count(*) cnt, sum(total - paid) amt
        from inv
        where coalesce(ctype, '') <> 'BN' and (total - paid) > 0.01
        group by location
      ) u
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object('name', cname, 'amount', amt)), '[]'::jsonb)
      from (select cname, sum(total) amt from inv group by cname order by sum(total) desc limit 5) tc
    ),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amt, 'kilos', kl)), '[]'::jsonb)
      from (
        select it.name, sum(l.amount) amt, sum(l.kilos) kl
        from invoice_lines l join items it on it.id = l.item_id
        group by it.name order by sum(l.amount) desc limit 5
      ) ti
    )
  ) into result;

  return result;
end;
$$;

grant execute on function exec_summary() to authenticated;
