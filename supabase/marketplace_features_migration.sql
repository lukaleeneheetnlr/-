-- Additive marketplace features for existing Campus Sharing Hub installations.
-- The frontend uses wanted_offers (not a table named offers).
-- Run after schema.sql and admin_upload_migration.sql in Supabase SQL Editor.

alter table public.listings
  add column if not exists pickup_latitude double precision,
  add column if not exists pickup_longitude double precision;

alter table public.listings
  drop constraint if exists listings_public_coordinates_valid;
alter table public.listings
  add constraint listings_public_coordinates_valid check (
    (pickup_latitude is null and pickup_longitude is null)
    or (
      pickup_latitude is not null
      and pickup_longitude is not null
      and pickup_latitude between -90 and 90
      and pickup_longitude between -180 and 180
    )
  );

create or replace function public.round_public_pickup_coordinates()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pickup_latitude is null or new.pickup_longitude is null then
    return new;
  end if;
  if new.pickup_latitude not between -90 and 90
    or new.pickup_longitude not between -180 and 180 then
    raise exception 'พิกัดจุดรับไม่ถูกต้อง';
  end if;
  new.pickup_latitude := round(new.pickup_latitude::numeric, 3)::double precision;
  new.pickup_longitude := round(new.pickup_longitude::numeric, 3)::double precision;
  return new;
end;
$$;
drop trigger if exists listings_round_public_pickup_coordinates on public.listings;
create trigger listings_round_public_pickup_coordinates
  before insert or update of pickup_latitude, pickup_longitude on public.listings
  for each row execute function public.round_public_pickup_coordinates();
revoke all on function public.round_public_pickup_coordinates() from public, anon, authenticated;

create table if not exists public.wanted_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  category text not null check (category in ('media','study','event','fashion','other')),
  budget_per_day numeric(12,2) not null check (budget_per_day > 0),
  requested_date date not null,
  duration text not null check (char_length(duration) between 1 and 80),
  pickup_zone text not null check (char_length(pickup_zone) between 2 and 100),
  details text not null default '' check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wanted_offers (
  id uuid primary key default gen_random_uuid(),
  wanted_request_id uuid not null references public.wanted_requests(id) on delete cascade,
  offerer_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  message text not null check (char_length(message) between 1 and 500),
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wanted_offers_one_per_listing
  on public.wanted_offers(wanted_request_id, offerer_id, listing_id)
  where listing_id is not null;
create unique index if not exists wanted_offers_one_without_listing
  on public.wanted_offers(wanted_request_id, offerer_id)
  where listing_id is null;
create index if not exists wanted_requests_open_created
  on public.wanted_requests(status, created_at desc);
create index if not exists wanted_requests_owner_created
  on public.wanted_requests(owner_id, created_at desc);
create index if not exists wanted_offers_request_created
  on public.wanted_offers(wanted_request_id, created_at desc);
create index if not exists wanted_offers_offerer_created
  on public.wanted_offers(offerer_id, created_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  last_message text,
  last_message_at timestamptz,
  requester_last_read_at timestamptz not null default now(),
  owner_last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversation_participants_are_distinct check (requester_id <> owner_id),
  constraint conversation_listing_requester_unique unique (listing_id, requester_id)
);
alter table public.conversations
  add column if not exists requester_last_read_at timestamptz not null default now(),
  add column if not exists owner_last_read_at timestamptz not null default now();
create index if not exists conversations_requester_last_message
  on public.conversations(requester_id, last_message_at desc nulls last);
create index if not exists conversations_owner_last_message
  on public.conversations(owner_id, last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created
  on public.messages(conversation_id, created_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in (
    'booking_requested','booking_approved','booking_rejected','booking_cancelled',
    'chat_message','offer_submitted','offer_accepted','offer_declined','request_closed'
  )),
  title text not null,
  body text not null,
  link_type text not null check (link_type in ('listing','booking','conversation','wanted_request','offer')),
  link_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_unread
  on public.notifications(recipient_id, created_at desc) where read_at is null;

alter table public.wanted_requests enable row level security;
alter table public.wanted_offers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Open wanted requests are public" on public.wanted_requests;
create policy "Open wanted requests are public" on public.wanted_requests
  for select to anon, authenticated using (status = 'open' or owner_id = auth.uid());
drop policy if exists "Members create own wanted requests" on public.wanted_requests;
create policy "Members create own wanted requests" on public.wanted_requests
  for insert to authenticated with check (owner_id = auth.uid() and status = 'open');
drop policy if exists "Owners update own wanted requests" on public.wanted_requests;
create policy "Owners update own wanted requests" on public.wanted_requests
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Wanted request parties read offers" on public.wanted_offers;
create policy "Wanted request parties read offers" on public.wanted_offers
  for select to authenticated using (
    offerer_id = auth.uid()
    or exists (
      select 1 from public.wanted_requests r
      where r.id = wanted_request_id and r.owner_id = auth.uid()
    )
  );
drop policy if exists "Members submit own offers" on public.wanted_offers;
create policy "Members submit own offers" on public.wanted_offers
  for insert to authenticated with check (offerer_id = auth.uid() and status = 'pending');
drop policy if exists "Request owners update offer status" on public.wanted_offers;
create policy "Request owners update offer status" on public.wanted_offers
  for update to authenticated using (
    exists (
      select 1 from public.wanted_requests r
      where r.id = wanted_request_id and r.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.wanted_requests r
      where r.id = wanted_request_id and r.owner_id = auth.uid()
    )
  );

drop policy if exists "Conversation participants read conversations" on public.conversations;
create policy "Conversation participants read conversations" on public.conversations
  for select to authenticated using (requester_id = auth.uid() or owner_id = auth.uid());
drop policy if exists "Conversation participants read messages" on public.messages;
create policy "Conversation participants read messages" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    )
  );
drop policy if exists "Participants send messages" on public.messages;
create policy "Participants send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications
  for select to authenticated using (recipient_id = auth.uid());
drop policy if exists "Users update own notification read state" on public.notifications;
create policy "Users update own notification read state" on public.notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.start_listing_conversation(p_listing_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_available boolean;
  v_conversation public.conversations%rowtype;
begin
  if v_user is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select owner_id, is_available into v_owner, v_available from public.listings
    where id = p_listing_id;
  if not found then raise exception 'ไม่พบประกาศหรือรายการนี้ไม่พร้อมให้เช่า'; end if;
  if v_owner = v_user then raise exception 'ไม่สามารถเริ่มแชตกับประกาศของตัวเองได้'; end if;
  if not v_available and not exists (
    select 1 from public.bookings b
    where b.listing_id = p_listing_id and b.renter_id = v_user
  ) and not exists (
    select 1 from public.wanted_offers o
    join public.wanted_requests r on r.id = o.wanted_request_id
    where o.listing_id = p_listing_id
      and o.offerer_id = v_owner
      and r.owner_id = v_user
  ) then
    raise exception 'รายการนี้ไม่พร้อมให้เริ่มแชต';
  end if;
  insert into public.conversations(listing_id, requester_id, owner_id)
    values (p_listing_id, v_user, v_owner)
    on conflict (listing_id, requester_id) do update set listing_id = excluded.listing_id
    returning * into v_conversation;
  return v_conversation;
end;
$$;
revoke all on function public.start_listing_conversation(uuid) from public, anon;
grant execute on function public.start_listing_conversation(uuid) to authenticated;

create or replace function public.start_booking_conversation(p_booking_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_listing uuid;
  v_renter uuid;
  v_owner uuid;
  v_conversation public.conversations%rowtype;
begin
  if v_user is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select b.listing_id, b.renter_id, l.owner_id
    into v_listing, v_renter, v_owner
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    where b.id = p_booking_id;
  if not found then raise exception 'ไม่พบคำขอจองนี้'; end if;
  if v_user <> v_renter and v_user <> v_owner then
    raise exception 'คุณไม่ใช่คู่กรณีของการจองนี้';
  end if;
  insert into public.conversations(listing_id, requester_id, owner_id)
    values (v_listing, v_renter, v_owner)
    on conflict (listing_id, requester_id) do update set listing_id = excluded.listing_id
    returning * into v_conversation;
  return v_conversation;
end;
$$;
revoke all on function public.start_booking_conversation(uuid) from public, anon;
grant execute on function public.start_booking_conversation(uuid) to authenticated;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  update public.conversations
    set requester_last_read_at = case when requester_id = auth.uid() then now() else requester_last_read_at end,
        owner_last_read_at = case when owner_id = auth.uid() then now() else owner_last_read_at end
    where id = p_conversation_id
      and (requester_id = auth.uid() or owner_id = auth.uid());
  if not found then raise exception 'ไม่พบบทสนทนาหรือคุณไม่มีสิทธิ์เข้าถึง'; end if;
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.conversation_unread_count(p_conversation_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  select count(*) into v_count
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.id = p_conversation_id
    and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    and m.sender_id <> auth.uid()
    and m.created_at > case when c.requester_id = auth.uid()
      then c.requester_last_read_at else c.owner_last_read_at end;
  return v_count;
end;
$$;
revoke all on function public.conversation_unread_count(uuid) from public, anon;
grant execute on function public.conversation_unread_count(uuid) to authenticated;

create or replace function public.validate_wanted_offer()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid;
  v_listing_owner uuid;
begin
  select owner_id into v_owner from public.wanted_requests
    where id = new.wanted_request_id;
  if not found then raise exception 'คำขอนี้ปิดแล้วหรือไม่มีอยู่'; end if;
  if new.offerer_id = v_owner then raise exception 'ไม่สามารถส่งข้อเสนอให้คำขอของตัวเองได้'; end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.wanted_requests
    where id = new.wanted_request_id and status = 'open'
  ) then
    raise exception 'คำขอนี้ปิดแล้วหรือไม่มีอยู่';
  end if;
  if tg_op = 'INSERT' and new.offerer_id is distinct from auth.uid() then
    raise exception 'ผู้ส่งข้อเสนอไม่ตรงกับบัญชีที่เข้าสู่ระบบ';
  end if;
  if tg_op = 'INSERT' and new.listing_id is not null then
    select owner_id into v_listing_owner from public.listings
      where id = new.listing_id and is_available = true;
    if not found or v_listing_owner is distinct from new.offerer_id then
      raise exception 'เลือกได้เฉพาะประกาศที่ยังเปิดและเป็นของคุณ';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' or new.status not in ('accepted','declined') then
      raise exception 'เปลี่ยนสถานะข้อเสนอนี้ไม่ได้';
    end if;
    if v_owner is distinct from auth.uid() then
      raise exception 'เฉพาะเจ้าของคำขอเท่านั้นที่จัดการข้อเสนอได้';
    end if;
    if new.wanted_request_id <> old.wanted_request_id
      or new.offerer_id <> old.offerer_id
      or new.listing_id is distinct from old.listing_id
      or new.message <> old.message then
      raise exception 'แก้รายละเอียดข้อเสนอหลังส่งไม่ได้';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists wanted_offers_validate on public.wanted_offers;
create trigger wanted_offers_validate
  before insert or update on public.wanted_offers
  for each row execute function public.validate_wanted_offer();

create or replace function public.validate_wanted_request_update()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.owner_id <> old.owner_id or old.owner_id is distinct from auth.uid() then
    raise exception 'ไม่มีสิทธิ์แก้ไขคำขอนี้';
  end if;
  if new.status not in ('open','closed') or (old.status = 'closed' and new.status = 'open') then
    raise exception 'สถานะคำขอนี้ไม่สามารถเปลี่ยนได้';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists wanted_requests_validate_update on public.wanted_requests;
create trigger wanted_requests_validate_update
  before update on public.wanted_requests
  for each row execute function public.validate_wanted_request_update();

create or replace function public.respond_to_wanted_offer(p_offer_id uuid, p_status text)
returns public.wanted_offers
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_offer public.wanted_offers%rowtype;
  v_owner uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อน'; end if;
  if p_status is null or p_status not in ('accepted','declined') then raise exception 'สถานะนี้ไม่อนุญาต'; end if;
  select * into v_offer from public.wanted_offers where id = p_offer_id for update;
  if not found then raise exception 'ไม่พบข้อเสนอนี้'; end if;
  select owner_id into v_owner from public.wanted_requests where id = v_offer.wanted_request_id for update;
  if v_owner is distinct from auth.uid() then raise exception 'เฉพาะเจ้าของคำขอเท่านั้นที่จัดการข้อเสนอได้'; end if;
  if v_offer.status <> 'pending' then raise exception 'ข้อเสนอนี้ได้รับคำตอบแล้ว'; end if;
  update public.wanted_offers set status = p_status
    where id = p_offer_id returning * into v_offer;
  if p_status = 'accepted' then
    update public.wanted_requests set status = 'closed'
      where id = v_offer.wanted_request_id and status = 'open';
  end if;
  return v_offer;
end;
$$;
revoke all on function public.respond_to_wanted_offer(uuid, text) from public, anon;
grant execute on function public.respond_to_wanted_offer(uuid, text) to authenticated;

create or replace function public.notify_wanted_request_closed()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      select distinct o.offerer_id, auth.uid(), 'request_closed',
        'ความต้องการนี้ปิดรับข้อเสนอแล้ว', 'เจ้าของปิดรับข้อเสนอ: ' || new.title,
        'offer', o.id
      from public.wanted_offers o
      where o.wanted_request_id = new.id
        and o.offerer_id <> auth.uid()
        and o.status = 'pending';
  end if;
  return new;
end;
$$;
drop trigger if exists wanted_requests_notify_closed on public.wanted_requests;
create trigger wanted_requests_notify_closed
  after update of status on public.wanted_requests
  for each row execute function public.notify_wanted_request_closed();

create or replace function public.validate_message()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.sender_id is distinct from auth.uid()
    or not exists (
      select 1 from public.conversations c
      where c.id = new.conversation_id
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    ) then
    raise exception 'ไม่มีสิทธิ์ส่งข้อความในการสนทนานี้';
  end if;
    new.created_at := now();
    return new;
end;
$$;
drop trigger if exists messages_validate_sender on public.messages;
create trigger messages_validate_sender
  before insert on public.messages
  for each row execute function public.validate_message();

create or replace function public.update_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_conversation public.conversations%rowtype;
  v_recipient uuid;
begin
  update public.conversations
    set last_message = new.body, last_message_at = new.created_at
    where id = new.conversation_id
    returning * into v_conversation;
  v_recipient := case when new.sender_id = v_conversation.owner_id
    then v_conversation.requester_id else v_conversation.owner_id end;
  insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
    values (v_recipient, new.sender_id, 'chat_message', 'ข้อความใหม่',
      left(new.body, 160), 'conversation', new.conversation_id);
  return new;
end;
$$;
drop trigger if exists messages_update_conversation on public.messages;
create trigger messages_update_conversation
  after insert on public.messages
  for each row execute function public.update_conversation_after_message();

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
    v_kind := 'booking_requested'; v_recipient := v_owner;
    v_text := 'มีคำขอจองสำหรับ ' || v_title;
  elsif new.status is distinct from old.status then
    if new.status not in ('approved','rejected','cancelled') then return new; end if;
    v_kind := case new.status
      when 'approved' then 'booking_approved'
      when 'rejected' then 'booking_rejected'
      else 'booking_cancelled'
    end;
    v_recipient := case when new.status = 'cancelled' then v_owner else new.renter_id end;
    v_text := case new.status
      when 'approved' then 'คำขอจอง ' || v_title || ' ได้รับอนุมัติ'
      when 'rejected' then 'คำขอจอง ' || v_title || ' ถูกปฏิเสธ'
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
drop trigger if exists bookings_notify_changes on public.bookings;
create trigger bookings_notify_changes
  after insert or update of status on public.bookings
  for each row execute function public.notify_booking_changes();

create or replace function public.notify_wanted_offer_changes()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_owner uuid;
  v_title text;
  v_recipient uuid;
  v_kind text;
  v_body text;
begin
  select owner_id, title into v_owner, v_title
    from public.wanted_requests where id = new.wanted_request_id;
  if tg_op = 'INSERT' then
    v_recipient := v_owner; v_kind := 'offer_submitted';
    v_body := 'มีข้อเสนอใหม่สำหรับ ' || v_title;
  elsif new.status is distinct from old.status then
    if new.status not in ('accepted','declined') then return new; end if;
    v_recipient := new.offerer_id;
    v_kind := case new.status when 'accepted' then 'offer_accepted' else 'offer_declined' end;
    v_body := case new.status when 'accepted' then 'ข้อเสนอของคุณได้รับการตอบรับ' else 'ข้อเสนอของคุณถูกปฏิเสธ' end || ': ' || v_title;
  else
    return new;
  end if;
  if v_recipient is not null and v_recipient <> auth.uid() then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (v_recipient, auth.uid(), v_kind, v_body, v_body, 'offer', new.id);
  end if;
  if tg_op = 'INSERT' then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (new.offerer_id, new.offerer_id, 'offer_submitted', 'ส่งข้อเสนอแล้ว',
        'ข้อเสนอของคุณถูกส่งไปยังเจ้าของความต้องการ', 'offer', new.id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
      values (v_owner, auth.uid(), v_kind, v_body, v_body, 'offer', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists wanted_offers_notify_changes on public.wanted_offers;
create trigger wanted_offers_notify_changes
  after insert or update of status on public.wanted_offers
  for each row execute function public.notify_wanted_offer_changes();

revoke all on function public.validate_wanted_offer() from public, anon, authenticated;
revoke all on function public.validate_wanted_request_update() from public, anon, authenticated;
revoke all on function public.validate_message() from public, anon, authenticated;
revoke all on function public.update_conversation_after_message() from public, anon, authenticated;
revoke all on function public.notify_booking_changes() from public, anon, authenticated;
revoke all on function public.notify_wanted_offer_changes() from public, anon, authenticated;
revoke all on function public.notify_wanted_request_closed() from public, anon, authenticated;

grant select, insert on public.wanted_requests to authenticated;
grant update (title, category, budget_per_day, requested_date, duration, pickup_zone, details, status)
  on public.wanted_requests to authenticated;
grant select on public.wanted_requests to anon, authenticated;
grant select, insert on public.wanted_offers to authenticated;
grant update (status) on public.wanted_offers to authenticated;
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then alter publication supabase_realtime add table public.messages; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then alter publication supabase_realtime add table public.notifications; end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
