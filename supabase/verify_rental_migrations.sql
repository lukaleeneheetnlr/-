-- Read-only checks for the Campus Sharing Hub schema and the four rental
-- migrations. Run after applying migrations; this file does not change data.

-- Required base and feature tables.
select expected.table_name,
       to_regclass(format('%I.%I', 'public', expected.table_name)) is not null as exists
from (values
  ('profiles'), ('listings'), ('bookings'), ('notifications'),
  ('conversations'), ('messages'), ('wanted_requests'), ('wanted_offers'),
  ('rental_reviews'), ('issue_reports'), ('payment_settings'),
  ('booking_payments'), ('booking_payment_events'), ('profile_contacts'),
  ('booking_evidence'), ('issue_report_evidence')
) as expected(table_name)
order by expected.table_name;

-- The migration-history table can vary by deployment workflow. A NULL result
-- means this SQL Editor cannot find this conventional Supabase CLI history table.
select to_regclass('supabase_migrations.schema_migrations') as supabase_cli_migration_history_table;

-- Required columns used by the profile, booking, payment and evidence UI/RPCs.
select expected.table_name, expected.column_name,
       actual.column_name is not null as exists,
       actual.is_nullable,
       actual.data_type
from (values
  ('profiles','full_name'), ('profiles','university'), ('profiles','is_admin'),
  ('profiles','bio'), ('profiles','avatar_url'), ('profiles','avatar_path'),
  ('listings','owner_id'), ('listings','image_url'), ('listings','image_path'),
  ('bookings','listing_id'), ('bookings','renter_id'), ('bookings','status'),
  ('bookings','price_per_day'), ('bookings','deposit'),
  ('bookings','owner_handed_over_at'), ('bookings','renter_received_at'),
  ('bookings','renter_returned_at'), ('bookings','owner_return_received_at'),
  ('bookings','renter_contact_phone'), ('bookings','owner_contact_phone'),
  ('booking_payments','proof_path'), ('booking_payments','status'),
  ('booking_payment_events','payment_id'), ('profile_contacts','phone'),
  ('booking_evidence','milestone'), ('booking_evidence','storage_path'),
  ('issue_report_evidence','report_id'), ('issue_report_evidence','storage_path')
) as expected(table_name,column_name)
left join information_schema.columns actual
  on actual.table_schema='public'
 and actual.table_name=expected.table_name
 and actual.column_name=expected.column_name
order by expected.table_name, expected.column_name;

-- RLS must be enabled on sensitive tables. Review every returned policy because
-- PostgreSQL permissive policies combine with OR.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'profiles','bookings','notifications','conversations','messages',
    'wanted_requests','wanted_offers','rental_reviews','issue_reports',
    'booking_payments','booking_payment_events','profile_contacts',
    'booking_evidence','issue_report_evidence'
  )
order by c.relname;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in (
    'profiles','bookings','notifications','conversations','messages',
    'wanted_requests','wanted_offers','rental_reviews','issue_reports',
    'booking_payments','booking_payment_events','profile_contacts',
    'booking_evidence','issue_report_evidence'
  )
order by tablename, policyname;

-- Important named constraints. Missing rows indicate a migration/dependency gap.
select t.relname as table_name, c.conname as constraint_name,
       c.contype as constraint_type, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public'
  and c.conname in (
    'approved_dates_do_not_overlap','bookings_dates_are_valid',
    'rental_reviews_one_per_booking_reviewer','booking_payments_review_fields_check',
    'booking_payments_refund_fields_check','profiles_bio_length_check',
    'profiles_avatar_pair_check','bookings_contact_phone_length_check'
  )
order by t.relname, c.conname;

-- Profile updates must be column-scoped; is_admin must not be user-editable.
select has_table_privilege('authenticated','public.profiles','UPDATE') as authenticated_can_update_all_profile_columns,
       has_column_privilege('authenticated','public.profiles','full_name','UPDATE') as can_update_full_name,
       has_column_privilege('authenticated','public.profiles','university','UPDATE') as can_update_university,
       has_column_privilege('authenticated','public.profiles','bio','UPDATE') as can_update_bio,
       has_column_privilege('authenticated','public.profiles','avatar_url','UPDATE') as can_update_avatar,
       has_column_privilege('authenticated','public.profiles','is_admin','UPDATE') as can_update_admin_role;

-- Private proof/evidence buckets. These must report public=false.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('payment-proofs','rental-evidence','listing-images')
order by id;

-- Storage policies are included so that unexpected broad policies can be
-- reviewed; policies on the same storage.objects table can combine permissively.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
order by policyname;

-- Verify that expected database guards and lifecycle functions are installed.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'is_admin','set_booking_total','respond_to_booking','cancel_booking','confirm_booking_milestone',
    'submit_rental_review','admin_update_issue_report',
    'submit_booking_payment','admin_review_booking_payment',
    'admin_record_deposit_refund','admin_update_payment_instructions',
    'notify_booking_changes','notify_issue_report_updates',
    'on_booking_completed_prepare_deposit_refund',
    'on_issue_report_resolved_prepare_deposit_refund',
    'snapshot_booking_contact_phones',
    'attach_booking_evidence','attach_issue_report_evidence',
    'booking_evidence_path','issue_report_evidence_path'
  )
order by p.proname, arguments;

select t.relname as table_name, tr.tgname as trigger_name,
       pg_get_triggerdef(tr.oid) as trigger_definition
from pg_trigger tr
join pg_class t on t.oid=tr.tgrelid
join pg_namespace n on n.oid=t.relnamespace
where not tr.tgisinternal
  and n.nspname='public'
  and t.relname in ('bookings','issue_reports')
order by t.relname, tr.tgname;
