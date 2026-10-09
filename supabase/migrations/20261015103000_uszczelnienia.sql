-- =============================================================================
-- Uszczelnienia anty-cheatu i prywatności (audyt przed rywalizacją – docs/rywalizacja.md, docs/backend.md
-- → „Uszczelnienia anty-cheatu”). Podpisane rozpoznanie (submit_find, finds.verified) – osobna migracja
-- 20261015100000_podpisane_rozpoznanie.sql; tu znaleziska „zweryfikowane” rozpoznajemy po finds.verified.
--
--  1. Funkcje dev_* – migracje NIE nadają klientom EXECUTE (pętla po wszystkich public.dev_%, także dev_tools_enabled);
--     nadaje je wyłącznie seed lokalny (scripts/gen-seed.ts; wariant --cloud odbiera). Na produkcji nawet przypadkowe
--     app_config.dev_tools = true nie daje dostępu. Reguła dla nowych funkcji dev_*: bez GRANT w migracji, funkcja sama
--     sprawdza dev_tools_enabled() (seed nadaje EXECUTE tylko takim). dev_seed_activity: znaleziska botów zweryfikowane.
--  2. Wyprawy – czas serwera: start z telefonu cofnięty najwyżej o trip_backdated_h (12 h), nie w przyszłość i nie
--     przed końcem poprzedniej wyprawy (bez nakładania); czas trwania = koniec − start (przycięty, najwyżej 12 h);
--     dystans: dotychczasowa prędkość + średnia długiej wyprawy (5 km + 6 km/h) + twardy limit wyprawy (40 km) i doby
--     (60 km); seria i aktywne dni z przyciętego startu (uczciwa kolejka offline do 12 h nie traci serii), wczesne
--     starty („Ranny ptaszek”, Skowronek, zadanie „Wyrusz przed 7:00”) tylko potwierdzone przez serwer (wyprawa
--     zarejestrowana najwyżej trip_early_lag_min po starcie). Ślad GPS z telefonu ignorowany (aplikacja wysyła null).
--  3. Wyzwania gmin: przyjęcie tylko w gminie domowej albo obserwowanej, najwyżej 3 aktywne; bezpośredni INSERT do
--     user_challenges odebrany; zaliczenie tylko znaleziskiem zweryfikowanym, znalezionym po przyjęciu i w oknie
--     wyzwania, najwyżej 2 ukończenia na dobę; wyzwanie tygodniowe z gatunku liczonego ze zweryfikowanych znalezisk.
--  4. Rankingi gmin: punkty tylko ze źródeł rywalizacji – find (zweryfikowane), challenge, contest, duel – i tylko
--     graczy competition_eligible; rekordy – zweryfikowane okazy. Ten sam filtr: ranking_xp_events() (też dla RB).
--  5. Prywatność: profiles, user_badges, user_achievements, posts – bezpośredni odczyt tylko własnych wierszy (cudze
--     wyłącznie przez RPC security definer z blokadami i deleted_at); UPDATE własnego profilu bez zmian.
--  6. Spam: nazwa / imię (bez znaków sterujących, ≤ 40), zarezerwowane nicki, tytuł wpisu (≤ 80), limit reakcji
--     (wyzwalacz + dziennik rate_events), reakcje tylko przez toggle_reaction.
--  7. Porządki: stare funkcje statystyk z init usunięte; blocked_with_me tylko w schemacie private (nieeksponowanym
--     przez PostgREST) – klienci nie wywołają wyroczni blokad; scans bez bezpośredniego INSERT / UPDATE.
--  8. Rywalizacja: competition_eligible liczy incydenty (wiersze flag) wagi 3 od ostatniej decyzji moderatora,
--     profil nieusunięty; flag() przy competition_flag_hits incydentach ustawia player_standing = 'review' na okno flag.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Progi (anti_cheat_params – dopisujemy swoje klucze)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.anti_cheat_params (k, v, note) values
  -- wyprawy
  ('trip_backdated_h', 12, 'start wyprawy z telefonu cofnięty najwyżej o tyle godzin (starszy → przycięty, flaga 1)'),
  ('trip_max_elapsed_s', 43200, 'czas wyprawy do prędkości najwyżej 12 h'),
  ('trip_max_duration_s', 43200, 'czas trwania wyprawy (duration_s) najwyżej 12 h'),
  ('trip_early_lag_min', 30, 'wczesny start liczy się, gdy serwer dostał go najwyżej tyle minut po starcie'),
  ('trip_avg_base_km', 5, 'średnia wyprawy: uznane najwyżej 5 km + czas × trip_avg_kmh (flaga 2)'),
  ('trip_avg_kmh', 6, 'średnia wyprawy: km/h ponad trip_avg_base_km'),
  ('trip_max_km', 40, 'twardy limit uznanego dystansu jednej wyprawy (flaga 2)'),
  ('day_max_km', 60, 'twardy limit uznanego dystansu wypraw rozpoczętych jednego dnia (flaga 2)'),
  -- wyzwania gmin
  ('challenge_active_max', 3, 'najwyżej tyle przyjętych, nieukończonych, trwających wyzwań naraz'),
  ('challenge_active_days', 7, 'przyjęte wcześniej (np. stałe bez końca) nie zajmują miejsca'),
  ('challenge_completions_per_day', 2, 'ukończenia wyzwań na dobę (czas serwera)'),
  ('challenge_accept_grace_min', 10, 'znalezisko najwyżej tyle minut przed przyjęciem wyzwania jeszcze je zalicza'),
  ('challenge_queue_grace_h', 6, 'odbiór znaleziska do tylu godzin po końcu wyzwania (kolejka offline)'),
  -- reakcje
  ('reaction_per_10min', 60, '„Darz grzyb!” (włączenia) w 10 min'),
  ('reaction_per_day', 600, '„Darz grzyb!” (włączenia) na dobę'),
  -- rywalizacja
  ('competition_flag_hits', 3, 'tyle incydentów (wierszy flag) wagi 3 – poza samym limitem – w oknie od ostatniej decyzji moderatora → poza rywalizacją i automatycznie review')
on conflict (k) do update set v = excluded.v, note = excluded.note;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Funkcje dev_*: bez EXECUTE dla klientów (nadaje je tylko seed lokalny)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dev\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Generator aktywności: jak w 20261010100000_storage.sql + znaleziska botów zweryfikowane (boty udają graczy
-- z podpisanym rozpoznaniem – inaczej rankingi lokalne byłyby puste).
create or replace function public.dev_seed_activity(p_voivodeship text default null, p_weeks int default 8) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_voiv text;
  v_weeks int := least(greatest(coalesce(p_weeks, 8), 1), 26);
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  v_voiv := public.resolve_voivodeship(p_voivodeship, v_uid);
  -- Dwa telefony naraz nie utworzą botów podwójnie.
  perform pg_advisory_xact_lock(hashtext('dev_seed_activity'));

  v_out := jsonb_build_object('voivodeship', v_voiv) || public.dev_seed_voivodeship(v_voiv, v_weeks);
  if v_voiv <> 'podlaskie' then
    v_out := v_out || jsonb_build_object('podlaskie', public.dev_seed_voivodeship('podlaskie', v_weeks));
  end if;
  update public.profiles set listed = false where is_bot and listed and handle::text ~ '^bot[0-9]{2}\.';
  update public.finds f set verified = true
    from public.profiles p
   where p.id = f.user_id and p.is_bot and not f.verified and f.status = 'claimed';
  perform public.refresh_gmina_rankings();
  return v_out;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Wyprawy: czas serwera, czas trwania, dystans
-- ─────────────────────────────────────────────────────────────────────────────

-- „Rozpocznij grzybobranie” (sygnatura i idempotentność jak w 20261012100000_anticheat.sql). Start (prawda serwera):
--  · czas z telefonu (kolejka offline), ale nie w przyszłość, najwyżej trip_backdated_h (12 h) wstecz i nie przed
--    końcem poprzedniej wyprawy gracza – wyprawy się nie nakładają; aktywna wyprawa kończy się w chwili startu nowej;
--  · przycięcie → flaga 'trip_backdated' (1, starszy niż okno) albo 'trip_overlap' (1, przed końcem poprzedniej);
--  · seria dni wg daty przyciętego startu (Europe/Warsaw), tylko do przodu – cofnięcie serii o 60 dni nie przejdzie.
create or replace function public.start_trip(p_gmina_id text, p_trip_id uuid default null, p_started_at timestamptz default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_req timestamptz := least(coalesce(p_started_at, now()), now());
  v_window timestamptz := now() - make_interval(hours => public.anti_cheat_param('trip_backdated_h')::int);
  v_prev timestamptz;
  v_start timestamptz;
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

  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'unknown_gmina' using errcode = 'P0001', detail = format('Gmina „%s” nie istnieje w bazie', p_gmina_id);
  end if;

  select max(coalesce(x.ended_at, x.started_at)) into v_prev
    from public.trips x
   where x.user_id = v_uid and x.status <> 'active';
  v_start := greatest(v_req, v_window, v_prev, case when v_active then t.started_at end);

  if v_active then
    perform public.close_trip(t.id, v_start);
  end if;

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

  if v_req < v_window then
    perform public.flag(v_uid, 'trip_backdated', 1, t.id::text, jsonb_build_object(
      'requestedAt', public.iso_ts(v_req), 'startedAt', public.iso_ts(v_start),
      'hoursAgo', round(extract(epoch from now() - v_req) / 3600.0, 1)));
  elsif v_start > v_req + make_interval(secs => public.anti_cheat_param('trip_grace_s')::int) then
    perform public.flag(v_uid, 'trip_overlap', 1, t.id::text, jsonb_build_object(
      'requestedAt', public.iso_ts(v_req), 'startedAt', public.iso_ts(v_start), 'previousEndedAt', public.iso_ts(v_prev)));
  end if;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

-- Dystans narastająco z telefonu → przyrost uznany przez serwer (jak w 20261012100000_anticheat.sql: prędkość
-- 12 / 8 / 50 km/h) + uszczelnienia, kolejno (każde przycięcie nie schodzi poniżej już uznanego):
--  · średnia długiej wyprawy: najwyżej trip_avg_base_km (5 km) + czas × trip_avg_kmh (6 km/h) → 'trip_distance_avg' (2);
--  · twardy limit wyprawy trip_max_km (40 km) → 'trip_distance_cap' (2);
--  · twardy limit doby day_max_km (60 km) – suma z innymi wyprawami rozpoczętymi tego dnia → 'day_distance_cap' (2).
create or replace function public.credit_trip_distance(t public.trips, p_distance_m int, p_at timestamptz)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_reported int := greatest(coalesce(p_distance_m, 0), 0);
  v_elapsed numeric;
  v_kmh numeric;
  v_new int;
  v_cap int;
  v_day date := (t.started_at at time zone 'Europe/Warsaw')::date;
  v_day_other bigint;
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

  v_cap := floor(public.anti_cheat_param('trip_avg_base_km') * 1000
                 + v_elapsed * public.anti_cheat_param('trip_avg_kmh') / 3.6)::int;
  if v_new > v_cap then
    v_new := greatest(t.distance_m, v_cap);
    perform public.flag(t.user_id, 'trip_distance_avg', 2, t.id::text, v_info || jsonb_build_object('countedM', v_new, 'capM', v_cap));
  end if;

  v_cap := (public.anti_cheat_param('trip_max_km') * 1000)::int;
  if v_new > v_cap then
    v_new := greatest(t.distance_m, v_cap);
    perform public.flag(t.user_id, 'trip_distance_cap', 2, t.id::text, v_info || jsonb_build_object('countedM', v_new, 'capM', v_cap));
  end if;

  select coalesce(sum(x.distance_m), 0) into v_day_other
    from public.trips x
   where x.user_id = t.user_id and x.id <> t.id
     and x.started_at >= public.warsaw_ts(v_day) and x.started_at < public.warsaw_ts(v_day + 1);
  v_cap := (public.anti_cheat_param('day_max_km') * 1000 - v_day_other)::int;
  if v_new > v_cap then
    v_new := greatest(t.distance_m, v_cap);
    perform public.flag(t.user_id, 'day_distance_cap', 2, to_char(v_day, 'YYYY-MM-DD'),
      v_info || jsonb_build_object('tripId', t.id, 'countedM', v_new, 'otherTripsM', v_day_other));
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

-- Zamknięcie wyprawy (jak w 20261012100000_anticheat.sql) + czas trwania z serwera: duration_s = najwyżej
-- ended_at − started_at i trip_max_duration_s (12 h); krótszy z telefonu (np. pauzy) zostaje. Czas z telefonu dłuższy
-- niż koniec − start (+ tolerancja) → 'trip_duration' (1).
create or replace function public.close_trip(p_trip_id uuid, p_ended_at timestamptz, p_duration_s int default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  t public.trips;
  v_end timestamptz;
  v_elapsed int;
begin
  select * into t from public.trips where id = p_trip_id for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  v_end := greatest(t.started_at, least(coalesce(p_ended_at, now()), now()));
  v_elapsed := extract(epoch from v_end - t.started_at)::int;
  update public.trips
     set status = 'finished',
         ended_at = v_end,
         duration_s = least(greatest(0, coalesce(p_duration_s, v_elapsed)), v_elapsed,
                            public.anti_cheat_param('trip_max_duration_s')::int)
   where id = t.id
   returning * into t;
  update public.finds set visible_from = t.ended_at + public.privacy_delay()
   where trip_id = t.id and status = 'claimed';
  update public.finds set status = 'discarded' where trip_id = t.id and status = 'pending';
  update public.profiles set trips_count = trips_count + 1 where id = t.user_id;
  if p_duration_s > v_elapsed + public.anti_cheat_param('trip_grace_s') then
    perform public.flag(t.user_id, 'trip_duration', 1, t.id::text, jsonb_build_object(
      'reportedS', p_duration_s, 'elapsedS', v_elapsed, 'storedS', t.duration_s));
  end if;
  perform public.check_trip_speed(t);
  return t;
end $$;

-- Koniec wyprawy (sygnatura bez zmian). Jak w 20261012100000_anticheat.sql, ale ślad GPS z telefonu jest IGNOROWANY:
-- nie da się go sprawdzić, a trafiał do publicznej trasy wpisu (aplikacja i tak wysyła null). Niepusty → flaga
-- 'client_track_ignored' (1). Surowego śladu serwer nie przechowuje (minimalizacja danych).
create or replace function public.finish_trip(
  p_trip_id uuid, p_distance_m int, p_duration_s int, p_track_geojson text default null, p_ended_at timestamptz default null
)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then return t; end if;
  t := public.credit_trip_distance(t, p_distance_m, greatest(t.started_at, least(coalesce(p_ended_at, now()), now())));
  if p_track_geojson is not null then
    perform public.flag(v_uid, 'client_track_ignored', 1, t.id::text, jsonb_build_object('chars', char_length(p_track_geojson)));
  end if;
  return public.close_trip(t.id, coalesce(p_ended_at, now()), p_duration_s);
end $$;

-- Odznaki (jak w 20261005120000_init.sql); „Ranny ptaszek” (early_bird) tylko za start potwierdzony przez serwer:
-- wyprawa zarejestrowana najwyżej trip_early_lag_min po starcie (cofnięty start z telefonu się nie liczy).
create or replace function public.evaluate_badges(p_user uuid, p_find_id uuid default null) returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.badges;
  ok boolean;
  granted text[] := '{}';
  v_lag interval := make_interval(mins => public.anti_cheat_param('trip_early_lag_min')::int);
begin
  for b in
    select * from public.badges x
     where not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_id = x.id)
     order by x.sort
  loop
    ok := case b.rule ->> 'type'
      when 'species_in_region' then (
        select count(*) from public.finds f join public.gminy g on g.id = f.gmina_id
         where f.user_id = p_user and f.status = 'claimed' and f.collected
           and f.species_id = b.rule ->> 'species' and g.forest_region_id = b.rule ->> 'region'
      ) >= (b.rule ->> 'count')::int
      when 'distance_km' then (
        select total_distance_m from public.profiles where id = p_user
      ) >= (b.rule ->> 'km')::numeric * 1000
      when 'streak' then (
        select streak_days from public.profiles where id = p_user
      ) >= (b.rule ->> 'days')::int
      when 'rarity_find' then (
        select count(*) from public.finds f
         where f.user_id = p_user and f.status = 'claimed' and f.rarity = (b.rule ->> 'rarity')::public.rarity
      ) >= coalesce((b.rule ->> 'count')::int, 1)
      when 'early_bird' then exists (
        select 1 from public.trips t
         where t.user_id = p_user and (t.started_at at time zone 'Europe/Warsaw')::time < (b.rule ->> 'before')::time
           and t.created_at <= t.started_at + v_lag
      )
      else false
    end;
    if ok then
      insert into public.user_badges (user_id, badge_id, find_id) values (p_user, b.id, p_find_id)
      on conflict do nothing;
      granted := granted || b.id;
    end if;
  end loop;
  return granted;
end $$;

-- Wyzwalacz wypraw (jak w 20261013110000_progression.sql): zadanie „Wyrusz przed 7:00” i Skowronek (start przed 6:00)
-- tylko za start potwierdzony przez serwer (jak odznaka „Ranny ptaszek”).
create or replace function public.trips_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
  v_local timestamp := new.started_at at time zone 'Europe/Warsaw';
  v_confirmed boolean := new.created_at <= new.started_at + make_interval(mins => public.anti_cheat_param('trip_early_lag_min')::int);
begin
  if public.is_bot_player(new.user_id) then return null; end if;
  if tg_op = 'INSERT' then
    if v_confirmed and v_local::date = public.local_today() then
      for q in select * from public.selected_quests(new.user_id, array['early_start']) loop
        if extract(hour from v_local) < coalesce((q.params ->> 'beforeHour')::int, 7) then
          perform public.bump_selected_quest(new.user_id, q, 1, new.gmina_id);
        end if;
      end loop;
    end if;
    if v_confirmed and extract(hour from v_local) < 6 then perform public.sync_achievements(new.user_id); end if;
    return null;
  end if;
  -- Koniec wyprawy (finish_trip / close_trip; publikacja finished → published tu nic nie robi).
  if old.status = 'active' and new.status <> 'active' then
    for q in select * from public.selected_quests(new.user_id, array['trips', 'trip_minutes']) loop
      if q.kind::text = 'trips' or coalesce(new.duration_s, 0) >= coalesce((q.params ->> 'minutes')::int, 60) * 60 then
        perform public.bump_selected_quest(new.user_id, q, 1, new.gmina_id);
      end if;
    end loop;
    perform public.sync_achievements(new.user_id);
  end if;
  return null;
end $$;

-- Metryki gracza (jak w 20261013110000_progression.sql). Wyprawy: seria i aktywne dni z daty startu – a start jest już
-- przycięty przez serwer (≤ 12 h wstecz, bez nakładania), więc kolejka offline z ostatnich godzin liczy się uczciwie;
-- wczesne starty (Skowronek) – tylko potwierdzone przez serwer (jak odznaka „Ranny ptaszek”).
create or replace function public.player_metrics(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  pr public.profiles;
  f record;
  t record;
  v_run int;
  v_streak int;
  v_trip_finds int;
  v_daily int;
  v_weekly int;
  v_challenges int;
  v_seasons int;
  v_lag interval := make_interval(mins => public.anti_cheat_param('trip_early_lag_min')::int);
begin
  select * into pr from public.profiles where id = p_user;
  if not found then return '{}'; end if;

  -- Odebrane znaleziska (także zdjęcia trujących / chronionych) – jedno przejście.
  select
    count(*) filter (where x.rarity = 'legendarny') as legendary,
    count(*) filter (where x.rarity >= 'epicki') as epic,
    count(*) filter (where x.rarity >= 'rzadki') as rare,
    count(*) filter (where x.xxl and x.collected) as xxl,
    count(*) filter (where x.poison) as poison,
    count(*) filter (where pr.home_gmina_id is not null and x.gmina_id <> pr.home_gmina_id) as away,
    count(*) filter (where x.m between 3 and 5) as spring,
    count(*) filter (where x.m between 6 and 8) as summer,
    count(*) filter (where x.m between 9 and 11) as autumn,
    count(*) filter (where x.m in (12, 1, 2)) as winter,
    count(*) filter (where extract(hour from x.lt) = 11 and extract(minute from x.lt) = 11) as at1111,
    count(*) filter (where x.poison and extract(isodow from x.lt) = 5 and extract(day from x.lt) = 13) as f13,
    count(*) filter (where extract(hour from x.lt) >= 22 or extract(hour from x.lt) < 4) as night,
    count(*) filter (where x.m = 12 and extract(day from x.lt) = 24) as xmas,
    count(*) filter (where x.collected and x.species_id = 'borowik-szlachetny' and g.forest_region_id = 'puszcza-knyszynska') as knysz,
    coalesce(jsonb_agg(distinct x.m) filter (where x.m is not null), '[]') as months,
    coalesce(jsonb_agg(distinct x.gmina_id), '[]') as gminy,
    coalesce(jsonb_agg(distinct g.voivodeship) filter (where g.voivodeship is not null), '[]') as voivodeships,
    coalesce(jsonb_agg(distinct r.name) filter (where r.name is not null), '[]') as forests
  into f
  from (
    select fi.id, fi.gmina_id, fi.species_id, fi.rarity, fi.xxl, fi.collected,
           fi.found_at at time zone 'Europe/Warsaw' as lt,
           extract(month from fi.found_at at time zone 'Europe/Warsaw')::int as m,
           sp.edibility in ('trujacy', 'smiertelny') as poison
      from public.finds fi
      join public.species sp on sp.id = fi.species_id
     where fi.user_id = p_user and fi.status = 'claimed'
  ) x
  left join public.gminy g on g.id = x.gmina_id
  left join public.forest_regions r on r.id = g.forest_region_id;

  -- Najdłuższa seria tego samego gatunku z rzędu (kolejność znalezienia).
  select coalesce(max(z.n), 0) into v_run
    from (
      select count(*) as n
        from (
          select y.species_id,
                 row_number() over (order by y.found_at, y.id)
                   - row_number() over (partition by y.species_id order by y.found_at, y.id) as grp
            from public.finds y
           where y.user_id = p_user and y.status = 'claimed'
        ) w
       group by w.species_id, w.grp
    ) z;

  select coalesce(max(z.n), 0) into v_trip_finds
    from (
      select count(*) as n from public.finds y
       where y.user_id = p_user and y.status = 'claimed' and y.trip_id is not null
       group by y.trip_id
    ) z;

  -- Wyprawy: zakończone, rekordy, starty przed 6:00 (potwierdzone przez serwer), dni w lesie.
  select count(*) filter (where tr.status <> 'active') as trips,
         coalesce(max(tr.distance_m) filter (where tr.status <> 'active'), 0) as max_m,
         coalesce(max(tr.duration_s) filter (where tr.status <> 'active'), 0) as max_s,
         count(*) filter (where extract(hour from tr.started_at at time zone 'Europe/Warsaw') < 6
                            and tr.created_at <= tr.started_at + v_lag) as early,
         count(distinct (tr.started_at at time zone 'Europe/Warsaw')::date) as days
    into t
    from public.trips tr
   where tr.user_id = p_user;

  -- Najdłuższa seria dni z wyprawą (dni startu – jak seria w start_trip); co najmniej bieżąca seria z profilu.
  select coalesce(max(c.n), 0) into v_streak
    from (
      select count(*) as n
        from (
          select a.d, a.d - (row_number() over (order by a.d))::int as grp
            from (select distinct (tr.started_at at time zone 'Europe/Warsaw')::date as d
                    from public.trips tr where tr.user_id = p_user) a
        ) b
       group by b.grp
    ) c;

  select count(*) filter (where qt.period = 'daily'), count(*) filter (where qt.period = 'weekly')
    into v_daily, v_weekly
    from public.user_quests uq
    join public.quest_templates qt on qt.id = uq.quest_id
   where uq.user_id = p_user and uq.completed_at is not null;

  select count(*) into v_challenges from public.user_challenges uc where uc.user_id = p_user and uc.completed_at is not null;

  select count(distinct case when m.v::int between 3 and 5 then 1 when m.v::int between 6 and 8 then 2
                             when m.v::int between 9 and 11 then 3 else 4 end)
    into v_seasons
    from jsonb_array_elements_text(f.months) as m(v);

  return jsonb_build_object(
    'borowiki_knyszynska', f.knysz,
    'total_km', pr.total_distance_m / 1000.0,
    'streak_days', pr.streak_days,
    'legendary_finds', f.legendary,
    'xxl_finds', f.xxl,
    'epic_finds', f.epic,
    'rare_finds', f.rare,
    'poison_photos', f.poison,
    'trips', t.trips,
    'max_trip_km', round(t.max_m / 1000.0, 1),
    'max_trip_min', floor(t.max_s / 60.0)::int,
    'early_trips', t.early,
    'max_trip_finds', v_trip_finds,
    'gminy', f.gminy,
    'voivodeships', f.voivodeships,
    'forests', f.forests,
    'away_finds', f.away,
    'months', f.months,
    'seasons', v_seasons,
    'spring_finds', f.spring,
    'summer_finds', f.summer,
    'autumn_finds', f.autumn,
    'winter_finds', f.winter,
    'max_streak', greatest(pr.streak_days, v_streak),
    'active_days', t.days,
    'challenges_done', v_challenges,
    'daily_quests_done', v_daily,
    'weekly_quests_done', v_weekly,
    'same_species_run', v_run,
    'finds_at_1111', f.at1111,
    'friday_13_poison', f.f13,
    'night_finds', f.night,
    'christmas_finds', f.xmas
  ) || jsonb_build_object(
    'reactions_given', (select count(*) from public.post_reactions pr2 join public.posts p on p.id = pr2.post_id
                         where pr2.user_id = p_user and p.author_id <> p_user),
    'reactions_received', (select count(*) from public.post_reactions pr2 join public.posts p on p.id = pr2.post_id
                            where p.author_id = p_user and pr2.user_id <> p_user and p.deleted_at is null),
    'comments', (select count(*) from public.post_comments c where c.author_id = p_user),
    'friends', (select count(*) from public.friendships fr
                 where fr.status = 'accepted' and (fr.user_id = p_user or fr.friend_id = p_user)),
    'published', (select count(*) from public.posts p where p.author_id = p_user and p.kind = 'trip' and p.deleted_at is null)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Wyzwania gmin
-- ─────────────────────────────────────────────────────────────────────────────

-- „Przyjmij wyzwanie” (idempotentne: już przyjęte → nic, także po końcu). Nieznane → P0002 challenge_not_found;
-- nieaktywne / zakończone / nierozpoczęte → P0001 challenge_inactive. Uszczelnienia:
--  · tylko gmina domowa albo obserwowana (gmina_follows) → inaczej P0001 challenge_not_allowed;
--  · najwyżej challenge_active_max (3) przyjętych, nieukończonych, trwających wyzwań przyjętych w ostatnich
--    challenge_active_days (7) dniach (stałe wyzwania bez końca nie blokują miejsca na zawsze) → P0001 challenge_limit.
-- Zaliczenie – claim_find (zweryfikowane znalezisko po przyjęciu, w oknie wyzwania, limit ukończeń na dobę).
create or replace function public.accept_challenge(p_challenge_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  c public.gmina_challenges;
  v_home text;
  v_active int;
  v_max int := public.anti_cheat_param('challenge_active_max')::int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.user_challenges uc where uc.user_id = v_uid and uc.challenge_id = p_challenge_id) then
    return;
  end if;
  select * into c from public.gmina_challenges where id = p_challenge_id;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  if not c.active or c.starts_at > now() or (c.ends_at is not null and c.ends_at <= now()) then
    raise exception 'challenge_inactive' using errcode = 'P0001';
  end if;

  -- Blokada profilu: równoległe przyjęcia tego samego gracza liczą limit po kolei.
  select home_gmina_id into v_home from public.profiles where id = v_uid for update;
  if c.gmina_id is distinct from v_home
     and not exists (select 1 from public.gmina_follows gf where gf.user_id = v_uid and gf.gmina_id = c.gmina_id) then
    raise exception 'challenge_not_allowed' using errcode = 'P0001',
      detail = 'Wyzwanie gminy przyjmiesz w gminie domowej albo w gminie, którą obserwujesz. Obserwuj tę gminę i spróbuj ponownie.';
  end if;

  select count(*) into v_active
    from public.user_challenges uc
    join public.gmina_challenges x on x.id = uc.challenge_id
   where uc.user_id = v_uid and uc.completed_at is null and x.active and x.starts_at <= now()
     and (x.ends_at is null or x.ends_at > now())
     and uc.accepted_at > now() - make_interval(days => public.anti_cheat_param('challenge_active_days')::int);
  if v_active >= v_max then
    raise exception 'challenge_limit' using errcode = 'P0001',
      detail = format('Masz już %s przyjęte, nieukończone wyzwania gmin (najwyżej %s naraz). Ukończ któreś albo poczekaj, aż się skończy.',
                      v_active, v_max);
  end if;

  insert into public.user_challenges (user_id, challenge_id) values (v_uid, c.id) on conflict do nothing;
end $$;

-- Aktualne wyzwanie gminy (jak w 20261009100000_stats.sql); „najczęściej zbierany gatunek” liczony tylko ze
-- zweryfikowanych znalezisk (fałszywe znaleziska nie wybiorą łatwego gatunku).
create or replace function public.ensure_weekly_challenge(p_gmina_id text) returns public.gmina_challenges
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.gmina_challenges;
  sp public.species;
  v_week date := public.ranking_period_start('week');
  v_species_id text;
  v_n bigint := 0;
  v_pool int;
  v_desc text;
begin
  select * into c from public.gmina_challenges x
   where x.gmina_id = p_gmina_id and x.active and x.ends_at is null and x.starts_at <= now()
   order by x.starts_at desc, x.id
   limit 1;
  if found then return c; end if;

  select * into c from public.gmina_challenges x where x.gmina_id = p_gmina_id and x.week_start = v_week;
  if found then return c; end if;

  select f.species_id, count(*) into v_species_id, v_n
    from public.finds f
    join public.species s on s.id = f.species_id
   where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.verified and f.collected and f.visible_from <= now()
     and f.found_at >= public.warsaw_ts(public.ranking_period_start('season'))
     and s.edibility = 'jadalny' and s.active
   group by f.species_id, s.atlas_no
   order by count(*) desc, s.atlas_no
   limit 1;

  if v_species_id is null then
    v_n := 0;
    select count(*) into v_pool from public.species s where s.active and s.edibility = 'jadalny' and s.rarity = 'pospolity';
    if v_pool = 0 then return null; end if;
    select s.id into v_species_id
      from public.species s
     where s.active and s.edibility = 'jadalny' and s.rarity = 'pospolity'
     order by s.atlas_no
    offset abs(hashtext(p_gmina_id || ':' || v_week::text)::bigint) % v_pool
     limit 1;
  end if;
  select * into sp from public.species where id = v_species_id;

  v_desc := case
    when v_n > 0 then format('Najczęściej zbierany gatunek w tej gminie w tym sezonie – już %s %s. Wyzwanie trwa do niedzieli.',
                             v_n, public.pl_plural(v_n, 'okaz', 'okazy', 'okazów'))
    else 'W tym sezonie nikt jeszcze nie pochwalił się tu tym gatunkiem. Wyzwanie trwa do niedzieli.'
  end;

  insert into public.gmina_challenges (gmina_id, species_id, title, description, xp, badge_id, starts_at, ends_at, active, week_start)
  values (p_gmina_id, sp.id, format('Znajdź %s w tym tygodniu', public.species_accusative(sp.id)), v_desc,
          150 + 50 * public.rarity_rank(sp.rarity), null,
          public.warsaw_ts(v_week), public.warsaw_ts(v_week + 7), true, v_week)
  on conflict (gmina_id, week_start) do nothing
  returning * into c;
  if c.id is null then                                     -- równoległe wywołanie utworzyło je pierwsze
    select * into c from public.gmina_challenges x where x.gmina_id = p_gmina_id and x.week_start = v_week;
  end if;
  return c;
end $$;

-- claim_find: jak w 20261013100000_species_content.sql; wyzwania gmin zalicza tylko znalezisko zweryfikowane
-- (finds.verified), znalezione najwcześniej challenge_accept_grace_min przed przyjęciem i w oknie wyzwania
-- [starts_at, ends_at), odebrane najpóźniej challenge_queue_grace_h po końcu (kolejka offline); najwyżej
-- challenge_completions_per_day ukończeń na dobę (czas serwera) – nadmiar czeka na następne znalezisko.
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
  v_done_today bigint;
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
    -- Gatunek chroniony (także chroniony i trujący) – etykieta „chronionego” + bonus za zostawienie w lesie.
    v_lines := v_lines || jsonb_build_object(
      'label', case when sp.protection is not null then 'Zdjęcie gatunku chronionego (½ bazy)' else 'Zdjęcie gatunku trującego (½ bazy)' end,
      'xp', round(v_base / 2.0)::int);
    if sp.protection is not null then
      v_lines := v_lines || jsonb_build_object('label', 'Zostawiony w lesie – gatunek chroniony', 'xp', 30);
    end if;
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

  -- Przyjęte wyzwania gminy na ten gatunek – tylko znalezisko zweryfikowane, po przyjęciu, w oknie wyzwania.
  if f.verified then
    select count(*) into v_done_today
      from public.user_challenges x
     where x.user_id = v_uid and x.completed_at >= public.warsaw_ts(public.local_today());
    for ch in
      select c.id, c.xp, c.badge_id from public.user_challenges uc
        join public.gmina_challenges c on c.id = uc.challenge_id
       where uc.user_id = v_uid and uc.completed_at is null and c.active
         and c.species_id = f.species_id and c.gmina_id = f.gmina_id
         and f.found_at >= uc.accepted_at - make_interval(mins => public.anti_cheat_param('challenge_accept_grace_min')::int)
         and f.found_at >= c.starts_at and (c.ends_at is null or f.found_at < c.ends_at)
         and (c.ends_at is null
              or now() < c.ends_at + make_interval(hours => public.anti_cheat_param('challenge_queue_grace_h')::int))
       order by uc.accepted_at, c.id
    loop
      exit when v_done_today >= public.anti_cheat_param('challenge_completions_per_day');
      update public.user_challenges set completed_at = now(), find_id = f.id
       where user_id = v_uid and challenge_id = ch.id;
      insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
      values (v_uid, 'challenge', ch.id::text, f.gmina_id, ch.xp);
      if ch.badge_id is not null then
        insert into public.user_badges (user_id, badge_id, find_id) values (v_uid, ch.badge_id, f.id) on conflict do nothing;
        v_badges := v_badges || ch.badge_id;
      end if;
      v_challenges := v_challenges || ch.id::text;
      v_done_today := v_done_today + 1;
    end loop;
  end if;

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

-- Przyjęcie wyzwania wyłącznie przez accept_challenge (bezpośredni INSERT omijałby warunki). Rezygnacja (DELETE
-- nieukończonego) – bez zmian.
revoke insert on public.user_challenges from authenticated;
drop policy if exists "wyzwania: przyjecie" on public.user_challenges;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rankingi gmin: tylko źródła rywalizacji i gracze dopuszczeni
-- ─────────────────────────────────────────────────────────────────────────────

-- Wpisy księgi XP, które liczą się do rankingów (wewnętrzna; ta sama reguła dla rankingu gmin i rankingu graczy):
-- źródła 'find' (tylko znalezisko finds.verified – ref_id = id znaleziska), 'challenge', 'contest', 'duel'; bez
-- osiągnięć, zadań, importu i admina; tylko gracze competition_eligible; tylko wpisy z gminą; okres [p_from, p_to).
create or replace function public.ranking_xp_events(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, gmina_id text, amount int, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  with e as (
    select x.user_id, x.gmina_id, x.amount, x.created_at, x.source, x.ref_id
      from public.xp_events x
     where x.gmina_id is not null and x.created_at >= p_from and x.created_at < p_to
       and x.source in ('find', 'challenge', 'contest', 'duel')
  ), players as materialized (
    select d.user_id from (select distinct e.user_id from e) d where public.competition_eligible(d.user_id)
  )
  select e.user_id, e.gmina_id, e.amount, e.created_at
    from e
    join players p on p.user_id = e.user_id
   where e.source <> 'find'
      or exists (
        select 1 from public.finds f
         where f.verified
           and f.id = case when e.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then e.ref_id::uuid end)
$$;

-- Jak w 20261009100000_stats.sql (tydzień bieżący i dwa poprzednie, sezon, rekordy, trend), ale punkty tylko
-- z ranking_xp_events, a rekordy – zweryfikowane okazy epickie / legendarne graczy dopuszczonych do rywalizacji.
create or replace function public.refresh_gmina_rankings() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_week date := public.ranking_period_start('week');
  v_season date := public.ranking_period_start('season');
  v_weeks date[] := array[v_week - 14, v_week - 7, v_week];
  v_cutoff timestamptz := now() - public.privacy_delay();
begin
  perform pg_advisory_xact_lock(hashtext('refresh_gmina_rankings'));

  delete from public.gmina_rankings
   where (period = 'week' and period_start = any(v_weeks))
      or (period in ('season', 'records') and period_start = v_season);

  -- Tygodnie (punkty = XP w gminie; grzybiarze = różni gracze z XP w gminie).
  insert into public.gmina_rankings
    (period, period_start, gmina_id, voivodeship, points, mushroomers, rank, voivodeship_rank, computed_at)
  select 'week', w.d, e.gmina_id, g.voivodeship, sum(e.amount), count(distinct e.user_id),
         rank() over (partition by w.d order by sum(e.amount) desc),
         rank() over (partition by w.d, g.voivodeship order by sum(e.amount) desc),
         now()
    from unnest(v_weeks) w (d)
    join public.ranking_xp_events(public.warsaw_ts(v_weeks[1]), v_cutoff) e
      on e.created_at >= public.warsaw_ts(w.d) and e.created_at < least(public.warsaw_ts(w.d + 7), v_cutoff)
    join public.gminy g on g.id = e.gmina_id
   group by w.d, e.gmina_id, g.voivodeship
  having sum(e.amount) > 0;

  -- Sezon.
  insert into public.gmina_rankings
    (period, period_start, gmina_id, voivodeship, points, mushroomers, rank, voivodeship_rank, computed_at)
  select 'season', v_season, e.gmina_id, g.voivodeship, sum(e.amount), count(distinct e.user_id),
         rank() over (order by sum(e.amount) desc),
         rank() over (partition by g.voivodeship order by sum(e.amount) desc),
         now()
    from public.ranking_xp_events(public.warsaw_ts(v_season), v_cutoff) e
    join public.gminy g on g.id = e.gmina_id
   group by e.gmina_id, g.voivodeship
  having sum(e.amount) > 0;

  -- Rekordy sezonu: zweryfikowane okazy epickie i legendarne; grzybiarze = różni gracze ze zweryfikowanymi
  -- znaleziskami w gminie. Tylko gracze dopuszczeni do rywalizacji – lista liczona raz (materialized): jako
  -- podzapytanie `in (…)` planista w plpgsql wołał competition_eligible dla każdego wiersza finds (1100 znalezisk = 27 s).
  insert into public.gmina_rankings
    (period, period_start, gmina_id, voivodeship, points, mushroomers, rank, voivodeship_rank, computed_at)
  with season_finds as materialized (
    select x.user_id, x.gmina_id, x.rarity
      from public.finds x
     where x.status = 'claimed' and x.verified and x.visible_from <= now() and x.found_at >= public.warsaw_ts(v_season)
  ), eligible as materialized (
    select d.user_id from (select distinct s.user_id from season_finds s) d where public.competition_eligible(d.user_id)
  )
  select 'records', v_season, f.gmina_id, g.voivodeship,
         count(*) filter (where f.rarity in ('epicki', 'legendarny')),
         count(distinct f.user_id),
         rank() over (order by count(*) filter (where f.rarity in ('epicki', 'legendarny')) desc),
         rank() over (partition by g.voivodeship order by count(*) filter (where f.rarity in ('epicki', 'legendarny')) desc),
         now()
    from season_finds f
    join eligible el on el.user_id = f.user_id
    join public.gminy g on g.id = f.gmina_id
   group by f.gmina_id, g.voivodeship
  having count(*) filter (where f.rarity in ('epicki', 'legendarny')) > 0;

  -- Trend tygodnia: miejsca z poprzedniego tygodnia (w kraju i w województwie).
  update public.gmina_rankings r
     set prev_rank = p.rank, voivodeship_prev_rank = p.voivodeship_rank
    from public.gmina_rankings p
   where r.period = 'week' and r.period_start = any(v_weeks)
     and p.period = 'week' and p.period_start = r.period_start - 7 and p.gmina_id = r.gmina_id;

  insert into public.gmina_rankings_refresh (id, computed_at, week_start, season_start)
  values (true, now(), v_week, v_season)
  on conflict (id) do update
    set computed_at = excluded.computed_at, week_start = excluded.week_start, season_start = excluded.season_start;
end $$;

-- Ranking gmin województwa (jak w 20261009100000_stats.sql). userContribution – własne XP z gminą od początku okresu,
-- na żywo, ze źródeł liczonych do rankingu (zweryfikowane znaleziska, wyzwania, walki, pojedynki).
create or replace function public.get_ranking(p_period public.ranking_period, p_voivodeship text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_voiv text;
  v_home text;
  v_start date;
  v_computed timestamptz;
  v_rows jsonb;
  v_heat jsonb;
  v_contrib bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_period is null then
    raise exception 'invalid_period' using errcode = 'P0001', detail = 'Okres rankingu: week | season | records';
  end if;
  v_voiv := public.resolve_voivodeship(p_voivodeship, v_uid);
  select home_gmina_id into v_home from public.profiles where id = v_uid;
  v_computed := public.ensure_rankings_fresh();
  v_start := public.ranking_period_start(p_period);

  select coalesce(jsonb_agg(jsonb_build_object(
           'gminaId', x.gmina_id,
           'name', x.name,
           'kind', x.kind,
           'powiat', x.powiat,
           'forest', x.forest,
           'rank', x.voivodeship_rank,
           'points', x.points,
           'mushroomers', x.mushroomers,
           'trend', case when p_period = 'week' and x.voivodeship_prev_rank is not null
                         then x.voivodeship_prev_rank - x.voivodeship_rank end
         ) order by x.voivodeship_rank, x.points desc, x.name, x.gmina_id), '[]'),
         coalesce(jsonb_object_agg(x.gmina_id, greatest(1, 4 - (5 * (x.voivodeship_rank - 1)) / x.n)), '{}')
    into v_rows, v_heat
    from (
      select r.gmina_id, r.points, r.mushroomers, r.voivodeship_rank, r.voivodeship_prev_rank,
             g.name, g.kind, g.powiat, fr.name as forest, count(*) over () as n
        from public.gmina_rankings r
        join public.gminy g on g.id = r.gmina_id
        left join public.forest_regions fr on fr.id = g.forest_region_id
       where r.period = p_period and r.period_start = v_start and r.voivodeship = v_voiv
    ) x;

  select coalesce(sum(e.amount), 0) into v_contrib
    from public.xp_events e
   where e.user_id = v_uid and e.gmina_id is not null and e.created_at >= public.warsaw_ts(v_start)
     and (e.source in ('challenge', 'contest', 'duel')
          or (e.source = 'find' and exists (
                select 1 from public.finds f
                 where f.user_id = v_uid and f.verified and f.id::text = e.ref_id)));

  return jsonb_build_object(
    'period', p_period,
    'voivodeship', v_voiv,
    'periodStart', to_char(v_start, 'YYYY-MM-DD'),
    'computedAt', public.iso_ts(v_computed),
    'rows', v_rows,
    'heat', v_heat,
    'userContribution', v_contrib,
    'userGminaId', v_home
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Prywatność: bezpośredni odczyt tabel – tylko własne wiersze
-- ─────────────────────────────────────────────────────────────────────────────

-- Blokady w politykach RLS: polityka wykonuje się uprawnieniami wywołującego, więc funkcja musi mieć EXECUTE dla
-- authenticated – dlatego w schemacie private, którego PostgREST nie wystawia (config.toml: api.schemas). Klient nie
-- wywoła jej przez /rpc (wyrocznia „kto mnie zablokował”); public.blocked_with_me – bez EXECUTE dla klientów.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.blocked_with_me(p_other uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.is_blocked_pair((select auth.uid()), p_other)
$$;

-- Profile: cudze dane wyłącznie przez RPC (author_json, social_user_json, get_user… – blokady, deleted_at, listed);
-- wprost z tabeli tylko własny wiersz (last_active_date, total_xp na żywo, gmina domowa, is_bot, deleted_at innych
-- graczy nie wyciekają; nie da się też wyliczyć wszystkich graczy, także ukrytych z wyszukiwarki). UPDATE własnego
-- wiersza (nick, nazwa, imię, gmina domowa, avatar) – bez zmian.
drop policy if exists "profil: odczyt" on public.profiles;
drop policy if exists "profil: odczyt wlasnego" on public.profiles;
create policy "profil: odczyt wlasnego" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- Zdobyte odznaki i osiągnięcia (earned_at / unlocked_at na żywo) – tylko własne.
drop policy if exists "odznaki: odczyt" on public.user_badges;
drop policy if exists "odznaki: wlasne" on public.user_badges;
create policy "odznaki: wlasne" on public.user_badges for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "osiagniecia: odczyt" on public.user_achievements;
drop policy if exists "osiagniecia: wlasne" on public.user_achievements;
create policy "osiagniecia: wlasne" on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));

-- Wpisy: wprost z tabeli tylko własne; cudze – get_feed / get_post (post_visible_to: visible_from, blokady, usunięte).
drop policy if exists "posty: odczyt" on public.posts;
drop policy if exists "posty: odczyt wlasnych" on public.posts;
create policy "posty: odczyt wlasnych" on public.posts for select to authenticated
  using (author_id = (select auth.uid()));

-- Komentarze i reakcje wprost z tabeli: własne oraz pod własnymi wpisami (bez osób zablokowanych w dowolną stronę).
drop policy if exists "komentarze: odczyt" on public.post_comments;
create policy "komentarze: odczyt" on public.post_comments for select to authenticated
  using (author_id = (select auth.uid())
         or (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
             and not private.blocked_with_me(author_id)));
drop policy if exists "reakcje: odczyt" on public.post_reactions;
create policy "reakcje: odczyt" on public.post_reactions for select to authenticated
  using (user_id = (select auth.uid())
         or (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()))
             and not private.blocked_with_me(user_id)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Spam: nazwy, nicki, tytuły, reakcje
-- ─────────────────────────────────────────────────────────────────────────────

-- Tekst jednowierszowy: znaki sterujące → spacja, pojedyncze spacje, bez spacji na brzegach, najwyżej p_max znaków.
create or replace function public.clean_text(p_text text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select btrim(left(btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max))
$$;

-- Nicki zarezerwowane (podszywanie się pod obsługę gry): po usunięciu kropek, podkreślników i cyfr – równy słowu
-- z listy albo zaczynający się od rdzenia z drugiej listy (admin_1, grzybobranie.pl, support.team…).
create or replace function public.reserved_handle(p_handle text) returns boolean
language sql immutable set search_path = '' as $$
  select h in ('admin', 'administrator', 'administracja', 'moderator', 'moderacja', 'mod', 'grzybobranie', 'lesnacopka',
               'support', 'pomoc', 'kontakt', 'system', 'root', 'official', 'oficjalny', 'oficjalne', 'team', 'zespol',
               'staff', 'aknsoftware', 'bot', 'null', 'undefined', 'anonim', 'anonymous')
      or h ~ '^(admin|moderat|grzybobran|lesnacopka|support|official|oficjaln|aknsoftware)'
    from (select regexp_replace(lower(coalesce(p_handle, '')), '[._0-9]', '', 'g') as h) s
$$;

-- Profil (każdy zapis: aplikacja – bezpośredni UPDATE, nowe konto, RPC): nazwa ≤ 40 i imię ≤ 40 znaków po clean_text
-- (puste imię → null), nick zarezerwowany: nowe konto → nick zastępczy grzybiarz_…, zmiana → 23505 handle_reserved
-- (aplikacja: „Ten nick jest już zajęty”). Zmieniają się tylko zmienione pola (stare dane zostają bez zmian).
create or replace function public.profiles_sanitize() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name then
    new.display_name := public.clean_text(new.display_name, 40);
  end if;
  if tg_op = 'INSERT' or new.first_name is distinct from old.first_name then
    new.first_name := nullif(public.clean_text(new.first_name, 40), '');
  end if;
  if (tg_op = 'INSERT' or new.handle is distinct from old.handle) and public.reserved_handle(new.handle::text) then
    if tg_op = 'INSERT' then
      new.handle := 'grzybiarz_' || substr(replace(new.id::text, '-', ''), 1, 8);
    else
      raise exception 'handle_reserved' using errcode = '23505',
        detail = format('Nick „%s” jest zarezerwowany – wybierz inny', new.handle);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_sanitize on public.profiles;
create trigger profiles_sanitize before insert or update of handle, display_name, first_name on public.profiles
  for each row execute function public.profiles_sanitize();

-- „Opublikuj w feedzie” (jak w 20261010100000_storage.sql): tytuł po clean_text ≤ 80 znaków (pusty → „Wyprawa po
-- grzyby”); trasy nie publikujemy wcale (ślad z telefonu nie jest weryfikowany) – route = null, route_precision 'gmina'.
create or replace function public.publish_trip(
  p_trip_id uuid, p_hide_route boolean, p_title text default null, p_cover_path text default null
)
returns public.posts
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
  p public.posts;
  v_best record;
  v_mushrooms int;
  v_species int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if p_cover_path is not null and not public.is_user_image_path(p_cover_path, v_uid) then
    raise exception 'invalid_path' using errcode = 'P0001',
      detail = format('Okładka „%s” musi leżeć w folderze gracza (%s/…) i kończyć się .jpg, .jpeg, .png albo .webp', p_cover_path, v_uid);
  end if;
  if t.status = 'published' then
    select * into p from public.posts where trip_id = t.id;
    if found and p_cover_path is not null and p.payload ->> 'cover_path' is null then
      update public.posts set payload = payload || jsonb_build_object('cover_path', p_cover_path)
       where id = p.id
       returning * into p;
    end if;
    return p;
  end if;
  if t.status <> 'finished' then raise exception 'trip_not_finished' using errcode = 'P0001'; end if;

  select count(*) filter (where collected), count(distinct species_id) filter (where collected)
    into v_mushrooms, v_species
    from public.finds where trip_id = t.id and status = 'claimed';
  select f.rarity, s.name, f.weight_g, f.cap_cm into v_best
    from public.finds f join public.species s on s.id = f.species_id
   where f.trip_id = t.id and f.status = 'claimed'
   order by public.rarity_rank(f.rarity) desc, f.xp desc
   limit 1;

  insert into public.posts (author_id, kind, trip_id, gmina_id, route_precision, payload, visible_from)
  values (
    v_uid, 'trip', t.id, t.gmina_id, 'gmina',
    jsonb_build_object(
      'title', coalesce(nullif(public.clean_text(p_title, 80), ''), 'Wyprawa po grzyby'),
      'distance_km', round(t.distance_m / 1000.0, 1),
      'duration_min', coalesce(t.duration_s, 0) / 60,
      'mushrooms', v_mushrooms,
      'species', v_species,
      'xp', t.xp,
      'highlight', case when v_best is null then null else jsonb_build_object(
        'rarity', v_best.rarity, 'species', v_best.name, 'weight_g', v_best.weight_g, 'cap_cm', v_best.cap_cm) end,
      'route', null,
      'cover_path', p_cover_path
    ),
    now() + public.privacy_delay()
  )
  returning * into p;
  update public.trips set status = 'published', hide_route = coalesce(p_hide_route, false) where id = t.id;
  return p;
end $$;

-- Dziennik zdarzeń do limitów tempa akcji, które da się cofnąć (reakcja: włącz → wyłącz → włącz – wiersze
-- post_reactions znikają, więc nie nadają się do licznika). Tylko serwer; wiersze starsze niż doba są czyszczone.
create table if not exists public.rate_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,39}$'),
  created_at timestamptz not null default now()
);
create index if not exists rate_events_user_idx on public.rate_events (user_id, action, created_at);
alter table public.rate_events enable row level security;
-- Brak polityk: klient nie czyta ani nie zapisuje.

-- „Darz grzyb!”: > 60 włączeń w 10 min albo > 600 na dobę → rate_limited (jak komentarze – wyzwalacz, liczy tylko
-- reakcje wywołującego we własnym imieniu; boty deweloperskie bez limitu). Każde włączenie woła sync_achievements
-- dającego i odbiorcy – limit chroni bazę i powiadomienia autora.
create or replace function public.post_reactions_rate_limit() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_10 bigint;
  v_oldest timestamptz;
  v_day bigint;
begin
  if new.user_id is distinct from auth.uid() then return new; end if;
  perform pg_advisory_xact_lock(hashtext('anti_cheat:toggle_reaction:' || new.user_id::text));
  delete from public.rate_events
   where user_id = new.user_id and action = 'reaction'
     and created_at < least(public.warsaw_ts(public.local_today()), now() - interval '10 minutes');
  select count(*) filter (where e.created_at > now() - interval '10 minutes'),
         min(e.created_at) filter (where e.created_at > now() - interval '10 minutes'),
         count(*) filter (where e.created_at >= public.warsaw_ts(public.local_today()))
    into v_10, v_oldest, v_day
    from public.rate_events e
   where e.user_id = new.user_id and e.action = 'reaction';
  perform public.check_rate_limit(
    new.user_id, 'toggle_reaction', v_10, public.anti_cheat_param('reaction_per_10min')::int, '10 min',
    format('Za dużo „Darz grzyb!”: najwyżej %s w ciągu 10 minut. Odczekaj chwilę.', public.anti_cheat_param('reaction_per_10min')),
    v_oldest + interval '10 minutes');
  perform public.check_rate_limit(
    new.user_id, 'toggle_reaction_day', v_day, public.anti_cheat_param('reaction_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit „Darz grzyb!” (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('reaction_per_day')),
    public.warsaw_ts(public.local_today() + 1));
  insert into public.rate_events (user_id, action) values (new.user_id, 'reaction');
  return new;
end $$;
drop trigger if exists post_reactions_rate_limit on public.post_reactions;
create trigger post_reactions_rate_limit before insert on public.post_reactions
  for each row execute function public.post_reactions_rate_limit();

-- Reakcje tylko przez toggle_reaction (widoczność wpisu, blokady, limit); bezpośredni zapis odebrany.
revoke insert, delete on public.post_reactions from authenticated;
drop policy if exists "reakcje: dodanie" on public.post_reactions;
drop policy if exists "reakcje: cofniecie" on public.post_reactions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Porządki
-- ─────────────────────────────────────────────────────────────────────────────

-- Statystyki z etapu 1 – zastąpione przez get_gmina_stats / get_species_percentile (etap 4); aplikacja ich nie woła.
drop function if exists public.species_percentile(text, text, int);
drop function if exists public.gmina_stats(text);
drop function if exists public.gmina_records(text, int);
drop function if exists public.gmina_species_share(text, int);

-- Skany i rozpoznania zapisuje wyłącznie serwer (submit_find / Edge Function identify); klient tylko czyta własne.
revoke insert, update on public.scans from authenticated;
drop policy if exists "skany: nowy" on public.scans;
drop policy if exists "skany: zdjecia" on public.scans;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Status w rywalizacji
-- ─────────────────────────────────────────────────────────────────────────────

-- Incydenty wagi 3 (wiersze flag – ta sama flaga w ciągu 24 h to jeden incydent, niezależnie od hits; bez samego
-- limitu 'rate_limited') w oknie competition_flag_window_d dni i po ostatniej decyzji moderatora ('ok' w
-- player_standing – stare flagi przestają się liczyć). Wewnętrzna.
create or replace function public.competition_flag_incidents(p_user uuid) returns int
language sql stable security definer set search_path = public, extensions as $$
  select count(*)::int
    from public.anti_cheat_flags f
   where f.user_id = p_user and f.severity >= 3 and f.kind <> 'rate_limited'
     and f.last_at > now() - make_interval(days => public.anti_cheat_param('competition_flag_window_d')::int)
     and f.last_at > coalesce((select s.updated_at from public.player_standing s
                                where s.user_id = p_user and s.status = 'ok'), '-infinity'::timestamptz)
$$;

-- Doprecyzowanie (ta sama sygnatura co w 20261015090000_rywalizacja_podstawy.sql): profil istnieje i nie jest
-- usuwany, brak aktywnego statusu review / banned, mniej niż competition_flag_hits incydentów wagi 3.
-- Boty deweloperskie – tak (dane testowe rankingów).
create or replace function public.competition_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user is not null
     and exists (select 1 from public.profiles p where p.id = p_user and p.deleted_at is null)
     and not exists (
       select 1 from public.player_standing s
        where s.user_id = p_user and s.status <> 'ok' and (s.until is null or s.until > now()))
     and public.competition_flag_incidents(p_user) < public.anti_cheat_param('competition_flag_hits')
$$;

-- Zapis flagi (jak w 20261012100000_anticheat.sql) + status w rywalizacji: flaga wagi 3 (poza 'rate_limited'), po
-- której gracz ma ≥ competition_flag_hits incydentów → player_standing 'review' do now() + okno flag (updated_by
-- 'auto:<rodzaj>'; kolejne incydenty przedłużają). Decyzji moderatora (review / banned ustawione ręcznie) nie
-- nadpisuje; po jego 'ok' liczą się tylko nowe incydenty.
create or replace function public.flag(p_user uuid, p_kind text, p_severity int, p_ref text default null, p_details jsonb default '{}')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id bigint;
  v_incidents int;
  v_until timestamptz;
  s public.player_standing;
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

  if p_severity < 3 or p_kind = 'rate_limited' then return; end if;
  v_incidents := public.competition_flag_incidents(p_user);
  if v_incidents < public.anti_cheat_param('competition_flag_hits') then return; end if;
  select * into s from public.player_standing where user_id = p_user for update;
  if found and s.status <> 'ok' and (s.until is null or s.until > now())
     and coalesce(s.updated_by, '') not like 'auto:%' then
    return;                                              -- decyzja moderatora
  end if;
  v_until := now() + make_interval(days => public.anti_cheat_param('competition_flag_window_d')::int);
  insert into public.player_standing as ps (user_id, status, reason, until, updated_at, updated_by)
  values (p_user, 'review',
          left(format('Automatycznie: %s incydenty wagi 3 w %s dni (ostatni: %s)', v_incidents,
                      public.anti_cheat_param('competition_flag_window_d'), p_kind), 300),
          v_until, now(), 'auto:' || p_kind)
  on conflict (user_id) do update
    set status = 'review', reason = excluded.reason, until = excluded.until, updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.rate_events from anon, authenticated;

revoke all on function
  private.blocked_with_me(uuid),
  public.blocked_with_me(uuid),
  public.ranking_xp_events(timestamptz, timestamptz),
  public.clean_text(text, int),
  public.reserved_handle(text),
  public.profiles_sanitize(),
  public.post_reactions_rate_limit(),
  public.competition_flag_incidents(uuid)
  from public, anon, authenticated;

-- Polityki RLS komentarzy i reakcji wołają private.blocked_with_me uprawnieniami gracza.
grant execute on function private.blocked_with_me(uuid) to authenticated;

-- Funkcje zmienione przez create or replace (start_trip, credit_trip_distance, close_trip, finish_trip,
-- evaluate_badges, trips_progress, player_metrics, accept_challenge, ensure_weekly_challenge, claim_find,
-- refresh_gmina_rankings, get_ranking, publish_trip, competition_eligible, flag, dev_seed_activity) zachowują
-- dotychczasowe uprawnienia (dev_seed_activity – odebrane pętlą wyżej).
