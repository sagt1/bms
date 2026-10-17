-- Applied to the SAGT - Verify Supabase project on 2026-10-17.
-- Adds indexes for seven previously unindexed foreign keys and splits FOR ALL
-- admin policies into explicit INSERT/UPDATE/DELETE policies to avoid SELECT overlap.
create index if not exists attendance_correction_requests_decided_by_idx on public.attendance_correction_requests (decided_by);
create index if not exists company_holidays_created_by_idx on public.company_holidays (created_by);
create index if not exists employee_pay_settings_updated_by_idx on public.employee_pay_settings (updated_by);
create index if not exists expense_records_reviewer_id_idx on public.expense_records (reviewer_id);
create index if not exists leave_requests_decided_by_idx on public.leave_requests (decided_by);
create index if not exists payroll_daily_payroll_month_id_idx on public.payroll_daily (payroll_month_id);
create index if not exists payroll_months_finalized_by_idx on public.payroll_months (finalized_by);

drop policy if exists company_holidays_admin_write on public.company_holidays;
create policy company_holidays_admin_insert on public.company_holidays for insert to authenticated with check ((select public.sagt_is_admin()));
create policy company_holidays_admin_update on public.company_holidays for update to authenticated using ((select public.sagt_is_admin())) with check ((select public.sagt_is_admin()));
create policy company_holidays_admin_delete on public.company_holidays for delete to authenticated using ((select public.sagt_is_admin()));

drop policy if exists employee_pay_settings_admin_write on public.employee_pay_settings;
create policy employee_pay_settings_admin_insert on public.employee_pay_settings for insert to authenticated with check ((select public.sagt_is_admin()));
create policy employee_pay_settings_admin_update on public.employee_pay_settings for update to authenticated using ((select public.sagt_is_admin())) with check ((select public.sagt_is_admin()));
create policy employee_pay_settings_admin_delete on public.employee_pay_settings for delete to authenticated using ((select public.sagt_is_admin()));
