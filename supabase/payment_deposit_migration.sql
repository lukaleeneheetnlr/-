-- Add manual payment-proof review and deposit-refund records to existing bookings.
-- Run after schema.sql, admin_upload_migration.sql, marketplace_features_migration.sql,
-- booking_lifecycle_migration.sql, and rental_handover_reviews_reports_migration.sql.
-- This migration does not initiate or verify bank transfers.

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
  if exists (
    select 1 from public.notifications
    where link_type not in (
      'listing','booking','conversation','wanted_request','offer','review','report','payment'
    )
  ) then
    raise exception 'Existing notifications.link_type values are outside the supported set; inspect them before replacing the constraint';
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
alter table public.notifications
  drop constraint if exists notifications_link_type_check;
alter table public.notifications
  add constraint notifications_link_type_check check (
    link_type in ('listing','booking','conversation','wanted_request','offer','review','report','payment')
  );

create table if not exists public.payment_settings (
  id smallint primary key check (id = 1),
  instructions text not null check (char_length(instructions) between 10 and 2000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.payment_settings enable row level security;
revoke all on public.payment_settings from public, anon, authenticated;
grant select on public.payment_settings to authenticated;
drop policy if exists "Authenticated users can read payment instructions" on public.payment_settings;
create policy "Authenticated users can read payment instructions" on public.payment_settings
  for select to authenticated using (true);

create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  payer_id uuid not null references public.profiles(id) on delete restrict,
  payment_type text not null check (payment_type in ('rent','deposit')),
  amount numeric(12,2) not null check (amount > 0),
  status text not null check (status in ('pending_verification','paid','rejected','refund_pending','refunded')),
  proof_path text not null unique,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  refunded_by uuid references public.profiles(id),
  refunded_at timestamptz,
  refund_note text check (refund_note is null or char_length(refund_note) <= 1000),
  updated_at timestamptz not null default now(),
  constraint booking_payments_review_fields_check check (
    (status = 'pending_verification' and reviewed_at is null and reviewed_by is null)
    or (status in ('paid','rejected','refund_pending','refunded') and reviewed_at is not null and reviewed_by is not null)
  ),
  constraint booking_payments_refund_fields_check check (
    (status = 'refunded' and refunded_at is not null and refunded_by is not null)
    or (status <> 'refunded' and refunded_at is null and refunded_by is null)
  )
);
do $$
begin
  if exists (
    select 1 from public.booking_payments
    where status = 'pending_verification'
    group by booking_id, payment_type
    having count(*) > 1
  ) then
    raise exception 'Duplicate pending booking payments exist for a booking and payment type; inspect them before creating booking_payments_one_pending_per_type';
  end if;
  if exists (
    select 1 from public.booking_payments
    where status in ('paid','refund_pending','refunded')
    group by booking_id, payment_type
    having count(*) > 1
  ) then
    raise exception 'Duplicate successful booking payments exist for a booking and payment type; inspect them before creating booking_payments_one_success_per_type';
  end if;
end;
$$;
create index if not exists booking_payments_booking_created_idx
  on public.booking_payments(booking_id, submitted_at desc);
create index if not exists booking_payments_status_created_idx
  on public.booking_payments(status, submitted_at desc);
create unique index if not exists booking_payments_one_pending_per_type
  on public.booking_payments(booking_id, payment_type)
  where status = 'pending_verification';
create unique index if not exists booking_payments_one_success_per_type
  on public.booking_payments(booking_id, payment_type)
  where status in ('paid','refund_pending','refunded');
alter table public.booking_payments enable row level security;
revoke all on public.booking_payments from public, anon, authenticated;
grant select (
  id,booking_id,payer_id,payment_type,amount,status,submitted_at,
  reviewed_by,reviewed_at,review_note,refunded_by,refunded_at,refund_note,updated_at
) on public.booking_payments to authenticated;
drop policy if exists "Booking parties and admins can read payment records" on public.booking_payments;
create policy "Booking parties and admins can read payment records" on public.booking_payments
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = booking_payments.booking_id
        and (
          b.renter_id = auth.uid()
          or exists (
            select 1 from public.listings l
            where l.id = b.listing_id and l.owner_id = auth.uid()
          )
        )
    )
  );

create or replace function public.booking_payment_proof_path(p_payment_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_path text;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select p.proof_path into v_path
    from public.booking_payments p
    join public.bookings b on b.id = p.booking_id
    where p.id = p_payment_id
      and (public.is_admin() or b.renter_id = auth.uid());
  if not found then raise exception 'ไม่พบหลักฐานนี้หรือคุณไม่มีสิทธิ์ดู'; end if;
  return v_path;
end;
$$;
revoke all on function public.booking_payment_proof_path(uuid) from public, anon;
grant execute on function public.booking_payment_proof_path(uuid) to authenticated;

create table if not exists public.booking_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.booking_payments(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('submitted','verified','rejected','refund_pending','refunded')),
  from_status text check (from_status is null or from_status in ('pending_verification','paid','rejected','refund_pending','refunded')),
  to_status text not null check (to_status in ('pending_verification','paid','rejected','refund_pending','refunded')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists booking_payment_events_payment_created_idx
  on public.booking_payment_events(payment_id, created_at);
alter table public.booking_payment_events enable row level security;
revoke all on public.booking_payment_events from public, anon, authenticated;
grant select on public.booking_payment_events to authenticated;
drop policy if exists "Booking parties and admins can read payment history" on public.booking_payment_events;
create policy "Booking parties and admins can read payment history" on public.booking_payment_events
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1
      from public.booking_payments p
      join public.bookings b on b.id = p.booking_id
      join public.listings l on l.id = b.listing_id
      where p.id = booking_payment_events.payment_id
        and (b.renter_id = auth.uid() or l.owner_id = auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'payment-proofs'
      and public = false
      and file_size_limit <= 5242880
      and allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]
  ) then
    raise exception 'Existing payment-proofs bucket settings are incompatible; review them before continuing';
  end if;
end;
$$;

drop policy if exists "Payers and admins can read payment proof images" on storage.objects;
create policy "Payers and admins can read payment proof images" on storage.objects
  for select to authenticated using (
    bucket_id = 'payment-proofs'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] = auth.uid()::text
        and exists (
          select 1 from public.bookings b
          where b.id::text = (storage.foldername(name))[2]
            and b.renter_id = auth.uid()
        )
      )
    )
  );
drop policy if exists "Payers upload their own payment proof images" on storage.objects;
create policy "Payers upload their own payment proof images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.bookings b
      where b.id::text = (storage.foldername(name))[2]
        and b.renter_id = auth.uid()
        and b.status in ('approved','completed')
    )
  );

create or replace function public.can_delete_unsubmitted_payment_proof(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select auth.uid() is not null
    and split_part(coalesce(p_path,''), '/', 1) = auth.uid()::text
    and not exists (
      select 1 from public.booking_payments p
      where p.proof_path = p_path and p.payer_id = auth.uid()
    );
$$;
revoke all on function public.can_delete_unsubmitted_payment_proof(text) from public, anon;
grant execute on function public.can_delete_unsubmitted_payment_proof(text) to authenticated;

drop policy if exists "Payers remove unsubmitted payment proof images" on storage.objects;
create policy "Payers remove unsubmitted payment proof images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_delete_unsubmitted_payment_proof(name)
  );

create or replace function public.submit_booking_payment(
  p_booking_id uuid,
  p_payment_type text,
  p_proof_path text
)
returns public.booking_payments
language plpgsql
security definer
set search_path = public, auth, storage, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_amount numeric(12,2);
  v_payment public.booking_payments%rowtype;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_payment_type is null or p_payment_type not in ('rent','deposit') then
    raise exception 'ประเภทยอดชำระไม่ถูกต้อง';
  end if;
  if p_proof_path is null
    or split_part(p_proof_path, '/', 1) <> auth.uid()::text
    or split_part(p_proof_path, '/', 2) <> p_booking_id::text
    or split_part(p_proof_path, '/', 3) = ''
    or split_part(p_proof_path, '/', 4) <> '' then
    raise exception 'เส้นทางหลักฐานการชำระเงินไม่ถูกต้อง';
  end if;

  select * into v_booking
    from public.bookings b where b.id = p_booking_id for update;
  if not found then raise exception 'ไม่พบรายการจองนี้'; end if;
  if v_booking.renter_id is distinct from auth.uid() then
    raise exception 'เฉพาะผู้เช่าของรายการนี้ส่งหลักฐานได้';
  end if;
  if v_booking.status not in ('approved','completed') then
    raise exception 'ส่งหลักฐานได้หลังเจ้าของอนุมัติการจองแล้วเท่านั้น';
  end if;
  if not exists (select 1 from public.payment_settings where id = 1) then
    raise exception 'ผู้ดูแลยังไม่ได้ตั้งค่าคำแนะนำการชำระเงิน';
  end if;
  if p_payment_type = 'rent' then
    v_amount := v_booking.total_price;
  else
    if v_booking.deposit is null then
      raise exception 'รายการจองเดิมไม่มีข้อมูล snapshot เงินมัดจำ กรุณาติดต่อผู้ดูแล';
    end if;
    v_amount := v_booking.deposit;
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'ไม่มียอดที่ต้องแจ้งชำระสำหรับรายการนี้';
  end if;
  if exists (
    select 1 from public.booking_payments p
    where p.booking_id = p_booking_id
      and p.payment_type = p_payment_type
      and p.status in ('pending_verification','paid','refund_pending','refunded')
  ) then
    raise exception 'มีรายการหลักฐานที่รอตรวจสอบหรือยืนยันแล้วสำหรับยอดนี้';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-proofs' and o.name = p_proof_path
  ) then
    raise exception 'ไม่พบไฟล์หลักฐานที่อัปโหลด';
  end if;

  insert into public.booking_payments(booking_id,payer_id,payment_type,amount,status,proof_path)
    values (p_booking_id,auth.uid(),p_payment_type,v_amount,'pending_verification',p_proof_path)
    returning * into v_payment;
  insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
    values (v_payment.id,auth.uid(),'submitted',null,'pending_verification','ผู้เช่าส่งหลักฐานเพื่อรอตรวจสอบ');
  insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
    select p.id,auth.uid(),'payment_submitted','มีหลักฐานการชำระเงินรอตรวจสอบ',
      case p_payment_type when 'rent' then 'ค่าเช่า' else 'เงินมัดจำ' end
        || ' ฿' || to_char(v_amount,'FM999,999,999,990.00'),
      'payment',v_payment.id
    from public.profiles p where p.is_admin and p.id <> auth.uid();
  return v_payment;
end;
$$;
revoke all on function public.submit_booking_payment(uuid,text,text) from public, anon;
grant execute on function public.submit_booking_payment(uuid,text,text) to authenticated;

create or replace function public.admin_review_booking_payment(
  p_payment_id uuid,
  p_status text,
  p_note text default null
)
returns public.booking_payments
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_payment public.booking_payments%rowtype;
  v_booking public.bookings%rowtype;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_event text;
  v_kind text;
  v_final_status text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('paid','rejected') then raise exception 'สถานะตรวจสอบไม่ถูกต้อง'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร'; end if;
  if p_status = 'rejected' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษรเมื่อปฏิเสธหลักฐาน';
  end if;
  select b.* into v_booking
    from public.bookings b
    join public.booking_payments p on p.booking_id = b.id
    where p.id = p_payment_id
    for update of b;
  if not found then raise exception 'ไม่พบรายการจองของหลักฐานนี้'; end if;
  select * into v_payment from public.booking_payments p
    where p.id = p_payment_id for update;
  if v_payment.status <> 'pending_verification' then
    raise exception 'หลักฐานนี้ไม่ได้อยู่ในสถานะรอตรวจสอบ';
  end if;
  v_final_status := p_status;
  if p_status = 'paid' and v_payment.payment_type = 'deposit' and v_booking.status = 'completed'
    and not exists (
      select 1 from public.issue_reports r
      where r.booking_id = v_booking.id and r.status <> 'resolved'
    ) then
    v_final_status := 'refund_pending';
  end if;
  update public.booking_payments
    set status = v_final_status,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = v_note,
        updated_at = now()
    where id = p_payment_id returning * into v_payment;
  v_event := case when p_status = 'paid' then 'verified' else 'rejected' end;
  v_kind := case when p_status = 'paid' then 'payment_verified' else 'payment_rejected' end;
  insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
    values (v_payment.id,auth.uid(),v_event,'pending_verification',p_status,v_note);
  if v_final_status = 'refund_pending' then
    insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
      values (v_payment.id,auth.uid(),'refund_pending','paid','refund_pending',
        'การเช่าเสร็จสิ้นและไม่มีรายงานปัญหาที่ค้างอยู่ รอผู้ดูแลดำเนินการคืนเงินจริง');
  end if;
  insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
    values (v_payment.payer_id,auth.uid(),v_kind,
      case when p_status = 'paid' then 'ตรวจสอบหลักฐานแล้ว' else 'หลักฐานการชำระเงินไม่ผ่าน' end,
      case when p_status = 'paid'
        then 'แอดมินตรวจสอบหลักฐานแล้ว (ไม่ใช่การยืนยันจาก Payment Gateway)'
        else coalesce(v_note,'กรุณาตรวจสอบหลักฐานและส่งใหม่') end,
      'payment',v_payment.id);
  if v_final_status = 'refund_pending' then
    insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
      values (v_payment.payer_id,auth.uid(),'deposit_refund_pending','เงินมัดจำรอการคืน',
        'แอดมินตรวจสอบยอดแล้วและจะดำเนินการคืนเงินจริงตามขั้นตอน',
        'payment',v_payment.id);
  end if;
  return v_payment;
end;
$$;
revoke all on function public.admin_review_booking_payment(uuid,text,text) from public, anon;
grant execute on function public.admin_review_booking_payment(uuid,text,text) to authenticated;

create or replace function public.admin_record_deposit_refund(
  p_payment_id uuid,
  p_note text,
  p_transfer_completed boolean
)
returns public.booking_payments
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_payment public.booking_payments%rowtype;
  v_booking public.bookings%rowtype;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_transfer_completed is not true then raise exception 'ยืนยันคืนเงินได้หลังดำเนินการโอนเงินจริงแล้วเท่านั้น'; end if;
  if v_note is null or char_length(v_note) < 5 or char_length(v_note) > 1000 then
    raise exception 'กรุณาบันทึกหมายเหตุการคืนเงิน 5 ถึง 1,000 ตัวอักษร';
  end if;
  select b.* into v_booking
    from public.bookings b
    join public.booking_payments p on p.booking_id = b.id
    where p.id = p_payment_id
    for update of b;
  if not found then raise exception 'ไม่พบรายการจองของเงินมัดจำนี้'; end if;
  select * into v_payment from public.booking_payments p
    where p.id = p_payment_id for update;
  if v_payment.payment_type <> 'deposit' or v_payment.status <> 'refund_pending' then
    raise exception 'เงินมัดจำนี้ยังไม่อยู่ในสถานะรอดำเนินการคืนเงิน';
  end if;
  if v_booking.status <> 'completed' then raise exception 'ต้องปิดการเช่าและตรวจสอบข้อโต้แย้งก่อนคืนเงินมัดจำ'; end if;
  if exists (
    select 1 from public.issue_reports r
    where r.booking_id = v_booking.id and r.status <> 'resolved'
  ) then raise exception 'ยังมีรายงานปัญหาที่รอตรวจสอบ'; end if;

  update public.booking_payments
    set status = 'refunded',
        refunded_by = auth.uid(),
        refunded_at = now(),
        refund_note = v_note,
        updated_at = now()
    where id = p_payment_id returning * into v_payment;
  insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
    values (v_payment.id,auth.uid(),'refunded','refund_pending','refunded',v_note);
  insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
    values (v_payment.payer_id,auth.uid(),'deposit_refunded','บันทึกการคืนเงินมัดจำแล้ว',
      'ผู้ดูแลบันทึกว่าดำเนินการคืนเงินมัดจำแล้ว: ' || v_note,'payment',v_payment.id);
  return v_payment;
end;
$$;
revoke all on function public.admin_record_deposit_refund(uuid,text,boolean) from public, anon;
grant execute on function public.admin_record_deposit_refund(uuid,text,boolean) to authenticated;

create or replace function public.admin_update_payment_instructions(p_instructions text)
returns public.payment_settings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_instructions text := nullif(trim(coalesce(p_instructions,'')),'');
  v_settings public.payment_settings%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if v_instructions is not null and char_length(v_instructions) not between 10 and 2000 then
    raise exception 'คำแนะนำต้องมีความยาว 10 ถึง 2,000 ตัวอักษร';
  end if;
  if v_instructions is null then
    delete from public.payment_settings where id = 1;
    return null;
  end if;
  insert into public.payment_settings(id,instructions,updated_by,updated_at)
    values (1,v_instructions,auth.uid(),now())
    on conflict (id) do update
      set instructions = excluded.instructions,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
    returning * into v_settings;
  return v_settings;
end;
$$;
revoke all on function public.admin_update_payment_instructions(text) from public, anon;
grant execute on function public.admin_update_payment_instructions(text) to authenticated;

create or replace function public.on_booking_completed_prepare_deposit_refund()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_payment public.booking_payments%rowtype;
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    if exists (
      select 1 from public.issue_reports r
      where r.booking_id = new.id and r.status <> 'resolved'
    ) then
      raise exception 'ยังมีรายงานปัญหาที่รอตรวจสอบ ไม่สามารถปิดการเช่าหรือคืนเงินมัดจำได้';
    end if;
    update public.booking_payments
      set status = 'refund_pending', updated_at = now()
      where booking_id = new.id
        and payment_type = 'deposit'
        and status = 'paid'
      returning * into v_payment;
    if found then
      insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
        values (v_payment.id,auth.uid(),'refund_pending','paid','refund_pending',
          'การเช่าเสร็จสิ้นแล้ว รอผู้ดูแลตรวจสอบและดำเนินการคืนเงินจริง');
      insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
        values (v_payment.payer_id,auth.uid(),'deposit_refund_pending','เงินมัดจำรอการคืน',
          'การเช่าเสร็จสิ้นแล้ว ผู้ดูแลจะตรวจสอบและบันทึกผลการคืนเงินจริง',
          'payment',v_payment.id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.on_booking_completed_prepare_deposit_refund() from public, anon, authenticated;
drop trigger if exists bookings_prepare_deposit_refund on public.bookings;
create trigger bookings_prepare_deposit_refund
  after update of status on public.bookings
  for each row execute function public.on_booking_completed_prepare_deposit_refund();

create or replace function public.on_issue_report_resolved_prepare_deposit_refund()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_payment public.booking_payments%rowtype;
begin
  if new.status = 'resolved' and old.status is distinct from new.status
    and new.booking_id is not null then
    select * into v_booking from public.bookings b where b.id = new.booking_id for update;
    if found and v_booking.status = 'completed' and not exists (
      select 1 from public.issue_reports r
      where r.booking_id = new.booking_id and r.status <> 'resolved'
    ) then
      update public.booking_payments
        set status = 'refund_pending', updated_at = now()
        where booking_id = new.booking_id
          and payment_type = 'deposit'
          and status = 'paid'
        returning * into v_payment;
      if found then
        insert into public.booking_payment_events(payment_id,actor_id,event_type,from_status,to_status,note)
          values (v_payment.id,auth.uid(),'refund_pending','paid','refund_pending',
            'รายงานปัญหาทั้งหมดได้รับการแก้ไขแล้ว รอผู้ดูแลดำเนินการคืนเงินจริง');
        insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
          values (v_payment.payer_id,auth.uid(),'deposit_refund_pending','เงินมัดจำรอการคืน',
            'รายงานปัญหาได้รับการแก้ไขแล้ว ผู้ดูแลจะดำเนินการคืนเงินจริง',
            'payment',v_payment.id);
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.on_issue_report_resolved_prepare_deposit_refund() from public, anon, authenticated;
drop trigger if exists issue_reports_prepare_deposit_refund on public.issue_reports;
create trigger issue_reports_prepare_deposit_refund
  after update of status on public.issue_reports
  for each row execute function public.on_issue_report_resolved_prepare_deposit_refund();

notify pgrst, 'reload schema';
commit;
