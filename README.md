# Foundry ERP - Supabase edition (HTML/CSS/JS)

index.html            page shell
css/style.css         styles (light/dark)
js/supabase-adapter.js  maps each ERP module to its own Supabase table
js/app.js             ERP logic: Sales Order > Work Order > Indent > PO > GRN > FG Receipt > Spectro > MTC > Dispatch > Invoice, stock, dashboard, user access
js/config.js           your Supabase URL + anon key (edit once)
js/auth.js            sign in / sign up
schema.sql            tables, stock_balance view, RLS, realtime, transaction log
transactions.sql      transaction log only (run this if you already ran an older schema.sql)
scale.sql             indexes, running stock totals, dashboard counts (run once)
seed_sample.sql       optional sample data for testing
no_duplicates.sql     optional: database-level one-record-per-source rules

Setup
1. Supabase > SQL Editor > run schema.sql
2. (Testing) Authentication > Providers > Email > turn off "Confirm email"
3. Open index.html (double-click works) or deploy the folder to any static host
4. Paste Project URL + anon key (Settings > API). The FIRST account you create is the admin.
5. Other people create accounts, then the admin grants module access in Users and access.

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
