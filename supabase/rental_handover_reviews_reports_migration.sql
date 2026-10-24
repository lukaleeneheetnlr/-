-- Add confirmation milestones, rental reviews and issue reports.
-- Run after schema.sql, admin_upload_migration.sql, marketplace_features_migration.sql,
-- and booking_lifecycle_migration.sql. This migration preserves existing rows.

begin;

alter table public.bookings
  add column if not exists owner_handed_over_at timestamptz,
  add column if not exists renter_received_at timestamptz,
  add column if not exists renter_returned_at timestamptz,
  add column if not exists owner_return_received_at timestamptz;

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

create table if not exists public.rental_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rental_reviews_one_per_booking_reviewer unique (booking_id, reviewer_id)
);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rental_reviews'::regclass
      and conname = 'rental_reviews_one_per_booking_reviewer'
  ) then
    if exists (
      select 1 from public.rental_reviews
      group by booking_id, reviewer_id
      having count(*) > 1
    ) then
      raise exception 'Duplicate reviews exist for the same booking and reviewer; inspect them before adding rental_reviews_one_per_booking_reviewer';
    end if;
    alter table public.rental_reviews
      add constraint rental_reviews_one_per_booking_reviewer unique (booking_id, reviewer_id);
  end if;
end;
$$;
create index if not exists rental_reviews_listing_created_idx
  on public.rental_reviews(listing_id, created_at desc) where is_hidden = false;
create index if not exists rental_reviews_reviewee_created_idx
  on public.rental_reviews(reviewee_id, created_at desc) where is_hidden = false;
alter table public.rental_reviews enable row level security;
drop policy if exists "Public can read visible rental reviews" on public.rental_reviews;
drop policy if exists "Members and admins can read rental reviews" on public.rental_reviews;
create policy "Public can read visible rental reviews" on public.rental_reviews
  for select to anon using (not is_hidden);
create policy "Members and admins can read rental reviews" on public.rental_reviews
  for select to authenticated using (not is_hidden or public.is_admin());
revoke insert, update, delete on public.rental_reviews from anon, authenticated;
grant select on public.rental_reviews to anon, authenticated;

create or replace function public.get_listing_review_stats(p_listing_id uuid)
returns table (average_rating numeric, review_count bigint)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(round(avg(r.rating)::numeric, 1), 0), count(*)
  from public.rental_reviews r
  where r.listing_id = p_listing_id and not r.is_hidden;
$$;
revoke all on function public.get_listing_review_stats(uuid) from public;
grant execute on function public.get_listing_review_stats(uuid) to anon, authenticated;

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete restrict,
  listing_id uuid references public.listings(id) on delete restrict,
  reported_user_id uuid,
  review_id uuid references public.rental_reviews(id) on delete set null,
  category text not null check (category in (
    'item_mismatch','cannot_contact','handover_return','damaged_item','user_conduct','other'
  )),
  description text not null check (char_length(description) between 5 and 2000),
  status text not null default 'pending' check (status in ('pending','investigating','resolved')),
  resolution text check (resolution is null or char_length(resolution) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists issue_reports_reporter_created_idx
  on public.issue_reports(reporter_id, created_at desc);
create index if not exists issue_reports_status_created_idx
  on public.issue_reports(status, created_at desc);
alter table public.issue_reports enable row level security;
drop policy if exists "Report parties and admins can read issue reports" on public.issue_reports;
create policy "Report parties and admins can read issue reports" on public.issue_reports
  for select to authenticated using (
    reporter_id = auth.uid()
    or public.is_admin()
    or reported_user_id = auth.uid()
    or exists (
      select 1 from public.bookings b
      join public.listings l on l.id = b.listing_id
      where b.id = booking_id
        and (b.renter_id = auth.uid() or l.owner_id = auth.uid())
    )
    or exists (
      select 1 from public.listings l
      where l.id = listing_id and l.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.rental_reviews r
      where r.id = review_id
        and (r.reviewer_id = auth.uid() or r.reviewee_id = auth.uid())
    )
  );
drop policy if exists "Members create reports about related entities" on public.issue_reports;
create policy "Members create reports about related entities" on public.issue_reports
  for insert to authenticated with check (reporter_id = auth.uid());
revoke update, delete on public.issue_reports from anon, authenticated;
grant select, insert on public.issue_reports to authenticated;

create or replace function public.validate_issue_report()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid;
  v_renter uuid;
begin
  if tg_op = 'INSERT' then
    if new.reporter_id is distinct from auth.uid() then
      raise exception 'ผู้รายงานไม่ตรงกับบัญชีที่เข้าสู่ระบบ';
    end if;
    if new.reported_user_id is not null and (
      new.reported_user_id = new.reporter_id
      or not exists (select 1 from public.profiles where id = new.reported_user_id)
    ) then
      raise exception 'ผู้ใช้ที่รายงานไม่ถูกต้อง';
    end if;
    if new.booking_id is null and new.listing_id is null
      and new.reported_user_id is null and new.review_id is null then
      raise exception 'กรุณาระบุรายการหรือผู้ใช้ที่ต้องการรายงาน';
    end if;
    if new.booking_id is not null then
      perform 1 from public.bookings where id = new.booking_id for update;
    end if;
  elsif new.reporter_id is distinct from old.reporter_id then
    raise exception 'เปลี่ยนผู้รายงานไม่ได้';
  end if;
  if new.booking_id is not null then
    select b.renter_id, l.owner_id into v_renter, v_owner
      from public.bookings b join public.listings l on l.id = b.listing_id
      where b.id = new.booking_id;
    if not found or new.reporter_id not in (v_renter, v_owner) then
      raise exception 'รายงานการเช่าได้เฉพาะคู่สัญญาที่เกี่ยวข้อง';
    end if;
    if new.listing_id is not null and not exists (
      select 1 from public.bookings b
      where b.id = new.booking_id and b.listing_id = new.listing_id
    ) then
      raise exception 'ประกาศไม่ตรงกับรายการเช่า';
    end if;
    if new.reported_user_id is not null and new.reported_user_id not in (v_renter, v_owner) then
      raise exception 'ผู้ใช้ที่รายงานไม่ใช่คู่สัญญาของการเช่านี้';
    end if;
  end if;
  if new.review_id is not null then
    if not exists (select 1 from public.rental_reviews where id = new.review_id) then
      raise exception 'ไม่พบรีวิวที่ถูกรายงาน';
    end if;
  end if;
  if new.listing_id is not null and not exists (
    select 1 from public.listings where id = new.listing_id
  ) then
    raise exception 'ไม่พบประกาศที่ถูกรายงาน';
  end if;
  if new.listing_id is not null and new.reported_user_id is not null and not exists (
    select 1 from public.listings where id = new.listing_id and owner_id = new.reported_user_id
  ) and new.booking_id is null then
    raise exception 'ผู้ใช้ที่รายงานไม่ใช่เจ้าของประกาศนี้';
  end if;
  if new.review_id is not null and new.listing_id is not null and not exists (
    select 1 from public.rental_reviews where id = new.review_id and listing_id = new.listing_id
  ) then
    raise exception 'รีวิวไม่ตรงกับประกาศที่ระบุ';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists issue_reports_validate on public.issue_reports;
create trigger issue_reports_validate
  before insert or update on public.issue_reports
  for each row execute function public.validate_issue_report();

create or replace function public.submit_rental_review(
  p_booking_id uuid,
  p_rating smallint,
  p_comment text default ''
)
returns public.rental_reviews
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner uuid;
  v_review public.rental_reviews%rowtype;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'คะแนนต้องอยู่ระหว่าง 1 ถึง 5 ดาว'; end if;
  if char_length(coalesce(p_comment, '')) > 1000 then raise exception 'ความคิดเห็นยาวเกิน 1,000 ตัวอักษร'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'ไม่พบรายการเช่านี้'; end if;
  if v_booking.renter_id is distinct from auth.uid() then
    raise exception 'เฉพาะผู้เช่าที่ทำรายการนี้เท่านั้นที่รีวิวได้';
  end if;
  if v_booking.status <> 'completed' then
    raise exception 'รีวิวได้หลังเจ้าของยืนยันรับคืนและปิดการเช่าแล้วเท่านั้น';
  end if;
  select owner_id into v_owner from public.listings where id = v_booking.listing_id;
  if v_owner is null then raise exception 'ไม่พบเจ้าของประกาศ'; end if;
  insert into public.rental_reviews(booking_id, listing_id, reviewer_id, reviewee_id, rating, comment)
    values (v_booking.id, v_booking.listing_id, auth.uid(), v_owner, p_rating, coalesce(p_comment, ''))
    returning * into v_review;
  insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
    values (v_owner, auth.uid(), 'review_received', 'ได้รับรีวิวใหม่',
      'ผู้เช่าให้คะแนน ' || p_rating || ' ดาว', 'review', v_review.id);
  return v_review;
end;
$$;
revoke all on function public.submit_rental_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_rental_review(uuid, smallint, text) to authenticated;

create or replace function public.confirm_booking_milestone(
  p_booking_id uuid,
  p_action text
)
returns public.bookings
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_owner uuid;
  v_recipient uuid;
  v_kind text;
  v_text text;
  v_has_open_report boolean;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_action is null or p_action not in ('owner_handover','renter_received','renter_return','owner_return') then
    raise exception 'ขั้นตอนยืนยันนี้ไม่ถูกต้อง';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'ไม่พบรายการเช่านี้'; end if;
  select owner_id into v_owner from public.listings where id = v_booking.listing_id;
  if v_booking.status <> 'approved' then
    raise exception 'ขั้นตอนรับคืนใช้ได้เฉพาะรายการที่อนุมัติแล้ว';
  end if;

  if p_action = 'owner_handover' then
    if auth.uid() is distinct from v_owner then raise exception 'เฉพาะเจ้าของประกาศยืนยันส่งมอบได้'; end if;
    if v_booking.owner_handed_over_at is not null then raise exception 'ยืนยันส่งมอบรายการนี้แล้ว'; end if;
    if (now() at time zone 'Asia/Bangkok')::date < v_booking.start_date then
      raise exception 'ยังไม่ถึงวันเริ่มเช่าที่ระบุ';
    end if;
    update public.bookings set owner_handed_over_at = now() where id = p_booking_id returning * into v_booking;
    v_recipient := v_booking.renter_id; v_kind := 'booking_handover'; v_text := 'เจ้าของยืนยันส่งมอบสินค้าแล้ว';
  elsif p_action = 'renter_received' then
    if auth.uid() is distinct from v_booking.renter_id then raise exception 'เฉพาะผู้เช่ายืนยันรับสินค้าได้'; end if;
    if v_booking.owner_handed_over_at is null then raise exception 'รอเจ้าของยืนยันส่งมอบสินค้าก่อน'; end if;
    if v_booking.renter_received_at is not null then raise exception 'ยืนยันรับสินค้านี้แล้ว'; end if;
    update public.bookings set renter_received_at = now() where id = p_booking_id returning * into v_booking;
    v_recipient := v_owner; v_kind := 'booking_received'; v_text := 'ผู้เช่ายืนยันว่าได้รับสินค้าแล้ว';
  elsif p_action = 'renter_return' then
    if auth.uid() is distinct from v_booking.renter_id then raise exception 'เฉพาะผู้เช่าแจ้งคืนสินค้าได้'; end if;
    if v_booking.renter_received_at is null then raise exception 'ยังไม่มีการยืนยันรับสินค้า'; end if;
    if v_booking.renter_returned_at is not null then raise exception 'แจ้งคืนสินค้านี้แล้ว'; end if;
    if (now() at time zone 'Asia/Bangkok')::date < v_booking.end_date then
      raise exception 'ยังไม่ถึงวันที่กำหนดคืนสินค้า';
    end if;
    update public.bookings set renter_returned_at = now() where id = p_booking_id returning * into v_booking;
    v_recipient := v_owner; v_kind := 'booking_returned'; v_text := 'ผู้เช่าแจ้งว่าคืนสินค้าแล้ว กรุณาตรวจสอบ';
  else
    if auth.uid() is distinct from v_owner then raise exception 'เฉพาะเจ้าของประกาศยืนยันรับคืนได้'; end if;
    if v_booking.renter_returned_at is null then raise exception 'รอผู้เช่าแจ้งคืนสินค้าก่อน'; end if;
    if v_booking.owner_return_received_at is not null then raise exception 'ยืนยันรับคืนสินค้านี้แล้ว'; end if;
    select exists (
      select 1 from public.issue_reports r
      where r.booking_id = p_booking_id and r.status <> 'resolved'
    ) into v_has_open_report;
    update public.bookings set owner_return_received_at = now() where id = p_booking_id returning * into v_booking;
    if not v_has_open_report then
      update public.bookings set status = 'completed' where id = p_booking_id returning * into v_booking;
    end if;
    v_recipient := case when v_has_open_report then v_booking.renter_id else null end;
    v_kind := case when v_has_open_report then 'booking_returned' else 'booking_completed' end;
    v_text := case when v_has_open_report
      then 'เจ้าของยืนยันรับคืนแล้ว แต่การเช่ายังรอการตรวจสอบปัญหา'
      else 'เจ้าของยืนยันรับคืนแล้ว การเช่าเสร็จสิ้น' end;
  end if;

  if v_recipient is not null and v_recipient <> auth.uid() then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (v_recipient, auth.uid(), v_kind, v_text, v_text, 'booking', p_booking_id);
  end if;
  if p_action = 'owner_return' and v_booking.status = 'completed' then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (v_owner, auth.uid(), 'booking_completed', 'การเช่าเสร็จสิ้น',
        'ยืนยันรับคืนสินค้าและปิดการเช่าแล้ว', 'booking', p_booking_id);
  end if;
  return v_booking;
end;
$$;
revoke all on function public.confirm_booking_milestone(uuid, text) from public, anon;
grant execute on function public.confirm_booking_milestone(uuid, text) to authenticated;
revoke all on function public.complete_booking(uuid) from public, anon, authenticated;

create or replace function public.admin_update_issue_report(
  p_report_id uuid,
  p_status text,
  p_resolution text default null,
  p_hide_review boolean default null
)
returns public.issue_reports
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_report public.issue_reports%rowtype;
  v_booking_id uuid;
  v_owner uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'ไม่มีสิทธิ์ผู้ดูแลระบบ' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending','investigating','resolved') then raise exception 'สถานะรายงานไม่ถูกต้อง'; end if;
  if char_length(coalesce(p_resolution, '')) > 2000 then raise exception 'บันทึกผลยาวเกิน 2,000 ตัวอักษร'; end if;
  select * into v_report from public.issue_reports where id = p_report_id for update;
  if not found then raise exception 'ไม่พบรายงานนี้'; end if;
  if v_report.review_id is not null and p_hide_review is not null then
    update public.rental_reviews set is_hidden = p_hide_review where id = v_report.review_id;
  end if;
  update public.issue_reports
    set status = p_status,
        resolution = nullif(trim(coalesce(p_resolution, '')), '')
    where id = p_report_id returning * into v_report;
  if v_report.status = 'resolved' and v_report.booking_id is not null then
    select id into v_booking_id from public.bookings
      where id = v_report.booking_id and status = 'approved'
        and owner_return_received_at is not null
        and renter_returned_at is not null
        and owner_handed_over_at is not null
        and renter_received_at is not null
        and not exists (
          select 1 from public.issue_reports open_report
          where open_report.booking_id = public.bookings.id
            and open_report.status <> 'resolved'
        )
      for update;
    if v_booking_id is not null then
      update public.bookings set status = 'completed' where id = v_booking_id;
      select l.owner_id into v_owner
        from public.bookings b join public.listings l on l.id = b.listing_id
        where b.id = v_booking_id;
      if v_owner is not null and v_owner <> auth.uid() then
        insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
          values (v_owner, auth.uid(), 'booking_completed', 'การเช่าเสร็จสิ้น',
            'การตรวจสอบเสร็จสิ้นและปิดการเช่าแล้ว', 'booking', v_booking_id);
      end if;
    end if;
  end if;
  return v_report;
end;
$$;
revoke all on function public.admin_update_issue_report(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_update_issue_report(uuid, text, text, boolean) to authenticated;

create or replace function public.notify_issue_report_updates()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (new.reporter_id, new.reporter_id, 'report_updated',
        'ได้รับรายงานปัญหาแล้ว', 'สถานะรายงาน: รอตรวจสอบ', 'report', new.id);
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      select p.id, new.reporter_id, 'report_updated', 'มีรายงานปัญหาใหม่',
        'มีรายการใหม่รอตรวจสอบ', 'report', new.id
      from public.profiles p
      where p.is_admin and p.id <> new.reporter_id;
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (new.reporter_id, auth.uid(), 'report_updated',
        'อัปเดตสถานะรายงาน', 'สถานะรายงาน: ' ||
          case new.status when 'pending' then 'รอตรวจสอบ'
            when 'investigating' then 'กำลังตรวจสอบ' else 'ดำเนินการแล้ว' end,
        'report', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists issue_reports_notify_changes on public.issue_reports;
create trigger issue_reports_notify_changes
  after insert or update of status on public.issue_reports
  for each row execute function public.notify_issue_report_updates();
revoke all on function public.notify_issue_report_updates() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
