-- Proposed pgTAP structural checks. Run on a disposable/staging Supabase database only
-- after reviewing and applying 20261017120000_client_project_payments.sql.
begin;
select plan(12);

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.client_accounts'::regclass), 'client_accounts has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.client_projects'::regclass), 'client_projects has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.client_project_milestones'::regclass), 'client_project_milestones has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.client_project_payments'::regclass), 'client_project_payments has RLS enabled');

select ok(not has_table_privilege('anon', 'public.client_accounts', 'SELECT'), 'anon cannot read client accounts');
select ok(not has_table_privilege('anon', 'public.client_projects', 'SELECT'), 'anon cannot read projects');
select ok(not has_table_privilege('anon', 'public.client_project_milestones', 'SELECT'), 'anon cannot read milestones');
select ok(not has_table_privilege('anon', 'public.client_project_payments', 'SELECT'), 'anon cannot read payments');

select ok(not has_table_privilege('authenticated', 'public.client_project_payments', 'UPDATE'), 'authenticated users cannot rewrite payments');
select ok(not has_table_privilege('authenticated', 'public.client_project_payments', 'DELETE'), 'authenticated users cannot delete payments');
select ok(not has_function_privilege('anon', 'public.sagt_void_client_project_payment(uuid,text)', 'EXECUTE'), 'anon cannot execute the payment void function');
select ok(has_function_privilege('authenticated', 'public.sagt_void_client_project_payment(uuid,text)', 'EXECUTE'), 'authenticated users reach the void function, which checks admin role internally');

select * from finish();
rollback;
