-- Service fee, PromptPay QR settings and owner payout records.
-- Run AFTER payment_deposit_migration.sql (and the migrations it depends on).
-- This migration only ADDS tables/columns/functions and replaces submit_booking_payment
-- so the rent amount includes the platform service fee. It does not drop tables or data.
-- It does not move real money: admins still transfer outside the system and record the result.

begin;

-- 1) Notification kinds for owner payouts (keeps every kind used by earlier migrations)
alter table public.notifications
  drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in (
    'booking_requested','booking_approved','booking_rejected','booking_cancelled',
    'booking_completed','booking_handover','booking_received','booking_returned',
    'review_received','report_updated','chat_message','offer_submitted',
    'offer_accepted','offer_declined','request_closed','payment_submitted',
    'payment_verified','payment_rejected','deposit_refund_pending','deposit_refunded',
    'payout_pending','payout_paid'
  ));

-- 2) Platform fee settings (one row)
create table if not exists public.platform_fee_settings (
  id smallint primary key check (id = 1),
  fee_percent numeric(5,2) not null default 10 check (fee_percent >= 0 and fee_percent <= 30),
  min_fee numeric(12,2) not null default 15 check (min_fee >= 0 and min_fee <= 1000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_fee_settings(id, fee_percent, min_fee)
  values (1, 10, 15)
  on conflict (id) do nothing;
alter table public.platform_fee_settings enable row level security;
revoke all on public.platform_fee_settings from public, anon, authenticated;
grant select on public.platform_fee_settings to anon, authenticated;
drop policy if exists "Everyone can read platform fee settings" on public.platform_fee_settings;
create policy "Everyone can read platform fee settings" on public.platform_fee_settings
  for select to anon, authenticated using (true);

create or replace function public.calculate_service_fee(p_rent numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_percent numeric(5,2);
  v_min numeric(12,2);
begin
  if p_rent is null or p_rent <= 0 then return 0; end if;
  select fee_percent, min_fee into v_percent, v_min
    from public.platform_fee_settings where id = 1;
  if not found then v_percent := 10; v_min := 15; end if;
  if v_percent = 0 then return 0; end if;
  return greatest(round(p_rent * v_percent / 100, 2), v_min);
end;
$$;
revoke all on function public.calculate_service_fee(numeric) from public;
grant execute on function public.calculate_service_fee(numeric) to anon, authenticated;

create or replace function public.admin_update_platform_fee(p_fee_percent numeric, p_min_fee numeric)
returns public.platform_fee_settings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_settings public.platform_fee_settings%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_fee_percent is null or p_fee_percent < 0 or p_fee_percent > 30 then
    raise exception 'เปอร์เซ็นต์ค่าบริการต้องอยู่ระหว่าง 0 ถึง 30';
  end if;
  if p_min_fee is null or p_min_fee < 0 or p_min_fee > 1000 then
    raise exception 'ค่าบริการขั้นต่ำต้องอยู่ระหว่าง 0 ถึง 1,000 บาท';
  end if;
  insert into public.platform_fee_settings(id, fee_percent, min_fee, updated_by, updated_at)
    values (1, p_fee_percent, p_min_fee, auth.uid(), now())
    on conflict (id) do update
      set fee_percent = excluded.fee_percent,
          min_fee = excluded.min_fee,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
    returning * into v_settings;
  return v_settings;
end;
$$;
revoke all on function public.admin_update_platform_fee(numeric,numeric) from public, anon;
grant execute on function public.admin_update_platform_fee(numeric,numeric) to authenticated;

-- 3) Service fee snapshot on each new booking (old bookings keep NULL = no fee)
alter table public.bookings
  add column if not exists service_fee numeric(12,2) check (service_fee is null or service_fee >= 0);

create or replace function public.set_booking_service_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.service_fee := public.calculate_service_fee(new.total_price);
  elsif new.service_fee is distinct from old.service_fee then
    raise exception 'ค่าบริการของรายการจองแก้ไขไม่ได้หลังส่งแล้ว';
  end if;
  return new;
end;
$$;
revoke all on function public.set_booking_service_fee() from public, anon, authenticated;
-- Trigger name sorts after bookings_set_total_before_write so total_price is already calculated.
drop trigger if exists bookings_zz_set_service_fee on public.bookings;
create trigger bookings_zz_set_service_fee
  before insert or update on public.bookings
  for each row execute function public.set_booking_service_fee();

-- 4) PromptPay receiver for QR generation
alter table public.payment_settings
  add column if not exists promptpay_id text,
  add column if not exists promptpay_name text;
alter table public.payment_settings
  drop constraint if exists payment_settings_promptpay_id_check;
alter table public.payment_settings
  add constraint payment_settings_promptpay_id_check check (
    promptpay_id is null or promptpay_id ~ '^([0-9]{10}|[0-9]{13}|[0-9]{15})$'
  );
alter table public.payment_settings
  drop constraint if exists payment_settings_promptpay_name_check;
alter table public.payment_settings
  add constraint payment_settings_promptpay_name_check check (
    promptpay_name is null or char_length(promptpay_name) between 2 and 100
  );

create or replace function public.admin_update_promptpay(p_promptpay_id text, p_promptpay_name text)
returns public.payment_settings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_id text := nullif(regexp_replace(coalesce(p_promptpay_id,''), '[^0-9]', '', 'g'), '');
  v_name text := nullif(trim(coalesce(p_promptpay_name,'')), '');
  v_settings public.payment_settings%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if v_id is not null and v_id !~ '^([0-9]{10}|[0-9]{13}|[0-9]{15})$' then
    raise exception 'PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก เลขประจำตัว 13 หลัก หรือ e-Wallet 15 หลัก';
  end if;
  if v_id is not null and v_name is null then
    raise exception 'กรุณาระบุชื่อบัญชี PromptPay เพื่อให้ผู้เช่าตรวจชื่อก่อนโอน';
  end if;
  if not exists (select 1 from public.payment_settings where id = 1) then
    raise exception 'กรุณาบันทึกคำแนะนำการชำระเงินก่อนตั้งค่า PromptPay';
  end if;
  update public.payment_settings
    set promptpay_id = v_id,
        promptpay_name = case when v_id is null then null else v_name end,
        updated_by = auth.uid(),
        updated_at = now()
    where id = 1
    returning * into v_settings;
  return v_settings;
end;
$$;
revoke all on function public.admin_update_promptpay(text,text) from public, anon;
grant execute on function public.admin_update_promptpay(text,text) to authenticated;

-- 5) Rent payment = rent + service fee (same logic as payment_deposit_migration.sql otherwise)
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
    v_amount := v_booking.total_price + coalesce(v_booking.service_fee, 0);
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
      case p_payment_type when 'rent' then 'ค่าเช่า + ค่าบริการ' else 'เงินมัดจำ' end
        || ' ฿' || to_char(v_amount,'FM999,999,999,990.00'),
      'payment',v_payment.id
    from public.profiles p where p.is_admin and p.id <> auth.uid();
  return v_payment;
end;
$$;
revoke all on function public.submit_booking_payment(uuid,text,text) from public, anon;
grant execute on function public.submit_booking_payment(uuid,text,text) to authenticated;

-- 6) Owner payouts: platform keeps the service fee, owner receives the rent
create table if not exists public.owner_payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  rent_amount numeric(12,2) not null check (rent_amount >= 0),
  service_fee numeric(12,2) not null default 0 check (service_fee >= 0),
  payout_amount numeric(12,2) not null check (payout_amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  created_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id),
  paid_at timestamptz,
  paid_note text check (paid_note is null or char_length(paid_note) <= 1000),
  constraint owner_payouts_paid_fields_check check (
    (status = 'paid' and paid_at is not null and paid_by is not null)
    or (status = 'pending' and paid_at is null and paid_by is null)
  )
);
create index if not exists owner_payouts_owner_created_idx
  on public.owner_payouts(owner_id, created_at desc);
create index if not exists owner_payouts_status_created_idx
  on public.owner_payouts(status, created_at desc);
alter table public.owner_payouts enable row level security;
revoke all on public.owner_payouts from public, anon, authenticated;
grant select on public.owner_payouts to authenticated;
drop policy if exists "Owners and admins can read payouts" on public.owner_payouts;
create policy "Owners and admins can read payouts" on public.owner_payouts
  for select to authenticated using (public.is_admin() or owner_id = auth.uid());

create or replace function public.create_owner_payout_if_ready(p_booking_id uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner uuid;
  v_payout public.owner_payouts%rowtype;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or v_booking.status <> 'completed' then return; end if;
  if not exists (
    select 1 from public.booking_payments p
    where p.booking_id = p_booking_id and p.payment_type = 'rent' and p.status = 'paid'
  ) then return; end if;
  select l.owner_id into v_owner from public.listings l where l.id = v_booking.listing_id;
  if v_owner is null then return; end if;
  insert into public.owner_payouts(booking_id, owner_id, rent_amount, service_fee, payout_amount)
    values (p_booking_id, v_owner, v_booking.total_price, coalesce(v_booking.service_fee,0), v_booking.total_price)
    on conflict (booking_id) do nothing
    returning * into v_payout;
  if found and p_notify then
    insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
      values (v_owner, auth.uid(), 'payout_pending', 'มียอดรอโอนให้คุณ',
        'ค่าเช่า ฿' || to_char(v_payout.payout_amount,'FM999,999,999,990.00') || ' รอแอดมินโอนให้',
        'payment', v_payout.id);
  end if;
end;
$$;
revoke all on function public.create_owner_payout_if_ready(uuid,boolean) from public, anon, authenticated;

create or replace function public.on_booking_completed_create_payout()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform public.create_owner_payout_if_ready(new.id, true);
  end if;
  return new;
end;
$$;
revoke all on function public.on_booking_completed_create_payout() from public, anon, authenticated;
drop trigger if exists bookings_create_owner_payout on public.bookings;
create trigger bookings_create_owner_payout
  after update of status on public.bookings
  for each row execute function public.on_booking_completed_create_payout();

create or replace function public.on_rent_paid_create_payout()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.payment_type = 'rent' and new.status = 'paid' and old.status is distinct from new.status then
    perform public.create_owner_payout_if_ready(new.booking_id, true);
  end if;
  return new;
end;
$$;
revoke all on function public.on_rent_paid_create_payout() from public, anon, authenticated;
drop trigger if exists booking_payments_create_owner_payout on public.booking_payments;
create trigger booking_payments_create_owner_payout
  after update of status on public.booking_payments
  for each row execute function public.on_rent_paid_create_payout();

-- Backfill payouts for bookings that were already completed and paid (no notifications)
do $$
declare r record;
begin
  for r in
    select b.id from public.bookings b
    where b.status = 'completed'
      and exists (select 1 from public.booking_payments p
                  where p.booking_id = b.id and p.payment_type = 'rent' and p.status = 'paid')
  loop
    perform public.create_owner_payout_if_ready(r.id, false);
  end loop;
end;
$$;

create or replace function public.admin_record_owner_payout(
  p_payout_id uuid,
  p_note text,
  p_transfer_completed boolean
)
returns public.owner_payouts
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_payout public.owner_payouts%rowtype;
  v_note text := nullif(trim(coalesce(p_note,'')),'');
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_transfer_completed is not true then
    raise exception 'บันทึกได้หลังโอนเงินให้เจ้าของจริงแล้วเท่านั้น';
  end if;
  if v_note is null or char_length(v_note) < 5 or char_length(v_note) > 1000 then
    raise exception 'กรุณาบันทึกหมายเหตุการโอน 5 ถึง 1,000 ตัวอักษร';
  end if;
  select * into v_payout from public.owner_payouts where id = p_payout_id for update;
  if not found then raise exception 'ไม่พบรายการโอนนี้'; end if;
  if v_payout.status <> 'pending' then raise exception 'รายการนี้บันทึกการโอนไปแล้ว'; end if;
  update public.owner_payouts
    set status = 'paid', paid_by = auth.uid(), paid_at = now(), paid_note = v_note
    where id = p_payout_id
    returning * into v_payout;
  insert into public.notifications(recipient_id,actor_id,kind,title,body,link_type,link_id)
    values (v_payout.owner_id, auth.uid(), 'payout_paid', 'แอดมินโอนค่าเช่าให้คุณแล้ว',
      '฿' || to_char(v_payout.payout_amount,'FM999,999,999,990.00') || ' · ' || v_note,
      'payment', v_payout.id);
  return v_payout;
end;
$$;
revoke all on function public.admin_record_owner_payout(uuid,text,boolean) from public, anon;
grant execute on function public.admin_record_owner_payout(uuid,text,boolean) to authenticated;

-- 7) Finance summary for the admin dashboard
create or replace function public.admin_platform_finance_summary()
returns table (
  service_fee_collected numeric,
  service_fee_awaiting numeric,
  payouts_pending numeric,
  payouts_paid numeric,
  deposits_held numeric,
  deposits_refunded numeric
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  return query select
    coalesce((select sum(coalesce(b.service_fee,0)) from public.bookings b
      where exists (select 1 from public.booking_payments p
        where p.booking_id = b.id and p.payment_type = 'rent' and p.status = 'paid')), 0),
    coalesce((select sum(coalesce(b.service_fee,0)) from public.bookings b
      where b.status in ('approved','completed')
        and not exists (select 1 from public.booking_payments p
          where p.booking_id = b.id and p.payment_type = 'rent' and p.status = 'paid')), 0),
    coalesce((select sum(payout_amount) from public.owner_payouts where status = 'pending'), 0),
    coalesce((select sum(payout_amount) from public.owner_payouts where status = 'paid'), 0),
    coalesce((select sum(amount) from public.booking_payments
      where payment_type = 'deposit' and status in ('paid','refund_pending')), 0),
    coalesce((select sum(amount) from public.booking_payments
      where payment_type = 'deposit' and status = 'refunded'), 0);
end;
$$;
revoke all on function public.admin_platform_finance_summary() from public, anon;
grant execute on function public.admin_platform_finance_summary() to authenticated;

notify pgrst, 'reload schema';
commit;
