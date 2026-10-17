-- SAGT - Verify initial schema and security policies.
-- Review before running in the NEW project only. Never disable RLS.
-- Bootstrap is restricted to the exact initial owner email below.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'employee' check (role in ('admin','employee')),
  can_view_invoices boolean not null default false,
  can_edit_invoices boolean not null default false,
  can_view_surveys boolean not null default false,
  can_edit_surveys boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_edit_requires_view check
    ((not can_edit_invoices or can_view_invoices) and (not can_edit_surveys or can_view_surveys))
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('invoice','quotation','survey')),
  title text not null default '',
  document_number text,
  status text not null default 'draft' check (status in ('draft','issued','paid','overdue','cancelled','completed')),
  client_name text not null default '',
  content jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_updated_at_idx on public.documents(updated_at desc);
create index if not exists documents_created_by_idx on public.documents(created_by);
create index if not exists documents_module_idx on public.documents(module);

create or replace function public.sagt_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.sagt_touch_updated_at();
drop trigger if exists documents_touch_updated_at on public.documents;
create trigger documents_touch_updated_at before update on public.documents
for each row execute function public.sagt_touch_updated_at();

-- New users receive a least-privilege profile. No user can choose their own role.
create or replace function public.sagt_create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role, can_view_invoices, can_edit_invoices, can_view_surveys, can_edit_surveys)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''), 'employee', false, false, false, false)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sagt on auth.users;
create trigger on_auth_user_created_sagt after insert on auth.users
for each row execute function public.sagt_create_profile_for_auth_user();

create or replace function public.sagt_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

create or replace function public.sagt_can_access_module(p_module text, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.role = 'admin' or case
        when p_module = 'survey' then (case when p_edit then p.can_edit_surveys else p.can_view_surveys end)
        when p_module in ('invoice','quotation') then (case when p_edit then p.can_edit_invoices else p.can_view_invoices end)
        else false end)
  );
$$;

-- One-time self-bootstrap: only the signed-in user whose Auth email exactly matches
-- the initial owner can promote their own profile. No arbitrary user ID is accepted.
create or replace function public.bootstrap_initial_admin()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from lower('shreeaditya2025@gmail.com') then
    raise exception 'This account is not authorized for initial administrator setup';
  end if;
  insert into public.profiles (id, email, full_name, role, can_view_invoices, can_edit_invoices, can_view_surveys, can_edit_surveys)
  values (v_uid, v_email, 'Shree Aditya Geo Tech Administrator', 'admin', true, true, true, true)
  on conflict (id) do update set
    email = excluded.email,
    role = 'admin',
    can_view_invoices = true,
    can_edit_invoices = true,
    can_view_surveys = true,
    can_edit_surveys = true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.documents enable row level security;

-- Remove known policies to make this migration safely repeatable.
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists documents_select_by_module_permission on public.documents;
drop policy if exists documents_insert_by_module_permission on public.documents;
drop policy if exists documents_update_by_module_permission on public.documents;
drop policy if exists documents_delete_admin on public.documents;

create policy profiles_select_self_or_admin on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.sagt_is_admin()));

-- Admin can edit non-role profile fields via UI; trigger below prevents role changes through table updates.
create or replace function public.sagt_prevent_profile_role_escalation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role and current_user <> 'postgres' then
    raise exception 'Profile roles may only be changed through approved administrative functions';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_prevent_role_escalation on public.profiles;
create trigger profiles_prevent_role_escalation before update on public.profiles
for each row execute function public.sagt_prevent_profile_role_escalation();

create policy profiles_update_admin on public.profiles
for update to authenticated using ((select public.sagt_is_admin())) with check ((select public.sagt_is_admin()));

create policy documents_select_by_module_permission on public.documents
for select to authenticated using ((select public.sagt_can_access_module(module, false)));
create policy documents_insert_by_module_permission on public.documents
for insert to authenticated with check (
  (select public.sagt_can_access_module(module, true))
  and created_by = (select auth.uid()) and updated_by = (select auth.uid())
);
create policy documents_update_by_module_permission on public.documents
for update to authenticated using ((select public.sagt_can_access_module(module, true)))
with check ((select public.sagt_can_access_module(module, true)) and updated_by = (select auth.uid()));
create policy documents_delete_admin on public.documents
for delete to authenticated using ((select public.sagt_is_admin()));

revoke all on function public.sagt_create_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.sagt_is_admin() from public, anon;
revoke all on function public.sagt_can_access_module(text, boolean) from public, anon;
grant execute on function public.sagt_is_admin() to authenticated;
grant execute on function public.sagt_can_access_module(text, boolean) to authenticated;
revoke all on function public.bootstrap_initial_admin() from public, anon;
grant execute on function public.bootstrap_initial_admin() to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.documents to authenticated;

commit;
