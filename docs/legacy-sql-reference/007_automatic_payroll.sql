-- 007_automatic_payroll.sql
-- Apply only to SAGT - Verify after reviewing and backing up. Not automatically deployed by this ZIP.
begin;

create table if not exists public.company_holidays (
 id uuid primary key default gen_random_uuid(), holiday_date date not null unique, name text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.employee_pay_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
 monthly_fixed_deduction numeric(12,2) not null default 0 check (monthly_fixed_deduction >= 0),
 monthly_additional_pay numeric(12,2) not null default 0 check (monthly_additional_pay >= 0),
 overtime_hourly_rate numeric(12,2) not null default 0 check (overtime_hourly_rate >= 0),
 salary_advance_balance numeric(12,2) not null default 0 check (salary_advance_balance >= 0),
 advance_repayment_this_month numeric(12,2) not null default 0 check (advance_repayment_this_month >= 0),
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.payroll_months (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 payroll_month date not null, monthly_salary numeric(12,2) not null, working_days integer not null,
 payable_days numeric(6,2) not null, absence_deduction numeric(12,2) not null,
 fixed_deduction numeric(12,2) not null, overtime_hours numeric(8,2) not null,
 overtime_pay numeric(12,2) not null, additional_pay numeric(12,2) not null,
 advance_repayment numeric(12,2) not null, gross_pay numeric(12,2) not null,
 net_pay numeric(12,2) not null, pending_attendance_days integer not null default 0,
 status text not null default 'draft' check (status in ('draft','finalized')),
 generated_at timestamptz not null default now(), finalized_at timestamptz, finalized_by uuid references auth.users(id),
 unique(user_id,payroll_month), check (payroll_month = date_trunc('month',payroll_month)::date)
);
create table if not exists public.payroll_daily (
 id uuid primary key default gen_random_uuid(), payroll_month_id uuid not null references public.payroll_months(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, work_date date not null,
 day_type text not null check (day_type in ('working','holiday','sunday')),
 attendance_status text not null check (attendance_status in ('present','half_day','absent','pending_review','paid_leave','unpaid_leave','holiday','sunday')),
 payable_fraction numeric(3,2) not null default 0, overtime_hours numeric(8,2) not null default 0,
 daily_deduction numeric(12,2) not null default 0, note text,
 unique(user_id,work_date)
);
create index if not exists payroll_months_month_idx on public.payroll_months(payroll_month desc);
create index if not exists payroll_daily_user_date_idx on public.payroll_daily(user_id,work_date desc);

alter table public.company_holidays enable row level security;
alter table public.employee_pay_settings enable row level security;
alter table public.payroll_months enable row level security;
alter table public.payroll_daily enable row level security;

drop policy if exists company_holidays_read on public.company_holidays;
create policy company_holidays_read on public.company_holidays for select to authenticated using (true);
drop policy if exists company_holidays_admin_write on public.company_holidays;
create policy company_holidays_admin_write on public.company_holidays for all to authenticated using ((select public.sagt_is_admin())) with check ((select public.sagt_is_admin()));
drop policy if exists employee_pay_settings_self_admin_read on public.employee_pay_settings;
create policy employee_pay_settings_self_admin_read on public.employee_pay_settings for select to authenticated using (user_id=(select auth.uid()) or (select public.sagt_is_admin()));
drop policy if exists employee_pay_settings_admin_write on public.employee_pay_settings;
create policy employee_pay_settings_admin_write on public.employee_pay_settings for all to authenticated using ((select public.sagt_is_admin())) with check ((select public.sagt_is_admin()));
drop policy if exists payroll_months_self_admin_read on public.payroll_months;
create policy payroll_months_self_admin_read on public.payroll_months for select to authenticated using (user_id=(select auth.uid()) or (select public.sagt_is_admin()));
drop policy if exists payroll_daily_self_admin_read on public.payroll_daily;
create policy payroll_daily_self_admin_read on public.payroll_daily for select to authenticated using (user_id=(select auth.uid()) or (select public.sagt_is_admin()));
grant select on public.company_holidays, public.employee_pay_settings, public.payroll_months, public.payroll_daily to authenticated;
grant insert, update, delete on public.company_holidays to authenticated;
grant insert, update, delete on public.employee_pay_settings to authenticated;
revoke insert, update, delete on public.payroll_months, public.payroll_daily from anon, authenticated;

create or replace function public.sagt_save_employee_pay_settings(
 p_user_id uuid, p_monthly_salary numeric, p_monthly_fixed_deduction numeric default 0,
 p_monthly_additional_pay numeric default 0, p_overtime_hourly_rate numeric default 0,
 p_advance_repayment_this_month numeric default 0
) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.sagt_is_admin() then raise exception 'Administrator access required'; end if;
 if p_monthly_salary < 0 or p_monthly_fixed_deduction < 0 or p_monthly_additional_pay < 0 or p_overtime_hourly_rate < 0 or p_advance_repayment_this_month < 0 then raise exception 'Payroll amounts cannot be negative'; end if;
 insert into public.employee_pay_settings(user_id,monthly_salary,monthly_fixed_deduction,monthly_additional_pay,overtime_hourly_rate,advance_repayment_this_month,updated_by)
 values(p_user_id,p_monthly_salary,p_monthly_fixed_deduction,p_monthly_additional_pay,p_overtime_hourly_rate,p_advance_repayment_this_month,auth.uid())
 on conflict(user_id) do update set monthly_salary=excluded.monthly_salary,monthly_fixed_deduction=excluded.monthly_fixed_deduction,monthly_additional_pay=excluded.monthly_additional_pay,overtime_hourly_rate=excluded.overtime_hourly_rate,advance_repayment_this_month=excluded.advance_repayment_this_month,updated_by=auth.uid(),updated_at=now();
end; $$;

create or replace function public.sagt_generate_monthly_payroll(p_month date default (date_trunc('month', ((now() at time zone 'Asia/Kolkata')::date) - interval '1 month'))::date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month',p_month)::date; v_next date; v_days integer; v_p record; v_d date; v_att public.attendance_records%rowtype; v_leave public.leave_requests%rowtype; v_day_type text; v_status text; v_frac numeric; v_ot numeric; v_ded numeric; v_payable numeric; v_ot_total numeric; v_pending integer; v_abs_ded numeric; v_rate numeric; v_month_id uuid; v_count integer:=0;
begin
 if auth.uid() is null or not public.sagt_is_admin() then raise exception 'Administrator access required'; end if;
 v_next := (v_month + interval '1 month')::date;
 select count(*) into v_days from generate_series(v_month::timestamp,(v_next-1)::timestamp,interval '1 day') g(d)
 where extract(isodow from g.d) <> 7 and not exists(select 1 from public.company_holidays h where h.holiday_date=g.d::date);
 if v_days=0 then raise exception 'No working days configured for this month'; end if;
 for v_p in select p.id as user_id, coalesce(s.monthly_salary,0) monthly_salary,coalesce(s.monthly_fixed_deduction,0) fixed_deduction,coalesce(s.monthly_additional_pay,0) additional_pay,coalesce(s.overtime_hourly_rate,0) overtime_rate,coalesce(s.advance_repayment_this_month,0) advance_repayment
   from public.profiles p left join public.employee_pay_settings s on s.user_id=p.id where p.is_active is distinct from false and p.role='employee'
 loop
   select id,status into v_month_id,v_status from public.payroll_months where user_id=v_p.user_id and payroll_month=v_month;
   if v_status='finalized' then continue; end if;
   if v_month_id is null then
     insert into public.payroll_months(user_id,payroll_month,monthly_salary,working_days,payable_days,absence_deduction,fixed_deduction,overtime_hours,overtime_pay,additional_pay,advance_repayment,gross_pay,net_pay,pending_attendance_days,status)
     values(v_p.user_id,v_month,v_p.monthly_salary,v_days,0,0,v_p.fixed_deduction,0,0,v_p.additional_pay,v_p.advance_repayment,v_p.monthly_salary,0,0,'draft') returning id into v_month_id;
   end if;
   delete from public.payroll_daily where user_id=v_p.user_id and work_date>=v_month and work_date<v_next;
   v_payable:=0;v_ot_total:=0;v_pending:=0;v_abs_ded:=0;
   for v_d in select g.d::date from generate_series(v_month::timestamp,(v_next-1)::timestamp,interval '1 day') g(d) loop
     v_day_type:=case when extract(isodow from v_d)=7 then 'sunday' when exists(select 1 from public.company_holidays h where h.holiday_date=v_d) then 'holiday' else 'working' end;
     v_frac:=0;v_ot:=0;v_ded:=0;v_status:=v_day_type;
     if v_day_type='working' then
       select * into v_leave from public.leave_requests l where l.user_id=v_p.user_id and l.status='approved' and v_d between l.start_date and l.end_date order by (l.leave_type='unpaid') desc limit 1;
       if found then
         if v_leave.leave_type='unpaid' then v_status:='unpaid_leave';v_ded:=v_p.monthly_salary/v_days;
         else v_status:='paid_leave';v_frac:=1; end if;
       else
         select * into v_att from public.attendance_records a where a.user_id=v_p.user_id and a.work_date=v_d;
         if found and v_att.check_in is not null and v_att.check_out is null then v_status:='pending_review';v_pending:=v_pending+1;
         elsif found and v_att.status='half_day' then v_status:='half_day';v_frac:=0.5;v_ded:=(v_p.monthly_salary/v_days)*0.5;
         elsif found and v_att.check_in is not null and v_att.check_out is not null then
           v_frac:=1;v_status:='present';
           v_ot:=greatest(0,extract(epoch from (v_att.check_out-v_att.check_in))/3600-9);
           if v_ot<0.5 then v_ot:=0; else v_ot:=floor(v_ot*2)/2; end if;
         else v_status:='absent';v_ded:=v_p.monthly_salary/v_days; end if;
       end if;
     end if;
     v_payable:=v_payable+v_frac;v_ot_total:=v_ot_total+v_ot;v_abs_ded:=v_abs_ded+v_ded;
     insert into public.payroll_daily(payroll_month_id,user_id,work_date,day_type,attendance_status,payable_fraction,overtime_hours,daily_deduction,note)
     values(v_month_id,v_p.user_id,v_d,v_day_type,v_status,v_frac,v_ot,v_ded,case when v_status='pending_review' then 'Attendance requires review' else null end);
   end loop;
   insert into public.payroll_months(user_id,payroll_month,monthly_salary,working_days,payable_days,absence_deduction,fixed_deduction,overtime_hours,overtime_pay,additional_pay,advance_repayment,gross_pay,net_pay,pending_attendance_days,status,generated_at,finalized_at,finalized_by)
   values(v_p.user_id,v_month,v_p.monthly_salary,v_days,v_payable,v_abs_ded,v_p.fixed_deduction,v_ot_total,v_ot_total*v_p.overtime_rate,v_p.additional_pay,v_p.advance_repayment,
    v_p.monthly_salary+(v_ot_total*v_p.overtime_rate)+v_p.additional_pay,
    greatest(0,v_p.monthly_salary-v_abs_ded-v_p.fixed_deduction-v_p.advance_repayment+(v_ot_total*v_p.overtime_rate)+v_p.additional_pay),v_pending,'draft',now(),null,null)
   on conflict(user_id,payroll_month) do update set monthly_salary=excluded.monthly_salary,working_days=excluded.working_days,payable_days=excluded.payable_days,absence_deduction=excluded.absence_deduction,fixed_deduction=excluded.fixed_deduction,overtime_hours=excluded.overtime_hours,overtime_pay=excluded.overtime_pay,additional_pay=excluded.additional_pay,advance_repayment=excluded.advance_repayment,gross_pay=excluded.gross_pay,net_pay=excluded.net_pay,pending_attendance_days=excluded.pending_attendance_days,status='draft',generated_at=now(),finalized_at=null,finalized_by=null
   returning id into v_month_id;
   update public.payroll_daily set payroll_month_id=v_month_id where user_id=v_p.user_id and work_date>=v_month and work_date<v_next;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('month',v_month,'employees_processed',v_count,'working_days',v_days);
end; $$;

create or replace function public.sagt_finalize_monthly_payroll(p_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_month date:=date_trunc('month',p_month)::date; v_pending integer; v_count integer;
begin
 if auth.uid() is null or not public.sagt_is_admin() then raise exception 'Administrator access required'; end if;
 select coalesce(sum(pending_attendance_days),0) into v_pending from public.payroll_months where payroll_month=v_month and status='draft';
 if v_pending>0 then raise exception 'Cannot finalize payroll: resolve pending attendance warnings first'; end if;
 update public.payroll_months set status='finalized',finalized_at=now(),finalized_by=auth.uid() where payroll_month=v_month and status='draft';get diagnostics v_count=row_count;
 return jsonb_build_object('month',v_month,'finalized_employees',v_count);
end; $$;

revoke all on function public.sagt_save_employee_pay_settings(uuid,numeric,numeric,numeric,numeric,numeric) from public,anon;
revoke all on function public.sagt_generate_monthly_payroll(date) from public,anon;
revoke all on function public.sagt_finalize_monthly_payroll(date) from public,anon;
grant execute on function public.sagt_save_employee_pay_settings(uuid,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.sagt_generate_monthly_payroll(date) to authenticated;
grant execute on function public.sagt_finalize_monthly_payroll(date) to authenticated;
commit;
