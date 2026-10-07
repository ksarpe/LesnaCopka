-- =============================================================================
-- Etap 6 – konto: regulamin i onboarding, blokowanie, eksport danych (RODO art. 15/20), usunięcie konta (art. 17)
--
--  · Regulamin: profiles.terms_version / terms_accepted_at (+ historia user_terms_acceptances) i onboarded_at.
--    Zapis wyłącznie przez accept_terms / complete_onboarding (brak GRANT UPDATE dla klienta);
--    get_game_state().profile: + termsVersion, termsAcceptedAt, onboardedAt.
--  · Blokowanie (user_blocks) działa W OBIE STRONY: blokujący i zablokowany nie widzą nawzajem swoich wpisów,
--    komentarzy ani aktywności, nie zaproszą się do znajomych i nie znajdą w wyszukiwarce. Zablokowanie usuwa
--    znajomość / zaproszenie między nimi. Klient czyta tylko własne blokady (kogo JA blokuję), zapis przez RPC.
--    Kto zablokował MNIE, nie jest pokazywane wprost: get_user → P0002 user_not_found (jak nieistniejący gracz).
--  · export_my_data() – wszystko o wywołującym w czytelnym jsonb (format "grzybobranie-export-v1"); z danych innych
--    graczy tylko publiczne nicki (znajomi, blokady).
--  · prepare_account_deletion() → ścieżki plików w Storage do usunięcia przez aplikację (SQL nie kasuje plików);
--    delete_my_account() – kasuje dane gracza i konto (auth.users → profil kaskadowo). Gdy rola właściciela funkcji
--    nie może usunąć auth.users (chmura) – dane i tak są skasowane, profil zanonimizowany (deleted_at), a wynik
--    mówi aplikacji, by dokończyła przez Edge Function delete-account (service role → auth.admin.deleteUser).
--  · profiles.deleted_at – usunięcie konta w toku (tylko serwer); taki profil jest dla innych „nieistniejący”.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Schemat
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists terms_version text
    check (terms_version is null or char_length(terms_version) between 1 and 32),   -- zaakceptowana wersja regulaminu
  add column if not exists terms_accepted_at timestamptz,                             -- kiedy (czas serwera)
  add column if not exists onboarded_at timestamptz,                                  -- koniec onboardingu w aplikacji
  add column if not exists deleted_at timestamptz;                                    -- usunięcie konta w toku (tylko serwer)

-- Historia akceptacji regulaminu (dowód zgody na każdą wersję) – zapis przez accept_terms.
create table if not exists public.user_terms_acceptances (
  user_id uuid not null references public.profiles (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- Blokady: blocker_id blokuje blocked_id (skutek w obie strony). Zapis przez block_user / unblock_user.
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_terms_acceptances enable row level security;
alter table public.user_blocks enable row level security;

drop policy if exists "regulamin: wlasne" on public.user_terms_acceptances;
create policy "regulamin: wlasne" on public.user_terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()));
-- Tylko blokady, które JA założyłem (kto zablokował mnie – niewidoczne).
drop policy if exists "blokady: wlasne" on public.user_blocks;
create policy "blokady: wlasne" on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Funkcje pomocnicze
-- ─────────────────────────────────────────────────────────────────────────────

-- Czy między dwoma graczami jest blokada (w dowolną stronę). Wewnętrzna.
create or replace function public.is_blocked_pair(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

-- To samo z perspektywy zalogowanego – do polityk RLS (posts, post_comments, post_reactions), stąd EXECUTE dla
-- authenticated. Zdradza tylko to, co i tak zdradzają RPC (send_friend_request → P0001 blocked).
create or replace function public.blocked_with_me(p_other uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.is_blocked_pair((select auth.uid()), p_other)
$$;

-- Czy p_viewer „widzi” gracza p_user (get_user, get_user_by_handle): profil istnieje i nie jest w trakcie usuwania,
-- a p_user nie zablokował p_viewer (chyba że p_viewer też zablokował jego – wtedy i tak go zna z listy blokad).
create or replace function public.user_visible_to(p_user uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.deleted_at is null)
     and (not exists (select 1 from public.user_blocks b where b.blocker_id = p_user and b.blocked_id = p_viewer)
          or exists (select 1 from public.user_blocks b where b.blocker_id = p_viewer and b.blocked_id = p_user))
$$;

-- Grzybiarz: + "blocked" (czy p_viewer zablokował tego gracza). Reszta bez zmian względem 20261008100000_social.sql.
create or replace function public.social_user_json(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select public.author_json(p.id) || jsonb_build_object(
    'homeGminaId', p.home_gmina_id,
    'tripsCount', p.trips_count,
    'mushroomsCount', p.mushrooms_count,
    'friendStatus', public.friend_status(p_viewer, p.id),
    'blocked', exists (select 1 from public.user_blocks b where b.blocker_id = p_viewer and b.blocked_id = p.id)
  )
    from public.profiles p
   where p.id = p_user
$$;

-- Widoczność wpisu: jak dotąd (własny zawsze, cudzy od visible_from, usunięty nigdy) + bez blokady między
-- autorem a p_viewer (w dowolną stronę). Jedna reguła dla get_post, reakcji, komentarzy, ukrywania i zgłoszeń.
create or replace function public.post_visible_to(p_post_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.posts p
     where p.id = p_post_id and p.deleted_at is null
       and (p.author_id = p_viewer or p.visible_from <= now())
       and not exists (select 1 from public.user_blocks b where b.blocker_id = p_viewer and b.blocked_id = p.author_id)
       and not exists (select 1 from public.user_blocks b where b.blocker_id = p.author_id and b.blocked_id = p_viewer)
  )
$$;

-- Wpis: "comments" bez komentarzy osób zablokowanych przez p_viewer / blokujących go (tak jak get_comments).
-- Reszta bez zmian względem 20261010100000_storage.sql ("reactions" – zwykły licznik, reakcje są anonimowe).
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
    'comments', greatest(0, p.comments_count - (
      select count(*) from public.post_comments c
       where c.post_id = p.id
         and c.author_id in (select b.blocked_id from public.user_blocks b where b.blocker_id = p_viewer
                             union all
                             select b.blocker_id from public.user_blocks b where b.blocked_id = p_viewer))),
    'reacted', exists (select 1 from public.post_reactions r where r.post_id = p.id and r.user_id = p_viewer),
    'mine', p.author_id = p_viewer,
    'createdAt', public.iso_ts(p.created_at),
    'publishedAt', public.iso_ts(p.published_at),
    'visibleFrom', public.iso_ts(p.visible_from)
  )
$$;

-- Znajomość między zablokowanymi nie powstaje – także przy bezpośrednim INSERT / UPDATE klienta (RLS na to pozwala).
-- Bez błędu (wiersz pomijany): RPC sprawdzają blokadę same i zwracają P0001 blocked, a boty deweloperskie się nie wywracają.
create or replace function public.friendships_block_guard() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.is_blocked_pair(new.user_id, new.friend_id) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists friendships_block_guard on public.friendships;
create trigger friendships_block_guard before insert or update on public.friendships
  for each row execute function public.friendships_block_guard();

-- Dane społecznościowe gracza (dev_reset_player): + blokady założone przez gracza. Reszta bez zmian.
create or replace function public.wipe_social_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.friendships where user_id = p_user or friend_id = p_user;
  delete from public.post_hides where user_id = p_user;
  delete from public.post_reports where reporter_id = p_user;
  delete from public.post_comments where author_id = p_user;     -- liczniki wpisów: trigger
  delete from public.post_reactions where user_id = p_user;
  delete from public.user_blocks where blocker_id = p_user;
end $$;

-- Wszystkie dane gracza (usunięcie konta): gra, dane społecznościowe, blokady w obie strony, obserwowane gminy,
-- tokeny push, historia regulaminu. Profil zostaje (kasuje go auth.users albo anonimizacja w delete_my_account).
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
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Polityki RLS: bezpośredni odczyt tabel (poza RPC) też bez treści zablokowanych / blokujących
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "posty: odczyt" on public.posts;
create policy "posty: odczyt" on public.posts for select to authenticated
  using (author_id = (select auth.uid())
         or (visible_from <= now() and deleted_at is null and not public.blocked_with_me(author_id)));

drop policy if exists "komentarze: odczyt" on public.post_comments;
create policy "komentarze: odczyt" on public.post_comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id) and not public.blocked_with_me(author_id));

drop policy if exists "reakcje: odczyt" on public.post_reactions;
create policy "reakcje: odczyt" on public.post_reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id) and not public.blocked_with_me(user_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Feed, komentarze, aktywność, wyszukiwarka, profil innych – z blokadami (reszta bez zmian)
-- ─────────────────────────────────────────────────────────────────────────────

-- Jak w 20261008100000_social.sql + bez wpisów autorów zablokowanych przez gracza / blokujących go (oba zakresy).
create or replace function public.get_feed(p_scope text default 'friends', p_before timestamptz default null, p_limit int default 20)
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
         and not exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = p.author_id)
         and not exists (select 1 from public.user_blocks b where b.blocker_id = p.author_id and b.blocked_id = v_uid)
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

-- Komentarze wpisu od najstarszego – bez komentarzy osób zablokowanych przez gracza / blokujących go.
-- Wpis autora, który zablokował gracza (albo którego gracz zablokował) → P0002 (post_visible_to).
create or replace function public.get_comments(p_post_id uuid) returns jsonb
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
       and not exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = c.author_id)
       and not exists (select 1 from public.user_blocks b where b.blocker_id = c.author_id and b.blocked_id = v_uid)
  );
end $$;

-- Ukryte wpisy – bez wpisów autorów w blokadzie z graczem (i tak niewidoczne). Reszta bez zmian.
create or replace function public.get_hidden_posts() returns jsonb
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
       and not public.is_blocked_pair(v_uid, p.author_id)
  );
end $$;

-- Aktywność – bez zdarzeń od graczy zablokowanych przez gracza / blokujących go. Reszta bez zmian.
create or replace function public.get_activity(p_since timestamptz default null, p_limit int default 50) returns jsonb
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
             'createdAt', public.iso_ts(page.at)
           ) order by page.at desc, page.id), '[]')
      from page
  );
end $$;

-- Wyszukiwarka: jak w 20261010100000_storage.sql + bez graczy w blokadzie z wywołującym (fraza i propozycje).
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
           and not exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = p.id)
           and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = v_uid)
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
           and not exists (select 1 from public.user_blocks b where b.blocker_id = v_uid and b.blocked_id = p.id)
           and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = v_uid)
         order by rn
         limit v_limit
      ) x;
  end if;
  return v_out;
end $$;

-- Mini profil: social user (+ "blocked") + "speciesCount". Gracz, który zablokował wywołującego (a nie jest przez niego
-- zablokowany), i konto w trakcie usuwania → P0002 user_not_found – jak nieistniejący (nie zdradzamy blokady).
create or replace function public.get_user(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.user_visible_to(p_user_id, v_uid) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  return public.social_user_json(p_user_id, v_uid)
      || jsonb_build_object('speciesCount', (select count(*) from public.user_species us where us.user_id = p_user_id));
end $$;

-- Jak get_user, po nicku (z „@” lub bez, bez wielkości liter); brak / niewidoczny (blokada, usuwane konto) → JSON null.
create or replace function public.get_user_by_handle(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select p.id into v_id from public.profiles p
   where p.handle = lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@+', ''))::citext;
  if v_id is null or not public.user_visible_to(v_id, v_uid) then return 'null'::jsonb; end if;
  return public.get_user(v_id);
end $$;

-- „Dodaj do znajomych”: jak w 20261008100000_social.sql + blokada w dowolną stronę → P0001 blocked;
-- konto w trakcie usuwania → P0002 user_not_found.
create or replace function public.send_friend_request(p_user_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.friendships;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- Szereguje równoczesne zaproszenia A→B i B→A (druga strona zobaczy pierwsze i je zaakceptuje) oraz blokady.
  perform pg_advisory_xact_lock(hashtext('friendship:' || least(v_uid, p_user_id)::text || ':' || greatest(v_uid, p_user_id)::text));
  if public.is_blocked_pair(v_uid, p_user_id) then
    raise exception 'blocked' using errcode = 'P0001';
  end if;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Blokowanie
-- ─────────────────────────────────────────────────────────────────────────────

-- „Zablokuj”. Idempotentne. Usuwa znajomość i zaproszenia między graczami (w obie strony).
-- Do siebie / null → P0001 invalid_user; nieznany (albo konto w trakcie usuwania) → P0002 user_not_found.
create or replace function public.block_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_user_id is null or p_user_id = v_uid then raise exception 'invalid_user' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  -- Ta sama blokada co w send_friend_request – zaproszenie nie „przeskoczy” blokady.
  perform pg_advisory_xact_lock(hashtext('friendship:' || least(v_uid, p_user_id)::text || ':' || greatest(v_uid, p_user_id)::text));
  insert into public.user_blocks (blocker_id, blocked_id) values (v_uid, p_user_id) on conflict do nothing;
  delete from public.friendships
   where (user_id = v_uid and friend_id = p_user_id) or (user_id = p_user_id and friend_id = v_uid);
end $$;

-- „Odblokuj”. Idempotentne (brak blokady / nieznany → nic). Znajomość nie wraca – trzeba zaprosić ponownie.
create or replace function public.unblock_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.user_blocks where blocker_id = v_uid and blocked_id = p_user_id;
end $$;

-- Zablokowani przez gracza (Ustawienia → „Zablokowani”), od ostatnio zablokowanego:
-- [{autor: id, handle, name, level, avatarPreset, avatarPath, ringRarity} + "blocked": true, "blockedAt"].
create or replace function public.get_blocked_users() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return (
    select coalesce(jsonb_agg(public.author_json(b.blocked_id)
                              || jsonb_build_object('blocked', true, 'blockedAt', public.iso_ts(b.created_at))
                              order by b.created_at desc, b.blocked_id), '[]')
      from public.user_blocks b
      join public.profiles p on p.id = b.blocked_id
     where b.blocker_id = v_uid
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Regulamin i onboarding
-- ─────────────────────────────────────────────────────────────────────────────

-- Akceptacja regulaminu w wersji p_version (np. '2026-10-06'; po obcięciu odstępów 1–32 znaki, inaczej
-- P0001 invalid_terms_version). Idempotentne: ta sama wersja → bez zmian (zostaje pierwszy czas akceptacji);
-- nowa wersja → profil dostaje wersję i czas serwera, a historia (user_terms_acceptances) – nowy wiersz.
create or replace function public.accept_terms(p_version text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_version text := btrim(coalesce(p_version, ''));
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(v_version) not between 1 and 32 then
    raise exception 'invalid_terms_version' using errcode = 'P0001', detail = 'Wersja regulaminu musi mieć od 1 do 32 znaków';
  end if;
  perform 1 from public.profiles where id = v_uid and deleted_at is null for update;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;
  insert into public.user_terms_acceptances (user_id, version) values (v_uid, v_version) on conflict do nothing;
  update public.profiles
     set terms_version = v_version, terms_accepted_at = now()
   where id = v_uid and terms_version is distinct from v_version;
end $$;

-- Koniec onboardingu: onboarded_at = now(), gdy jeszcze nie ustawione. Idempotentne.
create or replace function public.complete_onboarding() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.profiles set onboarded_at = now() where id = v_uid and onboarded_at is null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Stan gry: + profile.termsVersion, termsAcceptedAt, onboardedAt (reszta bez zmian względem 20261010100000_storage.sql)
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
    'quests', jsonb_build_object('day', to_char(v_today, 'YYYY-MM-DD'), 'progress', v_quests),
    'trips', v_trips,
    'finds', v_finds,
    'challenges', v_challenges,
    'followedGminy', v_follows
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Eksport danych (RODO art. 15 – dostęp, art. 20 – przenoszenie)
-- ─────────────────────────────────────────────────────────────────────────────

-- Wszystko o wywołującym w czytelnym jsonb (klucze po angielsku, camelCase; czasy jak Date.toISOString(), daty
-- YYYY-MM-DD, tablice nigdy null). Z danych innych graczy wyłącznie publiczne nicki (znajomi, blokady); komentarze
-- i reakcje INNYCH pod wpisami gracza – tylko liczniki we wpisach. Bez pól wewnętrznych (is_bot, listed, koszt modelu).
-- Prywatne dane gracza są w eksporcie: surowy ślad GPS wypraw ("track") i dokładny punkt znaleziska ("location").
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  u jsonb;
  pr public.profiles;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select to_jsonb(x) into u from auth.users x where x.id = v_uid;     -- to_jsonb: odporne na różnice wersji auth
  select * into pr from public.profiles where id = v_uid;

  return jsonb_build_object(
    'format', 'grzybobranie-export-v1',
    'exportedAt', public.iso_ts(now()),
    'userId', v_uid,
    'account', case when u is null then null else jsonb_build_object(
      'email', u ->> 'email',
      'isAnonymous', coalesce((u ->> 'is_anonymous')::boolean, false),
      'emailConfirmedAt', public.iso_ts((u ->> 'email_confirmed_at')::timestamptz),
      'createdAt', public.iso_ts((u ->> 'created_at')::timestamptz),
      'lastSignInAt', public.iso_ts((u ->> 'last_sign_in_at')::timestamptz)
    ) end,
    'profile', case when pr.id is null then null else jsonb_build_object(
      'handle', pr.handle::text,
      'displayName', pr.display_name,
      'firstName', pr.first_name,
      'avatarPreset', pr.avatar_preset,
      'avatarPath', pr.avatar_path,
      'homeGminaId', pr.home_gmina_id,
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
      'onboardedAt', public.iso_ts(pr.onboarded_at),
      'createdAt', public.iso_ts(pr.created_at),
      'updatedAt', public.iso_ts(pr.updated_at)
    ) end,
    'termsAcceptances', (
      select coalesce(jsonb_agg(jsonb_build_object('version', t.version, 'acceptedAt', public.iso_ts(t.accepted_at))
                                order by t.accepted_at, t.version), '[]')
        from public.user_terms_acceptances t where t.user_id = v_uid),
    'trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id,
               'gminaId', t.gmina_id,
               'status', t.status,
               'startedAt', public.iso_ts(t.started_at),
               'endedAt', public.iso_ts(t.ended_at),
               'durationS', t.duration_s,
               'distanceM', t.distance_m,
               'xp', t.xp,
               'hideRoute', t.hide_route,
               'routePublic', case when t.route_public is null then null else st_asgeojson(t.route_public)::jsonb end,
               'track', (select st_asgeojson(tt.track)::jsonb from public.trip_tracks tt where tt.trip_id = t.id),
               'createdAt', public.iso_ts(t.created_at)
             ) order by t.started_at, t.id), '[]')
        from public.trips t where t.user_id = v_uid),
    'finds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id,
               'tripId', f.trip_id,
               'scanId', f.scan_id,
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
               'xp', f.xp,
               'reward', f.reward,
               'personalRecord', f.personal_record,
               'photoPath', f.photo_path,
               'location', (select jsonb_build_object('lon', st_x(fl.location::geometry), 'lat', st_y(fl.location::geometry),
                                                      'accuracyM', fl.accuracy_m)
                              from public.find_locations fl where fl.find_id = f.id),
               'foundAt', public.iso_ts(f.found_at),
               'claimedAt', public.iso_ts(f.claimed_at),
               'visibleFrom', public.iso_ts(f.visible_from),
               'createdAt', public.iso_ts(f.created_at)
             ) order by f.found_at, f.id), '[]')
        from public.finds f where f.user_id = v_uid),
    'scans', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id,
               'tripId', s.trip_id,
               'status', s.status,
               'parts', s.parts,
               'photoPaths', s.photo_paths,
               'createdAt', public.iso_ts(s.created_at),
               'identifications', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', i.id,
                          'provider', i.provider,
                          'model', i.model,
                          'speciesId', i.species_id,
                          'confidence', i.confidence,
                          'candidates', i.candidates,
                          'dimensions', i.dimensions,
                          'createdAt', public.iso_ts(i.created_at)
                        ) order by i.created_at, i.id), '[]')
                   from public.identifications i where i.scan_id = s.id)
             ) order by s.created_at, s.id), '[]')
        from public.scans s where s.user_id = v_uid),
    'xpLedger', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'source', e.source, 'refId', e.ref_id, 'gminaId', e.gmina_id, 'amount', e.amount,
               'createdAt', public.iso_ts(e.created_at)
             ) order by e.created_at, e.id), '[]')
        from public.xp_events e where e.user_id = v_uid),
    'atlas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'speciesId', us.species_id, 'count', us.count, 'firstFoundAt', public.iso_ts(us.first_found_at),
               'bestCapCm', us.best_cap_cm, 'bestWeightG', us.best_weight_g, 'bestFindId', us.best_find_id
             ) order by us.first_found_at, us.species_id), '[]')
        from public.user_species us where us.user_id = v_uid),
    'badges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'badgeId', ub.badge_id, 'earnedAt', public.iso_ts(ub.earned_at), 'findId', ub.find_id
             ) order by ub.earned_at, ub.badge_id), '[]')
        from public.user_badges ub where ub.user_id = v_uid),
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'achievementId', ua.achievement_id, 'tier', ua.tier, 'unlockedAt', public.iso_ts(ua.unlocked_at),
               'findId', ua.find_id
             ) order by ua.unlocked_at, ua.achievement_id), '[]')
        from public.user_achievements ua where ua.user_id = v_uid),
    'quests', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'questId', uq.quest_id, 'day', to_char(uq.day, 'YYYY-MM-DD'), 'progress', uq.progress,
               'completedAt', public.iso_ts(uq.completed_at)
             ) order by uq.day, uq.quest_id), '[]')
        from public.user_quests uq where uq.user_id = v_uid),
    'challenges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'challengeId', uc.challenge_id, 'gminaId', c.gmina_id, 'title', c.title, 'speciesId', c.species_id,
               'acceptedAt', public.iso_ts(uc.accepted_at), 'completedAt', public.iso_ts(uc.completed_at), 'findId', uc.find_id
             ) order by uc.accepted_at, uc.challenge_id), '[]')
        from public.user_challenges uc join public.gmina_challenges c on c.id = uc.challenge_id
       where uc.user_id = v_uid),
    'followedGminy', (
      select coalesce(jsonb_agg(jsonb_build_object('gminaId', gf.gmina_id, 'createdAt', public.iso_ts(gf.created_at))
                                order by gf.created_at, gf.gmina_id), '[]')
        from public.gmina_follows gf where gf.user_id = v_uid),
    'pushTokens', (
      select coalesce(jsonb_agg(jsonb_build_object('token', pt.token, 'platform', pt.platform, 'createdAt', public.iso_ts(pt.created_at))
                                order by pt.created_at, pt.token), '[]')
        from public.push_tokens pt where pt.user_id = v_uid),
    -- Znajomi i zaproszenia: z drugiej strony tylko publiczny nick.
    'friendships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'handle', o.handle::text,
               'status', case when f.status = 'accepted' then 'friends' when f.user_id = v_uid then 'outgoing' else 'incoming' end,
               'createdAt', public.iso_ts(f.created_at),
               'acceptedAt', public.iso_ts(f.accepted_at)
             ) order by f.created_at, o.handle), '[]')
        from public.friendships f
        join public.profiles o on o.id = case when f.user_id = v_uid then f.friend_id else f.user_id end
       where v_uid in (f.user_id, f.friend_id)),
    -- Blokady założone przez gracza (kto zablokował gracza – to decyzja innej osoby, nie eksportujemy).
    'blocks', (
      select coalesce(jsonb_agg(jsonb_build_object('handle', o.handle::text, 'createdAt', public.iso_ts(b.created_at))
                                order by b.created_at, o.handle), '[]')
        from public.user_blocks b join public.profiles o on o.id = b.blocked_id
       where b.blocker_id = v_uid),
    -- Wpisy (także usunięte przez gracza – deleted_at) z payload jak zapisany.
    'posts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'kind', p.kind,
               'tripId', p.trip_id,
               'gminaId', p.gmina_id,
               'routePrecision', p.route_precision,
               'payload', p.payload,
               'reactions', p.reactions_count,
               'comments', p.comments_count,
               'createdAt', public.iso_ts(p.created_at),
               'publishedAt', public.iso_ts(p.published_at),
               'visibleFrom', public.iso_ts(p.visible_from),
               'deletedAt', public.iso_ts(p.deleted_at)
             ) order by p.created_at, p.id), '[]')
        from public.posts p where p.author_id = v_uid),
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'postId', c.post_id, 'text', c.body, 'createdAt', public.iso_ts(c.created_at)
             ) order by c.created_at, c.id), '[]')
        from public.post_comments c where c.author_id = v_uid),
    'reactions', (
      select coalesce(jsonb_agg(jsonb_build_object('postId', r.post_id, 'createdAt', public.iso_ts(r.created_at))
                                order by r.created_at, r.post_id), '[]')
        from public.post_reactions r where r.user_id = v_uid),
    'hiddenPosts', (
      select coalesce(jsonb_agg(jsonb_build_object('postId', h.post_id, 'createdAt', public.iso_ts(h.created_at))
                                order by h.created_at, h.post_id), '[]')
        from public.post_hides h where h.user_id = v_uid),
    'reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rp.id, 'postId', rp.post_id, 'commentId', rp.comment_id, 'reason', rp.reason,
               'createdAt', public.iso_ts(rp.created_at)
             ) order by rp.created_at, rp.id), '[]')
        from public.post_reports rp where rp.reporter_id = v_uid)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Usunięcie konta (RODO art. 17)
-- ─────────────────────────────────────────────────────────────────────────────

-- Krok 1 (przed usunięciem): pliki gracza w Storage do usunięcia przez aplikację (SQL nie kasuje plików) –
-- {"storagePaths": {"scan-photos": [...], "post-media": [...], "avatars": [...]}} (ścieżki bez nazwy koszyka, jak
-- w dev_reset_player) + "counts" (co zniknie – do okna potwierdzenia). Niczego nie zmienia.
create or replace function public.prepare_account_deletion() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return jsonb_build_object(
    'storagePaths', public.user_storage_paths(v_uid),
    'counts', jsonb_build_object(
      'trips', (select count(*) from public.trips where user_id = v_uid),
      'finds', (select count(*) from public.finds where user_id = v_uid and status = 'claimed'),
      'species', (select count(*) from public.user_species where user_id = v_uid),
      'posts', (select count(*) from public.posts where author_id = v_uid and deleted_at is null),
      'comments', (select count(*) from public.post_comments where author_id = v_uid),
      'friends', (select count(*) from public.friendships where status = 'accepted' and v_uid in (user_id, friend_id))
    )
  );
end $$;

-- Krok 2: kasuje WSZYSTKIE dane gracza (wipe_account_data – także jego komentarze i reakcje pod cudzymi wpisami,
-- znajomości, blokady w obie strony; cudze komentarze / reakcje / zgłoszenia pod jego wpisami znikają z wpisami),
-- a na końcu konto auth.users (kaskada: profil, sesje, tożsamości – refresh token przestaje działać).
-- Rankingi gmin przeliczą się bez jego XP (księga skasowana) przy następnym odświeżeniu (≤ 15 min).
-- Gdy rola właściciela funkcji nie ma prawa usunąć auth.users (chmura) albo usunięcie się nie powiedzie: dane i tak
-- są skasowane, profil zanonimizowany (nick usuniety_<id>, „Konto usunięte”, poza wyszukiwarką, deleted_at), a wynik
-- ma authUserDeleted = false i next = 'edge_function:delete-account' – aplikacja kończy przez Edge Function
-- (service role → auth.admin.deleteUser). Ponowne wywołanie jest bezpieczne.
-- Wynik: {"deleted": true, "authUserDeleted": bool, "next": null | "edge_function:delete-account", "authError": sqlstate | null}.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_err text;
  v_msg text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  perform public.wipe_account_data(v_uid);

  begin
    delete from auth.users where id = v_uid;                -- kaskada: profiles → reszta; auth.sessions, identities…
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate, v_msg = message_text;
  end;

  if v_err is not null then
    update public.profiles
       set handle = 'usuniety_' || left(replace(v_uid::text, '-', ''), 15),
           display_name = 'Konto usunięte',
           first_name = null,
           avatar_path = null,
           avatar_preset = null,
           home_gmina_id = null,
           listed = false,
           terms_version = null,
           terms_accepted_at = null,
           onboarded_at = null,
           deleted_at = coalesce(deleted_at, now())
     where id = v_uid;
    raise notice 'delete_my_account: nie usunięto auth.users (% – %); dane skasowane, profil zanonimizowany – dokończ przez Edge Function delete-account',
      v_err, v_msg;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'authUserDeleted', v_err is null,
    'next', case when v_err is not null then 'edge_function:delete-account' end,
    'authError', v_err
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.user_blocks, public.user_terms_acceptances from anon, authenticated;
grant select on public.user_blocks, public.user_terms_acceptances to authenticated;
-- profiles.terms_version / terms_accepted_at / onboarded_at / deleted_at – bez GRANT UPDATE (tylko RPC).

revoke all on function
  public.is_blocked_pair(uuid, uuid),
  public.blocked_with_me(uuid),
  public.user_visible_to(uuid, uuid),
  public.social_user_json(uuid, uuid),
  public.post_visible_to(uuid, uuid),
  public.post_json(public.posts, uuid),
  public.friendships_block_guard(),
  public.wipe_social_data(uuid),
  public.wipe_account_data(uuid),
  public.get_feed(text, timestamptz, int),
  public.get_comments(uuid),
  public.get_hidden_posts(),
  public.get_activity(timestamptz, int),
  public.search_users(text, int),
  public.get_user(uuid),
  public.get_user_by_handle(text),
  public.send_friend_request(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.get_blocked_users(),
  public.accept_terms(text),
  public.complete_onboarding(),
  public.get_game_state(),
  public.export_my_data(),
  public.prepare_account_deletion(),
  public.delete_my_account()
  from public, anon, authenticated;

grant execute on function
  public.blocked_with_me(uuid),                            -- polityki RLS posts / post_comments / post_reactions
  public.get_feed(text, timestamptz, int),
  public.get_comments(uuid),
  public.get_hidden_posts(),
  public.get_activity(timestamptz, int),
  public.search_users(text, int),
  public.get_user(uuid),
  public.get_user_by_handle(text),
  public.send_friend_request(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.get_blocked_users(),
  public.accept_terms(text),
  public.complete_onboarding(),
  public.get_game_state(),
  public.export_my_data(),
  public.prepare_account_deletion(),
  public.delete_my_account()
  to authenticated;
