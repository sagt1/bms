# SAGT - Verify Retest Report — 17 October 2026

## Scope and project boundary
- Target: Supabase project **SAGT - Verify**, ref `gewvwdfolaaipkpbqpmr`.
- Separate project `sagt-bms` was not accessed or modified.
- No service-role keys, passwords, or session tokens are included.

## Confirmed checks
- Supabase project status: `ACTIVE_HEALTHY`; PostgreSQL 17.11.
- Migrations registered through `011_fk_index_and_policy_optimization`.
- RLS enabled on 11 public tables reviewed: attendance corrections/records, company holidays, documents, employee admin audit, employee pay settings, expenses, leave, daily payroll, monthly payroll, and profiles.
- Employee authorization simulation previously confirmed: admin-only payroll generation/finalization and salary-setting writes reject an employee claim; simulated cross-employee reads returned zero rows for attendance, leave, payroll, and pay settings.
- Employee pay settings direct SELECT policy is admin-only.
- Edge Function `admin-employee-management` is active (version 2), validates the caller token and checks active admin profile in its own code. `verify_jwt=false` means the function relies on this explicit application-level validation; real browser/session verification remains required.

## Refinements applied live
- Added indexes for seven foreign-key columns previously reported by the performance advisor.
- Split `company_holidays` and `employee_pay_settings` admin `FOR ALL` policies into explicit INSERT, UPDATE, and DELETE policies. This removes the overlapping SELECT-policy warnings without widening read access.
- Migration source is included as `011_fk_index_and_policy_optimization.sql`.

## Current advisor results after refinement
- Security: 9 warnings remain for authenticated execution of SECURITY DEFINER functions. These are application RPC/helper functions; do not revoke execution blindly. Their authorization checks were reviewed, but a real browser-session test is still required. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Supabase Auth leaked-password protection warning remains; excluded from this remediation scope as previously requested.
- Performance: the 7 unindexed-FK findings and the 2 multiple-permissive-policy findings no longer appear. The advisor reports 14 unused indexes, which are informational on a small/mostly empty dataset; do not remove them until production query patterns are observed. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

## Not yet verified / production blockers
- No real admin or employee browser login/session was available in this run.
- UI end-to-end workflows, responsive behavior on Android/iPhone/Windows, actual attendance check-in/out, leave approval, expense submission/receipt upload, employee invitation/deactivation, and payroll generation/finalization were not browser-tested.
- No load test, uptime/restore drill, mail-delivery test, or backup restoration test was performed.
- The included application source is a static HTML/JS application (`index.html`, `invoice-editor.html`, `survey-editor.html`), not the requested React + TypeScript + Tailwind + shadcn/ui/Vite stack. Do not treat this archive as proof of a full React ERP implementation.
- Expense receipt paths exist in the schema, but private Storage bucket/policies and real upload flow need verification before production use.
- `expense_records` currently has admin review in its RLS workflow; a distinct Team Lead review role/workflow is not confirmed by current `profiles` roles/policies.
- Payroll formula behavior needs domain validation against the agreed rules (full-day 8 net hours, half-day 4 net hours, 60-minute break, overtime threshold and rounding, holidays, monthly fixed salary, partial month, leave, advances). Do not finalize real payroll until tested with approved test cases.

## Release recommendation
**Not yet production-certified.** Database access boundaries and indexes improved, but release remains conditional on browser end-to-end testing, storage setup, payroll test cases, mail checks, backup/restore proof, and a deployment smoke test. Never use real payroll finalization for testing.


## Follow-up: expense and holidays UI

- Flat Expense, Office Expense, and Holidays placeholders were replaced with database-backed UI workflows in the revised package.
- Applied migration `012_expense_record_confidentiality` to limit expense SELECT to the submitting user or an administrator.
- Added a report documenting the three permission levels: Show (`nav_*`), Track (`can_view_*`), and Modify/Edit (`can_edit_*`).
- Inline JavaScript syntax check passed. Real browser workflows and private receipt storage remain unverified / incomplete; see `EXPENSE-HOLIDAYS-IMPLEMENTATION-REPORT.md`.
