-- PROPOSED, NOT APPLIED.
-- This creates only new SAGT client/project/payment objects. Review and test on a staging project
-- before any authorized deployment. It relies on existing permission helpers:
--   public.sagt_can_access_module(text, boolean)
--   public.sagt_can_navigate_module(text)
--   public.sagt_is_admin()
begin;

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 160),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  address text check (address is null or char_length(address) <= 1000),
  tax_identifier text check (tax_identifier is null or char_length(tax_identifier) <= 40),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts(id) on delete restrict,
  project_name text not null check (char_length(btrim(project_name)) between 1 and 180),
  project_code text check (project_code is null or char_length(project_code) <= 60),
  contract_amount numeric(14,2) not null default 0 check (contract_amount >= 0),
  currency_code text not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'planned' check (status in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date date,
  target_date date,
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_date is null or start_date is null or target_date >= start_date)
);

create table if not exists public.client_project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.client_projects(id) on delete restrict,
  milestone_name text not null check (char_length(btrim(milestone_name)) between 1 and 180),
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  due_date date,
  sequence integer not null default 1 check (sequence between 1 and 10000),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'on_hold')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

create table if not exists public.client_project_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.client_projects(id) on delete restrict,
  milestone_id uuid,
  paid_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other')),
  reference text check (reference is null or char_length(reference) <= 120),
  note text check (note is null or char_length(note) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  constraint client_project_payments_milestone_project_fkey
    foreign key (milestone_id, project_id)
    references public.client_project_milestones(id, project_id) on delete restrict,
  check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  ),
  check (void_reason is null or char_length(void_reason) <= 1000)
);

create index if not exists client_projects_client_id_idx on public.client_projects(client_id);
create index if not exists client_project_milestones_project_idx on public.client_project_milestones(project_id, sequence);
create index if not exists client_project_payments_project_date_idx on public.client_project_payments(project_id, paid_on desc);
create index if not exists client_project_payments_milestone_idx on public.client_project_payments(milestone_id) where milestone_id is not null;

alter table public.client_accounts enable row level security;
alter table public.client_projects enable row level security;
alter table public.client_project_milestones enable row level security;
alter table public.client_project_payments enable row level security;

revoke all on table public.client_accounts, public.client_projects, public.client_project_milestones, public.client_project_payments from public, anon, authenticated, service_role;
grant select, insert, update on table public.client_accounts, public.client_projects, public.client_project_milestones to authenticated;
grant select, insert on table public.client_project_payments to authenticated;

drop policy if exists client_accounts_read on public.client_accounts;
create policy client_accounts_read on public.client_accounts for select to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', false)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_accounts_insert on public.client_accounts;
create policy client_accounts_insert on public.client_accounts for insert to authenticated
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_accounts_update on public.client_accounts;
create policy client_accounts_update on public.client_accounts for update to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')))
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));

drop policy if exists client_projects_read on public.client_projects;
create policy client_projects_read on public.client_projects for select to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', false)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_projects_insert on public.client_projects;
create policy client_projects_insert on public.client_projects for insert to authenticated
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_projects_update on public.client_projects;
create policy client_projects_update on public.client_projects for update to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')))
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));

drop policy if exists client_project_milestones_read on public.client_project_milestones;
create policy client_project_milestones_read on public.client_project_milestones for select to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', false)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_project_milestones_insert on public.client_project_milestones;
create policy client_project_milestones_insert on public.client_project_milestones for insert to authenticated
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_project_milestones_update on public.client_project_milestones;
create policy client_project_milestones_update on public.client_project_milestones for update to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')))
  with check ((select public.sagt_can_access_module('client_project_payments', true)) and (select public.sagt_can_navigate_module('client_project_payments')));

drop policy if exists client_project_payments_read on public.client_project_payments;
create policy client_project_payments_read on public.client_project_payments for select to authenticated
  using ((select public.sagt_can_access_module('client_project_payments', false)) and (select public.sagt_can_navigate_module('client_project_payments')));
drop policy if exists client_project_payments_insert on public.client_project_payments;
create policy client_project_payments_insert on public.client_project_payments for insert to authenticated
  with check (
    (select public.sagt_can_access_module('client_project_payments', true))
    and (select public.sagt_can_navigate_module('client_project_payments'))
    and voided_at is null and voided_by is null and void_reason is null
  );

create or replace function public.sagt_stamp_client_module_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_accounts_stamp on public.client_accounts;
create trigger client_accounts_stamp before insert or update on public.client_accounts for each row execute function public.sagt_stamp_client_module_row();
drop trigger if exists client_projects_stamp on public.client_projects;
create trigger client_projects_stamp before insert or update on public.client_projects for each row execute function public.sagt_stamp_client_module_row();
drop trigger if exists client_project_milestones_stamp on public.client_project_milestones;
create trigger client_project_milestones_stamp before insert or update on public.client_project_milestones for each row execute function public.sagt_stamp_client_module_row();

create or replace function public.sagt_stamp_client_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if new.paid_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Payment date cannot be in the future'; end if;
  new.recorded_by := auth.uid();
  new.created_at := now();
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end;
$$;

drop trigger if exists client_project_payments_stamp on public.client_project_payments;
create trigger client_project_payments_stamp before insert on public.client_project_payments for each row execute function public.sagt_stamp_client_payment();

create or replace function public.sagt_void_client_project_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.sagt_is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 1000 then raise exception 'A void reason of 1 to 1000 characters is required'; end if;
  update public.client_project_payments
    set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_payment_id and voided_at is null;
  if not found then raise exception 'Payment was not found or has already been voided'; end if;
end;
$$;

revoke all on function public.sagt_stamp_client_module_row() from public, anon;
revoke all on function public.sagt_stamp_client_payment() from public, anon;
revoke all on function public.sagt_void_client_project_payment(uuid, text) from public, anon;
grant execute on function public.sagt_stamp_client_module_row() to authenticated;
grant execute on function public.sagt_stamp_client_payment() to authenticated;
grant execute on function public.sagt_void_client_project_payment(uuid, text) to authenticated;

commit;
