-- =====================================================================
-- STRIKERS · Modo dueño (admin.html)
-- Ejecutar DESPUÉS de schema.sql, en el proyecto de Supabase EXCLUSIVO de Strikers.
-- Es re-ejecutable.
-- =====================================================================

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name    text
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

drop policy if exists admins_select            on public.admins;
drop policy if exists profiles_admin_select    on public.profiles;
drop policy if exists visits_admin_select      on public.visits;
drop policy if exists coupons_admin_select     on public.coupons;
drop policy if exists reservations_admin_select on public.reservations;
drop policy if exists matches_admin_insert     on public.matches;
drop policy if exists matches_admin_update     on public.matches;
drop policy if exists matches_admin_delete     on public.matches;

-- El dueño solo LEE clientes, visitas, cupones y reservas (no puede modificarlos)
create policy admins_select             on public.admins       for select to authenticated using (user_id = auth.uid());
create policy profiles_admin_select     on public.profiles     for select to authenticated using (public.is_admin());
create policy visits_admin_select       on public.visits       for select to authenticated using (public.is_admin());
create policy coupons_admin_select      on public.coupons      for select to authenticated using (public.is_admin());
create policy reservations_admin_select on public.reservations for select to authenticated using (public.is_admin());

-- …y administra los partidos
create policy matches_admin_insert on public.matches for insert to authenticated with check (public.is_admin());
create policy matches_admin_update on public.matches for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy matches_admin_delete on public.matches for delete to authenticated using (public.is_admin());

grant select on public.admins to authenticated;
grant insert, update, delete on public.matches to authenticated;

-- ---------------------------------------------------------------- DUEÑO
-- 1) Crea el usuario en Authentication → Users (email + contraseña, "Auto confirm").
-- 2) Conviértelo en dueño:
--    insert into public.admins (user_id, name)
--    select id, 'Dueño' from auth.users where email = 'dueno@strikers.mx';
