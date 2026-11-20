-- Add admin approval for Supabase Auth users to an existing Foundry ERP database.
-- Run once in Supabase SQL Editor. Existing profiles keep their current access;
-- new signups wait for an administrator to approve them.

alter table public.profiles
  add column if not exists status text not null default 'approved',
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

alter table public.profiles alter column status set default 'pending';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_status_check check (status in ('pending','approved','rejected'));
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, full_name, email, role, status, approved_at)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    case when first_user then 'admin' else 'user' end,
    case when first_user then 'approved' else 'pending' end,
    case when first_user then now() else null end
  );
  return new;
end;
$$;

-- Refresh the function used by the existing auth.users trigger.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

