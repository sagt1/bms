-- Staging-only review script for SAGT - Verify (gewvwdfolaaipkpbqpmr).
-- Not part of the app's automatic setup and not applied to any database.
-- Review against a disposable staging clone before any owner-approved release.
-- This script changes policies/functions only; it does not create, drop, or
-- rewrite attendance, payroll, profile, or employee data.

begin;

-- Read access follows the same navigation + view gate as the employee UI.
-- Active admins retain team review access.
drop policy if exists attendance_records_select_self_admin on public.attendance_records;
create policy attendance_records_select_self_admin on public.attendance_records
for select to authenticated
using (
  (select public.sagt_is_admin())
  or (
    user_id = (select auth.uid())
    and (select public.sagt_can_navigate_module('attendance'))
  )
);

drop policy if exists attendance_corrections_select_self_admin on public.attendance_correction_requests;
create policy attendance_corrections_select_self_admin on public.attendance_correction_requests
for select to authenticated
using (
  (select public.sagt_is_admin())
  or (
    user_id = (select auth.uid())
    and (select public.sagt_can_navigate_module('attendance'))
  )
);

drop policy if exists leave_requests_select_self_admin on public.leave_requests;
create policy leave_requests_select_self_admin on public.leave_requests
for select to authenticated
using (
  (select public.sagt_is_admin())
  or (
    user_id = (select auth.uid())
    and (select public.sagt_can_navigate_module('leave'))
  )
);

-- Only active employees with attendance navigation, view, and edit access can
-- submit corrections. The admin workflow remains decision-only.
drop policy if exists attendance_corrections_insert_self on public.attendance_correction_requests;
create policy attendance_corrections_insert_self on public.attendance_correction_requests
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and decided_by is null
  and decided_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role = 'employee'
  )
  and (select public.sagt_can_navigate_module('attendance'))
  and (select public.sagt_can_access_module('attendance', true))
  and work_date <= ((now() at time zone 'Asia/Kolkata')::date)
  and case correction_type
    when 'missed_check_in' then requested_check_in is not null and requested_check_out is null
    when 'missed_check_out' then requested_check_in is null and requested_check_out is not null
    when 'both' then requested_check_in is not null and requested_check_out is not null and requested_check_out > requested_check_in
    else false
  end
  and (requested_check_in is null or (
    requested_check_in <= now()
    and (requested_check_in at time zone 'Asia/Kolkata')::date = work_date
  ))
  and (requested_check_out is null or (
    requested_check_out <= now()
    and (requested_check_out at time zone 'Asia/Kolkata')::date = work_date
  ))
);

-- Admins decide leave requests but cannot submit one through a direct API call.
drop policy if exists leave_requests_insert_self on public.leave_requests;
create policy leave_requests_insert_self on public.leave_requests
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and decided_by is null
  and decided_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.role = 'employee'
  )
  and (select public.sagt_can_navigate_module('leave'))
  and (select public.sagt_can_access_module('leave', true))
);

-- SECURITY DEFINER RPCs enforce the same employee-only role and permissions,
-- even if an administrator calls them directly outside the React interface.
create or replace function public.sagt_attendance_check_in()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_date date := (v_now at time zone 'Asia/Kolkata')::date;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.is_active = true and p.role = 'employee'
      and p.nav_attendance = true and p.can_view_attendance = true and p.can_edit_attendance = true
  ) then raise exception 'Employee attendance edit permission required'; end if;

  insert into public.attendance_records(user_id, work_date, check_in, status, updated_at)
  values (v_uid, v_date, v_now, 'present', v_now)
  on conflict (user_id, work_date) do update
    set check_in = excluded.check_in, status = 'present', updated_at = excluded.updated_at
    where public.attendance_records.check_in is null
  returning id into v_id;

  if v_id is null then raise exception 'Check-in already recorded for today'; end if;
  return jsonb_build_object('id', v_id, 'work_date', v_date, 'recorded_at', v_now);
end;
$$;

create or replace function public.sagt_attendance_check_out()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_date date := (v_now at time zone 'Asia/Kolkata')::date;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.is_active = true and p.role = 'employee'
      and p.nav_attendance = true and p.can_view_attendance = true and p.can_edit_attendance = true
  ) then raise exception 'Employee attendance edit permission required'; end if;

  update public.attendance_records
  set check_out = v_now, status = 'present', updated_at = v_now
  where user_id = v_uid and work_date = v_date and check_in is not null and check_out is null
  returning id into v_id;

  if v_id is null then raise exception 'Check-in is required and check-out may be recorded only once'; end if;
  return jsonb_build_object('id', v_id, 'work_date', v_date, 'recorded_at', v_now);
end;
$$;

-- Decision RPC remains admin-only. Approved corrections merge with the existing
-- row, require a valid final timeline, and keep incomplete days pending payroll.
create or replace function public.sagt_decide_employee_request(
  p_table text,
  p_request_id uuid,
  p_decision text,
  p_admin_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user uuid;
  v_date date;
  v_requested_in timestamptz;
  v_requested_out timestamptz;
  v_existing_in timestamptz;
  v_existing_out timestamptz;
  v_final_in timestamptz;
  v_final_out timestamptz;
begin
  if v_uid is null or not (select public.sagt_is_admin()) then
    raise exception 'Active administrator permission required';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  if p_table = 'leave_requests' then
    update public.leave_requests
    set status = p_decision,
        admin_note = nullif(left(trim(coalesce(p_admin_note, '')), 1000), ''),
        decided_by = v_uid,
        decided_at = clock_timestamp()
    where id = p_request_id and status = 'pending';
    if not found then raise exception 'Pending leave request not found'; end if;
  elsif p_table = 'attendance_correction_requests' then
    select user_id, work_date, requested_check_in, requested_check_out
      into v_user, v_date, v_requested_in, v_requested_out
    from public.attendance_correction_requests
    where id = p_request_id and status = 'pending'
    for update;
    if not found then raise exception 'Pending attendance correction not found'; end if;

    if p_decision = 'approved' then
      select check_in, check_out into v_existing_in, v_existing_out
      from public.attendance_records
      where user_id = v_user and work_date = v_date
      for update;
      v_final_in := coalesce(v_requested_in, v_existing_in);
      v_final_out := coalesce(v_requested_out, v_existing_out);
      if v_final_in is null or (v_final_out is not null and v_final_out <= v_final_in) then
        raise exception 'Correction cannot be approved until it forms a valid attendance timeline';
      end if;

      insert into public.attendance_records(user_id, work_date, check_in, check_out, status, updated_at)
      values (
        v_user, v_date, v_final_in, v_final_out,
        case when v_final_out is null then 'pending_review' else 'present' end,
        clock_timestamp()
      )
      on conflict (user_id, work_date) do update set
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        status = excluded.status,
        updated_at = excluded.updated_at;
    end if;

    update public.attendance_correction_requests
    set status = p_decision,
        admin_note = nullif(left(trim(coalesce(p_admin_note, '')), 1000), ''),
        decided_by = v_uid,
        decided_at = clock_timestamp()
    where id = p_request_id and status = 'pending';
    if not found then raise exception 'Pending attendance correction not found'; end if;
  else
    raise exception 'Unsupported request type';
  end if;
end;
$$;

revoke all on function public.sagt_attendance_check_in() from public, anon;
revoke all on function public.sagt_attendance_check_out() from public, anon;
revoke all on function public.sagt_decide_employee_request(text, uuid, text, text) from public, anon;
grant execute on function public.sagt_attendance_check_in() to authenticated;
grant execute on function public.sagt_attendance_check_out() to authenticated;
grant execute on function public.sagt_decide_employee_request(text, uuid, text, text) to authenticated;

commit;
