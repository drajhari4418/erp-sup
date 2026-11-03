js/supabase-adapter.js  maps each ERP module to its own  table
js/app.js             ERP logic: Sales Order > Work Order > Indent > PO > GRN > FG Receipt > Spectro > MTC > Dispatch > Invoice, stock, dashboard, user access
js/config.js           your Supabase URL + anon key (edit once)
js/auth.js            sign in / sign up
schema.sql            tables, stock_balance view, RLS, realtime, transaction log
transactions.sql      transaction log only (run this if you already ran an older schema.sql)
seed_sample.sql       optional sample data for testing
no_duplicates.sql     optional: database-level one-record-per-source rules
