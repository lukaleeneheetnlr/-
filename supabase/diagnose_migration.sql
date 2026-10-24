-- Read-only diagnostics for notification and listing constraint migration errors.
-- Run separately in Supabase Dashboard > SQL Editor > New query.
-- This file contains SELECT statements only and does not modify the database.

-- Current definitions for notification kind/link type and listing text checks.
select
  n.nspname as schema_name,
  t.relname as table_name,
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid, true) as constraint_definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and (
    (t.relname = 'notifications' and c.conname in (
      'notifications_kind_check', 'notifications_link_type_check'
    ))
    or (
      t.relname = 'listings'
      and c.contype = 'c'
      and (
        c.conname ilike '%location%'
        or c.conname ilike '%condition%'
        or c.conname ilike '%description%'
      )
    )
  )
order by t.relname, c.conname;

-- Counts for every supported kind, plus any unexpected kinds currently stored.
select
  coalesce(expected.kind, actual.kind) as kind,
  coalesce(actual.row_count, 0) as row_count,
  expected.kind is not null as in_expected_set
from (values
  ('booking_requested'), ('booking_approved'), ('booking_rejected'),
  ('booking_cancelled'), ('booking_completed'), ('booking_handover'),
  ('booking_received'), ('booking_returned'), ('review_received'),
  ('report_updated'), ('chat_message'), ('offer_submitted'),
  ('offer_accepted'), ('offer_declined'), ('request_closed'),
  ('payment_submitted'), ('payment_verified'), ('payment_rejected'),
  ('deposit_refund_pending'), ('deposit_refunded'), ('payout_pending'),
  ('payout_paid'), ('meeting_point_updated')
) as expected(kind)
full join (
  select kind, count(*) as row_count
  from public.notifications
  group by kind
) as actual on actual.kind = expected.kind
order by in_expected_set desc, kind;

-- Explicit list of stored values outside the 23 supported kinds.
select kind, count(*) as row_count
from public.notifications
where kind <> all(array[
  'booking_requested', 'booking_approved', 'booking_rejected',
  'booking_cancelled', 'booking_completed', 'booking_handover',
  'booking_received', 'booking_returned', 'review_received',
  'report_updated', 'chat_message', 'offer_submitted', 'offer_accepted',
  'offer_declined', 'request_closed', 'payment_submitted',
  'payment_verified', 'payment_rejected', 'deposit_refund_pending',
  'deposit_refunded', 'payout_pending', 'payout_paid',
  'meeting_point_updated'
]::text[])
group by kind
order by kind;

-- Counts for stored link types and a flag for types used by the application.
select
  link_type,
  count(*) as row_count,
  link_type = any(array[
    'listing', 'booking', 'conversation', 'wanted_request',
    'offer', 'review', 'report', 'payment'
  ]::text[]) as in_expected_set
from public.notifications
group by link_type
order by link_type;

-- Number of listings whose current values violate the optional field lengths.
select
  count(*) filter (
    where location is not null and char_length(location) not between 2 and 100
  ) as invalid_location_count,
  count(*) filter (
    where condition is not null and char_length(condition) not between 2 and 120
  ) as invalid_condition_count,
  count(*) filter (
    where description is not null and char_length(description) not between 2 and 500
  ) as invalid_description_count
from public.listings;
