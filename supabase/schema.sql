-- =====================================================================
-- STRIKERS · Esquema de Supabase (Postgres)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- Es re-ejecutable: usa "if not exists" / "create or replace".
-- =====================================================================

create extension if not exists pgcrypto;
create sequence if not exists public.customer_seq start 1;

-- ---------------------------------------------------------------- TABLAS
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  phone          text,
  name           text,
  customer_code  text unique not null,            -- C-00482 (lo que ve el mesero en el QR)
  referral_code  text unique,                     -- CARLOS-STK7
  referred_by    uuid references public.profiles(id),
  visits_total   int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name    text
);

create table if not exists public.visits (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  source      text not null default 'staff' check (source in ('staff', 'referral')),
  sealed_by   uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists visits_customer_idx on public.visits(customer_id, created_at desc);

create table if not exists public.coupons (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  code        text unique not null,               -- STK15-7K2M
  discount    int  not null,                      -- 15 | 20
  status      text not null default 'active' check (status in ('active', 'redeemed')),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists coupons_customer_idx on public.coupons(customer_id, created_at desc);

create table if not exists public.matches (
  id        uuid primary key default gen_random_uuid(),
  title     text not null,
  starts_at timestamptz not null,
  mvp_first boolean not null default false,       -- los MVP reservan antes
  opens_at  timestamptz                           -- cuándo abre para los demás
);

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (match_id, customer_id)
);

-- ------------------------------------------------------------ FUNCIONES
create or replace function public.tier_for(v int) returns text
language sql immutable as $$
  select case when v >= 25 then 'MVP' when v >= 10 then 'Titular' else 'Rookie' end
$$;

-- Posición en la tarjeta de 10 sellos (tras la visita 10 se reinicia)
create or replace function public.card_pos(v int) returns int
language sql immutable as $$
  select case when v <= 0 then 0 else ((v - 1) % 10) + 1 end
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

-- Interna: registra una visita, actualiza el total y genera cupón en la 5 (15%) y 10 (20%)
create or replace function public._add_visit(p_customer uuid, p_source text, p_staff uuid)
returns table (o_visits int, o_pos int, o_disc int, o_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_pos int; v_disc int; v_code text;
begin
  insert into visits (customer_id, source, sealed_by) values (p_customer, p_source, p_staff);
  update profiles set visits_total = visits_total + 1 where id = p_customer returning visits_total into v_total;

  v_pos  := card_pos(v_total);
  v_disc := case v_pos when 5 then 15 when 10 then 20 else null end;

  if v_disc is not null then
    loop
      v_code := 'STK' || v_disc || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
      exit when not exists (select 1 from coupons c where c.code = v_code);
    end loop;
    insert into coupons (customer_id, code, discount, expires_at)
    values (p_customer, v_code, v_disc, now() + interval '30 days');
  end if;

  return query select v_total, v_pos, v_disc, v_code;
end $$;

-- Crea el perfil la primera vez que el usuario valida su teléfono
create or replace function public.ensure_profile(p_ref text default null)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); p public.profiles; v_ref uuid; v_phone text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into p from profiles where id = v_uid;
  if not found then
    select phone into v_phone from auth.users where id = v_uid;
    if p_ref is not null and length(trim(p_ref)) > 0 then
      select id into v_ref from profiles where referral_code = upper(trim(p_ref));
    end if;
    insert into profiles (id, phone, customer_code, referred_by)
    values (v_uid, v_phone, 'C-' || lpad(nextval('customer_seq')::text, 5, '0'), v_ref)
    returning * into p;
  end if;
  return p;
end $$;

-- Guarda el nombre y genera el código de invitación (CARLOS-STK7)
create or replace function public.set_name(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_base text; v_cand text; i int := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Escribe tu nombre'; end if;

  v_base := upper(regexp_replace(split_part(trim(p_name), ' ', 1), '[^[:alpha:]]', '', 'g'));
  if v_base = '' then v_base := 'AMIGO'; end if;

  loop
    i := i + 1;
    v_cand := v_base || '-STK' || floor(random() * power(10, 1 + i / 6))::int;
    exit when i > 40 or not exists (select 1 from profiles where referral_code = v_cand);
  end loop;

  update profiles
     set name = trim(p_name), referral_code = coalesce(referral_code, v_cand)
   where id = auth.uid();
end $$;

-- MESERO: sella una visita por código de cliente (lo que trae el QR)
create or replace function public.seal_visit(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- En producción cambia a '4 hours' para evitar sellos duplicados seguidos
  v_cooldown constant interval := interval '0 minutes';
  c public.profiles; r record; v_bonus boolean := false;
begin
  if not is_staff() then raise exception 'Solo el personal puede sellar visitas'; end if;

  select * into c from profiles where customer_code = upper(trim(p_code));
  if not found then raise exception 'No encontramos ese código de cliente'; end if;

  if v_cooldown > interval '0' and exists (
    select 1 from visits where customer_id = c.id and source = 'staff' and created_at > now() - v_cooldown
  ) then
    raise exception 'A este cliente ya se le selló una visita hace poco';
  end if;

  select * into r from _add_visit(c.id, 'staff', auth.uid());

  -- Trae a un amigo: primera visita del invitado → visita extra para los dos
  if r.o_visits = 1 and c.referred_by is not null then
    perform _add_visit(c.id, 'referral', null);
    perform _add_visit(c.referred_by, 'referral', null);
    v_bonus := true;
  end if;

  select * into c from profiles where id = c.id;
  return jsonb_build_object(
    'name', c.name, 'customer_code', c.customer_code, 'visits_total', c.visits_total,
    'position', card_pos(c.visits_total), 'tier', tier_for(c.visits_total),
    'coupon', case when r.o_disc is null then null
                   else jsonb_build_object('discount', r.o_disc, 'code', r.o_code) end,
    'referral_bonus', v_bonus
  );
end $$;

-- MESERO: canjea un cupón (un solo uso, con vencimiento)
create or replace function public.redeem_coupon(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare cp public.coupons; v_name text;
begin
  if not is_staff() then raise exception 'Solo el personal puede canjear cupones'; end if;
  select * into cp from coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Cupón no encontrado'; end if;
  if cp.status <> 'active' then raise exception 'Este cupón ya fue canjeado'; end if;
  if cp.expires_at < now() then raise exception 'Este cupón está vencido'; end if;

  update coupons set status = 'redeemed', redeemed_at = now() where id = cp.id;
  select name into v_name from profiles where id = cp.customer_id;
  return jsonb_build_object('code', cp.code, 'discount', cp.discount, 'name', v_name);
end $$;

-- CLIENTE: reservar mesa (los partidos "mvp_first" abren antes para los MVP)
create or replace function public.reserve_match(p_match uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m public.matches; v int;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into m from matches where id = p_match;
  if not found then raise exception 'Partido no encontrado'; end if;
  select visits_total into v from profiles where id = auth.uid();
  if m.mvp_first and m.opens_at is not null and now() < m.opens_at and tier_for(coalesce(v, 0)) <> 'MVP' then
    raise exception 'Este partido abre primero para los MVP';
  end if;
  insert into reservations (match_id, customer_id) values (p_match, auth.uid()) on conflict do nothing;
end $$;

-- ------------------------------------------------------- DATOS DE EJEMPLO
-- Próxima ocurrencia de un día de la semana (0=domingo … 6=sábado) en hora de Monterrey
create or replace function public.next_dow(p_dow int, p_time time) returns timestamptz
language sql stable as $$
  select case when t <= now() then t + interval '7 days' else t end
  from (
    select (((now() at time zone 'America/Monterrey')::date
      + ((p_dow - extract(dow from (now() at time zone 'America/Monterrey'))::int + 7) % 7)) + p_time)
      at time zone 'America/Monterrey' as t
  ) x
$$;

-- Vuelve a crear los partidos de la semana. Ejecútala cuando quieras refrescar la demo.
create or replace function public.seed_matches() returns void
language plpgsql security definer set search_path = public as $$
declare v_fight timestamptz; v_opens timestamptz;
begin
  delete from matches;
  v_fight := next_dow(6, '21:00');
  v_opens := (((v_fight at time zone 'America/Monterrey')::date - 2)::timestamp) at time zone 'America/Monterrey';
  if v_opens <= now() then v_fight := v_fight + interval '7 days'; v_opens := v_opens + interval '7 days'; end if;

  insert into matches (title, starts_at, mvp_first, opens_at) values
    ('Domingo de NFL',    next_dow(0, '13:00'), false, null),
    ('Clásico de fútbol', next_dow(6, '15:00'), false, null),
    ('Noche de peleas',   v_fight,              true,  v_opens),
    ('Lunes de NFL',      next_dow(1, '19:15'), false, null);
end $$;

select public.seed_matches();

-- ------------------------------------------------- SEGURIDAD (RLS + grants)
alter table public.profiles     enable row level security;
alter table public.staff        enable row level security;
alter table public.visits       enable row level security;
alter table public.coupons      enable row level security;
alter table public.matches      enable row level security;
alter table public.reservations enable row level security;

drop policy if exists profiles_select     on public.profiles;
drop policy if exists staff_select        on public.staff;
drop policy if exists visits_select       on public.visits;
drop policy if exists coupons_select      on public.coupons;
drop policy if exists matches_select      on public.matches;
drop policy if exists reservations_select on public.reservations;
drop policy if exists reservations_delete on public.reservations;

create policy profiles_select     on public.profiles     for select to authenticated using (id = auth.uid() or public.is_staff());
create policy staff_select        on public.staff        for select to authenticated using (user_id = auth.uid());
create policy visits_select       on public.visits       for select to authenticated using (customer_id = auth.uid() or public.is_staff());
create policy coupons_select      on public.coupons      for select to authenticated using (customer_id = auth.uid() or public.is_staff());
create policy matches_select      on public.matches      for select to authenticated using (true);
create policy reservations_select on public.reservations for select to authenticated using (customer_id = auth.uid());
create policy reservations_delete on public.reservations for delete to authenticated using (customer_id = auth.uid());
-- No hay políticas de insert/update: todo lo que escribe pasa por las funciones de arriba.

revoke all on function public._add_visit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.seed_matches()               from public, anon, authenticated;

revoke execute on function public.ensure_profile(text)  from public, anon;
revoke execute on function public.set_name(text)        from public, anon;
revoke execute on function public.seal_visit(text)      from public, anon;
revoke execute on function public.redeem_coupon(text)   from public, anon;
revoke execute on function public.reserve_match(uuid)   from public, anon;
grant  execute on function public.ensure_profile(text), public.set_name(text), public.seal_visit(text),
                           public.redeem_coupon(text), public.reserve_match(uuid) to authenticated;

-- ---------------------------------------------------------------- MESEROS
-- 1) Crea el usuario en Authentication → Users (email + contraseña, "Auto confirm").
-- 2) Conviértelo en mesero:
--    insert into public.staff (user_id, name)
--    select id, 'Mesero 1' from auth.users where email = 'mesero@strikers.mx';
