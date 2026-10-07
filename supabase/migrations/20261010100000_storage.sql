-- =============================================================================
-- Etap 5 – zdjęcia w Supabase Storage
--
--  · Koszyki: scan-photos (PRYWATNY – zdjęcie znaleziska, tylko właściciel: przywracanie na nowym telefonie),
--    post-media (publiczny – okładka opublikowanej wyprawy w feedzie), avatars (publiczny – zdjęcie profilowe).
--    Limity: scan-photos / post-media 2 MB, avatars 512 KB; tylko image/jpeg, image/png, image/webp.
--  · Pliki wysyła KLIENT (supabase-js, sesja gracza) do własnego folderu: pierwszy segment ścieżki = auth.uid().
--    Polityki storage.objects: odczyt / zapis / podmiana / usunięcie tylko we własnym folderze (we wszystkich
--    trzech koszykach); publiczny odczyt avatars i post-media idzie przez publiczny URL (koszyk public = true).
--  · Ścieżki w bazie (bez nazwy koszyka): finds.photo_path (set_find_photo), payload.cover_path wpisu
--    (publish_trip / set_post_cover), profiles.avatar_path (zwykły update profilu). Każda musi leżeć w folderze
--    właściciela wiersza i kończyć się .jpg / .jpeg / .png / .webp (is_user_image_path – RPC i CHECK).
--  · Aplikacja koduje zdjęcia ponownie (expo-image-manipulator) – to usuwa EXIF, więc w plikach nie ma GPS.
--  · Serwer nie kasuje plików (SQL nie usuwa obiektów Storage) – robi to aplikacja (dev_reset_player zwraca
--    "storagePaths" do usunięcia).
--  · profiles.listed – ciche boty generatora (dev_seed_activity) nie zaśmiecają wyszukiwarki.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Koszyki: limity rozmiaru i typy plików (idempotentne)
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
   set file_size_limit = 2097152,                                        -- 2 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('scan-photos', 'post-media');
update storage.buckets
   set file_size_limit = 524288,                                         -- 512 KB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

-- ─────────────────────────────────────────────────────────────────────────────
-- Polityki Storage: wszystko tylko we własnym folderze {user_id}/…
-- (upsert wymaga SELECT + INSERT + UPDATE, remove – SELECT + DELETE, więc odczyt własnych także w publicznych
-- koszykach; cudzych plików nikt nie wylistuje – publiczny URL działa bez polityk, ścieżki są nieodgadywalne)
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "avatars: zapis wlasnego" on storage.objects;
drop policy if exists "avatars: podmiana wlasnego" on storage.objects;
drop policy if exists "skany: zapis wlasnych" on storage.objects;
drop policy if exists "skany: odczyt wlasnych" on storage.objects;
drop policy if exists "zdjecia: odczyt wlasnych" on storage.objects;
drop policy if exists "zdjecia: zapis wlasnych" on storage.objects;
drop policy if exists "zdjecia: podmiana wlasnych" on storage.objects;
drop policy if exists "zdjecia: usuniecie wlasnych" on storage.objects;

create policy "zdjecia: odczyt wlasnych" on storage.objects for select to authenticated
  using (bucket_id in ('scan-photos', 'avatars', 'post-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "zdjecia: zapis wlasnych" on storage.objects for insert to authenticated
  with check (bucket_id in ('scan-photos', 'avatars', 'post-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "zdjecia: podmiana wlasnych" on storage.objects for update to authenticated
  using (bucket_id in ('scan-photos', 'avatars', 'post-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('scan-photos', 'avatars', 'post-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "zdjecia: usuniecie wlasnych" on storage.objects for delete to authenticated
  using (bucket_id in ('scan-photos', 'avatars', 'post-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ścieżki zdjęć w bazie
-- ─────────────────────────────────────────────────────────────────────────────

-- Ścieżka zdjęcia w folderze gracza (bez nazwy koszyka): '<uuid gracza>/<segmenty>/<plik>.jpg|jpeg|png|webp'.
-- Segmenty: litery, cyfry, . _ - (nie zaczynają się kropką – bez „..”), najwyżej 300 znaków.
-- Czysta funkcja – używają jej RPC i ograniczenia CHECK (stąd EXECUTE dla authenticated).
create or replace function public.is_user_image_path(p_path text, p_user uuid) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    char_length(p_path) <= 300
    and starts_with(p_path, p_user::text || '/')
    and substr(p_path, char_length(p_user::text) + 2) ~* '^([a-z0-9_-][a-z0-9._-]*/)*[a-z0-9_-][a-z0-9._-]*\.(jpe?g|png|webp)$',
    false)
$$;

-- Zdjęcie znaleziska (scan-photos, prywatne). Zapis przez set_find_photo.
alter table public.finds add column if not exists photo_path text;
alter table public.finds drop constraint if exists finds_photo_path_check;
alter table public.finds add constraint finds_photo_path_check
  check (photo_path is null or public.is_user_image_path(photo_path, user_id));

-- Zdjęcie profilowe (avatars, publiczne) – klient zmienia je zwykłym update profiles (jak nick).
-- CHECK może sięgać do innych kolumn tego samego wiersza (id), więc wystarcza ograniczenie – bez wyzwalacza.
alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (avatar_path is null or public.is_user_image_path(avatar_path, id));

-- Okładka wpisu (post-media, publiczna) w payload.cover_path – zapis przez publish_trip / set_post_cover.
alter table public.posts drop constraint if exists posts_cover_path_check;
alter table public.posts add constraint posts_cover_path_check
  check (payload ->> 'cover_path' is null or public.is_user_image_path(payload ->> 'cover_path', author_id));

-- Widoczność w wyszukiwarce: ciche boty generatora (dev_seed_activity) – listed = false. Ich profil, wpisy w rekordach
-- i get_user / get_user_by_handle działają jak dotąd; znikają tylko z search_users (fraza i propozycje).
alter table public.profiles add column if not exists listed boolean not null default true;
update public.profiles set listed = false where is_bot and listed and handle::text ~ '^bot[0-9]{2}\.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Pliki gracza w Storage według koszyka (do usunięcia przez aplikację):
-- {"scan-photos": [...], "post-media": [...], "avatars": [...]} – ścieżki bez nazwy koszyka, tablice nigdy null.
create or replace function public.user_storage_paths(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'scan-photos', coalesce((
      select jsonb_agg(x.path order by x.path)
        from (
          select f.photo_path as path from public.finds f where f.user_id = p_user and f.photo_path is not null
          union
          select unnest(s.photo_paths) from public.scans s where s.user_id = p_user
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

-- Autor / pozycja listy: + "avatarPath" (avatars/{user_id}/…, null bez zdjęcia). Reszta bez zmian.
create or replace function public.author_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id,
    'handle', p.handle::text,
    'name', coalesce(nullif(btrim(p.display_name), ''), p.handle::text),
    'level', p.level,
    'avatarPreset', p.avatar_preset,
    'avatarPath', p.avatar_path,
    'ringRarity', public.ring_rarity(p.id)
  )
    from public.profiles p
   where p.id = p_user
$$;

-- Wpis: + "coverPath" (z payload.cover_path – post-media/{author_id}/…, null bez okładki). Reszta bez zmian.
create or replace function public.post_json(p public.posts, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id,
    'kind', p.kind,
    'author', public.author_json(p.author_id),
    'gminaId', p.gmina_id,
    'tripId', p.trip_id,
    'routePrecision', p.route_precision,
    'payload', p.payload,
    'coverPath', p.payload ->> 'cover_path',
    'reactions', p.reactions_count,
    'comments', p.comments_count,
    'reacted', exists (select 1 from public.post_reactions r where r.post_id = p.id and r.user_id = p_viewer),
    'mine', p.author_id = p_viewer,
    'createdAt', public.iso_ts(p.created_at),
    'publishedAt', public.iso_ts(p.published_at),
    'visibleFrom', public.iso_ts(p.visible_from)
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: zdjęcie znaleziska, okładka wpisu
-- ─────────────────────────────────────────────────────────────────────────────

-- Zdjęcie znaleziska (plik już wysłany do scan-photos/{uid}/…). Tylko własne znalezisko (inne / nieznane →
-- P0002 find_not_found – w kolejce wysyłaj po submit_find). p_path null → czyści. Ścieżka spoza folderu gracza
-- albo bez rozszerzenia obrazu → P0001 invalid_path. Idempotentne (ta sama ścieżka → bez zmian).
create or replace function public.set_find_photo(p_find_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
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
end $$;

drop function if exists public.publish_trip(uuid, boolean, text);

-- „Opublikuj w feedzie”: wpis widoczny dla innych dopiero po privacy_delay(). Idempotentne (opublikowana → ten sam wpis).
-- Trasa w payload tylko z trips.route_public (uogólnionej) – bez śladu GPS route = null, route_precision = 'gmina'.
-- p_cover_path: okładka wysłana wcześniej do post-media/{uid}/… → payload.cover_path (null = bez okładki); poza folderem
-- gracza / bez rozszerzenia obrazu → P0001 invalid_path. Ponowna publikacja z okładką ustawia ją, gdy wpis jeszcze jej nie ma
-- (istniejącej nie podmienia – do tego set_post_cover).
create function public.publish_trip(
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
    v_uid, 'trip', t.id, t.gmina_id,
    (case when coalesce(p_hide_route, false) or t.route_public is null then 'gmina' else 'approximate' end)::public.route_precision,
    jsonb_build_object(
      'title', coalesce(nullif(trim(p_title), ''), 'Wyprawa po grzyby'),
      'distance_km', round(t.distance_m / 1000.0, 1),
      'duration_min', coalesce(t.duration_s, 0) / 60,
      'mushrooms', v_mushrooms,
      'species', v_species,
      'xp', t.xp,
      'highlight', case when v_best is null then null else jsonb_build_object(
        'rarity', v_best.rarity, 'species', v_best.name, 'weight_g', v_best.weight_g, 'cap_cm', v_best.cap_cm) end,
      'route', case when coalesce(p_hide_route, false) or t.route_public is null then null else st_asgeojson(t.route_public)::jsonb end,
      'cover_path', p_cover_path
    ),
    now() + public.privacy_delay()
  )
  returning * into p;
  update public.trips set status = 'published', hide_route = coalesce(p_hide_route, false) where id = t.id;
  return p;
end $$;

-- Okładka własnego wpisu ustawiana / podmieniana później (np. zdjęcie wysłane po publikacji). p_path null → usuwa okładkę.
-- Cudzy / usunięty / nieznany wpis → P0002 post_not_found; zła ścieżka → P0001 invalid_path. Idempotentne.
-- Stary plik okładki kasuje aplikacja.
create or replace function public.set_post_cover(p_post_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.posts where id = p_post_id and author_id = v_uid and deleted_at is null for update;
  if not found then raise exception 'post_not_found' using errcode = 'P0002'; end if;
  if p_path is not null and not public.is_user_image_path(p_path, v_uid) then
    raise exception 'invalid_path' using errcode = 'P0001',
      detail = format('Okładka „%s” musi leżeć w folderze gracza (%s/…) i kończyć się .jpg, .jpeg, .png albo .webp', p_path, v_uid);
  end if;
  update public.posts set payload = payload || jsonb_build_object('cover_path', p_path)
   where id = p_post_id and (payload ->> 'cover_path') is distinct from p_path;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Wyszukiwarka: bez profili listed = false (reszta bez zmian względem 20261008100000_social.sql)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.search_users(p_query text default '', p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_q text := public.fold_text(regexp_replace(coalesce(p_query, ''), '^\s*@+', ''));
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_home text;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  if v_q = '' then
    select home_gmina_id into v_home from public.profiles where id = v_uid;
    select coalesce(jsonb_agg(public.social_user_json(x.id, v_uid) order by x.rn), '[]')
      into v_out
      from (
        select p.id,
               row_number() over (
                 order by coalesce(p.home_gmina_id = v_home, false) desc, p.trips_count desc, p.level desc, p.id
               ) rn
          from public.profiles p
         where p.id <> v_uid
           and p.listed
           and public.friend_status(v_uid, p.id) <> 'friends'
         order by rn
         limit v_limit
      ) x;
  else
    select coalesce(jsonb_agg(public.social_user_json(x.id, v_uid) order by x.rn), '[]')
      into v_out
      from (
        select p.id,
               row_number() over (
                 order by (starts_with(public.fold_text(p.handle::text), v_q)
                           or starts_with(public.fold_text(p.display_name), v_q)
                           or starts_with(public.fold_text(p.first_name), v_q)) desc,
                          p.trips_count desc, p.level desc, p.id
               ) rn
          from public.profiles p
         where p.id <> v_uid
           and p.listed
           and (strpos(public.fold_text(p.handle::text), v_q) > 0
             or strpos(public.fold_text(p.display_name), v_q) > 0
             or strpos(public.fold_text(p.first_name), v_q) > 0)
         order by rn
         limit v_limit
      ) x;
  end if;
  return v_out;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stan gry: + profile.avatarPath i finds[].photoPath (reszta bez zmian względem 20261009100000_stats.sql)
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
      'avatarPath', pr.avatar_path,
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
           'reward', f.reward,
           'photoPath', f.photo_path
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

-- Świeży gracz (Lv 1, pusty atlas) z zachowaniem nicku, imienia, gminy domowej i gotowego avatara (avatar_preset);
-- + dane społecznościowe. Zdjęcie profilowe (avatar_path), zdjęcia znalezisk i okładki wpisów znikają z bazy razem
-- z danymi – SQL nie usuwa plików, więc wynik = get_game_state() + "storagePaths" (pliki do usunięcia przez aplikację):
-- {"scan-photos": [...], "post-media": [...], "avatars": [...]} – ścieżki bez nazwy koszyka (jak w storage.from(k).remove()).
create or replace function public.dev_reset_player() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_paths jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  v_paths := public.user_storage_paths(v_uid);
  perform public.wipe_game_data(v_uid);                    -- znaleziska (photo_path) i wpisy (cover_path)
  perform public.wipe_social_data(v_uid);
  update public.profiles set avatar_path = null where id = v_uid and avatar_path is not null;
  return public.get_game_state() || jsonb_build_object('storagePaths', v_paths);
end $$;

-- Generator aktywności: jak w 20261009100000_stats.sql + ciche boty (bot<TERYT woj.>.…) poza wyszukiwarką (listed = false).
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
  perform public.refresh_gmina_rankings();
  return v_out;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function
  public.is_user_image_path(text, uuid),
  public.user_storage_paths(uuid),
  public.set_find_photo(uuid, text),
  public.publish_trip(uuid, boolean, text, text),
  public.set_post_cover(uuid, text)
  from public, anon, authenticated;

-- is_user_image_path: czysta funkcja w ograniczeniach CHECK (profiles, finds, posts) – wykonuje ją rola zapisująca wiersz.
grant execute on function
  public.is_user_image_path(text, uuid),
  public.set_find_photo(uuid, text),
  public.publish_trip(uuid, boolean, text, text),
  public.set_post_cover(uuid, text)
  to authenticated;
-- profiles.listed zmienia wyłącznie serwer (brak GRANT UPDATE); avatar_path – jak dotąd (grant z init).
