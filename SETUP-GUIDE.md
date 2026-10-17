# SAGT - Verify: setup guide

These steps run the revised application locally. They do not change Supabase tables, records, policies, or permissions.

## 1. Install Node.js

Install Node.js 24 or newer from [nodejs.org](https://nodejs.org/en/download). Open a new PowerShell window and check that `node --version` and `npm --version` both show a version.

## 2. Configure the existing project

In the project folder, copy `.env.example` to `.env.local`. Open `.env.local` and replace the placeholder with the existing SAGT - Verify **publishable key**. Keep the supplied project URL unchanged.

Never use a `service_role` or `sb_secret` key in a browser application. Publishable keys are intended to be visible in browser code; database access must remain protected by the project's existing row-level security policies. Do not send `.env.local` to anyone or include it in the ZIP.

## 3. Install the locked packages

Open PowerShell in the project folder and run:

```powershell
npm ci
```

## 4. Start the local application

```powershell
npm run dev
```

Open `http://127.0.0.1:8080` in your browser. The project uses this port to match the existing local origin allowlist for the employee-management Edge Function. Sign in with an existing company account. Press **Ctrl+C** in PowerShell to stop the app.

To preview the production bundle instead, stop the dev server, run `npm run build`, then `npm run preview` and open `http://127.0.0.1:8080`. Development and preview share port 8080, so run only one at a time.

## 5. Run local checks

```powershell
npm run check
npm run build
npm audit
```

The check command runs TypeScript, ESLint, and unit/security tests. The build command creates `dist/`. The audit command checks the locked package tree against the registry at the time it runs.

## 6. Before deploying

Ask the Supabase project owner to add the exact deployed HTTPS application origin to the existing Auth URL/redirect configuration and to `SAGT_ALLOWED_ORIGINS` for the deployed `admin-employee-management` function. Invitation, deactivation, and reactivation depend on that function. No production Supabase settings were changed by this package.

Have the business owner review payroll inputs and calculations, and test with designated administrator and employee accounts against a staging project or an approved test plan. Do not test payroll finalization, invitation, permission changes, or employee activation against live production data as a substitute for staging checks.

### Enable Clients & Payments

This module needs a database because the existing SAGT - Verify schema had no client/project payments tables. The proposed, additive setup is in `docs/proposed-migrations/20261017120000_client_project_payments.sql`. It creates client, project, milestone, and payment tables with row-level access checks; posted payments cannot be deleted, and administrators can void them with a reason.

The setup file is deliberately not auto-applied and was not run on the live project. The Supabase CLI is not included in this package. Have the project owner review the file, apply it to a dedicated staging project with the existing SAGT permission helpers, run the structural checks in `docs/proposed-migrations/client_project_payments_rls.test.sql`, and verify signed-in allow/deny and data round trips before considering any production deployment. Do not run it against `sagt-bms`. The React module reports when its database setup is missing.

After an approved staging migration is applied, regenerate `src/lib/database.types.ts` from that staging project and rerun `npm run check` and `npm run build`.

Do not apply SQL files from `docs/legacy-sql-reference/`; they are historical references, not deployment instructions.
