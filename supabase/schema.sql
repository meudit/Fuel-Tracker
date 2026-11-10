-- FuelTrack database schema for Supabase / PostgreSQL
-- Run the complete script once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  model text,
  registration_number text,
  vehicle_type text not null default 'Other'
    check (vehicle_type in ('Car', 'Bike', 'Scooter', 'Other')),
  photo_paths jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  fill_date date not null,
  fuel_price numeric(10, 2) not null check (fuel_price > 0),
  odometer numeric(12, 1) check (odometer is null or odometer >= 0),
  amount_paid numeric(12, 2) not null check (amount_paid > 0),
  full_tank boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists vehicles_user_id_idx
  on public.vehicles(user_id);
create index if not exists fuel_entries_user_vehicle_date_idx
  on public.fuel_entries(user_id, vehicle_id, fill_date);

alter table public.vehicles enable row level security;
alter table public.fuel_entries enable row level security;

drop policy if exists "Users manage their own vehicles" on public.vehicles;
create policy "Users manage their own vehicles"
  on public.vehicles for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own fuel entries" on public.fuel_entries;
create policy "Users manage their own fuel entries"
  on public.fuel_entries for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.vehicles
      where vehicles.id = fuel_entries.vehicle_id
        and vehicles.user_id = auth.uid()
    )
  );

-- Private bucket. Each user's files are stored under their auth UUID:
-- <auth.uid>/<vehicle UUID>/<photo UUID>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-photos',
  'vehicle-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their own vehicle photos" on storage.objects;
create policy "Users read their own vehicle photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload their own vehicle photos" on storage.objects;
create policy "Users upload their own vehicle photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update their own vehicle photos" on storage.objects;
create policy "Users update their own vehicle photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their own vehicle photos" on storage.objects;
create policy "Users delete their own vehicle photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
