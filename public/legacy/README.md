# Invoice and survey editor pages

`invoice-editor.html` and `survey-editor.html` are opened inside the authenticated React workspace from their matching navigation modules. Their save messages are accepted only from the matching same-origin iframe, then stored as drafts in the existing `documents` table using the signed-in Supabase client and current row policies.

Use the React application at `/` to save drafts to Supabase. Opening either editor HTML by itself does not provide the React host’s cloud-save bridge. The older `index.html` workspace is retained for reference and still references a separate `supabase-config.js` that is not included in this package.

No database schema or permissions are changed by these static pages. Never place a service-role or secret key in this folder. Historical SQL is not stored here and must not be run as part of this frontend package.
