-- =============================================================================
-- Rywalizacja – podstawy wspólne dla uszczelnienia anty-cheatu i nowych trybów (docs/rywalizacja.md)
--
-- Tylko schemat i kontrakt. Logikę wypełniają kolejne migracje:
--   20261015100000_podpisane_rozpoznanie.sql – Edge Function identify zapisuje wynik, submit_find bierze go z serwera
--   20261015103000_uszczelnienia.sql         – wyprawy, wyzwania, rankingi gmin, uprawnienia (audyt anty-cheatu)
--   20261015110000_rywalizacja.sql           – walki o okaz, pojedynki, ranking grzybiarzy, trofea
--
--  · anti_cheat_params – progi anty-cheatu w tabeli zamiast w treści funkcji: każda migracja dopisuje SWOJE klucze
--    (insert … on conflict do update), bez przepisywania całej listy w create or replace anti_cheat_param().
--    Komplet dotychczasowych kluczy (etap 7 + rozpoznawanie) przeniesiony 1:1.
--  · finds.verified      – gatunek, pewność, wymiary i gmina pochodzą z rozpoznania zapisanego przez serwer
--                          (Edge Function identify), związanego z tym znaleziskiem (jedno rozpoznanie = jedno znalezisko).
--  · finds.size_verified – verified ORAZ model zmierzył kapelusz przy odniesieniu skali ORAZ zdjęcie nie jest
--                          reprodukcją (ekran, wydruk, zdjęcie zdjęcia). Tylko takie okazy walczą o rozmiar.
--  · player_standing     – status gracza w rywalizacji: ok / review (wstrzymany do przeglądu) / banned (do czasu
--                          albo na stałe). Osobna tabela (nie kolumna profiles – te czyta każdy), bez dostępu klientów.
--  · competition_eligible(uid) – czy gracz bierze udział w rywalizacji (rankingi, walki, pojedynki, nagrody).
--    Wersja podstawowa; uszczelnienia mogą ją doprecyzować (create or replace, ta sama sygnatura).
--  · account_secured(uid) – konto powiązane z e-mailem (nie anonimowe) – warunek nagród w rywalizacji.
--  · xp_source: 'contest' (nagrody walk o okaz), 'duel' (pojedynki) – osobny plik przed użyciem (nowej wartości
--    enuma nie wolno użyć w tej samej transakcji).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Progi anty-cheatu w tabeli
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.anti_cheat_params (
  k text primary key check (k ~ '^[a-z][a-z0-9_]{0,63}$'),
  v numeric not null,
  note text
);
alter table public.anti_cheat_params enable row level security;
-- Brak polityk: klient nie czyta progów (tylko funkcje serwera; zmiana – migracja albo service_role / Studio).

insert into public.anti_cheat_params (k, v, note) values
  -- limity (rate_limited)
  ('submit_find_per_10min', 30, 'znaleziska w dowolnym oknie 10 min wg found_at'),
  ('submit_find_per_day', 200, 'znaleziska na dobę wg created_at (czas serwera, Europe/Warsaw)'),
  ('start_trip_per_day', 20, 'nowe wyprawy na dobę'),
  ('add_comment_per_10min', 30, 'komentarze w 10 min'),
  ('friend_request_per_day', 50, 'nowe zaproszenia do znajomych na dobę'),
  ('report_post_per_day', 30, 'zgłoszenia wpisów na dobę'),
  ('identify_per_day', 60, 'rozpoznania zdjęć (Edge Function identify) w kroczącym oknie 24 h'),
  ('identify_busy_s', 60, '„jedno naraz”: niezamknięte wywołanie młodsze niż tyle blokuje następne'),
  -- prędkość wyprawy
  ('trip_speed_flag_kmh', 12, 'powyżej: dystans przycięty, flaga 2'),
  ('trip_speed_counted_kmh', 8, 'tyle najwyżej liczy się przy przycięciu'),
  ('trip_speed_absurd_kmh', 50, 'powyżej: przyrost nie liczy się wcale, flaga 3'),
  ('trip_grace_s', 300, 'tolerancja czasu (zegar telefonu, pierwszy fix GPS)'),
  ('trip_max_elapsed_s', 86400, 'czas wyprawy do prędkości najwyżej 24 h'),
  ('trip_backdated_h', 24, 'start wyprawy starszy niż tyle → flaga 1'),
  -- znaleziska
  ('find_weight_factor', 3, 'waga (na sztukę) > 3 × typowa → flaga 2'),
  ('find_cap_factor', 2.5, 'kapelusz > 2,5 × typowy → flaga 2'),
  ('xxl_factor', 1.25, 'XXL od 1,25 × typowej wagi (jak isXxl w aplikacji)'),
  ('find_trip_grace_min', 5, 'found_at poza [start − 5 min, koniec + 5 min] → flaga 1'),
  ('rare_burst_window_min', 30, 'okno ± 30 min wokół znaleziska'),
  ('rare_burst_rare', 10, '≥ 10 rzadkich+ w oknie → flaga 2'),
  ('rare_burst_epic', 4, '≥ 4 epickie+ w oknie → flaga 2'),
  ('daily_find_xp_soft_cap', 5000, 'XP ze znalezisk na dobę (czas serwera) → flaga 2, nagroda bez zmian'),
  -- dziennik
  ('flag_dedupe_h', 24, 'ta sama flaga (gracz, rodzaj, ref) w tym oknie → ten sam wiersz'),
  -- rywalizacja (competition_eligible)
  ('competition_flag_window_d', 30, 'okno flag branych pod uwagę przy dopuszczeniu do rywalizacji'),
  ('competition_flag_hits', 3, 'tyle powtórzeń flag wagi 3 (poza samym limitem) w oknie → poza rywalizacją')
on conflict (k) do update set v = excluded.v, note = excluded.note;

-- Ta sama sygnatura i uprawnienia co dotąd (klienci bez EXECUTE). Nieznany klucz → null.
-- stable (nie immutable): zmiana progu w tabeli działa od razu.
create or replace function public.anti_cheat_param(p_key text) returns numeric
language sql stable set search_path = '' as $$
  select p.v from public.anti_cheat_params p where p.k = p_key
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Znaleziska: weryfikacja serwera
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.finds add column if not exists verified boolean not null default false;
alter table public.finds add column if not exists size_verified boolean not null default false;
alter table public.finds drop constraint if exists finds_size_verified_needs_verified;
alter table public.finds add constraint finds_size_verified_needs_verified check (not size_verified or verified);
-- Walki o okaz / pojedynki: zweryfikowane okazy w oknie czasu.
create index if not exists finds_size_verified_idx on public.finds (found_at) where size_verified and status = 'claimed';
create index if not exists finds_verified_user_idx on public.finds (user_id, found_at) where verified and status = 'claimed';

-- ─────────────────────────────────────────────────────────────────────────────
-- Status gracza w rywalizacji
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.player_standing (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'ok' check (status in ('ok', 'review', 'banned')),
  reason text check (reason is null or char_length(reason) <= 300),
  until timestamptz,                                  -- null = bezterminowo (dla 'banned' / 'review')
  updated_at timestamptz not null default now(),
  updated_by text                                     -- 'auto:<rodzaj flagi>' albo moderator
);
alter table public.player_standing enable row level security;
-- Brak polityk: klient nie czyta ani nie zapisuje statusu (tylko funkcje serwera; moderacja – service_role / Studio).

-- Czy gracz bierze udział w rywalizacji. Boty deweloperskie – tak (dane testowe rankingów).
create or replace function public.competition_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user is not null
     and not exists (
       select 1 from public.player_standing s
        where s.user_id = p_user and s.status <> 'ok' and (s.until is null or s.until > now()))
     and coalesce((
       select sum(f.hits) from public.anti_cheat_flags f
        where f.user_id = p_user and f.severity >= 3 and f.kind <> 'rate_limited'
          and f.last_at > now() - make_interval(days => public.anti_cheat_param('competition_flag_window_d')::int)
     ), 0) < public.anti_cheat_param('competition_flag_hits')
$$;

-- Konto powiązane z e-mailem (nie anonimowe). Boty deweloperskie (profiles.is_bot – w auth.users są anonimowe)
-- i brak wiersza w auth.users → true (dane testowe rankingów i nagród).
create or replace function public.account_secured(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user is not null
     and (exists (select 1 from public.profiles p where p.id = p_user and p.is_bot)
          or coalesce((select not coalesce(u.is_anonymous, false) from auth.users u where u.id = p_user), true))
$$;

-- Usunięcie konta: status znika razem z profilem (on delete cascade); wipe_account_data – bez zmian.

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.anti_cheat_params, public.player_standing from anon, authenticated;
grant select, insert, update, delete on public.anti_cheat_params, public.player_standing to service_role;
revoke all on function
  public.competition_eligible(uuid),
  public.account_secured(uuid)
  from public, anon, authenticated;
