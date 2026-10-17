-- SAGT - Verify follow-up security hardening. Run only after reviewing in the correct project.
begin;

-- This maintenance helper must never be callable through the public PostgREST RPC surface.
-- The DO block tolerates installations where it is absent.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Bootstrap was already completed for shreeaditya2025@gmail.com. Prevent further browser RPC calls.
-- A postgres owner can still administer profiles through controlled SQL migrations.
revoke all on function public.bootstrap_initial_admin() from public, anon, authenticated;

-- Add indexes to cover foreign keys identified by Supabase Performance Advisor.
create index if not exists documents_updated_by_idx on public.documents(updated_by);
create index if not exists employee_admin_audit_actor_id_idx on public.employee_admin_audit(actor_id);
create index if not exists employee_admin_audit_target_user_id_idx on public.employee_admin_audit(target_user_id);

-- Ensure browser callers cannot invoke the Auth profile trigger function directly.
revoke all on function public.sagt_create_profile_for_auth_user() from public, anon, authenticated;

-- Keep the RLS helper functions executable by authenticated users because the RLS policies
-- call them. Their definitions must continue to use auth.uid(), fixed empty search_path,
-- and fully-qualified public table references. Do not grant these functions to anon.
revoke all on function public.sagt_is_admin() from public, anon;
revoke all on function public.sagt_can_access_module(text, boolean) from public, anon;
grant execute on function public.sagt_is_admin() to authenticated;
grant execute on function public.sagt_can_access_module(text, boolean) to authenticated;

commit;
