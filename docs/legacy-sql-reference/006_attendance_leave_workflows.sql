-- 006_attendance_leave_workflows.sql
-- Review and run only in SAGT - Verify after backup. This migration is NOT auto-applied by the ZIP.
begin;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'present' check (status in ('present','half_day','absent','pending_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, work_date),
  constraint attendance_time_order check (check_out is null or check_in is not null and check_out >= check_in)
);
create index if not exists attendance_records_user_date_idx on public.attendance_records(user_id, work_date desc);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  leave_type text not null check (leave_type in ('casual','sick','unpaid','other')),
  start_date date not null,
  end_date date not null,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leave_requests_user_created_idx on public.leave_requests(user_id, created_at desc);

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  correction_type text not null check (correction_type in ('missed_check_in','missed_check_out','both')),
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (requested_check_out is null or requested_check_in is null or requested_check_out >= requested_check_in)
);
create index if not exists attendance_corrections_user_created_idx on public.attendance_correction_requests(user_id, created_at desc);

alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_correction_requests enable row level security;

drop policy if exists attendance_records_select_self_admin on public.attendance_records;
create policy attendance_records_select_self_admin on public.attendance_records
for select to authenticated using (user_id = (select auth.uid()) or (select public.sagt_is_admin()));
drop policy if exists leave_requests_select_self_admin on public.leave_requests;
create policy leave_requests_select_self_admin on public.leave_requests
for select to authenticated using (user_id = (select auth.uid()) or (select public.sagt_is_admin()));
drop policy if exists leave_requests_insert_self on public.leave_requests;
create policy leave_requests_insert_self on public.leave_requests
for insert to authenticated with check (
  user_id = (select auth.uid())
  and status = 'pending' and decided_by is null and decided_at is null
  and (select public.sagt_can_access_module('leave', true))
);
drop policy if exists attendance_corrections_select_self_admin on public.attendance_correction_requests;
create policy attendance_corrections_select_self_admin on public.attendance_correction_requests
for select to authenticated using (user_id = (select auth.uid()) or (select public.sagt_is_admin()));
drop policy if exists attendance_corrections_insert_self on public.attendance_correction_requests;
create policy attendance_corrections_insert_self on public.attendance_correction_requests
for insert to authenticated with check (
  user_id = (select auth.uid())
  and status = 'pending' and decided_by is null and decided_at is null
  and (select public.sagt_can_access_module('attendance', true))
);

grant select on public.attendance_records, public.leave_requests, public.attendance_correction_requests to authenticated;
grant insert on public.leave_requests, public.attendance_correction_requests to authenticated;
revoke update, delete, insert on public.attendance_records from anon, authenticated;
revoke update, delete on public.leave_requests, public.attendance_correction_requests from anon, authenticated;

create or replace function public.sagt_attendance_check_in()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_date date := (now() at time zone 'Asia/Kolkata')::date; v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not public.sagt_can_access_module('attendance', true) then raise exception 'Attendance edit permission required'; end if;
  select id into v_id from public.attendance_records where user_id=v_uid and work_date=v_date and check_in is not null;
  if v_id is not null then raise exception 'Check-in already recorded for today'; end if;
  insert into public.attendance_records(user_id, work_date, check_in, status)
  values (v_uid, v_date, now(), 'present')
  on conflict (user_id, work_date) do update set check_in = excluded.check_in, updated_at = now()
  where public.attendance_records.check_in is null
  returning id into v_id;
  if v_id is null then raise exception 'Check-in already recorded for today'; end if;
  return jsonb_build_object('id',v_id,'work_date',v_date,'recorded_at',now());
end;
$$;

create or replace function public.sagt_attendance_check_out()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_date date := (now() at time zone 'Asia/Kolkata')::date; v_id uuid; v_checkin timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not public.sagt_can_access_module('attendance', true) then raise exception 'Attendance edit permission required'; end if;
  select id, check_in into v_id, v_checkin from public.attendance_records where user_id=v_uid and work_date=v_date;
  if v_id is null or v_checkin is null then raise exception 'Record check-in before check-out'; end if;
  update public.attendance_records set check_out=coalesce(check_out,now()), updated_at=now() where id=v_id returning id into v_id;
  return jsonb_build_object('id',v_id,'work_date',v_date,'recorded_at',now());
end;
$$;

create or replace function public.sagt_decide_employee_request(
 p_table text, p_request_id uuid, p_decision text, p_admin_note text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_user uuid; v_date date; v_in timestamptz; v_out timestamptz;
begin
 if v_uid is null or not public.sagt_is_admin() then raise exception 'Active administrator permission required'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
 if p_table='leave_requests' then
   update public.leave_requests set status=p_decision, admin_note=nullif(trim(p_admin_note),''), decided_by=v_uid, decided_at=now()
   where id=p_request_id and status='pending';
   if not found then raise exception 'Pending leave request not found'; end if;
 elsif p_table='attendance_correction_requests' then
   select user_id, work_date, requested_check_in, requested_check_out into v_user,v_date,v_in,v_out
   from public.attendance_correction_requests where id=p_request_id and status='pending' for update;
   if not found then raise exception 'Pending attendance correction not found'; end if;
   update public.attendance_correction_requests set status=p_decision, admin_note=nullif(trim(p_admin_note),''), decided_by=v_uid, decided_at=now()
   where id=p_request_id;
   if p_decision='approved' then
     insert into public.attendance_records(user_id,work_date,check_in,check_out,status)
     values(v_user,v_date,v_in,v_out,'present')
     on conflict(user_id,work_date) do update set
       check_in=coalesce(excluded.check_in, public.attendance_records.check_in),
       check_out=coalesce(excluded.check_out, public.attendance_records.check_out),
       updated_at=now();
   end if;
 else
   raise exception 'Unsupported request type';
 end if;
end;
$$;

revoke all on function public.sagt_attendance_check_in() from public, anon;
revoke all on function public.sagt_attendance_check_out() from public, anon;
revoke all on function public.sagt_decide_employee_request(text,uuid,text,text) from public, anon;
grant execute on function public.sagt_attendance_check_in() to authenticated;
grant execute on function public.sagt_attendance_check_out() to authenticated;
grant execute on function public.sagt_decide_employee_request(text,uuid,text,text) to authenticated;

commit;
