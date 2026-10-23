-- Campus Sharing Hub: admin role + listing image uploads via Supabase Storage.
-- Run the ENTIRE file in Supabase Dashboard > SQL Editor.
-- Assumes the base Campus Sharing Hub schema is already installed.

-- Add columns without dropping existing data.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

alter table public.listings
  add column if not exists image_path text;

-- Server-side role check. Clients cannot grant themselves admin rights.
create or replace function public.is_admin()
returns boolean
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  );
$function$
language sql
stable
security definer
set search_path = public, auth, pg_temp;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Listing owners and admins may update/delete listing rows.
alter table public.listings enable row level security;
drop policy if exists "Users update own listings" on public.listings;
drop policy if exists "Owners or admins update listings" on public.listings;
create policy "Owners or admins update listings" on public.listings
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "Users delete own listings" on public.listings;
drop policy if exists "Owners or admins delete listings" on public.listings;
create policy "Owners or admins delete listings" on public.listings
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- Admins may read all bookings, while members see their own activity and listings they own.
alter table public.bookings enable row level security;
drop policy if exists "Renter or listing owner can read bookings" on public.bookings;
drop policy if exists "Renter, listing owner, or admin can read bookings" on public.bookings;
create policy "Renter, listing owner, or admin can read bookings" on public.bookings
  for select to authenticated using (
    renter_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = auth.uid()
    )
  );

-- Owners or admins may approve/reject pending booking requests.
create or replace function public.respond_to_booking(p_booking_id uuid, p_status text)
returns public.bookings
as $function$
declare
  v_booking public.bookings%rowtype;
  v_owner_id uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_status is null or p_status not in ('approved','rejected') then
    raise exception 'สถานะนี้ไม่อนุญาต';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'ไม่พบคำขอจองนี้'; end if;
  select owner_id into v_owner_id from public.listings where id = v_booking.listing_id;
  if v_owner_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'คุณไม่มีสิทธิ์จัดการคำขอนี้';
  end if;
  if v_booking.status <> 'pending' then
    raise exception 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
  end if;
  update public.bookings set status = p_status, updated_at = now()
    where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$function$
language plpgsql
security definer
set search_path = public, auth, pg_temp;
revoke all on function public.respond_to_booking(uuid, text) from public, anon;
grant execute on function public.respond_to_booking(uuid, text) to authenticated;

-- Email/user directory is restricted to admins only.
create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  university text,
  created_at timestamptz,
  is_admin boolean
)
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text,
      coalesce(p.full_name, split_part(coalesce(u.email, 'student'), '@', 1)),
      coalesce(p.university, ''), u.created_at, coalesce(p.is_admin, false)
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$function$
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Storage bucket: public read for listing photos; authenticated upload to own user folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read listing images" on storage.objects;
create policy "Public can read listing images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'listing-images');

drop policy if exists "Members upload images to own folder" on storage.objects;
create policy "Members upload images to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners or admins delete listing images" on storage.objects;
create policy "Owners or admins delete listing images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
