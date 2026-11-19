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
- The Request access button emails the configured administrator. When an administrator grants a user module access, that user receives an approval email.
- Email is sent by the `supabase/functions/access-email` Edge Function through Resend. Create a Resend API key and verify the sender domain/address first.
- From this project folder, link the Supabase project and deploy the function with the Supabase CLI:
  `supabase link --project-ref YOUR_PROJECT_REF`
  `supabase functions deploy access-email`
- Configure the function secrets (use a verified Resend sender address):
  `supabase secrets set RESEND_API_KEY=re_... ADMIN_NOTIFICATION_EMAIL=admin@example.com RESEND_FROM_EMAIL="Foundry ERP <erp@example.com>" APP_URL=https://your-app.example.com`
- The Supabase project URL and service role key are provided to the Edge Function by Supabase. Do not put the Resend key or service role key in the browser app.
- The request notification goes to `ADMIN_NOTIFICATION_EMAIL`; approval notices go to the email on the user's profile.

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
