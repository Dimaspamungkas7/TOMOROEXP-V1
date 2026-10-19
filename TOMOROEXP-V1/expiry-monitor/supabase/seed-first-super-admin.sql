-- Bootstrap Super Admin: create the auth user FIRST in Supabase Dashboard > Authentication > Users.
-- Use an email such as root@expiry.local and set a strong password.
-- Then replace the UUID below with that user's auth.users.id and run this SQL.
-- Never share or commit the password/service_role key.
insert into public.profiles (id, login_code, display_name, role, area_id, store_id, active)
values ('REPLACE-WITH-AUTH-USER-UUID', 'ROOT', 'Super Admin', 'super_admin', null, null, true);
