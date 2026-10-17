# SAGT - Verify React workspace

This React, TypeScript, and Vite application connects only to the existing **SAGT - Verify** Supabase project (`gewvwdfolaaipkpbqpmr`). The browser client rejects a different Supabase URL and rejects secret or service-role keys.

## Included workflows

- Sign in with an existing company account; role, active state, module view access, and edit access come from the existing profile.
- Attendance check-in and check-out through the existing server-time RPCs, plus correction requests and administrator decisions.
- Leave requests and administrator decisions through the existing decision RPC.
- Expense submissions, edits to the employee’s pending expenses, and administrator review. Receipt upload stays disabled because a private storage bucket and policies were not confirmed.
- Company holiday creation for authorized users. The React app does not delete holiday records.
- Administrator salary settings, payroll generation for the last completed month, and finalization after confirmation. Attendance is summarized as present, paid leave, absent/unpaid leave, Sunday, and configured holiday days. Employees see and can print only their own finalized payslips.
- Client, project, milestone, and payment tracking with contract/received/outstanding totals, append-only payment receipts, and reasoned administrator voids. This workflow needs the additive SQL setup in `docs/proposed-migrations/` before it can connect to Supabase.
- Invoice, quotation, and survey reports open the full A4 editors directly inside their React navigation modules. Debounced editor saves use the existing `documents` table; a user can reopen only their own draft. View-only users and finalized or other users’ records are not opened for editing. The React host checks the iframe origin/module and relies on the existing Supabase row policies for authorization.
- Employee invitation, activation state, and module permissions for administrators. Invitations and state changes use the existing `admin-employee-management` Edge Function, and the UI asks for confirmation before sending an invitation or changing access.

The inspected schema does not include a client/project payment table. The package now contains a proposed additive schema and UI for this module. The setup SQL is not in an auto-applied migrations folder and has not been run; until an owner reviews and installs it on staging, the module shows a clear setup message. Invoice and survey editing are now integrated; release/finalization controls are not added by this editor bridge.

## Local setup and checks

Follow [SETUP-GUIDE.md](SETUP-GUIDE.md) for Windows setup and safe configuration. Run:

```powershell
npm ci
npm run check
npm run build
```

`npm run check` runs TypeScript, ESLint, and the unit/security tests. `npm run build` creates a production bundle in `dist/`. Both local development and preview use `http://127.0.0.1:8080`; run only one at a time.

## Data and security boundaries

- Existing workflows use the existing tables and RPCs. The client/payment module uses four new tables and a void RPC only after the proposed setup is reviewed and applied by the project owner. Setup and build commands do not run this SQL or edit production records.
- Payroll's UI defaults to the previous completed month and blocks current/future month calculation and finalization. Sunday and company-holiday exclusions depend on the existing payroll RPC and dates entered in `company_holidays`; the deployed RPC itself has not been modified or reverified for direct calls.
- Supabase row-level security and the existing server-side functions remain the authorization boundary. The UI’s role checks are an additional guard, not a replacement for RLS.
- The React app reads the existing project URL and browser-safe key from `.env.local`. The retained `public/legacy/index.html` shell still references a separate `supabase-config.js` that is not included; use the React app navigation for the invoice and survey editors. No service-role or secret key belongs in this package.
- Do not include or send `.env.local`. It is ignored by Git and excluded from the release archive.
- Production deployment requires the deployed HTTPS origin to be added to the existing Auth redirect settings and the `SAGT_ALLOWED_ORIGINS` setting used by the employee-management Edge Function. The live function and project settings were not changed here.
- Do not apply the archived SQL reference files under `docs/legacy-sql-reference/`.

Read [PRODUCTION-READINESS-REPORT.md](PRODUCTION-READINESS-REPORT.md) before release. Automated local checks do not replace authenticated workflow checks, business approval of payroll rules, migration testing, or testing against a dedicated staging project.
