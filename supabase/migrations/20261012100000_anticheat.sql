-- =============================================================================
-- Etap 7 – anty-cheat na serwerze: wykrywanie i dziennik, blokada tylko przy rażących nadużyciach
--
--  · anti_cheat_flags – dziennik podejrzanych zdarzeń: severity 1 = informacja, 2 = podejrzane, 3 = zablokowane.
--    Bez dostępu dla klientów (RLS bez polityk, bez GRANT). Moderacja: widok anti_cheat_summary (7 dni, gracz × rodzaj
--    × waga) i RPC admin_flags(p_limit, p_min_severity) – tylko service_role – albo tabela wprost w Studio.
--    Ta sama flaga (gracz, rodzaj, ref) w ciągu 24 h nie tworzy nowego wiersza: hits + 1, last_at, details nadpisane.
--  · Limity (P0001 'rate_limited', opis po polsku w detail; hint 'retry_after=<ISO>', gdy ponowienie później ma sens):
--      submit_find          > 30 znalezisk w dowolnym oknie 10 min wg found_at (gęstość – zaległa kolejka offline
--                           z found_at rozłożonymi w czasie przechodzi) albo > 200 dziennie wg created_at (czas serwera)
--      start_trip           > 20 nowych wypraw dziennie (czas serwera)
--      add_comment          > 30 komentarzy w 10 min          (wyzwalacz – obejmuje też bezpośredni INSERT przez API)
--      send_friend_request  > 50 nowych zaproszeń dziennie    (wyzwalacz – jw.)
--      report_post          > 30 zgłoszeń dziennie
--    „Dziennie” = doba Europe/Warsaw (od północy). Ponowienie z kolejki (ten sam id / to samo zgłoszenie) wraca z zapisanym
--    wierszem przed sprawdzeniem limitu – nie liczy się podwójnie. Odrzuconego wywołania nie da się zapisać w tabeli
--    (wyjątek wycofuje transakcję), więc flagę 'rate_limited' (3) zapisuje wywołanie, które wyczerpuje limit (ostatnie
--    przyjęte), a każde odrzucenie trafia do logu Postgresa (raise log 'anti_cheat rate_limited …').
--  · Wiarygodność (flaga, blokada tylko absurdu): prędkość wyprawy (> 12 km/h → liczone najwyżej 8 km/h, > 50 km/h → nic),
--    wymiary / XXL / rzadkość znaleziska (XXL i rzadkość poprawiane – prawda serwera), znalezisko poza czasem wyprawy,
--    seria rzadkich okazów, dzienny „miękki” limit XP ze znalezisk (tylko flaga), to samo zdjęcie przy kilku znaleziskach,
--    wyprawa z datą startu sprzed > 24 h (informacja).
--  · Kształty wyników RPC bez zmian. Progi w jednym miejscu: anti_cheat_param().
--  · Generatory deweloperskie (dev_seed_social, dev_bots_act, dev_seed_activity) piszą wprost do tabel za boty – limity
--    ich nie dotyczą (wyzwalacze liczą tylko wiersze wywołującego we własnym imieniu). Dodatkowo flaga sesji
--    app.anti_cheat_bypass = 'on' wyłącza limity – działa wyłącznie przy dev_tools_enabled() (lokalnie).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.anti_cheat_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),        -- 'rate_limited', 'trip_speed', 'find_size'…
  severity smallint not null check (severity between 1 and 3),       -- 1 informacja · 2 podejrzane · 3 zablokowane
  ref_id text,                                                         -- wyprawa / znalezisko / akcja limitu / dzień
  details jsonb not null default '{}',
  hits int not null default 1 check (hits > 0),                        -- powtórzenia tej samej flagi w ciągu 24 h
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists anti_cheat_flags_user_idx on public.anti_cheat_flags (user_id, created_at desc);
create index if not exists anti_cheat_flags_dedupe_idx on public.anti_cheat_flags (user_id, kind, last_at desc);
create index if not exists anti_cheat_flags_recent_idx on public.anti_cheat_flags (last_at desc);
alter table public.anti_cheat_flags enable row level security;
-- Brak polityk: klient nie czyta ani nie zapisuje flag (tylko funkcje serwera; odczyt – service_role / Studio).

-- Indeksy pod liczniki limitów i sprawdzenia (tanie – zawsze zakres jednego gracza).
create index if not exists finds_user_created_idx on public.finds (user_id, created_at);
create index if not exists finds_user_photo_idx on public.finds (user_id, photo_path) where photo_path is not null;
create index if not exists trips_user_created_idx on public.trips (user_id, created_at);
create index if not exists post_comments_author_created_idx on public.post_comments (author_id, created_at);
create index if not exists friendships_user_created_idx on public.friendships (user_id, created_at);
create index if not exists post_reports_reporter_created_idx on public.post_reports (reporter_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Progi anty-cheatu w jednym miejscu (zmiana = nowa migracja z create or replace). Nieznany klucz → null.
-- stable (nie immutable): planista nie „wpieka” wartości w zapamiętane plany, więc zmiana progu działa od razu.
create or replace function public.anti_cheat_param(p_key text) returns numeric
language sql stable set search_path = '' as $$
  select x.v from (values
    -- limity (rate_limited)
    ('submit_find_per_10min', 30),       -- znaleziska w dowolnym oknie 10 min wg found_at
    ('submit_find_per_day', 200),        -- znaleziska na dobę wg created_at (czas serwera, Europe/Warsaw)
    ('start_trip_per_day', 20),
    ('add_comment_per_10min', 30),
    ('friend_request_per_day', 50),
    ('report_post_per_day', 30),
    -- prędkość wyprawy
    ('trip_speed_flag_kmh', 12),         -- powyżej: dystans przycięty, flaga 2
    ('trip_speed_counted_kmh', 8),       -- tyle najwyżej liczy się przy przycięciu
    ('trip_speed_absurd_kmh', 50),       -- powyżej: przyrost nie liczy się wcale, flaga 3
    ('trip_grace_s', 300),               -- tolerancja czasu (zegar telefonu, pierwszy fix GPS)
    ('trip_max_elapsed_s', 86400),       -- czas wyprawy do prędkości najwyżej 24 h
    ('trip_backdated_h', 24),            -- start wyprawy starszy niż tyle → flaga 1
    -- znaleziska
    ('find_weight_factor', 3),           -- waga (na sztukę) > 3 × typowa → flaga 2
    ('find_cap_factor', 2.5),            -- kapelusz > 2,5 × typowy → flaga 2
    ('xxl_factor', 1.25),                -- XXL od 1,25 × typowej wagi (jak isXxl w aplikacji)
    ('find_trip_grace_min', 5),          -- found_at poza [start − 5 min, koniec + 5 min] → flaga 1
    ('rare_burst_window_min', 30),       -- okno ± 30 min wokół znaleziska
    ('rare_burst_rare', 10),             -- ≥ 10 rzadkich+ w oknie → flaga 2
    ('rare_burst_epic', 4),              -- ≥ 4 epickie+ w oknie → flaga 2
    ('daily_find_xp_soft_cap', 5000),    -- XP ze znalezisk na dobę (czas serwera) → flaga 2, nagroda bez zmian
    -- dziennik
    ('flag_dedupe_h', 24)
  ) x (k, v)
  where x.k = p_key
$$;

-- Zapis flagi. Ta sama (gracz, rodzaj, ref) w ciągu flag_dedupe_h → ten sam wiersz: hits + 1, last_at = now(),
-- severity = większa z dwóch, details uzupełnione nowymi wartościami.
create or replace function public.flag(p_user uuid, p_kind text, p_severity int, p_ref text default null, p_details jsonb default '{}')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id bigint;
begin
  if p_user is null then return; end if;
  select f.id into v_id
    from public.anti_cheat_flags f
   where f.user_id = p_user and f.kind = p_kind and f.ref_id is not distinct from p_ref
     and f.last_at > now() - make_interval(hours => public.anti_cheat_param('flag_dedupe_h')::int)
   order by f.last_at desc
   limit 1
   for update;
  if v_id is not null then
    update public.anti_cheat_flags
       set hits = hits + 1, last_at = now(), severity = greatest(severity, p_severity::smallint),
           details = details || coalesce(p_details, '{}')
     where id = v_id;
  else
    insert into public.anti_cheat_flags (user_id, kind, severity, ref_id, details)
    values (p_user, p_kind, p_severity::smallint, p_ref, coalesce(p_details, '{}'));
  end if;
end $$;

-- Wyłączenie limitów dla skryptów deweloperskich: set_config('app.anti_cheat_bypass', 'on', …) w tej samej sesji.
-- Działa WYŁĄCZNIE przy app_config.dev_tools = true (lokalnie); klient przez PostgREST nie ustawi tej zmiennej.
create or replace function public.anti_cheat_bypass() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('app.anti_cheat_bypass', true), '') = 'on' and public.dev_tools_enabled()
$$;

-- Limit: p_used = ile już jest w oknie (BEZ bieżącego wywołania). p_used ≥ p_limit → P0001 rate_limited
-- (detail po polsku, hint 'retry_after=<ISO>' gdy podany). Wywołanie, które wyczerpuje limit (p_used + 1 = p_limit),
-- zapisuje flagę 'rate_limited' (3) – odrzuconych wywołań zapisać się nie da (wyjątek wycofuje transakcję),
-- więc każde odrzucenie trafia do logu Postgresa (raise log).
create or replace function public.check_rate_limit(
  p_user uuid, p_action text, p_used bigint, p_limit int, p_window text, p_detail text, p_retry_after timestamptz default null
)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_user is null or public.anti_cheat_bypass() then return; end if;
  if p_used >= p_limit then
    raise log 'anti_cheat rate_limited: user=% action=% used=% limit=% window=%', p_user, p_action, p_used, p_limit, p_window;
    if p_retry_after is not null then
      raise exception 'rate_limited' using errcode = 'P0001', detail = p_detail, hint = 'retry_after=' || public.iso_ts(p_retry_after);
    end if;
    raise exception 'rate_limited' using errcode = 'P0001', detail = p_detail;
  end if;
  if p_used + 1 = p_limit then
    perform public.flag(p_user, 'rate_limited', 3, p_action, jsonb_build_object(
      'action', p_action, 'limit', p_limit, 'window', p_window, 'exhaustedAt', public.iso_ts(now())));
  end if;
end $$;

-- Czas wyprawy do liczenia prędkości: od startu do p_at (≥ 0, najwyżej 24 h) + 5 min tolerancji – w sekundach.
create or replace function public.trip_elapsed_s(p_started_at timestamptz, p_at timestamptz) returns numeric
language sql stable set search_path = '' as $$
  select least(greatest(extract(epoch from p_at - p_started_at), 0), public.anti_cheat_param('trip_max_elapsed_s'))
         + public.anti_cheat_param('trip_grace_s')
$$;

-- Dystans narastająco z telefonu → przyrost liczony do profilu (total_distance_m), zadań dystansu i odznak.
-- trips.distance_m = dystans uznany przez serwer (prawda serwera – też w feedzie i get_game_state):
--  · prędkość ≤ 12 km/h (dystans / czas wyprawy do p_at) → cały zgłoszony dystans;
--  · 12–50 km/h → najwyżej czas × 8 km/h (nie mniej niż już uznany), flaga 'trip_speed' (2);
--  · > 50 km/h → nic (ani przyrostu, ani zmiany wyprawy), flaga 'trip_speed_absurd' (3).
-- Zgłoszony dystans ≤ uznanego → bez zmian (jak dotąd). Przycięty dystans „dogania” zgłoszony, gdy mija czas.
-- p_at: now() dla aktywnej wyprawy (report_trip_progress), koniec wyprawy w finish_trip. Wyprawa zablokowana przez wołającego.
create or replace function public.credit_trip_distance(t public.trips, p_distance_m int, p_at timestamptz)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_reported int := greatest(coalesce(p_distance_m, 0), 0);
  v_elapsed numeric;
  v_kmh numeric;
  v_new int;
  v_delta int;
  v_info jsonb;
  q record;
begin
  if v_reported <= t.distance_m then return t; end if;
  v_elapsed := public.trip_elapsed_s(t.started_at, p_at);
  v_kmh := v_reported / v_elapsed * 3.6;
  v_info := jsonb_build_object('reportedM', v_reported, 'previousM', t.distance_m, 'elapsedS', round(v_elapsed)::int,
                               'kmh', round(v_kmh, 1), 'at', public.iso_ts(p_at));
  if v_kmh > public.anti_cheat_param('trip_speed_absurd_kmh') then
    perform public.flag(t.user_id, 'trip_speed_absurd', 3, t.id::text, v_info);
    return t;
  elsif v_kmh > public.anti_cheat_param('trip_speed_flag_kmh') then
    v_new := least(v_reported, greatest(t.distance_m,
                   floor(v_elapsed * public.anti_cheat_param('trip_speed_counted_kmh') / 3.6)::int));
    perform public.flag(t.user_id, 'trip_speed', 2, t.id::text, v_info || jsonb_build_object('countedM', v_new));
  else
    v_new := v_reported;
  end if;

  v_delta := v_new - t.distance_m;
  if v_delta <= 0 then return t; end if;
  update public.trips set distance_m = v_new where id = t.id returning * into t;
  update public.profiles set total_distance_m = total_distance_m + v_delta where id = t.user_id;
  for q in select id from public.quest_templates where active and kind = 'distance' loop
    perform public.bump_quest(t.user_id, q.id, v_delta / 1000.0, t.gmina_id);
  end loop;
  perform public.evaluate_badges(t.user_id);
  return t;
end $$;

-- Po zamknięciu wyprawy: uznany dystans względem całego czasu [started_at, ended_at]. Wykrywa dystans uznany wcześniej
-- (report_trip_progress liczy do now() – kolejka offline), gdy koniec wyprawy okazał się wcześniejszy. Tylko flaga (2);
-- uznanego dystansu nie cofamy.
create or replace function public.check_trip_speed(t public.trips) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_elapsed numeric;
  v_kmh numeric;
begin
  if t.distance_m <= 0 or t.ended_at is null then return; end if;
  v_elapsed := public.trip_elapsed_s(t.started_at, t.ended_at);
  v_kmh := t.distance_m / v_elapsed * 3.6;
  if v_kmh > public.anti_cheat_param('trip_speed_flag_kmh') then
    perform public.flag(t.user_id, 'trip_speed', 2, t.id::text, jsonb_build_object(
      'phase', 'finish', 'countedM', t.distance_m, 'elapsedS', round(v_elapsed)::int, 'kmh', round(v_kmh, 1)));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyprawy: limit startów, prędkość (reszta bez zmian względem 20261007100000_game_sync.sql)
-- ─────────────────────────────────────────────────────────────────────────────

-- Jak w 20261007100000_game_sync.sql + limit nowych wypraw na dobę (czas serwera) i flaga 'trip_backdated' (1) dla startu
-- sprzed > 24 h (kolejka offline – tylko informacja). Zwrot istniejącej / aktywnej wyprawy nie podlega limitowi.
create or replace function public.start_trip(p_gmina_id text, p_trip_id uuid default null, p_started_at timestamptz default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz := coalesce(p_started_at, now());
  v_day date;
  v_active boolean;
  v_used bigint;
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
  v_active := found;
  if v_active and p_trip_id is null then return t; end if;

  -- Anty-cheat: nowe wyprawy dziś (created_at – czas serwera, doba Europe/Warsaw).
  select count(*) into v_used
    from public.trips x
   where x.user_id = v_uid and x.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'start_trip', v_used, public.anti_cheat_param('start_trip_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit nowych wypraw (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('start_trip_per_day')),
    public.warsaw_ts(public.local_today() + 1));

  if v_active then
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

  if v_start < now() - make_interval(hours => public.anti_cheat_param('trip_backdated_h')::int) then
    perform public.flag(v_uid, 'trip_backdated', 1, t.id::text, jsonb_build_object(
      'startedAt', public.iso_ts(v_start), 'hoursAgo', round(extract(epoch from now() - v_start) / 3600.0, 1)));
  end if;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

-- Jak w 20261007100000_game_sync.sql; przyrost dystansu przez credit_trip_distance (prędkość względem now()).
create or replace function public.report_trip_progress(p_trip_id uuid, p_distance_m int) returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  return public.credit_trip_distance(t, p_distance_m, now());
end $$;

-- Jak w 20261007100000_game_sync.sql + sprawdzenie prędkości po zamknięciu (check_trip_speed).
create or replace function public.close_trip(p_trip_id uuid, p_ended_at timestamptz, p_duration_s int default null)
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
  perform public.check_trip_speed(t);
  return t;
end $$;

-- Jak w 20261007100000_game_sync.sql; dystans przez credit_trip_distance względem KOŃCA wyprawy (p_ended_at przycięty
-- do [started_at, now()] – jak w close_trip), nie now(): spóźniona synchronizacja nie „rozciąga” wyprawy.
create or replace function public.finish_trip(
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
  t := public.credit_trip_distance(t, p_distance_m, greatest(t.started_at, least(coalesce(p_ended_at, now()), now())));

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
-- Znaleziska: limity, prawda serwera (XXL, rzadkość), flagi wiarygodności
-- ─────────────────────────────────────────────────────────────────────────────

-- TYMCZASOWE (jak w 20261007100000_game_sync.sql – do czasu Edge Function `identify`) + anty-cheat:
--  · limity (po zwrocie istniejącego p_find_id, po walidacji): gęstość wg found_at – najwięcej znalezisk gracza w
--    dowolnym oknie 10 min [s, s + 10 min), które zawiera nowe (s ∈ found_at istniejących z (nowe − 10 min, nowe] i samo
--    nowe), musi być ≤ 30 łącznie z nowym; dziennie ≤ 200 wg created_at (czas serwera). Liczą się wszystkie znaleziska
--    gracza (także odrzucone – discard).
--  · rzadkość: niższa niż gatunku → rzadkość gatunku; wyższa o ≥ 2 stopnie → gatunek + 1 i flaga 'rarity_clamped' (2);
--  · XXL tylko gdy nie-kępkowy gatunek i waga ≥ 1,25 × typowa (jak isXxl w aplikacji) – inaczej xxl = false
--    i flaga 'xxl_corrected' (1);
--  · waga (kępki: na sztukę) > 3 × typowa albo kapelusz > 2,5 × typowy → 'find_size' (2);
--  · found_at poza [start wyprawy − 5 min, koniec + 5 min] → 'find_outside_trip' (1);
--  · rzadki+ okaz, a w oknie ± 30 min ≥ 10 rzadkich+ albo ≥ 4 epickie+ → 'rare_burst' (2).
-- Zapisany wiersz (i wynik) ma poprawione rarity / xxl – claim_find liczy nagrodę z nich.
create or replace function public.submit_find(
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
  v_trip public.trips;
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
  v_used bigint;
  v_rarity public.rarity;
  v_xxl boolean;
  v_piece_g numeric;
  v_rare bigint;
  v_epic bigint;
  v_grace interval := make_interval(mins => public.anti_cheat_param('find_trip_grace_min')::int);
  v_burst interval := make_interval(mins => public.anti_cheat_param('rare_burst_window_min')::int);
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

  -- ── Limity ──
  -- Gęstość wg found_at: kolejka offline z czasami rozłożonymi w czasie przechodzi, 30+ „naraz” – nie.
  select coalesce(max(w.n), 0) into v_used
    from (
      select (select count(*) from public.finds x
               where x.user_id = v_uid and x.found_at >= s.found_at and x.found_at < s.found_at + interval '10 minutes') as n
        from (
          select y.found_at from public.finds y
           where y.user_id = v_uid and y.found_at > v_found - interval '10 minutes' and y.found_at <= v_found
          union all
          select v_found
        ) s
    ) w;
  perform public.check_rate_limit(
    v_uid, 'submit_find', v_used, public.anti_cheat_param('submit_find_per_10min')::int, '10 min (czas znaleziska)',
    format('Za dużo znalezisk naraz: najwyżej %s w ciągu 10 minut (wg czasu znalezienia). To znalezisko odrzucono.',
           public.anti_cheat_param('submit_find_per_10min')));
  -- Dziennie wg czasu serwera.
  select count(*) into v_used
    from public.finds x
   where x.user_id = v_uid and x.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'submit_find_day', v_used, public.anti_cheat_param('submit_find_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit znalezisk (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('submit_find_per_day')),
    public.warsaw_ts(public.local_today() + 1));

  -- ── Prawda serwera: rzadkość i XXL ──
  v_rarity := p_rarity;
  if p_rarity < sp.rarity then
    v_rarity := sp.rarity;
  elsif public.rarity_rank(p_rarity) > public.rarity_rank(sp.rarity) + 1 then
    v_rarity := (enum_range(null::public.rarity))[public.rarity_rank(sp.rarity) + 2];
    perform public.flag(v_uid, 'rarity_clamped', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'speciesRarity', sp.rarity, 'reported', p_rarity, 'stored', v_rarity));
  end if;

  v_xxl := coalesce(p_xxl, false);
  if v_xxl and (sp.clustered or v_weight is null or v_weight < sp.typical_weight_g * public.anti_cheat_param('xxl_factor')) then
    v_xxl := false;
    perform public.flag(v_uid, 'xxl_corrected', 1, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'typicalWeightG', sp.typical_weight_g, 'clustered', sp.clustered));
  end if;

  -- ── Flagi wiarygodności ──
  v_piece_g := case when not sp.clustered then v_weight
                    when v_pieces > 0 then v_weight::numeric / v_pieces end;   -- kępka bez liczby sztuk – bez sprawdzenia wagi
  if v_piece_g > sp.typical_weight_g * public.anti_cheat_param('find_weight_factor')
     or v_cap > sp.typical_cap_cm * public.anti_cheat_param('find_cap_factor') then
    perform public.flag(v_uid, 'find_size', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'pieces', v_pieces, 'capCm', v_cap,
      'typicalWeightG', sp.typical_weight_g, 'typicalCapCm', sp.typical_cap_cm));
  end if;

  if p_trip_id is not null then
    select * into v_trip from public.trips t where t.id = p_trip_id and t.user_id = v_uid;
    v_trip_id := v_trip.id;
  end if;
  if v_trip_id is not null
     and (v_found < v_trip.started_at - v_grace or (v_trip.ended_at is not null and v_found > v_trip.ended_at + v_grace)) then
    perform public.flag(v_uid, 'find_outside_trip', 1, p_find_id::text, jsonb_build_object(
      'tripId', v_trip_id, 'foundAt', public.iso_ts(v_found), 'startedAt', public.iso_ts(v_trip.started_at),
      'endedAt', public.iso_ts(v_trip.ended_at)));
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
    p_find_id, v_uid, v_trip_id, v_scan_id, v_ident_id, sp.id, p_gmina_id, v_rarity, p_confidence, v_xxl,
    v_cap, v_height, v_weight, v_age, v_pieces, sp.edibility not in ('trujacy', 'smiertelny'), 'pending', v_found
  )
  returning * into f;

  -- Seria rzadkich okazów (łącznie z nowym; bez odrzuconych).
  if v_rarity >= 'rzadki' then
    select count(*) filter (where x.rarity >= 'rzadki'), count(*) filter (where x.rarity >= 'epicki')
      into v_rare, v_epic
      from public.finds x
     where x.user_id = v_uid and x.status <> 'discarded'
       and x.found_at between v_found - v_burst and v_found + v_burst;
    if v_epic >= public.anti_cheat_param('rare_burst_epic') or v_rare >= public.anti_cheat_param('rare_burst_rare') then
      perform public.flag(v_uid, 'rare_burst', 2, to_char(v_found at time zone 'Europe/Warsaw', 'YYYY-MM-DD'),
        jsonb_build_object('rare', v_rare, 'epic', v_epic, 'foundAt', public.iso_ts(v_found), 'findId', p_find_id));
    end if;
  end if;
  return f;
end $$;

-- claim_find: jak w 20261006100000_achievements.sql + dzienny „miękki” limit XP ze znalezisk (czas serwera, Europe/Warsaw):
-- powyżej daily_find_xp_soft_cap nagroda bez zmian, tylko flaga 'xp_daily_soft_cap' (2) – dźwignia na później (np. malejące XP).
create or replace function public.claim_find(p_find_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.finds;
  sp public.species;
  pr public.profiles;
  prev public.user_species;
  v_trip_id uuid;
  v_base int;
  v_lines jsonb := '[]';
  v_total int;
  v_new_atlas boolean;
  v_first_today boolean;
  v_record boolean := false;
  v_before record;
  v_after record;
  v_quests text[] := '{}';
  v_challenges text[] := '{}';
  v_badges text[] := '{}';
  v_achievements jsonb := '[]';
  v_reward jsonb;
  v_day_xp bigint;
  q record;
  ch record;
begin
  select * into f from public.finds where id = p_find_id and user_id = v_uid for update;
  if not found then raise exception 'find_not_found' using errcode = 'P0002'; end if;
  if f.status = 'claimed' then return f.reward; end if;
  if f.status = 'discarded' then raise exception 'find_discarded' using errcode = 'P0001'; end if;
  if f.confidence < 0.6 then raise exception 'low_confidence' using errcode = 'P0001'; end if;

  -- Znalezisko poza wyprawą → wyprawa startuje automatycznie.
  v_trip_id := f.trip_id;
  if v_trip_id is null then
    select id into v_trip_id from public.trips where user_id = v_uid and status = 'active';
    if v_trip_id is null then v_trip_id := (public.start_trip(f.gmina_id)).id; end if;
  end if;

  select * into sp from public.species where id = f.species_id;
  select * into pr from public.profiles where id = v_uid for update;
  select * into prev from public.user_species where user_id = v_uid and species_id = f.species_id;
  v_new_atlas := prev is null;
  v_first_today := not exists (
    select 1 from public.finds x
     where x.user_id = v_uid and x.status = 'claimed' and x.gmina_id = f.gmina_id and x.species_id = f.species_id
       and (x.claimed_at at time zone 'Europe/Warsaw')::date = public.local_today()
  );

  -- Rozpiska XP – identyczna z utils/xp.ts (computeFindXp).
  v_base := public.rarity_base(f.rarity);
  if not f.collected then
    v_lines := v_lines || jsonb_build_object('label', 'Zdjęcie gatunku trującego (½ bazy)', 'xp', round(v_base / 2.0)::int);
  else
    v_lines := v_lines || jsonb_build_object('label', format('Bazowe XP (%s)', f.rarity), 'xp', v_base);
    if f.xxl then
      v_lines := v_lines || jsonb_build_object('label', 'Okaz XXL ×1,5', 'xp', round(v_base * 0.5)::int);
    end if;
    if v_first_today then
      v_lines := v_lines || jsonb_build_object('label', format('Pierwszy %s w gminie dziś', sp.short_name), 'xp', 40);
    end if;
    if pr.streak_days >= 2 then
      v_lines := v_lines || jsonb_build_object('label', format('Seria %s dni', pr.streak_days), 'xp', 30);
    end if;
  end if;
  if v_new_atlas then
    v_lines := v_lines || jsonb_build_object('label', 'Nowy gatunek w atlasie', 'xp', 50);
  end if;
  select coalesce(sum((l ->> 'xp')::int), 0) into v_total from jsonb_array_elements(v_lines) l;

  select * into v_before from public.level_from_total_xp(pr.total_xp);
  select * into v_after from public.level_from_total_xp(pr.total_xp + v_total);
  v_record := not v_new_atlas and coalesce(prev.best_cap_cm, 0) > 0 and f.cap_cm > prev.best_cap_cm;

  update public.finds
     set status = 'claimed', trip_id = v_trip_id, xp = v_total, personal_record = v_record, claimed_at = now()
   where id = f.id;
  insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
  values (v_uid, 'find', f.id::text, f.gmina_id, v_total);
  update public.trips set xp = xp + v_total where id = v_trip_id;
  update public.profiles set mushrooms_count = mushrooms_count + f.collected::int where id = v_uid;

  -- Anty-cheat: XP ze znalezisk dziś (łącznie z tym) ponad „miękki” limit → flaga, nagroda bez zmian.
  select coalesce(sum(e.amount), 0) into v_day_xp
    from public.xp_events e
   where e.user_id = v_uid and e.source = 'find' and e.created_at >= public.warsaw_ts(public.local_today());
  if v_day_xp > public.anti_cheat_param('daily_find_xp_soft_cap') then
    perform public.flag(v_uid, 'xp_daily_soft_cap', 2, to_char(public.local_today(), 'YYYY-MM-DD'), jsonb_build_object(
      'xpToday', v_day_xp, 'softCap', public.anti_cheat_param('daily_find_xp_soft_cap'), 'lastFindId', f.id));
  end if;

  insert into public.user_species as us (user_id, species_id, count, first_found_at, best_cap_cm, best_weight_g, best_find_id)
  values (v_uid, f.species_id, 1, f.found_at, f.cap_cm, f.weight_g, f.id)
  on conflict (user_id, species_id) do update set
    count = us.count + 1,
    best_cap_cm = greatest(us.best_cap_cm, excluded.best_cap_cm),
    best_weight_g = greatest(us.best_weight_g, excluded.best_weight_g),
    best_find_id = case when excluded.best_cap_cm > coalesce(us.best_cap_cm, 0) then excluded.best_find_id else us.best_find_id end;

  -- Zadania dnia (XP wypłacane od razu; aplikacja pokazuje toast po ekranie Nagroda).
  for q in select id, kind from public.quest_templates where active and kind in ('scans', 'rare') order by sort loop
    continue when q.kind = 'rare' and public.rarity_rank(f.rarity) < public.rarity_rank('rzadki');
    if public.bump_quest(v_uid, q.id, 1, f.gmina_id) then v_quests := v_quests || q.id; end if;
  end loop;

  -- Przyjęte wyzwania gminy na ten gatunek.
  for ch in
    select c.id, c.xp, c.badge_id from public.user_challenges uc
      join public.gmina_challenges c on c.id = uc.challenge_id
     where uc.user_id = v_uid and uc.completed_at is null and c.active
       and c.species_id = f.species_id and c.gmina_id = f.gmina_id and (c.ends_at is null or c.ends_at > now())
  loop
    update public.user_challenges set completed_at = now(), find_id = f.id
     where user_id = v_uid and challenge_id = ch.id;
    insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
    values (v_uid, 'challenge', ch.id::text, f.gmina_id, ch.xp);
    if ch.badge_id is not null then
      insert into public.user_badges (user_id, badge_id, find_id) values (v_uid, ch.badge_id, f.id) on conflict do nothing;
      v_badges := v_badges || ch.badge_id;
    end if;
    v_challenges := v_challenges || ch.id::text;
  end loop;

  v_badges := v_badges || public.evaluate_badges(v_uid, f.id);

  -- Osiągnięcia z nowego stanu atlasu (XP do księgi od razu; aplikacja pokazuje kartę na ekranie Nagroda).
  v_achievements := public.sync_achievements(v_uid, f.id);

  if v_after.level > v_before.level then
    insert into public.posts (author_id, kind, gmina_id, payload, visible_from)
    values (v_uid, 'levelup', f.gmina_id, jsonb_build_object('level', v_after.level), now() + public.privacy_delay());
  end if;

  v_reward := jsonb_build_object(
    'xp', jsonb_build_object('lines', v_lines, 'total', v_total),
    'levelBefore', v_before.level, 'xpBefore', v_before.xp_in_level,
    'levelAfter', v_after.level, 'xpAfter', v_after.xp_in_level,
    'unlockedBadgeIds', to_jsonb(v_badges),
    'unlockedAchievements', v_achievements,
    'completedQuestIds', to_jsonb(v_quests),
    'completedChallengeIds', to_jsonb(v_challenges),
    'personalRecord', v_record
  );
  update public.finds set reward = v_reward where id = f.id;
  return v_reward;
end $$;

-- set_find_photo: jak w 20261010100000_storage.sql + flaga 'photo_reuse' (2), gdy ta sama ścieżka jest już przy innym
-- znalezisku gracza (konwencja aplikacji: {uid}/{findId}.jpg – jedno zdjęcie na znalezisko). Zapis bez zmian.
create or replace function public.set_find_photo(p_find_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_others jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.finds where id = p_find_id and user_id = v_uid for update;
  if not found then raise exception 'find_not_found' using errcode = 'P0002'; end if;
  if p_path is not null and not public.is_user_image_path(p_path, v_uid) then
    raise exception 'invalid_path' using errcode = 'P0001',
      detail = format('Ścieżka „%s” musi leżeć w folderze gracza (%s/…) i kończyć się .jpg, .jpeg, .png albo .webp', p_path, v_uid);
  end if;
  update public.finds set photo_path = p_path
   where id = p_find_id and photo_path is distinct from p_path;

  if p_path is not null then
    select jsonb_agg(x.id order by x.id) into v_others
      from public.finds x
     where x.user_id = v_uid and x.photo_path = p_path and x.id <> p_find_id;
    if v_others is not null then
      perform public.flag(v_uid, 'photo_reuse', 2, p_find_id::text, jsonb_build_object('path', p_path, 'otherFindIds', v_others));
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Społeczność: limity komentarzy, zaproszeń i zgłoszeń
-- ─────────────────────────────────────────────────────────────────────────────

-- Komentarze: > 30 w 10 min → rate_limited. Wyzwalacz, bo klient może też wstawić komentarz wprost (RLS + GRANT insert);
-- liczy się tylko komentarz wywołującego we własnym imieniu (author_id = auth.uid()) – boty deweloperskie (dev_bots_act,
-- dev_seed_social) piszą za innych graczy i nie są ograniczane. Ponowienie add_comment z tym samym id nie dochodzi do INSERT.
create or replace function public.post_comments_rate_limit() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_used bigint;
  v_oldest timestamptz;
begin
  if new.author_id is distinct from auth.uid() then return new; end if;
  perform pg_advisory_xact_lock(hashtext('anti_cheat:add_comment:' || new.author_id::text));
  select count(*), min(c.created_at) into v_used, v_oldest
    from public.post_comments c
   where c.author_id = new.author_id and c.created_at > now() - interval '10 minutes';
  perform public.check_rate_limit(
    new.author_id, 'add_comment', v_used, public.anti_cheat_param('add_comment_per_10min')::int, '10 min',
    format('Za dużo komentarzy: najwyżej %s w ciągu 10 minut. Odczekaj chwilę.', public.anti_cheat_param('add_comment_per_10min')),
    v_oldest + interval '10 minutes');
  return new;
end $$;
drop trigger if exists post_comments_rate_limit on public.post_comments;
create trigger post_comments_rate_limit before insert on public.post_comments
  for each row execute function public.post_comments_rate_limit();

-- Zaproszenia do znajomych: > 50 nowych dziennie (czas serwera) → rate_limited. Wyzwalacz (send_friend_request i bezpośredni
-- INSERT przez API); tylko wiersz, w którym zapraszającym jest wywołujący. Odpala się po friendships_block_guard (kolejność
-- alfabetyczna) – pominięte zaproszenie zablokowanych nie dochodzi do limitu. Akceptacja (UPDATE) się nie liczy.
create or replace function public.friendships_rate_limit() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_used bigint;
begin
  if new.user_id is distinct from auth.uid() then return new; end if;
  perform pg_advisory_xact_lock(hashtext('anti_cheat:friend_request:' || new.user_id::text));
  select count(*) into v_used
    from public.friendships f
   where f.user_id = new.user_id and f.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    new.user_id, 'send_friend_request', v_used, public.anti_cheat_param('friend_request_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit zaproszeń do znajomych (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('friend_request_per_day')),
    public.warsaw_ts(public.local_today() + 1));
  return new;
end $$;
drop trigger if exists friendships_rate_limit on public.friendships;
create trigger friendships_rate_limit before insert on public.friendships
  for each row execute function public.friendships_rate_limit();

-- report_post: jak w 20261008100000_social.sql + limit 30 zgłoszeń dziennie (czas serwera). Ponowne zgłoszenie tego
-- samego (idempotentne) wraca przed limitem.
create or replace function public.report_post(p_post_id uuid, p_comment_id uuid default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g'), '');
  v_used bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.post_visible_to(p_post_id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  if p_comment_id is not null
     and not exists (select 1 from public.post_comments c where c.id = p_comment_id and c.post_id = p_post_id) then
    raise exception 'comment_not_found' using errcode = 'P0002';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'invalid_reason' using errcode = 'P0001', detail = 'Powód zgłoszenia może mieć najwyżej 500 znaków';
  end if;
  if exists (select 1 from public.post_reports r
              where r.reporter_id = v_uid and r.post_id = p_post_id and r.comment_id is not distinct from p_comment_id) then
    return;
  end if;
  select count(*) into v_used
    from public.post_reports r
   where r.reporter_id = v_uid and r.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'report_post', v_used, public.anti_cheat_param('report_post_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit zgłoszeń (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('report_post_per_day')),
    public.warsaw_ts(public.local_today() + 1));
  insert into public.post_reports (post_id, comment_id, reporter_id, reason)
  values (p_post_id, p_comment_id, v_uid, v_reason)
  on conflict do nothing;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Usunięcie konta: + flagi anty-cheatu (reszta bez zmian względem 20261011100000_account.sql)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.wipe_account_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.wipe_game_data(p_user);      -- wyprawy (+ ślady GPS), skany (+ rozpoznania), znaleziska (+ punkty),
                                              -- księga XP, atlas, odznaki, osiągnięcia, zadania, wyzwania, wpisy (+ cudze reakcje / komentarze pod nimi)
  perform public.wipe_social_data(p_user);    -- znajomi, ukryte, zgłoszenia, własne komentarze i reakcje, moje blokady
  delete from public.user_blocks where blocked_id = p_user;
  delete from public.gmina_follows where user_id = p_user;
  delete from public.push_tokens where user_id = p_user;
  delete from public.user_terms_acceptances where user_id = p_user;
  delete from public.dev_bot_activity where user_id = p_user;
  delete from public.anti_cheat_flags where user_id = p_user;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Moderacja (tylko service_role / Studio)
-- ─────────────────────────────────────────────────────────────────────────────

-- Ostatnie 7 dni (wg last_at): gracz × rodzaj × waga – liczba flag (wierszy), suma powtórzeń, pierwsza i ostatnia.
-- security_invoker: widok czyta tabelę uprawnieniami wywołującego (klienci nie mają GRANT – i tak nic nie zobaczą).
create or replace view public.anti_cheat_summary with (security_invoker = true) as
select f.user_id,
       p.handle::text as handle,
       p.is_bot,
       f.kind,
       f.severity,
       count(*) as flags,
       sum(f.hits) as hits,
       min(f.created_at) as first_at,
       max(f.last_at) as last_at
  from public.anti_cheat_flags f
  left join public.profiles p on p.id = f.user_id
 where f.last_at > now() - interval '7 days'
 group by f.user_id, p.handle, p.is_bot, f.kind, f.severity;

-- Najnowsze flagi (od ostatnio powtórzonej), od wagi p_min_severity. p_limit 1–1000. Tylko service_role
-- (Edge Function / panel moderacji z kluczem serwisowym); SECURITY INVOKER – bez GRANT na tabelę nic nie zwróci.
create or replace function public.admin_flags(p_limit int default 100, p_min_severity int default 1)
returns table (
  id bigint, user_id uuid, handle text, kind text, severity smallint, ref_id text, details jsonb, hits int,
  created_at timestamptz, last_at timestamptz
)
language sql stable security invoker set search_path = public, extensions as $$
  select f.id, f.user_id, p.handle::text, f.kind, f.severity, f.ref_id, f.details, f.hits, f.created_at, f.last_at
    from public.anti_cheat_flags f
    left join public.profiles p on p.id = f.user_id
   where f.severity >= coalesce(p_min_severity, 1)
   order by f.last_at desc, f.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 1000)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.anti_cheat_flags, public.anti_cheat_summary from anon, authenticated;
-- service_role (Edge Function / moderacja) – w Supabase ma to już z domyślnych uprawnień; jawnie dla pewności.
grant usage on schema public to service_role;
grant select on public.anti_cheat_flags, public.anti_cheat_summary, public.profiles to service_role;

revoke all on function
  public.anti_cheat_param(text),
  public.flag(uuid, text, int, text, jsonb),
  public.anti_cheat_bypass(),
  public.check_rate_limit(uuid, text, bigint, int, text, text, timestamptz),
  public.trip_elapsed_s(timestamptz, timestamptz),
  public.credit_trip_distance(public.trips, int, timestamptz),
  public.check_trip_speed(public.trips),
  public.post_comments_rate_limit(),
  public.friendships_rate_limit(),
  public.admin_flags(int, int)
  from public, anon, authenticated;
grant execute on function public.admin_flags(int, int) to service_role;
-- Funkcje zmienione przez create or replace (start_trip, report_trip_progress, close_trip, finish_trip, submit_find,
-- claim_find, set_find_photo, report_post, wipe_account_data) zachowują dotychczasowe uprawnienia.
