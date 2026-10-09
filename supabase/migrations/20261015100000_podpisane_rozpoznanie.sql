-- =============================================================================
-- Podpisane rozpoznanie (anty-cheat; docs/rywalizacja.md §1, docs/backend.md → „Podpisane rozpoznanie”)
--
-- Do tej pory submit_find przyjmował od telefonu gatunek, rzadkość (+1 stopień bez flagi), pewność, wymiary, XXL,
-- gminę i czas, a wynik Edge Function `identify` nigdzie nie był zapisywany. Teraz:
--  · recognitions – wynik rozpoznania zapisany przez serwer (Edge Function `identify`, service_role): werdykt, gatunek
--    i kandydaci, pewność (z bezpiecznikiem sobowtórów jak w aplikacji), liczba owocników, kapelusz / wysokość (tylko
--    przy odniesieniu skali), odniesienie skali, ocena „reprodukcji” (zdjęcie ekranu / wydruku / zdjęcie zdjęcia),
--    SHA-256 zdjęć, zdjęcie główne w Storage (scan-photos/{uid}/rec/{id}.jpg – zapisuje funkcja), gmina wyliczona
--    na serwerze z pozycji (gmina_at; współrzędne nie są zapisywane i nie idą do modelu), model, ważność (14 dni –
--    jak tolerancja kolejki offline; „wyścigi czasowe” i tak liczą found_at = czas rozpoznania).
--    Statusy: pending (model pracuje) → issued (do użycia) | rejected (nie grzyb, niewyraźne, reprodukcja, gatunek
--    spoza atlasu, pewność < 60%) → consumed (znalezisko) | expired (nieużyte w terminie). Klient nie ma do tabeli
--    dostępu (wynik dostaje w odpowiedzi funkcji, flagi znaleziska – w get_game_state; eksport – export_recognitions).
--  · recognition_images – SHA-256 KAŻDEGO zdjęcia (główne + ujęcia skanu 3D), globalnie unikalne: ten sam obraz drugi
--    raz – u kogokolwiek – jest odrzucany przed wywołaniem modelu (bez kosztu). Wyjątek: ten sam gracz, to samo
--    zdjęcie, rozpoznanie wciąż ważne / odrzucone → zapisany wynik bez ponownego wołania modelu („Spróbuj ponownie”).
--    Skrót to dokładna kopia pliku – ponownie zakodowany obraz go omija (to nie jest skrót percepcyjny).
--  · Edge Function: recognition_begin (skróty, limity, gmina) → zapis zdjęcia → model → recognition_finish (wynik,
--    dziennik kosztów) → odpowiedź; recognition_cleanup – przeterminowane i porzucone (ścieżki plików do usunięcia).
--  · Limity kosztów (audyt #6): wywołanie, które dotarło do modelu, liczy się do limitu także przy błędzie / przerwaniu
--    (identify_calls.charged); globalny dzienny limit gry (identify_global_per_day → P0001 service_busy, funkcja: 503);
--    niższy limit dla kont młodszych niż 24 h. Progi w anti_cheat_params.
--  · submit_find(…, p_recognition_id): z id – gatunek, rzadkość, pewność, kandydaci, wymiary, gmina (serwera, gdy jest),
--    czas (= czas rozpoznania) i zdjęcie z rekordu; finds.verified = true, size_verified = kapelusz zmierzony przy skali.
--    ZAWSZE: rzadkość = rzadkość gatunku, waga i XXL liczone na serwerze (typowa × (kapelusz / typowy)², jak
--    estimateDimensions w aplikacji). Bez id – tylko przy dev_tools (lokalnie: wymuszony wynik skanu, testy),
--    znalezisko niezweryfikowane; na produkcji P0001 recognition_required.
--  · Percentyl (audyt #9): tylko znaleziska zweryfikowane, k-anonimowość (≥ 5 okazów i ≥ 3 znalazców, inaczej „brak
--    porównania” – kształt jak przy braku danych + comparable = false), waga porównywana w progach co 10%
--    (skala logarytmiczna) – dowolnym p_weight_g da się poznać najwyżej histogram, nie cudze wagi.
--  · get_gmina_stats: rekordy tylko z okazów size_verified, bez kępek (pieces > 1).
--  · set_find_photo: znalezisko z rozpoznaniem ma zdjęcie z rozpoznania – bez podmiany; folder rec/ zarezerwowany.
--  · get_game_state: znaleziska + recognitionId, verified, sizeVerified.
--  · wipe_account_data: + rozpoznania (i skróty zdjęć); user_storage_paths: + zdjęcia rozpoznań.
--  · Storage scan-photos/{uid}/rec/…: klient nie zapisuje i nie podmienia; usuwa tylko plik, do którego nic się już
--    nie odwołuje (po skasowaniu danych – usunięcie konta, „Nowy gracz”).
--  · Boty deweloperskie: ich znaleziska liczą się jak zweryfikowane (wyzwalacz) – dane testowe rankingów i rekordów.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Progi
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.anti_cheat_params (k, v, note) values
  ('recognition_ttl_h', 336, 'ważność podpisanego rozpoznania (14 dni, jak kolejka offline) – find.submit najpóźniej po tylu godzinach'),
  ('recognition_min_confidence', 0.6, 'znalezisko z rozpoznania od tej pewności (jak LOW_CONFIDENCE w aplikacji)'),
  ('recognition_pending_s', 120, 'rozpoznanie bez wyniku dłużej niż tyle – porzucone (recognition_begin, recognition_cleanup)'),
  ('recognition_rejected_keep_d', 30, 'odrzucone rozpoznania (nie grzyb, niewyraźne…) – usuwane po tylu dniach'),
  ('identify_global_per_day', 3000, 'wszystkie rozpoznania w grze na dobę (Europe/Warsaw) – powyżej: service_busy (503)'),
  ('identify_new_account_per_day', 20, 'limit rozpoznań w 24 h dla konta młodszego niż identify_new_account_h'),
  ('identify_new_account_h', 24, 'wiek konta (h), od którego obowiązuje zwykły limit identify_per_day'),
  ('identify_max_accuracy_m', 1000, 'pozycja z dokładnością gorszą niż tyle metrów – bez gminy z serwera'),
  ('percentile_min_finds', 5, 'porównanie okazu (percentyl) od tylu zweryfikowanych okazów gatunku w gminie…'),
  ('percentile_min_users', 3, '…i tylu różnych znalazców (k-anonimowość)'),
  ('percentile_step_pct', 10, 'porównanie wagi w progach co tyle procent (skala logarytmiczna)')
on conflict (k) do update set v = excluded.v, note = excluded.note;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

-- Dziennik kosztów: czy wywołanie dotarło do modelu (koszt) – także przy błędzie, przerwaniu, odpowiedzi poza
-- schematem. null = starsza wersja funkcji (wtedy liczy się jak dotąd: wszystko poza 'failed').
alter table public.identify_calls add column if not exists charged boolean;

create table if not exists public.recognitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,     -- z JWT (Edge Function)
  created_at timestamptz not null default now(),                                -- czas serwera = found_at znaleziska
  status text not null default 'pending' check (status in ('pending', 'issued', 'consumed', 'expired', 'rejected')),
  verdict text check (verdict in ('mushroom', 'not_mushroom', 'unclear')),
  reason text check (reason is null or char_length(reason) <= 200),
  species_id text references public.species (id),                               -- najlepszy kandydat
  candidates jsonb not null default '[]' check (jsonb_typeof(candidates) = 'array'),   -- [{speciesId, confidence}]
  confidence numeric(4, 3) check (confidence between 0 and 1),                 -- z bezpiecznikiem sobowtórów
  visible_parts text[] not null default '{}' check (visible_parts <@ array['cap', 'underside', 'stem', 'base']),
  count smallint check (count between 0 and 200),
  cap_cm numeric(4, 1) check (cap_cm > 0 and cap_cm <= 80),                     -- tylko przy odniesieniu skali
  height_cm numeric(4, 1) check (height_cm > 0 and height_cm <= 100),
  maturity text check (maturity in ('young', 'mature', 'old', 'unknown')),
  scale_ref text not null default 'none' check (scale_ref in ('none', 'hand', 'coin', 'card', 'knife', 'other')),
  reproduction boolean not null default false,                                  -- ekran / wydruk / zdjęcie zdjęcia
  views smallint not null default 1 check (views between 1 and 4),            -- liczba ujęć (główne + skan 3D)
  image_sha256 text[] not null
    check (cardinality(image_sha256) between 1 and 4
           and array_to_string(image_sha256, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64}){0,3}$'),
  photo_path text check (photo_path is null or public.is_user_image_path(photo_path, user_id)),
  gmina_id text references public.gminy (id),                                  -- gmina_at(pozycja) – null bez pozycji / granic
  model text check (model is null or char_length(model) <= 64),
  call_id bigint,                                                               -- identify_calls.id (dziennik kosztów)
  find_id uuid unique references public.finds (id) on delete set null,          -- jedno rozpoznanie = jedno znalezisko
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists recognitions_user_idx on public.recognitions (user_id, created_at desc);
create index if not exists recognitions_issued_expiry_idx on public.recognitions (expires_at) where status = 'issued';
create index if not exists recognitions_pending_idx on public.recognitions (created_at) where status = 'pending';
create index if not exists recognitions_photo_idx on public.recognitions (photo_path) where photo_path is not null;
alter table public.recognitions enable row level security;
-- Brak polityk: klient nie czyta ani nie zapisuje rozpoznań (Edge Function – service_role; reszta przez RPC).

create table if not exists public.recognition_images (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),                  -- globalnie unikalny obraz
  recognition_id uuid not null references public.recognitions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade
);
create index if not exists recognition_images_recognition_idx on public.recognition_images (recognition_id);
create index if not exists recognition_images_user_idx on public.recognition_images (user_id);
alter table public.recognition_images enable row level security;
-- Brak polityk: tylko funkcje serwera.

alter table public.finds add column if not exists recognition_id uuid unique references public.recognitions (id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Boty deweloperskie: znaleziska jak zweryfikowane (rankingi, rekordy, percentyl i walki na danych testowych)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wstawione z verified = false (domyślnie) → verified = true; size_verified = kapelusz znany i pojedynczy owocnik.
-- Kto chce niezweryfikowanego bota (test), zmienia flagi po wstawieniu.
create or replace function public.finds_bot_verified() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.is_bot_player(new.user_id) then
    new.verified := true;
    new.size_verified := new.size_verified or (new.cap_cm is not null and coalesce(new.pieces, 1) <= 1);
  end if;
  return new;
end $$;
drop trigger if exists finds_bot_verified on public.finds;
create trigger finds_bot_verified before insert on public.finds
  for each row when (not new.verified) execute function public.finds_bot_verified();

update public.finds f
   set verified = true,
       size_verified = f.size_verified or (f.cap_cm is not null and coalesce(f.pieces, 1) <= 1)
  from public.profiles p
 where p.id = f.user_id and p.is_bot and not f.verified;

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wymiary okazu – lustro estimateDimensions (src/utils/identify.ts): skala = kapelusz / typowy (bez kapelusza:
-- wysokość / typowa, bez obu: 1), przycięta do 0,3–3; brakujący kapelusz / wysokość = typowe × skala (zaokrąglone do
-- 1 cm jak w aplikacji); sztuka = typowa waga × skala² (co 5 g, ≥ 5 g); kępka – sztuki × sztuka; XXL (nie kępki) od
-- xxl_factor × typowej wagi. Wynik: {cap_cm, height_cm, weight_g, pieces, xxl} (pieces null poza kępkami).
create or replace function public.find_dimensions(p_species_id text, p_cap numeric, p_height numeric, p_count int)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  sp public.species;
  v_scale numeric;
  v_piece int;
  v_pieces int;
  v_weight int;
begin
  select * into sp from public.species where id = p_species_id;
  if not found then return null; end if;
  v_scale := case when p_cap > 0 then p_cap / sp.typical_cap_cm
                  when p_height > 0 then p_height / sp.typical_height_cm
                  else 1 end;
  v_scale := least(3, greatest(0.3, v_scale));
  v_piece := greatest(5, round(sp.typical_weight_g * v_scale * v_scale / 5) * 5)::int;
  v_pieces := case when sp.clustered then least(200, greatest(1, coalesce(p_count, 1))) end;
  v_weight := coalesce(v_pieces, 1) * v_piece;
  return jsonb_build_object(
    'cap_cm', case when p_cap > 0 then round(p_cap, 1) else greatest(1, round(sp.typical_cap_cm * v_scale)) end,
    'height_cm', case when p_height > 0 then round(p_height, 1) else greatest(1, round(sp.typical_height_cm * v_scale)) end,
    'weight_g', v_weight,
    'pieces', v_pieces,
    'xxl', not sp.clustered and v_weight >= sp.typical_weight_g * public.anti_cheat_param('xxl_factor')
  );
end $$;

-- Odpowiedź Edge Function z rekordu (kształt IdentifyFunctionResponse w supabase/functions/identify/contract.ts):
-- pola modelu + recognitionId (tylko rozpoznanie do użycia / użyte), sizeMeasured, expiresAt (tylko do użycia).
create or replace function public.recognition_json(r public.recognitions) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'verdict', r.verdict,
    'reason', coalesce(r.reason, ''),
    'candidates', r.candidates,
    'visibleParts', to_jsonb(r.visible_parts),
    'count', coalesce(r.count, 0),
    'capCm', r.cap_cm,
    'heightCm', r.height_cm,
    'maturity', coalesce(r.maturity, 'unknown'),
    'scaleReference', r.scale_ref,
    'reproduction', r.reproduction,
    'recognitionId', case when r.status in ('issued', 'consumed') then r.id end,
    'sizeMeasured', r.cap_cm is not null and r.scale_ref <> 'none' and not r.reproduction,
    'expiresAt', case when r.status = 'issued' then public.iso_ts(r.expires_at) end
  )
$$;

-- Limity rozpoznań (wspólne dla identify_begin i recognition_begin). Liczą się wywołania, które dotarły do modelu:
-- zakończone 'ok' / 'refused', w toku (status null – także ubite przez platformę) i 'failed' z charged = true.
--  · jedno naraz: niezamknięte wywołanie młodsze niż identify_busy_s → rate_limited;
--  · gracz: identify_per_day w kroczącym 24 h (konto młodsze niż identify_new_account_h – identify_new_account_per_day);
--  · gra: identify_global_per_day na dobę (Europe/Warsaw) → P0001 service_busy (Edge Function: 503).
-- Obejście (dev): anti_cheat_bypass().
create or replace function public.identify_check_limits(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_busy_s int := public.anti_cheat_param('identify_busy_s')::int;
  v_new boolean;
  v_limit int;
  v_busy timestamptz;
  v_used bigint;
  v_oldest timestamptz;
  v_global bigint;
  v_global_limit int := public.anti_cheat_param('identify_global_per_day')::int;
begin
  select max(c.started_at) into v_busy
    from public.identify_calls c
   where c.user_id = p_user and c.finished_at is null and c.started_at > now() - make_interval(secs => v_busy_s);
  if v_busy is not null and not public.anti_cheat_bypass() then
    raise exception 'rate_limited' using errcode = 'P0001',
      detail = 'Poprzednie zdjęcie jeszcze się analizuje – poczekaj chwilę.',
      hint = 'retry_after=' || public.iso_ts(v_busy + make_interval(secs => v_busy_s));
  end if;

  select p.created_at > now() - make_interval(hours => public.anti_cheat_param('identify_new_account_h')::int)
    into v_new
    from public.profiles p where p.id = p_user;
  v_limit := case when coalesce(v_new, false)
                  then least(public.anti_cheat_param('identify_new_account_per_day'), public.anti_cheat_param('identify_per_day'))
                  else public.anti_cheat_param('identify_per_day') end::int;
  select count(*), min(c.started_at) into v_used, v_oldest
    from public.identify_calls c
   where c.user_id = p_user and c.started_at > now() - interval '24 hours'
     and (c.status is distinct from 'failed' or c.charged);
  perform public.check_rate_limit(
    p_user, 'identify', v_used, v_limit, '24 h (okno kroczące)',
    case when coalesce(v_new, false)
         then format('Nowe konto: w pierwszej dobie limit rozpoznań to %s – został wyczerpany. Spróbuj ponownie później.', v_limit)
         else format('Dzienny limit rozpoznań (%s) został wyczerpany. Spróbuj ponownie później.', v_limit) end,
    v_oldest + interval '24 hours');

  if not public.anti_cheat_bypass() then
    select count(*) into v_global
      from public.identify_calls c
     where c.started_at >= public.warsaw_ts(public.local_today())
       and (c.status is distinct from 'failed' or c.charged);
    if v_global >= v_global_limit then
      raise log 'anti_cheat identify_global: used=% limit=%', v_global, v_global_limit;
      raise exception 'service_busy' using errcode = 'P0001',
        detail = 'Dzienny limit rozpoznań w grze został wyczerpany – spróbuj później albo jutro.',
        hint = 'retry_after=' || public.iso_ts(public.warsaw_ts(public.local_today() + 1));
    end if;
  end if;
end $$;

-- Starszy początek wywołania (Edge Function sprzed podpisanego rozpoznania) – te same limity co recognition_begin.
create or replace function public.identify_begin(p_user uuid) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id bigint;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identify:' || p_user::text, 0));
  delete from public.identify_calls where started_at < now() - interval '7 days';
  perform public.identify_check_limits(p_user);
  insert into public.identify_calls (user_id) values (p_user) returning id into v_id;
  return v_id;
end $$;

-- Plik zdjęcia rozpoznania (scan-photos/{uid}/rec/…), do którego nic się już nie odwołuje – klient może go usunąć
-- (polityka Storage). Tylko własny folder wywołującego. Wywołuje ją polityka storage.objects → EXECUTE dla authenticated.
create or replace function public.rec_photo_released(p_name text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select auth.uid() is not null
     and starts_with(p_name, auth.uid()::text || '/rec/')
     and not exists (select 1 from public.recognitions r where r.photo_path = p_name)
     and not exists (select 1 from public.finds f where f.user_id = auth.uid() and f.photo_path = p_name)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Edge Function `identify` (tylko service_role)
-- ─────────────────────────────────────────────────────────────────────────────

-- Początek rozpoznania – PRZED zapisem zdjęcia i wywołaniem modelu.
--  · p_hashes – SHA-256 (hex) zdjęcia głównego i ujęć skanu 3D (1–4, główne pierwsze);
--  · obraz u innego gracza → P0001 image_reused; ten sam gracz: rozpoznanie w toku → rate_limited, ważne (issued)
--    albo odrzucone → {"cached": odpowiedź} (bez modelu i bez limitu), zużyte / przeterminowane → image_reused;
--  · limity (identify_check_limits); gmina z pozycji (gmina_at – tylko w Polsce, dokładność ≤ identify_max_accuracy_m;
--    współrzędne nie są nigdzie zapisywane);
--  · porzucone 'pending' (starsze niż recognition_pending_s – funkcja ubita w trakcie) gracza albo trzymające te obrazy
--    są usuwane od razu (nie blokują „jeszcze się analizuje”); ich pliki – w "stalePaths" do usunięcia przez funkcję;
--  · zapisuje wywołanie (identify_calls) i rozpoznanie 'pending' ze skrótami (rezerwacja obrazów) i ścieżką zdjęcia
--    (od początku – plik w stanie pending nie jest „zwolniony” dla klienta, rec_photo_released).
-- Wynik: {"callId", "recognitionId", "photoPath": "{uid}/rec/{id}.jpg", "stalePaths"} albo {"cached": {…}, "stalePaths"}.
create or replace function public.recognition_begin(
  p_user uuid,
  p_hashes text[],
  p_lat double precision default null,
  p_lon double precision default null,
  p_accuracy_m double precision default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.recognitions;
  v_call bigint;
  v_id uuid := gen_random_uuid();
  v_gmina text;
  v_stale text[];
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  if p_hashes is null or cardinality(p_hashes) not between 1 and 4
     or array_to_string(p_hashes, ',') !~ '^[0-9a-f]{64}(,[0-9a-f]{64}){0,3}$' then
    raise exception 'invalid_hashes' using errcode = 'P0001', detail = 'Skróty zdjęć: od 1 do 4 × SHA-256 (hex, małe litery)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identify:' || p_user::text, 0));
  delete from public.identify_calls where started_at < now() - interval '7 days';

  -- Porzucone 'pending' (Edge Function ubita w trakcie): gracza i trzymające te obrazy – obrazy znów wolne.
  with d as (
    delete from public.recognitions x
     where x.status = 'pending'
       and x.created_at < now() - make_interval(secs => public.anti_cheat_param('recognition_pending_s')::int)
       and (x.user_id = p_user
            or x.id in (select i.recognition_id from public.recognition_images i where i.sha256 = any(p_hashes)))
    returning x.user_id::text || '/rec/' || x.id::text || '.jpg' as path
  )
  select coalesce(array_agg(d.path), '{}') into v_stale from d;

  if exists (select 1 from public.recognition_images i where i.sha256 = any(p_hashes) and i.user_id <> p_user) then
    raise exception 'image_reused' using errcode = 'P0001',
      detail = 'To zdjęcie jest już w grze – zrób własne zdjęcie grzyba.';
  end if;

  -- Ten sam gracz, to samo zdjęcie główne: ponowienie (np. „Spróbuj ponownie” po błędzie sieci).
  select x.* into r
    from public.recognition_images i join public.recognitions x on x.id = i.recognition_id
   where i.sha256 = p_hashes[1] and i.user_id = p_user and x.image_sha256[1] = p_hashes[1];
  if found then
    if r.status = 'pending' then
      raise exception 'rate_limited' using errcode = 'P0001',
        detail = 'To zdjęcie jeszcze się analizuje – poczekaj chwilę.',
        hint = 'retry_after=' || public.iso_ts(now() + interval '15 seconds');
    end if;
    if r.status = 'rejected' or (r.status = 'issued' and r.expires_at > now()) then
      return jsonb_build_object('cached', public.recognition_json(r), 'stalePaths', to_jsonb(v_stale));
    end if;
    raise exception 'image_reused' using errcode = 'P0001',
      detail = 'To zdjęcie było już rozpoznane – zrób nowe zdjęcie grzyba.';
  end if;
  if exists (select 1 from public.recognition_images i where i.sha256 = any(p_hashes)) then
    raise exception 'image_reused' using errcode = 'P0001',
      detail = 'Ujęcie z tego skanu było już rozpoznane – zrób nowe zdjęcia grzyba.';
  end if;

  perform public.identify_check_limits(p_user);

  if p_lat between 49.0 and 55.0 and p_lon between 14.0 and 24.2
     and coalesce(p_accuracy_m, 0) between 0 and public.anti_cheat_param('identify_max_accuracy_m') then
    v_gmina := public.gmina_at(p_lon, p_lat);
  end if;

  insert into public.identify_calls (user_id) values (p_user) returning id into v_call;
  insert into public.recognitions (id, user_id, status, image_sha256, views, gmina_id, call_id, photo_path, expires_at)
  values (v_id, p_user, 'pending', p_hashes, cardinality(p_hashes), v_gmina, v_call,
          p_user::text || '/rec/' || v_id::text || '.jpg',
          now() + make_interval(hours => public.anti_cheat_param('recognition_ttl_h')::int));
  begin
    insert into public.recognition_images (sha256, recognition_id, user_id)
    select distinct h, v_id, p_user from unnest(p_hashes) h;
  exception when unique_violation then
    -- Wyścig z innym graczem o ten sam obraz – całe wywołanie się wycofuje.
    raise exception 'image_reused' using errcode = 'P0001',
      detail = 'To zdjęcie jest już w grze – zrób własne zdjęcie grzyba.';
  end;
  return jsonb_build_object(
    'callId', v_call,
    'recognitionId', v_id,
    'photoPath', p_user::text || '/rec/' || v_id::text || '.jpg',
    'stalePaths', to_jsonb(v_stale)
  );
end $$;

-- Koniec rozpoznania: dziennik kosztów (identify_finish + charged) i wynik modelu w rekordzie.
--  · p_status 'failed' albo brak wyniku → rozpoznanie znika (obrazy wolne – gracz może ponowić), wynik null;
--  · p_result – znormalizowana odpowiedź modelu (normalizeIdent); serwer sprawdza ją jeszcze raz: gatunki z katalogu,
--    zakresy, odniesienie skali (bez niego – bez wymiarów), reprodukcja → 'unclear' z powodem, pewność z bezpiecznikiem
--    sobowtórów (jak safeConfidence w aplikacji);
--  · status: issued (grzyb z atlasu, nie reprodukcja, pewność ≥ recognition_min_confidence) albo rejected; ścieżka
--    zdjęcia (wpisana w recognition_begin) zostaje tylko przy issued (odrzucone: Edge Function kasuje plik).
--    p_photo_path – zgodność ze starszą funkcją, pomijany.
-- Wynik: odpowiedź dla aplikacji (recognition_json). Cudze / zamknięte rozpoznanie → null (bez zmian).
create or replace function public.recognition_finish(
  p_call_id bigint,
  p_user uuid,
  p_recognition_id uuid,
  p_status text,
  p_charged boolean,
  p_result jsonb default null,
  p_photo_path text default null,
  p_model text default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_cache_read_tokens int default null,
  p_cache_write_tokens int default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.recognitions;
  v_verdict text;
  v_reason text;
  v_repro boolean;
  v_scale text;
  v_cands jsonb;
  v_top text;
  v_conf numeric;
  v_parts text[];
  v_count int;
  v_cap numeric;
  v_height numeric;
  v_maturity text;
  v_status text;
  v_photo text;
begin
  perform public.identify_finish(p_call_id, p_user, p_status, p_model, p_input_tokens, p_output_tokens,
                                 p_cache_read_tokens, p_cache_write_tokens);
  update public.identify_calls
     set charged = coalesce(p_charged, p_status in ('ok', 'refused'))
   where id = p_call_id and user_id = p_user;

  select * into r from public.recognitions
   where id = p_recognition_id and user_id = p_user and status = 'pending'
   for update;
  if not found then return null; end if;

  v_verdict := p_result ->> 'verdict';
  if p_status = 'failed' or jsonb_typeof(p_result) is distinct from 'object'
     or v_verdict is null or v_verdict not in ('mushroom', 'not_mushroom', 'unclear') then
    delete from public.recognitions where id = r.id;
    return null;
  end if;

  v_reason := left(btrim(regexp_replace(coalesce(p_result ->> 'reason', ''), '\s+', ' ', 'g')), 200);
  v_repro := coalesce(p_result -> 'reproduction' = 'true'::jsonb, false);
  v_scale := case when p_result ->> 'scaleReference' in ('none', 'hand', 'coin', 'card', 'knife', 'other')
                  then p_result ->> 'scaleReference' else 'none' end;
  if v_repro then
    v_verdict := 'unclear';
    v_reason := 'To wygląda na zdjęcie ekranu albo wydruku – zrób zdjęcie prawdziwego grzyba.';
  end if;

  if v_verdict = 'mushroom' then
    with raw as (
      select c ->> 'speciesId' as sid,
             case when jsonb_typeof(c -> 'confidence') = 'number'
                  then least(1, greatest(0, (c ->> 'confidence')::numeric)) end as conf
        from jsonb_array_elements(case when jsonb_typeof(p_result -> 'candidates') = 'array'
                                       then p_result -> 'candidates' else '[]'::jsonb end) c
       where jsonb_typeof(c) = 'object'
    ), best as (
      select raw.sid, round(max(raw.conf), 3) as conf
        from raw join public.species s on s.id = raw.sid
       where raw.conf is not null
       group by raw.sid
    )
    select coalesce(jsonb_agg(jsonb_build_object('speciesId', b.sid, 'confidence', b.conf) order by b.conf desc, b.sid), '[]')
      into v_cands
      from (select * from best order by best.conf desc, best.sid limit 3) b;
    v_top := v_cands -> 0 ->> 'speciesId';
    v_conf := (v_cands -> 0 ->> 'confidence')::numeric;
    -- Bezpiecznik sobowtórów (safeConfidence): niegroźny zwycięzca, groźny kandydat ≥ 15% → najwyżej 55%.
    if v_top is not null
       and (select s.edibility from public.species s where s.id = v_top) not in ('trujacy', 'smiertelny')
       and exists (
         select 1 from jsonb_array_elements(v_cands) with ordinality c (x, i)
           join public.species s on s.id = c.x ->> 'speciesId'
          where c.i > 1 and s.edibility in ('trujacy', 'smiertelny') and (c.x ->> 'confidence')::numeric >= 0.15) then
      v_conf := least(v_conf, 0.55);
    end if;
    select coalesce(array_agg(p order by array_position(array['cap', 'underside', 'stem', 'base'], p)), '{}')
      into v_parts
      from (select distinct x as p
              from jsonb_array_elements_text(case when jsonb_typeof(p_result -> 'visibleParts') = 'array'
                                                  then p_result -> 'visibleParts' else '[]'::jsonb end) x
             where x in ('cap', 'underside', 'stem', 'base')) q;
    v_count := case when jsonb_typeof(p_result -> 'count') = 'number'
                    then least(200, greatest(1, round((p_result ->> 'count')::numeric)))::int else 1 end;
    if v_scale <> 'none' then
      v_cap := case when jsonb_typeof(p_result -> 'capCm') = 'number' then (p_result ->> 'capCm')::numeric end;
      v_cap := case when v_cap > 0.5 and v_cap <= 80 then round(v_cap * 2) / 2 end;
      v_height := case when jsonb_typeof(p_result -> 'heightCm') = 'number' then (p_result ->> 'heightCm')::numeric end;
      v_height := case when v_height > 0.5 and v_height <= 100 then round(v_height * 2) / 2 end;
    end if;
    v_maturity := case when p_result ->> 'maturity' in ('young', 'mature', 'old', 'unknown') then p_result ->> 'maturity' else 'unknown' end;
  else
    v_cands := '[]';
    v_parts := '{}';
    v_count := 0;
    v_maturity := 'unknown';
    if v_reason = '' then
      v_reason := case v_verdict
        when 'not_mushroom' then 'Nie widzę tu grzyba – wyceluj aparat w owocnik i spróbuj jeszcze raz.'
        else 'Nie widać wyraźnie – podejdź bliżej, zadbaj o światło i spróbuj jeszcze raz.' end;
    end if;
  end if;

  v_status := case when v_verdict = 'mushroom' and v_top is not null and not v_repro
                        and v_conf >= public.anti_cheat_param('recognition_min_confidence')
                   then 'issued' else 'rejected' end;
  v_photo := case when v_status = 'issued' then r.photo_path end;

  update public.recognitions
     set status = v_status,
         verdict = v_verdict,
         reason = v_reason,
         species_id = v_top,
         candidates = v_cands,
         confidence = v_conf,
         visible_parts = v_parts,
         count = v_count,
         cap_cm = v_cap,
         height_cm = v_height,
         maturity = v_maturity,
         scale_ref = case when v_repro then 'none' else v_scale end,
         reproduction = v_repro,
         photo_path = v_photo,
         model = left(p_model, 64)
   where id = r.id
   returning * into r;
  return public.recognition_json(r);
end $$;

-- Sprzątanie (Edge Function, w tle po odpowiedzi): rozpoznania issued po terminie → expired (zdjęcie zbędne – ścieżka
-- do usunięcia, skróty zostają: obrazu nie da się użyć ponownie), porzucone pending (funkcja ubita) → usunięte
-- (ścieżka {uid}/rec/{id}.jpg na wypadek zapisanego pliku), odrzucone starsze niż recognition_rejected_keep_d → usunięte
-- (też ze ścieżką – gdyby funkcja nie zdążyła skasować pliku przy odrzuceniu).
-- Wynik: {"paths": [...]} – pliki w scan-photos do usunięcia przez funkcję.
create or replace function public.recognition_cleanup(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_paths text[] := '{}';
  v_more text[];
begin
  with x as (
    select r.id, r.photo_path from public.recognitions r
     where r.status = 'issued' and r.expires_at <= now()
     order by r.expires_at limit v_limit for update skip locked
  ), u as (
    update public.recognitions r set status = 'expired', photo_path = null
      from x where r.id = x.id
    returning x.photo_path
  )
  select coalesce(array_agg(u.photo_path) filter (where u.photo_path is not null), '{}') into v_more from u;
  v_paths := v_paths || v_more;

  with x as (
    select r.id, r.user_id from public.recognitions r
     where r.status = 'pending'
       and r.created_at < now() - make_interval(secs => public.anti_cheat_param('recognition_pending_s')::int)
     order by r.created_at limit v_limit for update skip locked
  ), d as (
    delete from public.recognitions r using x where r.id = x.id
    returning r.user_id::text || '/rec/' || r.id::text || '.jpg' as path
  )
  select coalesce(array_agg(d.path), '{}') into v_more from d;
  v_paths := v_paths || v_more;

  with d as (
    delete from public.recognitions r
     where r.id in (
       select y.id from public.recognitions y
        where y.status = 'rejected'
          and y.created_at < now() - make_interval(days => public.anti_cheat_param('recognition_rejected_keep_d')::int)
        order by y.created_at limit v_limit)
    returning r.user_id::text || '/rec/' || r.id::text || '.jpg' as path
  )
  select coalesce(array_agg(d.path), '{}') into v_more from d;
  v_paths := v_paths || v_more;
  return jsonb_build_object('paths', to_jsonb(v_paths));
end $$;

-- Rozpoznania gracza do eksportu danych (RODO art. 15/20) – do podpięcia w export_my_data (koordynator).
-- Ze skrótami zdjęć (to dane gracza – identyfikują jego pliki); współrzędnych serwer nie ma.
create or replace function public.export_recognitions(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'createdAt', public.iso_ts(r.created_at),
           'status', r.status,
           'verdict', r.verdict,
           'reason', r.reason,
           'speciesId', r.species_id,
           'candidates', r.candidates,
           'confidence', r.confidence,
           'visibleParts', to_jsonb(r.visible_parts),
           'count', r.count,
           'capCm', r.cap_cm,
           'heightCm', r.height_cm,
           'maturity', r.maturity,
           'scaleReference', r.scale_ref,
           'reproduction', r.reproduction,
           'views', r.views,
           'imageSha256', to_jsonb(r.image_sha256),
           'photoPath', r.photo_path,
           'gminaId', r.gmina_id,
           'model', r.model,
           'findId', r.find_id,
           'expiresAt', public.iso_ts(r.expires_at),
           'consumedAt', public.iso_ts(r.consumed_at)
         ) order by r.created_at), '[]')
    from public.recognitions r
   where r.user_id = p_user
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- submit_find: podpisane rozpoznanie; rzadkość, waga i XXL zawsze z serwera
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.submit_find(uuid, uuid, text, text, public.rarity, numeric, boolean, jsonb, jsonb, text[], timestamptz);

-- Znalezisko (idempotentne po p_find_id – ponowienie zwraca zapisany wiersz).
--  · p_recognition_id – rozpoznanie gracza 'issued', ważne, grzyb, pewność ≥ 60%, nie reprodukcja: gatunek, pewność,
--    kandydaci, części, wymiary, gmina (z serwera; bez niej – z telefonu i flaga gmina_from_client (1)), found_at
--    (= czas rozpoznania) i zdjęcie z rekordu; parametry telefonu o okazie są pomijane. Rozpoznanie → consumed.
--    Odmowy: P0002 recognition_not_found (nie ma / cudze), P0001 recognition_used, recognition_expired,
--    recognition_rejected (opis po polsku w detail).
--  · bez p_recognition_id – tylko przy dev_tools_enabled() (wymuszony wynik skanu, testy): gatunek, pewność,
--    kapelusz / wysokość / wiek / sztuki i czas z telefonu, znalezisko niezweryfikowane (poza rankingami, rekordami,
--    percentylem i rywalizacją). Inaczej P0001 recognition_required.
--  · zawsze: rzadkość = rzadkość gatunku (wyższa z telefonu → flaga rarity_clamped (2)), waga i XXL – find_dimensions
--    (XXL z telefonu, którego serwer nie potwierdza → flaga xxl_corrected (1)); limity, flagi wymiarów, wyprawy
--    i serii rzadkich jak dotąd.
create function public.submit_find(
  p_find_id uuid,
  p_trip_id uuid default null,
  p_gmina_id text default null,
  p_species_id text default null,
  p_rarity public.rarity default null,
  p_confidence numeric default null,
  p_xxl boolean default null,
  p_dimensions jsonb default null,
  p_candidates jsonb default null,
  p_parts text[] default null,
  p_found_at timestamptz default null,
  p_recognition_id uuid default null
)
returns public.finds
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.finds;
  sp public.species;
  rec public.recognitions;
  v_trip public.trips;
  v_trip_id uuid;
  v_scan_id uuid;
  v_ident_id uuid;
  v_gmina text;
  v_found timestamptz;
  v_confidence numeric;
  v_candidates jsonb;
  v_parts text[];
  v_cap numeric;
  v_height numeric;
  v_age int;
  v_pieces int;
  v_dims jsonb;
  v_weight int;
  v_xxl boolean;
  v_verified boolean := false;
  v_size_verified boolean := false;
  v_photo text;
  v_used bigint;
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

  if p_recognition_id is not null then
    -- ── Podpisane rozpoznanie: wszystko o okazie z rekordu serwera ──
    select * into rec from public.recognitions where id = p_recognition_id and user_id = v_uid for update;
    if not found then
      raise exception 'recognition_not_found' using errcode = 'P0002',
        detail = 'Serwer nie zna tego rozpoznania – zeskanuj grzyba jeszcze raz.';
    end if;
    if rec.status = 'consumed' then
      raise exception 'recognition_used' using errcode = 'P0001',
        detail = 'To rozpoznanie zostało już użyte przy innym znalezisku.';
    end if;
    if rec.status = 'expired' or (rec.status = 'issued' and rec.expires_at <= now()) then
      raise exception 'recognition_expired' using errcode = 'P0001',
        detail = format('Rozpoznanie wygasło (jest ważne %s dni) – zeskanuj grzyba jeszcze raz.',
                        round(public.anti_cheat_param('recognition_ttl_h') / 24));
    end if;
    if rec.status <> 'issued' or rec.verdict is distinct from 'mushroom' or rec.reproduction or rec.species_id is null
       or rec.confidence < public.anti_cheat_param('recognition_min_confidence') then
      raise exception 'recognition_rejected' using errcode = 'P0001',
        detail = case when rec.reproduction then 'To zdjęcie ekranu albo wydruku – znalezisko wymaga zdjęcia prawdziwego grzyba.'
                      else 'To rozpoznanie nie potwierdza gatunku z atlasu z pewnością co najmniej 60% – nie da się z niego zapisać znaleziska.' end;
    end if;
    select * into sp from public.species where id = rec.species_id;
    v_gmina := coalesce(rec.gmina_id, p_gmina_id);
    v_found := rec.created_at;
    v_confidence := rec.confidence;
    select coalesce(jsonb_agg(jsonb_build_object('species_id', c ->> 'speciesId', 'confidence', (c ->> 'confidence')::numeric)), '[]')
      into v_candidates
      from jsonb_array_elements(rec.candidates) c;
    v_parts := rec.visible_parts;
    v_cap := rec.cap_cm;
    v_height := rec.height_cm;
    v_age := case rec.maturity when 'young' then 2 when 'mature' then 5 when 'old' then 9 else 4 end;
    v_pieces := rec.count;
    v_verified := true;
    v_size_verified := rec.cap_cm is not null and rec.scale_ref <> 'none' and not rec.reproduction;
    v_photo := rec.photo_path;
  else
    -- ── Bez rozpoznania: tylko narzędzia deweloperskie (lokalnie) ──
    if not public.dev_tools_enabled() then
      raise exception 'recognition_required' using errcode = 'P0001',
        detail = 'Znalezisko wymaga rozpoznania zdjęcia przez serwer – zaktualizuj aplikację i zeskanuj grzyba jeszcze raz.';
    end if;
    select * into sp from public.species where id = p_species_id;
    if not found then
      raise exception 'unknown_species' using errcode = 'P0001', detail = format('Gatunek „%s” nie istnieje w katalogu', p_species_id);
    end if;
    if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
      raise exception 'invalid_confidence' using errcode = 'P0001',
        detail = format('Pewność rozpoznania musi być w zakresie 0–1 (jest %s)', coalesce(p_confidence::text, 'null'));
    end if;
    v_candidates := coalesce(p_candidates, '[]');
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
    v_found := coalesce(p_found_at, now());
    if v_found > now() + interval '5 minutes' or v_found < now() - interval '14 days' then
      raise exception 'invalid_found_at' using errcode = 'P0001',
        detail = format('Czas znaleziska %s poza zakresem (najwyżej 14 dni wstecz, 5 min w przód)', v_found);
    end if;
    v_found := least(v_found, now());
    v_gmina := p_gmina_id;
    v_confidence := p_confidence;
    v_parts := coalesce(p_parts, '{}');
  end if;

  if v_gmina is null or not exists (select 1 from public.gminy g where g.id = v_gmina) then
    raise exception 'unknown_gmina' using errcode = 'P0001', detail = format('Gmina „%s” nie istnieje w bazie', v_gmina);
  end if;

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
  select count(*) into v_used
    from public.finds x
   where x.user_id = v_uid and x.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'submit_find_day', v_used, public.anti_cheat_param('submit_find_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit znalezisk (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('submit_find_per_day')),
    public.warsaw_ts(public.local_today() + 1));

  -- ── Prawda serwera: rzadkość gatunku, waga i XXL z wymiarów ──
  if p_rarity is not null and p_rarity > sp.rarity then
    perform public.flag(v_uid, 'rarity_clamped', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'speciesRarity', sp.rarity, 'reported', p_rarity, 'stored', sp.rarity));
  end if;
  v_dims := public.find_dimensions(sp.id, v_cap, v_height, v_pieces);
  v_cap := (v_dims ->> 'cap_cm')::numeric;
  v_height := (v_dims ->> 'height_cm')::numeric;
  v_weight := (v_dims ->> 'weight_g')::int;
  v_pieces := (v_dims ->> 'pieces')::int;
  v_xxl := (v_dims ->> 'xxl')::boolean;
  if coalesce(p_xxl, false) and not v_xxl then
    perform public.flag(v_uid, 'xxl_corrected', 1, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'typicalWeightG', sp.typical_weight_g, 'clustered', sp.clustered));
  end if;

  -- ── Flagi wiarygodności ──
  v_piece_g := v_weight::numeric / coalesce(v_pieces, 1);
  if v_piece_g > sp.typical_weight_g * public.anti_cheat_param('find_weight_factor')
     or v_cap > sp.typical_cap_cm * public.anti_cheat_param('find_cap_factor') then
    perform public.flag(v_uid, 'find_size', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'pieces', v_pieces, 'capCm', v_cap,
      'typicalWeightG', sp.typical_weight_g, 'typicalCapCm', sp.typical_cap_cm, 'verified', v_verified));
  end if;
  if v_verified and rec.gmina_id is null then
    perform public.flag(v_uid, 'gmina_from_client', 1, p_find_id::text, jsonb_build_object(
      'recognitionId', rec.id, 'gminaId', v_gmina));
  elsif v_verified and p_gmina_id is distinct from rec.gmina_id then
    perform public.flag(v_uid, 'gmina_mismatch', 1, p_find_id::text, jsonb_build_object(
      'recognitionId', rec.id, 'reported', p_gmina_id, 'stored', rec.gmina_id));
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

  insert into public.scans (user_id, trip_id, status, parts)
  values (v_uid, v_trip_id, 'identified', v_parts)
  returning id into v_scan_id;

  insert into public.identifications (scan_id, provider, model, species_id, confidence, candidates, dimensions)
  values (v_scan_id,
          case when v_verified then 'recognition' else 'client-sim' end,
          case when v_verified then coalesce(rec.model, '?') else 'mock-v1' end,
          sp.id, v_confidence, v_candidates,
          jsonb_strip_nulls(jsonb_build_object('cap_cm', v_cap, 'height_cm', v_height, 'weight_g', v_weight,
                                               'age_days', v_age, 'pieces', v_pieces)))
  returning id into v_ident_id;

  insert into public.finds (
    id, user_id, trip_id, scan_id, identification_id, recognition_id, species_id, gmina_id, rarity, confidence, xxl,
    cap_cm, height_cm, weight_g, age_days, pieces, collected, status, found_at, photo_path, verified, size_verified
  )
  values (
    p_find_id, v_uid, v_trip_id, v_scan_id, v_ident_id, rec.id, sp.id, v_gmina, sp.rarity, v_confidence, v_xxl,
    v_cap, v_height, v_weight, v_age, v_pieces,
    sp.edibility not in ('trujacy', 'smiertelny') and sp.protection is null,   -- trujący albo chroniony → tylko zdjęcie
    'pending', v_found, v_photo, v_verified, v_size_verified
  )
  returning * into f;

  if v_verified then
    update public.recognitions set status = 'consumed', find_id = f.id, consumed_at = now() where id = rec.id;
  end if;

  -- Seria rzadkich okazów (łącznie z nowym; bez odrzuconych).
  if sp.rarity >= 'rzadki' then
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

-- ─────────────────────────────────────────────────────────────────────────────
-- set_find_photo: zdjęcie z rozpoznania bez podmiany; folder rec/ zarezerwowany
-- ─────────────────────────────────────────────────────────────────────────────

-- Jak w 20261012100000_anticheat.sql, a dodatkowo:
--  · znalezisko z rozpoznaniem (recognition_id) – zdjęcie jest tym, które widział model: ta sama ścieżka → bez zmian,
--    każda inna (także null) → P0001 photo_locked;
--  · ścieżka w {uid}/rec/… → P0001 invalid_path (tam pisze tylko Edge Function identify).
create or replace function public.set_find_photo(p_find_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.finds;
  v_others jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into f from public.finds where id = p_find_id and user_id = v_uid for update;
  if not found then raise exception 'find_not_found' using errcode = 'P0002'; end if;
  if f.recognition_id is not null then
    if p_path is not distinct from f.photo_path then return; end if;
    raise exception 'photo_locked' using errcode = 'P0001',
      detail = 'Zdjęcie tego znaleziska pochodzi z rozpoznania na serwerze – nie można go podmienić ani usunąć.';
  end if;
  if p_path is not null and (not public.is_user_image_path(p_path, v_uid) or starts_with(p_path, v_uid::text || '/rec/')) then
    raise exception 'invalid_path' using errcode = 'P0001',
      detail = format('Ścieżka „%s” musi leżeć w folderze gracza (%s/…, poza rec/ – tam są zdjęcia z rozpoznania) i kończyć się .jpg, .jpeg, .png albo .webp', p_path, v_uid);
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
-- Percentyl okazu: zweryfikowane, k-anonimowo, w progach wagi
-- ─────────────────────────────────────────────────────────────────────────────

-- „W gminie X w tym sezonie” / „Większy niż 88% okazów w gminie”: sezon, odebrane ZWERYFIKOWANE okazy gatunku po
-- visible_from. Porównanie dopiero od percentile_min_finds okazów i percentile_min_users znalazców – inaczej kształt
-- „brak danych” (collected 0, sizeRank 1, percentile 100, biggerCount 0) z comparable = false. Waga porównywana
-- w progach co percentile_step_pct % (próg = ⌊ln(waga) / ln(1 + krok)⌋): okazy w tym samym progu to remis
-- (ani większe, ani mniejsze), więc dowolne p_weight_g nie odtworzy cudzych wag dokładniej niż próg.
--  · collected – okazy, mushroomers – różni gracze, biggerCount – w wyższym progu, sizeRank = biggerCount + 1,
--    percentile – % okazów w niższym progu (0–100), comparable – czy porównanie jest dostępne.
-- Nieznany gatunek → P0002 species_not_found, gmina → P0002 gmina_not_found.
create or replace function public.get_species_percentile(p_species_id text, p_gmina_id text, p_weight_g int)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_ln numeric := ln(1 + public.anti_cheat_param('percentile_step_pct') / 100);
  v_b numeric;
  r record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.species s where s.id = p_species_id) then
    raise exception 'species_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'gmina_not_found' using errcode = 'P0002';
  end if;
  v_b := floor(ln(greatest(coalesce(p_weight_g, 0), 1)::numeric) / v_ln);
  select count(*) as n,
         count(distinct f.user_id) as users,
         count(*) filter (where floor(ln(greatest(f.weight_g, 1)::numeric) / v_ln) > v_b) as bigger,
         count(*) filter (where floor(ln(greatest(f.weight_g, 1)::numeric) / v_ln) < v_b) as smaller
    into r
    from public.finds f
   where f.species_id = p_species_id and f.gmina_id = p_gmina_id and f.status = 'claimed' and f.verified
     and f.visible_from <= now() and f.found_at >= public.warsaw_ts(public.ranking_period_start('season'));
  if r.n < public.anti_cheat_param('percentile_min_finds') or r.users < public.anti_cheat_param('percentile_min_users') then
    return jsonb_build_object(
      'speciesId', p_species_id, 'gminaId', p_gmina_id, 'collected', 0, 'mushroomers', 0,
      'sizeRank', 1, 'percentile', 100, 'biggerCount', 0, 'comparable', false);
  end if;
  return jsonb_build_object(
    'speciesId', p_species_id,
    'gminaId', p_gmina_id,
    'collected', r.n,
    'mushroomers', r.users,
    'sizeRank', r.bigger + 1,
    'percentile', round(100.0 * r.smaller / r.n)::int,
    'biggerCount', r.bigger,
    'comparable', true
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Statystyki gminy: rekordy tylko z okazów zmierzonych (size_verified), bez kępek
-- ─────────────────────────────────────────────────────────────────────────────

-- Jak w 20261009100000_stats.sql; zmiana tylko w „records”: najcięższy zebrany okaz w każdej rzadkości liczony
-- wyłącznie z okazów size_verified (kapelusz zmierzony przez model przy odniesieniu skali) i pojedynczych
-- (pieces brak albo 1 – kępka to nie okaz).
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
           and f.size_verified and coalesce(f.pieces, 1) <= 1
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Stan gry: znaleziska + recognitionId, verified, sizeVerified (reszta jak w 20261013110000_progression.sql)
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
           'photoPath', f.photo_path,
           'recognitionId', f.recognition_id,
           'verified', f.verified,
           'sizeVerified', f.size_verified
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
-- Usunięcie konta i pliki gracza: + rozpoznania
-- ─────────────────────────────────────────────────────────────────────────────

-- Jak w 20261014100000_identify.sql + rozpoznania (skróty zdjęć znikają kaskadowo). Pliki rec/ – user_storage_paths
-- (aplikacja usuwa je po skasowaniu danych, gdy nic się do nich nie odwołuje; Edge Function delete-account – cały folder).
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
  delete from public.recognitions where user_id = p_user;    -- + recognition_images (cascade)
end $$;

-- Pliki gracza w Storage (jak w 20261010100000_storage.sql) + zdjęcia rozpoznań (scan-photos/{uid}/rec/…).
create or replace function public.user_storage_paths(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'scan-photos', coalesce((
      select jsonb_agg(x.path order by x.path)
        from (
          select f.photo_path as path from public.finds f where f.user_id = p_user and f.photo_path is not null
          union
          select unnest(s.photo_paths) from public.scans s where s.user_id = p_user
          union
          select r.photo_path from public.recognitions r where r.user_id = p_user and r.photo_path is not null
        ) x
       where x.path is not null), '[]'::jsonb),
    'post-media', coalesce((
      select jsonb_agg(distinct p.payload ->> 'cover_path' order by p.payload ->> 'cover_path')
        from public.posts p
       where p.author_id = p_user and p.payload ->> 'cover_path' is not null), '[]'::jsonb),
    'avatars', coalesce((
      select jsonb_agg(pr.avatar_path) from public.profiles pr where pr.id = p_user and pr.avatar_path is not null), '[]'::jsonb)
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: scan-photos/{uid}/rec/… – tylko Edge Function (service_role) zapisuje; klient czyta, a usuwa wyłącznie
-- pliki, do których nic się już nie odwołuje (rec_photo_released). Reszta jak w 20261010100000_storage.sql.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "zdjecia: zapis wlasnych" on storage.objects;
drop policy if exists "zdjecia: podmiana wlasnych" on storage.objects;
drop policy if exists "zdjecia: usuniecie wlasnych" on storage.objects;

create policy "zdjecia: zapis wlasnych" on storage.objects for insert to authenticated
  with check (bucket_id in ('scan-photos', 'avatars', 'post-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and not (bucket_id = 'scan-photos' and (storage.foldername(name))[2] is not distinct from 'rec'));
create policy "zdjecia: podmiana wlasnych" on storage.objects for update to authenticated
  using (bucket_id in ('scan-photos', 'avatars', 'post-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not (bucket_id = 'scan-photos' and (storage.foldername(name))[2] is not distinct from 'rec'))
  with check (bucket_id in ('scan-photos', 'avatars', 'post-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and not (bucket_id = 'scan-photos' and (storage.foldername(name))[2] is not distinct from 'rec'));
create policy "zdjecia: usuniecie wlasnych" on storage.objects for delete to authenticated
  using (bucket_id in ('scan-photos', 'avatars', 'post-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and (bucket_id <> 'scan-photos' or (storage.foldername(name))[2] is distinct from 'rec'
              or public.rec_photo_released(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.recognitions, public.recognition_images from anon, authenticated;
grant select, insert, update, delete on public.recognitions, public.recognition_images to service_role;

revoke all on function
  public.finds_bot_verified(),
  public.find_dimensions(text, numeric, numeric, int),
  public.recognition_json(public.recognitions),
  public.identify_check_limits(uuid),
  public.rec_photo_released(text),
  public.recognition_begin(uuid, text[], double precision, double precision, double precision),
  public.recognition_finish(bigint, uuid, uuid, text, boolean, jsonb, text, text, int, int, int, int),
  public.recognition_cleanup(int),
  public.export_recognitions(uuid),
  public.submit_find(uuid, uuid, text, text, public.rarity, numeric, boolean, jsonb, jsonb, text[], timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function
  public.recognition_begin(uuid, text[], double precision, double precision, double precision),
  public.recognition_finish(bigint, uuid, uuid, text, boolean, jsonb, text, text, int, int, int, int),
  public.recognition_cleanup(int)
  to service_role;
-- Polityka storage.objects (usunięcie zwolnionego pliku rec/) woła ją z uprawnieniami gracza.
grant execute on function public.rec_photo_released(text) to authenticated;
grant execute on function
  public.submit_find(uuid, uuid, text, text, public.rarity, numeric, boolean, jsonb, jsonb, text[], timestamptz, uuid)
  to authenticated;
-- Zmienione przez create or replace (identify_begin, set_find_photo, get_species_percentile, get_gmina_stats,
-- get_game_state, wipe_account_data, user_storage_paths) zachowują dotychczasowe uprawnienia.
