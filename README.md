css/style.css         styles (light/dark)
js/supabase-adapter.js  maps each ERP module to its own Supabase table
js/app.js             ERP logic: Sales Order > Work Order > Indent > PO > GRN > FG Receipt > Spectro > MTC > Dispatch > Invoice, stock, dashboard, user access
js/config.js           your Supabase URL + anon key (edit once)
js/auth.js            sign in / sign up
schema.sql            tables, stock_balance view, RLS, realtime, transaction log
transactions.sql      transaction log only (run this if you already ran an older schema.sql)
scale.sql             indexes, running stock totals, dashboard counts (run once)

Setup
1. (Testing) Authentication > Providers > Email > turn off "Confirm email"
2. Open index.html (double-click works) or deploy the folder to any static host
3. Paste Project URL + anon key (Settings > API). The FIRST account you create is the admin.
4. Other people create accounts, then the admin grants module access in Users and access.

Access email notifications
- The Request access button emails the address(es) on ERP profiles with the `admin` role. When an administrator grants a user module access, that user receives an approval email.
- Email is sent by the `supabase/functions/access-email` Edge Function through the Gmail API. It sends from the Gmail account authorized with Google OAuth; no custom domain is needed.
- In Google Cloud Console, create a project, enable the Gmail API, configure the OAuth consent screen, and create an OAuth client. Add the OAuth Playground redirect URI (`https://developers.google.com/oauthplayground`) to the client. If the consent screen is in Testing mode, add the Gmail sender account as a test user.
- In OAuth Playground settings, enable "Use your own OAuth credentials" and enter the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/gmail.send` while signed into the Gmail account that should send the mail, exchange the code, and copy the returned refresh token.
- Add these secrets in Supabase Edge Functions > Secrets (or use the CLI below): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_SENDER_EMAIL` (the same Gmail account authorized above). Keep all OAuth values private and only in Supabase secrets.
- Google OAuth apps left in Testing mode can have refresh tokens that expire after seven days. For ongoing use, publish the OAuth app and complete any Google verification requirements shown for the Gmail send scope.
- From this project folder, link the Supabase project and deploy the function with the Supabase CLI:
  `supabase link --project-ref YOUR_PROJECT_REF`
  `supabase functions deploy access-email`
- Configure the function secrets:
  `supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... GOOGLE_SENDER_EMAIL=you@gmail.com APP_URL=https://erp-sup.vercel.app`
- The Supabase project URL and service role key are provided to the Edge Function by Supabase. Do not put Google OAuth values or the service role key in the browser app.
- The request notification goes to the email on each ERP admin profile; approval notices go to the email on the approved user's profile. `GOOGLE_SENDER_EMAIL` must match the Gmail account authorized for Gmail API sending.
- `ADMIN_NOTIFICATION_EMAIL` is no longer needed; the function reads admin recipients from `profiles`.

Forgot password
- Login screen > "Forgot password?" emails a reset link. This needs the app hosted on a web address (not opened from a file).
- In Supabase > Authentication > URL Configuration set Site URL to your app link and add it under Redirect URLs.
- Admin shortcut: Supabase > Authentication > Users > open the user > "Send password recovery", or set a new password there.

Performance / scale (run scale.sql ONCE after the other SQL files)
- Lists load 25 records per page with Previous / Next and a search box; search runs in the database.
- Stock totals and dashboard counts are computed by the database (triggers + dashboard_stats()), not by the browser.
- Reference fields (Work Order, Sales Order...) are type-ahead boxes that query the database as you type.
- Realtime changes refresh only the page you are looking at, and forms are never reset while you type.
- Transactions shows the latest 100 with "Show more". Optional: select prune_transactions(365); deletes log entries older than a year.


Deleted records (run deleted_records.sql once)
- Admins get a Delete button on every row and inside each record. It asks for a reason first.
- Every delete is copied by the database into deleted_record_entries (record, who, when, why), even deletes made from the SQL Editor.
- Menu > Admin > Deleted records lists them, and Restore puts a record back exactly as it was (stock totals follow).
- A record that other records depend on cannot be deleted until those are deleted first.
