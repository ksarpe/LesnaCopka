-- =============================================================================
-- Etap 4 – rankingi i statystyki gmin z bazy
--
--  · Rankingi per województwo: refresh_gmina_rankings() liczy punkty wszystkich gmin (XP starsze niż
--    privacy_delay()) i miejsca w kraju ORAZ w województwie (voivodeship_rank, rank() – remisy mają to samo
--    miejsce, następne jest pominięte: 1, 2, 2, 4). Odczyt get_ranking() odświeża ranking sam, gdy ostatnie
--    przeliczenie jest starsze niż 15 min (blokada doradcza – jedno przeliczenie naraz); pg_cron w chmurze
--    tylko skraca czas odpowiedzi.
--  · Tydzień = od poniedziałku 00:00 (Europe/Warsaw), sezon = rok kalendarzowy (Europe/Warsaw).
--    Przeliczane: tydzień bieżący i dwa poprzednie (poprzedni domyka się po 24 h opóźnienia, trzeci daje trend
--    poprzedniemu), sezon i rekordy.
--  · get_gmina_stats() – nagłówek, rekordy, „Co tu się zbiera” i wyzwanie gminy w jednym jsonb (camelCase).
--  · Wyzwania gmin: gminy z danymi gry mają stałe wyzwanie z seeda (bez końca); każda inna gmina dostaje
--    leniwie (ensure_weekly_challenge) jedno wyzwanie na tydzień ISO (pon. 00:00 → nast. pon. 00:00, Warsaw).
--  · accept_challenge / follow_gmina – stan na serwerze; get_game_state() + "challenges" i "followedGminy".
--  · dev_seed_activity – ~60 cichych botów na województwo z historią odebranych znalezisk (tylko lokalnie).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.gmina_rankings
  add column if not exists voivodeship text,                    -- województwo gminy (kopia z gminy – filtr rankingu)
  add column if not exists voivodeship_rank int,                -- miejsce w województwie (rank())
  add column if not exists voivodeship_prev_rank int;           -- miejsce w województwie tydzień wcześniej (tylko 'week')
create index if not exists gmina_rankings_voivodeship_idx
  on public.gmina_rankings (period, period_start, voivodeship, voivodeship_rank);

-- Kiedy ostatnio przeliczono rankingi (także gdy w okresie nie ma punktów – wtedy brak wierszy w gmina_rankings).
create table if not exists public.gmina_rankings_refresh (
  id boolean primary key default true check (id),
  computed_at timestamptz not null,
  week_start date not null,
  season_start date not null
);
alter table public.gmina_rankings_refresh enable row level security;
-- Brak polityk: tylko funkcje serwera.

-- Wyzwania tygodniowe: jedno na gminę i tydzień (week_start = poniedziałek). Stałe wyzwania (seed) mają week_start null.
alter table public.gmina_challenges add column if not exists week_start date;
create unique index if not exists gmina_challenges_week_uidx on public.gmina_challenges (gmina_id, week_start);

-- Rankingi czytają księgę XP po czasie (wszystkie gminy naraz).
create index if not exists xp_events_created_idx on public.xp_events (created_at) where gmina_id is not null;

-- Księga XP → profil: jeden UPDATE na gracza na instrukcję (tabela przejściowa) zamiast dwóch na każdy wpis.
-- Działanie bez zmian (wyzwalacze AFTER ROW i tak odpalają się na końcu instrukcji), a wsadowe wstawianie
-- (dev_seed_activity: tysiące wpisów) jest wielokrotnie szybsze.
create or replace function public.apply_xp_events() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p
     set total_xp = p.total_xp + s.amount,
         (level, xp_in_level) = (select l.level, l.xp_in_level from public.level_from_total_xp(p.total_xp + s.amount) l)
    from (select n.user_id, sum(n.amount) as amount from new_rows n group by n.user_id) s
   where p.id = s.user_id;
  return null;
end $$;
drop trigger if exists xp_events_apply on public.xp_events;
drop function if exists public.apply_xp_event();
drop trigger if exists xp_events_apply_stmt on public.xp_events;
create trigger xp_events_apply_stmt after insert on public.xp_events
  referencing new table as new_rows
  for each statement execute function public.apply_xp_events();

-- Generator aktywności (tylko lokalnie): do kiedy wygenerowano historię bota – ponowne wywołanie dopisuje tylko nowy okres.
create table if not exists public.dev_bot_activity (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  generated_until timestamptz not null
);
alter table public.dev_bot_activity enable row level security;
-- Brak polityk: tylko funkcje serwera.

-- Wiersze rankingów sprzed tej migracji: województwo i miejsca w województwie.
update public.gmina_rankings r set voivodeship = g.voivodeship
  from public.gminy g
 where g.id = r.gmina_id and r.voivodeship is null;
update public.gmina_rankings r set voivodeship_rank = x.vr
  from (
    select period, period_start, gmina_id,
           rank() over (partition by period, period_start, voivodeship order by points desc) as vr
      from public.gmina_rankings
  ) x
 where x.period = r.period and x.period_start = r.period_start and x.gmina_id = r.gmina_id
   and r.voivodeship_rank is null;
update public.gmina_rankings r set voivodeship_prev_rank = p.voivodeship_rank
  from public.gmina_rankings p
 where r.period = 'week' and p.period = 'week' and p.period_start = r.period_start - 7 and p.gmina_id = r.gmina_id
   and r.voivodeship_prev_rank is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Północ danego dnia w Polsce jako timestamptz (granice tygodnia / sezonu).
create or replace function public.warsaw_ts(d date) returns timestamptz
language sql stable set search_path = '' as $$
  select d::timestamp at time zone 'Europe/Warsaw'
$$;

-- Początek okresu rankingu: tydzień od poniedziałku, sezon / rekordy od 1 stycznia (Europe/Warsaw).
create or replace function public.ranking_period_start(p_period public.ranking_period, p_at timestamptz default now())
returns date
language sql stable set search_path = '' as $$
  select case when p_period = 'week'::public.ranking_period
              then date_trunc('week', p_at at time zone 'Europe/Warsaw')::date
              else date_trunc('year', p_at at time zone 'Europe/Warsaw')::date end
$$;

-- Liczebnik: 1 okaz, 2–4 okazy (bez 12–14), 5+ okazów.
create or replace function public.pl_plural(n bigint, one text, few text, many text) returns text
language sql immutable set search_path = '' as $$
  select case when n = 1 then one
              when n % 10 between 2 and 4 and n % 100 not between 12 and 14 then few
              else many end
$$;

-- Biernik nazwy gatunku do tytułu wyzwania („Znajdź borowika szlachetnego…”). Gatunki jadalne – tylko one
-- trafiają do wyzwań tygodniowych; inne → nazwa małymi literami.
create or replace function public.species_accusative(p_species_id text) returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select v.acc from (values
      ('borowik-szlachetny', 'borowika szlachetnego'),
      ('podgrzybek-brunatny', 'podgrzybka brunatnego'),
      ('czubajka-kania', 'czubajkę kanię'),
      ('pieprznik-jadalny', 'kurki'),
      ('mleczaj-rydz', 'rydza'),
      ('szmaciak-galezisty', 'szmaciaka gałęzistego'),
      ('smardz-jadalny', 'smardza jadalnego'),
      ('maslak-zwyczajny', 'maślaka zwyczajnego'),
      ('kozlarz-babka', 'koźlarza babkę'),
      ('kozlarz-czerwony', 'koźlarza czerwonego'),
      ('soplowka-jezowata', 'soplówkę jeżowatą'),
      ('opienka-miodowa', 'opieńki miodowe'),
      ('purchawka-chropowata', 'purchawkę chropowatą'),
      ('golabek-zielonawy', 'gołąbka zielonawego'),
      ('zagwica-listkowata', 'żagwicę listkowatą'),
      ('borowik-ceglastopory', 'borowika ceglastoporego'),
      ('borowik-krolewski', 'borowika królewskiego'),
      ('plachetka-zwyczajna', 'płachetkę zwyczajną'),
      ('czernidlak-kolpakowaty', 'czernidłaka kołpakowatego'),
      ('sarniak-dachowkowaty', 'sarniaka dachówkowatego'),
      ('maslak-sitarz', 'maślaka sitarza'),
      ('kozlarz-pomaranczowozolty', 'koźlarza pomarańczowożółtego'),
      ('lejkowiec-dety', 'lejkowca dętego'),
      ('mleczaj-smaczny', 'mleczaja smacznego'),
      ('siedzun-sosnowy', 'siedzunia sosnowego'),
      ('lakowka-ametystowa', 'lakówkę ametystową')
    ) v (id, acc) where v.id = p_species_id),
    (select lower(s.name) from public.species s where s.id = p_species_id))
$$;

-- Województwo rankingu: podane (bez wielkości liter) albo województwo gminy domowej gracza, inaczej 'podlaskie'.
-- Nieznane → P0001 invalid_voivodeship.
create or replace function public.resolve_voivodeship(p_voivodeship text, p_user uuid) returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v text;
begin
  if nullif(btrim(coalesce(p_voivodeship, '')), '') is null then
    select g.voivodeship into v
      from public.profiles p join public.gminy g on g.id = p.home_gmina_id
     where p.id = p_user;
    return coalesce(v, 'podlaskie');
  end if;
  select g.voivodeship into v from public.gminy g where lower(g.voivodeship) = lower(btrim(p_voivodeship)) limit 1;
  if v is null then
    raise exception 'invalid_voivodeship' using errcode = 'P0001',
      detail = format('Nieznane województwo „%s”', p_voivodeship);
  end if;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rankingi (pg_cron w chmurze + odświeżanie przy odczycie)
-- ─────────────────────────────────────────────────────────────────────────────

-- Przelicza rankingi: tydzień bieżący i dwa poprzednie, sezon, rekordy – z XP starszych niż privacy_delay()
-- (rekordy: znaleziska epickie i legendarne po visible_from). Punkty i miejsca w kraju (rank) oraz w województwie
-- (voivodeship_rank); dla tygodni także miejsca sprzed tygodnia (trend). Gminy bez punktów nie mają wiersza.
-- Jedno przeliczenie naraz (blokada doradcza – ta sama co w ensure_rankings_fresh).
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
    join public.xp_events e
      on e.gmina_id is not null
     and e.created_at >= public.warsaw_ts(w.d)
     and e.created_at < least(public.warsaw_ts(w.d + 7), v_cutoff)
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
    from public.xp_events e
    join public.gminy g on g.id = e.gmina_id
   where e.created_at >= public.warsaw_ts(v_season) and e.created_at < v_cutoff
   group by e.gmina_id, g.voivodeship
  having sum(e.amount) > 0;

  -- Rekordy sezonu: liczba okazów epickich i legendarnych; grzybiarze = różni gracze ze znaleziskami w gminie.
  insert into public.gmina_rankings
    (period, period_start, gmina_id, voivodeship, points, mushroomers, rank, voivodeship_rank, computed_at)
  select 'records', v_season, f.gmina_id, g.voivodeship,
         count(*) filter (where f.rarity in ('epicki', 'legendarny')),
         count(distinct f.user_id),
         rank() over (order by count(*) filter (where f.rarity in ('epicki', 'legendarny')) desc),
         rank() over (partition by g.voivodeship order by count(*) filter (where f.rarity in ('epicki', 'legendarny')) desc),
         now()
    from public.finds f
    join public.gminy g on g.id = f.gmina_id
   where f.status = 'claimed' and f.visible_from <= now() and f.found_at >= public.warsaw_ts(v_season)
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

-- Odświeża rankingi, gdy ostatnie przeliczenie jest starsze niż 15 min albo z innego tygodnia / sezonu.
-- Równoległe odczyty czekają na jedno przeliczenie (blokada) i sprawdzają świeżość ponownie. Zwraca computed_at.
create or replace function public.ensure_rankings_fresh() returns timestamptz
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_week date := public.ranking_period_start('week');
  v_season date := public.ranking_period_start('season');
  v_at timestamptz;
begin
  select r.computed_at into v_at from public.gmina_rankings_refresh r
   where r.id and r.week_start = v_week and r.season_start = v_season and r.computed_at > now() - interval '15 minutes';
  if v_at is not null then return v_at; end if;

  perform pg_advisory_xact_lock(hashtext('refresh_gmina_rankings'));
  -- Ktoś mógł przeliczyć, gdy czekaliśmy na blokadę (nowy snapshot – READ COMMITTED).
  select r.computed_at into v_at from public.gmina_rankings_refresh r
   where r.id and r.week_start = v_week and r.season_start = v_season and r.computed_at > now() - interval '15 minutes';
  if v_at is not null then return v_at; end if;

  perform public.refresh_gmina_rankings();
  return now();
end $$;

-- Ranking gmin województwa (ekran 06).
--  · p_voivodeship null → województwo gminy domowej gracza, inaczej 'podlaskie'; nieznane → P0001 invalid_voivodeship.
--  · rows: tylko gminy z punktami w okresie, miejsca w województwie (rank(): 1, 2, 2, 4), od pierwszego miejsca.
--    points: XP (tydzień / sezon) albo liczba okazów epickich i legendarnych (rekordy). trend (tylko tydzień):
--    miejsce sprzed tygodnia − obecne (+ = awans), null gdy gminy nie było w rankingu.
--  · heat: stopień mapy 1–4 (górne 20% → 4, 20–40% → 3, 40–60% → 2, reszta → 1); gmin bez punktów brak (= 0).
--  · userContribution: XP gracza z gminą (znaleziska, zadania, wyzwania, osiągnięcia) od początku okresu do teraz –
--    bez opóźnienia, to jego własne dane. userGminaId: gmina domowa gracza (może być spoza województwa).
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
   where e.user_id = v_uid and e.gmina_id is not null and e.created_at >= public.warsaw_ts(v_start);

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
-- Wyzwania gmin
-- ─────────────────────────────────────────────────────────────────────────────

-- Aktualne wyzwanie gminy (wewnętrzna – woła ją get_gmina_stats):
--  · stałe wyzwanie (seed: gminy z danymi gry, ends_at null) ma pierwszeństwo – bez końca;
--  · inaczej jedno wyzwanie na tydzień ISO (pon. 00:00 → nast. pon. 00:00, Europe/Warsaw), tworzone przy pierwszym
--    odczycie: najczęściej zbierany gatunek JADALNY w gminie w tym sezonie (dane publiczne – po visible_from),
--    a bez danych – pospolity jadalny wybrany deterministycznie (hash gminy i tygodnia). XP 150–300 wg rzadkości
--    gatunku, bez odznaki. Równoległe wywołania → jeden wiersz (unikalny indeks gmina + tydzień).
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
   where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.collected and f.visible_from <= now()
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

-- „Przyjmij wyzwanie”. Idempotentne: już przyjęte → nic (także po końcu wyzwania – spóźnione ponowienie z kolejki).
-- Nieznane → P0002 challenge_not_found; nieaktywne / zakończone / jeszcze nierozpoczęte → P0001 challenge_inactive.
-- Ukończenie bez zmian: claim_find znaleziska tego gatunku w tej gminie przed końcem wyzwania (XP + odznaka).
create or replace function public.accept_challenge(p_challenge_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  c public.gmina_challenges;
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
  insert into public.user_challenges (user_id, challenge_id) values (v_uid, c.id) on conflict do nothing;
end $$;

-- „Obserwuj gminę” (p_follow = true) / „Przestań obserwować” (false). Idempotentne.
-- Nieznana gmina przy obserwowaniu → P0002 gmina_not_found; p_follow null → P0001 invalid_follow.
create or replace function public.follow_gmina(p_gmina_id text, p_follow boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_follow is null then raise exception 'invalid_follow' using errcode = 'P0001'; end if;
  if p_follow then
    if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
      raise exception 'gmina_not_found' using errcode = 'P0002';
    end if;
    insert into public.gmina_follows (user_id, gmina_id) values (v_uid, p_gmina_id) on conflict do nothing;
  else
    delete from public.gmina_follows where user_id = v_uid and gmina_id = p_gmina_id;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Statystyki gminy (ekran 07) i percentyl okazu (03 / 04)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wszystko dla ekranu gminy w jednym wywołaniu. Sezon, tylko znaleziska po visible_from (jak gmina_stats):
--  · rank – miejsce w tygodniowym rankingu województwa (null bez punktów), mushroomers – różni gracze,
--    mushrooms – zebrane okazy, species – gatunki (także sfotografowane trujące);
--  · records – najcięższy zebrany okaz w każdej rzadkości (3 najrzadsze), autor = nazwa gracza (pusta → nick);
--  · distribution – udział 4 najczęstszych zebranych gatunków + „Inne” (dopełnienie do 100);
--  · challenge – stałe albo tygodniowe wyzwanie (ensure_weekly_challenge) + stan gracza i obserwowanie.
-- Nieznana gmina → P0002 gmina_not_found.
create or replace function public.get_gmina_stats(p_gmina_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  g public.gminy;
  c public.gmina_challenges;
  uc public.user_challenges;
  v_season_ts timestamptz := public.warsaw_ts(public.ranking_period_start('season'));
  v_rank int;
  v_agg record;
  v_records jsonb;
  v_dist jsonb;
  v_challenge jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.gminy where id = p_gmina_id;
  if not found then raise exception 'gmina_not_found' using errcode = 'P0002'; end if;

  perform public.ensure_rankings_fresh();
  select r.voivodeship_rank into v_rank
    from public.gmina_rankings r
   where r.period = 'week' and r.period_start = public.ranking_period_start('week') and r.gmina_id = g.id;

  select count(distinct f.user_id) as mushroomers,
         count(*) filter (where f.collected) as mushrooms,
         count(distinct f.species_id) as species
    into v_agg
    from public.finds f
   where f.gmina_id = g.id and f.status = 'claimed' and f.visible_from <= now() and f.found_at >= v_season_ts;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rarity', b.rarity,
           'speciesName', b.name,
           'weightG', b.weight_g,
           'capCm', b.cap_cm,
           'author', b.author,
           'foundOn', to_char(b.found_on, 'YYYY-MM-DD')
         ) order by b.rarity desc), '[]')
    into v_records
    from (
      select * from (
        select distinct on (f.rarity) f.rarity, s.name, f.weight_g, f.cap_cm,
               coalesce(nullif(btrim(p.display_name), ''), p.handle::text) as author,
               (f.found_at at time zone 'Europe/Warsaw')::date as found_on
          from public.finds f
          join public.species s on s.id = f.species_id
          join public.profiles p on p.id = f.user_id
         where f.gmina_id = g.id and f.status = 'claimed' and f.collected
           and f.visible_from <= now() and f.found_at >= v_season_ts
         order by f.rarity desc, f.weight_g desc nulls last, f.found_at
      ) best
      order by best.rarity desc
      limit 3
    ) b;

  with cnt as (
    select s.name, count(*) as n
      from public.finds f join public.species s on s.id = f.species_id
     where f.gmina_id = g.id and f.status = 'claimed' and f.collected
       and f.visible_from <= now() and f.found_at >= v_season_ts
     group by s.name
  ), t as (
    select sum(cnt.n) as total, count(*) as k from cnt
  ), top as (
    select cnt.name, round(100.0 * cnt.n / t.total)::int as pct, row_number() over (order by cnt.n desc, cnt.name) as rn
      from cnt, t
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'pct', x.pct) order by x.ord), '[]')
    into v_dist
    from (
      select top.name, top.pct, top.rn as ord from top where top.rn <= 4
      union all
      select 'Inne', greatest(0, 100 - (select coalesce(sum(top.pct), 0) from top where top.rn <= 4))::int, 5
        from t where t.k > 4
    ) x;

  c := public.ensure_weekly_challenge(g.id);
  if c.id is not null then
    select * into uc from public.user_challenges x where x.user_id = v_uid and x.challenge_id = c.id;
    v_challenge := jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'speciesId', c.species_id,
      'description', c.description,
      'xp', c.xp,
      'badgeId', c.badge_id,
      'badgeName', (select b.name from public.badges b where b.id = c.badge_id),
      'endsAt', public.iso_ts(c.ends_at)
    );
  end if;

  return jsonb_build_object(
    'gminaId', g.id,
    'name', g.name,
    'rank', v_rank,
    'mushroomers', v_agg.mushroomers,
    'mushrooms', v_agg.mushrooms,
    'species', v_agg.species,
    'records', v_records,
    'distribution', v_dist,
    'challenge', v_challenge,
    'challengeAccepted', uc.user_id is not null,
    'challengeCompleted', uc.completed_at is not null,
    'followed', exists (select 1 from public.gmina_follows gf where gf.user_id = v_uid and gf.gmina_id = g.id)
  );
end $$;

-- „W gminie X w tym sezonie” / „Większy niż 88% okazów w gminie”: sezon, znaleziska po visible_from.
--  · collected – odebrane okazy gatunku w gminie, mushroomers – różni gracze, biggerCount – cięższe od p_weight_g,
--    sizeRank = biggerCount + 1, percentile – % lżejszych (0–100).
--  · collected = 0 → sizeRank 1, biggerCount 0, percentile 100 (brak danych publicznych: aplikacja pokazuje stan
--    „Pierwszy okaz w gminie w tym sezonie” zamiast paska).
-- Nieznany gatunek → P0002 species_not_found, gmina → P0002 gmina_not_found.
create or replace function public.get_species_percentile(p_species_id text, p_gmina_id text, p_weight_g int)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_w int := coalesce(p_weight_g, 0);
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.species s where s.id = p_species_id) then
    raise exception 'species_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'gmina_not_found' using errcode = 'P0002';
  end if;
  select count(*) as n,
         count(distinct f.user_id) as users,
         count(*) filter (where f.weight_g > v_w) as bigger,
         count(*) filter (where f.weight_g < v_w) as smaller
    into r
    from public.finds f
   where f.species_id = p_species_id and f.gmina_id = p_gmina_id and f.status = 'claimed'
     and f.visible_from <= now() and f.found_at >= public.warsaw_ts(public.ranking_period_start('season'));
  return jsonb_build_object(
    'speciesId', p_species_id,
    'gminaId', p_gmina_id,
    'collected', r.n,
    'mushroomers', r.users,
    'sizeRank', r.bigger + 1,
    'percentile', case when r.n = 0 then 100 else round(100.0 * r.smaller / r.n)::int end,
    'biggerCount', r.bigger
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stan gry: + przyjęte wyzwania i obserwowane gminy (reszta bez zmian względem 20261007100000_game_sync.sql)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_game_state() returns jsonb
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

  -- Przyjęte wyzwania: ukończone – przyjęte w ostatnich 30 dniach; nieukończone – tylko te, które wciąż trwają
  -- (aktywne, bez końca albo przed endsAt; także stałe wyzwanie przyjęte dawno temu). Nieukończone po końcu – pomijane.
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
    'quests', jsonb_build_object('day', to_char(v_today, 'YYYY-MM-DD'), 'progress', v_quests),
    'trips', v_trips,
    'finds', v_finds,
    'challenges', v_challenges,
    'followedGminy', v_follows
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Narzędzia deweloperskie (tylko przy app_config.dev_tools = true)
-- ─────────────────────────────────────────────────────────────────────────────

-- Konto bota (jak w dev_seed_social): auth.users (anonimowe) → trigger tworzy profil, is_bot = true.
-- Istniejący bot o tym nicku → jego id; nick zajęty przez prawdziwego gracza → null (bota pomijamy).
create or replace function public.dev_ensure_bot(p_handle text, p_name text, p_first_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_is_bot boolean;
begin
  select id, is_bot into v_id, v_is_bot from public.profiles where handle = p_handle;
  if v_id is not null then
    return case when v_is_bot then v_id end;
  end if;
  v_id := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', true,
          '{"provider":"anonymous","providers":["anonymous"]}',
          jsonb_build_object('handle', p_handle, 'full_name', p_name, 'first_name', p_first_name, 'bot', true),
          now(), now());
  update public.profiles set is_bot = true where id = v_id;
  return v_id;
end $$;

-- Historia cichych botów w województwie (wewnętrzna – woła ją dev_seed_activity). Zwraca {"bots","finds","gminy"}.
--  · 60 botów na województwo, nick 'bot<TERYT woj.>.<imię><nr>' (np. bot20.anna01) – po nim idempotentnie;
--    gmina domowa losowa w województwie (miasta ×3), avatar z puli aplikacji. Ciche: bez wpisów, reakcji i znajomych.
--  · Każdy bot ma 3 ulubione gminy (deterministycznie z id bota): ważone lesistością² (×6 w powiecie gminy domowej).
--  · Wyprawy (zakończone) od końca poprzednio wygenerowanej historii (dev_bot_activity; najwyżej p_weeks tygodni
--    wstecz) do teraz: 0,6–3,1 tyg.,
--    rano (5:00–14:00), 50 min – 4 h 10 min; dodatkowo część botów ma wyprawę w tym tygodniu starszą niż 25 h
--    (ranking tygodnia) i w ostatnich 24 h (pokazuje opóźnienie prywatności).
--  · Znaleziska (odebrane): 2 + do (4 + lesistość/6) na wyprawę; gatunki wg rzadkości (na gatunek: pospolity 100,
--    rzadki 20, epicki 4, legendarny 1; trujące ×0,4 – tylko zdjęcie) × popularność (podgrzybek ×8, borowik ×12,
--    kurka ×3, maślak ×2 …, pozostałe pospolite ×0,3), masa ~ typowa × skala² (skala 0,72–1,14;
--    3% okazów XXL 1,25–1,6), kępki 6–15 sztuk; XP jak claim_find (baza, XXL, pierwszy gatunek na wyprawie,
--    trujący ½ bazy). visible_from = found_at + privacy_delay(), wpis w księdze XP (źródło 'find') z czasem znaleziska.
--  · Profil bota: liczniki wypraw, grzybów i dystansu, ostatnia aktywność, atlas (user_species). Bez odznak i osiągnięć.
create or replace function public.dev_seed_voivodeship(p_voivodeship text, p_weeks int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_names text[] := array[
    'Anna', 'Piotr', 'Katarzyna', 'Tomasz', 'Małgorzata', 'Paweł', 'Agnieszka', 'Michał', 'Joanna', 'Krzysztof',
    'Ewa', 'Marcin', 'Barbara', 'Jan', 'Monika', 'Andrzej', 'Dorota', 'Adam', 'Beata', 'Rafał',
    'Iwona', 'Grzegorz', 'Halina', 'Wojciech', 'Renata', 'Stanisław', 'Teresa', 'Zbigniew', 'Jadwiga', 'Kamil'];
  v_avatars text[] := array['bor', 'lisc', 'mech', 'rosa', 'wrzos', 'slonce', 'dab', 'lis', 'biedronka', 'sowa', 'zajac', 'wedrowiec'];
  v_letters text := 'BKMNPSTWZ';
  v_now timestamptz := now();
  v_week_ts timestamptz := public.warsaw_ts(public.ranking_period_start('week'));
  v_horizon timestamptz := now() - make_interval(days => 7 * p_weeks);
  v_code text;
  v_first text;
  v_name text;
  v_bot uuid;
  b record;
  v_spots text[];
  v_last timestamptz;
  v_from timestamptz;
  v_rate numeric;
  v_n int;
  v_day date;
  v_start timestamptz;
  v_dur interval;
  v_starts timestamptz[];
  v_durs interval[];
  v_new uuid[];
  v_trip_ids uuid[] := '{}';
  v_finds int := 0;
begin
  select substr(min(g.teryt), 1, 2) into v_code from public.gminy g where g.voivodeship = p_voivodeship;
  if v_code is null then raise exception 'invalid_voivodeship' using errcode = 'P0001'; end if;

  -- 1. Boty (raz) z gminą domową w województwie.
  for i in 1 .. 60 loop
    v_first := v_names[1 + (i - 1 + v_code::int) % array_length(v_names, 1)];
    v_name := case i % 6
      when 0 then v_first || '_' || substr(v_letters, 1 + i % 9, 1)
      when 1 then v_first || '.las'
      when 2 then v_first || (58 + i % 41)::text
      when 3 then v_first || '_z_lasu'
      when 4 then v_first || '_Borowik'
      else v_first
    end;
    v_bot := public.dev_ensure_bot(
      format('bot%s.%s%s', v_code, translate(lower(v_first), 'ąćęłńóśźż', 'acelnoszz'), lpad(i::text, 2, '0')),
      v_name, v_first);
    continue when v_bot is null;
    update public.profiles
       set display_name = v_name, first_name = v_first, avatar_preset = v_avatars[1 + i % array_length(v_avatars, 1)],
           home_gmina_id = (
             select g.id from public.gminy g
              where g.voivodeship = p_voivodeship
              order by -ln(1 - random()) / (case when g.kind = 'miejska' then 3 else 1 end)
              limit 1)
     where id = v_bot and home_gmina_id is null;
  end loop;

  -- 2. Wyprawy.
  for b in
    select p.id, hg.powiat
      from public.profiles p
      left join public.gminy hg on hg.id = p.home_gmina_id
     where p.is_bot and p.handle::text like 'bot' || v_code || '.%'
     order by p.handle
  loop
    select array_agg(x.id order by x.k) into v_spots from (
      select g.id, -ln(u.u) / (power(greatest(coalesce(g.forest_pct, 25), 2), 2)
                               * case when g.powiat is not distinct from b.powiat then 6 else 1 end) as k
        from public.gminy g
        cross join lateral (select ((abs(hashtext(b.id::text || ':' || g.id)::bigint) % 999983) + 1) / 999984.0 as u) u
       where g.voivodeship = p_voivodeship
       order by 2
       limit 3
    ) x;

    -- Od kiedy dopisywać: koniec poprzednio wygenerowanej historii (albo ostatnie znalezisko bota), najwyżej p_weeks wstecz.
    select a.generated_until into v_last from public.dev_bot_activity a where a.user_id = b.id;
    if v_last is null then
      select max(f.found_at) + interval '1 hour' into v_last from public.finds f where f.user_id = b.id;
    end if;
    v_from := greatest(v_horizon, coalesce(v_last, v_horizon));
    continue when v_from >= v_now - interval '1 hour';
    insert into public.dev_bot_activity (user_id, generated_until) values (b.id, v_now)
    on conflict (user_id) do update set generated_until = excluded.generated_until;
    v_rate := 0.6 + (abs(hashtext(b.id::text)::bigint) % 100) / 40.0;
    v_n := floor(v_rate * extract(epoch from (v_now - v_from)) / (7 * 86400) + random())::int;
    v_starts := '{}';
    v_durs := '{}';
    for k in 1 .. v_n loop
      v_day := ((v_from + random() * (v_now - v_from)) at time zone 'Europe/Warsaw')::date;
      v_start := (v_day + interval '5 hours' + random() * interval '9 hours') at time zone 'Europe/Warsaw';
      v_dur := interval '50 minutes' + random() * interval '200 minutes';
      if v_start >= v_from and v_start + v_dur <= v_now - interval '10 minutes' then
        v_starts := v_starts || v_start;
        v_durs := v_durs || v_dur;
      end if;
    end loop;
    -- Ten tydzień, starsze niż 25 h (wchodzi do rankingu tygodnia).
    if v_now - interval '25 hours' - greatest(v_week_ts, v_from) >= interval '3 hours' and random() < 0.5
       and not exists (select 1 from public.trips t
                        where t.user_id = b.id and t.started_at >= v_week_ts and t.started_at < v_now - interval '24 hours') then
      v_dur := interval '50 minutes' + random() * interval '70 minutes';
      v_starts := v_starts || (greatest(v_week_ts, v_from) + random() * (v_now - interval '25 hours' - greatest(v_week_ts, v_from) - v_dur));
      v_durs := v_durs || v_dur;
    end if;
    -- Ostatnie 24 h (jeszcze poza statystykami innych).
    if v_now - interval '20 hours' >= v_from and random() < 0.25
       and not exists (select 1 from public.trips t where t.user_id = b.id and t.started_at >= v_now - interval '24 hours') then
      v_dur := interval '50 minutes' + random() * interval '60 minutes';
      v_starts := v_starts || (v_now - interval '20 hours' + random() * (interval '17 hours' - v_dur));
      v_durs := v_durs || v_dur;
    end if;
    continue when cardinality(v_starts) = 0;

    with ins as (
      insert into public.trips (user_id, gmina_id, status, started_at, ended_at, duration_s, distance_m, created_at)
      select b.id,
             v_spots[least(width_bucket(random(), array[0, 0.55, 0.85]::float8[]), cardinality(v_spots))],
             'finished', u.s, u.s + u.d, extract(epoch from u.d)::int,
             (extract(epoch from u.d) / 3600.0 * (1800 + random() * 1600))::int,
             u.s
        from unnest(v_starts, v_durs) u (s, d)
      returning id
    )
    select array_agg(id) into v_new from ins;
    v_trip_ids := v_trip_ids || v_new;
  end loop;

  -- 3. Znaleziska + księga XP (jeden wpis na znalezisko, czas = czas znaleziska).
  if cardinality(v_trip_ids) > 0 then
    with sp as (
      select s.id, s.rarity, s.edibility not in ('trujacy', 'smiertelny') as collected, s.clustered,
             s.typical_weight_g, s.typical_cap_cm, s.typical_height_cm,
             sum(w.w) over (order by s.atlas_no) - w.w as lo,
             sum(w.w) over (order by s.atlas_no) as hi,
             sum(w.w) over () as total
        from public.species s
        cross join lateral (
          select (case s.rarity when 'pospolity' then 100 when 'rzadki' then 20 when 'epicki' then 4 else 1 end)
                 * (case when s.edibility in ('trujacy', 'smiertelny') then 0.4 else 1 end)
                 -- popularność w koszyku (jak „Co tu się zbiera” w makiecie): podgrzybki, kurki, maślaki, borowiki
                 * (case s.id
                      when 'podgrzybek-brunatny' then 8 when 'pieprznik-jadalny' then 3 when 'maslak-zwyczajny' then 2
                      when 'kozlarz-babka' then 1.5 when 'opienka-miodowa' then 1.2 when 'borowik-szlachetny' then 12
                      when 'kozlarz-czerwony' then 3 when 'mleczaj-rydz' then 2 when 'czubajka-kania' then 3
                      else case when s.rarity = 'pospolity' then 0.3 else 1 end
                    end)::numeric as w
        ) w
       where s.active
    ), tr as (
      select t.id, t.user_id, t.gmina_id, t.started_at, t.ended_at, coalesce(g.forest_pct, 25) as fp
        from public.trips t join public.gminy g on g.id = t.gmina_id
       where t.id = any(v_trip_ids)
    ), raw as (
      select tr.id as trip_id, tr.user_id, tr.gmina_id,
             tr.started_at + random() * (tr.ended_at - tr.started_at) as found_at,
             random() as r_sp, random() as r_scale, random() as r_giant, random() as r_pieces,
             random() as r_conf, random() as r_age
        from tr
        cross join lateral generate_series(1, 2 + floor(random() * (4 + tr.fp / 6))::int) k
    ), picked as (
      select raw.*, sp.id as species_id, sp.rarity, sp.collected, sp.clustered,
             sp.typical_weight_g, sp.typical_cap_cm, sp.typical_height_cm,
             case when raw.r_giant < 0.03 then 1.25 + raw.r_scale * 0.35 else 0.72 + raw.r_scale * 0.42 end as scale,
             case when sp.clustered then 6 + floor(raw.r_pieces * 10)::int end as pieces
        from raw
        join sp on raw.r_sp * sp.total >= sp.lo and raw.r_sp * sp.total < sp.hi
    ), dims as (
      select picked.*,
             case when clustered then pieces * typical_weight_g
                  else greatest(5, round(typical_weight_g * scale * scale / 5) * 5)::int end as weight_g,
             greatest(2, round((typical_cap_cm * scale)::numeric, 1)) as cap_cm,
             greatest(3, round((typical_height_cm * scale)::numeric, 1)) as height_cm,
             row_number() over (partition by trip_id, species_id order by found_at) = 1 as first_in_trip
        from picked
    ), fin as (
      select dims.*,
             not clustered and weight_g >= typical_weight_g * 1.25 as xxl,
             public.rarity_base(rarity) as base
        from dims
    ), ins as (
      insert into public.finds (user_id, trip_id, species_id, gmina_id, rarity, confidence, xxl, cap_cm, height_cm, weight_g,
                                age_days, pieces, collected, status, xp, found_at, claimed_at, visible_from, created_at)
      select user_id, trip_id, species_id, gmina_id, rarity, round((0.82 + r_conf * 0.17)::numeric, 3), xxl, cap_cm, height_cm,
             weight_g, (1 + floor(r_age * 7))::int, pieces, collected, 'claimed',
             case when not collected then round(base / 2.0)::int
                  else base + case when xxl then round(base * 0.5)::int else 0 end + case when first_in_trip then 40 else 0 end end,
             found_at, found_at, found_at + public.privacy_delay(), found_at
        from fin
      returning id, user_id, gmina_id, xp, found_at
    )
    insert into public.xp_events (user_id, source, ref_id, gmina_id, amount, created_at)
    select user_id, 'find', id::text, gmina_id, xp, found_at from ins;
    get diagnostics v_finds = row_count;

    update public.trips t set xp = s.xp
      from (select f.trip_id, sum(f.xp) as xp from public.finds f where f.trip_id = any(v_trip_ids) group by 1) s
     where t.id = s.trip_id;

    update public.profiles p
       set trips_count = p.trips_count + s.trips,
           total_distance_m = p.total_distance_m + s.distance,
           mushrooms_count = p.mushrooms_count + s.mushrooms,
           last_active_date = greatest(p.last_active_date, s.last_day)
      from (
        select t.user_id, count(*) as trips, sum(t.distance_m) as distance,
               max((t.started_at at time zone 'Europe/Warsaw')::date) as last_day,
               (select count(*) from public.finds f
                 where f.user_id = t.user_id and f.trip_id = any(v_trip_ids) and f.collected) as mushrooms
          from public.trips t
         where t.id = any(v_trip_ids)
         group by t.user_id
      ) s
     where p.id = s.user_id;

    insert into public.user_species as us (user_id, species_id, count, first_found_at, best_cap_cm, best_weight_g)
    select f.user_id, f.species_id, count(*), min(f.found_at), max(f.cap_cm), max(f.weight_g)
      from public.finds f
     where f.trip_id = any(v_trip_ids)
     group by f.user_id, f.species_id
    on conflict (user_id, species_id) do update set
      count = us.count + excluded.count,
      first_found_at = least(us.first_found_at, excluded.first_found_at),
      best_cap_cm = greatest(us.best_cap_cm, excluded.best_cap_cm),
      best_weight_g = greatest(us.best_weight_g, excluded.best_weight_g);
  end if;

  return jsonb_build_object(
    'bots', (select count(*) from public.profiles p where p.is_bot and p.handle::text like 'bot' || v_code || '.%'),
    'finds', v_finds,
    'gminy', (select count(distinct f.gmina_id)
                from public.finds f
                join public.profiles p on p.id = f.user_id
                join public.gminy g on g.id = f.gmina_id
               where p.is_bot and p.handle::text like 'bot' || v_code || '.%' and g.voivodeship = p_voivodeship)
  );
end $$;

-- Panel /dev: „ożyw” rankingi – ciche boty z historią znalezisk w województwie (p_voivodeship null → województwo gminy
-- domowej wywołującego, inaczej podlaskie; nieznane → P0001 invalid_voivodeship) i zawsze także w podlaskim (makieta).
-- p_weeks 1–26 (domyślnie 8). Ponowne wywołanie nie tworzy nowych botów – dopisuje tylko aktywność od poprzedniego
-- wywołania (krócej niż godzinę później – nic). Dane prawdziwych graczy (także wywołującego) bez zmian. Na końcu przelicza rankingi.
-- Zwraca {"voivodeship", "bots", "finds" (nowe znaleziska w województwie), "gminy" (gminy województwa z aktywnością botów)}
-- + "podlaskie": {...} (gdy województwo jest inne).
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
  perform public.refresh_gmina_rankings();
  return v_out;
end $$;

-- Panel /dev: przelicz rankingi teraz (bez czekania na 15 min). Zwraca {"computedAt", "week", "season", "records"}
-- (liczba gmin z punktami w bieżących okresach w całym kraju).
create or replace function public.dev_refresh_rankings() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform public.refresh_gmina_rankings();
  return jsonb_build_object(
    'computedAt', public.iso_ts(now()),
    'week', (select count(*) from public.gmina_rankings r
              where r.period = 'week' and r.period_start = public.ranking_period_start('week')),
    'season', (select count(*) from public.gmina_rankings r
                where r.period = 'season' and r.period_start = public.ranking_period_start('season')),
    'records', (select count(*) from public.gmina_rankings r
                 where r.period = 'records' and r.period_start = public.ranking_period_start('records'))
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.gmina_rankings_refresh, public.dev_bot_activity from anon, authenticated;

revoke all on function
  public.apply_xp_events(),
  public.warsaw_ts(date),
  public.ranking_period_start(public.ranking_period, timestamptz),
  public.pl_plural(bigint, text, text, text),
  public.species_accusative(text),
  public.resolve_voivodeship(text, uuid),
  public.refresh_gmina_rankings(),
  public.ensure_rankings_fresh(),
  public.get_ranking(public.ranking_period, text),
  public.ensure_weekly_challenge(text),
  public.accept_challenge(uuid),
  public.follow_gmina(text, boolean),
  public.get_gmina_stats(text),
  public.get_species_percentile(text, text, int),
  public.get_game_state(),
  public.dev_ensure_bot(text, text, text),
  public.dev_seed_voivodeship(text, int),
  public.dev_seed_activity(text, int),
  public.dev_refresh_rankings()
  from public, anon, authenticated;

grant execute on function
  public.get_ranking(public.ranking_period, text),
  public.accept_challenge(uuid),
  public.follow_gmina(text, boolean),
  public.get_gmina_stats(text),
  public.get_species_percentile(text, text, int),
  public.get_game_state(),
  public.dev_seed_activity(text, int),
  public.dev_refresh_rankings()
  to authenticated;

-- Cron w chmurze (pg_cron) – bez zmian, odświeżanie przy odczycie i tak pilnuje świeżości (≤ 15 min):
--   select cron.schedule('rankingi-gmin', '7 * * * *', $$select public.refresh_gmina_rankings()$$);
