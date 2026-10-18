create extension if not exists pgcrypto;

create table if not exists public.store_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 160),
  category text not null check (category in ('classic', 'sweet', 'savory')),
  price_inr integer not null check (price_inr > 0),
  emoji text not null default '🍌',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_name text not null,
  business_name text not null,
  email text not null,
  phone text not null,
  delivery_address text not null,
  items jsonb not null,
  total_inr integer not null check (total_inr > 0),
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

insert into public.products (name, description, category, price_inr, emoji) values
  ('Classic Golden', 'Lightly salted · 150 g', 'classic', 149, '🍌'),
  ('Honey Kissed', 'Drizzled with honey · 150 g', 'sweet', 169, '🍯'),
  ('Chilli Lime', 'Zingy & crisp · 150 g', 'savory', 159, '🌶️'),
  ('Sea Salt Crunch', 'Simple & savory · 150 g', 'savory', 149, '🧂');

alter table public.store_admins enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

drop policy if exists "Signed-in owner can see own admin record" on public.store_admins;
create policy "Signed-in owner can see own admin record" on public.store_admins
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Anyone can see active products" on public.products;
create policy "Anyone can see active products" on public.products
  for select to anon, authenticated using (active);

drop policy if exists "Owner can see hidden products" on public.products;
create policy "Owner can see hidden products" on public.products
  for select to authenticated using (exists (
    select 1 from public.store_admins a where a.user_id = (select auth.uid())
  ));

drop policy if exists "Owner manages products" on public.products;
create policy "Owner manages products" on public.products
  for all to authenticated using (exists (
    select 1 from public.store_admins a where a.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.store_admins a where a.user_id = (select auth.uid())
  ));

drop policy if exists "Owner can read and update orders" on public.orders;
create policy "Owner can read and update orders" on public.orders
  for all to authenticated using (exists (
    select 1 from public.store_admins a where a.user_id = (select auth.uid())
  )) with check (exists (
    select 1 from public.store_admins a where a.user_id = (select auth.uid())
  ));

grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.store_admins to authenticated;
grant select, update on public.orders to authenticated;
-- Public order submission is handled only by the Edge Function (service role).
revoke insert, delete on public.orders from anon, authenticated;

-- Add your owner account to store_admins after creating it in Authentication → Users.
-- Replace the email below, then run this separately in SQL Editor:
-- insert into public.store_admins (user_id)
-- select id from auth.users where email = 'YOUR-OWNER-EMAIL' on conflict do nothing;
