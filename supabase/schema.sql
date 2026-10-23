-- Campus Sharing Hub MVP schema for Supabase PostgreSQL.
-- Run this entire file in Supabase Dashboard > SQL Editor > New query.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'สมาชิก',
  university text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  category text not null check (category in ('media','study','event','fashion','other')),
  price_per_day numeric(12,2) not null check (price_per_day > 0),
  deposit numeric(12,2) not null default 0 check (deposit >= 0),
  location text not null check (char_length(location) between 2 and 100),
  condition text not null check (char_length(condition) between 2 and 120),
  description text not null check (char_length(description) between 2 and 500),
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  renter_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  pickup_location text not null check (char_length(pickup_location) between 2 and 100),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','completed')),
  total_price numeric(12,2) not null default 0 check (total_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_dates_are_valid check (end_date >= start_date)
);

create index if not exists listings_owner_id_idx on public.listings(owner_id);
create index if not exists listings_browse_idx on public.listings(is_available, category, created_at desc);
create index if not exists bookings_renter_created_idx on public.bookings(renter_id, created_at desc);
create index if not exists bookings_listing_dates_idx on public.bookings(listing_id, start_date, end_date);

-- Reject overlapping approved reservations for the same physical item.
alter table public.bookings drop constraint if exists approved_dates_do_not_overlap;
alter table public.bookings add constraint approved_dates_do_not_overlap
  exclude using gist (
    listing_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status = 'approved');

-- Profiles are intentionally limited to public display information, not auth secrets.
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "Public can read profiles" on public.profiles;
create policy "Public can read profiles" on public.profiles
  for select to anon, authenticated using (true);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Anyone can read listings" on public.listings;
create policy "Anyone can read listings" on public.listings
  for select to anon, authenticated using (true);
drop policy if exists "Users insert own listings" on public.listings;
create policy "Users insert own listings" on public.listings
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Users update own listings" on public.listings;
create policy "Users update own listings" on public.listings
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Users delete own listings" on public.listings;
create policy "Users delete own listings" on public.listings
  for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "Renter or listing owner can read bookings" on public.bookings;
create policy "Renter or listing owner can read bookings" on public.bookings
  for select to authenticated using (
    renter_id = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid())
  );
drop policy if exists "Users can request bookings for others listings" on public.bookings;
create policy "Users can request bookings for others listings" on public.bookings
  for insert to authenticated with check (
    renter_id = auth.uid()
    and status = 'pending'
    and end_date >= start_date
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.is_available = true and l.owner_id <> auth.uid()
    )
  );
drop policy if exists "Renters can cancel pending bookings" on public.bookings;
create policy "Renters can cancel pending bookings" on public.bookings
  for update to authenticated
  using (renter_id = auth.uid() and status = 'pending')
  with check (renter_id = auth.uid() and status = 'cancelled');

-- Compute the total on the server: rental days are inclusive of both dates.
create or replace function public.set_booking_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_price numeric(12,2);
begin
  if new.end_date < new.start_date then
    raise exception 'วันคืนต้องไม่อยู่ก่อนวันรับของ';
  end if;
  select price_per_day into v_price from public.listings where id = new.listing_id;
  if not found then raise exception 'ไม่พบประกาศสินค้านี้'; end if;
  if tg_op = 'INSERT' then
    new.total_price := v_price * (new.end_date - new.start_date + 1);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists bookings_set_total_before_write on public.bookings;
create trigger bookings_set_total_before_write
  before insert or update on public.bookings
  for each row execute function public.set_booking_total();

-- Only the owner of the advertised item may approve/reject a pending booking.
create or replace function public.respond_to_booking(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner_id uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_status is null or p_status not in ('approved','rejected') then raise exception 'สถานะนี้ไม่อนุญาต'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'ไม่พบคำขอจองนี้'; end if;
  select owner_id into v_owner_id from public.listings where id = v_booking.listing_id;
  if v_owner_id is distinct from auth.uid() then raise exception 'คุณไม่มีสิทธิ์จัดการคำขอนี้'; end if;
  if v_booking.status <> 'pending' then raise exception 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ'; end if;
  update public.bookings set status = p_status, updated_at = now()
    where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;
revoke all on function public.respond_to_booking(uuid, text) from public;
revoke all on function public.respond_to_booking(uuid, text) from anon;
grant execute on function public.respond_to_booking(uuid, text) to authenticated;

-- Let Supabase Auth create a public profile whenever a user registers.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, university)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'student'), '@', 1)),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'university'), ''), '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    university = excluded.university;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Explicit table grants used by the browser SDK; RLS still controls the rows.
grant select on public.profiles to anon, authenticated;
grant update (full_name, university, updated_at) on public.profiles to authenticated;
grant select on public.listings to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
revoke update on public.bookings from anon, authenticated;
grant select, insert on public.bookings to authenticated;
grant update (status) on public.bookings to authenticated;
