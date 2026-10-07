-- =============================================================================
-- Etap 2 – stan gry na serwerze (synchronizacja z aplikacją local-first)
--
--  · Aplikacja działa od razu lokalnie (także offline w lesie), a zdarzenia wysyła z kolejki (outbox),
--    gdy jest sieć. Serwer jest źródłem prawdy: aplikacja pobiera get_game_state() i przyjmuje ten stan.
--  · Zdarzenia mogą przyjść późno i ponownie (retry po timeoucie) → każde RPC jest IDEMPOTENTNE
--    i przyjmuje identyfikatory (uuid) oraz czasy wygenerowane na telefonie.
--  · submit_find – TYMCZASOWE: dopóki nie ma modelu AI, wynik rozpoznania (mock) przysyła klient.
--  · dev_import_state / dev_reset_player – narzędzia deweloperskie, działają tylko przy
--    app_config.dev_tools = true (seed lokalny). W chmurze flaga NIE może być ustawiona.
--  · gminy: kolumny kind i forest_pct – seed ma wszystkie gminy z PRG (wykrywanie z GPS w całej Polsce).
-- =============================================================================

alter type public.xp_source add value if not exists 'import';

create type public.gmina_kind as enum ('miejska', 'wiejska', 'miejsko-wiejska');

alter table public.gminy
  add column if not exists kind public.gmina_kind,
  add column if not exists forest_pct numeric(4, 1);      -- lesistość % (GUS BDL)

-- ─────────────────────────────────────────────────────────────────────────────
-- Konfiguracja serwera (bez dostępu dla klientów – tylko funkcje SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.app_config (
  key text primary key,
  value jsonb not null
);
alter table public.app_config enable row level security;
-- Brak polityk: klient nie czyta ani nie zapisuje konfiguracji.

-- Narzędzia deweloperskie (import stanu, reset gracza). Lokalnie włącza je seed.sql;
-- w chmurze wiersz 'dev_tools' NIE może mieć wartości true.
create function public.dev_tools_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'dev_tools'), false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Czas w formacie aplikacji (Date.toISOString): '2026-10-07T08:15:00.000Z'.
create function public.iso_ts(ts timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Zamyka aktywną wyprawę (wspólne dla finish_trip i auto-zamknięcia w start_trip):
-- ended_at przycięty do [started_at, now()], znaleziska wejdą do statystyk po opóźnieniu,
-- nieodebrane przepadają, licznik wypraw +1. Wyprawa już zamknięta → zwraca ją bez zmian.
create function public.close_trip(p_trip_id uuid, p_ended_at timestamptz, p_duration_s int default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.trips;
  v_end timestamptz;
begin
  select * into t from public.trips where id = p_trip_id for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  v_end := greatest(t.started_at, least(coalesce(p_ended_at, now()), now()));
  update public.trips
     set status = 'finished',
         ended_at = v_end,
         duration_s = greatest(0, coalesce(p_duration_s, extract(epoch from v_end - t.started_at)::int))
   where id = t.id
   returning * into t;
  update public.finds set visible_from = t.ended_at + public.privacy_delay()
   where trip_id = t.id and status = 'claimed';
  update public.finds set status = 'discarded' where trip_id = t.id and status = 'pending';
  update public.profiles set trips_count = trips_count + 1 where id = t.user_id;
  return t;
end $$;

-- Czyści dane gry gracza (narzędzia deweloperskie) i zeruje liczniki profilu.
-- Zostają: konto, nick, imię, gmina domowa, znajomi, obserwowane gminy, tokeny push.
create function public.wipe_game_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.user_species where user_id = p_user;
  delete from public.user_badges where user_id = p_user;
  delete from public.user_achievements where user_id = p_user;
  delete from public.user_quests where user_id = p_user;
  delete from public.user_challenges where user_id = p_user;
  delete from public.xp_events where user_id = p_user;
  delete from public.posts where author_id = p_user;
  delete from public.finds where user_id = p_user;          -- + find_locations (cascade)
  delete from public.scans where user_id = p_user;          -- + identifications (cascade)
  delete from public.trips where user_id = p_user;          -- + trip_tracks (cascade)
  update public.profiles
     set total_xp = 0, level = 1, xp_in_level = 0, streak_days = 0, last_active_date = null,
         trips_count = 0, mushrooms_count = 0, total_distance_m = 0
   where id = p_user;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyprawy (idempotentne, z czasem z telefonu)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.start_trip(text);

-- „Rozpocznij grzybobranie”.
--  · p_trip_id podany i ta wyprawa już jest → zwraca ją bez zmian (ponowne wysłanie z kolejki).
--  · Inna wyprawa aktywna: bez p_trip_id → zwraca aktywną (claim_find, stare wywołanie);
--    z p_trip_id → stara zostaje zamknięta (jak finish_trip, koniec = start nowej) i powstaje nowa.
--  · started_at = czas z telefonu (najwyżej 5 min w przyszłość – inaczej now()).
--  · Seria dni wg daty startu (Europe/Warsaw): tylko do przodu – spóźniona synchronizacja jej nie cofa.
create function public.start_trip(p_gmina_id text, p_trip_id uuid default null, p_started_at timestamptz default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz := coalesce(p_started_at, now());
  v_day date;
  t public.trips;
  pr public.profiles;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  -- Blokada profilu szereguje równoległe wywołania tego samego gracza (retry po timeoucie).
  select * into pr from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;

  if p_trip_id is not null then
    select * into t from public.trips where id = p_trip_id;
    if found then
      if t.user_id = v_uid then return t; end if;
      raise exception 'trip_id_conflict' using errcode = 'P0001';
    end if;
  end if;

  select * into t from public.trips where user_id = v_uid and status = 'active' for update;
  if found then
    if p_trip_id is null then return t; end if;
    perform public.close_trip(t.id, least(now(), v_start));
  end if;

  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'unknown_gmina' using errcode = 'P0001', detail = format('Gmina „%s” nie istnieje w bazie', p_gmina_id);
  end if;
  if v_start > now() + interval '5 minutes' then v_start := now(); end if;

  v_day := (v_start at time zone 'Europe/Warsaw')::date;
  if pr.last_active_date is null or v_day > pr.last_active_date then
    update public.profiles
       set streak_days = case when pr.last_active_date = v_day - 1 then pr.streak_days + 1 else 1 end,
           last_active_date = v_day
     where id = v_uid;
  end if;

  insert into public.trips (id, user_id, gmina_id, started_at)
  values (coalesce(p_trip_id, gen_random_uuid()), v_uid, p_gmina_id, v_start)
  returning * into t;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

-- Okresowo z telefonu: dystans narastająco → zadanie „Przejdź 5 km”, odznaka „100 km”.
-- Wyprawa już zamknięta → zwraca ją bez zmian (spóźnione ponowienia z kolejki).
create or replace function public.report_trip_progress(p_trip_id uuid, p_distance_m int) returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
  v_delta int;
  q record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  v_delta := greatest(0, coalesce(p_distance_m, 0) - t.distance_m);
  if v_delta = 0 then return t; end if;
  update public.trips set distance_m = p_distance_m where id = t.id returning * into t;
  update public.profiles set total_distance_m = total_distance_m + v_delta where id = v_uid;
  for q in select id from public.quest_templates where active and kind = 'distance' loop
    perform public.bump_quest(v_uid, q.id, v_delta / 1000.0, t.gmina_id);
  end loop;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

drop function if exists public.finish_trip(uuid, int, int, text);

-- „Zakończ wyprawę”: ślad prywatnie, trasa uogólniona publicznie; znaleziska wejdą do statystyk po opóźnieniu.
-- Idempotentne: wyprawa już zakończona / opublikowana → zwraca ją bez zmian.
-- ended_at = p_ended_at z telefonu (offline) przycięty do [started_at, now()].
create function public.finish_trip(
  p_trip_id uuid, p_distance_m int, p_duration_s int, p_track_geojson text default null, p_ended_at timestamptz default null
)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
  v_track geometry;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  t := public.report_trip_progress(p_trip_id, p_distance_m);

  if p_track_geojson is not null then
    -- Uszkodzony / zbyt krótki ślad nie może zablokować kolejki – wyprawa kończy się bez trasy.
    begin
      v_track := st_force2d(st_setsrid(st_geomfromgeojson(p_track_geojson), 4326));
      if geometrytype(v_track) = 'LINESTRING' and st_npoints(v_track) >= 2 then
        insert into public.trip_tracks (trip_id, user_id, track) values (t.id, v_uid, v_track)
        on conflict (trip_id) do update set track = excluded.track, updated_at = now();
        -- Publiczna trasa: uproszczona i przyciągnięta do siatki ~200 m – bez miejscówek.
        update public.trips
           set route_public = st_snaptogrid(st_simplifypreservetopology(v_track, 0.001), 0.002)
         where id = t.id;
      end if;
    exception when others then
      raise warning 'finish_trip: pomijam ślad GPS (%)', sqlerrm;
    end;
  end if;

  return public.close_trip(t.id, coalesce(p_ended_at, now()), p_duration_s);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Znaleziska
-- ─────────────────────────────────────────────────────────────────────────────

-- TYMCZASOWE – usuń, gdy powstanie Edge Function `identify` (wtedy serwer sam zapisuje
-- scans + identifications + finds z wyniku modelu, a klient nie podaje gatunku ani wymiarów).
-- Dziś aplikacja ma mock rozpoznawania i przysyła jego wynik. Idempotentne po p_find_id.
--  · p_dimensions: {"cap_cm", "height_cm", "weight_g", "age_days", "pieces"} (brak klucza = null)
--  · p_candidates: [{"species_id": "...", "confidence": 0.41}]
--  · p_trip_id: wyprawa gracza albo null (także gdy jej jeszcze nie ma na serwerze – claim_find
--    podepnie wtedy aktywną wyprawę).
--  · Błędy walidacji: P0001 z kodem w treści (unknown_species, unknown_gmina, invalid_confidence,
--    invalid_dimensions, invalid_candidates, invalid_found_at) i opisem w detail – nie ponawiać.
create function public.submit_find(
  p_find_id uuid,
  p_trip_id uuid,
  p_gmina_id text,
  p_species_id text,
  p_rarity public.rarity,
  p_confidence numeric,
  p_xxl boolean,
  p_dimensions jsonb,
  p_candidates jsonb,
  p_parts text[],
  p_found_at timestamptz
)
returns public.finds
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.finds;
  sp public.species;
  v_trip_id uuid;
  v_scan_id uuid;
  v_ident_id uuid;
  v_found timestamptz := coalesce(p_found_at, now());
  v_candidates jsonb := coalesce(p_candidates, '[]');
  v_cap numeric;
  v_height numeric;
  v_weight int;
  v_age int;
  v_pieces int;
  v_dims jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_find_id is null then
    raise exception 'invalid_find' using errcode = 'P0001', detail = 'Brak identyfikatora znaleziska (p_find_id)';
  end if;
  perform 1 from public.profiles where id = v_uid for update;

  select * into f from public.finds where id = p_find_id;
  if found then
    if f.user_id = v_uid then return f; end if;
    raise exception 'find_id_conflict' using errcode = 'P0001';
  end if;

  select * into sp from public.species where id = p_species_id;
  if not found then
    raise exception 'unknown_species' using errcode = 'P0001', detail = format('Gatunek „%s” nie istnieje w katalogu', p_species_id);
  end if;
  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'unknown_gmina' using errcode = 'P0001', detail = format('Gmina „%s” nie istnieje w bazie', p_gmina_id);
  end if;
  if p_rarity is null then
    raise exception 'invalid_rarity' using errcode = 'P0001', detail = 'Brak rzadkości okazu';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid_confidence' using errcode = 'P0001',
      detail = format('Pewność rozpoznania musi być w zakresie 0–1 (jest %s)', coalesce(p_confidence::text, 'null'));
  end if;
  if jsonb_typeof(v_candidates) <> 'array' then
    raise exception 'invalid_candidates' using errcode = 'P0001', detail = 'p_candidates musi być tablicą JSON';
  end if;

  begin
    v_cap := round((p_dimensions ->> 'cap_cm')::numeric, 1);
    v_height := round((p_dimensions ->> 'height_cm')::numeric, 1);
    v_weight := round((p_dimensions ->> 'weight_g')::numeric)::int;
    v_age := round((p_dimensions ->> 'age_days')::numeric)::int;
    v_pieces := round((p_dimensions ->> 'pieces')::numeric)::int;
  exception when others then
    raise exception 'invalid_dimensions' using errcode = 'P0001',
      detail = format('Wymiary muszą być liczbami: %s', p_dimensions);
  end;
  if v_cap < 0 or v_cap > 80 or v_height < 0 or v_height > 100 or v_weight < 0 or v_weight > 10000
     or v_age < 0 or v_age > 365 or v_pieces < 0 or v_pieces > 200 then
    raise exception 'invalid_dimensions' using errcode = 'P0001',
      detail = format('Nieprawdopodobne wymiary (kapelusz ≤ 80 cm, wysokość ≤ 100 cm, waga ≤ 10 000 g, wiek ≤ 365 dni, sztuk ≤ 200): %s', p_dimensions);
  end if;

  if v_found > now() + interval '5 minutes' or v_found < now() - interval '14 days' then
    raise exception 'invalid_found_at' using errcode = 'P0001',
      detail = format('Czas znaleziska %s poza zakresem (najwyżej 14 dni wstecz, 5 min w przód)', v_found);
  end if;
  v_found := least(v_found, now());

  if p_trip_id is not null then
    select t.id into v_trip_id from public.trips t where t.id = p_trip_id and t.user_id = v_uid;
  end if;

  v_dims := jsonb_strip_nulls(jsonb_build_object(
    'cap_cm', v_cap, 'height_cm', v_height, 'weight_g', v_weight, 'age_days', v_age, 'pieces', v_pieces));

  insert into public.scans (user_id, trip_id, status, parts)
  values (v_uid, v_trip_id, 'identified', coalesce(p_parts, '{}'))
  returning id into v_scan_id;

  insert into public.identifications (scan_id, provider, model, species_id, confidence, candidates, dimensions)
  values (v_scan_id, 'client-sim', 'mock-v1', sp.id, p_confidence, v_candidates, v_dims)
  returning id into v_ident_id;

  insert into public.finds (
    id, user_id, trip_id, scan_id, identification_id, species_id, gmina_id, rarity, confidence, xxl,
    cap_cm, height_cm, weight_g, age_days, pieces, collected, status, found_at
  )
  values (
    p_find_id, v_uid, v_trip_id, v_scan_id, v_ident_id, sp.id, p_gmina_id, p_rarity, p_confidence, coalesce(p_xxl, false),
    v_cap, v_height, v_weight, v_age, v_pieces, sp.edibility not in ('trujacy', 'smiertelny'), 'pending', v_found
  )
  returning * into f;
  return f;
end $$;

-- „Odrzuć” na ekranie Analiza: oczekujące → discarded. Odebrane / nieistniejące / cudze → nic (idempotentne).
create function public.discard_find(p_find_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.finds set status = 'discarded'
   where id = p_find_id and user_id = v_uid and status = 'pending';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stan gry dla aplikacji (tylko własne dane wywołującego)
-- ─────────────────────────────────────────────────────────────────────────────

create function public.get_game_state() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.local_today();
  pr public.profiles;
  v_trip_ids uuid[];
  v_profile jsonb;
  v_atlas jsonb;
  v_badges jsonb;
  v_achievements jsonb;
  v_quests jsonb;
  v_trips jsonb;
  v_finds jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into pr from public.profiles where id = v_uid;
  if found then
    v_profile := jsonb_build_object(
      'handle', pr.handle::text,
      'displayName', pr.display_name,
      'firstName', pr.first_name,
      'homeGminaId', pr.home_gmina_id,
      'totalXp', pr.total_xp,
      'level', pr.level,
      'xpInLevel', pr.xp_in_level,
      'streakDays', pr.streak_days,
      'lastActiveDate', to_char(pr.last_active_date, 'YYYY-MM-DD'),
      'tripsCount', pr.trips_count,
      'mushroomsCount', pr.mushrooms_count,
      'totalDistanceM', pr.total_distance_m
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'speciesId', us.species_id,
           'count', us.count,
           'firstFoundAt', public.iso_ts(us.first_found_at),
           'bestCapCm', us.best_cap_cm,
           'bestWeightG', us.best_weight_g
         ) order by us.first_found_at, us.species_id), '[]')
    into v_atlas
    from public.user_species us where us.user_id = v_uid;

  select coalesce(jsonb_agg(ub.badge_id order by ub.earned_at, ub.badge_id), '[]')
    into v_badges
    from public.user_badges ub where ub.user_id = v_uid;

  select coalesce(jsonb_object_agg(ua.achievement_id, ua.tier), '{}')
    into v_achievements
    from public.user_achievements ua where ua.user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'questId', q.id,
           'progress', coalesce(uq.progress, 0),
           'completed', uq.completed_at is not null
         ) order by q.sort, q.id), '[]')
    into v_quests
    from public.quest_templates q
    left join public.user_quests uq on uq.quest_id = q.id and uq.user_id = v_uid and uq.day = v_today
   where q.active;

  -- Aktywna wyprawa + 30 ostatnich.
  select array_agg(x.id) into v_trip_ids from (
    select t.id from public.trips t where t.user_id = v_uid and t.status = 'active'
    union
    select r.id from (
      select t.id from public.trips t where t.user_id = v_uid order by t.started_at desc limit 30
    ) r
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'gminaId', t.gmina_id,
           'status', t.status,
           'startedAt', public.iso_ts(t.started_at),
           'endedAt', public.iso_ts(t.ended_at),
           'durationS', t.duration_s,
           'distanceM', t.distance_m,
           'xp', t.xp,
           'hideRoute', t.hide_route
         ) order by t.started_at desc), '[]')
    into v_trips
    from public.trips t where t.id = any(v_trip_ids);

  -- Znaleziska tych wypraw (oczekujące i odebrane) + oczekujące jeszcze bez wyprawy.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'tripId', f.trip_id,
           'speciesId', f.species_id,
           'gminaId', f.gmina_id,
           'rarity', f.rarity,
           'confidence', f.confidence,
           'xxl', f.xxl,
           'capCm', f.cap_cm,
           'heightCm', f.height_cm,
           'weightG', f.weight_g,
           'ageDays', f.age_days,
           'pieces', f.pieces,
           'collected', f.collected,
           'status', f.status,
           'foundAt', public.iso_ts(f.found_at),
           'xp', f.xp,
           'reward', f.reward
         ) order by f.found_at, f.id), '[]')
    into v_finds
    from public.finds f
   where f.user_id = v_uid
     and f.status in ('pending', 'claimed')
     and (f.trip_id = any(v_trip_ids) or (f.trip_id is null and f.status = 'pending'));

  return jsonb_build_object(
    'userId', v_uid,
    'serverTime', public.iso_ts(now()),
    'profile', v_profile,
    'atlas', v_atlas,
    'badges', v_badges,
    'achievements', v_achievements,
    'quests', jsonb_build_object('day', to_char(v_today, 'YYYY-MM-DD'), 'progress', v_quests),
    'trips', v_trips,
    'finds', v_finds
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Narzędzia deweloperskie (tylko przy app_config.dev_tools = true)
-- ─────────────────────────────────────────────────────────────────────────────

-- Przenosi lokalny stan aplikacji na serwer (panel /dev): kasuje dane gry wywołującego i wgrywa
--   {"profile": {displayName, firstName, handle, homeGminaId, level, xpInLevel, streakDays, tripsCount, mushroomsCount},
--    "atlas": [{speciesId, count, firstFoundAt, bestCapCm, bestWeightG}], "badges": ["id", …]}
-- XP: jeden wpis w księdze (źródło 'import') = suma progów do (level, xpInLevel) – trigger ustawia poziom.
-- Osiągnięcia: stopnie już osiągnięte z atlasu jako nagrodzone, bez XP (seed_achievements).
-- Nieznane gatunki / odznaki / gmina są pomijane. Zwraca get_game_state().
create function public.dev_import_state(p_state jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_p jsonb := coalesce(p_state -> 'profile', '{}');
  v_level int;
  v_xp_in int;
  v_total bigint;
  v_handle text;
  v_name text;
  v_check record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid_state' using errcode = 'P0001', detail = 'p_state musi być obiektem JSON';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  perform public.wipe_game_data(v_uid);

  -- Profil
  v_name := nullif(trim(v_p ->> 'displayName'), '');
  update public.profiles
     set display_name = coalesce(left(v_name, 60), display_name),
         first_name = case when v_p ? 'firstName' then nullif(trim(v_p ->> 'firstName'), '') else first_name end,
         home_gmina_id = coalesce((select g.id from public.gminy g where g.id = v_p ->> 'homeGminaId'), home_gmina_id),
         streak_days = greatest(0, coalesce(round((v_p ->> 'streakDays')::numeric)::int, 0)),
         trips_count = greatest(0, coalesce(round((v_p ->> 'tripsCount')::numeric)::int, 0)),
         mushrooms_count = greatest(0, coalesce(round((v_p ->> 'mushroomsCount')::numeric)::int, 0)),
         last_active_date = public.local_today()
   where id = v_uid;

  v_handle := lower(regexp_replace(trim(coalesce(v_p ->> 'handle', '')), '^@', ''));
  if v_handle ~ '^[a-z0-9._]{3,24}$'
     and not exists (select 1 from public.profiles p where p.handle = v_handle and p.id <> v_uid) then
    begin
      update public.profiles set handle = v_handle where id = v_uid;
    exception when unique_violation then
      null;                                                -- zajęty w międzyczasie → zostaje obecny
    end;
  end if;

  -- Atlas (nieznane gatunki pomijamy)
  insert into public.user_species (user_id, species_id, count, first_found_at, best_cap_cm, best_weight_g)
  select v_uid, s.id,
         greatest(1, coalesce(round((e ->> 'count')::numeric)::int, 1)),
         coalesce((e ->> 'firstFoundAt')::timestamptz, now()),
         round((e ->> 'bestCapCm')::numeric, 1),
         round((e ->> 'bestWeightG')::numeric)::int
    from jsonb_array_elements(case when jsonb_typeof(p_state -> 'atlas') = 'array' then p_state -> 'atlas' else '[]' end) e
    join public.species s on s.id = e ->> 'speciesId'
  on conflict (user_id, species_id) do nothing;

  -- Odznaki
  insert into public.user_badges (user_id, badge_id)
  select v_uid, b.id
    from jsonb_array_elements_text(case when jsonb_typeof(p_state -> 'badges') = 'array' then p_state -> 'badges' else '[]' end) x
    join public.badges b on b.id = x
  on conflict do nothing;

  -- XP: suma progów poziomów 1 … level-1 + XP w bieżącym poziomie (ta sama krzywa co level_from_total_xp).
  v_level := least(500, greatest(1, coalesce(round((v_p ->> 'level')::numeric)::int, 1)));
  v_xp_in := least(greatest(0, coalesce(round((v_p ->> 'xpInLevel')::numeric)::int, 0)), public.level_threshold(v_level) - 1);
  select coalesce(sum(public.level_threshold(l)), 0) + v_xp_in into v_total from generate_series(1, v_level - 1) l;
  if v_total > 0 then
    insert into public.xp_events (user_id, source, ref_id, amount) values (v_uid, 'import', 'dev_import_state', v_total);
  end if;
  select level, xp_in_level, total_xp into v_check from public.profiles where id = v_uid;
  if v_check.level <> v_level or v_check.xp_in_level <> v_xp_in or v_check.total_xp <> v_total then
    raise exception 'import_level_mismatch' using errcode = 'P0001',
      detail = format('Oczekiwano Lv %s / %s XP, jest Lv %s / %s XP', v_level, v_xp_in, v_check.level, v_check.xp_in_level);
  end if;

  perform public.seed_achievements(v_uid);
  return public.get_game_state();
end $$;

-- Świeży gracz (Lv 1, pusty atlas) z zachowaniem nicku, imienia i gminy domowej. Zwraca get_game_state().
create function public.dev_reset_player() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  perform public.wipe_game_data(v_uid);
  return public.get_game_state();
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.app_config from anon, authenticated;

revoke all on function
  public.dev_tools_enabled(),
  public.iso_ts(timestamptz),
  public.close_trip(uuid, timestamptz, int),
  public.wipe_game_data(uuid),
  public.start_trip(text, uuid, timestamptz),
  public.report_trip_progress(uuid, int),
  public.finish_trip(uuid, int, int, text, timestamptz),
  public.submit_find(uuid, uuid, text, text, public.rarity, numeric, boolean, jsonb, jsonb, text[], timestamptz),
  public.discard_find(uuid),
  public.get_game_state(),
  public.dev_import_state(jsonb),
  public.dev_reset_player()
  from public, anon, authenticated;

grant execute on function
  public.dev_tools_enabled(),
  public.start_trip(text, uuid, timestamptz),
  public.report_trip_progress(uuid, int),
  public.finish_trip(uuid, int, int, text, timestamptz),
  public.submit_find(uuid, uuid, text, text, public.rarity, numeric, boolean, jsonb, jsonb, text[], timestamptz),
  public.discard_find(uuid),
  public.get_game_state(),
  public.dev_import_state(jsonb),
  public.dev_reset_player()
  to authenticated;
