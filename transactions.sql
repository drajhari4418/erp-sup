-- Live transaction log: every create / update / delete on any ERP module is recorded automatically.
-- Safe to run on an existing project (run once in SQL Editor).

create table if not exists transactions (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_time_idx on transactions (created_at desc);
create index if not exists transactions_rec_idx on transactions (table_name, record_id);

create or replace function log_transaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select coalesce(full_name, email) into nm from profiles where id = auth.uid();
  if TG_OP = 'DELETE' then
    insert into transactions (table_name, record_id, action, old_data, changed_by, changed_by_name)
    values (TG_TABLE_NAME, old.id, 'DELETE', to_jsonb(old), auth.uid(), nm);
    return old;
  elsif TG_OP = 'UPDATE' then
    if to_jsonb(new) = to_jsonb(old) then return new; end if;
    insert into transactions (table_name, record_id, action, old_data, new_data, changed_by, changed_by_name)
    values (TG_TABLE_NAME, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), auth.uid(), nm);
    return new;
  else
    insert into transactions (table_name, record_id, action, new_data, changed_by, changed_by_name)
    values (TG_TABLE_NAME, new.id, 'INSERT', to_jsonb(new), auth.uid(), nm);
    return new;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['sales_orders','work_orders','indents','purchase_orders','grns',
                           'fg_receipts','spectro_reports','mtcs','dispatch_notes','invoices'] loop
    execute format('drop trigger if exists trg_log_transaction on %I', t);
    execute format('create trigger trg_log_transaction after insert or update or delete on %I for each row execute function log_transaction()', t);
  end loop;
end $$;

-- Read-only for users: they can see the log but never edit it (no insert/update/delete policies).
alter table transactions enable row level security;
drop policy if exists "read transactions" on transactions;
create policy "read transactions" on transactions for select to authenticated using (is_admin() or has_access());

alter publication supabase_realtime add table transactions;
