-- SAGT - Verify employee navigation permissions and activation state.
-- Run only in the SAGT - Verify project after reviewing the migration.
begin;

alter table public.profiles
  add column if not exists nav_dashboard boolean not null default true,
  add column if not exists is_active boolean not null default true;

create table if not exists public.employee_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('invite','deactivate','reactivate')),
  target_email text,
  created_at timestamptz not null default now()
);
alter table public.employee_admin_audit enable row level security;
drop policy if exists employee_admin_audit_select_admin on public.employee_admin_audit;
create policy employee_admin_audit_select_admin on public.employee_admin_audit
  for select to authenticated using ((select public.sagt_is_admin()));
grant select on public.employee_admin_audit to authenticated;
revoke insert, update, delete on public.employee_admin_audit from anon, authenticated;

-- Existing admin remains unrestricted. Existing employees retain their module flags;
-- dashboard is visible by default unless explicitly restricted in the admin UI.

create or replace function public.sagt_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active = true
  );
$$;

create or replace function public.sagt_can_access_module(p_module text, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active = true
      and (p.role = 'admin' or case
        when p_module = 'survey' then (case when p_edit then p.can_edit_surveys else p.can_view_surveys end)
        when p_module in ('invoice','quotation') then (case when p_edit then p.can_edit_invoices else p.can_view_invoices end)
        else false end)
  );
$$;

-- Ensure employee accounts created by Auth get least-privilege navigation defaults.
create or replace function public.sagt_create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, nav_dashboard, is_active,
    can_view_invoices, can_edit_invoices, can_view_surveys, can_edit_surveys)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''),
    'employee', true, true, false, false, false, false)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Explicitly re-create profile policies to keep inactive profiles from administering data.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated using (
  (id = (select auth.uid()) and is_active = true) or (select public.sagt_is_admin())
);

-- Admins can edit permission fields, but table updates cannot change role or activation.
create or replace function public.sagt_prevent_profile_role_escalation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Profile roles may only be changed through approved administrative procedures';
  end if;
  if new.is_active is distinct from old.is_active
     and current_user <> 'postgres'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Account activation must be managed through the trusted admin function';
  end if;
  return new;
end;
$$;

grant select, update on public.profiles to authenticated;
grant execute on function public.sagt_is_admin() to authenticated;
grant execute on function public.sagt_can_access_module(text, boolean) to authenticated;

commit;
