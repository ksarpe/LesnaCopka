-- =============================================================================
-- Progresja na lata: diamenty, ok. 65 osiągnięć z nowymi metrykami, zadania rotacyjne (dzienne + tygodniowe)
-- Lustro src/utils/achievements.ts, src/utils/counters.ts i src/utils/quests.ts (aplikacja = źródło słownika:
-- scripts/gen-seed.ts → seed.sql; tu tylko schemat i logika).
--
--  · Stopnie 1–5: brąz → srebro → złoto → platyna → DIAMENT (medal 'diament').
--  · Nowe kategorie: wyprawy, odkrywca, sezony (pory roku), seria, spolecznosc, wyzwania.
--  · Nowe metryki: każda to wartość enumu `achievement_metric` = klucz w player_metrics(user) (snake_case, jak
--    counterSqlKey w aplikacji). player_metrics liczy wszystko RAZ (kilka zapytań po danych jednego gracza), a
--    sync_achievements / seed_achievements / achievement_progress czytają z niego – tanio także w wyzwalaczach.
--  · get_game_state(): + `counters` (= player_metrics – aplikacja przyjmuje je zamiast liczyć z okna 30 wypraw),
--    `quests.daily` (wylosowane id), `quests.week`, `quests.weekly` (postęp tygodniowych); `quests.progress` –
--    tylko wylosowane zadania dnia. Pozostałe klucze bez zmian.
--  · Zadania: quest_templates + period ('daily'|'weekly'), difficulty (1–3), params (gatunek, miesiące, minuty,
--    godzina). quests_for(user, day) – 3 dzienne (co najmniej jedno łatwe) i 3 tygodniowe (od poniedziałku),
--    bez powtórzeń rodzaju, deterministycznie z hasha (id gracza | dzień) – identycznie jak selectQuests w aplikacji.
--    bump_quest liczy tylko wylosowane zadania (dzień zadania tygodniowego = poniedziałek). Tryb makiety
--    (set_config('app.quests_design','on') przy dev_tools) – stałe 3 zadania dnia z makiety, bez tygodniowych.
--  · Gdzie liczy się postęp i synchronizują osiągnięcia (bez przepisywania claim_find / finish_trip / publish_trip):
--      claim_find (bez zmian)      skany i rzadkie (pętla w claim_find), sync_achievements na końcu;
--      finds  (status → claimed)   pozostałe rodzaje zadań ze znaleziska (epickie, gatunek, nowy w atlasie, trujące,
--                                  poza domem, XXL, jadalne, różne gatunki) – wyzwalacz przed aktualizacją atlasu;
--      trips  (insert)             „Wyrusz przed 7:00”; start przed 6:00 → sync (Skowronek);
--      trips  (active → koniec)    „Zakończ N wypraw”, „Ponad godzinę w lesie” + sync (finish_trip, auto-zamknięcie);
--      posts  (insert, wyprawa)    „Opublikuj wyprawę” + sync autora (publish_trip);
--      post_reactions (insert)     „Daj Darz grzyb!” (różne cudze wpisy w okresie – cofanie nie nabija) + sync
--                                  dającego i ODBIORCY (toggle_reaction i bezpośredni INSERT);
--      post_comments (insert)      sync autora komentarza (add_comment);
--      friendships (→ accepted)    sync obu stron (respond_friend_request / send_friend_request przy akceptacji).
--    Boty deweloperskie (profiles.is_bot) są pomijane – generatory nie liczą im osiągnięć.
--  · seed_achievements(user) – osiągnięte już stopnie (także nowych osiągnięć) jako nagrodzone BEZ XP; seed woła ją
--    dla wszystkich profili, więc wdrożenie nie zasypie istniejących graczy XP.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Typy
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.achievement_medal add value if not exists 'diament';

alter type public.achievement_category add value if not exists 'wyprawy';
alter type public.achievement_category add value if not exists 'odkrywca';
alter type public.achievement_category add value if not exists 'sezony';
alter type public.achievement_category add value if not exists 'seria';
alter type public.achievement_category add value if not exists 'spolecznosc';
alter type public.achievement_category add value if not exists 'wyzwania';

-- Metryki z player_metrics() (klucz = wartość enumu). 'xxl_finds' był już wcześniej.
alter type public.achievement_metric add value if not exists 'borowiki_knyszynska';
alter type public.achievement_metric add value if not exists 'total_km';
alter type public.achievement_metric add value if not exists 'streak_days';
alter type public.achievement_metric add value if not exists 'legendary_finds';
alter type public.achievement_metric add value if not exists 'epic_finds';
alter type public.achievement_metric add value if not exists 'rare_finds';
alter type public.achievement_metric add value if not exists 'poison_photos';
alter type public.achievement_metric add value if not exists 'trips';
alter type public.achievement_metric add value if not exists 'max_trip_km';
alter type public.achievement_metric add value if not exists 'max_trip_min';
alter type public.achievement_metric add value if not exists 'early_trips';
alter type public.achievement_metric add value if not exists 'max_trip_finds';
alter type public.achievement_metric add value if not exists 'gminy';
alter type public.achievement_metric add value if not exists 'voivodeships';
alter type public.achievement_metric add value if not exists 'forests';
alter type public.achievement_metric add value if not exists 'away_finds';
alter type public.achievement_metric add value if not exists 'months';
alter type public.achievement_metric add value if not exists 'seasons';
alter type public.achievement_metric add value if not exists 'spring_finds';
alter type public.achievement_metric add value if not exists 'summer_finds';
alter type public.achievement_metric add value if not exists 'autumn_finds';
alter type public.achievement_metric add value if not exists 'winter_finds';
alter type public.achievement_metric add value if not exists 'max_streak';
alter type public.achievement_metric add value if not exists 'active_days';
alter type public.achievement_metric add value if not exists 'reactions_given';
alter type public.achievement_metric add value if not exists 'reactions_received';
alter type public.achievement_metric add value if not exists 'comments';
alter type public.achievement_metric add value if not exists 'friends';
alter type public.achievement_metric add value if not exists 'published';
alter type public.achievement_metric add value if not exists 'challenges_done';
alter type public.achievement_metric add value if not exists 'daily_quests_done';
alter type public.achievement_metric add value if not exists 'weekly_quests_done';
alter type public.achievement_metric add value if not exists 'same_species_run';
alter type public.achievement_metric add value if not exists 'finds_at_1111';
alter type public.achievement_metric add value if not exists 'friday_13_poison';
alter type public.achievement_metric add value if not exists 'night_finds';
alter type public.achievement_metric add value if not exists 'christmas_finds';

-- Rodzaje zadań (aplikacja: camelCase – questKindToSql).
alter type public.quest_kind add value if not exists 'epic';
alter type public.quest_kind add value if not exists 'species';
alter type public.quest_kind add value if not exists 'trip_minutes';
alter type public.quest_kind add value if not exists 'new_species';
alter type public.quest_kind add value if not exists 'poison_photo';
alter type public.quest_kind add value if not exists 'away_gmina';
alter type public.quest_kind add value if not exists 'xxl';
alter type public.quest_kind add value if not exists 'edible';
alter type public.quest_kind add value if not exists 'variety';
alter type public.quest_kind add value if not exists 'publish';
alter type public.quest_kind add value if not exists 'reactions';
alter type public.quest_kind add value if not exists 'early_start';
alter type public.quest_kind add value if not exists 'trips';

do $$ begin
  create type public.quest_period as enum ('daily', 'weekly');
exception when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

-- 5 stopni (diament).
alter table public.achievement_tiers drop constraint if exists achievement_tiers_tier_check;
alter table public.achievement_tiers add constraint achievement_tiers_tier_check check (tier between 1 and 5);
alter table public.user_achievements drop constraint if exists user_achievements_tier_check;
alter table public.user_achievements add constraint user_achievements_tier_check check (tier between 1 and 5);

-- Pula zadań: okres, trudność (losowanie dzienne: co najmniej jedno łatwe), parametry rodzaju.
alter table public.quest_templates add column if not exists period public.quest_period not null default 'daily';
alter table public.quest_templates add column if not exists difficulty smallint not null default 1;
alter table public.quest_templates add column if not exists params jsonb not null default '{}';
alter table public.quest_templates drop constraint if exists quest_templates_difficulty_check;
alter table public.quest_templates add constraint quest_templates_difficulty_check check (difficulty between 1 and 3);
-- Zadania z makiety (przed seedem): trudność jak w aplikacji.
update public.quest_templates set difficulty = 2 where id in ('q-rare-1', 'q-km-5') and difficulty = 1;

-- Licznik „Darz grzyb!” danych przez gracza (player_metrics, zadanie reakcji).
create index if not exists post_reactions_user_idx on public.post_reactions (user_id, created_at);
create index if not exists user_quests_completed_idx on public.user_quests (user_id) where completed_at is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Losowanie zadań (lustro src/utils/quests.ts – te same liczby, ta sama kolejność puli)
-- ─────────────────────────────────────────────────────────────────────────────

-- h = (h · 31 + kod znaku) mod (2^31 − 1), start 7. Tylko ASCII (uuid, daty).
create or replace function public.quest_hash(p text) returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  h bigint := 7;
  i int;
begin
  for i in 1 .. coalesce(length(p), 0) loop
    h := (h * 31 + ascii(substr(p, i, 1))) % 2147483647;
  end loop;
  return h;
end $$;

-- Poniedziałek tygodnia daty.
create or replace function public.week_start(d date) returns date
language sql immutable set search_path = '' as $$
  select d - (extract(isodow from d)::int - 1)
$$;

-- Tryb makiety (testy, scenariusze): set_config('app.quests_design', 'on', …) – tylko przy dev_tools (lokalnie).
create or replace function public.quests_design_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('app.quests_design', true), '') = 'on' and public.dev_tools_enabled()
$$;

-- Zadanie może wypaść w miesiącu (params.months – sezon gatunku; brak = cały rok).
create or replace function public.quest_in_season(p_params jsonb, p_month int) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when coalesce(jsonb_typeof(p_params -> 'months'), '') <> 'array' then true
    when jsonb_array_length(p_params -> 'months') = 0 then true
    else exists (select 1 from jsonb_array_elements_text(p_params -> 'months') as m(v) where m.v::int = p_month)
  end
$$;

-- pickQuests: najpierw (gdy p_require_easy) jedno łatwe, potem kolejne rodzaje jeszcze niewybrane.
-- Generator Parka–Millera: x · 48271 mod (2^31 − 1); indeks = x mod liczba kandydatów (tablice od 1).
create or replace function public.pick_quests(
  p_ids text[], p_kinds text[], p_easy boolean[], p_seed text, p_count int, p_require_easy boolean
)
returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  n int := coalesce(array_length(p_ids, 1), 0);
  s bigint := public.quest_hash(p_seed) % 2147483646 + 1;
  picked text[] := '{}';
  used text[] := '{}';
  cands int[];
  idx int;
begin
  if p_require_easy then
    cands := array(select g from generate_series(1, n) g where p_easy[g] order by g);
    if coalesce(array_length(cands, 1), 0) > 0 then
      s := (s * 48271) % 2147483647;
      idx := cands[(s % array_length(cands, 1))::int + 1];
      picked := picked || p_ids[idx];
      used := used || p_kinds[idx];
    end if;
  end if;
  while coalesce(array_length(picked, 1), 0) < p_count loop
    cands := array(
      select g from generate_series(1, n) g
       where not (p_kinds[g] = any (used)) and not (p_ids[g] = any (picked))
       order by g
    );
    exit when coalesce(array_length(cands, 1), 0) = 0;
    s := (s * 48271) % 2147483647;
    idx := cands[(s % array_length(cands, 1))::int + 1];
    picked := picked || p_ids[idx];
    used := used || p_kinds[idx];
  end loop;
  return picked;
end $$;

-- Zadania gracza na dzień (dzienne) i jego tydzień (tygodniowe); slot = kolejność z losowania.
create or replace function public.quests_for(p_user uuid, p_day date default null)
returns table (quest_id text, period public.quest_period, slot int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_day date := coalesce(p_day, public.local_today());
  v_month int := extract(month from v_day)::int;
  v_week date := public.week_start(v_day);
  v_ids text[];
  v_kinds text[];
  v_easy boolean[];
  v_pick text[];
  i int;
begin
  if p_user is null then return; end if;
  if public.quests_design_mode() then
    return query
      select t.id, t.period, array_position(array['q-scan-5', 'q-rare-1', 'q-km-5'], t.id)::int
        from public.quest_templates t
       where t.active and t.id = any (array['q-scan-5', 'q-rare-1', 'q-km-5'])
       order by 3;
    return;
  end if;

  select coalesce(array_agg(t.id order by t.sort, t.id), '{}'),
         coalesce(array_agg(t.kind::text order by t.sort, t.id), '{}'),
         coalesce(array_agg(t.difficulty = 1 order by t.sort, t.id), '{}')
    into v_ids, v_kinds, v_easy
    from public.quest_templates t
   where t.active and t.period = 'daily' and public.quest_in_season(t.params, v_month);
  v_pick := public.pick_quests(v_ids, v_kinds, v_easy, p_user::text || '|' || to_char(v_day, 'YYYY-MM-DD') || '|d', 3, true);
  for i in 1 .. coalesce(array_length(v_pick, 1), 0) loop
    quest_id := v_pick[i];
    period := 'daily';
    slot := i;
    return next;
  end loop;

  select coalesce(array_agg(t.id order by t.sort, t.id), '{}'),
         coalesce(array_agg(t.kind::text order by t.sort, t.id), '{}'),
         coalesce(array_agg(t.difficulty = 1 order by t.sort, t.id), '{}')
    into v_ids, v_kinds, v_easy
    from public.quest_templates t
   where t.active and t.period = 'weekly' and public.quest_in_season(t.params, v_month);
  v_pick := public.pick_quests(v_ids, v_kinds, v_easy, p_user::text || '|' || to_char(v_week, 'YYYY-MM-DD') || '|w', 3, false);
  for i in 1 .. coalesce(array_length(v_pick, 1), 0) loop
    quest_id := v_pick[i];
    period := 'weekly';
    slot := i;
    return next;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Postęp zadań
-- ─────────────────────────────────────────────────────────────────────────────

-- Wewnętrzna: postęp wylosowanego zadania (bez sprawdzania losowania). Dzień zadania tygodniowego = poniedziałek.
-- Ukończenie → XP do księgi (źródło 'quest'). Zwraca true, gdy właśnie ukończono.
create or replace function public.bump_selected_quest(p_user uuid, q public.quest_templates, p_delta numeric, p_gmina_id text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  uq public.user_quests;
  v_day date := case when q.period = 'weekly' then public.week_start(public.local_today()) else public.local_today() end;
begin
  if p_delta is null or p_delta <= 0 or q.id is null then return false; end if;
  insert into public.user_quests as t (user_id, quest_id, day, progress)
  values (p_user, q.id, v_day, least(p_delta, q.target))
  on conflict (user_id, quest_id, day)
    do update set progress = least(t.progress + p_delta, q.target)
    where t.completed_at is null
  returning * into uq;
  if uq is null or uq.completed_at is not null or uq.progress < q.target then
    return false;
  end if;
  update public.user_quests set completed_at = now()
   where user_id = p_user and quest_id = q.id and day = v_day;
  insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
  values (p_user, 'quest', q.id, p_gmina_id, q.xp);
  return true;
end $$;

-- Jak w 20261005120000_init.sql, ale tylko dla zadań wylosowanych graczowi (quests_for) i z dniem okresu
-- (claim_find: skany i rzadkie; credit_trip_distance: dystans – dzienny i tygodniowy).
create or replace function public.bump_quest(p_user uuid, p_quest_id text, p_delta numeric, p_gmina_id text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
begin
  select * into q from public.quest_templates where id = p_quest_id and active;
  if not found then return false; end if;
  if not exists (select 1 from public.quests_for(p_user, public.local_today()) s where s.quest_id = p_quest_id) then
    return false;
  end if;
  return public.bump_selected_quest(p_user, q, p_delta, p_gmina_id);
end $$;

-- Wylosowane dziś / w tym tygodniu szablony danego rodzaju (tekst – enum quest_kind z tej migracji).
create or replace function public.selected_quests(p_user uuid, p_kinds text[])
returns setof public.quest_templates
language sql stable security definer set search_path = public as $$
  select t.*
    from public.quests_for(p_user, public.local_today()) s
    join public.quest_templates t on t.id = s.quest_id
   where t.kind::text = any (p_kinds)
   order by s.period, s.slot
$$;

create or replace function public.is_bot_player(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_bot from public.profiles p where p.id = p_user), false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Metryki gracza (lustro src/utils/counters.ts; czas lokalny = Europe/Warsaw)
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Wyprawy: zakończone, rekordy, starty przed 6:00, dni w lesie.
  select count(*) filter (where tr.status <> 'active') as trips,
         coalesce(max(tr.distance_m) filter (where tr.status <> 'active'), 0) as max_m,
         coalesce(max(tr.duration_s) filter (where tr.status <> 'active'), 0) as max_s,
         count(*) filter (where extract(hour from tr.started_at at time zone 'Europe/Warsaw') < 6) as early,
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
-- Osiągnięcia: wartości z player_metrics (raz na synchronizację)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wartość metryki: atlas (jak dotąd, + niejadalne) albo licznik z p_metrics (lista → długość).
create or replace function public.achievement_value(p_user uuid, a public.achievements, p_metrics jsonb) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  r numeric;
begin
  case a.metric::text
    when 'species' then
      select count(*) into r
        from public.user_species us join public.species s on s.id = us.species_id
       where us.user_id = p_user
         and (a.params ->> 'rarity' is null or s.rarity::text = a.params ->> 'rarity')
         and case a.params ->> 'edibility'
               when 'jadalne' then s.edibility = 'jadalny'
               when 'niejadalne' then s.edibility = 'niejadalny'
               when 'trujace' then s.edibility in ('trujacy', 'smiertelny')
               when 'smiertelne' then s.edibility = 'smiertelny'
               else true
             end;
    when 'set' then
      select count(*) into r
        from public.achievement_set_species m
        join public.user_species us on us.species_id = m.species_id and us.user_id = p_user
       where m.achievement_id = a.id;
    when 'specimens' then
      select sum(us.count) into r from public.user_species us where us.user_id = p_user;
    when 'max_of_species' then
      select max(us.count) into r from public.user_species us where us.user_id = p_user;
    when 'species_with_count' then
      select count(*) into r from public.user_species us
       where us.user_id = p_user and us.count >= (a.params ->> 'min')::int;
    when 'lookalike_pairs' then
      select count(distinct least(l.species_id, l.lookalike_id) || '|' || greatest(l.species_id, l.lookalike_id)) into r
        from public.species_lookalikes l
        join public.user_species a1 on a1.user_id = p_user and a1.species_id = l.species_id
        join public.user_species a2 on a2.user_id = p_user and a2.species_id = l.lookalike_id
       where l.lookalike_id is not null and l.lookalike_id <> l.species_id;
    when 'record' then
      select case a.params ->> 'field' when 'best_cap_cm' then us.best_cap_cm when 'best_weight_g' then us.best_weight_g end
        into r
        from public.user_species us
       where us.user_id = p_user and us.species_id = a.params ->> 'species';
    else
      v := coalesce(p_metrics, '{}') -> a.metric::text;
      r := case jsonb_typeof(v) when 'array' then jsonb_array_length(v) when 'number' then v::text::numeric else 0 end;
  end case;
  return coalesce(r, 0);
end $$;

-- Dotychczasowa sygnatura (pojedyncze osiągnięcie) – liczy metryki gracza sama.
create or replace function public.achievement_value(p_user uuid, a public.achievements) returns numeric
language sql stable security definer set search_path = public as $$
  select public.achievement_value(p_user, a, public.player_metrics(p_user))
$$;

-- Jak w 20261006100000_achievements.sql; metryki liczone raz dla wszystkich osiągnięć.
create or replace function public.sync_achievements(p_user uuid, p_find_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.achievements;
  t public.achievement_tiers;
  v_metrics jsonb;
  v_value numeric;
  v_have int;
  v_reached int;
  v_gmina text;
  v_out jsonb := '[]';
begin
  if p_user is null then return v_out; end if;
  v_metrics := public.player_metrics(p_user);
  if p_find_id is not null then
    select gmina_id into v_gmina from public.finds where id = p_find_id;
  end if;
  for a in select * from public.achievements where active order by sort loop
    v_value := public.achievement_value(p_user, a, v_metrics);
    select ua.tier into v_have from public.user_achievements ua where ua.user_id = p_user and ua.achievement_id = a.id;
    v_have := coalesce(v_have, 0);
    v_reached := null;
    for t in
      select * from public.achievement_tiers x
       where x.achievement_id = a.id and x.tier > v_have and x.target <= v_value
       order by x.tier
    loop
      insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
      values (p_user, 'achievement', a.id || ':' || t.tier, v_gmina, t.xp);
      v_out := v_out || jsonb_build_object('id', a.id, 'tier', t.tier, 'xp', t.xp);
      v_reached := t.tier;
    end loop;
    if v_reached is not null then
      insert into public.user_achievements (user_id, achievement_id, tier, unlocked_at, find_id)
      values (p_user, a.id, v_reached, now(), p_find_id)
      on conflict (user_id, achievement_id) do update
        set tier = excluded.tier, unlocked_at = excluded.unlocked_at, find_id = excluded.find_id;
    end if;
  end loop;
  return v_out;
end $$;

-- Jak dotąd: osiągnięte stopnie jako nagrodzone BEZ XP – także nowych osiągnięć i nowych stopni (platyna, diament).
create or replace function public.seed_achievements(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_metrics jsonb := public.player_metrics(p_user);
begin
  insert into public.user_achievements (user_id, achievement_id, tier)
  select p_user, a.id, r.tier
    from public.achievements a
    cross join lateral (select public.achievement_reached_tier(a.id, public.achievement_value(p_user, a, v_metrics)) as tier) r
   where a.active and r.tier > 0
  on conflict (user_id, achievement_id) do update set tier = greatest(public.user_achievements.tier, excluded.tier);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.achievement_progress()
returns table (achievement_id text, value numeric, tier int, awarded_tier int, next_target numeric, next_xp int)
language sql stable security definer set search_path = public as $$
  with m as (select public.player_metrics((select auth.uid())) as metrics)
  select a.id,
         v.value,
         public.achievement_reached_tier(a.id, v.value),
         coalesce(ua.tier, 0)::int,
         n.target,
         n.xp
    from public.achievements a
    cross join m
    cross join lateral (select public.achievement_value((select auth.uid()), a, m.metrics) as value) v
    left join public.user_achievements ua on ua.user_id = (select auth.uid()) and ua.achievement_id = a.id
    left join lateral (
      select t.target, t.xp from public.achievement_tiers t
       where t.achievement_id = a.id and t.target > v.value
       order by t.tier limit 1
    ) n on true
   where a.active and (select auth.uid()) is not null
   order by a.sort
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyzwalacze postępu (zadania + synchronizacja osiągnięć)
-- ─────────────────────────────────────────────────────────────────────────────

-- Odbiór znaleziska (claim_find: pending → claimed, PRZED aktualizacją atlasu): rodzaje zadań spoza claim_find.
create or replace function public.finds_quest_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
  sp public.species;
  v_home text;
  v_today date := public.local_today();
  v_hit boolean;
begin
  if public.is_bot_player(new.user_id) then return null; end if;
  select * into sp from public.species where id = new.species_id;
  select home_gmina_id into v_home from public.profiles where id = new.user_id;
  for q in
    select * from public.selected_quests(new.user_id,
      array['epic', 'species', 'new_species', 'poison_photo', 'away_gmina', 'xxl', 'edible', 'variety'])
  loop
    v_hit := case q.kind::text
      when 'epic' then new.rarity >= 'epicki'
      when 'species' then new.species_id = q.params ->> 'speciesId'
      when 'new_species' then not exists (
        select 1 from public.user_species us where us.user_id = new.user_id and us.species_id = new.species_id)
      when 'poison_photo' then sp.edibility in ('trujacy', 'smiertelny')
      when 'away_gmina' then v_home is not null and new.gmina_id <> v_home
      when 'xxl' then new.xxl and new.collected
      when 'edible' then new.collected and sp.edibility = 'jadalny'
      when 'variety' then not exists (
        select 1 from public.finds x
         where x.user_id = new.user_id and x.status = 'claimed' and x.species_id = new.species_id and x.id <> new.id
           and x.claimed_at >= public.warsaw_ts(case when q.period = 'weekly' then public.week_start(v_today) else v_today end))
      else false
    end;
    if coalesce(v_hit, false) then perform public.bump_selected_quest(new.user_id, q, 1, new.gmina_id); end if;
  end loop;
  return null;
end $$;
drop trigger if exists finds_quest_progress on public.finds;
create trigger finds_quest_progress after update of status on public.finds
  for each row when (new.status = 'claimed' and old.status is distinct from 'claimed')
  execute function public.finds_quest_progress();

-- Wyprawy: start (zadanie „Wyrusz przed 7:00”; przed 6:00 – osiągnięcie Skowronek) i koniec (zadania wypraw + sync).
create or replace function public.trips_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
  v_local timestamp := new.started_at at time zone 'Europe/Warsaw';
begin
  if public.is_bot_player(new.user_id) then return null; end if;
  if tg_op = 'INSERT' then
    if v_local::date = public.local_today() then
      for q in select * from public.selected_quests(new.user_id, array['early_start']) loop
        if extract(hour from v_local) < coalesce((q.params ->> 'beforeHour')::int, 7) then
          perform public.bump_selected_quest(new.user_id, q, 1, new.gmina_id);
        end if;
      end loop;
    end if;
    if extract(hour from v_local) < 6 then perform public.sync_achievements(new.user_id); end if;
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
drop trigger if exists trips_progress_insert on public.trips;
create trigger trips_progress_insert after insert on public.trips
  for each row execute function public.trips_progress();
drop trigger if exists trips_progress_status on public.trips;
create trigger trips_progress_status after update of status on public.trips
  for each row when (old.status is distinct from new.status) execute function public.trips_progress();

-- Publikacja wyprawy (publish_trip): zadanie „Opublikuj wyprawę” + Kronikarz.
create or replace function public.posts_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
begin
  if public.is_bot_player(new.author_id) then return null; end if;
  for q in select * from public.selected_quests(new.author_id, array['publish']) loop
    perform public.bump_selected_quest(new.author_id, q, 1, new.gmina_id);
  end loop;
  perform public.sync_achievements(new.author_id);
  return null;
end $$;
drop trigger if exists posts_progress on public.posts;
create trigger posts_progress after insert on public.posts
  for each row when (new.kind = 'trip') execute function public.posts_progress();

-- Reakcja „Darz grzyb!” (toggle_reaction albo bezpośredni INSERT): zadanie reakcji dającego – liczba RÓŻNYCH cudzych
-- wpisów z reakcją w okresie zadania (cofnięcie i ponowienie nie nabija) – oraz osiągnięcia dającego i odbiorcy.
create or replace function public.post_reactions_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
  v_author uuid;
  v_today date := public.local_today();
  v_day date;
  v_n numeric;
  v_have numeric;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then return null; end if;
  if not public.is_bot_player(new.user_id) then
    for q in select * from public.selected_quests(new.user_id, array['reactions']) loop
      v_day := case when q.period = 'weekly' then public.week_start(v_today) else v_today end;
      select count(*) into v_n
        from public.post_reactions r join public.posts p on p.id = r.post_id
       where r.user_id = new.user_id and p.author_id <> new.user_id and r.created_at >= public.warsaw_ts(v_day);
      select coalesce(max(uq.progress), 0) into v_have
        from public.user_quests uq where uq.user_id = new.user_id and uq.quest_id = q.id and uq.day = v_day;
      if v_n > v_have then perform public.bump_selected_quest(new.user_id, q, v_n - v_have, null); end if;
    end loop;
    perform public.sync_achievements(new.user_id);
  end if;
  if not public.is_bot_player(v_author) then perform public.sync_achievements(v_author); end if;
  return null;
end $$;
drop trigger if exists post_reactions_progress on public.post_reactions;
create trigger post_reactions_progress after insert on public.post_reactions
  for each row execute function public.post_reactions_progress();

-- Komentarz (add_comment albo bezpośredni INSERT): Gawędziarz.
create or replace function public.post_comments_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_bot_player(new.author_id) then perform public.sync_achievements(new.author_id); end if;
  return null;
end $$;
drop trigger if exists post_comments_progress on public.post_comments;
create trigger post_comments_progress after insert on public.post_comments
  for each row execute function public.post_comments_progress();

-- Nowa znajomość (akceptacja zaproszenia albo wzajemne zaproszenie): Leśna wataha – obie strony.
create or replace function public.friendships_progress() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_bot_player(new.user_id) then perform public.sync_achievements(new.user_id); end if;
  if not public.is_bot_player(new.friend_id) then perform public.sync_achievements(new.friend_id); end if;
  return null;
end $$;
drop trigger if exists friendships_progress_insert on public.friendships;
create trigger friendships_progress_insert after insert on public.friendships
  for each row when (new.status = 'accepted') execute function public.friendships_progress();
drop trigger if exists friendships_progress_status on public.friendships;
create trigger friendships_progress_status after update of status on public.friendships
  for each row when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function public.friendships_progress();

-- ─────────────────────────────────────────────────────────────────────────────
-- get_game_state: + counters, zadania wylosowane (dzienne i tygodniowe) – reszta jak w 20261011100000_account.sql
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_game_state() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.local_today();
  v_week date := public.week_start(public.local_today());
  pr public.profiles;
  v_trip_ids uuid[];
  v_profile jsonb;
  v_atlas jsonb;
  v_badges jsonb;
  v_achievements jsonb;
  v_quests jsonb;
  v_daily jsonb;
  v_weekly jsonb;
  v_trips jsonb;
  v_finds jsonb;
  v_challenges jsonb;
  v_follows jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into pr from public.profiles where id = v_uid;
  if found then
    v_profile := jsonb_build_object(
      'handle', pr.handle::text,
      'displayName', pr.display_name,
      'firstName', pr.first_name,
      'homeGminaId', pr.home_gmina_id,
      'avatarPath', pr.avatar_path,
      'totalXp', pr.total_xp,
      'level', pr.level,
      'xpInLevel', pr.xp_in_level,
      'streakDays', pr.streak_days,
      'lastActiveDate', to_char(pr.last_active_date, 'YYYY-MM-DD'),
      'tripsCount', pr.trips_count,
      'mushroomsCount', pr.mushrooms_count,
      'totalDistanceM', pr.total_distance_m,
      'termsVersion', pr.terms_version,
      'termsAcceptedAt', public.iso_ts(pr.terms_accepted_at),
      'onboardedAt', public.iso_ts(pr.onboarded_at)
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

  -- Zadania wylosowane graczowi (quests_for): dzienne na dziś, tygodniowe na ten tydzień – w kolejności losowania.
  select coalesce(jsonb_agg(jsonb_build_object(
           'questId', s.quest_id,
           'progress', coalesce(uq.progress, 0),
           'completed', uq.completed_at is not null
         ) order by s.slot) filter (where s.period = 'daily'), '[]'),
         coalesce(jsonb_agg(to_jsonb(s.quest_id) order by s.slot) filter (where s.period = 'daily'), '[]'),
         coalesce(jsonb_agg(jsonb_build_object(
           'questId', s.quest_id,
           'progress', coalesce(uq.progress, 0),
           'completed', uq.completed_at is not null
         ) order by s.slot) filter (where s.period = 'weekly'), '[]')
    into v_quests, v_daily, v_weekly
    from public.quests_for(v_uid, v_today) s
    left join public.user_quests uq
      on uq.user_id = v_uid and uq.quest_id = s.quest_id
     and uq.day = case when s.period = 'weekly' then v_week else v_today end;

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
           'reward', f.reward,
           'photoPath', f.photo_path
         ) order by f.found_at, f.id), '[]')
    into v_finds
    from public.finds f
   where f.user_id = v_uid
     and f.status in ('pending', 'claimed')
     and (f.trip_id = any(v_trip_ids) or (f.trip_id is null and f.status = 'pending'));

  -- Przyjęte wyzwania: ukończone – przyjęte w ostatnich 30 dniach; nieukończone – tylko te, które wciąż trwają.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'gminaId', c.gmina_id,
           'title', c.title,
           'speciesId', c.species_id,
           'description', c.description,
           'xp', c.xp,
           'badgeId', c.badge_id,
           'badgeName', b.name,
           'endsAt', public.iso_ts(c.ends_at),
           'acceptedAt', public.iso_ts(uc.accepted_at),
           'completedAt', public.iso_ts(uc.completed_at)
         ) order by uc.accepted_at desc, c.id), '[]')
    into v_challenges
    from public.user_challenges uc
    join public.gmina_challenges c on c.id = uc.challenge_id
    left join public.badges b on b.id = c.badge_id
   where uc.user_id = v_uid
     and case when uc.completed_at is not null then uc.accepted_at >= now() - interval '30 days'
              else c.active and (c.ends_at is null or c.ends_at > now()) end;

  select coalesce(jsonb_agg(gf.gmina_id order by gf.created_at, gf.gmina_id), '[]')
    into v_follows
    from public.gmina_follows gf where gf.user_id = v_uid;

  return jsonb_build_object(
    'userId', v_uid,
    'serverTime', public.iso_ts(now()),
    'profile', v_profile,
    'atlas', v_atlas,
    'badges', v_badges,
    'achievements', v_achievements,
    'quests', jsonb_build_object(
      'day', to_char(v_today, 'YYYY-MM-DD'),
      'progress', v_quests,
      'daily', v_daily,
      'week', to_char(v_week, 'YYYY-MM-DD'),
      'weekly', v_weekly
    ),
    'counters', public.player_metrics(v_uid),
    'trips', v_trips,
    'finds', v_finds,
    'challenges', v_challenges,
    'followedGminy', v_follows
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia: wszystko nowe – wewnętrzne (klient widzi wyniki przez get_game_state / achievement_progress)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function
  public.quest_hash(text),
  public.week_start(date),
  public.quests_design_mode(),
  public.quest_in_season(jsonb, int),
  public.pick_quests(text[], text[], boolean[], text, int, boolean),
  public.quests_for(uuid, date),
  public.bump_selected_quest(uuid, public.quest_templates, numeric, text),
  public.selected_quests(uuid, text[]),
  public.is_bot_player(uuid),
  public.player_metrics(uuid),
  public.achievement_value(uuid, public.achievements, jsonb),
  public.finds_quest_progress(),
  public.trips_progress(),
  public.posts_progress(),
  public.post_reactions_progress(),
  public.post_comments_progress(),
  public.friendships_progress()
  from public, anon, authenticated;
-- Zmienione przez create or replace (bump_quest, achievement_value(uuid, achievements), sync_achievements,
-- seed_achievements, achievement_progress, get_game_state) zachowują dotychczasowe uprawnienia.
