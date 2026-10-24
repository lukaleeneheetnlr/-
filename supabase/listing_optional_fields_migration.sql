-- Allow rental listings to omit description, condition, or pickup zone.
-- Review this migration, then run it in Supabase Dashboard > SQL Editor.
-- Apply after schema.sql. It preserves existing rows and all non-NULL length limits.

begin;

alter table public.listings
  alter column location drop not null,
  alter column condition drop not null,
  alter column description drop not null;

alter table public.listings
  drop constraint if exists listings_location_check,
  drop constraint if exists listings_condition_check,
  drop constraint if exists listings_description_check;

alter table public.listings
  add constraint listings_location_optional_length_check
    check (location is null or char_length(location) between 2 and 100),
  add constraint listings_condition_optional_length_check
    check (condition is null or char_length(condition) between 2 and 120),
  add constraint listings_description_optional_length_check
    check (description is null or char_length(description) between 2 and 500);

commit;
