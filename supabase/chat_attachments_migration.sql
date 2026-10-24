-- Adds private image and item-card messages without changing existing chat rows or policies.
alter table public.messages
  add column if not exists message_type text not null default 'text',
  add column if not exists image_path text,
  add column if not exists listing_id uuid references public.listings(id) on delete set null,
  add column if not exists wanted_request_id uuid references public.wanted_requests(id) on delete set null;

alter table public.messages
  drop constraint if exists messages_type_payload_check;
alter table public.messages
  add constraint messages_type_payload_check check (
    (message_type = 'text' and image_path is null and listing_id is null and wanted_request_id is null)
    or (message_type = 'image' and image_path is not null and listing_id is null and wanted_request_id is null)
    or (message_type = 'listing' and image_path is null and wanted_request_id is null)
    or (message_type = 'wanted_request' and image_path is null and listing_id is null)
  );

create or replace function public.validate_message()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_listing_owner uuid;
  v_listing_available boolean;
  v_request_owner uuid;
  v_request_status text;
begin
  if new.sender_id is distinct from auth.uid()
    or not exists (
      select 1 from public.conversations c
      where c.id = new.conversation_id
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    ) then
    raise exception 'ไม่มีสิทธิ์ส่งข้อความในการสนทนานี้';
  end if;

  if new.message_type = 'image' then
    if split_part(new.image_path, '/', 1) <> new.conversation_id::text
      or split_part(new.image_path, '/', 2) <> new.sender_id::text
      or split_part(new.image_path, '/', 3) = '' then
      raise exception 'เส้นทางรูปภาพในแชตไม่ถูกต้อง';
    end if;
  elsif new.message_type = 'listing' then
    select owner_id, is_available into v_listing_owner, v_listing_available
      from public.listings where id = new.listing_id;
    if not found or (v_listing_owner <> new.sender_id and v_listing_available is not true) then
      raise exception 'ไม่มีสิทธิ์แชร์ประกาศนี้';
    end if;
  elsif new.message_type = 'wanted_request' then
    select owner_id, status into v_request_owner, v_request_status
      from public.wanted_requests where id = new.wanted_request_id;
    if not found or (v_request_owner <> new.sender_id and v_request_status <> 'open') then
      raise exception 'ไม่มีสิทธิ์แชร์ความต้องการนี้';
    end if;
  elsif new.message_type <> 'text' then
    raise exception 'รูปแบบข้อความนี้ไม่รองรับ';
  end if;

  if new.message_type = 'text' and length(btrim(coalesce(new.body, ''))) = 0 then
    raise exception 'กรุณาพิมพ์ข้อความก่อนส่ง';
  end if;
  new.created_at := now();
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conversation-images',
  'conversation-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Conversation participants read private chat images" on storage.objects;
create policy "Conversation participants read private chat images" on storage.objects
  for select to authenticated using (
    bucket_id = 'conversation-images'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

drop policy if exists "Participants upload private chat images" on storage.objects;
create policy "Participants upload private chat images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'conversation-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

drop policy if exists "Uploaders delete their private chat images" on storage.objects;
create policy "Uploaders delete their private chat images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'conversation-images'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (c.requester_id = auth.uid() or c.owner_id = auth.uid())
    )
  );

create or replace function public.update_conversation_after_message()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_conversation public.conversations%rowtype;
  v_recipient uuid;
  v_preview text;
begin
  v_preview := case new.message_type
    when 'image' then 'ส่งรูปภาพ'
    when 'listing' then 'แชร์ประกาศ: ' || new.body
    when 'wanted_request' then 'แชร์ความต้องการ: ' || new.body
    else new.body
  end;
  update public.conversations
    set last_message = v_preview, last_message_at = new.created_at
    where id = new.conversation_id
    returning * into v_conversation;
  v_recipient := case when new.sender_id = v_conversation.owner_id
    then v_conversation.requester_id else v_conversation.owner_id end;
  insert into public.notifications(recipient_id, actor_id, kind, title, body, link_type, link_id)
    values (v_recipient, new.sender_id, 'chat_message', 'ข้อความใหม่',
      left(v_preview, 160), 'conversation', new.conversation_id);
  return new;
end;
$$;
