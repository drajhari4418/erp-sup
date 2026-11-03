-- Optional hard guarantee: the database itself refuses a second record for the same source.
-- Step 1: look for existing duplicates (must return no rows before step 2 will work).
select 'work_orders' t, so k, count(*) from work_orders where so is not null group by so having count(*) > 1
union all select 'spectro_reports', wo, count(*) from spectro_reports where wo is not null group by wo having count(*) > 1
union all select 'mtcs', spectro, count(*) from mtcs where spectro is not null group by spectro having count(*) > 1
union all select 'purchase_orders', ind, count(*) from purchase_orders where ind is not null group by ind having count(*) > 1
union all select 'grns', po, count(*) from grns where po is not null group by po having count(*) > 1
union all select 'invoices', dn, count(*) from invoices where dn is not null group by dn having count(*) > 1;

-- Step 2: add the rules.
create unique index if not exists uq_work_orders_so on work_orders (so);
create unique index if not exists uq_spectro_wo on spectro_reports (wo);
create unique index if not exists uq_mtc_spectro on mtcs (spectro);
create unique index if not exists uq_po_ind on purchase_orders (ind);
create unique index if not exists uq_grn_po on grns (po);
create unique index if not exists uq_invoice_dn on invoices (dn);
-- Dispatch Notes, Indents and FG Receipts are left open on purpose (part dispatches, several materials, several batches).
