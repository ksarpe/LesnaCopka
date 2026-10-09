-- =============================================================================
-- Rywalizacja – walki o okaz, pojedynki ze znajomymi, ranking grzybiarzy, trofea (docs/rywalizacja.md §2–§5, §7)
--
--  · Kontrakt odpowiedzi: typy TS z src/types.ts (sekcja „Rywalizacja”) – jsonb w camelCase, czasy iso_ts(); autorzy
--    (author / user / actor) to surowe author_json(uid) – aplikacja mapuje je jak w feedzie.
--  · Tabele bez dostępu klientów (RLS bez polityk, bez GRANT) – wszystko przez RPC security definer:
--      contests          walki tygodnia (3 na tydzień), tworzone leniwie przy odczycie (ensure_contest_week)
--      contest_entries   zgłoszone okazy (jeden aktywny / w weryfikacji na gracza i walkę; migawka wyniku)
--      contest_reports   zgłoszenia społeczności („Zgłoś okaz”)
--      contest_awards    podia (trofea) po rozstrzygnięciu; XP – tylko najwyższa nagroda gracza w walce
--      contest_overtakes pierwsza obserwacja wyprzedzenia (aktywność contest_overtaken – stały czas i miejsce)
--      duels             pojedynki znajomych (id z telefonu)
--      duel_rewards      nagrodzone pojedynki – limity przeciw farmom (nie znikają z kontem przeciwnika)
--      rivalry_public_photos / rivalry_duel_photos   ścieżki zdjęć czytelnych dla innych (+ private.rivalry_photo_paths)
--      rivalry_params    progi rywalizacji (jak anti_cheat_params: nowe klucze – insert … on conflict do update)
--    + profiles.show_in_rankings (Ustawienia → Prywatność; zapis tylko przez set_ranking_visibility).
--  · Rozstrzyganie leniwe (jak ensure_rankings_fresh): walki po results_at (koniec tygodnia + 48 h) – przy każdym odczycie
--    rywalizacji i aktywności (ensure_contests_final); pojedynki po ends_at + rivalry_queue_grace_h – przy odczycie
--    pojedynków gracza (settle_duels). XP: księga xp_events (źródła 'contest' / 'duel'), idempotentnie. Podium tylko dla
--    okazów publicznych ≥ 24 h przed wynikami; gmina / województwo – z gminą z serwera; okaz z podium w weryfikacji
--    wstrzymuje rozstrzygnięcie (najwyżej 7 dni); tablica rozstrzygniętej walki = migawka (final_rank_*).
--  · Wydajność: gracze poza rywalizacją zbiorowo (rivalry_ineligible_users – lustro competition_eligible) i anty-złączenia
--    zamiast funkcji na wiersz; miejsca na tablicach globalne (blokady widza tylko ukrywają wiersze).
--  · Prywatność: cudze okazy na tablicach po finds.visible_from (24 h; najpóźniej 48 h po znalezieniu – rivalry_visible_at),
--    także w zasięgu znajomych (zdjęcie i gmina są
--    wtedy i tak publiczne); własny zawsze. Ukryci (show_in_rankings = false) – tylko w zasięgu znajomych; poza
--    rywalizacją (competition_eligible = false) – widzi siebie, inni nie; blokady w obie strony; okaz w weryfikacji
--    widzi tylko autor. Ranking grzybiarzy: zasięgi publiczne z XP starszych niż 24 h, znajomi na żywo.
--  · Zdjęcia: polityka Storage SELECT na scan-photos dla zgłoszonych, widocznych okazów i najlepszych okazów pojedynków
--    „największy okaz” uczestnika (rivalry_photo_readable). Adres podpisuje klient (createSignedUrl).
--  · Narzędzia deweloperskie (dev_tools): dev_seed_rivalry, dev_rivalry_act, dev_finalize_rivalry – EXECUTE tylko z seeda
--    lokalnego (migracja go nie nadaje, jak inne dev_*).
--  · wipe_rivalry_data / export_rivalry_data – podpięte w 20261015120000_rywalizacja_konto.sql.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Progi rywalizacji (tabela – zmiana bez przepisywania funkcji)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rivalry_params (
  k text primary key check (k ~ '^[a-z][a-z0-9_]{0,63}$'),
  v numeric not null,
  note text
);
alter table public.rivalry_params enable row level security;
-- Brak polityk: klient nie czyta progów (tylko funkcje serwera; zmiana – migracja albo service_role / Studio).

insert into public.rivalry_params (k, v, note) values
  ('rivalry_queue_grace_h', 6, 'znalezisko z kolejki offline liczy się, gdy dotarło (created_at) najwyżej tyle po końcu okna'),
  -- walki o okaz
  ('contest_results_delay_h', 48, 'rozstrzygnięcie walki: koniec tygodnia + tyle (24 h prywatności + czas na zgłoszenia)'),
  ('contest_min_gmina', 3, 'podium gminy od tylu uczestników'),
  ('contest_min_wojewodztwo', 5, 'podium województwa od tylu uczestników'),
  ('contest_min_polska', 10, 'podium Polski od tylu uczestników'),
  ('contest_xp_polska_1', 500, 'XP: Polska, 1. miejsce'),
  ('contest_xp_polska_2', 300, 'XP: Polska, 2. miejsce'),
  ('contest_xp_polska_3', 150, 'XP: Polska, 3. miejsce'),
  ('contest_xp_wojewodztwo_1', 250, 'XP: województwo, 1. miejsce'),
  ('contest_xp_wojewodztwo_2', 150, 'XP: województwo, 2. miejsce'),
  ('contest_xp_wojewodztwo_3', 75, 'XP: województwo, 3. miejsce'),
  ('contest_xp_gmina_1', 100, 'XP: gmina, 1. miejsce'),
  ('contest_xp_gmina_2', 60, 'XP: gmina, 2. miejsce'),
  ('contest_xp_gmina_3', 30, 'XP: gmina, 3. miejsce'),
  ('contest_report_threshold', 3, 'tylu różnych zgłaszających (konta zabezpieczone) → okaz w weryfikacji'),
  ('contest_report_per_day', 30, 'zgłoszenia okazów na dobę (czas serwera) – jak report_post_per_day'),
  ('contest_report_min_account_days', 7, 'zgłoszenie liczy się do progu, gdy konto zgłaszającego ma co najmniej tyle dni'),
  ('contest_public_before_results_h', 24,
   'okaz walczy o podium, gdy był publiczny (widoczny dla innych i nieukryty) co najmniej tyle godzin przed results_at'),
  ('contest_review_max_delay_h', 168, 'okaz z podium w weryfikacji wstrzymuje rozstrzygnięcie najwyżej tyle godzin po results_at'),
  ('contest_history_weeks', 52, 'walki tygodni tworzone leniwie najwyżej tyle tygodni wstecz (starsze → contest_not_found)'),
  -- pojedynki
  ('duel_invite_h', 48, 'zaproszenie do pojedynku wygasa po tylu godzinach'),
  ('duel_max_open', 3, 'najwyżej tyle aktywnych + oczekujących pojedynków gracza'),
  ('duel_per_day', 5, 'nowe wyzwania gracza na dobę (czas serwera)'),
  ('duel_xp_win', 100, 'XP za wygraną'),
  ('duel_xp_draw', 30, 'XP za remis (każdemu)'),
  ('duel_rewarded_per_week', 3, 'najwyżej tyle nagrodzonych pojedynków gracza na tydzień (wg końca pojedynku)'),
  ('duel_rewarded_pair_per_week', 1, 'najwyżej tyle nagrodzonych pojedynków danej pary graczy na tydzień')
on conflict (k) do update set v = excluded.v, note = excluded.note;

-- Nieznany klucz → null. stable: zmiana progu w tabeli działa od razu.
create or replace function public.rivalry_param(p_key text) returns numeric
language sql stable set search_path = '' as $$
  select p.v from public.rivalry_params p where p.k = p_key
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

-- Widoczność w rankingach grzybiarzy i na tablicach walk w zasięgach publicznych (zapis: set_ranking_visibility).
alter table public.profiles add column if not exists show_in_rankings boolean not null default true;

-- Walki tygodnia: '{pon}:okaz' (sort 0) i dwa gatunki tygodnia '{pon}:{gatunek}' (sort 1, 2).
create table if not exists public.contests (
  id text primary key check (id ~ '^\d{4}-\d{2}-\d{2}:[a-z0-9-]+$'),
  week_start date not null,                               -- poniedziałek (Europe/Warsaw)
  sort smallint not null,
  kind text not null check (kind in ('relative', 'species')),
  species_id text references public.species (id),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  results_at timestamptz not null,
  finalized_at timestamptz,                               -- rozstrzygnięta (podia, XP)
  next_check_at timestamptz,                              -- rozstrzygnięcie odłożone (okaz z podium w weryfikacji)
  created_at timestamptz not null default now(),
  unique (week_start, sort),
  check ((kind = 'species') = (species_id is not null))
);
create index if not exists contests_due_idx on public.contests (results_at) where finalized_at is null;

-- Zgłoszone okazy. Migawka wyniku przy zgłoszeniu (gatunek, gmina, kapelusz, %, czas) – tablica nie zależy od późniejszych
-- zmian słownika; visible_from i photo_path czytane na bieżąco ze znaleziska.
create table if not exists public.contest_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id text not null references public.contests (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  find_id uuid not null references public.finds (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'review', 'withdrawn', 'rejected')),
  species_id text not null references public.species (id),
  gmina_id text not null references public.gminy (id),
  cap_cm numeric(5, 1) not null,
  relative_pct numeric(7, 1) not null,
  score numeric(7, 1) not null,                           -- cap_cm (species) albo relative_pct (relative)
  found_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,                                -- moderacja (admin_review_contest_entry)
  review_note text check (review_note is null or char_length(review_note) <= 500),
  shown_since timestamptz,                                -- od kiedy autor nie jest ukryty (null – ukryty); okno przed results_at
  final_rank_gmina int,                                   -- migawka miejsc przy rozstrzygnięciu (finaliści; gmina / województwo
  final_rank_wojewodztwo int,                             --   tylko z gminą serwera) – tablica rozstrzygniętej walki
  final_rank_polska int
);
create unique index if not exists contest_entries_one_per_user
  on public.contest_entries (contest_id, user_id) where status in ('active', 'review');
create index if not exists contest_entries_board_idx on public.contest_entries (contest_id, score desc) where status = 'active';
create index if not exists contest_entries_user_idx on public.contest_entries (user_id, created_at desc);
create index if not exists contest_entries_find_idx on public.contest_entries (find_id, status);
create index if not exists contest_entries_user_active_idx on public.contest_entries (user_id, contest_id) where status = 'active';

create table if not exists public.contest_reports (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.contest_entries (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null default 'other' check (reason in ('reproduction', 'wrong_species', 'other')),
  created_at timestamptz not null default now(),
  unique (entry_id, reporter_id)
);
create index if not exists contest_reports_reporter_idx on public.contest_reports (reporter_id, created_at);

-- Podia (trofea). Gracz ma w walce najwyżej jedno podium na zasięg; XP > 0 tylko przy najwyższej nagrodzie.
create table if not exists public.contest_awards (
  id uuid primary key default gen_random_uuid(),
  contest_id text not null references public.contests (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  entry_id uuid references public.contest_entries (id) on delete set null,
  find_id uuid references public.finds (id) on delete set null,
  scope text not null check (scope in ('gmina', 'wojewodztwo', 'polska')),
  scope_id text,                                          -- gmina (slug) / województwo; null – Polska
  scope_name text not null,
  place smallint not null check (place between 1 and 3),
  species_id text not null references public.species (id),
  cap_cm numeric(5, 1) not null,
  score numeric(7, 1) not null,
  xp int not null default 0 check (xp >= 0),
  awarded_at timestamptz not null default now(),
  unique (contest_id, user_id, scope)
);
create index if not exists contest_awards_user_idx on public.contest_awards (user_id, awarded_at desc);

-- Pojedynki. Wyniki i najlepsze okazy zapisane przy rozstrzygnięciu (finished); wcześniej liczone na żywo.
create table if not exists public.duels (
  id uuid primary key,                                    -- z telefonu (ponowienie nie dubluje)
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('biggest', 'count', 'species')),
  days smallint not null check (days in (1, 3, 7)),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'finished', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,                        -- zaproszenie
  responded_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  closed_at timestamptz,                                  -- finished / declined / cancelled / expired
  challenger_score numeric(7, 1),
  opponent_score numeric(7, 1),
  challenger_best uuid references public.finds (id) on delete set null,
  opponent_best uuid references public.finds (id) on delete set null,
  winner_id uuid,                                         -- null przy finished = remis
  challenger_xp int,
  opponent_xp int,
  check (challenger_id <> opponent_id)
);
create unique index if not exists duels_pair_open_uidx
  on public.duels (least(challenger_id, opponent_id), greatest(challenger_id, opponent_id)) where status in ('pending', 'active');
create index if not exists duels_challenger_idx on public.duels (challenger_id, created_at desc);
create index if not exists duels_opponent_idx on public.duels (opponent_id, created_at desc);
create index if not exists duels_open_idx on public.duels (ends_at) where status in ('pending', 'active');

-- Nagrodzone pojedynki – księga limitów przeciw farmom (gracz / para na tydzień końca pojedynku). Niezależna od duels:
-- usunięcie konta przeciwnika (wipe_rivalry_data kasuje jego pojedynki) nie odnawia limitu gracza ani pary.
create table if not exists public.duel_rewards (
  duel_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  opponent_id uuid not null,                              -- bez FK: wpis zostaje po usunięciu konta przeciwnika
  week_start date not null,
  xp int not null check (xp > 0),
  created_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);
create index if not exists duel_rewards_user_week_idx on public.duel_rewards (user_id, week_start);

-- Zdjęcia czytelne dla innych (polityka Storage – wyszukiwanie po ścieżce, bez przeglądania walk):
--  · rivalry_public_photos – zdjęcie znaleziska z aktywnym okazem w walce (utrzymywane przy zgłoszeniu, zastąpieniu,
--    wycofaniu, weryfikacji, odrzuceniu); widoczność, ukrycie, blokady i dopuszczenie sprawdza polityka przy trafieniu;
--  · rivalry_duel_photos – zdjęcie najlepszego okazu strony pojedynku „największy okaz” dla przeciwnika (viewer).
create table if not exists public.rivalry_public_photos (
  path text primary key,
  owner uuid not null references public.profiles (id) on delete cascade,
  find_id uuid not null references public.finds (id) on delete cascade
);
create index if not exists rivalry_public_photos_find_idx on public.rivalry_public_photos (find_id);
create table if not exists public.rivalry_duel_photos (
  duel_id uuid not null references public.duels (id) on delete cascade,
  viewer uuid not null references public.profiles (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  path text not null,
  primary key (path, viewer, duel_id)
);
create index if not exists rivalry_duel_photos_duel_idx on public.rivalry_duel_photos (duel_id);

-- Wyprzedzenia w walkach (aktywność contest_overtaken): pierwsza obserwacja przez serwer – stały czas powiadomienia
-- (zawsze po poprzednim odczycie aktywności) i moje miejsce w tej chwili.
create table if not exists public.contest_overtakes (
  entry_id uuid not null references public.contest_entries (id) on delete cascade,
  other_entry_id uuid not null references public.contest_entries (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  rank int not null,
  primary key (entry_id, other_entry_id)
);
create index if not exists contest_overtakes_user_idx on public.contest_overtakes (user_id, seen_at desc);

-- Ranking grzybiarzy czyta księgę XP po czasie (także XP pojedynków bez gminy); konta w usuwaniu – anty-złączenie.
create index if not exists xp_events_rivalry_idx on public.xp_events (created_at)
  where source in ('find', 'challenge', 'contest', 'duel');
create index if not exists profiles_deleted_idx on public.profiles (id) where deleted_at is not null;

alter table public.contests enable row level security;
alter table public.contest_entries enable row level security;
alter table public.contest_reports enable row level security;
alter table public.contest_awards enable row level security;
alter table public.duels enable row level security;
alter table public.duel_rewards enable row level security;
alter table public.rivalry_public_photos enable row level security;
alter table public.rivalry_duel_photos enable row level security;
alter table public.contest_overtakes enable row level security;
-- Brak polityk: klient nie czyta i nie zapisuje tabel rywalizacji wprost (tylko RPC poniżej).

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Gracze poza rywalizacją – zbiorowo, jednym zapytaniem (anty-złączenia w tablicach, rozstrzygnięciu, rankingu
-- i aktywności zamiast competition_eligible na każdy wiersz). Lustro competition_eligible z 20261015103000_uszczelnienia.sql:
-- konto w usuwaniu, aktywny status review / banned, co najmniej competition_flag_hits incydentów (wierszy flag) wagi 3
-- poza rate_limited w oknie competition_flag_window_d i po ostatnim „ok” moderatora. Zmiana competition_eligible wymaga
-- zmiany tutaj (test zgodności w scripts/db-tests/30-rywalizacja.mjs).
create or replace function public.rivalry_ineligible_users() returns table (user_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select p.id from public.profiles p where p.deleted_at is not null
  union
  select s.user_id from public.player_standing s where s.status <> 'ok' and (s.until is null or s.until > now())
  union
  select f.user_id
    from public.anti_cheat_flags f
    left join public.player_standing ok on ok.user_id = f.user_id and ok.status = 'ok'
   where f.severity >= 3 and f.kind <> 'rate_limited'
     and f.last_at > now() - make_interval(days => public.anti_cheat_param('competition_flag_window_d')::int)
     and f.last_at > coalesce(ok.updated_at, '-infinity'::timestamptz)
   group by f.user_id
  having count(*) >= public.anti_cheat_param('competition_flag_hits')
$$;

-- Od kiedy okaz widzą inni: finds.visible_from (koniec wyprawy + 24 h), ale najpóźniej 48 h po znalezieniu / dotarciu
-- na serwer – niezamknięta wyprawa (visible_from null) nie ukrywa okazu w nieskończoność, a gracz nie widzi
-- przesuwającego się „za 24 h”.
create or replace function public.rivalry_visible_at(p_visible_from timestamptz, p_found_at timestamptz, p_created_at timestamptz)
returns timestamptz
language sql immutable set search_path = '' as $$
  select least(coalesce(p_visible_from, 'infinity'::timestamptz),
               greatest(p_found_at, p_created_at) + 2 * public.privacy_delay())
$$;

-- Kandydaci do podium walki z miejscami w zasięgach (rozstrzygnięcie; p_with_review – także okazy w weryfikacji, do
-- decyzji, czy rozstrzygnięcie ma czekać). Okaz: aktywny, autor w rywalizacji, nie ukryty, konto nieusuwane i okaz
-- PUBLICZNY (widoczny dla innych i nieukryty) co najmniej contest_public_before_results_h przed results_at – bez tego
-- ukrycie / otwarta wyprawa do ostatniej chwili omijałyby okno zgłoszeń (p_force – narzędzia dev, bez tego warunku).
-- Gmina i województwo – tylko okazy z gminą wyznaczoną przez serwer (rozpoznanie: recognitions.gmina_id = gmina okazu;
-- boty deweloperskie – tak); Polska – wszystkie. Remis: wcześniejszy found_at. n_* – uczestnicy w zasięgu okazu.
create or replace function public.contest_candidates(p_contest_id text, p_with_review boolean, p_force boolean)
returns table (entry_id uuid, user_id uuid, status text, find_id uuid, species_id text, cap_cm numeric, score numeric,
               gmina_id text, gmina_name text, voivodeship text, server_gmina boolean,
               rank_gmina int, n_gmina int, rank_wojewodztwo int, n_wojewodztwo int, rank_polska int, n_polska int)
language sql stable security definer set search_path = public, extensions as $$
  with c as materialized (
    select x.results_at from public.contests x where x.id = p_contest_id
  ), inel as materialized (
    select u.user_id from public.rivalry_ineligible_users() u
  ), cand as materialized (
    select e.id, e.user_id, e.status, e.find_id, e.species_id, e.cap_cm, e.score, e.found_at, e.created_at, e.gmina_id,
           g.name as gmina_name, g.voivodeship, p.is_bot or coalesce(r.gmina_id = e.gmina_id, false) as server_gmina
      from public.contest_entries e
      cross join c
      join public.finds f on f.id = e.find_id
      join public.profiles p on p.id = e.user_id
      join public.gminy g on g.id = e.gmina_id
      left join public.recognitions r on r.id = f.recognition_id
     where e.contest_id = p_contest_id
       and (e.status = 'active' or (p_with_review and e.status = 'review'))
       and p.deleted_at is null and p.show_in_rankings and e.shown_since is not null
       and not exists (select 1 from inel where inel.user_id = e.user_id)
       and (p_force
            or greatest(public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at), e.shown_since, e.created_at)
               <= c.results_at - make_interval(hours => public.rivalry_param('contest_public_before_results_h')::int))
  )
  select x.id, x.user_id, x.status, x.find_id, x.species_id, x.cap_cm, x.score, x.gmina_id, x.gmina_name, x.voivodeship,
         x.server_gmina,
         case when x.server_gmina then (row_number() over wg)::int end,
         case when x.server_gmina then (count(*) over wg_all)::int end,
         case when x.server_gmina then (row_number() over ww)::int end,
         case when x.server_gmina then (count(*) over ww_all)::int end,
         (row_number() over wp)::int,
         (count(*) over ())::int
    from cand x
  window wg as (partition by x.server_gmina, x.gmina_id order by x.score desc, x.found_at, x.created_at, x.id),
         wg_all as (partition by x.server_gmina, x.gmina_id),
         ww as (partition by x.server_gmina, x.voivodeship order by x.score desc, x.found_at, x.created_at, x.id),
         ww_all as (partition by x.server_gmina, x.voivodeship),
         wp as (order by x.score desc, x.found_at, x.created_at, x.id)
$$;

-- Zdjęcie znaleziska w rivalry_public_photos, dopóki znalezisko ma aktywny okaz w walce (inaczej – usunięte).
create or replace function public.rivalry_photo_sync(p_find_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.rivalry_public_photos where find_id = p_find_id;
  insert into public.rivalry_public_photos (path, owner, find_id)
  select f.photo_path, f.user_id, f.id
    from public.finds f
   where f.id = p_find_id and f.photo_path is not null
     and exists (select 1 from public.contest_entries e where e.find_id = f.id and e.status = 'active')
  on conflict (path) do update set owner = excluded.owner, find_id = excluded.find_id;
end $$;

-- Zdjęcia najlepszych okazów pojedynku „największy okaz” dla przeciwnika (aktywny – najlepszy na żywo,
-- rozstrzygnięty – zapisany). Inne rodzaje / statusy – bez wpisów.
create or replace function public.rivalry_duel_photo_sync(p_duel_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  d public.duels;
  v_found boolean;
  v_bc uuid;
  v_bo uuid;
begin
  select * into d from public.duels where id = p_duel_id;
  v_found := found;
  delete from public.rivalry_duel_photos where duel_id = p_duel_id;
  if not v_found or d.kind <> 'biggest' or d.status not in ('active', 'finished') then return; end if;
  if d.status = 'finished' then
    v_bc := d.challenger_best;
    v_bo := d.opponent_best;
  else
    v_bc := (public.duel_score(d.challenger_id, 'biggest', d.starts_at, d.ends_at)).best_find;
    v_bo := (public.duel_score(d.opponent_id, 'biggest', d.starts_at, d.ends_at)).best_find;
  end if;
  insert into public.rivalry_duel_photos (duel_id, viewer, owner, path)
  select d.id, x.viewer, f.user_id, f.photo_path
    from (values (v_bc, d.opponent_id), (v_bo, d.challenger_id)) x (find_id, viewer)
    join public.finds f on f.id = x.find_id
   where f.photo_path is not null
  on conflict do nothing;
end $$;

-- Gatunki tygodnia (lustro contestSpeciesForWeek w src/utils/contests.ts; test zgodności w db:test):
--  1. month = miesiąc (poniedziałek + 3 dni);
--  2. kandydaci = stała lista 20 popularnych gatunków (kolejność rozstrzyga remisy) – tylko te z katalogu i aktywne;
--     waga w = season_weights[month] (brak tablicy → 0); sortowanie w malejąco, potem pozycja na liście. Gdy ≥ 4
--     „klasyki” (pierwsze 8 z listy) mają w ≥ 0,5 – pula = tylko te klasyki; inaczej pierwsze 6 (n = długość puli);
--  3. h = quest_hash('YYYY-MM-DD:okaz'); a = h mod n; b = (a + 1 + (⌊h / n⌋ mod (n − 1))) mod n;
--  4. wynik: [pool[a], pool[b]] (n = 1 → jeden gatunek, n = 0 → brak).
create or replace function public.contest_week_species(p_week date) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v_month int := extract(month from p_week + 3)::int;
  v_candidates text[] := array[
    'borowik-szlachetny', 'podgrzybek-brunatny', 'czubajka-kania', 'kozlarz-babka', 'kozlarz-czerwony', 'maslak-zwyczajny',
    'mleczaj-rydz', 'borowik-ceglastopory', 'kozlarz-pomaranczowozolty', 'borowik-usiatkowany', 'borowik-sosnowy',
    'czubajka-czerwieniejaca', 'purchawica-olbrzymia', 'sarniak-dachowkowaty', 'gaska-nieksztaltna', 'gasowka-fioletowawa',
    'zagiew-luskowata', 'pieczarka-polna', 'maslak-zolty', 'kozlarz-grabowy'];
  v_pool text[];
  n int;
  h bigint;
  a int;
  b int;
begin
  -- Klasyki w sezonie (ord ≤ 8, w ≥ 0,5) – gdy co najmniej 4, tylko one.
  select coalesce(array_agg(x.id order by x.w desc, x.ord), '{}')
    into v_pool
    from (
      select s.id, c.ord, coalesce(s.season_weights[v_month], 0) as w
        from unnest(v_candidates) with ordinality c (id, ord)
        join public.species s on s.id = c.id and s.active
       where c.ord <= 8 and coalesce(s.season_weights[v_month], 0) >= 0.5
    ) x;
  if coalesce(array_length(v_pool, 1), 0) < 4 then
    select coalesce(array_agg(x.id order by x.w desc, x.ord), '{}')
      into v_pool
      from (
        select s.id, c.ord, coalesce(s.season_weights[v_month], 0) as w
          from unnest(v_candidates) with ordinality c (id, ord)
          join public.species s on s.id = c.id and s.active
         order by 3 desc, c.ord
         limit 6
      ) x;
  end if;
  n := coalesce(array_length(v_pool, 1), 0);
  if n = 0 then return '{}'; end if;
  h := public.quest_hash(to_char(p_week, 'YYYY-MM-DD') || ':okaz');
  a := (h % n)::int;
  if n = 1 then return array[v_pool[a + 1]]; end if;
  b := ((a + 1 + ((h / n) % (n - 1))) % n)::int;
  return array[v_pool[a + 1], v_pool[b + 1]];
end $$;

-- Tytuł walki gatunku: „Największy borowik szlachetny” / „Największa czubajka kania” / „Największa żagiew łuskowata”
-- (rodzaj z pierwszego słowa nazwy: -a albo „żagiew” → żeński, inaczej męski – jak biggestTitle w src/utils/contests.ts).
create or replace function public.contest_species_title(p_species_id text) returns text
language sql stable set search_path = '' as $$
  select case
           when split_part(s.name, ' ', 1) ~* 'a$' or split_part(s.name, ' ', 1) in ('Żagiew', 'żagiew') then 'Największa '
           else 'Największy '
         end || lower(left(s.name, 1)) || substr(s.name, 2)
    from public.species s
   where s.id = p_species_id
$$;

-- Walki tygodnia (idempotentnie; równoległe wywołania → te same wiersze). Tydzień = poniedziałek daty. Tylko tygodnie
-- od bieżącego do contest_history_weeks wstecz (dawniejsze / przyszłe – nic: odczyt da contest_not_found).
create or replace function public.ensure_contest_week(p_week date) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_week date := public.week_start(p_week);
  v_now_week date := public.week_start(public.local_today());
  v_start timestamptz := public.warsaw_ts(v_week);
  v_end timestamptz := public.warsaw_ts(v_week + 7);
  v_results timestamptz := public.warsaw_ts(v_week + 7)
                           + make_interval(hours => public.rivalry_param('contest_results_delay_h')::int);
  v_tag text := to_char(v_week, 'YYYY-MM-DD');
begin
  if v_week > v_now_week or v_week < v_now_week - 7 * public.rivalry_param('contest_history_weeks')::int then return; end if;
  if exists (select 1 from public.contests c where c.week_start = v_week) then return; end if;
  insert into public.contests (id, week_start, sort, kind, species_id, title, starts_at, ends_at, results_at)
  select v_tag || ':okaz', v_week, 0, 'relative', null, 'Okaz tygodnia', v_start, v_end, v_results
  union all
  select v_tag || ':' || x.sp, v_week, x.ord::smallint, 'species', x.sp, public.contest_species_title(x.sp), v_start, v_end, v_results
    from unnest(public.contest_week_species(v_week)) with ordinality x (sp, ord)
  on conflict do nothing;
end $$;

-- Id walki '{pon}:…' z tygodnia nie późniejszego niż bieżący → walki tego tygodnia istnieją (odczyt po id).
create or replace function public.ensure_contest_for_id(p_contest_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_week date;
begin
  if p_contest_id is null or p_contest_id !~ '^\d{4}-\d{2}-\d{2}:' then return; end if;
  begin
    v_week := to_date(left(p_contest_id, 10), 'YYYY-MM-DD');
  exception when others then
    return;
  end;
  if to_char(v_week, 'YYYY-MM-DD') <> left(p_contest_id, 10) or v_week <> public.week_start(v_week)
     or v_week > public.week_start(public.local_today()) then
    return;
  end if;
  perform public.ensure_contest_week(v_week);
end $$;

-- Walka dla aplikacji (Contest). entrants – okazy widoczne dla innych (cała Polska; jedno zapytanie z anty-złączeniem
-- graczy poza rywalizacją); walka rozstrzygnięta – finaliści z migawki.
create or replace function public.contest_json(c public.contests) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'speciesId', c.species_id,
    'title', c.title,
    'startsAt', public.iso_ts(c.starts_at),
    'endsAt', public.iso_ts(c.ends_at),
    'resultsAt', public.iso_ts(c.results_at),
    'status', case when c.finalized_at is not null then 'final' when now() < c.ends_at then 'open' else 'judging' end,
    'entrants', case
      when c.finalized_at is not null then (
        select count(*) from public.contest_entries e where e.contest_id = c.id and e.final_rank_polska is not null)
      else (
        with inel as materialized (select u.user_id from public.rivalry_ineligible_users() u)
        select count(*)
          from public.contest_entries e
          join public.finds f on f.id = e.find_id
          join public.profiles p on p.id = e.user_id
         where e.contest_id = c.id and e.status = 'active'
           and public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at) <= now()
           and p.deleted_at is null and p.show_in_rankings
           and not exists (select 1 from inel where inel.user_id = e.user_id))
    end
  )
$$;

-- Zasięg tablicy / rankingu: klucz filtra (slug gminy / nazwa województwa), scopeId i nazwa do nagłówka.
--  · gmina: p_scope_id = slug (nieznany → P0002 gmina_not_found); null → gmina domowa gracza;
--  · wojewodztwo: p_scope_id = nazwa (bez wielkości liter; nieznana → P0001 invalid_voivodeship); null → województwo
--    gminy domowej; bez gminy domowej key = null („Twoja gmina” / „Twoje województwo” – puste tablice);
--  · polska, znajomi – bez klucza (p_scope_id ignorowane). Inny zasięg → P0001 invalid_scope.
create or replace function public.rivalry_scope(p_scope text, p_scope_id text, p_viewer uuid,
  out scope_key text, out scope_id text, out scope_name text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  g public.gminy;
begin
  if p_scope is null or p_scope not in ('gmina', 'wojewodztwo', 'polska', 'znajomi') then
    raise exception 'invalid_scope' using errcode = 'P0001',
      detail = format('Nieznany zasięg „%s” – wybierz gminę, województwo, Polskę albo znajomych.', p_scope);
  end if;
  if p_scope = 'polska' then
    scope_name := 'Polska';
  elsif p_scope = 'znajomi' then
    scope_name := 'Znajomi';
  elsif p_scope = 'gmina' then
    if nullif(btrim(coalesce(p_scope_id, '')), '') is null then
      select x.* into g from public.profiles p join public.gminy x on x.id = p.home_gmina_id where p.id = p_viewer;
    else
      select * into g from public.gminy x where x.id = btrim(p_scope_id);
      if not found then raise exception 'gmina_not_found' using errcode = 'P0002', detail = 'Nie znamy takiej gminy.'; end if;
    end if;
    if g.id is null then
      scope_name := 'Twoja gmina';
    else
      scope_key := g.id;
      scope_id := g.id;
      scope_name := 'Gmina ' || g.name;
    end if;
  else
    if nullif(btrim(coalesce(p_scope_id, '')), '') is null then
      select x.voivodeship into scope_key from public.profiles p join public.gminy x on x.id = p.home_gmina_id where p.id = p_viewer;
    else
      scope_key := public.resolve_voivodeship(p_scope_id, p_viewer);
    end if;
    scope_id := scope_key;
    scope_name := coalesce(scope_key, 'Twoje województwo');
  end if;
end $$;

-- Tablica walki z perspektywy p_viewer w zasięgu (p_key – jak w rivalry_scope), liczona zbiorowo (bez funkcji na wiersz).
--  · counted – okaz walczy w tym zasięgu: aktywny, widoczny dla innych (rivalry_visible_at), autor w rywalizacji, nie
--    ukryty (poza zasięgiem znajomych), konto nieusuwane; w gminie i województwie – tylko z gminą z serwera (rozpoznanie;
--    boty dev – tak). Walka rozstrzygnięta – migawka: finaliści z miejscami zapisanymi przy rozstrzygnięciu (okaz, który
--    stał się widoczny później, nie walczy – widzi go tylko autor).
--  · rank – miejsce wśród walczących, GLOBALNE (niezależne od blokad widza: to samo miejsce co na podium);
--    remis – wcześniejszy found_at. Niewalczący – null.
--  · Wiersze: własny okaz zawsze (także w weryfikacji), cudze walczące bez blokady w żadną stronę.
create or replace function public.contest_board_rows(p_contest_id text, p_viewer uuid, p_scope text, p_key text)
returns table (entry_id uuid, user_id uuid, score numeric, found_at timestamptz, created_at timestamptz, status text,
               is_mine boolean, counted boolean, rank int)
language sql stable security definer set search_path = public, extensions as $$
  with inel as materialized (
    select u.user_id from public.rivalry_ineligible_users() u
  ), blk as materialized (
    select b.blocked_id as user_id from public.user_blocks b where b.blocker_id = p_viewer
    union
    select b.blocker_id from public.user_blocks b where b.blocked_id = p_viewer
  ), fr as materialized (
    select case when f.user_id = p_viewer then f.friend_id else f.user_id end as user_id
      from public.friendships f
     where f.status = 'accepted' and p_viewer in (f.user_id, f.friend_id)
  ), base as materialized (
    select e.id, e.user_id, e.score, e.found_at, e.created_at, e.status,
           e.user_id = p_viewer as is_mine,
           c.finalized_at is not null as final,
           case p_scope when 'gmina' then e.final_rank_gmina when 'wojewodztwo' then e.final_rank_wojewodztwo
                        else e.final_rank_polska end as final_rank,
           p.deleted_at is null and (p_scope = 'znajomi' or p.show_in_rankings)
             and not exists (select 1 from inel where inel.user_id = e.user_id) as shown,
           e.status = 'active'
             and public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at) <= now()
             and (p_scope not in ('gmina', 'wojewodztwo') or p.is_bot or coalesce(r.gmina_id = e.gmina_id, false)) as open_ok
      from public.contest_entries e
      join public.contests c on c.id = e.contest_id
      join public.finds f on f.id = e.find_id
      join public.profiles p on p.id = e.user_id
      join public.gminy g on g.id = e.gmina_id
      left join public.recognitions r on r.id = f.recognition_id
     where e.contest_id = p_contest_id
       and e.status in ('active', 'review')
       and case p_scope
             when 'gmina' then e.gmina_id = p_key
             when 'wojewodztwo' then g.voivodeship = p_key
             when 'polska' then true
             when 'znajomi' then e.user_id = p_viewer or e.user_id in (select fr.user_id from fr)
             else false
           end
  ), cnt as (
    select b.*,
           case when b.final then b.status = 'active' and b.final_rank is not null and b.shown
                else b.open_ok and b.shown end as counted
      from base b
  ), numbered as (
    select x.*,
           case when x.counted then
             case when x.final and p_scope <> 'znajomi' then x.final_rank
                  else (row_number() over (partition by x.counted order by x.score desc, x.found_at, x.created_at, x.id))::int
             end
           end as rnk
      from cnt x
  )
  select n.id, n.user_id, n.score, n.found_at, n.created_at, n.status, n.is_mine, n.counted, n.rnk
    from numbered n
   where n.is_mine or (n.counted and not exists (select 1 from blk where blk.user_id = n.user_id))
$$;

-- Okaz na tablicy (ContestEntry). visibleFrom – tylko własny, jeszcze niewidoczny dla innych (rivalry_visible_at:
-- koniec wyprawy + 24 h, najpóźniej 48 h po znalezieniu – także przy niezamkniętej wyprawie).
create or replace function public.contest_entry_json(p_entry_id uuid, p_viewer uuid, p_rank int) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', e.id,
    'contestId', e.contest_id,
    'findId', e.find_id,
    'author', public.author_json(e.user_id),
    'speciesId', e.species_id,
    'capCm', e.cap_cm,
    'relativePct', e.relative_pct,
    'score', e.score,
    'rank', p_rank,
    'gminaId', e.gmina_id,
    'foundAt', public.iso_ts(e.found_at),
    'photoPath', f.photo_path,
    'status', case when e.status = 'review' then 'review' else 'active' end,
    'isMine', e.user_id = p_viewer,
    'visibleFrom', case when e.user_id = p_viewer and public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at) > now()
                        then public.iso_ts(public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at)) end
  )
    from public.contest_entries e
    join public.finds f on f.id = e.find_id
   where e.id = p_entry_id
$$;

-- Czy znalezisko gracza może walczyć (bez sprawdzania, czy już jest zgłoszone). code null = tak; inaczej
-- 'not_eligible' / 'contest_closed' i powód po polsku. find_week – tydzień znaleziska (wg found_at, Europe/Warsaw).
-- p_flag: kapelusz ponad find_cap_factor × typowy → flaga 2 'contest_size' (zapisuje get_contest_eligibility –
-- odrzucone enter_contest wycofuje transakcję). Cudze / nieznane znalezisko → P0002 find_not_found.
create or replace function public.contest_find_check(p_find_id uuid, p_user uuid, p_flag boolean,
  out code text, out reason text, out find_week date)
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.finds;
  sp public.species;
  v_close timestamptz;
begin
  select * into f from public.finds x where x.id = p_find_id and x.user_id = p_user;
  if not found then raise exception 'find_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tego znaleziska na Twoim koncie.'; end if;
  select * into sp from public.species s where s.id = f.species_id;
  find_week := public.ranking_period_start('week', f.found_at);
  v_close := public.warsaw_ts(find_week + 7) + make_interval(hours => public.rivalry_param('rivalry_queue_grace_h')::int);
  code := 'not_eligible';
  if f.status <> 'claimed' then
    reason := 'Najpierw odbierz nagrodę za to znalezisko.';
  elsif exists (select 1 from public.contest_entries e where e.find_id = f.id and e.status = 'rejected') then
    reason := 'Ten okaz został odrzucony przez moderację.';
  elsif sp.clustered then
    reason := 'Gatunki rosnące w kępkach nie walczą o okaz.';
  elsif sp.protection is not null then
    reason := 'Gatunki chronione nie walczą o okaz – zostaw je w lesie.';
  elsif coalesce(f.pieces, 1) > 1 then
    reason := 'Do walki zgłoś pojedynczy owocnik, nie kępkę.';
  elsif not f.verified then
    reason := 'Walczą tylko okazy rozpoznane przez serwer – zrób zdjęcie aparatem w aplikacji.';
  elsif not f.size_verified or coalesce(f.cap_cm, 0) <= 0 then
    reason := 'Rozmiar nie został zmierzony – połóż obok dłoń albo monetę, a zmierzę kapelusz (zdjęcia ekranu i wydruków nie walczą).';
  elsif f.cap_cm > sp.typical_cap_cm * public.anti_cheat_param('find_cap_factor') then
    reason := 'Kapelusz jest nieprawdopodobnie duży jak na ten gatunek – okaz nie walczy, sprawdzimy go.';
    if p_flag then
      perform public.flag(p_user, 'contest_size', 2, f.id::text, jsonb_build_object(
        'speciesId', sp.id, 'capCm', f.cap_cm, 'typicalCapCm', sp.typical_cap_cm,
        'factor', public.anti_cheat_param('find_cap_factor')));
    end if;
  elsif not public.competition_eligible(p_user) then
    reason := 'Twoje wyniki są w weryfikacji – do jej końca okazy nie walczą.';
  elsif f.created_at > v_close or now() >= v_close
        or exists (select 1 from public.contests c where c.week_start = find_week and c.finalized_at is not null) then
    code := 'contest_closed';
    reason := 'Walki z tygodnia tego znaleziska są już zamknięte.';
  else
    code := null;
  end if;
end $$;

-- Ocena znaleziska (ContestEligibility): powód odmowy albo walki, do których pasuje, z wynikiem i miejscem, które
-- zajmuje / zająłby wśród okazów walczących teraz (bez własnych; gmina i województwo – okazy z gminą z serwera; jedno
-- zapytanie na walkę). prizeEligible = konto zabezpieczone e-mailem.
create or replace function public.contest_eligibility_json(p_find_id uuid, p_user uuid, p_flag boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  chk record;
  f public.finds;
  sp public.species;
  v_voiv text;
  v_rel numeric;
  v_matches jsonb := '[]';
  c public.contests;
  v_score numeric;
  v_cur record;
  v_ranks jsonb;
begin
  select * into chk from public.contest_find_check(p_find_id, p_user, p_flag);
  if chk.code is null then
    select * into f from public.finds where id = p_find_id;
    select * into sp from public.species where id = f.species_id;
    select g.voivodeship into v_voiv from public.gminy g where g.id = f.gmina_id;
    v_rel := round(f.cap_cm / sp.typical_cap_cm * 100, 1);
    perform public.ensure_contest_week(chk.find_week);
    for c in
      select * from public.contests x
       where x.week_start = chk.find_week and (x.kind = 'relative' or x.species_id = f.species_id)
       order by x.sort
    loop
      v_score := case when c.kind = 'relative' then v_rel else f.cap_cm end;
      select e.find_id, e.score into v_cur
        from public.contest_entries e
       where e.contest_id = c.id and e.user_id = p_user and e.status in ('active', 'review');
      with inel as materialized (select u.user_id from public.rivalry_ineligible_users() u)
      select jsonb_build_object(
               'gmina', 1 + count(*) filter (where x.server_gmina and x.gmina_id = f.gmina_id),
               'wojewodztwo', 1 + count(*) filter (where x.server_gmina and x.voivodeship = v_voiv),
               'polska', 1 + count(*))
        into v_ranks
        from (
          select e.gmina_id, g.voivodeship, p.is_bot or coalesce(r.gmina_id = e.gmina_id, false) as server_gmina
            from public.contest_entries e
            join public.finds fx on fx.id = e.find_id
            join public.profiles p on p.id = e.user_id
            join public.gminy g on g.id = e.gmina_id
            left join public.recognitions r on r.id = fx.recognition_id
           where e.contest_id = c.id and e.status = 'active' and e.user_id <> p_user
             and public.rivalry_visible_at(fx.visible_from, fx.found_at, fx.created_at) <= now()
             and p.deleted_at is null and p.show_in_rankings
             and not exists (select 1 from inel where inel.user_id = e.user_id)
             and (e.score > v_score or (e.score = v_score and e.found_at < f.found_at))
        ) x;
      v_matches := v_matches || jsonb_build_object(
        'contest', public.contest_json(c),
        'score', v_score,
        'projectedRank', v_ranks,
        'entered', v_cur.find_id is not distinct from f.id,
        'currentBest', case when v_cur.find_id is not null and v_cur.find_id <> f.id then v_cur.score end
      );
    end loop;
  end if;
  return jsonb_build_object(
    'findId', p_find_id,
    'eligible', chk.code is null,
    'reason', chk.reason,
    'prizeEligible', public.account_secured(p_user),
    'contests', v_matches
  );
end $$;

-- Zgłasza znalezisko do pasujących walk jego tygodnia (bez sprawdzania warunków – robi to wywołujący): ten sam okaz
-- już zgłoszony → bez zmian; inny aktywny okaz gracza → wycofany (status withdrawn) i zastąpiony; okaz gracza
-- w weryfikacji → walka pominięta. shown_since = teraz, gdy gracz nie jest ukryty (okno publiczności przed
-- rozstrzygnięciem). Zdjęcia w rivalry_public_photos. Zwraca {"entered": n, "skipped": n}.
create or replace function public.contest_enter_find(p_user uuid, p_find_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f public.finds;
  sp public.species;
  v_week date;
  v_rel numeric;
  v_shown boolean;
  c public.contests;
  cur public.contest_entries;
  v_entered int := 0;
  v_skipped int := 0;
begin
  select * into f from public.finds where id = p_find_id and user_id = p_user;
  if not found then
    raise exception 'find_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tego znaleziska na Twoim koncie.';
  end if;
  select * into sp from public.species where id = f.species_id;
  select p.show_in_rankings into v_shown from public.profiles p where p.id = p_user;
  v_week := public.ranking_period_start('week', f.found_at);
  v_rel := round(f.cap_cm / sp.typical_cap_cm * 100, 1);
  perform public.ensure_contest_week(v_week);
  for c in
    select * from public.contests x
     where x.week_start = v_week and (x.kind = 'relative' or x.species_id = f.species_id)
     order by x.sort
  loop
    select * into cur from public.contest_entries e
     where e.contest_id = c.id and e.user_id = p_user and e.status in ('active', 'review')
     for update;
    if found then
      if cur.find_id = f.id then
        v_entered := v_entered + 1;
        continue;
      end if;
      if cur.status = 'review' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      update public.contest_entries set status = 'withdrawn', updated_at = now() where id = cur.id;
      perform public.rivalry_photo_sync(cur.find_id);
    end if;
    insert into public.contest_entries (contest_id, user_id, find_id, species_id, gmina_id, cap_cm, relative_pct, score,
                                        found_at, shown_since)
    values (c.id, p_user, f.id, f.species_id, f.gmina_id, f.cap_cm, v_rel,
            case when c.kind = 'relative' then v_rel else f.cap_cm end, f.found_at,
            case when coalesce(v_shown, true) then now() end);
    v_entered := v_entered + 1;
  end loop;
  perform public.rivalry_photo_sync(f.id);
  return jsonb_build_object('entered', v_entered, 'skipped', v_skipped);
end $$;

-- XP za miejsce na podium zasięgu (rivalry_params contest_xp_<zasięg>_<miejsce>).
create or replace function public.contest_prize(p_scope text, p_place int) returns int
language sql stable set search_path = '' as $$
  select coalesce(public.rivalry_param('contest_xp_' || p_scope || '_' || p_place), 0)::int
$$;

-- Rozstrzygnięcie walki (idempotentne; blokada wiersza walki). Kandydaci i miejsca – contest_candidates (okaz publiczny
-- co najmniej contest_public_before_results_h przed results_at; gmina / województwo – gmina z serwera). Gdy na podium
-- któregoś zasięgu (licząc okazy w weryfikacji) stoi okaz w weryfikacji – rozstrzygnięcie czeka na moderację
-- (next_check_at za 15 min; decyzja moderatora sprawdza od razu), najwyżej contest_review_max_delay_h po results_at.
-- Miejsca finalistów → contest_entries.final_rank_* (migawka tablicy). Podium (1–3) w gminie, województwie i Polsce
-- z co najmniej contest_min_<zasięg> uczestnikami; XP tylko za najwyższą nagrodę gracza i tylko z kontem
-- zabezpieczonym (pozostałe podia – trofea z xp = 0); księga: źródło 'contest', ref_id = id walki, gmina okazu.
-- p_force (dev_finalize_rivalry) – bez czekania i bez okna publiczności. Zwraca liczbę nowych trofeów.
create or replace function public.finalize_contest(p_contest_id text, p_force boolean default false) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.contests;
  v_hold boolean := false;
  v_awards int := 0;
begin
  select * into c from public.contests where id = p_contest_id for update;
  if not found or c.finalized_at is not null then return 0; end if;

  if not p_force and now() < c.results_at + make_interval(hours => public.rivalry_param('contest_review_max_delay_h')::int) then
    select exists (
      select 1 from public.contest_candidates(c.id, true, false) x
       where x.status = 'review'
         and ((x.rank_gmina <= 3 and x.n_gmina >= public.rivalry_param('contest_min_gmina'))
           or (x.rank_wojewodztwo <= 3 and x.n_wojewodztwo >= public.rivalry_param('contest_min_wojewodztwo'))
           or (x.rank_polska <= 3 and x.n_polska >= public.rivalry_param('contest_min_polska'))))
      into v_hold;
    if v_hold then
      update public.contests set next_check_at = now() + interval '15 minutes' where id = c.id;
      return 0;
    end if;
  end if;

  with x as materialized (
    select * from public.contest_candidates(c.id, false, p_force)
  ), upd as (
    update public.contest_entries e
       set final_rank_gmina = x.rank_gmina, final_rank_wojewodztwo = x.rank_wojewodztwo, final_rank_polska = x.rank_polska
      from x
     where e.id = x.entry_id
    returning 1
  ), podium as (
    select x.*, 'gmina'::text as scope, x.gmina_id as scope_id, 'Gmina ' || x.gmina_name as scope_name, 1 as scope_ord,
           x.rank_gmina as place
      from x where x.rank_gmina <= 3 and x.n_gmina >= public.rivalry_param('contest_min_gmina')
    union all
    select x.*, 'wojewodztwo', x.voivodeship, x.voivodeship, 2, x.rank_wojewodztwo
      from x where x.rank_wojewodztwo <= 3 and x.n_wojewodztwo >= public.rivalry_param('contest_min_wojewodztwo')
    union all
    select x.*, 'polska', null, 'Polska', 3, x.rank_polska
      from x where x.rank_polska <= 3 and x.n_polska >= public.rivalry_param('contest_min_polska')
  ), best as (
    select pd.*, public.contest_prize(pd.scope, pd.place) as prize,
           row_number() over (partition by pd.user_id order by public.contest_prize(pd.scope, pd.place) desc, pd.scope_ord desc) = 1
             and public.account_secured(pd.user_id) as paid
      from podium pd
  ), ins as (
    insert into public.contest_awards (contest_id, user_id, entry_id, find_id, scope, scope_id, scope_name, place, species_id,
                                       cap_cm, score, xp)
    select c.id, b.user_id, b.entry_id, b.find_id, b.scope, b.scope_id, b.scope_name, b.place, b.species_id, b.cap_cm, b.score,
           case when b.paid then b.prize else 0 end
      from best b
    on conflict (contest_id, user_id, scope) do nothing
    returning user_id, entry_id, xp
  ), xp as (
    insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
    select i.user_id, 'contest', c.id, e.gmina_id, i.xp
      from ins i join public.contest_entries e on e.id = i.entry_id
     where i.xp > 0
    returning 1
  )
  select count(*) into v_awards from ins;

  update public.contests set finalized_at = now(), next_check_at = null where id = c.id;
  return v_awards;
end $$;

-- Leniwe rozstrzyganie: walki po results_at bez rozstrzygnięcia (tanie sprawdzenie po indeksie; jedno naraz). Walka
-- odłożona (okaz z podium w weryfikacji) – ponownie po next_check_at.
create or replace function public.ensure_contests_final() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if not exists (select 1 from public.contests c
                  where c.finalized_at is null and c.results_at <= now()
                    and coalesce(c.next_check_at, '-infinity'::timestamptz) <= now()) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('rivalry_finalize'));
  for r in
    select c.id from public.contests c
     where c.finalized_at is null and c.results_at <= now() and coalesce(c.next_check_at, '-infinity'::timestamptz) <= now()
     order by c.results_at, c.id
  loop
    perform public.finalize_contest(r.id);
  end loop;
end $$;

-- Wynik gracza w oknie pojedynku: found_at w [p_from, p_to) i created_at ≤ p_to + rivalry_queue_grace_h (kolejka offline).
--  · biggest – najlepszy kapelusz względem typowego (%) okazu size_verified (warunki jak „Okaz tygodnia”);
--  · count – odebrane, zebrane do koszyka znaleziska verified; species – różne gatunki verified.
create or replace function public.duel_score(p_user uuid, p_kind text, p_from timestamptz, p_to timestamptz,
  out score numeric, out best_find uuid)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_late timestamptz := p_to + make_interval(hours => public.rivalry_param('rivalry_queue_grace_h')::int);
begin
  if p_from is null or p_to is null then
    score := 0;
    return;
  end if;
  if p_kind = 'biggest' then
    select round(f.cap_cm / s.typical_cap_cm * 100, 1), f.id into score, best_find
      from public.finds f join public.species s on s.id = f.species_id
     where f.user_id = p_user and f.status = 'claimed' and f.size_verified and f.cap_cm > 0
       and not s.clustered and s.protection is null and coalesce(f.pieces, 1) <= 1
       and f.cap_cm <= s.typical_cap_cm * public.anti_cheat_param('find_cap_factor')
       and f.found_at >= p_from and f.found_at < p_to and f.created_at <= v_late
     order by f.cap_cm / s.typical_cap_cm desc, f.found_at, f.id
     limit 1;
  elsif p_kind = 'count' then
    select count(*) into score
      from public.finds f
     where f.user_id = p_user and f.status = 'claimed' and f.verified and f.collected
       and f.found_at >= p_from and f.found_at < p_to and f.created_at <= v_late;
  else
    select count(distinct f.species_id) into score
      from public.finds f
     where f.user_id = p_user and f.status = 'claimed' and f.verified
       and f.found_at >= p_from and f.found_at < p_to and f.created_at <= v_late;
  end if;
  score := coalesce(score, 0);
end $$;

-- Najlepszy okaz strony pojedynku „największy okaz” (DuelSide.best).
create or replace function public.duel_best_json(p_find_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'findId', f.id,
    'speciesId', f.species_id,
    'capCm', f.cap_cm,
    'relativePct', round(f.cap_cm / s.typical_cap_cm * 100, 1),
    'photoPath', f.photo_path
  )
    from public.finds f join public.species s on s.id = f.species_id
   where f.id = p_find_id
$$;

-- Pojedynek z perspektywy p_viewer (Duel). Aktywny – wyniki na żywo; rozstrzygnięty – zapisane; pozostałe – 0.
create or replace function public.duel_json(d public.duels, p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_me_ch boolean := d.challenger_id = p_viewer;
  v_me uuid := case when d.challenger_id = p_viewer then d.challenger_id else d.opponent_id end;
  v_op uuid := case when d.challenger_id = p_viewer then d.opponent_id else d.challenger_id end;
  v_ms numeric := 0;
  v_os numeric := 0;
  v_mb uuid;
  v_ob uuid;
  r record;
begin
  if d.status = 'active' then
    select * into r from public.duel_score(v_me, d.kind, d.starts_at, d.ends_at);
    v_ms := r.score;
    v_mb := r.best_find;
    select * into r from public.duel_score(v_op, d.kind, d.starts_at, d.ends_at);
    v_os := r.score;
    v_ob := r.best_find;
  elsif d.status = 'finished' then
    v_ms := coalesce(case when v_me_ch then d.challenger_score else d.opponent_score end, 0);
    v_os := coalesce(case when v_me_ch then d.opponent_score else d.challenger_score end, 0);
    v_mb := case when v_me_ch then d.challenger_best else d.opponent_best end;
    v_ob := case when v_me_ch then d.opponent_best else d.challenger_best end;
  end if;
  return jsonb_build_object(
    'id', d.id,
    'kind', d.kind,
    'days', d.days,
    'status', d.status,
    'iAmChallenger', v_me_ch,
    'createdAt', public.iso_ts(d.created_at),
    'expiresAt', case when d.status = 'pending' then public.iso_ts(d.expires_at) end,
    'startsAt', public.iso_ts(d.starts_at),
    'endsAt', public.iso_ts(d.ends_at),
    'finishedAt', public.iso_ts(d.closed_at),
    'me', jsonb_build_object('user', public.author_json(v_me), 'score', v_ms,
                             'best', case when d.kind = 'biggest' and v_mb is not null then public.duel_best_json(v_mb) end),
    'opponent', jsonb_build_object('user', public.author_json(v_op), 'score', v_os,
                                   'best', case when d.kind = 'biggest' and v_ob is not null then public.duel_best_json(v_ob) end),
    'outcome', case when d.status = 'finished' then
                 case when d.winner_id is null then 'draw' when d.winner_id = p_viewer then 'won' else 'lost' end end,
    'xp', case when d.status = 'finished' then coalesce(case when v_me_ch then d.challenger_xp else d.opponent_xp end, 0) end
  );
end $$;

-- Rozstrzygnięcie pojedynku (idempotentne – tylko aktywny). XP (źródło 'duel', bez gminy): wygrana / remis tylko gdy obie
-- strony mają wynik > 0, obie są w rywalizacji i mają konto zabezpieczone; limity przeciw farmom z księgi duel_rewards
-- (tydzień wg ends_at): para – najwyżej duel_rewarded_pair_per_week nagrodzonych pojedynków, gracz –
-- duel_rewarded_per_week. Księga nie znika z kontem przeciwnika, więc usunięcie konta pomocniczego nie odnawia limitu.
-- Przegrana – 0. Zdjęcia najlepszych okazów („największy okaz”) – rivalry_duel_photos.
create or replace function public.finish_duel(p_duel_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  d public.duels;
  a record;
  b record;
  v_winner uuid;
  v_week date;
  v_ok boolean;
  v_xc int := 0;
  v_xo int := 0;
begin
  select * into d from public.duels where id = p_duel_id for update;
  if not found or d.status <> 'active' then return; end if;
  select * into a from public.duel_score(d.challenger_id, d.kind, d.starts_at, d.ends_at);
  select * into b from public.duel_score(d.opponent_id, d.kind, d.starts_at, d.ends_at);
  v_winner := case when a.score > b.score then d.challenger_id when b.score > a.score then d.opponent_id end;
  v_week := public.ranking_period_start('week', d.ends_at);

  v_ok := a.score > 0 and b.score > 0
          and public.competition_eligible(d.challenger_id) and public.competition_eligible(d.opponent_id)
          and public.account_secured(d.challenger_id) and public.account_secured(d.opponent_id)
          and (select count(distinct r.duel_id) from public.duel_rewards r
                where r.week_start = v_week
                  and r.user_id in (d.challenger_id, d.opponent_id) and r.opponent_id in (d.challenger_id, d.opponent_id))
              < public.rivalry_param('duel_rewarded_pair_per_week');
  if v_ok then
    v_xc := case when v_winner is null then public.rivalry_param('duel_xp_draw')
                 when v_winner = d.challenger_id then public.rivalry_param('duel_xp_win') else 0 end;
    v_xo := case when v_winner is null then public.rivalry_param('duel_xp_draw')
                 when v_winner = d.opponent_id then public.rivalry_param('duel_xp_win') else 0 end;
    if v_xc > 0 and (select count(*) from public.duel_rewards r where r.user_id = d.challenger_id and r.week_start = v_week)
                    >= public.rivalry_param('duel_rewarded_per_week') then
      v_xc := 0;
    end if;
    if v_xo > 0 and (select count(*) from public.duel_rewards r where r.user_id = d.opponent_id and r.week_start = v_week)
                    >= public.rivalry_param('duel_rewarded_per_week') then
      v_xo := 0;
    end if;
  end if;

  update public.duels
     set status = 'finished', closed_at = now(),
         challenger_score = a.score, opponent_score = b.score,
         challenger_best = case when d.kind = 'biggest' then a.best_find end,
         opponent_best = case when d.kind = 'biggest' then b.best_find end,
         winner_id = v_winner, challenger_xp = v_xc, opponent_xp = v_xo
   where id = d.id;
  insert into public.duel_rewards (duel_id, user_id, opponent_id, week_start, xp)
  select d.id, x.u, x.o, v_week, x.xp
    from (values (d.challenger_id, d.opponent_id, v_xc), (d.opponent_id, d.challenger_id, v_xo)) x (u, o, xp)
   where x.xp > 0
  on conflict do nothing;
  insert into public.xp_events (user_id, source, ref_id, gmina_id, amount)
  select x.u, 'duel', d.id::text, null, x.xp
    from (values (d.challenger_id, v_xc), (d.opponent_id, v_xo)) x (u, xp)
   where x.xp > 0;
  perform public.rivalry_duel_photo_sync(d.id);
end $$;

-- Leniwe porządki pojedynków gracza (p_user null – wszystkich): zaproszenia po expires_at → expired, oczekujące
-- i aktywne z blokadą w parze → cancelled, aktywne po ends_at + rivalry_queue_grace_h (p_force – po ends_at) → finish_duel.
create or replace function public.settle_duels(p_user uuid, p_force boolean default false) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_grace interval := case when p_force then interval '0' else make_interval(hours => public.rivalry_param('rivalry_queue_grace_h')::int) end;
  r record;
begin
  if not exists (
    select 1 from public.duels d
     where d.status in ('pending', 'active') and (p_user is null or p_user in (d.challenger_id, d.opponent_id))
       and ((d.status = 'pending' and d.expires_at <= now())
         or (d.status = 'active' and d.ends_at + v_grace <= now())
         or public.is_blocked_pair(d.challenger_id, d.opponent_id))
  ) then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('rivalry_duels'));
  update public.duels d set status = 'expired', closed_at = d.expires_at
   where d.status = 'pending' and d.expires_at <= now() and (p_user is null or p_user in (d.challenger_id, d.opponent_id));
  update public.duels d set status = 'cancelled', closed_at = now()
   where d.status in ('pending', 'active') and (p_user is null or p_user in (d.challenger_id, d.opponent_id))
     and public.is_blocked_pair(d.challenger_id, d.opponent_id);
  for r in
    select d.id from public.duels d
     where d.status = 'active' and d.ends_at + v_grace <= now() and (p_user is null or p_user in (d.challenger_id, d.opponent_id))
     order by d.ends_at, d.id
  loop
    perform public.finish_duel(r.id);
  end loop;
end $$;

-- Pojedynek uczestnika po id (po porządkach); inny / nieznany / z graczem w blokadzie (w dowolną stronę) →
-- P0002 duel_not_found.
create or replace function public.duel_for(p_duel_id uuid, p_user uuid) returns public.duels
language plpgsql security definer set search_path = public, extensions as $$
declare
  d public.duels;
begin
  perform public.settle_duels(p_user);
  select * into d from public.duels x where x.id = p_duel_id and p_user in (x.challenger_id, x.opponent_id);
  if not found or public.is_blocked_pair(d.challenger_id, d.opponent_id) then
    raise exception 'duel_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tego pojedynku.';
  end if;
  return d;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: walki o okaz
-- ─────────────────────────────────────────────────────────────────────────────

-- Walki tygodnia (ContestWeek). p_week_start null = bieżący tydzień; dowolna data → jej poniedziałek; tydzień
-- przyszły → P0001 invalid_week; starszy niż contest_history_weeks (i bez walk) → P0002 contest_not_found.
-- mine – okaz gracza w każdej walce (miejsce w województwie gminy okazu); leaders – najlepszy okaz widoczny dla gracza
-- w województwie jego gminy domowej (miejsce globalne; bez gminy domowej – null); previousWeekStart – ostatni
-- rozstrzygnięty tydzień z finalistami, wcześniejszy niż pokazany.
create or replace function public.get_contest_week(p_week_start date default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_week date := public.week_start(coalesce(p_week_start, public.local_today()));
  v_home_voiv text;
  v_contests jsonb;
  v_mine jsonb;
  v_leaders jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  if v_week > public.week_start(public.local_today()) then
    raise exception 'invalid_week' using errcode = 'P0001', detail = 'Walki tego tygodnia jeszcze się nie zaczęły.';
  end if;
  perform public.ensure_contest_week(v_week);
  if not exists (select 1 from public.contests c where c.week_start = v_week) then
    raise exception 'contest_not_found' using errcode = 'P0002', detail = 'Walki z tak dawnych tygodni nie są dostępne.';
  end if;
  perform public.ensure_contests_final();
  select g.voivodeship into v_home_voiv from public.profiles p join public.gminy g on g.id = p.home_gmina_id where p.id = v_uid;

  select coalesce(jsonb_agg(public.contest_json(c) order by c.sort), '[]') into v_contests
    from public.contests c where c.week_start = v_week;

  select coalesce(jsonb_object_agg(e.contest_id, public.contest_entry_json(e.id, v_uid, (
           select r.rank from public.contest_board_rows(e.contest_id, v_uid, 'wojewodztwo', g.voivodeship) r where r.is_mine))), '{}')
    into v_mine
    from public.contest_entries e
    join public.contests c on c.id = e.contest_id
    join public.gminy g on g.id = e.gmina_id
   where c.week_start = v_week and e.user_id = v_uid and e.status in ('active', 'review');

  select coalesce(jsonb_object_agg(c.id, (
           select public.contest_entry_json(r.entry_id, v_uid, r.rank)
             from public.contest_board_rows(c.id, v_uid, 'wojewodztwo', v_home_voiv) r
            where v_home_voiv is not null and r.counted
            order by r.rank, r.entry_id
            limit 1)), '{}')
    into v_leaders
    from public.contests c where c.week_start = v_week;

  return jsonb_build_object(
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'contests', v_contests,
    'mine', v_mine,
    'leaders', v_leaders,
    'previousWeekStart', (
      select to_char(max(c.week_start), 'YYYY-MM-DD') from public.contests c
       where c.week_start < v_week and c.finalized_at is not null
         and exists (select 1 from public.contest_entries e where e.contest_id = c.id and e.final_rank_polska is not null))
  );
end $$;

-- Tablica walki (ContestBoard): do 50 okazów od największego (miejsca globalne wśród walczących – contest_board_rows;
-- własny okaz niewalczący – na swoim miejscu z rank = null), mine – okaz gracza w tej walce (także spoza zasięgu – wtedy
-- rank null), total – gracze na tablicy widocznej dla gracza. Nieznana walka → P0002 contest_not_found.
create or replace function public.get_contest_board(p_contest_id text, p_scope text, p_scope_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  sc record;
  c public.contests;
  v_entries jsonb := '[]';
  v_total bigint := 0;
  v_mine jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  select * into sc from public.rivalry_scope(p_scope, p_scope_id, v_uid);
  perform public.ensure_contest_for_id(p_contest_id);
  perform public.ensure_contests_final();
  select * into c from public.contests where id = p_contest_id;
  if not found then raise exception 'contest_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tej walki.'; end if;

  if p_scope in ('polska', 'znajomi') or sc.scope_key is not null then
    with brd as (
      select * from public.contest_board_rows(c.id, v_uid, p_scope, sc.scope_key)
    )
    select (select coalesce(jsonb_agg(public.contest_entry_json(x.entry_id, v_uid, x.rank)
                                      order by x.score desc, x.found_at, x.created_at, x.entry_id), '[]')
              from (select * from brd order by score desc, found_at, created_at, entry_id limit 50) x),
           (select count(*) from brd),
           (select public.contest_entry_json(r.entry_id, v_uid, r.rank) from brd r where r.is_mine limit 1)
      into v_entries, v_total, v_mine;
  end if;
  if v_mine is null then
    select public.contest_entry_json(e.id, v_uid, null) into v_mine
      from public.contest_entries e
     where e.contest_id = c.id and e.user_id = v_uid and e.status in ('active', 'review');
  end if;

  return jsonb_build_object(
    'contest', public.contest_json(c),
    'scope', p_scope,
    'scopeId', sc.scope_id,
    'scopeName', sc.scope_name,
    'entries', v_entries,
    'mine', v_mine,
    'total', v_total
  );
end $$;

-- Czy znalezisko może walczyć (ContestEligibility). Cudze / nieznane → P0002 find_not_found.
create or replace function public.get_contest_eligibility(p_find_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  perform public.ensure_contests_final();
  return public.contest_eligibility_json(p_find_id, v_uid, true);
end $$;

-- „Zgłoś okaz do walki”: do wszystkich pasujących walk tygodnia znaleziska (zastępuje wcześniejszy okaz gracza; ten sam
-- – bez zmian). Nie spełnia warunków → P0001 not_eligible / contest_closed (detail – powód po polsku); okaz gracza
-- w weryfikacji we wszystkich pasujących walkach → P0001 entry_in_review. Zwraca ContestEligibility po zgłoszeniu.
create or replace function public.enter_contest(p_find_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  chk record;
  r jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  perform pg_advisory_xact_lock(hashtext('contest_enter:' || v_uid::text));
  perform public.ensure_contests_final();
  select * into chk from public.contest_find_check(p_find_id, v_uid, false);
  if chk.code is not null then
    raise exception using message = chk.code, errcode = 'P0001', detail = chk.reason;
  end if;
  r := public.contest_enter_find(v_uid, p_find_id);
  if (r ->> 'entered')::int = 0 and (r ->> 'skipped')::int > 0 then
    raise exception 'entry_in_review' using errcode = 'P0001',
      detail = 'Twój okaz w tej walce czeka na weryfikację – do jej końca nie zgłosisz innego.';
  end if;
  return public.contest_eligibility_json(p_find_id, v_uid, false);
end $$;

-- Wycofanie okazu gracza z walki – do końca okna zgłoszeń (koniec tygodnia + rivalry_queue_grace_h), inaczej
-- P0001 contest_closed; okaz w weryfikacji → P0001 entry_in_review. Brak okazu → nic. Nieznana walka → P0002.
create or replace function public.withdraw_contest_entry(p_contest_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  c public.contests;
  e public.contest_entries;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  perform public.ensure_contest_for_id(p_contest_id);
  select * into c from public.contests where id = p_contest_id;
  if not found then raise exception 'contest_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tej walki.'; end if;
  select * into e from public.contest_entries x
   where x.contest_id = c.id and x.user_id = v_uid and x.status in ('active', 'review')
   for update;
  if not found then return; end if;
  if c.finalized_at is not null
     or now() >= c.ends_at + make_interval(hours => public.rivalry_param('rivalry_queue_grace_h')::int) then
    raise exception 'contest_closed' using errcode = 'P0001', detail = 'Walka już się skończyła – okazu nie da się wycofać.';
  end if;
  if e.status = 'review' then
    raise exception 'entry_in_review' using errcode = 'P0001', detail = 'Okaz czeka na weryfikację – do jej końca nie da się go wycofać.';
  end if;
  update public.contest_entries set status = 'withdrawn', updated_at = now() where id = e.id;
  perform public.rivalry_photo_sync(e.find_id);
end $$;

-- „Zgłoś okaz” (podejrzany: ekran, wydruk, nie ten gatunek…). Tylko okaz, który zgłaszający widzi na tablicy (aktywny,
-- widoczny dla innych, autor w rywalizacji i nie ukryty – ukryty tylko dla znajomych, bez blokady), inaczej P0002
-- entry_not_found; własny → P0001 invalid_entry; walka rozstrzygnięta → P0001 contest_closed. Powód – kod: 'reproduction'
-- (ekran / wydruk), 'wrong_species', 'other' (null = 'other'); inny → P0001 invalid_reason. Idempotentne (raz na gracza
-- i okaz). Limit dzienny contest_report_per_day (P0001 rate_limited). Do progu contest_report_threshold (różni
-- zgłaszający od ostatniej decyzji moderatora) liczą się tylko konta zabezpieczone e-mailem, w rywalizacji i starsze niż
-- contest_report_min_account_days dni – kilka świeżych kont nie ukryje lidera. Próg → okaz w weryfikacji (review).
create or replace function public.report_contest_entry(p_entry_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(lower(btrim(coalesce(p_reason, ''))), ''), 'other');
  e public.contest_entries;
  v_final boolean;
  v_used bigint;
  v_n bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  select * into e from public.contest_entries where id = p_entry_id for update;
  if found and e.user_id = v_uid then
    raise exception 'invalid_entry' using errcode = 'P0001', detail = 'Nie możesz zgłosić własnego okazu.';
  end if;
  if not found or e.status <> 'active'
     or not exists (select 1 from public.finds f join public.profiles p on p.id = f.user_id
                     where f.id = e.find_id and p.deleted_at is null
                       and public.rivalry_visible_at(f.visible_from, f.found_at, f.created_at) <= now()
                       and (p.show_in_rankings or public.friend_status(v_uid, p.id) = 'friends'))
     or public.is_blocked_pair(v_uid, e.user_id)
     or not public.competition_eligible(e.user_id) then
    raise exception 'entry_not_found' using errcode = 'P0002', detail = 'Tego okazu nie ma już na tablicy.';
  end if;
  select c.finalized_at is not null into v_final from public.contests c where c.id = e.contest_id;
  if v_final then
    raise exception 'contest_closed' using errcode = 'P0001', detail = 'Walka jest już rozstrzygnięta – zgłoszenia nie są przyjmowane.';
  end if;
  if v_reason not in ('reproduction', 'wrong_species', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001', detail = 'Wybierz powód zgłoszenia okazu.';
  end if;
  if exists (select 1 from public.contest_reports r where r.entry_id = e.id and r.reporter_id = v_uid) then return; end if;
  select count(*) into v_used
    from public.contest_reports r
   where r.reporter_id = v_uid and r.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'report_contest_entry', v_used, public.rivalry_param('contest_report_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit zgłoszeń okazów (%s) został wyczerpany. Spróbuj jutro.', public.rivalry_param('contest_report_per_day')),
    public.warsaw_ts(public.local_today() + 1));
  insert into public.contest_reports (entry_id, reporter_id, reason) values (e.id, v_uid, v_reason) on conflict do nothing;

  select count(distinct r.reporter_id) into v_n
    from public.contest_reports r
    join public.profiles rp on rp.id = r.reporter_id
   where r.entry_id = e.id and r.created_at > coalesce(e.reviewed_at, '-infinity'::timestamptz)
     and rp.created_at <= now() - make_interval(days => public.rivalry_param('contest_report_min_account_days')::int)
     and public.account_secured(r.reporter_id)
     and public.competition_eligible(r.reporter_id);
  if v_n >= public.rivalry_param('contest_report_threshold') then
    update public.contest_entries set status = 'review', updated_at = now() where id = e.id and status = 'active';
    perform public.rivalry_photo_sync(e.find_id);
  end if;
end $$;

-- Moderacja (tylko service_role): p_approve = true → okaz wraca na tablice (zgłoszenia sprzed decyzji przestają się
-- liczyć), false → odrzucony – to samo znalezisko odpada ze wszystkich walk (status rejected) + flaga 3 'contest_fake'
-- dla autora. Walka odłożona przez ten okaz rozstrzyga się przy najbliższym odczycie (next_check_at = null).
-- Nieznany → P0002 entry_not_found; wycofany / już odrzucony → P0001 invalid_entry. Zwraca {"entryId", "status"}.
create or replace function public.admin_review_contest_entry(p_entry_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.contest_entries;
begin
  if p_approve is null then
    raise exception 'invalid_review' using errcode = 'P0001', detail = 'Decyzja moderacji: przywróć albo odrzuć okaz.';
  end if;
  select * into e from public.contest_entries where id = p_entry_id for update;
  if not found then raise exception 'entry_not_found' using errcode = 'P0002', detail = 'Tego okazu nie ma już na tablicy.'; end if;
  if e.status not in ('active', 'review') then
    raise exception 'invalid_entry' using errcode = 'P0001', detail = format('Okaz ma już status „%s”.', e.status);
  end if;
  if p_approve then
    update public.contest_entries
       set status = 'active', reviewed_at = now(), review_note = left(p_note, 500), updated_at = now()
     where id = e.id;
  else
    update public.contest_entries
       set status = 'rejected', reviewed_at = now(), review_note = left(p_note, 500), updated_at = now()
     where find_id = e.find_id and status in ('active', 'review');
    perform public.flag(e.user_id, 'contest_fake', 3, e.id::text, jsonb_build_object(
      'contestId', e.contest_id, 'findId', e.find_id, 'note', left(p_note, 500)));
  end if;
  perform public.rivalry_photo_sync(e.find_id);
  update public.contests c set next_check_at = null
   where c.finalized_at is null and c.id in (select x.contest_id from public.contest_entries x where x.find_id = e.find_id);
  return jsonb_build_object('entryId', e.id, 'status', case when p_approve then 'active' else 'rejected' end);
end $$;

-- Trofea (TrophyCase) gracza (p_user null) albo innego grzybiarza. Niewidoczny (blokada, usuwane konto) → P0002
-- user_not_found; gracz ukryty w rankingach – trofea widzą tylko jego znajomi (inni: puste).
create or replace function public.get_trophies(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid := coalesce(p_user, auth.uid());
  v_show boolean := true;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  if v_target <> v_uid then
    if not public.user_visible_to(v_target, v_uid) or public.is_blocked_pair(v_uid, v_target) then
      raise exception 'user_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tego grzybiarza.';
    end if;
    v_show := (select p.show_in_rankings from public.profiles p where p.id = v_target)
              or public.friend_status(v_uid, v_target) = 'friends';
  end if;
  perform public.ensure_contests_final();
  return (
    select jsonb_build_object(
      'gold', count(*) filter (where a.place = 1),
      'silver', count(*) filter (where a.place = 2),
      'bronze', count(*) filter (where a.place = 3),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', x.id,
                 'contestId', x.contest_id,
                 'contestTitle', x.title,
                 'scope', x.scope,
                 'scopeName', x.scope_name,
                 'place', x.place,
                 'speciesId', x.species_id,
                 'capCm', x.cap_cm,
                 'xp', x.xp,
                 'awardedAt', public.iso_ts(x.awarded_at)
               ) order by x.awarded_at desc, x.place, x.id)
          from (
            select a2.*, c.title
              from public.contest_awards a2 join public.contests c on c.id = a2.contest_id
             where a2.user_id = v_target and v_show
             order by a2.awarded_at desc, a2.place, a2.id
             limit 20
          ) x), '[]')
    )
      from public.contest_awards a
     where a.user_id = v_target and v_show
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: pojedynki
-- ─────────────────────────────────────────────────────────────────────────────

-- Pojedynki gracza (DuelsOverview): aktywne (od najbliższego końca), wyzwania do gracza i od gracza (od najnowszego),
-- zakończone w ostatnich 30 dniach (także odrzucone / wygasłe / anulowane; najnowsze, do 20) i bilans wszystkich
-- rozstrzygniętych. Bez pojedynków z graczami w blokadzie. Zdjęcia najlepszych okazów aktywnych pojedynków „największy
-- okaz” – odświeżane dla polityki Storage.
create or replace function public.get_duels() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  perform public.settle_duels(v_uid);
  perform public.rivalry_duel_photo_sync(d.id)
     from public.duels d
    where d.status = 'active' and d.kind = 'biggest' and v_uid in (d.challenger_id, d.opponent_id);
  return jsonb_build_object(
    'active', (
      select coalesce(jsonb_agg(public.duel_json(d, v_uid) order by d.ends_at, d.id), '[]')
        from public.duels d
       where d.status = 'active' and v_uid in (d.challenger_id, d.opponent_id)
         and not public.is_blocked_pair(d.challenger_id, d.opponent_id)),
    'incoming', (
      select coalesce(jsonb_agg(public.duel_json(d, v_uid) order by d.created_at desc, d.id), '[]')
        from public.duels d
       where d.status = 'pending' and d.opponent_id = v_uid
         and not public.is_blocked_pair(d.challenger_id, d.opponent_id)),
    'outgoing', (
      select coalesce(jsonb_agg(public.duel_json(d, v_uid) order by d.created_at desc, d.id), '[]')
        from public.duels d
       where d.status = 'pending' and d.challenger_id = v_uid
         and not public.is_blocked_pair(d.challenger_id, d.opponent_id)),
    'finished', (
      select coalesce(jsonb_agg(public.duel_json(x, v_uid) order by x.closed_at desc, x.id), '[]')
        from (
          select d.* from public.duels d
           where d.status in ('finished', 'declined', 'cancelled', 'expired') and v_uid in (d.challenger_id, d.opponent_id)
             and d.closed_at >= now() - interval '30 days'
             and not public.is_blocked_pair(d.challenger_id, d.opponent_id)
           order by d.closed_at desc, d.id
           limit 20
        ) x),
    'record', (
      select jsonb_build_object(
               'won', count(*) filter (where d.winner_id = v_uid),
               'lost', count(*) filter (where d.winner_id is not null and d.winner_id <> v_uid),
               'draw', count(*) filter (where d.winner_id is null))
        from public.duels d
       where d.status = 'finished' and v_uid in (d.challenger_id, d.opponent_id))
  );
end $$;

-- Pojedynek (Duel); nie uczestnik / nieznany / blokada → P0002 duel_not_found.
create or replace function public.get_duel(p_duel_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  d public.duels;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  d := public.duel_for(p_duel_id, v_uid);
  if d.status = 'active' and d.kind = 'biggest' then perform public.rivalry_duel_photo_sync(d.id); end if;
  return public.duel_json(d, v_uid);
end $$;

-- „Wyzwij” zaakceptowanego znajomego (bez blokady). p_duel_id z telefonu: ponowienie zwraca zapisany pojedynek (także
-- gdy w międzyczasie wpadł limit – sprawdzane ponownie po blokadach), id cudzego → P0001 duel_id_conflict. Rodzaj
-- biggest | count | species, czas 1 | 3 | 7 dni, inaczej P0001 invalid_duel; do siebie → P0001 invalid_user; nieznany →
-- P0002 user_not_found; nie znajomi / blokada → P0001 not_friends. Limity → P0001 duel_limit (detail po polsku): para ma
-- już pojedynek, gracz albo znajomy ma duel_max_open aktywnych + oczekujących, duel_per_day nowych wyzwań gracza na dobę.
-- Blokady doradcze obu graczy (w stałej kolejności uuid) – limity bez wyścigów. Zaproszenie wygasa po duel_invite_h.
create or replace function public.create_duel(p_duel_id uuid, p_opponent uuid, p_kind text, p_days int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  d public.duels;
  v_max int := public.rivalry_param('duel_max_open')::int;
  v_n bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  if p_duel_id is null then
    raise exception 'invalid_duel' using errcode = 'P0001', detail = 'Brak identyfikatora pojedynku – spróbuj jeszcze raz.';
  end if;
  select * into d from public.duels where id = p_duel_id;
  if found then
    if d.challenger_id = v_uid then
      return public.duel_json(public.duel_for(d.id, v_uid), v_uid);
    end if;
    raise exception 'duel_id_conflict' using errcode = 'P0001', detail = 'Nie udało się utworzyć pojedynku – spróbuj jeszcze raz.';
  end if;
  if p_kind is null or p_kind not in ('biggest', 'count', 'species') or p_days is null or p_days not in (1, 3, 7) then
    raise exception 'invalid_duel' using errcode = 'P0001',
      detail = 'Wybierz rodzaj pojedynku (największy okaz, najwięcej grzybów albo gatunków) i czas: 1, 3 albo 7 dni.';
  end if;
  if p_opponent is null or p_opponent = v_uid then
    raise exception 'invalid_user' using errcode = 'P0001', detail = 'Nie możesz wyzwać samego siebie.';
  end if;
  if not exists (select 1 from public.profiles where id = p_opponent and deleted_at is null) then
    raise exception 'user_not_found' using errcode = 'P0002', detail = 'Nie znaleźliśmy tego grzybiarza.';
  end if;
  -- Szereguje wyzwania obu graczy (limity liczone bez wyścigu); stała kolejność – bez zakleszczeń.
  perform pg_advisory_xact_lock(hashtext('duel_user:' || least(v_uid, p_opponent)::text));
  perform pg_advisory_xact_lock(hashtext('duel_user:' || greatest(v_uid, p_opponent)::text));
  -- Równoległe ponowienie z tym samym id mogło zapisać pojedynek, gdy czekaliśmy na blokadę.
  select * into d from public.duels where id = p_duel_id;
  if found then
    if d.challenger_id = v_uid then
      return public.duel_json(public.duel_for(d.id, v_uid), v_uid);
    end if;
    raise exception 'duel_id_conflict' using errcode = 'P0001', detail = 'Nie udało się utworzyć pojedynku – spróbuj jeszcze raz.';
  end if;
  if public.is_blocked_pair(v_uid, p_opponent) or public.friend_status(v_uid, p_opponent) <> 'friends' then
    raise exception 'not_friends' using errcode = 'P0001', detail = 'Na pojedynek możesz wyzwać tylko znajomego.';
  end if;
  perform public.settle_duels(v_uid);
  perform public.settle_duels(p_opponent);

  if exists (select 1 from public.duels x
              where x.status in ('pending', 'active')
                and least(x.challenger_id, x.opponent_id) = least(v_uid, p_opponent)
                and greatest(x.challenger_id, x.opponent_id) = greatest(v_uid, p_opponent)) then
    raise exception 'duel_limit' using errcode = 'P0001', detail = 'Z tym znajomym masz już pojedynek – poczekaj na jego koniec.';
  end if;
  select count(*) into v_n from public.duels x where x.status in ('pending', 'active') and v_uid in (x.challenger_id, x.opponent_id);
  if v_n >= v_max then
    raise exception 'duel_limit' using errcode = 'P0001',
      detail = format('Masz już %s pojedynki w toku (aktywne i oczekujące) – to limit.', v_n);
  end if;
  select count(*) into v_n from public.duels x where x.challenger_id = v_uid and x.created_at >= public.warsaw_ts(public.local_today());
  if v_n >= public.rivalry_param('duel_per_day') then
    raise exception 'duel_limit' using errcode = 'P0001',
      detail = format('Dziś wysłałeś już %s wyzwań – kolejne jutro.', v_n);
  end if;
  select count(*) into v_n from public.duels x where x.status in ('pending', 'active') and p_opponent in (x.challenger_id, x.opponent_id);
  if v_n >= v_max then
    raise exception 'duel_limit' using errcode = 'P0001', detail = 'Znajomy ma już komplet pojedynków w toku.';
  end if;

  insert into public.duels (id, challenger_id, opponent_id, kind, days, expires_at)
  values (p_duel_id, v_uid, p_opponent, p_kind, p_days, now() + make_interval(hours => public.rivalry_param('duel_invite_h')::int))
  returning * into d;
  return public.duel_json(d, v_uid);
end $$;

-- Odpowiedź wyzwanego: przyjęcie startuje pojedynek od teraz (startsAt, endsAt = + dni), odrzucenie → declined.
-- Idempotentne (ta sama odpowiedź drugi raz zwraca stan). Wyzywający → P0001 invalid_response; wyzwanie już
-- nieaktualne (wygasłe, anulowane, inna odpowiedź) → P0001 duel_closed; znajomość zerwana / blokada przy przyjęciu →
-- P0001 not_friends. p_accept null → P0001 invalid_response.
create or replace function public.respond_duel(p_duel_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  d public.duels;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  if p_accept is null then raise exception 'invalid_response' using errcode = 'P0001', detail = 'Przyjmij albo odrzuć wyzwanie.'; end if;
  d := public.duel_for(p_duel_id, v_uid);
  if d.opponent_id <> v_uid then
    raise exception 'invalid_response' using errcode = 'P0001', detail = 'Na wyzwanie odpowiada wyzwany znajomy.';
  end if;
  select * into d from public.duels where id = d.id for update;
  if d.status = 'pending' then
    if p_accept then
      if public.is_blocked_pair(d.challenger_id, d.opponent_id) or public.friend_status(d.challenger_id, d.opponent_id) <> 'friends' then
        raise exception 'not_friends' using errcode = 'P0001', detail = 'Pojedynek możliwy tylko między znajomymi.';
      end if;
      update public.duels
         set status = 'active', responded_at = now(), starts_at = now(), ends_at = now() + make_interval(days => d.days)
       where id = d.id
       returning * into d;
    else
      update public.duels set status = 'declined', responded_at = now(), closed_at = now()
       where id = d.id
       returning * into d;
    end if;
  elsif not ((p_accept and d.status in ('active', 'finished') and d.responded_at is not null)
             or (not p_accept and d.status = 'declined')) then
    raise exception 'duel_closed' using errcode = 'P0001', detail = 'To wyzwanie jest już nieaktualne.';
  end if;
  return public.duel_json(d, v_uid);
end $$;

-- Anulowanie własnego wyzwania, zanim druga strona odpowie (pending → cancelled). Już anulowane → nic; wyzwany →
-- P0001 invalid_duel; po odpowiedzi → P0001 duel_closed; nieznany → P0002 duel_not_found.
create or replace function public.cancel_duel(p_duel_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  d public.duels;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  d := public.duel_for(p_duel_id, v_uid);
  if d.challenger_id <> v_uid then
    raise exception 'invalid_duel' using errcode = 'P0001', detail = 'Wyzwanie może anulować tylko wyzywający.';
  end if;
  if d.status = 'cancelled' then return; end if;
  if d.status <> 'pending' then
    raise exception 'duel_closed' using errcode = 'P0001', detail = 'Wyzwanie zostało już przyjęte albo jest nieaktualne.';
  end if;
  update public.duels set status = 'cancelled', closed_at = now() where id = d.id and status = 'pending';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: ranking grzybiarzy, widoczność, status
-- ─────────────────────────────────────────────────────────────────────────────

-- Ranking grzybiarzy (PlayerRanking). Punkty = suma xp_events w okresie (tydzień od poniedziałku / sezon od 1 stycznia)
-- ze źródeł find (tylko znaleziska verified), challenge, contest, duel. Zasięgi: znajomi (gracz + zaakceptowani znajomi,
-- na żywo), gmina / wojewodztwo (XP zdobyte w gminach zasięgu – xp_events.gmina_id), polska (wszystko); publiczne –
-- tylko XP starsze niż privacy_delay() (pendingXp = świeże punkty gracza w zasięgu). Wykluczeni: ukryci (poza zasięgiem
-- znajomych), poza rywalizacją, usuwani, bez punktów (zbiorowe anty-złączenie). Miejsca rank() – globalne (remis – to
-- samo miejsce), gracze w blokadzie z widzem tylko znikają z jego listy. total – wiersze widoczne dla gracza.
-- Okres inny niż week | season → P0001 invalid_period; zasięg – jak w rivalry_scope.
create or replace function public.get_player_ranking(p_scope text, p_period text, p_scope_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  sc record;
  v_live boolean := p_scope = 'znajomi';
  v_start timestamptz;
  v_cut timestamptz;
  v_rows jsonb := '[]';
  v_me jsonb;
  v_total bigint := 0;
  v_pending bigint := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  if p_period is null or p_period not in ('week', 'season') then
    raise exception 'invalid_period' using errcode = 'P0001', detail = 'Ranking jest tygodniowy albo sezonowy.';
  end if;
  select * into sc from public.rivalry_scope(p_scope, p_scope_id, v_uid);
  perform public.ensure_contests_final();
  v_start := public.warsaw_ts(public.ranking_period_start(p_period::public.ranking_period));
  v_cut := case when v_live then 'infinity'::timestamptz else now() - public.privacy_delay() end;

  if p_scope in ('polska', 'znajomi') or sc.scope_key is not null then
    with inel as materialized (
      select u.user_id from public.rivalry_ineligible_users() u
    ), blk as materialized (
      select b.blocked_id as user_id from public.user_blocks b where b.blocker_id = v_uid
      union
      select b.blocker_id from public.user_blocks b where b.blocked_id = v_uid
    ), fr as materialized (
      select v_uid as user_id
      union
      select case when f.user_id = v_uid then f.friend_id else f.user_id end
        from public.friendships f
       where f.status = 'accepted' and v_uid in (f.user_id, f.friend_id)
    ), ev as (
      select e.user_id, e.amount, e.created_at
        from public.xp_events e
        left join public.gminy g on g.id = e.gmina_id
       where e.created_at >= v_start
         and e.source in ('find', 'challenge', 'contest', 'duel')
         and case when e.source = 'find' then exists (
                select 1 from public.finds f
                 where f.verified
                   and f.id = case when e.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                   then e.ref_id::uuid end)
              else true end
         and case p_scope
               when 'gmina' then e.gmina_id = sc.scope_key
               when 'wojewodztwo' then g.voivodeship = sc.scope_key
               when 'znajomi' then e.user_id in (select fr.user_id from fr)
               else true
             end
    ), pts as (
      select ev.user_id,
             coalesce(sum(ev.amount) filter (where ev.created_at < v_cut), 0) as xp,
             coalesce(sum(ev.amount) filter (where ev.created_at >= v_cut), 0) as fresh
        from ev group by ev.user_id
    ), ranked as (
      select pts.user_id, pts.xp, rank() over (order by pts.xp desc) as rnk
        from pts
        join public.profiles p on p.id = pts.user_id
       where pts.xp > 0 and p.deleted_at is null
         and (v_live or p.show_in_rankings)
         and not exists (select 1 from inel where inel.user_id = pts.user_id)
    ), shown as (
      select r.* from ranked r
       where r.user_id = v_uid or not exists (select 1 from blk where blk.user_id = r.user_id)
    )
    select (select coalesce(jsonb_agg(jsonb_build_object(
                     'rank', x.rnk, 'user', public.author_json(x.user_id), 'xp', x.xp, 'isMe', x.user_id = v_uid
                   ) order by x.rnk, x.user_id), '[]')
              from (select * from shown order by rnk, user_id limit 50) x),
           (select jsonb_build_object('rank', r.rnk, 'user', public.author_json(r.user_id), 'xp', r.xp, 'isMe', true)
              from shown r where r.user_id = v_uid),
           (select count(*) from shown),
           (select case when v_live then 0 else coalesce(sum(p2.fresh), 0) end from pts p2 where p2.user_id = v_uid)
      into v_rows, v_me, v_total, v_pending;
  end if;

  return jsonb_build_object(
    'scope', p_scope,
    'scopeId', sc.scope_id,
    'scopeName', sc.scope_name,
    'period', p_period,
    'live', v_live,
    'rows', v_rows,
    'me', v_me,
    'pendingXp', coalesce(v_pending, 0),
    'total', v_total,
    'hidden', not coalesce((select p.show_in_rankings from public.profiles p where p.id = v_uid), true)
  );
end $$;

-- „Pokazuj mnie w rankingach grzybiarzy i walkach” (Ustawienia → Prywatność). p_visible null → P0001 invalid_visibility.
-- Okazy w nierozstrzygniętych walkach: odsłonięcie → shown_since = teraz (okno publiczności przed rozstrzygnięciem
-- liczy się od nowa), ukrycie → null.
create or replace function public.set_ranking_visibility(p_visible boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.';
  end if;
  if p_visible is null then
    raise exception 'invalid_visibility' using errcode = 'P0001', detail = 'Wybierz, czy pokazywać Cię w rankingach.';
  end if;
  update public.profiles set show_in_rankings = p_visible where id = v_uid and show_in_rankings is distinct from p_visible;
  update public.contest_entries e
     set shown_since = case when p_visible then now() end, updated_at = now()
    from public.contests c
   where c.id = e.contest_id and c.finalized_at is null and e.user_id = v_uid and e.status in ('active', 'review')
     and (case when p_visible then e.shown_since is null else e.shown_since is not null end);
end $$;

-- Status w rywalizacji (RivalryStatus). 'banned' pokazujemy jak 'review' (wyniki wstrzymane).
create or replace function public.get_rivalry_status() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  return jsonb_build_object(
    'showInRankings', coalesce((select p.show_in_rankings from public.profiles p where p.id = v_uid), true),
    'standing', case when public.competition_eligible(v_uid) then 'ok' else 'review' end,
    'accountSecured', public.account_secured(v_uid)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Zdjęcia okazów (Storage): odczyt scan-photos dla rywalizacji
-- ─────────────────────────────────────────────────────────────────────────────

-- Czy zalogowany może czytać plik scan-photos p_name (cudzy – własne obejmuje „zdjecia: odczyt wlasnych”). Najpierw
-- wyszukanie ścieżki po kluczu (rivalry_public_photos / rivalry_duel_photos) – plik spoza rywalizacji kosztuje dwa
-- wyszukania w indeksie; dopiero przy trafieniu sprawdzenia (jedno zapytanie, na końcu competition_eligible):
--  · zdjęcie okazu w walce: ta sama ścieżka w znalezisku, aktywny okaz, widoczny dla innych (jak rivalry_visible_at),
--    autor nie ukryty (ukryty – tylko dla znajomych), konto nieusuwane, bez blokady w żadną stronę, w rywalizacji;
--  · zdjęcie najlepszego okazu pojedynku „największy okaz” dla przeciwnika (bez blokady).
-- Do polityki RLS (stąd EXECUTE dla authenticated); zdradza tylko to, co i tak pokazują tablice i pojedynki.
-- plpgsql (plany zapamiętane w sesji, wczesne wyjście) – polityka liczy ją dla każdego obiektu koszyka.
create or replace function public.rivalry_photo_readable(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null or p_name is null then return false; end if;
  select x.owner into v_owner
    from public.rivalry_public_photos x
    join public.finds f on f.id = x.find_id
    join public.profiles p on p.id = x.owner
   where x.path = p_name and x.owner <> v_uid and f.photo_path = p_name and p.deleted_at is null
     and least(coalesce(f.visible_from, 'infinity'::timestamptz), greatest(f.found_at, f.created_at) + interval '48 hours')
         <= now()                                         -- = rivalry_visible_at (2 × privacy_delay) bez wywołania funkcji
     and exists (select 1 from public.contest_entries e where e.find_id = f.id and e.status = 'active')
     and not exists (select 1 from public.user_blocks b
                      where (b.blocker_id = v_uid and b.blocked_id = x.owner) or (b.blocker_id = x.owner and b.blocked_id = v_uid))
     and (p.show_in_rankings
          or exists (select 1 from public.friendships fr
                      where fr.status = 'accepted'
                        and ((fr.user_id = v_uid and fr.friend_id = x.owner) or (fr.user_id = x.owner and fr.friend_id = v_uid))));
  if v_owner is not null and public.competition_eligible(v_owner) then return true; end if;
  return exists (
    select 1 from public.rivalry_duel_photos d
     where d.path = p_name and d.viewer = v_uid
       and not exists (select 1 from public.user_blocks b
                        where (b.blocker_id = d.viewer and b.blocked_id = d.owner) or (b.blocker_id = d.owner and b.blocked_id = d.viewer)));
end $$;

-- Szybki odsiew w polityce: same ścieżki zdjęć rywalizacji (rivalry_public_photos ∪ rivalry_duel_photos, utrzymywane
-- wyzwalaczami) w schemacie private (poza API PostgREST – 20261015103000_uszczelnienia.sql), z SELECT dla authenticated,
-- bo polityka czyta ją uprawnieniami wywołującego. Plik spoza rywalizacji kosztuje jedno wyszukanie w indeksie – bez
-- wywołania funkcji (warunek tańszy, planista sprawdza go pierwszy); rivalry_photo_readable tylko przy trafieniu.
create schema if not exists private;
grant usage on schema private to authenticated;
create table if not exists private.rivalry_photo_paths (path text primary key);
revoke all on private.rivalry_photo_paths from public, anon, authenticated;
grant select on private.rivalry_photo_paths to authenticated;
grant select, insert, update, delete on private.rivalry_photo_paths to service_role;

create or replace function public.rivalry_photo_paths_sync() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' then
    insert into private.rivalry_photo_paths (path) values (new.path) on conflict do nothing;
  else
    delete from private.rivalry_photo_paths x
     where x.path = old.path
       and not exists (select 1 from public.rivalry_public_photos r where r.path = old.path)
       and not exists (select 1 from public.rivalry_duel_photos d where d.path = old.path);
  end if;
  return null;
end $$;
drop trigger if exists rivalry_public_photos_paths on public.rivalry_public_photos;
create trigger rivalry_public_photos_paths after insert or delete on public.rivalry_public_photos
  for each row execute function public.rivalry_photo_paths_sync();
drop trigger if exists rivalry_duel_photos_paths on public.rivalry_duel_photos;
create trigger rivalry_duel_photos_paths after insert or delete on public.rivalry_duel_photos
  for each row execute function public.rivalry_photo_paths_sync();

drop policy if exists "rywalizacja: odczyt zdjec okazow" on storage.objects;
create policy "rywalizacja: odczyt zdjec okazow" on storage.objects for select to authenticated
  using (bucket_id = 'scan-photos'
         and exists (select 1 from private.rivalry_photo_paths r where r.path = name)
         and public.rivalry_photo_readable(name));

-- ─────────────────────────────────────────────────────────────────────────────
-- Aktywność: + pojedynki i walki o okaz; pola refId / meta (null dla dotychczasowych rodzajów)
-- ─────────────────────────────────────────────────────────────────────────────

--  duel_invite       "duel_invite:<duelId>"        wyzywający → mnie (czas: created_at), meta {kind, days}
--  duel_accepted     "duel_accepted:<duelId>"      przeciwnik przyjął MOJE wyzwanie (responded_at), meta {kind, days}
--  duel_finished     "duel_finished:<duelId>"      rozstrzygnięty pojedynek (closed_at), actor – przeciwnik,
--                                                  meta {outcome: won | lost | draw, xp}
--  contest_award     "contest_award:<awardId>"     moje podium (actor = ja), refId = id walki,
--                                                  meta {place, scope, scopeName, xp, title}
--  contest_overtaken "contest_overtaken:<mojeZgłoszenie>:<jegoZgłoszenie>"  gracz, który wyprzedził mój aktywny okaz
--                                                  w województwie w trwającej walce (widoczny dla innych, nieukryty,
--                                                  w rywalizacji, z gminą z serwera, bez blokady). Serwer zapisuje PIERWSZĄ
--                                                  obserwację (contest_overtakes) przy odczycie aktywności – najnowszego
--                                                  wyprzedzającego na każdy mój okaz: czas = chwila obserwacji (zawsze po
--                                                  poprzednim odczycie – także okaz z późno zamkniętej wyprawy, powrót
--                                                  z weryfikacji, odblokowanie), meta {scope: 'wojewodztwo', rank, title},
--                                                  rank = moje NOWE miejsce w województwie w chwili obserwacji (stałe);
--                                                  walki z ostatnich 14 dni
-- Przed odczytem – leniwe rozstrzygnięcia (pojedynki gracza, walki po results_at). Reszta bez zmian (blokady w obie strony).
create or replace function public.get_activity(p_since timestamptz default null, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się.'; end if;
  perform public.settle_duels(v_uid);
  perform public.ensure_contests_final();

  -- Wyprzedzenia w trwających walkach: pierwsza obserwacja najnowszego wyprzedzającego każdy mój aktywny okaz.
  with inel as materialized (
    select u.user_id from public.rivalry_ineligible_users() u
  ), blk as materialized (
    select b.blocked_id as user_id from public.user_blocks b where b.blocker_id = v_uid
    union
    select b.blocker_id from public.user_blocks b where b.blocked_id = v_uid
  ), mine_e as materialized (
    select e.id, e.contest_id, e.score, e.found_at, e.created_at, g.voivodeship
      from public.contest_entries e
      join public.contests c on c.id = e.contest_id and c.finalized_at is null
      join public.gminy g on g.id = e.gmina_id
     where e.user_id = v_uid and e.status = 'active'
  ), comp as materialized (
    select ot.id, ot.contest_id, ot.user_id, ot.score, ot.found_at, go.voivodeship,
           greatest(public.rivalry_visible_at(fo.visible_from, fo.found_at, fo.created_at), ot.created_at, ot.shown_since) as at
      from public.contest_entries ot
      join public.gminy go on go.id = ot.gmina_id
      join public.finds fo on fo.id = ot.find_id
      join public.profiles po on po.id = ot.user_id
      left join public.recognitions r on r.id = fo.recognition_id
     where ot.contest_id in (select m.contest_id from mine_e m)
       and ot.status = 'active' and ot.user_id <> v_uid and ot.shown_since is not null
       and public.rivalry_visible_at(fo.visible_from, fo.found_at, fo.created_at) <= now()
       and po.deleted_at is null and po.show_in_rankings
       and (po.is_bot or coalesce(r.gmina_id = ot.gmina_id, false))
       and not exists (select 1 from inel where inel.user_id = ot.user_id)
  ), cand as (
    select distinct on (m.id) m.id as mine_id, k.id as other_id,
           1 + (select count(*) from comp k2
                 where k2.contest_id = m.contest_id and k2.voivodeship = m.voivodeship
                   and (k2.score > m.score or (k2.score = m.score and k2.found_at < m.found_at)))::int as rank
      from mine_e m
      join comp k on k.contest_id = m.contest_id and k.voivodeship = m.voivodeship
     where (k.score > m.score or (k.score = m.score and k.found_at < m.found_at))
       and k.at > m.created_at
       and not exists (select 1 from blk where blk.user_id = k.user_id)
     order by m.id, k.at desc, k.id
  )
  insert into public.contest_overtakes (entry_id, other_entry_id, user_id, rank)
  select cand.mine_id, cand.other_id, v_uid, cand.rank from cand
  on conflict do nothing;

  return (
    with mine as (
      select p.id from public.posts p where p.author_id = v_uid and p.deleted_at is null
    ), items as (
      select 'reaction:' || r.post_id || ':' || r.user_id as id, 'reaction' as kind, r.user_id as actor,
             r.post_id, null::text as body, null::text as ref_id, null::jsonb as meta, r.created_at as at
        from public.post_reactions r join mine m on m.id = r.post_id
       where r.user_id <> v_uid
      union all
      select 'comment:' || c.id, 'comment', c.author_id, c.post_id,
             case when char_length(c.body) > 120 then left(c.body, 119) || '…' else c.body end, null, null, c.created_at
        from public.post_comments c join mine m on m.id = c.post_id
       where c.author_id <> v_uid
      union all
      select 'friend_request:' || f.user_id, 'friend_request', f.user_id, null, null, null, null, f.created_at
        from public.friendships f
       where f.friend_id = v_uid and f.status = 'pending'
      union all
      select 'friend_accepted:' || f.friend_id, 'friend_accepted', f.friend_id, null, null, null, null, f.accepted_at
        from public.friendships f
       where f.user_id = v_uid and f.status = 'accepted' and f.accepted_at is not null
      union all
      select 'duel_invite:' || d.id, 'duel_invite', d.challenger_id, null, null, d.id::text,
             jsonb_build_object('kind', d.kind, 'days', d.days), d.created_at
        from public.duels d
       where d.opponent_id = v_uid
      union all
      select 'duel_accepted:' || d.id, 'duel_accepted', d.opponent_id, null, null, d.id::text,
             jsonb_build_object('kind', d.kind, 'days', d.days), d.responded_at
        from public.duels d
       where d.challenger_id = v_uid and d.status in ('active', 'finished') and d.responded_at is not null
      union all
      select 'duel_finished:' || d.id, 'duel_finished', case when d.challenger_id = v_uid then d.opponent_id else d.challenger_id end,
             null, null, d.id::text,
             jsonb_build_object(
               'outcome', case when d.winner_id is null then 'draw' when d.winner_id = v_uid then 'won' else 'lost' end,
               'xp', coalesce(case when d.challenger_id = v_uid then d.challenger_xp else d.opponent_xp end, 0)),
             d.closed_at
        from public.duels d
       where d.status = 'finished' and v_uid in (d.challenger_id, d.opponent_id)
      union all
      select 'contest_award:' || a.id, 'contest_award', a.user_id, null, null, a.contest_id,
             jsonb_build_object('place', a.place, 'scope', a.scope, 'scopeName', a.scope_name, 'xp', a.xp, 'title', c.title),
             a.awarded_at
        from public.contest_awards a join public.contests c on c.id = a.contest_id
       where a.user_id = v_uid
      union all
      select 'contest_overtaken:' || o.entry_id || ':' || o.other_entry_id, 'contest_overtaken', ot.user_id, null, null,
             me.contest_id, jsonb_build_object('scope', 'wojewodztwo', 'rank', o.rank, 'title', c.title), o.seen_at
        from public.contest_overtakes o
        join public.contest_entries me on me.id = o.entry_id
        join public.contest_entries ot on ot.id = o.other_entry_id
        join public.contests c on c.id = me.contest_id
       where o.user_id = v_uid and c.ends_at > now() - interval '14 days'
    ), page as (
      select * from items i
       where (p_since is null or i.at > p_since)
         and not exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = i.actor)
         and not exists (select 1 from public.user_blocks b where b.blocker_id = i.actor and b.blocked_id = v_uid)
       order by i.at desc, i.id
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', page.id,
             'kind', page.kind,
             'actor', public.author_json(page.actor),
             'postId', page.post_id,
             'text', page.body,
             'refId', page.ref_id,
             'meta', page.meta,
             'createdAt', public.iso_ts(page.at)
           ) order by page.at desc, page.id), '[]')
      from page
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Dane gracza: czyszczenie i eksport (do podpięcia w wipe_account_data / export_my_data – koordynator)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wszystko z rywalizacji o graczu: zgłoszenia społeczności, trofea, okazy w walkach (+ zdjęcia publiczne, wyprzedzenia),
-- pojedynki (także po stronie przeciwnika – znikają z jego historii jak przy usunięciu konta), własne wpisy księgi
-- nagrodzonych pojedynków (wpisy przeciwników z tym graczem zostają – limity przeciw farmom), widoczność w rankingach
-- wraca do domyślnej. XP z walk i pojedynków jest w księdze (wipe_game_data).
create or replace function public.wipe_rivalry_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.contest_reports where reporter_id = p_user;
  delete from public.contest_awards where user_id = p_user;
  delete from public.contest_overtakes where user_id = p_user;
  delete from public.rivalry_public_photos where owner = p_user;
  delete from public.contest_entries where user_id = p_user;         -- + zgłoszenia innych na te okazy (cascade)
  delete from public.duels where p_user in (challenger_id, opponent_id);
  delete from public.duel_rewards where user_id = p_user;
  update public.profiles set show_in_rankings = true where id = p_user and not show_in_rankings;
end $$;

-- Eksport (RODO art. 15/20): {"showInRankings", "contestEntries", "contestReports", "trophies", "duels"} – z danych innych
-- graczy tylko nick przeciwnika w pojedynku. Tablice nigdy null.
create or replace function public.export_rivalry_data(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'showInRankings', coalesce((select p.show_in_rankings from public.profiles p where p.id = p_user), true),
    'contestEntries', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'contestId', e.contest_id, 'findId', e.find_id, 'status', e.status, 'speciesId', e.species_id,
               'gminaId', e.gmina_id, 'capCm', e.cap_cm, 'relativePct', e.relative_pct, 'score', e.score,
               'foundAt', public.iso_ts(e.found_at), 'createdAt', public.iso_ts(e.created_at),
               'updatedAt', public.iso_ts(e.updated_at), 'reviewedAt', public.iso_ts(e.reviewed_at)
             ) order by e.created_at, e.id), '[]')
        from public.contest_entries e where e.user_id = p_user),
    'contestReports', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'entryId', r.entry_id, 'reason', r.reason, 'createdAt', public.iso_ts(r.created_at)
             ) order by r.created_at, r.id), '[]')
        from public.contest_reports r where r.reporter_id = p_user),
    'trophies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'contestId', a.contest_id, 'scope', a.scope, 'scopeName', a.scope_name, 'place', a.place,
               'speciesId', a.species_id, 'capCm', a.cap_cm, 'score', a.score, 'xp', a.xp,
               'awardedAt', public.iso_ts(a.awarded_at)
             ) order by a.awarded_at, a.id), '[]')
        from public.contest_awards a where a.user_id = p_user),
    'duels', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id,
               'opponentHandle', o.handle::text,
               'iAmChallenger', d.challenger_id = p_user,
               'kind', d.kind, 'days', d.days, 'status', d.status,
               'createdAt', public.iso_ts(d.created_at), 'startsAt', public.iso_ts(d.starts_at),
               'endsAt', public.iso_ts(d.ends_at), 'closedAt', public.iso_ts(d.closed_at),
               'myScore', case when d.challenger_id = p_user then d.challenger_score else d.opponent_score end,
               'opponentScore', case when d.challenger_id = p_user then d.opponent_score else d.challenger_score end,
               'outcome', case when d.status = 'finished' then
                            case when d.winner_id is null then 'draw' when d.winner_id = p_user then 'won' else 'lost' end end,
               'xp', case when d.challenger_id = p_user then d.challenger_xp else d.opponent_xp end
             ) order by d.created_at, d.id), '[]')
        from public.duels d
        join public.profiles o on o.id = case when d.challenger_id = p_user then d.opponent_id else d.challenger_id end
       where p_user in (d.challenger_id, d.opponent_id))
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Narzędzia deweloperskie (tylko przy app_config.dev_tools = true)
-- ─────────────────────────────────────────────────────────────────────────────

-- Znalezisko bota (odebrane, verified + size_verified – poza kępkami, widoczne: visible_from w przeszłości) z wpisem
-- 'find' w księdze XP (czas = czas znaleziska). Kapelusz = typowy × p_scale (najwyżej find_cap_factor × typowy).
create or replace function public.rivalry_bot_find(p_user uuid, p_species_id text, p_gmina_id text, p_found_at timestamptz,
  p_scale numeric)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  sp public.species;
  v_id uuid := gen_random_uuid();
  v_xp int;
  v_scale numeric := least(greatest(coalesce(p_scale, 1), 0.5), public.anti_cheat_param('find_cap_factor'));
begin
  select * into sp from public.species where id = p_species_id;
  v_xp := public.rarity_base(sp.rarity);
  insert into public.finds (id, user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, height_cm,
                            weight_g, pieces, xp, verified, size_verified, found_at, claimed_at, created_at, visible_from)
  values (v_id, p_user, sp.id, p_gmina_id, sp.rarity, 0.95, sp.edibility not in ('trujacy', 'smiertelny') and sp.protection is null,
          'claimed', round(sp.typical_cap_cm * v_scale, 1), round(sp.typical_height_cm * v_scale, 1),
          greatest(5, round(sp.typical_weight_g * v_scale * v_scale))::int,
          case when sp.clustered then 8 end, v_xp, true, not sp.clustered, p_found_at, p_found_at, p_found_at,
          least(p_found_at + public.privacy_delay(), now() - interval '1 minute'));
  insert into public.xp_events (user_id, source, ref_id, gmina_id, amount, created_at)
  values (p_user, 'find', v_id::text, p_gmina_id, v_xp, p_found_at);
  return v_id;
end $$;

-- Panel /dev: rywalizacja na botach (p_voivodeship null → województwo gminy domowej, inaczej podlaskie). Raz tworzy
-- 12 botów rywalizacji („rb<TERYT woj.>.<imię>”, konta nieanonimowe – mogą dostać nagrody) z gminą domową w województwie;
-- każdy bot bez okazu w tym tygodniu dostaje 1–2 zweryfikowane okazy (bieżący tydzień, widoczne) zgłoszone do walk,
-- a także okaz w poprzednim tygodniu (wyniki po dev_finalize_rivalry). Dla WYWOŁUJĄCEGO (idempotentnie): 3 boty-znajomi,
-- wyzwanie bota do gracza (biggest, 3 dni) i aktywny pojedynek gracza z botem (count, 3 dni, od doby, bot ma już okazy).
-- Okazy botów „publiczne od znalezienia” (created_at / shown_since = found_at) – przechodzą okno publiczności przed
-- rozstrzygnięciem. Zwraca (klucze po polsku – panel /dev pokazuje je wprost): {"wojewodztwo", "grzybiarze",
-- "okazy" (aktywne okazy botów w walkach bieżącego tygodnia), "znajomi", "pojedynki"}.
create or replace function public.dev_seed_rivalry(p_voivodeship text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_names text[] := array['Ania', 'Bogdan', 'Celina', 'Darek', 'Ela', 'Franek', 'Gabi', 'Henryk', 'Iza', 'Janek', 'Kinga', 'Leszek'];
  v_avatars text[] := array['bor', 'lisc', 'mech', 'rosa', 'wrzos', 'slonce', 'dab', 'lis', 'biedronka', 'sowa', 'zajac', 'wedrowiec'];
  v_voiv text;
  v_code text;
  v_week date := public.week_start(public.local_today());
  v_week_ts timestamptz;
  v_prev_ts timestamptz;
  v_now timestamptz := now();
  v_gminy text[];
  v_species text[];
  v_bots uuid[] := '{}';
  v_bot uuid;
  v_gmina text;
  v_sp text;
  v_find uuid;
  v_span interval;
  i int;
  k int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001', detail = 'Narzędzia deweloperskie są wyłączone.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then raise exception 'profile_not_found' using errcode = 'P0002', detail = 'Brak profilu gracza.'; end if;
  v_voiv := public.resolve_voivodeship(p_voivodeship, v_uid);
  perform pg_advisory_xact_lock(hashtext('dev_seed_rivalry'));
  perform public.ensure_contest_week(v_week);
  perform public.ensure_contest_week(v_week - 7);
  -- Poprzedni tydzień rozstrzygnięty bez podium (np. odczyt przed seedem) – lokalnie otwieramy go ponownie,
  -- żeby okazy botów weszły do wyników.
  update public.contest_entries e set final_rank_gmina = null, final_rank_wojewodztwo = null, final_rank_polska = null
    from public.contests c
   where c.id = e.contest_id and c.week_start = v_week - 7 and c.finalized_at is not null
     and not exists (select 1 from public.contest_awards a where a.contest_id = c.id);
  update public.contests c set finalized_at = null, next_check_at = null
   where c.week_start = v_week - 7 and c.finalized_at is not null
     and not exists (select 1 from public.contest_awards a where a.contest_id = c.id);
  v_week_ts := public.warsaw_ts(v_week);
  v_prev_ts := public.warsaw_ts(v_week - 7);
  v_span := greatest(v_now - interval '5 minutes' - v_week_ts, interval '1 minute');

  select substr(min(g.teryt), 1, 2) into v_code from public.gminy g where g.voivodeship = v_voiv;
  -- Gminy botów: gmina domowa gracza (gdy w tym województwie) + 4 najbardziej leśne.
  select array_agg(x.id order by x.ord, x.id) into v_gminy from (
    select g.id, 0 as ord from public.profiles p join public.gminy g on g.id = p.home_gmina_id
     where p.id = v_uid and g.voivodeship = v_voiv
    union
    select y.id, 1 from (select g.id from public.gminy g where g.voivodeship = v_voiv
                          order by g.forest_pct desc nulls last, g.id limit 4) y
  ) x;
  -- Gatunki: gatunki walk bieżącego tygodnia + kilka pospolitych jadalnych (do „Okazu tygodnia”).
  select array_agg(z.sp order by z.ord) into v_species from (
    select c.species_id as sp, c.sort as ord from public.contests c where c.week_start = v_week and c.species_id is not null
    union all
    select s.id, 10 + s.atlas_no from (
      select s2.id, s2.atlas_no from public.species s2
       where s2.active and s2.edibility = 'jadalny' and not s2.clustered and s2.protection is null and s2.typical_cap_cm >= 4
       order by s2.atlas_no limit 6) s
  ) z;

  for i in 1 .. array_length(v_names, 1) loop
    v_bot := public.dev_ensure_bot(
      format('rb%s.%s', v_code, translate(lower(v_names[i]), 'ąćęłńóśźż', 'acelnoszz')),
      v_names[i] || case i % 3 when 0 then '_Okaz' when 1 then '.las' else '' end, v_names[i]);
    continue when v_bot is null;
    v_bots := v_bots || v_bot;
    update auth.users set is_anonymous = false where id = v_bot and is_anonymous;
    v_gmina := v_gminy[1 + (i - 1) % array_length(v_gminy, 1)];
    update public.profiles
       set home_gmina_id = coalesce(home_gmina_id, v_gmina), avatar_preset = coalesce(avatar_preset, v_avatars[i]),
           show_in_rankings = true
     where id = v_bot;

    -- Bieżący tydzień: 1–2 okazy zgłoszone do walk.
    if not exists (select 1 from public.contest_entries e join public.contests c on c.id = e.contest_id
                    where e.user_id = v_bot and c.week_start = v_week) then
      for k in 1 .. 1 + (i % 2) loop
        v_sp := v_species[1 + (i + k) % array_length(v_species, 1)];
        v_find := public.rivalry_bot_find(v_bot, v_sp, v_gmina,
          v_week_ts + v_span * ((i * 7 + k * 3) % 20 + 1) / 21.0, 0.9 + ((i * 13 + k * 7) % 11) / 16.0);
        perform public.contest_enter_find(v_bot, v_find);
      end loop;
    end if;
    -- Poprzedni tydzień (do rozstrzygnięcia).
    if not exists (select 1 from public.contest_entries e join public.contests c on c.id = e.contest_id
                    where e.user_id = v_bot and c.week_start = v_week - 7) then
      v_sp := v_species[1 + i % array_length(v_species, 1)];
      v_find := public.rivalry_bot_find(v_bot, v_sp, v_gmina, v_prev_ts + make_interval(hours => 10 + i * 11),
                                        0.95 + (i % 7) / 10.0);
      perform public.contest_enter_find(v_bot, v_find);
    end if;
  end loop;
  update public.contest_entries e set created_at = e.found_at, shown_since = e.found_at
   where e.user_id = any(v_bots) and e.created_at > e.found_at
     and e.contest_id in (select c.id from public.contests c where c.week_start in (v_week, v_week - 7));

  -- Boty-znajomi gracza (3), wyzwanie bota (pending) i aktywny pojedynek (count).
  for i in 1 .. least(3, coalesce(array_length(v_bots, 1), 0)) loop
    continue when v_bots[i] = v_uid or public.is_blocked_pair(v_uid, v_bots[i]);
    update public.friendships set status = 'accepted'
     where ((user_id = v_uid and friend_id = v_bots[i]) or (user_id = v_bots[i] and friend_id = v_uid)) and status <> 'accepted';
    if not exists (select 1 from public.friendships f
                    where (f.user_id = v_uid and f.friend_id = v_bots[i]) or (f.user_id = v_bots[i] and f.friend_id = v_uid)) then
      insert into public.friendships (user_id, friend_id, status, created_at, accepted_at)
      values (v_bots[i], v_uid, 'accepted', v_now - interval '20 days', v_now - interval '20 days');
    end if;
  end loop;
  if coalesce(array_length(v_bots, 1), 0) >= 2 then
    insert into public.duels (id, challenger_id, opponent_id, kind, days, expires_at, created_at)
    select gen_random_uuid(), v_bots[1], v_uid, 'biggest', 3, v_now + interval '40 hours', v_now - interval '8 hours'
     where public.friend_status(v_uid, v_bots[1]) = 'friends'
    on conflict do nothing;
    if public.friend_status(v_uid, v_bots[2]) = 'friends'
       and not exists (select 1 from public.duels d where d.status in ('pending', 'active')
                        and least(d.challenger_id, d.opponent_id) = least(v_uid, v_bots[2])
                        and greatest(d.challenger_id, d.opponent_id) = greatest(v_uid, v_bots[2])) then
      insert into public.duels (id, challenger_id, opponent_id, kind, days, status, created_at, expires_at, responded_at,
                                starts_at, ends_at)
      values (gen_random_uuid(), v_uid, v_bots[2], 'count', 3, 'active', v_now - interval '26 hours', v_now + interval '22 hours',
              v_now - interval '24 hours', v_now - interval '24 hours', v_now + interval '48 hours');
      for k in 1 .. 3 loop
        perform public.rivalry_bot_find(v_bots[2], v_species[1 + k % array_length(v_species, 1)], v_gminy[1],
                                        v_now - make_interval(hours => 20 - k * 5), 1.0);
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'wojewodztwo', v_voiv,
    'grzybiarze', coalesce(array_length(v_bots, 1), 0),
    'okazy', (select count(*) from public.contest_entries e join public.contests c on c.id = e.contest_id
                 where c.week_start = v_week and e.status = 'active' and e.user_id = any(v_bots)),
    'znajomi', (select count(*) from unnest(v_bots) b(id) where public.friend_status(v_uid, b.id) = 'friends'),
    'pojedynki', (select count(*) from public.duels d where d.status in ('pending', 'active') and v_uid in (d.challenger_id, d.opponent_id))
  );
end $$;

-- Panel /dev: „symuluj rywali”. Boty przyjmują wyzwania gracza, boty-przeciwnicy w aktywnych pojedynkach z graczem
-- dokładają zweryfikowane okazy (teraz), a w każdej trwającej walce, w której gracz ma aktywny okaz, bot rywalizacji
-- z tego województwa zgłasza okaz o ~8% większy (widoczny od razu – aktywność contest_overtaken).
-- Zwraca {"przyjęte", "okazy" (w pojedynkach), "wyprzedzenia"}.
create or replace function public.dev_rivalry_act() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_accepted int := 0;
  v_finds int := 0;
  v_over int := 0;
  du record;
  e record;
  v_bot uuid;
  v_sp text;
  v_find uuid;
  v_scale numeric;
  k int;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001', detail = 'Narzędzia deweloperskie są wyłączone.'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002', detail = 'Brak profilu gracza.'; end if;

  -- 1. Boty przyjmują wyzwania gracza.
  update public.duels x
     set status = 'active', responded_at = now(), starts_at = now(), ends_at = now() + make_interval(days => x.days)
   where x.status = 'pending' and x.challenger_id = v_uid and x.expires_at > now()
     and exists (select 1 from public.profiles p where p.id = x.opponent_id and p.is_bot);
  get diagnostics v_accepted = row_count;

  -- 2. Okazy botów w aktywnych pojedynkach z graczem (czas = teraz, w oknie pojedynku).
  for du in
    select x.*, case when x.challenger_id = v_uid then x.opponent_id else x.challenger_id end as bot,
           (select g.id from public.profiles p join public.gminy g on g.id = p.home_gmina_id
             where p.id = case when x.challenger_id = v_uid then x.opponent_id else x.challenger_id end) as gmina
      from public.duels x
     where x.status = 'active' and v_uid in (x.challenger_id, x.opponent_id) and x.ends_at > now()
       and exists (select 1 from public.profiles p
                    where p.is_bot and p.id = case when x.challenger_id = v_uid then x.opponent_id else x.challenger_id end)
  loop
    for k in 1 .. case when du.kind = 'biggest' then 1 else 2 end loop
      select s.id into v_sp from public.species s
       where s.active and s.edibility = 'jadalny' and not s.clustered and s.protection is null and s.typical_cap_cm >= 4
       order by random() limit 1;
      perform public.rivalry_bot_find(du.bot, v_sp, coalesce(du.gmina, 'suprasl'), now() - interval '2 minutes',
                                      (case when du.kind = 'biggest' then 1.3 + random() * 0.3 else 1.0 end)::numeric);
      v_finds := v_finds + 1;
    end loop;
  end loop;

  -- 3. Bot wyprzedza gracza w trwających walkach (w województwie gminy okazu gracza).
  for e in
    select me.*, c.kind, g.voivodeship, sp.typical_cap_cm
      from public.contest_entries me
      join public.contests c on c.id = me.contest_id and c.finalized_at is null and now() < c.ends_at
      join public.gminy g on g.id = me.gmina_id
      join public.species sp on sp.id = me.species_id
     where me.user_id = v_uid and me.status = 'active'
  loop
    select p.id into v_bot
      from public.profiles p
     where p.is_bot and p.handle::text like 'rb%' and p.id <> v_uid
       and not exists (select 1 from public.contest_entries x
                        where x.contest_id = e.contest_id and x.user_id = p.id and x.status = 'active' and x.score > e.score)
     order by random() limit 1;
    continue when v_bot is null;
    v_sp := e.species_id;
    v_scale := least(e.cap_cm / e.typical_cap_cm * 1.08, public.anti_cheat_param('find_cap_factor'));
    continue when v_scale * e.typical_cap_cm <= e.cap_cm;   -- okaz gracza na granicy wiarygodności – nie do przebicia
    v_find := public.rivalry_bot_find(v_bot, v_sp, e.gmina_id, now() - interval '2 minutes', v_scale);
    update public.finds set visible_from = now() - interval '1 second' where id = v_find;
    perform public.contest_enter_find(v_bot, v_find);
    v_over := v_over + 1;
  end loop;

  return jsonb_build_object('przyjęte', v_accepted, 'okazy', v_finds, 'wyprzedzenia', v_over);
end $$;

-- Panel /dev: rozstrzyga od razu (bez czekania na resultsAt i 6 h kolejki): walki zakończonych tygodni (okazy w nich
-- stają się widoczne – lokalnie omija 24 h; bez czekania na moderację i okna publiczności – finalize_contest(…, true))
-- i pojedynki – aktywne pojedynki gracza kończą się teraz, pozostałe po ends_at. Zwraca {"walki", "trofea", "pojedynki"}
-- (ile rozstrzygnięto).
create or replace function public.dev_finalize_rivalry() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_contests int := 0;
  v_awards int := 0;
  v_duels int;
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000', detail = 'Zaloguj się, żeby rywalizować.'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001', detail = 'Narzędzia deweloperskie są wyłączone.'; end if;
  perform pg_advisory_xact_lock(hashtext('rivalry_finalize'));

  update public.finds f set visible_from = now() - interval '1 second'
    from public.contest_entries e join public.contests c on c.id = e.contest_id
   where e.find_id = f.id and c.finalized_at is null and c.ends_at <= now() and e.status = 'active'
     and (f.visible_from is null or f.visible_from > now());
  for r in select c.id from public.contests c where c.finalized_at is null and c.ends_at <= now() order by c.ends_at, c.id loop
    v_awards := v_awards + public.finalize_contest(r.id, true);
    v_contests := v_contests + 1;
  end loop;

  select count(*) into v_duels from public.duels d
   where d.status = 'active' and (v_uid in (d.challenger_id, d.opponent_id) or d.ends_at <= now());
  update public.duels d set ends_at = now()
   where d.status = 'active' and v_uid in (d.challenger_id, d.opponent_id) and d.ends_at > now();
  perform public.settle_duels(null, true);

  return jsonb_build_object('walki', v_contests, 'trofea', v_awards, 'pojedynki', v_duels);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.rivalry_params, public.contests, public.contest_entries, public.contest_reports, public.contest_awards,
  public.duels, public.duel_rewards, public.rivalry_public_photos, public.rivalry_duel_photos, public.contest_overtakes
  from anon, authenticated;
grant select, insert, update, delete on public.rivalry_params, public.contests, public.contest_entries, public.contest_reports,
  public.contest_awards, public.duels, public.duel_rewards, public.rivalry_public_photos, public.rivalry_duel_photos,
  public.contest_overtakes to service_role;
-- profiles.show_in_rankings – bez GRANT UPDATE (tylko set_ranking_visibility).

revoke all on function
  public.rivalry_param(text),
  public.contest_week_species(date),
  public.contest_species_title(text),
  public.ensure_contest_week(date),
  public.ensure_contest_for_id(text),
  public.contest_json(public.contests),
  public.rivalry_scope(text, text, uuid),
  public.contest_board_rows(text, uuid, text, text),
  public.contest_entry_json(uuid, uuid, int),
  public.contest_find_check(uuid, uuid, boolean),
  public.contest_eligibility_json(uuid, uuid, boolean),
  public.contest_enter_find(uuid, uuid),
  public.contest_prize(text, int),
  public.rivalry_ineligible_users(),
  public.rivalry_visible_at(timestamptz, timestamptz, timestamptz),
  public.contest_candidates(text, boolean, boolean),
  public.rivalry_photo_sync(uuid),
  public.rivalry_duel_photo_sync(uuid),
  public.rivalry_photo_paths_sync(),
  public.finalize_contest(text, boolean),
  public.ensure_contests_final(),
  public.duel_score(uuid, text, timestamptz, timestamptz),
  public.duel_best_json(uuid),
  public.duel_json(public.duels, uuid),
  public.finish_duel(uuid),
  public.settle_duels(uuid, boolean),
  public.duel_for(uuid, uuid),
  public.get_contest_week(date),
  public.get_contest_board(text, text, text),
  public.get_contest_eligibility(uuid),
  public.enter_contest(uuid),
  public.withdraw_contest_entry(text),
  public.report_contest_entry(uuid, text),
  public.admin_review_contest_entry(uuid, boolean, text),
  public.get_trophies(uuid),
  public.get_duels(),
  public.get_duel(uuid),
  public.create_duel(uuid, uuid, text, int),
  public.respond_duel(uuid, boolean),
  public.cancel_duel(uuid),
  public.get_player_ranking(text, text, text),
  public.set_ranking_visibility(boolean),
  public.get_rivalry_status(),
  public.rivalry_photo_readable(text),
  public.wipe_rivalry_data(uuid),
  public.export_rivalry_data(uuid),
  public.rivalry_bot_find(uuid, text, text, timestamptz, numeric),
  public.dev_seed_rivalry(text),
  public.dev_rivalry_act(),
  public.dev_finalize_rivalry()
  from public, anon, authenticated;

grant execute on function
  public.get_contest_week(date),
  public.get_contest_board(text, text, text),
  public.get_contest_eligibility(uuid),
  public.enter_contest(uuid),
  public.withdraw_contest_entry(text),
  public.report_contest_entry(uuid, text),
  public.get_trophies(uuid),
  public.get_duels(),
  public.get_duel(uuid),
  public.create_duel(uuid, uuid, text, int),
  public.respond_duel(uuid, boolean),
  public.cancel_duel(uuid),
  public.get_player_ranking(text, text, text),
  public.set_ranking_visibility(boolean),
  public.get_rivalry_status(),
  public.rivalry_photo_readable(text)                     -- polityka Storage „rywalizacja: odczyt zdjec okazow”
  to authenticated;
-- dev_seed_rivalry / dev_rivalry_act / dev_finalize_rivalry: migracja NIE nadaje EXECUTE (reguła z
-- 20261015103000_uszczelnienia.sql) – funkcje same sprawdzają dev_tools_enabled(), EXECUTE nadaje tylko seed lokalny
-- (scripts/seed-dev.ts). Pomocnik rivalry_bot_find celowo bez prefiksu dev_ (seed go nie wystawi).

grant execute on function public.admin_review_contest_entry(uuid, boolean, text) to service_role;
-- get_activity (create or replace) zachowuje dotychczasowe uprawnienia.
