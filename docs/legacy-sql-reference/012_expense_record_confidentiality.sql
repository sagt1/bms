-- Restrict expense record tracking to the submitting employee or an administrator.
-- This prevents a module-level view flag from exposing every employee's expense records.
drop policy if exists expense_records_select_authorized on public.expense_records;
create policy expense_records_select_own_or_admin
  on public.expense_records
  for select
  to authenticated
  using (
    submitted_by = (select auth.uid())
    or (select public.sagt_is_admin())
  );
