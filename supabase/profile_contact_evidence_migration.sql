-- Add public profile fields, private contact data, booking contact snapshots,
-- and private image evidence for rental milestones and issue reports.
-- Run after payment_deposit_migration.sql. Existing records are preserved.

begin;

alter table public.profiles
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists avatar_path text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_bio_length_check'
  ) then
    alter table public.profiles add constraint profiles_bio_length_check
      check (bio is null or char_length(bio) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.profiles'::regclass and conname='profiles_avatar_pair_check'
  ) then
    alter table public.profiles add constraint profiles_avatar_pair_check
      check ((avatar_url is null and avatar_path is null) or (avatar_url is not null and avatar_path is not null));
  end if;
end;
$$;
revoke update on public.profiles from public, anon, authenticated;
grant update (full_name, university, updated_at, bio, avatar_url, avatar_path)
  on public.profiles to authenticated;

create table if not exists public.profile_contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text check (phone is null or char_length(phone) between 7 and 25),
  updated_at timestamptz not null default now()
);
alter table public.profile_contacts enable row level security;
revoke all on public.profile_contacts from public, anon, authenticated;
grant select, insert, update, delete on public.profile_contacts to authenticated;
drop policy if exists "Users manage their own private contact" on public.profile_contacts;
create policy "Users manage their own private contact" on public.profile_contacts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.bookings
  add column if not exists renter_contact_phone text,
  add column if not exists owner_contact_phone text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass and conname='bookings_contact_phone_length_check'
  ) then
    alter table public.bookings add constraint bookings_contact_phone_length_check check (
      (renter_contact_phone is null or char_length(renter_contact_phone) between 7 and 25)
      and (owner_contact_phone is null or char_length(owner_contact_phone) between 7 and 25)
    );
  end if;
end;
$$;
grant insert (renter_contact_phone) on public.bookings to authenticated;

create or replace function public.snapshot_booking_contact_phones()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner_id uuid;
  v_owner_phone text;
  v_renter_phone text;
begin
  if tg_op = 'UPDATE' then
    if new.renter_contact_phone is distinct from old.renter_contact_phone
      or new.owner_contact_phone is distinct from old.owner_contact_phone then
      raise exception 'ข้อมูลติดต่อในรายการเช่าแก้ไขโดยตรงไม่ได้';
    end if;
    return new;
  end if;
  if auth.uid() is null or new.renter_id is distinct from auth.uid() then
    raise exception 'ผู้จองไม่ตรงกับบัญชีที่เข้าสู่ระบบ';
  end if;
  if new.renter_contact_phone is not null then
    v_renter_phone := regexp_replace(new.renter_contact_phone, '[^0-9+]', '', 'g');
    if char_length(v_renter_phone) < 7 or char_length(v_renter_phone) > 25 then
      raise exception 'เบอร์ติดต่อสำหรับการจองไม่ถูกต้อง';
    end if;
    new.renter_contact_phone := v_renter_phone;
  end if;
  select l.owner_id into v_owner_id
    from public.listings l where l.id = new.listing_id;
  if not found then raise exception 'ไม่พบประกาศสินค้านี้'; end if;
  select c.phone into v_owner_phone
    from public.profile_contacts c where c.user_id = v_owner_id;
  new.owner_contact_phone := nullif(regexp_replace(coalesce(v_owner_phone,''), '[^0-9+]', '', 'g'), '');
  new.created_at := coalesce(new.created_at, now());
  return new;
end;
$$;
revoke all on function public.snapshot_booking_contact_phones() from public, anon, authenticated;
drop trigger if exists bookings_snapshot_contact_phones on public.bookings;
create trigger bookings_snapshot_contact_phones
  before insert on public.bookings
  for each row execute function public.snapshot_booking_contact_phones();
drop trigger if exists bookings_protect_contact_snapshots on public.bookings;
create trigger bookings_protect_contact_snapshots
  before update of renter_contact_phone,owner_contact_phone on public.bookings
  for each row execute function public.snapshot_booking_contact_phones();

create table if not exists public.booking_evidence (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  milestone text not null check (milestone in ('owner_handover','renter_received','renter_return','owner_return')),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists booking_evidence_booking_milestone_idx
  on public.booking_evidence(booking_id,milestone,created_at);
alter table public.booking_evidence enable row level security;
revoke all on public.booking_evidence from public, anon, authenticated;
grant select on public.booking_evidence to authenticated;
drop policy if exists "Booking parties read rental evidence" on public.booking_evidence;
create policy "Booking parties read rental evidence" on public.booking_evidence
  for select to authenticated using (
    exists (
      select 1 from public.bookings b
      join public.listings l on l.id = b.listing_id
      where b.id = booking_evidence.booking_id
        and (b.renter_id = auth.uid() or l.owner_id = auth.uid() or public.is_admin())
    )
  );

create table if not exists public.issue_report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.issue_reports(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists issue_report_evidence_report_created_idx
  on public.issue_report_evidence(report_id,created_at);
alter table public.issue_report_evidence enable row level security;
revoke all on public.issue_report_evidence from public, anon, authenticated;
grant select on public.issue_report_evidence to authenticated;
drop policy if exists "Report parties read report evidence" on public.issue_report_evidence;
create policy "Report parties read report evidence" on public.issue_report_evidence
  for select to authenticated using (
    exists (
      select 1 from public.issue_reports r
      where r.id = issue_report_evidence.report_id
        and (
          r.reporter_id = auth.uid()
          or r.reported_user_id = auth.uid()
          or public.is_admin()
          or (r.booking_id is not null and exists (
            select 1 from public.bookings b
            join public.listings l on l.id = b.listing_id
            where b.id = r.booking_id and (b.renter_id = auth.uid() or l.owner_id = auth.uid())
          ))
          or (r.listing_id is not null and exists (
            select 1 from public.listings l where l.id = r.listing_id and l.owner_id = auth.uid()
          ))
          or (r.review_id is not null and exists (
            select 1 from public.rental_reviews rv
            where rv.id = r.review_id and (rv.reviewer_id = auth.uid() or rv.reviewee_id = auth.uid())
          ))
        )
    )
  );

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('rental-evidence','rental-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id='rental-evidence' and public=false and file_size_limit <= 5242880
      and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]
  ) then
    raise exception 'Existing rental-evidence bucket settings are incompatible; review them before continuing';
  end if;
end;
$$;

drop policy if exists "Rental parties read private booking evidence" on storage.objects;
create policy "Rental parties read private booking evidence" on storage.objects
  for select to authenticated using (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='booking'
    and exists (
      select 1 from public.bookings b
      join public.listings l on l.id=b.listing_id
      where b.id::text=(storage.foldername(name))[2]
        and (b.renter_id=auth.uid() or l.owner_id=auth.uid() or public.is_admin())
    )
  );
drop policy if exists "Rental parties upload authorized milestone evidence" on storage.objects;
create policy "Rental parties upload authorized milestone evidence" on storage.objects
  for insert to authenticated with check (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='booking'
    and (storage.foldername(name))[4]=auth.uid()::text
    and exists (
      select 1 from public.bookings b
      join public.listings l on l.id=b.listing_id
      where b.id::text=(storage.foldername(name))[2]
        and b.status='approved'
        and (
          ((storage.foldername(name))[3] in ('owner_handover','owner_return') and l.owner_id=auth.uid())
          or ((storage.foldername(name))[3] in ('renter_received','renter_return') and b.renter_id=auth.uid())
        )
    )
  );
drop policy if exists "Users remove unregistered booking evidence uploads" on storage.objects;
create policy "Users remove unregistered booking evidence uploads" on storage.objects
  for delete to authenticated using (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='booking'
    and (storage.foldername(name))[4]=auth.uid()::text
    and not exists (select 1 from public.booking_evidence e where e.storage_path=storage.objects.name)
    and exists (
      select 1 from public.bookings b
      join public.listings l on l.id=b.listing_id
      where b.id::text=(storage.foldername(name))[2]
        and (
          ((storage.foldername(name))[3] in ('owner_handover','owner_return') and l.owner_id=auth.uid())
          or ((storage.foldername(name))[3] in ('renter_received','renter_return') and b.renter_id=auth.uid())
        )
    )
  );

drop policy if exists "Report parties read private report evidence" on storage.objects;
create policy "Report parties read private report evidence" on storage.objects
  for select to authenticated using (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='report'
    and exists (
      select 1 from public.issue_reports r
      where r.id::text=(storage.foldername(name))[2]
        and (
          r.reporter_id=auth.uid()
          or r.reported_user_id=auth.uid()
          or public.is_admin()
          or (r.booking_id is not null and exists (
            select 1 from public.bookings b
            join public.listings l on l.id=b.listing_id
            where b.id=r.booking_id and (b.renter_id=auth.uid() or l.owner_id=auth.uid())
          ))
          or (r.listing_id is not null and exists (
            select 1 from public.listings l where l.id=r.listing_id and l.owner_id=auth.uid()
          ))
          or (r.review_id is not null and exists (
            select 1 from public.rental_reviews rv
            where rv.id=r.review_id and (rv.reviewer_id=auth.uid() or rv.reviewee_id=auth.uid())
          ))
        )
    )
  );
drop policy if exists "Reporters upload their own report evidence" on storage.objects;
create policy "Reporters upload their own report evidence" on storage.objects
  for insert to authenticated with check (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='report'
    and (storage.foldername(name))[3]=auth.uid()::text
    and exists (
      select 1 from public.issue_reports r
      where r.id::text=(storage.foldername(name))[2] and r.reporter_id=auth.uid()
    )
  );
drop policy if exists "Reporters remove unregistered report evidence uploads" on storage.objects;
create policy "Reporters remove unregistered report evidence uploads" on storage.objects
  for delete to authenticated using (
    bucket_id='rental-evidence'
    and (storage.foldername(name))[1]='report'
    and (storage.foldername(name))[3]=auth.uid()::text
    and not exists (select 1 from public.issue_report_evidence e where e.storage_path=storage.objects.name)
    and exists (
      select 1 from public.issue_reports r
      where r.id::text=(storage.foldername(name))[2] and r.reporter_id=auth.uid()
    )
  );

create or replace function public.booking_evidence_path(p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare v_path text;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select e.storage_path into v_path
    from public.booking_evidence e
    join public.bookings b on b.id=e.booking_id
    join public.listings l on l.id=b.listing_id
    where e.id=p_evidence_id
      and (b.renter_id=auth.uid() or l.owner_id=auth.uid() or public.is_admin());
  if not found then raise exception 'ไม่พบหลักฐานหรือคุณไม่มีสิทธิ์ดู'; end if;
  return v_path;
end;
$$;
revoke all on function public.booking_evidence_path(uuid) from public,anon;
grant execute on function public.booking_evidence_path(uuid) to authenticated;

create or replace function public.attach_booking_evidence(p_booking_id uuid,p_milestone text,p_storage_path text)
returns public.booking_evidence
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner uuid;
  v_count integer;
  v_evidence public.booking_evidence%rowtype;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_milestone not in ('owner_handover','renter_received','renter_return','owner_return')
    or p_storage_path is null
    or split_part(p_storage_path,'/',1)<>'booking'
    or split_part(p_storage_path,'/',2)<>p_booking_id::text
    or split_part(p_storage_path,'/',3)<>p_milestone
    or split_part(p_storage_path,'/',4)<>auth.uid()::text
    or split_part(p_storage_path,'/',5)=''
    or split_part(p_storage_path,'/',6)<>'' then
    raise exception 'เส้นทางหรือขั้นตอนหลักฐานไม่ถูกต้อง';
  end if;
  select * into v_booking from public.bookings b where b.id=p_booking_id for update;
  if not found or v_booking.status<>'approved' then raise exception 'ไม่พบรายการเช่าหรือไม่ได้รับอนุมัติ'; end if;
  select owner_id into v_owner from public.listings where id=v_booking.listing_id;
  if (p_milestone in ('owner_handover','owner_return') and auth.uid() is distinct from v_owner)
    or (p_milestone in ('renter_received','renter_return') and auth.uid() is distinct from v_booking.renter_id) then
    raise exception 'ไม่มีสิทธิ์แนบหลักฐานในขั้นตอนนี้';
  end if;
  perform 1 from public.storage.objects o where o.bucket_id='rental-evidence' and o.name=p_storage_path;
  if not found then raise exception 'ไม่พบไฟล์หลักฐานที่อัปโหลด'; end if;
  select count(*) into v_count from public.booking_evidence e
    where e.booking_id=p_booking_id and e.milestone=p_milestone and e.uploaded_by=auth.uid();
  if v_count>=5 then raise exception 'แนบภาพได้ไม่เกิน 5 ภาพต่อขั้นตอน'; end if;
  insert into public.booking_evidence(booking_id,milestone,uploaded_by,storage_path)
    values (p_booking_id,p_milestone,auth.uid(),p_storage_path)
    returning * into v_evidence;
  return v_evidence;
end;
$$;
revoke all on function public.attach_booking_evidence(uuid,text,text) from public,anon;
grant execute on function public.attach_booking_evidence(uuid,text,text) to authenticated;

create or replace function public.issue_report_evidence_path(p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare v_path text;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select e.storage_path into v_path
    from public.issue_report_evidence e
    join public.issue_reports r on r.id=e.report_id
    where e.id=p_evidence_id
      and (
        r.reporter_id=auth.uid() or r.reported_user_id=auth.uid() or public.is_admin()
        or (r.booking_id is not null and exists (
          select 1 from public.bookings b join public.listings l on l.id=b.listing_id
          where b.id=r.booking_id and (b.renter_id=auth.uid() or l.owner_id=auth.uid())
        ))
        or (r.listing_id is not null and exists (
          select 1 from public.listings l where l.id=r.listing_id and l.owner_id=auth.uid()
        ))
        or (r.review_id is not null and exists (
          select 1 from public.rental_reviews rv
          where rv.id=r.review_id and (rv.reviewer_id=auth.uid() or rv.reviewee_id=auth.uid())
        ))
      );
  if not found then raise exception 'ไม่พบหลักฐานหรือคุณไม่มีสิทธิ์ดู'; end if;
  return v_path;
end;
$$;
revoke all on function public.issue_report_evidence_path(uuid) from public,anon;
grant execute on function public.issue_report_evidence_path(uuid) to authenticated;

create or replace function public.attach_issue_report_evidence(p_report_id uuid,p_storage_path text)
returns public.issue_report_evidence
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_report public.issue_reports%rowtype;
  v_count integer;
  v_evidence public.issue_report_evidence%rowtype;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_storage_path is null
    or split_part(p_storage_path,'/',1)<>'report'
    or split_part(p_storage_path,'/',2)<>p_report_id::text
    or split_part(p_storage_path,'/',3)<>auth.uid()::text
    or split_part(p_storage_path,'/',4)=''
    or split_part(p_storage_path,'/',5)<>'' then
    raise exception 'เส้นทางหลักฐานรายงานไม่ถูกต้อง';
  end if;
  select * into v_report from public.issue_reports r where r.id=p_report_id for update;
  if not found or v_report.reporter_id is distinct from auth.uid() then
    raise exception 'ไม่มีสิทธิ์แนบหลักฐานให้รายงานนี้';
  end if;
  perform 1 from public.storage.objects o where o.bucket_id='rental-evidence' and o.name=p_storage_path;
  if not found then raise exception 'ไม่พบไฟล์หลักฐานที่อัปโหลด'; end if;
  select count(*) into v_count from public.issue_report_evidence e where e.report_id=p_report_id;
  if v_count>=5 then raise exception 'แนบภาพได้ไม่เกิน 5 ภาพต่อรายงาน'; end if;
  insert into public.issue_report_evidence(report_id,uploaded_by,storage_path)
    values (p_report_id,auth.uid(),p_storage_path)
    returning * into v_evidence;
  return v_evidence;
end;
$$;
revoke all on function public.attach_issue_report_evidence(uuid,text) from public,anon;
grant execute on function public.attach_issue_report_evidence(uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
