-- =============================================================================
-- Rozpoznawanie ze zdjęcia – Edge Function `identify` (Claude, Anthropic API): limit kosztów na gracza
--
--  · identify_calls – dziennik wywołań BEZ zdjęć i wyników: kiedy, status, model, tokeny. Tylko limit i kontrola
--    kosztów (widok identify_usage); wiersze starsze niż 7 dni znikają przy kolejnych wywołaniach (dowolnego gracza).
--  · identify_begin(p_user) → id wywołania. Jedno rozpoznanie naraz (wiersz bez finished_at młodszy niż
--    identify_busy_s) i najwyżej identify_per_day w kroczącym oknie 24 h (wywołania 'failed' – błąd modelu / sieci po
--    stronie serwera – się nie liczą). Odrzucenie: P0001 'rate_limited' jak w etapie 7 (check_rate_limit – opis po
--    polsku w detail, hint 'retry_after=<ISO>', flaga rate_limited (3) przy wyczerpaniu limitu dobowego).
--  · identify_finish(p_id, p_user, p_status, …) – zamyka wiersz: 'ok' / 'refused' (odmowa modelu) / 'failed'.
--  · Tylko service_role (Edge Function z kluczem serwisowym) – klient nie widzi tabeli i nie woła funkcji, więc nie
--    zresetuje sobie licznika. Gracz = id z JWT sprawdzonego w funkcji, nigdy z treści żądania.
--  · Progi w anti_cheat_param (create or replace z kompletem dotychczasowych kluczy + identify_*).
--  · wipe_account_data kasuje też dziennik rozpoznań (usunięcie konta bez auth.admin – chmura).
-- =============================================================================

create table if not exists public.identify_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text check (status in ('ok', 'refused', 'failed')),
  model text check (model is null or length(model) <= 64),
  input_tokens int check (input_tokens is null or input_tokens >= 0),
  output_tokens int check (output_tokens is null or output_tokens >= 0),
  cache_read_tokens int check (cache_read_tokens is null or cache_read_tokens >= 0),
  cache_write_tokens int check (cache_write_tokens is null or cache_write_tokens >= 0)
);
create index if not exists identify_calls_user_started_idx on public.identify_calls (user_id, started_at desc);
create index if not exists identify_calls_started_idx on public.identify_calls (started_at);
alter table public.identify_calls enable row level security;
-- Brak polityk: klienci nie czytają ani nie zapisują dziennika (tylko funkcje poniżej; odczyt – service_role / Studio).

-- Progi: komplet z etapu 7 + rozpoznawanie.
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
    ('identify_per_day', 60),            -- rozpoznania zdjęć (Edge Function identify) w kroczącym oknie 24 h
    ('identify_busy_s', 60),             -- „jedno naraz”: niezamknięte wywołanie młodsze niż tyle blokuje następne
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

-- Początek rozpoznania (Edge Function, przed wywołaniem modelu). Zwraca id wiersza do identify_finish.
create or replace function public.identify_begin(p_user uuid) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := public.anti_cheat_param('identify_per_day')::int;
  v_busy_s int := public.anti_cheat_param('identify_busy_s')::int;
  v_busy timestamptz;
  v_used bigint;
  v_oldest timestamptz;
  v_id bigint;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  -- Równoległe wywołania jednego gracza po kolei (blokada do końca transakcji) – drugie widzi wiersz pierwszego.
  perform pg_advisory_xact_lock(hashtextextended('identify:' || p_user::text, 0));
  -- Dziennik żyje 7 dni.
  delete from public.identify_calls where started_at < now() - interval '7 days';

  select max(c.started_at) into v_busy
    from public.identify_calls c
   where c.user_id = p_user and c.finished_at is null and c.started_at > now() - make_interval(secs => v_busy_s);
  if v_busy is not null and not public.anti_cheat_bypass() then
    raise exception 'rate_limited' using errcode = 'P0001',
      detail = 'Poprzednie zdjęcie jeszcze się analizuje – poczekaj chwilę.',
      hint = 'retry_after=' || public.iso_ts(v_busy + make_interval(secs => v_busy_s));
  end if;

  select count(*), min(c.started_at) into v_used, v_oldest
    from public.identify_calls c
   where c.user_id = p_user and c.started_at > now() - interval '24 hours' and c.status is distinct from 'failed';
  perform public.check_rate_limit(
    p_user, 'identify', v_used, v_limit, '24 h (okno kroczące)',
    format('Dzienny limit rozpoznań (%s) został wyczerpany. Spróbuj ponownie później.', v_limit),
    v_oldest + interval '24 hours');

  insert into public.identify_calls (user_id) values (p_user) returning id into v_id;
  return v_id;
end $$;

-- Koniec rozpoznania: status i zużycie tokenów (do kontroli kosztów). Cudzy / zamknięty wiersz – nic.
create or replace function public.identify_finish(
  p_id bigint,
  p_user uuid,
  p_status text,
  p_model text default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_cache_read_tokens int default null,
  p_cache_write_tokens int default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_status is null or p_status not in ('ok', 'refused', 'failed') then
    raise exception 'invalid_status' using errcode = 'P0001', detail = format('Nieznany status rozpoznania: %s', p_status);
  end if;
  update public.identify_calls
     set finished_at = now(),
         status = p_status,
         model = left(p_model, 64),
         input_tokens = greatest(p_input_tokens, 0),
         output_tokens = greatest(p_output_tokens, 0),
         cache_read_tokens = greatest(p_cache_read_tokens, 0),
         cache_write_tokens = greatest(p_cache_write_tokens, 0)
   where id = p_id and user_id = p_user and finished_at is null;
end $$;

-- Koszty dzień po dniu (Europe/Warsaw) i model: wywołania, gracze, tokeny. Tylko service_role / Studio.
create or replace view public.identify_usage with (security_invoker = true) as
select (c.started_at at time zone 'Europe/Warsaw')::date as day,
       coalesce(c.model, '?') as model,
       count(*) as calls,
       count(*) filter (where c.status = 'ok') as ok,
       count(*) filter (where c.status = 'refused') as refused,
       count(*) filter (where c.status = 'failed') as failed,
       count(*) filter (where c.status is null) as unfinished,
       count(distinct c.user_id) as users,
       coalesce(sum(c.input_tokens), 0) as input_tokens,
       coalesce(sum(c.output_tokens), 0) as output_tokens,
       coalesce(sum(c.cache_read_tokens), 0) as cache_read_tokens,
       coalesce(sum(c.cache_write_tokens), 0) as cache_write_tokens
  from public.identify_calls c
 group by 1, 2;

-- Usunięcie konta: jak w etapie 7 + dziennik rozpoznań.
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
  delete from public.identify_calls where user_id = p_user;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.identify_calls, public.identify_usage from anon, authenticated;
grant select on public.identify_calls, public.identify_usage to service_role;
revoke all on function
  public.identify_begin(uuid),
  public.identify_finish(bigint, uuid, text, text, int, int, int, int)
  from public, anon, authenticated;
grant execute on function
  public.identify_begin(uuid),
  public.identify_finish(bigint, uuid, text, text, int, int, int, int)
  to service_role;
-- anti_cheat_param i wipe_account_data (create or replace) zachowują dotychczasowe uprawnienia.
