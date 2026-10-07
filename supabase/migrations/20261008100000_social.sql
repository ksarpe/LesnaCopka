-- =============================================================================
-- Etap 3 – feed, znajomi i aktywność na serwerze
--
--  · Odczyty dla aplikacji zwracają jsonb w camelCase (jak get_game_state), czasy jak Date.toISOString().
--  · Widoczność wpisu (jedna reguła dla feedu, wpisu, komentarzy, reakcji, ukrywania i zgłoszeń):
--    własny zawsze, cudzy od visible_from (publikacja + 24 h); usunięty – nigdy. Inaczej P0002 post_not_found.
--  · Znajomi dwustronnie: jeden wiersz friendships na parę (user_id = zapraszający, friend_id = zaproszony);
--    akceptuje zaproszony, accepted_at ustawia trigger. Zaproszenie „w drugą stronę” = akceptacja.
--  · Aktywność („co inni zrobili mnie”) liczona na bieżąco z reakcji, komentarzy i zaproszeń – bez osobnej tabeli.
--  · Wpisy ukryte (post_hides) i zgłoszenia (post_reports) zapisuje wyłącznie serwer (RPC).
--  · dev_seed_social / dev_bots_act – boty do testów lokalnych (app_config.dev_tools = true; w chmurze wyłączone).
-- =============================================================================

-- Wyszukiwanie bez polskich znaków („lukasz” → „Łukasz”).
create extension if not exists unaccent with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists avatar_preset text check (avatar_preset ~ '^[a-z0-9-]{1,32}$'),   -- gotowy avatar z aplikacji ('sowa')
  add column if not exists is_bot boolean not null default false;                           -- boty deweloperskie (dev_seed_social)

alter table public.friendships add column if not exists accepted_at timestamptz;
update public.friendships set accepted_at = created_at where status = 'accepted' and accepted_at is null;

-- Jedna relacja na parę (dotąd mogły istnieć A→B i B→A): zostaje zaakceptowana, a przy remisie jedna z dwóch.
delete from public.friendships a
 using public.friendships b
 where a.user_id = b.friend_id and a.friend_id = b.user_id
   and (a.status < b.status or (a.status = b.status and a.user_id > a.friend_id));
create unique index friendships_pair_uidx
  on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

-- accepted_at: ustawiane przy akceptacji (także bezpośrednim UPDATE status przez zaproszonego), zerowane dla pending.
create function public.friendships_accepted_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'accepted' then
    if tg_op = 'INSERT' or old.status <> 'accepted' then
      new.accepted_at := coalesce(new.accepted_at, now());
    end if;
  else
    new.accepted_at := null;
  end if;
  return new;
end $$;
create trigger friendships_accepted_at before insert or update on public.friendships
  for each row execute function public.friendships_accepted_at();

-- Wpisy ukryte przez gracza („Ukryj wpis”) – znikają z jego feedu.
create table public.post_hides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- Zgłoszenia wpisów / komentarzy (moderacja) – klient nie czyta, zapis przez report_post.
create table public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,   -- null = zgłoszony cały wpis
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique nulls not distinct (reporter_id, post_id, comment_id)
);
create index post_reports_post_idx on public.post_reports (post_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze (wewnętrzne – bez EXECUTE dla klientów)
-- ─────────────────────────────────────────────────────────────────────────────

-- Tekst do wyszukiwania: małe litery, bez polskich znaków, separatory (spacja . _ -) jako jedna spacja.
create function public.fold_text(t text) returns text
language sql stable set search_path = '' as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '[\s._-]+', ' ', 'g'))
$$;

-- Kolor obwódki avatara: rzadkość najrzadszego odebranego znaleziska gracza albo 'primary'.
create function public.ring_rarity(p_user uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(max(f.rarity)::text, 'primary')
    from public.finds f
   where f.user_id = p_user and f.status = 'claimed'
$$;

-- Relacja z perspektywy p_viewer: 'none' | 'friends' | 'outgoing' (ja zaprosiłem) | 'incoming' (mnie zaproszono).
create function public.friend_status(p_viewer uuid, p_other uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((
    select case when f.status = 'accepted' then 'friends' when f.user_id = p_viewer then 'outgoing' else 'incoming' end
      from public.friendships f
     where (f.user_id = p_viewer and f.friend_id = p_other) or (f.user_id = p_other and f.friend_id = p_viewer)
     order by (f.status = 'accepted') desc
     limit 1
  ), 'none')
$$;

-- Autor / pozycja listy: {"id","handle","name","level","avatarPreset","ringRarity"} (handle bez „@”).
create function public.author_json(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id,
    'handle', p.handle::text,
    'name', coalesce(nullif(btrim(p.display_name), ''), p.handle::text),
    'level', p.level,
    'avatarPreset', p.avatar_preset,
    'ringRarity', public.ring_rarity(p.id)
  )
    from public.profiles p
   where p.id = p_user
$$;

-- Grzybiarz (wyszukiwarka, znajomi, mini profil): autor + gmina, liczniki i relacja z p_viewer.
create function public.social_user_json(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select public.author_json(p.id) || jsonb_build_object(
    'homeGminaId', p.home_gmina_id,
    'tripsCount', p.trips_count,
    'mushroomsCount', p.mushrooms_count,
    'friendStatus', public.friend_status(p_viewer, p.id)
  )
    from public.profiles p
   where p.id = p_user
$$;

-- Czy p_viewer widzi wpis: własny zawsze, cudzy od visible_from; usunięty – nigdy.
create function public.post_visible_to(p_post_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.posts p
     where p.id = p_post_id and p.deleted_at is null
       and (p.author_id = p_viewer or p.visible_from <= now())
  )
$$;

-- Wpis dla aplikacji (payload bez zmian – jak zapisał publish_trip / claim_find).
create function public.post_json(p public.posts, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', p.id,
    'kind', p.kind,
    'author', public.author_json(p.author_id),
    'gminaId', p.gmina_id,
    'tripId', p.trip_id,
    'routePrecision', p.route_precision,
    'payload', p.payload,
    'reactions', p.reactions_count,
    'comments', p.comments_count,
    'reacted', exists (select 1 from public.post_reactions r where r.post_id = p.id and r.user_id = p_viewer),
    'mine', p.author_id = p_viewer,
    'createdAt', public.iso_ts(p.created_at),
    'publishedAt', public.iso_ts(p.published_at),
    'visibleFrom', public.iso_ts(p.visible_from)
  )
$$;

create function public.comment_json(c public.post_comments, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', c.id,
    'postId', c.post_id,
    'author', public.author_json(c.author_id),
    'text', c.body,
    'createdAt', public.iso_ts(c.created_at),
    'mine', c.author_id = p_viewer
  )
$$;

-- Czyści dane społecznościowe gracza (dev_reset_player): znajomi, ukryte, zgłoszenia, komentarze i reakcje.
create function public.wipe_social_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.friendships where user_id = p_user or friend_id = p_user;
  delete from public.post_hides where user_id = p_user;
  delete from public.post_reports where reporter_id = p_user;
  delete from public.post_comments where author_id = p_user;     -- liczniki wpisów: trigger
  delete from public.post_reactions where user_id = p_user;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Feed (ekran 09)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.get_feed(text, timestamptz, int);

-- Wpisy od najnowszych: 'friends' = własne + zaakceptowani znajomi (w obie strony), 'gmina' = wpisy w gminie
-- domowej gracza (brak gminy → []). Bez usuniętych i ukrytych przez gracza; cudze dopiero od visible_from.
-- Stronicowanie: p_before = createdAt ostatniego wpisu z poprzedniej strony. p_limit 1–50.
create function public.get_feed(p_scope text default 'friends', p_before timestamptz default null, p_limit int default 20)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_home text;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_scope is null or p_scope not in ('friends', 'gmina') then
    raise exception 'invalid_scope' using errcode = 'P0001', detail = format('Nieznany zakres feedu „%s” (friends | gmina)', p_scope);
  end if;
  if p_scope = 'gmina' then
    select home_gmina_id into v_home from public.profiles where id = v_uid;
    if v_home is null then return '[]'; end if;
  end if;

  select coalesce(jsonb_agg(public.post_json(x.post, v_uid) order by (x.post).created_at desc, (x.post).id desc), '[]')
    into v_out
    from (
      select p as post
        from public.posts p
       where p.deleted_at is null
         and (p.author_id = v_uid or p.visible_from <= now())
         and (p_before is null or p.created_at < p_before)
         and not exists (select 1 from public.post_hides h where h.user_id = v_uid and h.post_id = p.id)
         and case
               when p_scope = 'gmina' then p.gmina_id = v_home
               else p.author_id = v_uid or exists (
                 select 1 from public.friendships f
                  where f.status = 'accepted'
                    and ((f.user_id = v_uid and f.friend_id = p.author_id) or (f.friend_id = v_uid and f.user_id = p.author_id)))
             end
       order by p.created_at desc, p.id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x;
  return v_out;
end $$;

-- Pojedynczy wpis (szczegóły / komentarze / link z powiadomienia).
create function public.get_post(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  p public.posts;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into p from public.posts where id = p_post_id;
  if not found or not public.post_visible_to(p.id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  return public.post_json(p, v_uid);
end $$;

-- „Darz grzyb!” – przełącznik (sygnatura bez zmian). Tylko na widocznym wpisie, inaczej P0002.
create or replace function public.toggle_reaction(p_post_id uuid, out reacted boolean, out reactions int)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.post_visible_to(p_post_id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  delete from public.post_reactions where post_id = p_post_id and user_id = v_uid;
  if found then
    reacted := false;
  else
    insert into public.post_reactions (post_id, user_id) values (p_post_id, v_uid) on conflict do nothing;
    reacted := true;
  end if;
  select reactions_count into reactions from public.posts where id = p_post_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Komentarze
-- ─────────────────────────────────────────────────────────────────────────────

-- Komentarze wpisu od najstarszego.
create function public.get_comments(p_post_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.post_visible_to(p_post_id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  return (
    select coalesce(jsonb_agg(public.comment_json(c, v_uid) order by c.created_at, c.id), '[]')
      from public.post_comments c
     where c.post_id = p_post_id
  );
end $$;

-- Nowy komentarz (1–280 znaków po obcięciu spacji). Idempotentny po p_comment_id (uuid z telefonu):
-- ponowne wysłanie zwraca zapisany komentarz; cudzy / pod innym wpisem → P0001 comment_id_conflict.
create function public.add_comment(p_post_id uuid, p_text text, p_comment_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_text text := regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g');
  c public.post_comments;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_comment_id is not null then
    select * into c from public.post_comments where id = p_comment_id;
    if found then
      if c.author_id = v_uid and c.post_id = p_post_id then return public.comment_json(c, v_uid); end if;
      raise exception 'comment_id_conflict' using errcode = 'P0001';
    end if;
  end if;
  if char_length(v_text) not between 1 and 280 then
    raise exception 'invalid_comment' using errcode = 'P0001', detail = 'Komentarz musi mieć od 1 do 280 znaków';
  end if;
  if not public.post_visible_to(p_post_id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;

  insert into public.post_comments (id, post_id, author_id, body)
  values (coalesce(p_comment_id, gen_random_uuid()), p_post_id, v_uid, v_text)
  on conflict (id) do nothing
  returning * into c;
  if c.id is null then                                     -- równoległe ponowienie z tym samym id
    select * into c from public.post_comments where id = p_comment_id and author_id = v_uid;
    if not found then raise exception 'comment_id_conflict' using errcode = 'P0001'; end if;
  end if;
  return public.comment_json(c, v_uid);
end $$;

-- Usuwa własny komentarz; cudzy / nieistniejący → nic (idempotentne).
create function public.delete_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.post_comments where id = p_comment_id and author_id = v_uid;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ukrywanie i zgłaszanie wpisów
-- ─────────────────────────────────────────────────────────────────────────────

create function public.hide_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.post_visible_to(p_post_id, v_uid) then
    raise exception 'post_not_found' using errcode = 'P0002';
  end if;
  insert into public.post_hides (user_id, post_id) values (v_uid, p_post_id) on conflict do nothing;
end $$;

-- p_post_ids = null → przywraca wszystkie ukryte wpisy.
create function public.unhide_posts(p_post_ids uuid[] default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.post_hides where user_id = v_uid and (p_post_ids is null or post_id = any(p_post_ids));
end $$;

-- Ukryte wpisy (ustawienia → „Ukryte wpisy”), od ostatnio ukrytego; tylko nadal widoczne.
create function public.get_hidden_posts() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return (
    select coalesce(jsonb_agg(public.post_json(p, v_uid) order by h.created_at desc, p.id), '[]')
      from public.post_hides h
      join public.posts p on p.id = h.post_id
     where h.user_id = v_uid and p.deleted_at is null
       and (p.author_id = v_uid or p.visible_from <= now())
  );
end $$;

-- Zgłoszenie wpisu albo komentarza (p_comment_id). Idempotentne: drugie zgłoszenie tego samego nic nie zmienia.
create function public.report_post(p_post_id uuid, p_comment_id uuid default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g'), '');
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
  insert into public.post_reports (post_id, comment_id, reporter_id, reason)
  values (p_post_id, p_comment_id, v_uid, v_reason)
  on conflict do nothing;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Publikacja (bez zmian w działaniu; + 28000 bez sesji)
-- ─────────────────────────────────────────────────────────────────────────────

-- „Opublikuj w feedzie”: wpis widoczny dla innych dopiero po privacy_delay(). Idempotentne (opublikowana → ten sam wpis).
-- Trasa w payload tylko z trips.route_public (uogólnionej) – bez śladu GPS route = null, route_precision = 'gmina'.
create or replace function public.publish_trip(p_trip_id uuid, p_hide_route boolean, p_title text default null)
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
      'route', case when coalesce(p_hide_route, false) or t.route_public is null then null else st_asgeojson(t.route_public)::jsonb end
    ),
    now() + public.privacy_delay()
  )
  returning * into p;
  update public.trips set status = 'published', hide_route = coalesce(p_hide_route, false) where id = t.id;
  return p;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grzybiarze i znajomi
-- ─────────────────────────────────────────────────────────────────────────────

-- Wyszukiwarka: nick / nazwa / imię, bez wielkości liter i polskich znaków, „@” na początku pomijane.
-- Pusta fraza → propozycje: najpierw ta sama gmina domowa, potem najaktywniejsi; bez obecnych znajomych.
-- Zawsze bez wywołującego. p_limit 1–50.
create function public.search_users(p_query text default '', p_limit int default 20) returns jsonb
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
           and (strpos(public.fold_text(p.handle::text), v_q) > 0
             or strpos(public.fold_text(p.display_name), v_q) > 0
             or strpos(public.fold_text(p.first_name), v_q) > 0)
         order by rn
         limit v_limit
      ) x;
  end if;
  return v_out;
end $$;

-- {"friends": [...] (wg nazwy), "incoming": [...], "outgoing": [...] (zaproszenia od najnowszego)}.
create function public.get_friends() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return jsonb_build_object(
    'friends', (
      select coalesce(jsonb_agg(public.social_user_json(p.id, v_uid)
               order by public.fold_text(coalesce(nullif(btrim(p.display_name), ''), p.handle::text)), p.id), '[]')
        from public.friendships f
        join public.profiles p on p.id = case when f.user_id = v_uid then f.friend_id else f.user_id end
       where f.status = 'accepted' and v_uid in (f.user_id, f.friend_id)),
    'incoming', (
      select coalesce(jsonb_agg(public.social_user_json(f.user_id, v_uid) order by f.created_at desc, f.user_id), '[]')
        from public.friendships f
       where f.friend_id = v_uid and f.status = 'pending'),
    'outgoing', (
      select coalesce(jsonb_agg(public.social_user_json(f.friend_id, v_uid) order by f.created_at desc, f.friend_id), '[]')
        from public.friendships f
       where f.user_id = v_uid and f.status = 'pending')
  );
end $$;

-- Mini profil grzybiarza: social user + "speciesCount" (gatunki w atlasie – tylko liczba, atlas zostaje prywatny).
create function public.get_user(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  return public.social_user_json(p_user_id, v_uid)
      || jsonb_build_object('speciesCount', (select count(*) from public.user_species us where us.user_id = p_user_id));
end $$;

-- Jak get_user, ale po nicku (z „@” lub bez, bez wielkości liter); brak → JSON null.
create function public.get_user_by_handle(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select p.id into v_id from public.profiles p
   where p.handle = lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@+', ''))::citext;
  if v_id is null then return 'null'::jsonb; end if;
  return public.get_user(v_id);
end $$;

-- „Dodaj do znajomych”. Zwraca nowy friendStatus:
--  · on zaprosił mnie wcześniej → akceptacja ('friends'); już znajomi → 'friends';
--  · ja już zaprosiłem → 'outgoing' (bez zmian); inaczej nowe zaproszenie → 'outgoing'.
create function public.send_friend_request(p_user_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.friendships;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- Szereguje równoczesne zaproszenia A→B i B→A (druga strona zobaczy pierwsze i je zaakceptuje).
  perform pg_advisory_xact_lock(hashtext('friendship:' || least(v_uid, p_user_id)::text || ':' || greatest(v_uid, p_user_id)::text));

  select * into f from public.friendships
   where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid)
   for update;
  if found then
    if f.status = 'accepted' then return 'friends'; end if;
    if f.user_id = v_uid then return 'outgoing'; end if;
    update public.friendships set status = 'accepted', accepted_at = now()
     where user_id = f.user_id and friend_id = f.friend_id;
    return 'friends';
  end if;
  insert into public.friendships (user_id, friend_id, status) values (v_uid, p_user_id, 'pending') on conflict do nothing;
  return public.friend_status(v_uid, p_user_id);
end $$;

-- Odpowiedź na zaproszenie OD p_user_id: akceptacja → 'friends', odrzucenie → 'none'. Brak zaproszenia → obecny status.
create function public.respond_friend_request(p_user_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_accept is null then raise exception 'invalid_response' using errcode = 'P0001'; end if;
  if p_accept then
    update public.friendships set status = 'accepted', accepted_at = now()
     where user_id = p_user_id and friend_id = v_uid and status = 'pending';
  else
    delete from public.friendships where user_id = p_user_id and friend_id = v_uid and status = 'pending';
  end if;
  return public.friend_status(v_uid, p_user_id);
end $$;

-- Usuwa znajomość albo zaproszenie w dowolną stronę (też „Anuluj zaproszenie”).
create function public.remove_friend(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.friendships
   where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Aktywność (powiadomienia w aplikacji): co INNI zrobili mnie, od najnowszego
-- ─────────────────────────────────────────────────────────────────────────────

--  reaction        "reaction:<postId>:<userId>"  – „Darz grzyb!” pod moim wpisem
--  comment         "comment:<commentId>"          – komentarz pod moim wpisem (text: treść, max 120 znaków)
--  friend_request  "friend_request:<userId>"      – zaproszenie do mnie (oczekujące)
--  friend_accepted "friend_accepted:<userId>"     – ktoś przyjął MOJE zaproszenie (czas: accepted_at)
-- p_since → tylko nowsze (createdAt > p_since). p_limit 1–100.
create function public.get_activity(p_since timestamptz default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return (
    with mine as (
      select p.id from public.posts p where p.author_id = v_uid and p.deleted_at is null
    ), items as (
      select 'reaction:' || r.post_id || ':' || r.user_id as id, 'reaction' as kind, r.user_id as actor,
             r.post_id, null::text as body, r.created_at as at
        from public.post_reactions r join mine m on m.id = r.post_id
       where r.user_id <> v_uid
      union all
      select 'comment:' || c.id, 'comment', c.author_id, c.post_id,
             case when char_length(c.body) > 120 then left(c.body, 119) || '…' else c.body end, c.created_at
        from public.post_comments c join mine m on m.id = c.post_id
       where c.author_id <> v_uid
      union all
      select 'friend_request:' || f.user_id, 'friend_request', f.user_id, null, null, f.created_at
        from public.friendships f
       where f.friend_id = v_uid and f.status = 'pending'
      union all
      select 'friend_accepted:' || f.friend_id, 'friend_accepted', f.friend_id, null, null, f.accepted_at
        from public.friendships f
       where f.user_id = v_uid and f.status = 'accepted' and f.accepted_at is not null
    ), page as (
      select * from items
       where p_since is null or at > p_since
       order by at desc, id
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', page.id,
             'kind', page.kind,
             'actor', public.author_json(page.actor),
             'postId', page.post_id,
             'text', page.body,
             'createdAt', public.iso_ts(page.at)
           ) order by page.at desc, page.id), '[]')
      from page
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Narzędzia deweloperskie (tylko przy app_config.dev_tools = true)
-- ─────────────────────────────────────────────────────────────────────────────

-- Boty z puli mocków aplikacji (src/data/mock/social.ts): konta w auth.users (trigger tworzy profil), is_bot = true,
-- poziom (wpis 'import' w księdze), gmina domowa, liczniki, avatar, znalezisko „obwódki” (bez visible_from – nie wchodzi
-- do statystyk gmin), mały atlas oraz 1–3 wpisy sprzed 1–6 dni z reakcjami i komentarzami innych botów.
-- Boty powstają raz (szukane po nicku); wpisy – gdy bot nie ma żadnego z ostatnich 6 dni.
-- Relacje z WYWOŁUJĄCYM (dla każdego gracza osobno, idempotentnie): 6 znajomych (Ola_W, Marek_K, Bartek, Ewa.las,
-- Kasia_P, Tomek_B) i 2 zaproszenia do gracza (Zosia_Kania, Łukasz_Borowik); reszta bez relacji.
-- Zwraca stan po wywołaniu: {"bots", "friends" (znajomi gracza), "incoming" (zaproszenia do gracza), "posts" (wpisy botów)}.
create function public.dev_seed_social() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_titles text[] := array[
    'Szybki obchód przed pracą', 'Niedzielny spacer z koszykiem', 'Podgrzybki po nocnym deszczu', 'Kurki na skraju boru',
    'Rodzinne grzybobranie', 'Mgła, mech i pełny kosz'];                 -- TRIP_TITLES z social.ts
  v_generic text[] := array[
    'Piękne zbiory, gratulacje!', 'Darz grzyb!', 'Ale kosz! Zazdroszczę.', 'U nas po deszczu też ruszyło, jutro idę.',
    'W Puszczy wysyp – potwierdzam, wczoraj było to samo.', 'U nas sucho jak pieprz, same zajączki.',
    'Rano mgła, potem słońce – idealna pogoda na grzyby.', 'Nie pytam gdzie, wiem, że i tak nie powiesz :)',
    'Szacun za dystans!', 'Wybieram się w weekend, oby coś zostało.', 'Zdrowe czy robaczywe?', 'Suszyć czy marynować? :)',
    'Takie poranki to ja rozumiem.', 'Ile z tego pójdzie na sos?', 'Mój rekord w tym sezonie to połowa tego.',
    'Brawo, piękna robota!', 'Też tam chodzę i pusto – masz nosa!', 'Zabierz mnie następnym razem!', 'Komary nie zjadły? :)',
    'Po takim deszczu musiało sypnąć.', 'Kurki już są czy jeszcze za wcześnie?',
    'Pamiętajcie o sobowtórach, w tym roku dużo szatanów.', 'Kosz pełny, a nogi pewnie czują każdy kilometr.',
    'No i mam motywację na jutro.'];
  b record;
  p record;
  v_bot uuid;
  v_is_bot boolean;
  v_gmina text;
  v_ring public.rarity;
  v_ring_rank int;
  v_total bigint;
  v_sp public.species;
  v_n int;
  v_k int;
  v_at timestamptz;
  v_tpl jsonb;
  v_payload jsonb;
  v_mush int;
  v_post uuid;
  v_new_posts uuid[] := '{}';
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  -- Dwa telefony naraz nie utworzą botów podwójnie.
  perform pg_advisory_xact_lock(hashtext('dev_seed_social'));

  for b in
    select * from (values
      (1, 'ola.w', 'Ola_W', 'Aleksandra', 'suprasl', 27, 'legendarny', 212, 'bor',
        '{"kind":"trip","title":"Poranny obchód po deszczu","distance_km":5.2,"duration_min":160,"mushrooms":14,"species":6,"xp":1940,"hl":"szmaciak-galezisty","weight_g":2300,"cap_cm":34}'::jsonb),
      (2, 'marek.k', 'Marek_K', 'Marek', 'suprasl', 20, 'primary', 148, 'lisc',
        '{"kind":"levelup","level":20,"badge_name":"Mistrz Kani"}'::jsonb),
      (3, 'bartek.z', 'Bartek', 'Bartłomiej', 'michalowo', 11, 'rzadki', 61, 'mech',
        '{"kind":"trip","title":"Szybki obchód przed pracą","distance_km":3.1,"duration_min":70,"mushrooms":6,"species":3,"xp":520}'::jsonb),
      (4, 'ewa.las', 'Ewa.las', 'Ewa', 'suprasl', 18, 'epicki', 97, 'rosa',
        '{"kind":"trip","title":"Kanie na skraju Puszczy","distance_km":4.4,"duration_min":135,"mushrooms":9,"species":4,"xp":1210,"hl":"czubajka-kania","weight_g":260,"cap_cm":34}'::jsonb),
      (5, 'kasia.p', 'Kasia_P', 'Katarzyna', 'grodek', 15, 'rzadki', 73, 'wrzos',
        '{"kind":"trip","title":"Pierwsze rydze w tym roku!","distance_km":3.8,"duration_min":95,"mushrooms":8,"species":3,"xp":760,"hl":"mleczaj-rydz","weight_g":95,"cap_cm":9}'::jsonb),
      (6, 'tomek.b', 'Tomek_B', 'Tomasz', 'suprasl', 12, 'pospolity', 52, 'slonce',
        '{"kind":"levelup","level":12,"badge_name":"Ranny ptaszek"}'::jsonb),
      (7, 'grzybiarz77', 'Grzybiarz77', 'Paweł', 'suprasl', 9, 'pospolity', 34, 'dab', null),
      (8, 'zosia.kania', 'Zosia_Kania', 'Zofia', 'hajnowka', 22, 'epicki', 133, 'lis', null),
      (9, 'jurek.puszcza', 'Jurek_z_Puszczy', 'Jerzy', 'bialowieza', 31, 'legendarny', 402, 'biedronka', null),
      (10, 'lukasz.borowik', 'Łukasz_Borowik', 'Łukasz', 'michalowo', 16, 'rzadki', 88, 'sowa', null),
      (11, 'gosia.pg', 'Gosia_Podgrzybek', 'Małgorzata', 'grodek', 19, 'epicki', 109, 'zajac', null),
      (12, 'magda.lesna', 'MagdaLeśna', 'Magdalena', 'narewka', 13, 'pospolity', 47, 'wedrowiec', null)
    ) as v(ord, handle, name, first_name, gmina, level, ring, trips, avatar, first_post)
    order by ord
  loop
    -- Konto bota (raz). Nick zajęty przez prawdziwego gracza → bota pomijamy.
    v_bot := null;
    select id, is_bot into v_bot, v_is_bot from public.profiles where handle = b.handle;
    continue when v_bot is not null and not v_is_bot;
    if v_bot is null then
      v_bot := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', v_bot, 'authenticated', 'authenticated', true,
              '{"provider":"anonymous","providers":["anonymous"]}',
              jsonb_build_object('handle', b.handle, 'full_name', b.name, 'first_name', b.first_name, 'bot', true),
              now(), now());
    end if;

    v_gmina := coalesce((select g.id from public.gminy g where g.id = b.gmina), 'suprasl');
    update public.profiles
       set is_bot = true, display_name = b.name, first_name = b.first_name, home_gmina_id = v_gmina,
           avatar_preset = b.avatar, trips_count = b.trips, mushrooms_count = b.trips * 6 + b.level * 3,
           total_distance_m = b.trips * 4300, last_active_date = public.local_today()
     where id = v_bot;

    -- Poziom: jeden wpis 'import' w księdze (krzywa jak level_from_total_xp), bez gminy – nie wchodzi do rankingów.
    if (select total_xp from public.profiles where id = v_bot) = 0 then
      select coalesce(sum(public.level_threshold(l)), 0) + public.level_threshold(b.level) * 2 / 5
        into v_total from generate_series(1, b.level - 1) l;
      insert into public.xp_events (user_id, source, ref_id, amount) values (v_bot, 'import', 'dev_seed_social', v_total);
    end if;

    -- Obwódka avatara (ringRarity) = najrzadsze odebrane znalezisko; visible_from null → poza statystykami gmin.
    v_ring := null;
    v_ring_rank := null;
    if b.ring <> 'primary' then
      v_ring := b.ring::public.rarity;
      v_ring_rank := public.rarity_rank(v_ring);
    end if;
    if v_ring is not null and not exists (select 1 from public.finds f where f.user_id = v_bot and f.status = 'claimed') then
      select * into v_sp from public.species s where s.rarity = v_ring and s.edibility = 'jadalny' order by random() limit 1;
      insert into public.finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, weight_g, xp,
                                found_at, claimed_at)
      values (v_bot, v_sp.id, v_gmina, v_ring, 0.95, true, 'claimed', v_sp.typical_cap_cm, v_sp.typical_weight_g,
              public.rarity_base(v_ring), now() - interval '90 days', now() - interval '90 days');
    end if;

    -- Mały atlas (get_user → speciesCount).
    if not exists (select 1 from public.user_species us where us.user_id = v_bot) then
      insert into public.user_species (user_id, species_id, count, first_found_at, best_cap_cm, best_weight_g)
      select v_bot, s.id, 1 + floor(random() * 12)::int, now() - interval '400 days' + random() * interval '300 days',
             s.typical_cap_cm, s.typical_weight_g
        from public.species s
       where public.rarity_rank(s.rarity) <= coalesce(v_ring_rank, 1)
       order by s.id in (select f.species_id from public.finds f where f.user_id = v_bot and f.status = 'claimed') desc, s.atlas_no
       limit least(30, 3 + b.level / 2);
    end if;

    -- Wpisy (1–3) sprzed 26 h – 6 dni; widoczne od created_at + 24 h (już minęło). Bez wyprawy i bez trasy.
    if not exists (select 1 from public.posts x
                    where x.author_id = v_bot and x.deleted_at is null and x.created_at > now() - interval '6 days') then
      v_n := 1 + floor(random() * 3)::int;
      for i in 1 .. v_n loop
        v_at := now() - interval '26 hours' - random() * interval '116 hours';
        if i = 1 and b.first_post is not null then
          v_tpl := b.first_post;
        elsif random() < 0.25 then
          v_tpl := '{"kind":"levelup"}';
        else
          v_tpl := '{"kind":"trip"}';
        end if;

        if v_tpl ->> 'kind' = 'levelup' then
          v_payload := jsonb_build_object('level', coalesce((v_tpl ->> 'level')::int, b.level));
          if v_tpl ? 'badge_name' then
            v_payload := v_payload || jsonb_build_object('badge_name', v_tpl ->> 'badge_name');
          end if;
        else
          select * into v_sp from public.species s where false;            -- brak wyróżnienia
          if v_tpl ? 'hl' then
            select * into v_sp from public.species s where s.id = v_tpl ->> 'hl';
          elsif v_tpl ? 'title' then
            null;                                                           -- wpis z makiety bez wyróżnienia
          elsif random() < 0.6 then
            select * into v_sp from public.species s
             where s.edibility = 'jadalny' and public.rarity_rank(s.rarity) <= coalesce(v_ring_rank, 1)
             order by random() limit 1;
          end if;
          v_mush := coalesce((v_tpl ->> 'mushrooms')::int, 4 + floor(random() * 15)::int);
          v_payload := jsonb_build_object(
            'title', coalesce(v_tpl ->> 'title', v_titles[1 + floor(random() * array_length(v_titles, 1))::int]),
            'distance_km', coalesce((v_tpl ->> 'distance_km')::numeric, round((2 + random() * 5)::numeric, 1)),
            'duration_min', coalesce((v_tpl ->> 'duration_min')::int, 60 + floor(random() * 140)::int),
            'mushrooms', v_mush,
            'species', coalesce((v_tpl ->> 'species')::int, 2 + floor(random() * 4)::int),
            'xp', coalesce((v_tpl ->> 'xp')::int, v_mush * (70 + floor(random() * 40)::int)),
            'highlight', case when v_sp.id is null then null else jsonb_build_object(
              'rarity', v_sp.rarity,
              'species', v_sp.name,
              'weight_g', coalesce((v_tpl ->> 'weight_g')::int, round(v_sp.typical_weight_g * (0.9 + random() * 0.9))::int),
              'cap_cm', coalesce((v_tpl ->> 'cap_cm')::numeric, round((v_sp.typical_cap_cm * (0.9 + random() * 0.5))::numeric, 1))
            ) end,
            'route', null
          );
        end if;

        insert into public.posts (author_id, kind, gmina_id, route_precision, payload, created_at, published_at, visible_from)
        values (v_bot, (v_tpl ->> 'kind')::public.post_kind, v_gmina, 'gmina', v_payload, v_at, v_at, v_at + public.privacy_delay())
        returning id into v_post;
        v_new_posts := v_new_posts || v_post;
      end loop;
    end if;
  end loop;

  -- Reakcje (2–8) i komentarze (0–3, bez powtórek tekstu) innych botów pod nowymi wpisami botów.
  for p in select x.id, x.author_id, x.visible_from from public.posts x where x.id = any(v_new_posts) loop
    v_k := 2 + floor(random() * 7)::int;
    insert into public.post_reactions (post_id, user_id, created_at)
    select p.id, o.id, p.visible_from + random() * (now() - p.visible_from)
      from (select pr.id from public.profiles pr where pr.is_bot and pr.id <> p.author_id order by random() limit v_k) o
    on conflict do nothing;

    v_k := floor(random() * 4)::int;
    insert into public.post_comments (post_id, author_id, body, created_at)
    select p.id, a.id, t.body, p.visible_from + random() * (now() - p.visible_from)
      from (select pr.id, row_number() over (order by random()) rn
              from public.profiles pr where pr.is_bot and pr.id <> p.author_id) a
      join (select x.body, row_number() over (order by random()) rn from unnest(v_generic) x(body)) t on t.rn = a.rn
     where a.rn <= v_k;
  end loop;

  -- Relacje z wywołującym.
  for b in
    select pr.id, x.role
      from (values ('ola.w', 'friend'), ('marek.k', 'friend'), ('bartek.z', 'friend'), ('ewa.las', 'friend'),
                   ('kasia.p', 'friend'), ('tomek.b', 'friend'), ('zosia.kania', 'incoming'), ('lukasz.borowik', 'incoming')
           ) x(handle, role)
      join public.profiles pr on pr.handle = x.handle and pr.is_bot
     where pr.id <> v_uid
  loop
    if b.role = 'friend' then
      update public.friendships set status = 'accepted'
       where (user_id = v_uid and friend_id = b.id) or (user_id = b.id and friend_id = v_uid);
      if not found then
        v_at := now() - interval '10 days' - random() * interval '50 days';
        insert into public.friendships (user_id, friend_id, status, created_at, accepted_at)
        values (b.id, v_uid, 'accepted', v_at, v_at + interval '2 hours');
      end if;
    elsif not exists (select 1 from public.friendships f
                       where (f.user_id = v_uid and f.friend_id = b.id) or (f.user_id = b.id and f.friend_id = v_uid)) then
      insert into public.friendships (user_id, friend_id, status, created_at)
      values (b.id, v_uid, 'pending', now() - interval '1 hour' - random() * interval '20 hours');
    end if;
  end loop;

  return jsonb_build_object(
    'bots', (select count(*) from public.profiles where is_bot),
    'friends', (select count(*) from public.friendships where status = 'accepted' and v_uid in (user_id, friend_id)),
    'incoming', (select count(*) from public.friendships where status = 'pending' and friend_id = v_uid),
    'posts', (select count(*) from public.posts x join public.profiles pr on pr.id = x.author_id
               where pr.is_bot and x.deleted_at is null)
  );
end $$;

-- „Symuluj innych” (panel /dev): boty przyjmują zaproszenia gracza, wpisy gracza stają się widoczne od razu,
-- 2–3 znajomych botów reaguje i komentuje 3 ostatnie wpisy gracza (bot komentuje wpis raz, teksty bez powtórek),
-- a gdy gracz nie ma żadnego zaproszenia – jeden bot spoza znajomych je wysyła.
-- Zwraca {"accepted", "visible", "reactions", "comments", "requests"} (ile zmieniono).
create function public.dev_bots_act() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_trip_texts text[] := array[
    'Gratulacje, piękna wyprawa!', 'Darz grzyb!', 'No proszę, i to bez nas :)', 'Następnym razem idziemy razem.',
    'Ładny wynik, gratki!', 'Piękne zbiory, gratulacje!', 'Ale kosz! Zazdroszczę.', 'Szacun za dystans!',
    'Brawo, piękna robota!', 'Zabierz mnie następnym razem!', 'Takie poranki to ja rozumiem.', 'Suszyć czy marynować? :)',
    'No i mam motywację na jutro.'];
  v_level_texts text[] := array[
    'Gratulacje awansu!', 'Darz grzyb!', 'Brawo, tak trzymać!', 'Kolejny poziom – szacun!', 'No proszę, goni nas :)'];
  v_accepted int := 0;
  v_visible int := 0;
  v_reactions int := 0;
  v_comments int := 0;
  v_requests int := 0;
  v_friends uuid[];
  v_bot uuid;
  v_k int;
  v_text text;
  p record;
  b record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;

  -- 1. Boty przyjmują zaproszenia gracza.
  update public.friendships f set status = 'accepted', accepted_at = now()
   where f.user_id = v_uid and f.status = 'pending'
     and exists (select 1 from public.profiles pr where pr.id = f.friend_id and pr.is_bot);
  get diagnostics v_accepted = row_count;

  -- 2. Wpisy gracza widoczne od razu (tylko lokalnie – omija 24 h opóźnienia).
  update public.posts set visible_from = now()
   where author_id = v_uid and deleted_at is null and visible_from > now();
  get diagnostics v_visible = row_count;

  -- 3. Znajomi boty reagują i komentują 3 ostatnie wpisy gracza.
  select array_agg(pr.id) into v_friends
    from public.profiles pr
   where pr.is_bot and public.friend_status(v_uid, pr.id) = 'friends';
  if v_friends is not null then
    for p in
      select x.id, x.kind from public.posts x
       where x.author_id = v_uid and x.deleted_at is null
       order by x.created_at desc limit 3
    loop
      v_k := 2 + floor(random() * 2)::int;                  -- 2–3 boty na wpis
      for b in select f.id from unnest(v_friends) f(id) order by random() limit v_k loop
        insert into public.post_reactions (post_id, user_id, created_at) values (p.id, b.id, clock_timestamp())
        on conflict do nothing;
        if found then v_reactions := v_reactions + 1; end if;

        continue when exists (select 1 from public.post_comments c where c.post_id = p.id and c.author_id = b.id);
        select t into v_text
          from unnest(case when p.kind = 'levelup' then v_level_texts else v_trip_texts end) t
         where not exists (select 1 from public.post_comments c where c.post_id = p.id and c.body = t)
         order by random() limit 1;
        if v_text is not null then
          insert into public.post_comments (post_id, author_id, body, created_at) values (p.id, b.id, v_text, clock_timestamp());
          v_comments := v_comments + 1;
        end if;
      end loop;
    end loop;
  end if;

  -- 4. Nowe zaproszenie od bota spoza znajomych, gdy gracz nie ma żadnego oczekującego.
  if not exists (select 1 from public.friendships f where f.friend_id = v_uid and f.status = 'pending') then
    select pr.id into v_bot
      from public.profiles pr
     where pr.is_bot and pr.id <> v_uid
       and not exists (select 1 from public.friendships f
                        where (f.user_id = v_uid and f.friend_id = pr.id) or (f.user_id = pr.id and f.friend_id = v_uid))
     order by random() limit 1;
    if v_bot is not null then
      insert into public.friendships (user_id, friend_id, status) values (v_bot, v_uid, 'pending') on conflict do nothing;
      if found then v_requests := 1; end if;
    end if;
  end if;

  return jsonb_build_object('accepted', v_accepted, 'visible', v_visible, 'reactions', v_reactions,
                            'comments', v_comments, 'requests', v_requests);
end $$;

-- Świeży gracz (Lv 1, pusty atlas) z zachowaniem nicku, imienia, gminy domowej i avatara; + dane społecznościowe
-- (znajomi i zaproszenia, ukryte wpisy, zgłoszenia, własne komentarze i reakcje). Zwraca get_game_state().
create or replace function public.dev_reset_player() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  perform public.wipe_game_data(v_uid);
  perform public.wipe_social_data(v_uid);
  return public.get_game_state();
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS i uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.post_hides enable row level security;
alter table public.post_reports enable row level security;

create policy "ukryte: wlasne" on public.post_hides for select to authenticated using (user_id = (select auth.uid()));
-- post_reports: brak polityk – klient nie czyta ani nie zapisuje (tylko report_post).

revoke all on public.post_hides, public.post_reports from anon, authenticated;
grant select on public.post_hides to authenticated;
grant update (avatar_preset) on public.profiles to authenticated;

revoke all on function
  public.friendships_accepted_at(),
  public.fold_text(text),
  public.ring_rarity(uuid),
  public.friend_status(uuid, uuid),
  public.author_json(uuid),
  public.social_user_json(uuid, uuid),
  public.post_visible_to(uuid, uuid),
  public.post_json(public.posts, uuid),
  public.comment_json(public.post_comments, uuid),
  public.wipe_social_data(uuid),
  public.get_feed(text, timestamptz, int),
  public.get_post(uuid),
  public.toggle_reaction(uuid),
  public.get_comments(uuid),
  public.add_comment(uuid, text, uuid),
  public.delete_comment(uuid),
  public.hide_post(uuid),
  public.unhide_posts(uuid[]),
  public.get_hidden_posts(),
  public.report_post(uuid, uuid, text),
  public.publish_trip(uuid, boolean, text),
  public.search_users(text, int),
  public.get_friends(),
  public.get_user(uuid),
  public.get_user_by_handle(text),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.get_activity(timestamptz, int),
  public.dev_seed_social(),
  public.dev_bots_act(),
  public.dev_reset_player()
  from public, anon, authenticated;

grant execute on function
  public.get_feed(text, timestamptz, int),
  public.get_post(uuid),
  public.toggle_reaction(uuid),
  public.get_comments(uuid),
  public.add_comment(uuid, text, uuid),
  public.delete_comment(uuid),
  public.hide_post(uuid),
  public.unhide_posts(uuid[]),
  public.get_hidden_posts(),
  public.report_post(uuid, uuid, text),
  public.publish_trip(uuid, boolean, text),
  public.search_users(text, int),
  public.get_friends(),
  public.get_user(uuid),
  public.get_user_by_handle(text),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid),
  public.get_activity(timestamptz, int),
  public.dev_seed_social(),
  public.dev_bots_act(),
  public.dev_reset_player()
  to authenticated;
