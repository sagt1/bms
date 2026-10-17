-- 008_cia_production_hardening.sql
-- SAGT - Verify ONLY. Review and test in a staging project before production.
-- Non-destructive: adds a minimal audit log, indexes, and explicit grants/policies.
begin;

-- Explicitly keep browser access authenticated-only on business tables.
revoke all on table public.profiles, public.documents from anon;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.documents to authenticated;

-- Ensure core business data tables retain RLS if they exist.
do $$
declare t text;
begin
  foreach t in array array['profiles','documents','company_holidays','employee_pay_settings','payroll_months','payroll_daily','attendance_records','leave_requests','attendance_correction_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- Audit log intentionally stores identifiers and changed column names, not document/payroll values.
create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null,
  record_id text,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  changed_fields text[] not null default '{}',
  request_id text
);
create index if not exists security_audit_log_occurred_at_idx on public.security_audit_log (occurred_at desc);
create index if not exists security_audit_log_actor_id_idx on public.security_audit_log (actor_id, occurred_at desc);
create index if not exists security_audit_log_table_record_idx on public.security_audit_log (table_name, record_id, occurred_at desc);
alter table public.security_audit_log enable row level security;
revoke all on table public.security_audit_log from public, anon;
grant select on table public.security_audit_log to authenticated;
drop policy if exists security_audit_log_admin_read on public.security_audit_log;
create policy security_audit_log_admin_read on public.security_audit_log
  for select to authenticated using ((select public.sagt_is_admin()));

create or replace function public.sagt_write_security_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_json jsonb;
  new_json jsonb;
  keys text[];
  rid text;
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    rid := coalesce(new_json->>'id', new_json->>'user_id', new_json->>'work_date');
    keys := array(select jsonb_object_keys(new_json));
  elsif tg_op = 'DELETE' then
    old_json := to_jsonb(old);
    rid := coalesce(old_json->>'id', old_json->>'user_id', old_json->>'work_date');
    keys := array(select jsonb_object_keys(old_json));
  else
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    rid := coalesce(new_json->>'id', new_json->>'user_id', new_json->>'work_date');
    select coalesce(array_agg(k order by k), '{}'::text[]) into keys
      from (select jsonb_object_keys(new_json) k) s
      where old_json->k is distinct from new_json->k;
  end if;
  insert into public.security_audit_log(actor_id, table_name, record_id, operation, changed_fields, request_id)
  values ((select auth.uid()), tg_table_name, rid, tg_op, coalesce(keys, '{}'::text[]), nullif(current_setting('request.headers', true), '')::jsonb->>'x-request-id');
  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when others then
  -- Audit failure should fail the write, preserving audit completeness for covered tables.
  raise;
end;
$$;
revoke all on function public.sagt_write_security_audit() from public, anon, authenticated;

-- Attach only to tables that are present in the installed migration sequence.
do $$
declare t text;
begin
  foreach t in array array['profiles','documents','company_holidays','employee_pay_settings','payroll_months','payroll_daily','attendance_records','leave_requests','attendance_correction_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists sagt_security_audit on public.%I', t);
      execute format('create trigger sagt_security_audit after insert or update or delete on public.%I for each row execute function public.sagt_write_security_audit()', t);
    end if;
  end loop;
end $$;

-- Harden callable RPC permissions. Function-level checks remain required inside each function.
do $$
begin
  if to_regprocedure('public.bootstrap_initial_admin()') is not null then
    execute 'revoke all on function public.bootstrap_initial_admin() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Authenticated RLS helper functions are needed by policies; do not grant them to anon.
revoke all on function public.sagt_is_admin() from public, anon;
grant execute on function public.sagt_is_admin() to authenticated;
revoke all on function public.sagt_can_access_module(text, boolean) from public, anon;
grant execute on function public.sagt_can_access_module(text, boolean) to authenticated;

commit;
