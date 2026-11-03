-- Scale-up script: run ONCE in Supabase SQL Editor (after schema.sql and transactions.sql).
-- Makes the app fast with large data: indexes, running stock totals, dashboard counts.

-- 1) Indexes: newest-first lists, status counts, links between documents
do $$ declare t text; begin
  foreach t in array array['sales_orders','work_orders','indents','purchase_orders','grns',
                           'fg_receipts','spectro_reports','mtcs','dispatch_notes','invoices'] loop
    execute format('create index if not exists %I on %I (created_at desc, id desc)', 'ix_'||t||'_created', t);
  end loop;
end $$;
create index if not exists ix_so_status on sales_orders (status);
create index if not exists ix_wo_status on work_orders (status);
create index if not exists ix_ind_status on indents (status);
create index if not exists ix_fgr_wo on fg_receipts (wo);
create index if not exists ix_mtc_wo on mtcs (wo);
create index if not exists ix_mtc_spectro on mtcs (spectro);
create index if not exists ix_inv_dn on invoices (dn);
create index if not exists ix_grn_po on grns (po);
create index if not exists ix_dn_so on dispatch_notes (so);

-- 2) Fast search boxes (matches anywhere in the text)
create extension if not exists pg_trgm;
do $$ declare p text; t text; c text; begin
  foreach p in array array[
    'sales_orders.id','sales_orders.customer','sales_orders.pono','sales_orders.item',
    'work_orders.id','work_orders.so','work_orders.item','indents.id','indents.item',
    'purchase_orders.id','purchase_orders.vendor','purchase_orders.item',
    'grns.id','grns.item','grns.heat','fg_receipts.id','fg_receipts.item',
    'spectro_reports.id','spectro_reports.heat','spectro_reports.sample',
    'mtcs.id','mtcs.customer','mtcs.heat','dispatch_notes.id','dispatch_notes.item','dispatch_notes.vehicle',
    'invoices.id','invoices.customer'] loop
    t := split_part(p,'.',1); c := split_part(p,'.',2);
    execute format('create index if not exists %I on %I using gin (%I gin_trgm_ops)', 'tg_'||t||'_'||c, t, c);
  end loop;
end $$;

-- 3) Running stock totals (updated by triggers, so Stock never has to add up thousands of rows)
create table if not exists stock_levels (
  item_key text primary key,
  label text not null,
  qty_in numeric(18,3) not null default 0,
  qty_out numeric(18,3) not null default 0
);
create or replace function bump_stock(p_item text, p_in numeric, p_out numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_item is null or trim(p_item) = '' then return; end if;
  insert into stock_levels (item_key, label, qty_in, qty_out) values (lower(trim(p_item)), trim(p_item), p_in, p_out)
  on conflict (item_key) do update set qty_in = stock_levels.qty_in + excluded.qty_in, qty_out = stock_levels.qty_out + excluded.qty_out;
end $$;
create or replace function stock_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_out boolean := (TG_TABLE_NAME = 'dispatch_notes');
begin
  if TG_OP in ('UPDATE','DELETE') then
    perform bump_stock(old.item, case when is_out then 0 else -coalesce(old.qty,0) end, case when is_out then -coalesce(old.qty,0) else 0 end);
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    perform bump_stock(new.item, case when is_out then 0 else coalesce(new.qty,0) end, case when is_out then coalesce(new.qty,0) else 0 end);
  end if;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['grns','fg_receipts','dispatch_notes'] loop
    execute format('drop trigger if exists trg_stock on %I', t);
    execute format('create trigger trg_stock after insert or update or delete on %I for each row execute function stock_trigger()', t);
  end loop;
end $$;
-- Fill from existing data
truncate stock_levels;
insert into stock_levels (item_key, label, qty_in, qty_out)
select lower(trim(item)), min(trim(item)), sum(qin), sum(qout) from (
  select item, qty as qin, 0::numeric as qout from grns
  union all select item, qty, 0 from fg_receipts
  union all select item, 0, qty from dispatch_notes) m
where item is not null and trim(item) <> '' group by lower(trim(item));
alter table stock_levels enable row level security;
drop policy if exists "read stock" on stock_levels;
create policy "read stock" on stock_levels for select to authenticated using (is_admin() or has_access());
drop view if exists stock_balance;
create view stock_balance with (security_invoker = true) as
  select label as item, qty_in, qty_out, qty_in - qty_out as balance from stock_levels;

-- 4) Dashboard numbers computed in the database (one tiny reply instead of every record)
create or replace function dashboard_stats() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'wo_total',  (select count(*) from work_orders),
    'wo_by_status', coalesce((select jsonb_object_agg(s, c) from (select coalesce(status,'') s, count(*) c from work_orders group by 1) x), '{}'::jsonb),
    'so_open',   (select count(*) from sales_orders where status is distinct from 'Closed'),
    'sp_total',  (select count(*) from spectro_reports),
    'sp_pass',   (select count(*) from spectro_reports where result = 'Pass'),
    'sp_fail',   (select count(*) from spectro_reports where result = 'Fail'),
    'mtc_total', (select count(*) from mtcs)) $$;

-- 5) Optional housekeeping: keep the transaction log from growing forever.
--    Example: select prune_transactions(365);  -- deletes log entries older than a year (admin only)
create or replace function prune_transactions(p_days int) returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from transactions where created_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count; return n;
end $$;
