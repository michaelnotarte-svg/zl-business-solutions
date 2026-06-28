-- ============================================================
-- ATTRIBUTION + AUDIT LOG + SOFT DELETE
-- Foundation for: "added by / edited by" notes, a recycle bin,
-- and a logs view. Enforced DB-side so the frontend barely changes.
--
-- In-scope tables (user-facing, create/edit/delete):
--   customers, items, purchase_orders, stock_entries, invoices,
--   invoice_lines, partial_payments, inventory_adjustments,
--   expenses, oversell_overrides
-- (inventory_archive + invoice_line_allocations are engine-internal
--  and deliberately excluded.)
-- ============================================================

-- ── Audit log table ─────────────────────────────────────────
create table if not exists audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null,          -- INSERT | UPDATE | SOFT_DELETE | RESTORE | DELETE
  user_id     uuid,
  location    text,
  old_data    jsonb,
  new_data    jsonb,
  changed_at  timestamptz not null default now()
);
create index if not exists audit_log_changed_at_idx on audit_log (changed_at desc);
create index if not exists audit_log_table_row_idx  on audit_log (table_name, row_id);
create index if not exists audit_log_user_idx       on audit_log (user_id);

alter table audit_log enable row level security;
drop policy if exists "audit_log_select" on audit_log;
-- Admin or anyone holding the 'audit' tag may read; nobody writes directly
-- (the trigger is SECURITY DEFINER and bypasses RLS).
create policy "audit_log_select" on audit_log for select
  using (public.is_admin() or public.has_tag('Audit'));

-- ── Trigger functions ───────────────────────────────────────

-- Stamp created_by/updated_by/updated_at from the JWT user.
create or replace function public.tg_stamp_attribution()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := auth.uid();
    new.updated_at := now();
  else -- UPDATE
    new.created_by := old.created_by;   -- immutable
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;

-- Convert physical DELETE into a soft delete, unless a hard delete was
-- explicitly requested (admin RPC sets the app.hard_delete GUC).
create or replace function public.tg_soft_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.hard_delete', true), 'off') = 'on' then
    return old;  -- allow the real delete
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = $1 where id = $2', tg_table_name)
    using auth.uid(), old.id;
  return null;   -- cancel the physical delete
end $$;

-- Write an audit row. Location pulled from JSON so it works on tables
-- that have no location column (children).
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_row_id uuid;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'INSERT' then
    v_action := 'INSERT'; v_row_id := new.id;
  elsif tg_op = 'DELETE' then
    v_action := 'DELETE'; v_row_id := old.id;
  else
    v_row_id := new.id;
    if     v_new->>'deleted_at' is not null and v_old->>'deleted_at' is null then v_action := 'SOFT_DELETE';
    elsif  v_new->>'deleted_at' is null     and v_old->>'deleted_at' is not null then v_action := 'RESTORE';
    else   v_action := 'UPDATE';
    end if;
  end if;

  insert into audit_log (table_name, row_id, action, user_id, location, old_data, new_data)
  values (tg_table_name, v_row_id, v_action, auth.uid(),
          coalesce(v_new->>'location', v_old->>'location'), v_old, v_new);
  return null;
end $$;

-- ── Apply columns + triggers to every in-scope table ────────
do $$
declare
  t text;
  tables text[] := array[
    'customers','items','purchase_orders','stock_entries','invoices',
    'invoice_lines','partial_payments','inventory_adjustments',
    'expenses','oversell_overrides'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
    execute format('alter table public.%I add column if not exists deleted_by uuid', t);
    execute format('create index if not exists %I on public.%I (deleted_at)', t||'_deleted_at_idx', t);

    execute format('drop trigger if exists z_stamp on public.%I', t);
    execute format('create trigger z_stamp before insert or update on public.%I for each row execute function public.tg_stamp_attribution()', t);

    execute format('drop trigger if exists z_soft_delete on public.%I', t);
    execute format('create trigger z_soft_delete before delete on public.%I for each row execute function public.tg_soft_delete()', t);

    execute format('drop trigger if exists z_audit on public.%I', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- ============================================================
-- SELECT policies: hide soft-deleted rows from ALL normal reads
-- (admin included). Recycle bin / logs read via the RPCs below.
-- Mirrors 0015 but adds the deleted_at filter.
-- ============================================================

-- location tables
drop policy if exists "items_select" on items;
create policy "items_select" on items for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "customers_select" on customers;
create policy "customers_select" on customers for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "po_select" on purchase_orders;
create policy "po_select" on purchase_orders for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "inv_select" on invoices;
create policy "inv_select" on invoices for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "exp_select" on expenses;
create policy "exp_select" on expenses for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "invadj_select" on inventory_adjustments;
create policy "invadj_select" on inventory_adjustments for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

drop policy if exists "oversell_select" on oversell_overrides;
create policy "oversell_select" on oversell_overrides for select
  using ((public.is_admin() or location = public.my_location()) and deleted_at is null);

-- child tables: own row not deleted AND parent visible & not deleted
drop policy if exists "se_select" on stock_entries;
create policy "se_select" on stock_entries for select using (
  stock_entries.deleted_at is null and (
    public.is_admin() or exists (
      select 1 from purchase_orders po
      where po.id = stock_entries.po_id and po.location = public.my_location() and po.deleted_at is null
    )
  )
);

drop policy if exists "il_select" on invoice_lines;
create policy "il_select" on invoice_lines for select using (
  invoice_lines.deleted_at is null and (
    public.is_admin() or exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id and i.location = public.my_location() and i.deleted_at is null
    )
  )
);

drop policy if exists "pp_select" on partial_payments;
create policy "pp_select" on partial_payments for select using (
  partial_payments.deleted_at is null and (
    public.is_admin() or exists (
      select 1 from invoices i
      where i.id = partial_payments.invoice_id and i.location = public.my_location() and i.deleted_at is null
    )
  )
);

-- ============================================================
-- RPCs for the recycle bin + logs views
-- ============================================================
-- Whitelist of tables the recycle bin may touch.
create or replace function public._audit_table_ok(p_table text)
returns boolean language sql immutable as $$
  select p_table = any (array[
    'customers','items','purchase_orders','stock_entries','invoices',
    'invoice_lines','partial_payments','inventory_adjustments',
    'expenses','oversell_overrides'
  ]);
$$;

-- List soft-deleted rows for a table (admin or 'audit' tag).
create or replace function public.list_deleted(p_table text)
returns setof jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_tag('Audit')) then raise exception 'not allowed'; end if;
  if not public._audit_table_ok(p_table) then raise exception 'unknown table %', p_table; end if;
  return query execute format(
    'select to_jsonb(t) from public.%I t where t.deleted_at is not null order by t.deleted_at desc', p_table);
end $$;

-- Restore a soft-deleted row (admin or 'audit' tag).
create or replace function public.restore_row(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_tag('Audit')) then raise exception 'not allowed'; end if;
  if not public._audit_table_ok(p_table) then raise exception 'unknown table %', p_table; end if;
  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1', p_table) using p_id;
end $$;

-- Permanently delete a soft-deleted row (admin or 'Audit' tag).
create or replace function public.hard_delete_row(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.has_tag('Audit')) then raise exception 'not allowed'; end if;
  if not public._audit_table_ok(p_table) then raise exception 'unknown table %', p_table; end if;
  perform set_config('app.hard_delete', 'on', true);  -- local to this transaction
  execute format('delete from public.%I where id = $1', p_table) using p_id;
end $$;

-- Resolve user ids → display names (names aren't sensitive; staff can't
-- read other profiles directly under RLS). Used by attribution footers + logs.
create or replace function public.profile_names()
returns table (id uuid, name text) language sql security definer set search_path = public as $$
  select id, coalesce(nullif(name, ''), nullif(username, ''), email) from profiles;
$$;

grant execute on function public.list_deleted(text)            to authenticated;
grant execute on function public.restore_row(text, uuid)       to authenticated;
grant execute on function public.hard_delete_row(text, uuid)   to authenticated;
grant execute on function public.profile_names()               to authenticated;
