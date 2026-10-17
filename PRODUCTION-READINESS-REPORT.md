# SAGT - Verify React migration: production-readiness report

**Assessment date:** 17 October 2026  
**Supabase target:** SAGT - Verify (`gewvwdfolaaipkpbqpmr`)  
**Release decision:** **Not certified production-ready**

## Attendance and payroll changes in this revision

- Attendance tracking now loads month-scoped records directly. Employees see their own history; administrators see team records permitted by the database. Attendance totals distinguish present equivalents, completed shifts, open check-outs, explicit absent statuses, and invalid rows. Missing records do not become absences in this screen.
- Administrator attendance and correction tables now resolve employee IDs to profile full names. The lookup requests only employee IDs and names and runs only for active administrators; employee views continue to show only their own records.
- Attendance status and shift completeness are separate: a `present` record counts as one present equivalent even when the employee has not checked out; the open shift is also flagged for review. A `half_day` counts as 0.5.
- Employees need an active profile plus attendance navigation, view, and edit access to clock in/out or submit a correction. Active employees with view-only access can read their own history but cannot submit. The admin interface is review-only for attendance: it has no clock controls or correction-request form and shows pending correction approvals.
- Correction inputs now reject future India-local dates and future times for the current India-local date. This is a browser-side validation; the proposed staging SQL adds the corresponding database checks.
- Payroll day summaries count attendance, leave, and absence only for saved `working` days. Sundays and configured holidays are counted separately and do not inflate working-day present totals. Repeated user/date rows are omitted from summaries. Payroll still reads the saved `payroll_daily` ledger produced by the existing generation RPC; the JavaScript summary does not replace or recalculate payroll amounts.
- Admin navigation retains the workspace modules except Invoices and Survey Reports. Admin leave and attendance forms remain hidden; admins can decide pending leave and attendance corrections. Employee navigation remains profile-controlled.
- Previous work remains included: the full-screen invoice/survey editors, brand artwork, client/project/payment UI, payslip views, payroll month guards, and corresponding local security/validation tests.

## Role and permission review

| Profile | Current React behavior | Live database behavior observed read-only | Target after staging script is reviewed and installed |
|---|---|---|---|
| Active administrator | Team attendance and pending corrections visible; approve/reject only; no clock, correction-request, or leave-request form | Existing attendance RPCs are `SECURITY DEFINER` and the shared edit helper treats active admins as allowed, so direct API calls can bypass the hidden controls. Existing insert policies can also accept admin leave/correction requests through the helper's admin bypass. | Keep team review and decision RPCs; deny direct admin punches and request inserts |
| Active employee with attendance navigation + view, no edit | Own history visible; no clock or correction form | Existing select policies permit self access without the same navigation/view checks | Restrict reads to own records only when navigation/view access is enabled |
| Active employee with attendance navigation + view + edit | Own history, clock controls, and correction form | Existing check-in/out RPCs enforce module edit permission but do not require the employee role or navigation flag | Permit employee clock and correction actions only when all three permissions are enabled |
| Inactive profile, missing navigation, or missing view | Attendance module/data hidden by the React permission checks | The inspected read policies do not consistently apply these UI permissions | Deny attendance reads and writes through RLS/RPC checks |

The UI permission tests pass, but they do **not** prove live RLS or RPC enforcement. The last column is the proposed staging behavior, not a claim about the deployed database.

## Backend review and database boundary

The live project was inspected read-only and only for project ref `gewvwdfolaaipkpbqpmr`. The observed policies and function definitions reveal a gap between the UI and backend permissions: hidden admin controls do not prevent direct RPC or table API calls. The existing correction decision RPC also merges requested times without validating the final merged timeline, and does not reliably set the attendance status after approval.

A staging-only review script is included at `docs/proposed-staging/attendance-role-security.sql`. It tightens attendance/leave read and insert policies, limits clock RPCs to active employees with explicit attendance permissions, and validates approved correction timelines. It is separate from automatic migrations, was **not executed**, and must be reviewed and tested on a disposable staging clone before an owner-approved release. No live schema, data, permissions, RPCs, settings, or payroll records were changed. The `sagt-bms` project was not used.

The payroll-generation/finalization RPC body was not changed or fully validated in this pass. The supplied legacy SQL describes the intended calendar rules (Sundays and configured company holidays excluded, incomplete attendance held for review), but the deployed RPC must be tested against the staging clone before those rules are relied on. Do not infer regional or national holidays; only configured `company_holidays` can be applied.

## Local validation

| Check | Result | Evidence / limit |
|---|---|---|
| TypeScript | Pass | `npm run typecheck` within final `npm run check` |
| ESLint | Pass | `npm run lint` within final `npm run check` |
| Unit/security tests | Pass | 20 passed, 0 failed; includes role capabilities, employee-name mapping, month-scoped attendance calculations, correction date/time validation, working-day vs holiday/Sunday payroll totals, deduplication, navigation, and Supabase project/key boundaries |
| Production build | Pass | `npm run build`; Vite emitted the production bundle |
| Sensitive credential-pattern scan | Pass, scoped | No candidate service-role keys, secret keys, or JWTs found in app source, public text assets, or proposed staging SQL; `.env` files were excluded from the scan and package |
| Dependency audit | Blocked | `npm audit --omit=dev` could not reach `registry.npmjs.org` because DNS/network access was unavailable; no current vulnerability result is claimed |
| Attendance RLS/RPC runtime tests | Not run | No staging database was supplied; live inspection was read-only |
| Proposed SQL execution/validation | Not run | Supabase CLI/PostgreSQL staging validation was unavailable; the file is a review proposal, not a verified migration |
| Authenticated browser workflows | Not run | Skipped under the user's instruction to omit real browser tests |
| Production deployment/origin checks | Not run | No hosting provider or production domain was supplied |

## Recommended release checks

1. Review `docs/proposed-staging/attendance-role-security.sql` with the project owner and apply it only to a disposable clone of the exact SAGT - Verify schema.
2. Test active admin, inactive admin, active employee with view-only access, active employee with edit access, and employee with navigation disabled. Verify row-level reads and direct RPC/API denial as well as the visible controls.
3. Test duplicate check-in/out, server India-local date boundaries, future correction times, missed check-in/out combinations, invalid merged timestamps, and approve/reject behavior. Confirm incomplete days remain pending and approved completed corrections update the attendance record exactly once.
4. Generate sample payroll for weekdays, Sundays, configured holidays, half days, paid/unpaid leave, no attendance, open shifts, and pending corrections. Reconcile `payroll_daily` totals against monthly payable days and finalized payslips; get business approval for divisor, rounding, overtime, deductions, and leave rules.
5. Run a fresh dependency audit when registry access is available, then complete the app's remaining authenticated staging checks and deployment-origin configuration.

This package is a tested local revision, **not a production certification**. Do not apply historical files under `docs/legacy-sql-reference/`.
