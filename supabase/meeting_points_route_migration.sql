-- Pinned pickup / return points on each booking (for the in-app map and route).
-- Run AFTER service_fee_promptpay_payout_migration.sql.
-- Only ADDS columns and functions. Exact points are stored on bookings, so the existing
-- bookings RLS keeps them visible to the renter, the listing owner and admins only.

begin;

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

alter table public.bookings
  add column if not exists pickup_point_lat numeric(9,6),
  add column if not exists pickup_point_lng numeric(9,6),
  add column if not exists return_point_lat numeric(9,6),
  add column if not exists return_point_lng numeric(9,6),
  add column if not exists meeting_points_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists meeting_points_updated_at timestamptz;

do $$
begin
  if exists (
    select 1 from public.bookings
    where (pickup_point_lat is null) <> (pickup_point_lng is null)
      or (return_point_lat is null) <> (return_point_lng is null)
      or pickup_point_lat not between -90 and 90
      or pickup_point_lng not between -180 and 180
      or return_point_lat not between -90 and 90
      or return_point_lng not between -180 and 180
  ) then
    raise exception 'Existing booking meeting points are invalid; inspect them before replacing coordinate constraints';
  end if;
end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_pickup_point_valid'
  ) then
    alter table public.bookings add constraint bookings_pickup_point_valid check (
      (pickup_point_lat is null and pickup_point_lng is null)
      or (pickup_point_lat between -90 and 90 and pickup_point_lng between -180 and 180)
    );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_return_point_valid'
  ) then
    alter table public.bookings add constraint bookings_return_point_valid check (
      (return_point_lat is null and return_point_lng is null)
      or (return_point_lat between -90 and 90 and return_point_lng between -180 and 180)
    );
  end if;
end;
$$;

create or replace function public.set_booking_meeting_points(
  p_booking_id uuid,
  p_pickup_lat numeric,
  p_pickup_lng numeric,
  p_return_lat numeric,
  p_return_lng numeric
)
returns public.bookings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner uuid;
  v_title text;
  v_other uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if (p_pickup_lat is null) <> (p_pickup_lng is null) or (p_return_lat is null) <> (p_return_lng is null) then
    raise exception 'พิกัดต้องมีทั้งละติจูดและลองจิจูด';
  end if;
  if p_pickup_lat is not null and (p_pickup_lat not between -90 and 90 or p_pickup_lng not between -180 and 180) then
    raise exception 'พิกัดจุดนัดรับไม่ถูกต้อง';
  end if;
  if p_return_lat is not null and (p_return_lat not between -90 and 90 or p_return_lng not between -180 and 180) then
    raise exception 'พิกัดจุดคืนไม่ถูกต้อง';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'ไม่พบรายการจองนี้'; end if;
  select l.owner_id, l.title into v_owner, v_title from public.listings l where l.id = v_booking.listing_id;
  if auth.uid() is distinct from v_booking.renter_id and auth.uid() is distinct from v_owner then
    raise exception 'เฉพาะผู้เช่าและเจ้าของรายการนี้ปักหมุดได้' using errcode = '42501';
  end if;
  if v_booking.status not in ('pending','approved') or v_booking.owner_return_received_at is not null then
    raise exception 'แก้ไขจุดนัดได้เฉพาะรายการที่รออนุมัติหรือกำลังเช่าอยู่';
  end if;

  update public.bookings
    set pickup_point_lat = round(p_pickup_lat, 6),
        pickup_point_lng = round(p_pickup_lng, 6),
        return_point_lat = round(p_return_lat, 6),
        return_point_lng = round(p_return_lng, 6),
        meeting_points_updated_by = auth.uid(),
        meeting_points_updated_at = now()
    where id = p_booking_id
    returning * into v_booking;

  v_other := case when auth.uid() = v_booking.renter_id then v_owner else v_booking.renter_id end;
  if v_other is not null and v_other <> auth.uid() then
    insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
      values (v_other, auth.uid(), 'meeting_point_updated', 'มีการปักหมุดจุดนัดรับ/คืนของ',
        coalesce(v_title,'รายการจอง') || ' · เปิดดูแผนที่และเส้นทางได้ในรายการจอง',
        'booking', v_booking.id);
  end if;
  return v_booking;
end;
$$;
revoke all on function public.set_booking_meeting_points(uuid,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.set_booking_meeting_points(uuid,numeric,numeric,numeric,numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
