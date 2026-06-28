-- ============================================================
-- PHASE 3: RLS LOCKDOWN
-- Replaces the wide-open policies with real ones:
--   • SELECT  = admin, OR row belongs to the user's branch (location)
--   • WRITE   = admin, OR (user has the module's tag AND row is in their branch)
-- Admin (profiles.is_admin) bypasses ALL checks → you can never lock yourself out.
-- Auth must already work (Phase 1). Run AFTER verifying login.
-- ============================================================

-- ── Helper functions (SECURITY DEFINER → read profiles without RLS recursion) ──
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.my_location()
returns text language sql security definer stable set search_path = public as $$
  select location from profiles where id = auth.uid();
$$;

create or replace function public.has_tag(t text)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((select t = any(tags) from profiles where id = auth.uid()), false);
$$;

-- ── profiles: read own or (admin reads all); writes admin only ──
drop policy if exists "open_profiles" on profiles;
create policy "profiles_select" on profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_modify" on profiles for all using (public.is_admin()) with check (public.is_admin());

-- ── locations: any logged-in user reads; admin writes ──
drop policy if exists "open_locations" on locations;
create policy "locations_select" on locations for select using (auth.role() = 'authenticated');
create policy "locations_modify" on locations for all using (public.is_admin()) with check (public.is_admin());

-- ── list_options: any logged-in user reads + writes (reference/config) ──
drop policy if exists "open_list_options" on list_options;
create policy "list_options_all" on list_options for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── deposit_slips (legacy/unused): logged-in read+write ──
drop policy if exists "open_deposit_slips" on deposit_slips;
create policy "deposit_slips_all" on deposit_slips for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Parent tables with a `location` column
-- ============================================================

-- items — edited by Stocks OR Sales staff
drop policy if exists "open_items" on items;
create policy "items_select" on items for select using (public.is_admin() or location = public.my_location());
create policy "items_modify" on items for all
  using (public.is_admin() or ((public.has_tag('Stocks') or public.has_tag('Sales')) and location = public.my_location()))
  with check (public.is_admin() or ((public.has_tag('Stocks') or public.has_tag('Sales')) and location = public.my_location()));

-- customers — Sales
drop policy if exists "open_customers" on customers;
create policy "customers_select" on customers for select using (public.is_admin() or location = public.my_location());
create policy "customers_modify" on customers for all
  using (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()));

-- purchase_orders (stock deliveries/transfers) — Stocks
drop policy if exists "open_purchase_orders" on purchase_orders;
create policy "po_select" on purchase_orders for select using (public.is_admin() or location = public.my_location());
create policy "po_modify" on purchase_orders for all
  using (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()));

-- invoices — Sales
drop policy if exists "open_invoices" on invoices;
create policy "inv_select" on invoices for select using (public.is_admin() or location = public.my_location());
create policy "inv_modify" on invoices for all
  using (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()));

-- expenses — Expense
drop policy if exists "open_expenses" on expenses;
create policy "exp_select" on expenses for select using (public.is_admin() or location = public.my_location());
create policy "exp_modify" on expenses for all
  using (public.is_admin() or (public.has_tag('Expense') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Expense') and location = public.my_location()));

-- inventory_archive (opening balances) — Stocks
drop policy if exists "open_inventory_archive" on inventory_archive;
create policy "invarch_select" on inventory_archive for select using (public.is_admin() or location = public.my_location());
create policy "invarch_modify" on inventory_archive for all
  using (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()));

-- inventory_adjustments — Stocks (UI also gates to admin)
drop policy if exists "open_inventory_adjustments" on inventory_adjustments;
create policy "invadj_select" on inventory_adjustments for select using (public.is_admin() or location = public.my_location());
create policy "invadj_modify" on inventory_adjustments for all
  using (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Stocks') and location = public.my_location()));

-- oversell_overrides — Sales create them; admin approves (UI-gated)
drop policy if exists "open_oversell_overrides" on oversell_overrides;
create policy "oversell_select" on oversell_overrides for select using (public.is_admin() or location = public.my_location());
create policy "oversell_modify" on oversell_overrides for all
  using (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Sales') and location = public.my_location()));

-- expense_categories (no location, shared) — Expense staff or admin write
drop policy if exists "open_expense_categories" on expense_categories;
create policy "expcat_select" on expense_categories for select using (auth.role() = 'authenticated');
create policy "expcat_modify" on expense_categories for all
  using (public.is_admin() or public.has_tag('Expense'))
  with check (public.is_admin() or public.has_tag('Expense'));

-- ============================================================
-- Child tables (no location) — scoped via their parent
-- ============================================================

-- stock_entries → purchase_orders — Stocks
drop policy if exists "open_stock_entries" on stock_entries;
create policy "se_select" on stock_entries for select using (
  public.is_admin() or exists (select 1 from purchase_orders po where po.id = stock_entries.po_id and po.location = public.my_location())
);
create policy "se_modify" on stock_entries for all
  using (public.is_admin() or (public.has_tag('Stocks') and exists (select 1 from purchase_orders po where po.id = stock_entries.po_id and po.location = public.my_location())))
  with check (public.is_admin() or (public.has_tag('Stocks') and exists (select 1 from purchase_orders po where po.id = stock_entries.po_id and po.location = public.my_location())));

-- invoice_lines → invoices — Sales
drop policy if exists "open_invoice_lines" on invoice_lines;
create policy "il_select" on invoice_lines for select using (
  public.is_admin() or exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.location = public.my_location())
);
create policy "il_modify" on invoice_lines for all
  using (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.location = public.my_location())))
  with check (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = invoice_lines.invoice_id and i.location = public.my_location())));

-- invoice_line_allocations → invoices — Sales
drop policy if exists "open_invoice_line_allocations" on invoice_line_allocations;
create policy "ila_select" on invoice_line_allocations for select using (
  public.is_admin() or exists (select 1 from invoices i where i.id = invoice_line_allocations.invoice_id and i.location = public.my_location())
);
create policy "ila_modify" on invoice_line_allocations for all
  using (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = invoice_line_allocations.invoice_id and i.location = public.my_location())))
  with check (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = invoice_line_allocations.invoice_id and i.location = public.my_location())));

-- partial_payments → invoices — Sales
drop policy if exists "open_partial_payments" on partial_payments;
create policy "pp_select" on partial_payments for select using (
  public.is_admin() or exists (select 1 from invoices i where i.id = partial_payments.invoice_id and i.location = public.my_location())
);
create policy "pp_modify" on partial_payments for all
  using (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = partial_payments.invoice_id and i.location = public.my_location())))
  with check (public.is_admin() or (public.has_tag('Sales') and exists (select 1 from invoices i where i.id = partial_payments.invoice_id and i.location = public.my_location())));
