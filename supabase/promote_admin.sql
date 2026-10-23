-- Run only after the intended user exists in Supabase Authentication > Users.
-- This does not create/reset an account password; it only promotes the matching email.
insert into public.profiles (id, full_name, university, is_admin)
select u.id, 'ก้องภพ ดวงหาคลัง', '', true
from auth.users u
where lower(u.email) = lower('phklxng@gmail.com')
on conflict (id) do update set
  full_name = excluded.full_name,
  is_admin = true,
  updated_at = now();

-- Verify that one profile was promoted:
select p.id, p.full_name, u.email, p.is_admin
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('phklxng@gmail.com');
