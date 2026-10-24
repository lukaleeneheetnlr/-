-- Secure booking lifecycle controls and keep approved date ranges exclusive.
-- Review and run in Supabase Dashboard > SQL Editor after the existing schema
-- and marketplace_features_migration.sql. This migration preserves all rows.

begin;

alter table public.bookings
  add column if not exists rejection_reason text,
  add column if not exists price_per_day numeric(12,2),
  add column if not exists deposit numeric(12,2),
  add column if not exists request_key uuid;

do $$
begin
  if exists (
    select 1 from public.bookings
    where request_key is not null
    group by request_key
    having count(*) > 1
  ) then
    raise exception 'Duplicate non-NULL bookings.request_key values exist; inspect them before creating bookings_request_key_unique';
  end if;
end;
$$;
create unique index if not exists bookings_request_key_unique
  on public.bookings(request_key) where request_key is not null;

do $$
begin
  if exists (
    select 1 from public.bookings
    where (rejection_reason is not null and char_length(rejection_reason) > 500)
      or (price_per_day is not null and price_per_day <= 0)
      or (deposit is not null and deposit < 0)
  ) then
    raise exception 'Existing booking snapshot values violate the intended checks; inspect them before adding lifecycle constraints';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_rejection_reason_length_check'
  ) then
    alter table public.bookings
      add constraint bookings_rejection_reason_length_check
      check (rejection_reason is null or char_length(rejection_reason) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'approved_dates_do_not_overlap'
  ) then
    if exists (
      select 1
      from public.bookings a
      join public.bookings b
        on b.listing_id = a.listing_id
       and b.id > a.id
       and b.status = 'approved'
       and daterange(b.start_date, b.end_date, '[]')
           && daterange(a.start_date, a.end_date, '[]')
      where a.status = 'approved'
    ) then
      raise exception 'Existing approved bookings overlap; inspect them before adding approved_dates_do_not_overlap';
    end if;
    alter table public.bookings
      add constraint approved_dates_do_not_overlap
      exclude using gist (
        listing_id with =,
        daterange(start_date, end_date, '[]') with &&
      ) where (status = 'approved');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_price_snapshot_check'
  ) then
    alter table public.bookings
      add constraint bookings_price_snapshot_check
      check (price_per_day is null or price_per_day > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_deposit_snapshot_check'
  ) then
    alter table public.bookings
      add constraint bookings_deposit_snapshot_check
      check (deposit is null or deposit >= 0);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.notifications
    where kind not in (
      'booking_requested','booking_approved','booking_rejected','booking_cancelled',
      'booking_completed','booking_handover','booking_received','booking_returned',
      'review_received','report_updated','chat_message','offer_submitted',
      'offer_accepted','offer_declined','request_closed','payment_submitted',
      'payment_verified','payment_rejected','deposit_refund_pending','deposit_refunded',
      'payout_pending','payout_paid','meeting_point_updated'
    )
  ) then
    raise exception 'Existing notifications.kind values are outside the supported set; inspect them with diagnose_migration.sql before replacing the constraint';
  end if;
end;
$$;
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'booking_requested','booking_approved','booking_rejected','booking_cancelled',
    'booking_completed','booking_handover','booking_received','booking_returned',
    'review_received','report_updated','chat_message','offer_submitted',
    'offer_accepted','offer_declined','request_closed','payment_submitted',
    'payment_verified','payment_rejected','deposit_refund_pending','deposit_refunded',
    'payout_pending','payout_paid','meeting_point_updated'
  ));

-- Booking state and pricing must only be changed by the validated RPCs below.
alter table public.bookings enable row level security;
drop policy if exists "Renters can cancel pending bookings" on public.bookings;
revoke update on public.bookings from anon, authenticated;
revoke update (status) on public.bookings from anon, authenticated;
revoke insert on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;
grant insert (listing_id, renter_id, start_date, end_date, pickup_location, note, status, request_key)
  on public.bookings to authenticated;

create or replace function public.set_booking_total()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_price numeric(12,2);
  v_deposit numeric(12,2);
  v_owner_id uuid;
  v_available boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or new.renter_id is distinct from auth.uid() then
      raise exception 'ผู้จองไม่ตรงกับบัญชีที่เข้าสู่ระบบ';
    end if;
    if new.status <> 'pending' then
      raise exception 'คำขอจองใหม่ต้องเริ่มในสถานะรออนุมัติ';
    end if;
    if new.start_date < (now() at time zone 'Asia/Bangkok')::date then
      raise exception 'ไม่สามารถจองวันที่ผ่านมาแล้วได้';
    end if;
    if new.end_date < new.start_date then
      raise exception 'วันคืนต้องไม่อยู่ก่อนวันรับของ';
    end if;

    select l.price_per_day, l.deposit, l.owner_id, l.is_available
      into v_price, v_deposit, v_owner_id, v_available
      from public.listings l
      where l.id = new.listing_id
      for share;
    if not found then raise exception 'ไม่พบประกาศสินค้านี้'; end if;
    if not v_available then raise exception 'ประกาศนี้ไม่พร้อมให้เช่า'; end if;
    if v_owner_id = new.renter_id then
      raise exception 'คุณไม่สามารถจองประกาศของตัวเองได้';
    end if;

    new.total_price := v_price * (new.end_date - new.start_date + 1);
    new.price_per_day := v_price;
    new.deposit := coalesce(v_deposit, 0);
    new.rejection_reason := null;
  else
    if new.listing_id is distinct from old.listing_id
      or new.renter_id is distinct from old.renter_id
      or new.start_date is distinct from old.start_date
      or new.end_date is distinct from old.end_date
      or new.pickup_location is distinct from old.pickup_location
      or new.note is distinct from old.note
      or new.total_price is distinct from old.total_price
      or new.price_per_day is distinct from old.price_per_day
      or new.deposit is distinct from old.deposit then
      raise exception 'รายละเอียดคำขอจองแก้ไขไม่ได้หลังส่งแล้ว';
    end if;
    if new.status is distinct from old.status
      and not (
        (old.status = 'pending' and new.status in ('approved','rejected','cancelled'))
        or (old.status = 'approved' and new.status = 'completed')
      ) then
      raise exception 'ไม่อนุญาตให้เปลี่ยนสถานะการจองจาก % เป็น %', old.status, new.status;
    end if;
    if new.status <> 'rejected' then
      new.rejection_reason := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.respond_to_booking(
  p_booking_id uuid,
  p_status text,
  p_reason text
)
returns public.bookings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_listing_owner uuid;
  v_conflict boolean;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_status is null or p_status not in ('approved','rejected') then
    raise exception 'สถานะนี้ไม่อนุญาต';
  end if;
  if p_reason is not null and char_length(trim(p_reason)) > 500 then
    raise exception 'เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร';
  end if;

  select * into v_booking
    from public.bookings b where b.id = p_booking_id for update;
  if not found then raise exception 'ไม่พบคำขอจองนี้'; end if;
  if v_booking.status <> 'pending' then
    raise exception 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ';
  end if;

  select l.owner_id into v_listing_owner
    from public.listings l where l.id = v_booking.listing_id for update;
  if not found then raise exception 'ไม่พบประกาศสินค้านี้'; end if;
  if v_listing_owner is distinct from auth.uid() and not public.is_admin() then
    raise exception 'คุณไม่มีสิทธิ์จัดการคำขอนี้';
  end if;

  if p_status = 'approved' then
    select exists (
      select 1
        from public.bookings b
        where b.listing_id = v_booking.listing_id
          and b.id <> v_booking.id
          and b.status = 'approved'
          and b.start_date <= v_booking.end_date
          and b.end_date >= v_booking.start_date
    ) into v_conflict;
    if v_conflict then
      raise exception 'ช่วงวันดังกล่าวมีรายการจองที่อนุมัติแล้ว กรุณาเลือกคำขออื่น';
    end if;
  end if;

  update public.bookings
    set status = p_status,
        rejection_reason = case when p_status = 'rejected' then nullif(trim(p_reason), '') else null end
    where id = p_booking_id
    returning * into v_booking;
  return v_booking;
end;
$$;
revoke all on function public.respond_to_booking(uuid, text, text) from public, anon;
grant execute on function public.respond_to_booking(uuid, text, text) to authenticated;

-- Keep compatibility for existing clients that call the original two-argument RPC.
create or replace function public.respond_to_booking(p_booking_id uuid, p_status text)
returns public.bookings
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select public.respond_to_booking(p_booking_id, p_status, null);
$$;
revoke all on function public.respond_to_booking(uuid, text) from public, anon;
grant execute on function public.respond_to_booking(uuid, text) to authenticated;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select * into v_booking
    from public.bookings b where b.id = p_booking_id for update;
  if not found then raise exception 'ไม่พบคำขอจองนี้'; end if;
  if v_booking.renter_id is distinct from auth.uid() then
    raise exception 'คุณไม่มีสิทธิ์ยกเลิกคำขอนี้';
  end if;
  if v_booking.status <> 'pending' then
    raise exception 'ยกเลิกได้เฉพาะคำขอที่ยังรออนุมัติ';
  end if;

  update public.bookings
    set status = 'cancelled', rejection_reason = null
    where id = p_booking_id
    returning * into v_booking;
  return v_booking;
end;
$$;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

create or replace function public.complete_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_listing_owner uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select * into v_booking
    from public.bookings b where b.id = p_booking_id for update;
  if not found then raise exception 'ไม่พบรายการจองนี้'; end if;
  select l.owner_id into v_listing_owner
    from public.listings l where l.id = v_booking.listing_id;
  if v_listing_owner is distinct from auth.uid() and not public.is_admin() then
    raise exception 'เฉพาะเจ้าของประกาศเท่านั้นที่ยืนยันการคืนของได้';
  end if;
  if v_booking.status <> 'approved' then
    raise exception 'ยืนยันการคืนของได้เฉพาะรายการที่อนุมัติแล้ว';
  end if;
  if v_booking.end_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'ยังไม่ถึงวันสิ้นสุดการเช่าที่ระบุ';
  end if;

  update public.bookings
    set status = 'completed'
    where id = p_booking_id
    returning * into v_booking;
  return v_booking;
end;
$$;
revoke all on function public.complete_booking(uuid) from public, anon;
grant execute on function public.complete_booking(uuid) to authenticated;

create or replace function public.notify_booking_changes()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid;
  v_title text;
  v_kind text;
  v_recipient uuid;
  v_text text;
begin
  select l.owner_id, l.title into v_owner, v_title
    from public.listings l where l.id = new.listing_id;
  if tg_op = 'INSERT' then
    v_kind := 'booking_requested';
    v_recipient := v_owner;
    v_text := 'มีคำขอจองสำหรับ ' || v_title;
  elsif new.status is distinct from old.status then
    if new.status not in ('approved','rejected','cancelled','completed') then return new; end if;
    v_kind := case new.status
      when 'approved' then 'booking_approved'
      when 'rejected' then 'booking_rejected'
      when 'completed' then 'booking_completed'
      else 'booking_cancelled'
    end;
    v_recipient := case when new.status = 'cancelled' then v_owner else new.renter_id end;
    v_text := case new.status
      when 'approved' then 'คำขอจอง ' || v_title || ' ได้รับอนุมัติ'
      when 'rejected' then 'คำขอจอง ' || v_title || ' ถูกปฏิเสธ'
      when 'completed' then 'การเช่า ' || v_title || ' เสร็จสิ้นแล้ว'
      else 'คำขอจอง ' || v_title || ' ถูกยกเลิก'
    end;
  else
    return new;
  end if;

  if v_recipient is not null and v_recipient <> auth.uid() then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (v_recipient, auth.uid(), v_kind, v_text, v_text, 'booking', new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.set_booking_total() from public, anon, authenticated;
revoke all on function public.notify_booking_changes() from public, anon, authenticated;
drop trigger if exists bookings_notify_changes on public.bookings;
create trigger bookings_notify_changes
  after insert or update of status on public.bookings
  for each row execute function public.notify_booking_changes();

notify pgrst, 'reload schema';

commit;
