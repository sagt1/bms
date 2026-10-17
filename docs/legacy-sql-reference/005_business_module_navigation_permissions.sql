-- 005_business_module_navigation_permissions.sql
-- Run ONLY in the SAGT - Verify project after reviewing.
-- Adds per-module navigation/view/edit flags. Does not create business data tables.
-- Least privilege: all new employee permissions default to false.
begin;

alter table public.profiles
  add column if not exists nav_client_project_payments boolean not null default false,
  add column if not exists can_view_client_project_payments boolean not null default false,
  add column if not exists can_edit_client_project_payments boolean not null default false,
  add column if not exists nav_attendance boolean not null default false,
  add column if not exists can_view_attendance boolean not null default false,
  add column if not exists can_edit_attendance boolean not null default false,
  add column if not exists nav_leave boolean not null default false,
  add column if not exists can_view_leave boolean not null default false,
  add column if not exists can_edit_leave boolean not null default false,
  add column if not exists nav_holidays boolean not null default false,
  add column if not exists can_view_holidays boolean not null default false,
  add column if not exists can_edit_holidays boolean not null default false,
  add column if not exists nav_flat_expense boolean not null default false,
  add column if not exists can_view_flat_expense boolean not null default false,
  add column if not exists can_edit_flat_expense boolean not null default false,
  add column if not exists nav_office_expense boolean not null default false,
  add column if not exists can_view_office_expense boolean not null default false,
  add column if not exists can_edit_office_expense boolean not null default false,
  add column if not exists nav_payroll boolean not null default false,
  add column if not exists can_view_payroll boolean not null default false,
  add column if not exists can_edit_payroll boolean not null default false,
  add column if not exists nav_payslip boolean not null default false,
  add column if not exists can_view_payslip boolean not null default false,
  add column if not exists can_edit_payslip boolean not null default false;

-- Enforce edit => view and view => navigation for the new modules.
create or replace function public.sagt_normalize_business_module_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.can_edit_client_project_payments then new.can_view_client_project_payments := true; end if;
  if new.can_view_client_project_payments then new.nav_client_project_payments := true; end if;
  if new.can_edit_attendance then new.can_view_attendance := true; end if;
  if new.can_view_attendance then new.nav_attendance := true; end if;
  if new.can_edit_leave then new.can_view_leave := true; end if;
  if new.can_view_leave then new.nav_leave := true; end if;
  if new.can_edit_holidays then new.can_view_holidays := true; end if;
  if new.can_view_holidays then new.nav_holidays := true; end if;
  if new.can_edit_flat_expense then new.can_view_flat_expense := true; end if;
  if new.can_view_flat_expense then new.nav_flat_expense := true; end if;
  if new.can_edit_office_expense then new.can_view_office_expense := true; end if;
  if new.can_view_office_expense then new.nav_office_expense := true; end if;
  if new.can_edit_payroll then new.can_view_payroll := true; end if;
  if new.can_view_payroll then new.nav_payroll := true; end if;
  if new.can_edit_payslip then new.can_view_payslip := true; end if;
  if new.can_view_payslip then new.nav_payslip := true; end if;

  -- This project currently has admin/employee roles only. Payroll is sensitive,
  -- so employees cannot be granted payroll administration/view through this migration.
  if new.role <> 'admin' then
    new.nav_payroll := false;
    new.can_view_payroll := false;
    new.can_edit_payroll := false;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_normalize_business_module_permissions on public.profiles;
create trigger profiles_normalize_business_module_permissions
before insert or update on public.profiles
for each row execute function public.sagt_normalize_business_module_permissions();

-- Shared permission helper for RLS policies on future module tables.
-- Admin access still requires an active profile. Payroll is admin-only.
create or replace function public.sagt_can_access_module(p_module text, p_edit boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and (
        p.role = 'admin'
        or case
          when p_module = 'survey' then (case when p_edit then p.can_edit_surveys else p.can_view_surveys end)
          when p_module in ('invoice','quotation') then (case when p_edit then p.can_edit_invoices else p.can_view_invoices end)
          when p_module in ('client_project_payments','client-payments','project-payments') then (case when p_edit then p.can_edit_client_project_payments else p.can_view_client_project_payments end)
          when p_module = 'attendance' then (case when p_edit then p.can_edit_attendance else p.can_view_attendance end)
          when p_module = 'leave' then (case when p_edit then p.can_edit_leave else p.can_view_leave end)
          when p_module = 'holidays' then (case when p_edit then p.can_edit_holidays else p.can_view_holidays end)
          when p_module = 'flat_expense' then (case when p_edit then p.can_edit_flat_expense else p.can_view_flat_expense end)
          when p_module = 'office_expense' then (case when p_edit then p.can_edit_office_expense else p.can_view_office_expense end)
          when p_module = 'payroll' then false
          when p_module = 'payslip' then (case when p_edit then p.can_edit_payslip else p.can_view_payslip end)
          else false
        end
      )
  );
$$;

create or replace function public.sagt_can_navigate_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and (
        p.role = 'admin'
        or case
          when p_module in ('client_project_payments','client-payments','project-payments') then p.nav_client_project_payments and p.can_view_client_project_payments
          when p_module = 'attendance' then p.nav_attendance and p.can_view_attendance
          when p_module = 'leave' then p.nav_leave and p.can_view_leave
          when p_module = 'holidays' then p.nav_holidays and p.can_view_holidays
          when p_module = 'flat_expense' then p.nav_flat_expense and p.can_view_flat_expense
          when p_module = 'office_expense' then p.nav_office_expense and p.can_view_office_expense
          when p_module = 'payroll' then false
          when p_module = 'payslip' then p.nav_payslip and p.can_view_payslip
          else false
        end
      )
  );
$$;

grant execute on function public.sagt_is_admin() to authenticated;
grant execute on function public.sagt_can_access_module(text, boolean) to authenticated;
grant execute on function public.sagt_can_navigate_module(text) to authenticated;

commit;
