-- Expiry Monitor schema (apply in Supabase SQL Editor)
create extension if not exists pgcrypto;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete restrict,
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_code text not null unique,
  display_name text not null,
  role text not null check (role in ('super_admin','area_manager','store_user')),
  area_id uuid references public.areas(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profile_role_scope check (
    (role='super_admin' and area_id is null and store_id is null) or
    (role='area_manager' and area_id is not null and store_id is null) or
    (role='store_user' and store_id is not null)
  )
);

create table if not exists public.product_catalog (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category text not null check (category in ('Milk','Pastry','Premade','Cloud','Chemical','Tea','Powder','Syrup')),
  name text not null,
  default_unit text not null default 'pcs',
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(store_id, category, name),
  unique(id, store_id)
);

create table if not exists public.monitored_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  master_product_id uuid not null references public.product_catalog(id) on delete restrict,
  qty numeric(12,3) not null check (qty > 0),
  unit text not null default 'pcs',
  location text,
  expires_at timestamptz not null,
  warning_minutes integer not null default 5 check (warning_minutes between 1 and 1440),
  note text,
  status text not null default 'active' check (status in ('active','used','waste')),
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint product_catalog_same_store foreign key (master_product_id, store_id)
    references public.product_catalog(id, store_id) deferrable initially immediate
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  monitored_product_id uuid references public.monitored_products(id) on delete set null,
  product_name text not null,
  category text,
  qty numeric(12,3) not null check (qty > 0),
  unit text not null,
  disposition text not null check (disposition in ('used','waste')),
  acted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists stores_area_idx on public.stores(area_id);
create index if not exists products_store_expiry_idx on public.monitored_products(store_id, expires_at);
create index if not exists transactions_store_created_idx on public.transactions(store_id, created_at desc);
create index if not exists catalog_store_category_idx on public.product_catalog(store_id, category);

create or replace function public.my_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and active=true limit 1 $$;

create or replace function public.my_store_id()
returns uuid language sql stable security definer set search_path=public
as $$ select store_id from public.profiles where id=auth.uid() and active=true limit 1 $$;

create or replace function public.my_area_id()
returns uuid language sql stable security definer set search_path=public
as $$ select area_id from public.profiles where id=auth.uid() and active=true limit 1 $$;

create or replace function public.can_access_store(target_store uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.profiles p
    join public.stores s on s.id=target_store
    where p.id=auth.uid() and p.active=true and
      (p.role='super_admin' or (p.role='area_manager' and p.area_id=s.area_id) or (p.role='store_user' and p.store_id=s.id))
  )
$$;

alter table public.areas enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.product_catalog enable row level security;
alter table public.monitored_products enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "areas visible by scope" on public.areas;
create policy "areas visible by scope" on public.areas for select to authenticated
using (public.my_role()='super_admin' or id=public.my_area_id());

drop policy if exists "stores visible by scope" on public.stores;
create policy "stores visible by scope" on public.stores for select to authenticated
using (public.can_access_store(id));

drop policy if exists "profiles visible by scope" on public.profiles;
create policy "profiles visible by scope" on public.profiles for select to authenticated
using (id=auth.uid() or public.my_role()='super_admin' or (public.my_role()='area_manager' and area_id=public.my_area_id()));

drop policy if exists "catalog select scope" on public.product_catalog;
create policy "catalog select scope" on public.product_catalog for select to authenticated
using (public.can_access_store(store_id));
drop policy if exists "catalog insert store scope" on public.product_catalog;
create policy "catalog insert store scope" on public.product_catalog for insert to authenticated
with check (public.my_role()='store_user' and store_id=public.my_store_id() and created_by=auth.uid());
drop policy if exists "catalog update scope" on public.product_catalog;
create policy "catalog update scope" on public.product_catalog for update to authenticated
using (public.can_access_store(store_id) and (public.my_role()='store_user' or public.my_role()='super_admin' or public.my_role()='area_manager'))
with check (public.can_access_store(store_id));

drop policy if exists "monitored select scope" on public.monitored_products;
create policy "monitored select scope" on public.monitored_products for select to authenticated
using (public.can_access_store(store_id));
drop policy if exists "monitored insert scope" on public.monitored_products;
create policy "monitored insert scope" on public.monitored_products for insert to authenticated
with check (public.my_role()='store_user' and store_id=public.my_store_id() and created_by=auth.uid());
drop policy if exists "monitored update scope" on public.monitored_products;
create policy "monitored update scope" on public.monitored_products for update to authenticated
using (public.can_access_store(store_id))
with check (public.can_access_store(store_id));

drop policy if exists "transactions select scope" on public.transactions;
create policy "transactions select scope" on public.transactions for select to authenticated
using (public.can_access_store(store_id));
drop policy if exists "transactions insert scope" on public.transactions;
create policy "transactions insert scope" on public.transactions for insert to authenticated
with check (public.can_access_store(store_id) and acted_by=auth.uid() and public.my_role() in ('store_user','area_manager','super_admin'));

-- Keep the master product's store scope consistent with its monitored record.
create or replace function public.check_master_product_store()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.product_catalog c where c.id=new.master_product_id and c.store_id=new.store_id and c.active=true) then
    raise exception 'Master product must belong to the same store and be active';
  end if;
  return new;
end $$;
drop trigger if exists trg_check_master_product_store on public.monitored_products;
create trigger trg_check_master_product_store before insert or update of master_product_id,store_id on public.monitored_products
for each row execute function public.check_master_product_store();

-- Add tables to Realtime publication (ignore if already included).
do $$ begin
  alter publication supabase_realtime add table public.product_catalog;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.monitored_products;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.transactions;
exception when duplicate_object then null; when undefined_object then null; end $$;
