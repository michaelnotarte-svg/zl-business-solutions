-- ============================================================
-- UNPAID SUMMARY RPC
-- Always-accurate receivables for one branch, independent of the
-- Invoices page's 30-day load window. Excludes BN (owner's draw),
-- ignores soft-deleted rows, and uses a 1-cent threshold.
-- ============================================================

create or replace function public.unpaid_summary(p_location text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (public.is_admin() or public.my_location() = p_location) then
    raise exception 'not allowed';
  end if;

  with inv as (
    select
      i.id,
      coalesce(sum(l.amount), 0) as total,
      coalesce((select sum(p.amount_paid) from partial_payments p
                where p.invoice_id = i.id and p.deleted_at is null), 0) as paid
    from invoices i
    left join invoice_lines l on l.invoice_id = i.id and l.deleted_at is null
    left join customers c on c.id = i.customer_id
    where i.location = p_location
      and i.deleted_at is null
      and coalesce(c.type, '') <> 'BN'
    group by i.id
  )
  select jsonb_build_object(
    'count',  count(*) filter (where total - paid > 0.01),
    'amount', coalesce(sum(total - paid) filter (where total - paid > 0.01), 0)
  ) into result
  from inv;

  return result;
end $$;

grant execute on function public.unpaid_summary(text) to authenticated;
