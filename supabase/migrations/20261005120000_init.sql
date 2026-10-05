-- =============================================================================
-- Grzybobranie – schemat bazy (Supabase · Postgres 15+ · PostGIS)
--
-- Zasady:
--  1. Logika gry (XP, poziomy, odznaki, zadania, wyzwania) liczy się na serwerze
--     w funkcjach SECURITY DEFINER – klient nie może dopisać sobie XP ani odznak.
--  2. Prywatność: dokładna lokalizacja (ślad GPS, punkt znaleziska) widzi tylko właściciel.
--     Publicznie: gmina + uogólniona trasa, dopiero od visible_from (koniec wyprawy + opóźnienie).
--  3. Każda tabela ma RLS; uprawnienia nadawane jawnie na końcu pliku (najpierw „nic”).
--  4. Identyfikatory słowników (gatunki, gminy, odznaki, zadania) to slugi – te same co w aplikacji.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists citext with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Typy
-- ─────────────────────────────────────────────────────────────────────────────

create type public.rarity as enum ('pospolity', 'rzadki', 'epicki', 'legendarny');
create type public.edibility as enum ('jadalny', 'niejadalny', 'trujacy', 'smiertelny');
create type public.trip_status as enum ('active', 'finished', 'published');
create type public.find_status as enum ('pending', 'claimed', 'discarded');
create type public.scan_status as enum ('uploading', 'identifying', 'identified', 'failed');
create type public.route_precision as enum ('gmina', 'approximate');
create type public.post_kind as enum ('trip', 'levelup');
create type public.xp_source as enum ('find', 'quest', 'challenge', 'admin');
create type public.quest_kind as enum ('scans', 'rare', 'distance');
create type public.friendship_status as enum ('pending', 'accepted');
create type public.ranking_period as enum ('week', 'season', 'records');

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (czyste) – lustro src/utils/xp.ts
-- ─────────────────────────────────────────────────────────────────────────────

create function public.rarity_base(r public.rarity) returns int
language sql immutable set search_path = '' as $$
  select case r when 'pospolity' then 40 when 'rzadki' then 120 when 'epicki' then 300 else 800 end
$$;

create function public.rarity_rank(r public.rarity) returns int
language sql immutable set search_path = '' as $$
  select array_position(enum_range(null::public.rarity), r) - 1
$$;

-- XP potrzebne na przejście z poziomu lvl na lvl+1: Lv14 → 3000, Lv15 → 3200, +200/poziom (min. 400).
create function public.level_threshold(lvl int) returns int
language sql immutable set search_path = '' as $$
  select greatest(400, 3000 + (lvl - 14) * 200)
$$;

create function public.level_from_total_xp(total bigint, out level int, out xp_in_level int)
language plpgsql immutable set search_path = '' as $$
declare
  rest bigint := greatest(total, 0);
begin
  level := 1;
  while rest >= public.level_threshold(level) loop
    rest := rest - public.level_threshold(level);
    level := level + 1;
  end loop;
  xp_in_level := rest;
end $$;

-- Opóźnienie publikacji (feed, statystyki gmin) – nic nie pokazujemy „na żywo”.
create function public.privacy_delay() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

create function public.local_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Warsaw')::date $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Słowniki (publiczne do odczytu, zapis tylko service_role / migracje)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.forest_regions (
  id text primary key,                                   -- 'puszcza-knyszynska'
  name text not null unique,                             -- 'Puszcza Knyszyńska'
  boundary extensions.geometry(MultiPolygon, 4326)
);

create table public.gminy (
  id text primary key,                                   -- slug, np. 'suprasl'
  teryt text unique,                                     -- kod TERYT (z importu PRG / GUGiK)
  name text not null,
  voivodeship text not null,
  powiat text,
  forest_region_id text references public.forest_regions (id),
  boundary extensions.geometry(MultiPolygon, 4326),      -- granica administracyjna (PRG)
  tile_row smallint,                                     -- pozycja na uproszczonej heatmapie w aplikacji
  tile_col smallint,
  created_at timestamptz not null default now()
);
create index gminy_boundary_gix on public.gminy using gist (boundary);
create index gminy_voivodeship_idx on public.gminy (voivodeship);

create table public.species (
  id text primary key,                                   -- 'borowik-szlachetny'
  atlas_no smallint not null unique,                     -- kolejność w atlasie
  name text not null,
  latin text not null unique,
  short_name text not null,                              -- 'borowik' → „Pierwszy borowik w gminie dziś”
  rarity public.rarity not null,                         -- rzadkość bazowa gatunku
  edibility public.edibility not null,
  habitat text not null,
  clustered boolean not null default false,              -- kępki liczone w sztukach (kurki, opieńki)
  typical_cap_cm numeric(5, 1) not null,
  typical_height_cm numeric(5, 1) not null,
  typical_weight_g int not null,
  photo_path text,
  description text,
  active boolean not null default true
);

-- Sobowtóry: żółty baner bezpieczeństwa na ekranie Analiza.
create table public.species_lookalikes (
  species_id text not null references public.species (id) on delete cascade,
  lookalike_name text not null,
  lookalike_id text references public.species (id),      -- null, gdy sobowtóra nie ma w katalogu
  lookalike_edibility public.edibility not null,
  tip text not null,
  primary key (species_id, lookalike_name)
);

create table public.badges (
  id text primary key,                                   -- 'krol-puszczy'
  name text not null,
  description text not null,
  icon text not null,                                    -- nazwa Material Symbol
  color text not null,
  icon_color text not null,
  sort smallint not null default 0,
  -- Warunek odblokowania, np.:
  --   {"type":"species_in_region","species":"borowik-szlachetny","region":"puszcza-knyszynska","count":10}
  --   {"type":"distance_km","km":100} · {"type":"streak","days":7} · {"type":"rarity_find","rarity":"legendarny","count":1}
  --   {"type":"early_bird","before":"06:00"}
  --   {"type":"challenge"} – przyznawana tylko za wyzwanie gminy
  rule jsonb not null
);

create table public.quest_templates (
  id text primary key,                                   -- 'q-scan-5'
  kind public.quest_kind not null,
  title text not null,
  icon text not null,
  icon_filled boolean not null default false,
  icon_bg text not null,
  icon_color text not null,
  xp int not null check (xp > 0),
  target numeric(6, 1) not null check (target > 0),      -- sztuki albo km
  active boolean not null default true,
  sort smallint not null default 0
);

create table public.gmina_challenges (
  id uuid primary key default gen_random_uuid(),
  gmina_id text not null references public.gminy (id) on delete cascade,
  species_id text not null references public.species (id),
  title text not null,
  description text not null,
  xp int not null check (xp > 0),
  badge_id text references public.badges (id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true
);
create index gmina_challenges_gmina_idx on public.gmina_challenges (gmina_id) where active;

-- Prognoza grzybowa (zasilana cronem z danych pogodowych, np. Open-Meteo / IMGW).
create table public.gmina_forecasts (
  gmina_id text not null references public.gminy (id) on delete cascade,
  day date not null,
  score smallint not null check (score between 1 and 5),
  days_after_rain smallint,
  source text,
  primary key (gmina_id, day)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Użytkownicy i relacje
-- ─────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique check (handle ~ '^[a-z0-9._]{3,24}$'),
  display_name text not null,
  first_name text,
  avatar_path text,                                      -- Storage: avatars/{user_id}/…
  home_gmina_id text references public.gminy (id),
  -- Pola poniżej zmienia wyłącznie serwer (brak GRANT UPDATE dla klienta):
  total_xp bigint not null default 0,                    -- suma xp_events (trigger)
  level int not null default 1,
  xp_in_level int not null default 0,
  streak_days int not null default 0,
  last_active_date date,
  trips_count int not null default 0,
  mushrooms_count int not null default 0,
  total_distance_m bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,  -- zapraszający
  friend_id uuid not null references public.profiles (id) on delete cascade,                    -- zaproszony
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index friendships_friend_idx on public.friendships (friend_id);

create table public.gmina_follows (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  gmina_id text not null references public.gminy (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, gmina_id)
);

create table public.push_tokens (
  token text primary key,                                -- Expo push token
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyprawy, skany, znaleziska
-- ─────────────────────────────────────────────────────────────────────────────

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  gmina_id text not null references public.gminy (id),
  status public.trip_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_s int,
  distance_m int not null default 0,
  xp int not null default 0,
  hide_route boolean not null default false,
  route_public extensions.geometry(LineString, 4326),    -- uogólniona trasa (~200 m siatka) – tylko ona może trafić do feedu
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index trips_one_active_per_user on public.trips (user_id) where status = 'active';
create index trips_user_started_idx on public.trips (user_id, started_at desc);

-- PRYWATNE: surowy ślad GPS (tylko właściciel; nigdy nie publikowany).
create table public.trip_tracks (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  track extensions.geometry(LineString, 4326) not null,
  updated_at timestamptz not null default now()
);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  status public.scan_status not null default 'uploading',
  parts text[] not null default '{}',                    -- {cap, underside, stem, base}
  photo_paths text[] not null default '{}',              -- Storage: scan-photos/{user_id}/{scan_id}/…
  model_path text,                                       -- opcjonalny model 3D
  device jsonb,                                          -- telefon, wersja aplikacji
  created_at timestamptz not null default now()
);
create index scans_user_idx on public.scans (user_id, created_at desc);

-- Wynik rozpoznania (zapisuje Edge Function) – także do audytu jakości i kosztu modelu.
create table public.identifications (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans (id) on delete cascade,
  provider text not null,                                -- 'kindwise' | 'anthropic' | …
  model text not null,
  species_id text references public.species (id),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  candidates jsonb not null default '[]',                -- [{species_id, confidence}]
  dimensions jsonb,                                      -- {cap_cm, height_cm, weight_g, age_days, pieces}
  raw jsonb,
  latency_ms int,
  cost_usd numeric(10, 6),
  created_at timestamptz not null default now()
);
create index identifications_scan_idx on public.identifications (scan_id);

create table public.finds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  scan_id uuid references public.scans (id) on delete set null,
  identification_id uuid references public.identifications (id) on delete set null,
  species_id text not null references public.species (id),
  gmina_id text not null references public.gminy (id),
  rarity public.rarity not null,                         -- rzadkość okazu (może być wyższa niż gatunku)
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  xxl boolean not null default false,
  cap_cm numeric(5, 1),
  height_cm numeric(5, 1),
  weight_g int,
  age_days smallint,
  pieces smallint,
  collected boolean not null,                            -- false = gatunek trujący: tylko zdjęcie
  status public.find_status not null default 'pending',
  xp int not null default 0,
  reward jsonb,                                          -- rozpiska XP + poziom przed/po + odznaki (ekran Nagroda)
  personal_record boolean not null default false,
  found_at timestamptz not null default now(),
  claimed_at timestamptz,
  visible_from timestamptz,                              -- od kiedy wchodzi do statystyk publicznych
  created_at timestamptz not null default now()
);
create index finds_user_idx on public.finds (user_id, found_at desc);
create index finds_trip_idx on public.finds (trip_id);
create index finds_stats_idx on public.finds (gmina_id, species_id, found_at) where status = 'claimed';

-- PRYWATNE: dokładny punkt znaleziska („moje miejscówki”) – tylko właściciel.
create table public.find_locations (
  find_id uuid primary key references public.finds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  location extensions.geography(Point, 4326) not null,
  accuracy_m real
);

-- Księga XP – jedyne źródło prawdy dla poziomu, rankingów i „wkładu w gminę”.
create table public.xp_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  source public.xp_source not null,
  ref_id text,                                           -- id znaleziska / zadania / wyzwania
  gmina_id text references public.gminy (id),
  amount int not null,
  created_at timestamptz not null default now()
);
create index xp_events_user_idx on public.xp_events (user_id, created_at desc);
create index xp_events_gmina_idx on public.xp_events (gmina_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Atlas, odznaki, zadania, wyzwania
-- ─────────────────────────────────────────────────────────────────────────────

create table public.user_species (
  user_id uuid not null references public.profiles (id) on delete cascade,
  species_id text not null references public.species (id),
  count int not null default 0,
  first_found_at timestamptz not null,
  best_cap_cm numeric(5, 1),
  best_weight_g int,
  best_find_id uuid references public.finds (id) on delete set null,
  primary key (user_id, species_id)
);

create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id text not null references public.badges (id),
  earned_at timestamptz not null default now(),
  find_id uuid references public.finds (id) on delete set null,
  primary key (user_id, badge_id)
);

create table public.user_quests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id text not null references public.quest_templates (id),
  day date not null,
  progress numeric(8, 1) not null default 0,
  completed_at timestamptz,
  primary key (user_id, quest_id, day)
);

create table public.user_challenges (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.gmina_challenges (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  find_id uuid references public.finds (id) on delete set null,
  primary key (user_id, challenge_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Feed
-- ─────────────────────────────────────────────────────────────────────────────

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind public.post_kind not null,
  trip_id uuid unique references public.trips (id) on delete cascade,
  gmina_id text not null references public.gminy (id),
  route_precision public.route_precision not null default 'gmina',
  -- Migawka do wyświetlenia: {title, distance_km, duration_min, mushrooms, species, xp,
  --   highlight:{rarity, text, photo_path}, route: GeoJSON|null} albo {level, badge_name}
  payload jsonb not null,
  reactions_count int not null default 0,                -- „Darz grzyb!” (trigger)
  comments_count int not null default 0,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  visible_from timestamptz not null,                     -- inni widzą wpis dopiero od tej chwili
  deleted_at timestamptz
);
create index posts_feed_idx on public.posts (created_at desc) where deleted_at is null;
create index posts_gmina_idx on public.posts (gmina_id, created_at desc) where deleted_at is null;
create index posts_author_idx on public.posts (author_id, created_at desc);

create table public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rankingi gmin (liczone cronem z xp_events starszych niż privacy_delay)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.gmina_rankings (
  period public.ranking_period not null,
  period_start date not null,
  gmina_id text not null references public.gminy (id) on delete cascade,
  points bigint not null default 0,
  mushroomers int not null default 0,
  rank int not null,
  prev_rank int,
  computed_at timestamptz not null default now(),
  primary key (period, period_start, gmina_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggery
-- ─────────────────────────────────────────────────────────────────────────────

-- Nowe konto → profil.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, handle, display_name, first_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'handle', 'grzybiarz_' || substr(replace(new.id::text, '-', ''), 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'Grzybiarz'),
    new.raw_user_meta_data ->> 'first_name'
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Każdy wpis w księdze XP aktualizuje poziom w profilu.
create function public.apply_xp_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
begin
  update public.profiles set total_xp = total_xp + new.amount
   where id = new.user_id
   returning total_xp into v_total;
  update public.profiles p set level = l.level, xp_in_level = l.xp_in_level
    from public.level_from_total_xp(v_total) l
   where p.id = new.user_id;
  return new;
end $$;
create trigger xp_events_apply after insert on public.xp_events
  for each row execute function public.apply_xp_event();

-- Liczniki reakcji i komentarzy.
create function public.bump_post_counters() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d int := case when tg_op = 'INSERT' then 1 else -1 end;
  pid uuid := coalesce(new.post_id, old.post_id);
begin
  if tg_table_name = 'post_reactions' then
    update public.posts set reactions_count = greatest(0, reactions_count + d) where id = pid;
  else
    update public.posts set comments_count = greatest(0, comments_count + d) where id = pid;
  end if;
  return null;
end $$;
create trigger post_reactions_count after insert or delete on public.post_reactions
  for each row execute function public.bump_post_counters();
create trigger post_comments_count after insert or delete on public.post_comments
  for each row execute function public.bump_post_counters();

-- ─────────────────────────────────────────────────────────────────────────────
-- Logika gry (RPC wywoływane z aplikacji: supabase.rpc('…'))
-- ─────────────────────────────────────────────────────────────────────────────

-- GPS → gmina (granice z PRG). Współrzędne nie są nigdzie zapisywane.
create function public.gmina_at(lon double precision, lat double precision) returns text
language sql stable set search_path = public, extensions as $$
  select g.id from public.gminy g
   where g.boundary is not null and st_contains(g.boundary, st_setsrid(st_makepoint(lon, lat), 4326))
   limit 1
$$;

-- Wewnętrzna: postęp zadania dnia; przy ukończeniu wypłaca XP. Zwraca true, gdy właśnie ukończono.
create function public.bump_quest(p_user uuid, p_quest_id text, p_delta numeric, p_gmina_id text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  q public.quest_templates;
  uq public.user_quests;
begin
  select * into q from public.quest_templates where id = p_quest_id and active;
  if not found then return false; end if;
  insert into public.user_quests as t (user_id, quest_id, day, progress)
  values (p_user, p_quest_id, public.local_today(), least(p_delta, q.target))
  on conflict (user_id, quest_id, day)
    do update set progress = least(t.progress + p_delta, q.target)
    where t.completed_at is null
  returning * into uq;
  if uq is null or uq.completed_at is not null or uq.progress < q.target then
    return false;
  end if;
  update public.user_quests set completed_at = now()
   where user_id = p_user and quest_id = p_quest_id and day = uq.day;
  insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
  values (p_user, 'quest', p_quest_id, p_gmina_id, q.xp);
  return true;
end $$;

-- Wewnętrzna: sprawdza warunki odznak; zwraca nowo przyznane.
create function public.evaluate_badges(p_user uuid, p_find_id uuid default null) returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare
  b public.badges;
  ok boolean;
  granted text[] := '{}';
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

-- „Rozpocznij grzybobranie”: aktualizuje serię dni; zwraca aktywną wyprawę (idempotentnie).
create function public.start_trip(p_gmina_id text) returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_today date := public.local_today();
  t public.trips;
  pr public.profiles;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into t from public.trips where user_id = v_uid and status = 'active';
  if found then return t; end if;
  select * into pr from public.profiles where id = v_uid for update;
  if pr.last_active_date is distinct from v_today then
    update public.profiles
       set streak_days = case when pr.last_active_date = v_today - 1 then pr.streak_days + 1 else 1 end,
           last_active_date = v_today
     where id = v_uid;
  end if;
  insert into public.trips (user_id, gmina_id) values (v_uid, p_gmina_id) returning * into t;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

-- Okresowo z telefonu (np. co minutę): dystans narastająco → zadanie „Przejdź 5 km”.
create function public.report_trip_progress(p_trip_id uuid, p_distance_m int) returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
  v_delta int;
  q record;
begin
  select * into t from public.trips where id = p_trip_id and user_id = v_uid and status = 'active' for update;
  if not found then raise exception 'trip_not_active' using errcode = 'P0002'; end if;
  v_delta := greatest(0, p_distance_m - t.distance_m);
  if v_delta = 0 then return t; end if;
  update public.trips set distance_m = p_distance_m where id = t.id returning * into t;
  update public.profiles set total_distance_m = total_distance_m + v_delta where id = v_uid;
  for q in select id from public.quest_templates where active and kind = 'distance' loop
    perform public.bump_quest(v_uid, q.id, v_delta / 1000.0, t.gmina_id);
  end loop;
  perform public.evaluate_badges(v_uid);
  return t;
end $$;

-- „Odbierz nagrodę” / „Zapisz w atlasie”. Zwraca dane ekranu Nagroda (idempotentnie).
create function public.claim_find(p_find_id uuid) returns jsonb
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
  v_reward jsonb;
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

  if v_after.level > v_before.level then
    insert into public.posts (author_id, kind, gmina_id, payload, visible_from)
    values (v_uid, 'levelup', f.gmina_id, jsonb_build_object('level', v_after.level), now() + public.privacy_delay());
  end if;

  v_reward := jsonb_build_object(
    'xp', jsonb_build_object('lines', v_lines, 'total', v_total),
    'levelBefore', v_before.level, 'xpBefore', v_before.xp_in_level,
    'levelAfter', v_after.level, 'xpAfter', v_after.xp_in_level,
    'unlockedBadgeIds', to_jsonb(v_badges),
    'completedQuestIds', to_jsonb(v_quests),
    'completedChallengeIds', to_jsonb(v_challenges),
    'personalRecord', v_record
  );
  update public.finds set reward = v_reward where id = f.id;
  return v_reward;
end $$;

-- „Zakończ wyprawę”: zapisuje ślad (prywatnie) i uogólnioną trasę; znaleziska wejdą do statystyk po opóźnieniu.
create function public.finish_trip(p_trip_id uuid, p_distance_m int, p_duration_s int, p_track_geojson text default null)
returns public.trips
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  t public.trips;
  v_track geometry;
begin
  select * into t from public.trips where id = p_trip_id and user_id = v_uid and status = 'active';
  if not found then raise exception 'trip_not_active' using errcode = 'P0002'; end if;
  t := public.report_trip_progress(p_trip_id, p_distance_m);

  if p_track_geojson is not null then
    v_track := st_force2d(st_setsrid(st_geomfromgeojson(p_track_geojson), 4326));
    insert into public.trip_tracks (trip_id, user_id, track) values (t.id, v_uid, v_track)
    on conflict (trip_id) do update set track = excluded.track, updated_at = now();
    -- Publiczna trasa: uproszczona i przyciągnięta do siatki ~200 m – bez miejscówek.
    update public.trips
       set route_public = st_snaptogrid(st_simplifypreservetopology(v_track, 0.001), 0.002)
     where id = t.id;
  end if;

  update public.trips
     set status = 'finished', ended_at = now(), duration_s = p_duration_s
   where id = t.id
   returning * into t;
  update public.finds set visible_from = t.ended_at + public.privacy_delay()
   where trip_id = t.id and status = 'claimed';
  update public.finds set status = 'discarded' where trip_id = t.id and status = 'pending';
  update public.profiles set trips_count = trips_count + 1 where id = v_uid;
  return t;
end $$;

-- „Opublikuj w feedzie”: wpis widoczny dla innych dopiero po privacy_delay().
create function public.publish_trip(p_trip_id uuid, p_hide_route boolean, p_title text default null)
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
  select * into t from public.trips where id = p_trip_id and user_id = v_uid for update;
  if not found then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if t.status = 'published' then
    select * into p from public.posts where trip_id = t.id;
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
    v_uid, 'trip', t.id, t.gmina_id,
    (case when p_hide_route or t.route_public is null then 'gmina' else 'approximate' end)::public.route_precision,
    jsonb_build_object(
      'title', coalesce(nullif(trim(p_title), ''), 'Wyprawa po grzyby'),
      'distance_km', round(t.distance_m / 1000.0, 1),
      'duration_min', coalesce(t.duration_s, 0) / 60,
      'mushrooms', v_mushrooms,
      'species', v_species,
      'xp', t.xp,
      'highlight', case when v_best is null then null else jsonb_build_object(
        'rarity', v_best.rarity, 'species', v_best.name, 'weight_g', v_best.weight_g, 'cap_cm', v_best.cap_cm) end,
      'route', case when p_hide_route or t.route_public is null then null else st_asgeojson(t.route_public)::jsonb end
    ),
    now() + public.privacy_delay()
  )
  returning * into p;
  update public.trips set status = 'published', hide_route = p_hide_route where id = t.id;
  return p;
end $$;

-- Feed z autorem i flagą „reagowałem”. SECURITY INVOKER → obowiązuje RLS na posts (visible_from).
create function public.get_feed(p_scope text default 'friends', p_before timestamptz default null, p_limit int default 20)
returns table (
  id uuid, kind public.post_kind, author_id uuid, author_handle text, author_name text, author_level int,
  gmina_id text, route_precision public.route_precision, payload jsonb, reactions_count int, comments_count int,
  created_at timestamptz, visible_from timestamptz, reacted boolean, mine boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, p.kind, p.author_id, pr.handle::text, pr.display_name, pr.level,
         p.gmina_id, p.route_precision, p.payload, p.reactions_count, p.comments_count,
         p.created_at, p.visible_from,
         exists (select 1 from public.post_reactions r where r.post_id = p.id and r.user_id = (select auth.uid())),
         p.author_id = (select auth.uid())
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
   where p.deleted_at is null
     and (p_before is null or p.created_at < p_before)
     and case p_scope
           when 'friends' then
             p.author_id = (select auth.uid())
             or exists (
               select 1 from public.friendships fr
                where fr.status = 'accepted'
                  and ((fr.user_id = (select auth.uid()) and fr.friend_id = p.author_id)
                    or (fr.friend_id = (select auth.uid()) and fr.user_id = p.author_id)))
           when 'gmina' then
             p.gmina_id = (select home_gmina_id from public.profiles where id = (select auth.uid()))
           else false
         end
   order by p.created_at desc
   limit least(greatest(p_limit, 1), 50)
$$;

create function public.toggle_reaction(p_post_id uuid, out reacted boolean, out reactions int)
language plpgsql security invoker set search_path = public, extensions as $$
begin
  delete from public.post_reactions where post_id = p_post_id and user_id = auth.uid();
  if found then
    reacted := false;
  else
    insert into public.post_reactions (post_id) values (p_post_id);
    reacted := true;
  end if;
  select reactions_count into reactions from public.posts where id = p_post_id;
end $$;

-- ─── Statystyki publiczne: wyłącznie agregaty z danych starszych niż visible_from ───

-- Karta „W gminie X w tym sezonie” + notka na ekranie Nagroda.
create function public.species_percentile(p_species_id text, p_gmina_id text, p_weight_g int)
returns table (collected bigint, mushroomers bigint, size_rank bigint, percentile int)
language sql stable security definer set search_path = public, extensions as $$
  with season as (
    select f.user_id, f.weight_g
      from public.finds f
     where f.species_id = p_species_id and f.gmina_id = p_gmina_id and f.status = 'claimed'
       and f.visible_from <= now()
       and f.found_at >= date_trunc('year', now())
  )
  select count(*),
         count(distinct user_id),
         1 + count(*) filter (where weight_g > p_weight_g),
         coalesce(round(100.0 * count(*) filter (where weight_g < p_weight_g) / nullif(count(*), 0))::int, 50)
    from season
$$;

-- Nagłówek ekranu Gmina: grzybiarze, grzyby, gatunki w sezonie + pozycja w tygodniowym rankingu.
create function public.gmina_stats(p_gmina_id text)
returns table (mushroomers bigint, mushrooms bigint, species bigint, rank int)
language sql stable security definer set search_path = public, extensions as $$
  select count(distinct f.user_id),
         count(*) filter (where f.collected),
         count(distinct f.species_id),
         (select r.rank from public.gmina_rankings r
           where r.period = 'week' and r.gmina_id = p_gmina_id
           order by r.period_start desc limit 1)
    from public.finds f
   where f.gmina_id = p_gmina_id and f.status = 'claimed'
     and f.visible_from <= now() and f.found_at >= date_trunc('year', now())
$$;

-- „Rekordy gminy”: najlepszy okaz w każdej rzadkości (data zaokrąglona do dnia).
create function public.gmina_records(p_gmina_id text, p_limit int default 3)
returns table (rarity public.rarity, species_name text, weight_g int, cap_cm numeric, author_handle text, found_on date)
language sql stable security definer set search_path = public, extensions as $$
  select * from (
    select distinct on (f.rarity) f.rarity, s.name, f.weight_g, f.cap_cm, pr.handle::text, f.found_at::date
      from public.finds f
      join public.species s on s.id = f.species_id
      join public.profiles pr on pr.id = f.user_id
     where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.collected
       and f.visible_from <= now() and f.found_at >= date_trunc('year', now())
     order by f.rarity desc, f.weight_g desc nulls last
  ) best
  order by best.rarity desc
  limit p_limit
$$;

-- „Co tu się zbiera”: udział gatunków w sezonie.
create function public.gmina_species_share(p_gmina_id text, p_limit int default 4)
returns table (species_name text, pct int)
language sql stable security definer set search_path = public, extensions as $$
  with c as (
    select s.name, count(*) n
      from public.finds f join public.species s on s.id = f.species_id
     where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.collected
       and f.visible_from <= now() and f.found_at >= date_trunc('year', now())
     group by s.name
  ), total as (select sum(n) t from c), ranked as (
    select name, n, row_number() over (order by n desc) rn from c
  )
  select name, round(100.0 * n / t)::int from ranked, total where rn <= p_limit
  union all
  select 'Inne', round(100.0 * sum(n) / max(t))::int from ranked, total where rn > p_limit having count(*) > 0
$$;

-- Cron (co godzinę): rankingi tygodnia, sezonu i rekordów z XP starszych niż privacy_delay().
create function public.refresh_gmina_rankings() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_week date := date_trunc('week', now() at time zone 'Europe/Warsaw')::date;
  v_season date := date_trunc('year', now() at time zone 'Europe/Warsaw')::date;
  v_cutoff timestamptz := now() - public.privacy_delay();
begin
  delete from public.gmina_rankings where period_start in (v_week, v_season) and period in ('week', 'season', 'records');

  insert into public.gmina_rankings (period, period_start, gmina_id, points, mushroomers, rank)
  select 'week', v_week, e.gmina_id, sum(e.amount), count(distinct e.user_id), rank() over (order by sum(e.amount) desc)
    from public.xp_events e
   where e.gmina_id is not null and e.created_at >= v_week and e.created_at < v_cutoff
   group by e.gmina_id;

  insert into public.gmina_rankings (period, period_start, gmina_id, points, mushroomers, rank)
  select 'season', v_season, e.gmina_id, sum(e.amount), count(distinct e.user_id), rank() over (order by sum(e.amount) desc)
    from public.xp_events e
   where e.gmina_id is not null and e.created_at >= v_season and e.created_at < v_cutoff
   group by e.gmina_id;

  insert into public.gmina_rankings (period, period_start, gmina_id, points, mushroomers, rank)
  select 'records', v_season, f.gmina_id, count(*), count(distinct f.user_id), rank() over (order by count(*) desc)
    from public.finds f
   where f.status = 'claimed' and f.rarity in ('epicki', 'legendarny')
     and f.found_at >= v_season and f.visible_from <= now()
   group by f.gmina_id;

  update public.gmina_rankings r set prev_rank = p.rank
    from public.gmina_rankings p
   where r.period = 'week' and r.period_start = v_week
     and p.period = 'week' and p.period_start = v_week - 7 and p.gmina_id = r.gmina_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.forest_regions enable row level security;
alter table public.gminy enable row level security;
alter table public.species enable row level security;
alter table public.species_lookalikes enable row level security;
alter table public.badges enable row level security;
alter table public.quest_templates enable row level security;
alter table public.gmina_challenges enable row level security;
alter table public.gmina_forecasts enable row level security;
alter table public.gmina_rankings enable row level security;
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.gmina_follows enable row level security;
alter table public.push_tokens enable row level security;
alter table public.trips enable row level security;
alter table public.trip_tracks enable row level security;
alter table public.scans enable row level security;
alter table public.identifications enable row level security;
alter table public.finds enable row level security;
alter table public.find_locations enable row level security;
alter table public.xp_events enable row level security;
alter table public.user_species enable row level security;
alter table public.user_badges enable row level security;
alter table public.user_quests enable row level security;
alter table public.user_challenges enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;

-- Słowniki: odczyt dla każdego.
create policy "slownik: odczyt" on public.forest_regions for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.gminy for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.species for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.species_lookalikes for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.badges for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.quest_templates for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.gmina_challenges for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.gmina_forecasts for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.gmina_rankings for select to anon, authenticated using (true);

-- Profile: publiczny odczyt (nick, poziom, avatar); edycja tylko własnego, tylko kolumny z GRANT niżej.
create policy "profil: odczyt" on public.profiles for select to authenticated using (true);
create policy "profil: edycja wlasnego" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Znajomi: widzę relacje, w których biorę udział; zapraszam jako user_id; akceptuje zaproszony.
create policy "znajomi: odczyt" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_id, friend_id));
create policy "znajomi: zaproszenie" on public.friendships for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
create policy "znajomi: akceptacja" on public.friendships for update to authenticated
  using (friend_id = (select auth.uid())) with check (friend_id = (select auth.uid()));
create policy "znajomi: usuniecie" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_id, friend_id));

create policy "obserwowane: wlasne" on public.gmina_follows for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push: wlasne" on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Dane wypraw: wyłącznie właściciel (zapisy przez RPC).
create policy "wyprawy: wlasne" on public.trips for select to authenticated using (user_id = (select auth.uid()));
create policy "slad: wlasny" on public.trip_tracks for select to authenticated using (user_id = (select auth.uid()));
create policy "skany: odczyt wlasnych" on public.scans for select to authenticated using (user_id = (select auth.uid()));
create policy "skany: nowy" on public.scans for insert to authenticated with check (user_id = (select auth.uid()));
create policy "skany: zdjecia" on public.scans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "rozpoznania: wlasne" on public.identifications for select to authenticated
  using (exists (select 1 from public.scans s where s.id = scan_id and s.user_id = (select auth.uid())));
create policy "znaleziska: wlasne" on public.finds for select to authenticated using (user_id = (select auth.uid()));
create policy "miejscowki: wlasne" on public.find_locations for select to authenticated using (user_id = (select auth.uid()));
create policy "xp: wlasne" on public.xp_events for select to authenticated using (user_id = (select auth.uid()));
create policy "atlas: wlasny" on public.user_species for select to authenticated using (user_id = (select auth.uid()));
create policy "odznaki: odczyt" on public.user_badges for select to authenticated using (true);
create policy "zadania: wlasne" on public.user_quests for select to authenticated using (user_id = (select auth.uid()));
create policy "wyzwania: odczyt wlasnych" on public.user_challenges for select to authenticated
  using (user_id = (select auth.uid()));
create policy "wyzwania: przyjecie" on public.user_challenges for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.gmina_challenges c
                 where c.id = challenge_id and c.active and (c.ends_at is null or c.ends_at > now()))
  );
create policy "wyzwania: rezygnacja" on public.user_challenges for delete to authenticated
  using (user_id = (select auth.uid()) and completed_at is null);

-- Feed: własne zawsze; cudze dopiero od visible_from.
create policy "posty: odczyt" on public.posts for select to authenticated
  using (author_id = (select auth.uid()) or (visible_from <= now() and deleted_at is null));
create policy "posty: usuniecie wlasnego" on public.posts for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy "reakcje: odczyt" on public.post_reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "reakcje: dodanie" on public.post_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy "reakcje: cofniecie" on public.post_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "komentarze: odczyt" on public.post_comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "komentarze: dodanie" on public.post_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy "komentarze: usuniecie wlasnego" on public.post_comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia: najpierw nic, potem jawnie (service_role omija RLS – Edge Functions, cron)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

grant select on public.forest_regions, public.gminy, public.species, public.species_lookalikes, public.badges,
  public.quest_templates, public.gmina_challenges, public.gmina_forecasts, public.gmina_rankings
  to anon, authenticated;

grant select on public.profiles, public.friendships, public.gmina_follows, public.push_tokens, public.trips,
  public.trip_tracks, public.scans, public.identifications, public.finds, public.find_locations, public.xp_events,
  public.user_species, public.user_badges, public.user_quests, public.user_challenges, public.posts,
  public.post_reactions, public.post_comments
  to authenticated;

grant update (handle, display_name, first_name, avatar_path, home_gmina_id) on public.profiles to authenticated;
grant insert (friend_id), update (status), delete on public.friendships to authenticated;
grant insert (gmina_id), delete on public.gmina_follows to authenticated;
grant insert (token, platform), delete on public.push_tokens to authenticated;
grant insert (id, trip_id, parts, photo_paths, device), update (parts, photo_paths) on public.scans to authenticated;
grant insert (challenge_id), delete on public.user_challenges to authenticated;
grant update (deleted_at) on public.posts to authenticated;
grant insert (post_id), delete on public.post_reactions to authenticated;
grant insert (post_id, body), delete on public.post_comments to authenticated;

grant execute on function
  public.rarity_base(public.rarity),
  public.rarity_rank(public.rarity),
  public.level_threshold(int),
  public.level_from_total_xp(bigint),
  public.privacy_delay(),
  public.local_today(),
  public.gmina_at(double precision, double precision),
  public.start_trip(text),
  public.report_trip_progress(uuid, int),
  public.claim_find(uuid),
  public.finish_trip(uuid, int, int, text),
  public.publish_trip(uuid, boolean, text),
  public.get_feed(text, timestamptz, int),
  public.toggle_reaction(uuid),
  public.species_percentile(text, text, int),
  public.gmina_stats(text),
  public.gmina_records(text, int),
  public.gmina_species_share(text, int)
  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage
--   avatars      publiczny odczyt, zapis do własnego folderu {user_id}/…
--   scan-photos  prywatny: {user_id}/{scan_id}/{część}.jpg – tylko właściciel (+ Edge Function)
--   post-media   publiczny odczyt; zapisuje wyłącznie serwer przy publikacji (nieodgadywalne ścieżki)
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('scan-photos', 'scan-photos', false),
  ('post-media', 'post-media', true)
on conflict (id) do nothing;

create policy "avatars: zapis wlasnego" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: podmiana wlasnego" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "skany: zapis wlasnych" on storage.objects for insert to authenticated
  with check (bucket_id = 'scan-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "skany: odczyt wlasnych" on storage.objects for select to authenticated
  using (bucket_id = 'scan-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Cron (włącz rozszerzenie pg_cron w Dashboard → Database → Extensions, potem uruchom raz):
--   select cron.schedule('rankingi-gmin', '7 * * * *', $$select public.refresh_gmina_rankings()$$);
