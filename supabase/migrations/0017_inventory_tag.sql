-- Inventory adjustments are now gated by the dedicated 'Inventory' tag (not 'Stocks').
-- SELECT stays branch-scoped (everyone in the branch can see adjustments).
drop policy if exists "invadj_modify" on inventory_adjustments;
create policy "invadj_modify" on inventory_adjustments for all
  using (public.is_admin() or (public.has_tag('Inventory') and location = public.my_location()))
  with check (public.is_admin() or (public.has_tag('Inventory') and location = public.my_location()));
