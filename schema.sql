-- Foundry ERP on Supabase: one table per module. Run once in SQL Editor.

-- ---------- Users ----------
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, email text,
  role text not null default 'user' check (role in ('admin','user'))
);
-- First person to sign up becomes admin.
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, role)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email,
          case when exists (select 1 from profiles) then 'user' else 'admin' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Per-module access: perms looks like {"so":"edit","wo":"view","dash":"view"}
create table module_access (
  user_id uuid primary key references profiles(id) on delete cascade,
  perms jsonb not null default '{}',
  label text
);
create table access_requests (
  user_id uuid primary key references profiles(id) on delete cascade,
  requested_at bigint
);

-- ---------- Sales ----------
create table sales_orders (
  id text primary key, customer text, pono text, item text,
  qty numeric(14,3) check (qty >= 0), date date, due date, status text,
  created_by uuid, created_at timestamptz default now()
);
-- ---------- Production ----------
create table work_orders (
  id text primary key, so text references sales_orders(id), item text,
  qty numeric(14,3) check (qty >= 0), start date, due date, status text,
  created_by uuid, created_at timestamptz default now()
);
-- ---------- Purchase ----------
create table indents (
  id text primary key, wo text references work_orders(id), item text,
  qty numeric(14,3) check (qty >= 0), req date, status text,
  created_by uuid, created_at timestamptz default now()
);
create table purchase_orders (
  id text primary key, ind text references indents(id), vendor text, item text,
  qty numeric(14,3) check (qty >= 0), rate numeric(14,2) check (rate >= 0), gst text, date date,
  created_by uuid, created_at timestamptz default now()
);
-- ---------- Stock ----------
create table grns (
  id text primary key, po text references purchase_orders(id), item text,
  qty numeric(14,3) check (qty >= 0), heat text, date date,
  created_by uuid, created_at timestamptz default now()
);
create table fg_receipts (
  id text primary key, wo text references work_orders(id), item text,
  qty numeric(14,3) check (qty >= 0), rej numeric(14,3) check (rej >= 0), date date,
  created_by uuid, created_at timestamptz default now()
);
-- ---------- Quality ----------
create table spectro_reports (
  id text primary key, wo text references work_orders(id), sample text, heat text, date date,
  comp jsonb,            -- [{"e":"C","min":"3.4","max":"3.8","ach":"3.6"}, ...]
  result text check (result in ('Pass','Fail','Pending')),
  created_by uuid, created_at timestamptz default now()
);
create table mtcs (
  id text primary key, wo text references work_orders(id), spectro text references spectro_reports(id),
  customer text, heat text, qty numeric(14,3) check (qty >= 0), date date,
  created_by uuid, created_at timestamptz default now()
);
-- ---------- Dispatch and accounts ----------
create table dispatch_notes (
  id text primary key, so text references sales_orders(id), item text,
  qty numeric(14,3) check (qty >= 0), date date, vehicle text, eway text,
  created_by uuid, created_at timestamptz default now()
);
create table invoices (
  id text primary key, dn text references dispatch_notes(id), customer text,
  amount numeric(14,2) check (amount >= 0), gst text, date date,
  created_by uuid, created_at timestamptz default now()
);

create index on work_orders (so);   create index on indents (wo);
create index on purchase_orders (ind); create index on grns (po);
create index on dispatch_notes (so);   create index on spectro_reports (wo);

-- Stock balance per item (GRN + finished goods in, dispatches out). Handy for reports.
create view stock_balance with (security_invoker = true) as
select item, sum(qty_in) as qty_in, sum(qty_out) as qty_out, sum(qty_in - qty_out) as balance from (
  select lower(trim(item)) as item, qty as qty_in, 0 as qty_out from grns
  union all select lower(trim(item)), qty, 0 from fg_receipts
  union all select lower(trim(item)), 0, qty from dispatch_notes) m
group by item;

-- ---------- Access helpers ----------
create function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
create function has_access() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from module_access where user_id = auth.uid()) $$;
create function mod_perm(k text) returns text language sql stable security definer set search_path = public as
$$ select perms->>k from module_access where user_id = auth.uid() $$;
create function can_edit_any() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from module_access m, jsonb_each_text(m.perms) e where m.user_id = auth.uid() and e.value = 'edit') $$;

-- ---------- Row Level Security ----------
alter table profiles enable row level security;
alter table module_access enable row level security;
alter table access_requests enable row level security;
create policy "read profiles" on profiles for select to authenticated using (true);
create policy "admin edits profiles" on profiles for update to authenticated using (is_admin()) with check (is_admin());
create policy "read own or all access" on module_access for select to authenticated using (is_admin() or user_id = auth.uid());
create policy "admin manages access" on module_access for all to authenticated using (is_admin()) with check (is_admin());
create policy "read own or all requests" on access_requests for select to authenticated using (is_admin() or user_id = auth.uid());
create policy "request own access" on access_requests for insert to authenticated with check (user_id = auth.uid());
create policy "admin clears requests" on access_requests for delete to authenticated using (is_admin());

-- Module tables: anyone with access can read; insert needs "edit" on that module;
-- update needs "edit" on any module (so linked statuses follow, e.g. GRN -> Indent); delete is admin only.
do $$ declare r record; begin
  for r in select * from (values
    ('sales_orders','so'),('work_orders','wo'),('indents','ind'),('purchase_orders','po'),('grns','grn'),
    ('fg_receipts','fgr'),('spectro_reports','spectro'),('mtcs','mtc'),('dispatch_notes','dn'),('invoices','inv')
  ) v(t,k) loop
    execute format('alter table %I enable row level security', r.t);
    execute format('create policy "read" on %I for select to authenticated using (is_admin() or has_access())', r.t);
    execute format('create policy "insert" on %I for insert to authenticated with check (is_admin() or mod_perm(%L) = ''edit'')', r.t, r.k);
    execute format('create policy "update" on %I for update to authenticated using (is_admin() or can_edit_any()) with check (is_admin() or can_edit_any())', r.t);
    execute format('create policy "delete" on %I for delete to authenticated using (is_admin())', r.t);
  end loop;
end $$;

-- ---------- Realtime ----------
do $$ declare t text; begin
  foreach t in array array['sales_orders','work_orders','indents','purchase_orders','grns','fg_receipts',
                           'spectro_reports','mtcs','dispatch_notes','invoices','module_access','access_requests'] loop
    execute format('alter table %I replica identity full', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;
