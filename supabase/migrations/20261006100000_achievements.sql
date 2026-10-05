-- =============================================================================
-- Osiągnięcia – liczone z atlasu gatunków (lustro src/utils/achievements.ts)
--
--  · Słownik: achievements (metryka + parametry), achievement_tiers (1–4 stopnie: próg, XP, medal, cel),
--    achievement_set_species (gatunki zestawów, np. „Wielka trójka”). Wypełnia seed.sql (npm run db:seed).
--  · Gracz: user_achievements = liczba NAGRODZONYCH stopni. Postęp liczy się na bieżąco z user_species / finds
--    (achievement_value), więc nie da się go „dopisać” – tak jak XP, wyłącznie funkcje SECURITY DEFINER.
--  · claim_find po aktualizacji atlasu wywołuje sync_achievements: nowe stopnie → xp_events (źródło
--    'achievement', ref „id:stopień”) i reward.unlockedAchievements = [{id, tier, xp}] (kształt z aplikacji).
-- =============================================================================

alter type public.xp_source add value if not exists 'achievement';

create type public.achievement_category as enum ('kolekcja', 'zestawy', 'bezpieczenstwo', 'okazy', 'sekretne');
create type public.achievement_metric as enum (
  'species',            -- gatunki w atlasie; params: {"rarity": "..."} i/lub {"edibility": "jadalne"|"trujace"|"smiertelne"}
  'set',                -- gatunki zestawu (achievement_set_species) w atlasie
  'specimens',          -- suma okazów w atlasie (z fotografiami trujących)
  'max_of_species',     -- najwięcej okazów jednego gatunku
  'species_with_count', -- gatunki znalezione co najmniej params.min razy
  'lookalike_pairs',    -- pary gatunek + sobowtór z katalogu (oba w atlasie)
  'xxl_finds',          -- odebrane okazy XXL (zebrane)
  'record'              -- rekord osobisty: params {"species": "...", "field": "best_cap_cm"|"best_weight_g"}
);
create type public.achievement_medal as enum ('braz', 'srebro', 'zloto', 'platyna');

-- ─────────────────────────────────────────────────────────────────────────────
-- Słownik (publiczny do odczytu)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.achievements (
  id text primary key,                                   -- 'kolekcjoner' – ten sam slug co w aplikacji
  category public.achievement_category not null,
  name text not null,
  icon text not null,                                    -- nazwa Material Symbol
  metric public.achievement_metric not null,
  params jsonb not null default '{}',
  secret boolean not null default false,                 -- do zdobycia aplikacja pokazuje „???”
  sort smallint not null default 0,
  active boolean not null default true
);

create table public.achievement_tiers (
  achievement_id text not null references public.achievements (id) on delete cascade,
  tier smallint not null check (tier between 1 and 4),
  target numeric(10, 1) not null check (target > 0),
  xp int not null check (xp > 0),
  medal public.achievement_medal not null,               -- 4 stopnie: brąz→platyna, 2: srebro, złoto, 1: złoto
  goal text not null,                                    -- „Odkryj 25 gatunków w atlasie” (np. do powiadomień)
  primary key (achievement_id, tier)
);

create table public.achievement_set_species (
  achievement_id text not null references public.achievements (id) on delete cascade,
  species_id text not null references public.species (id),
  primary key (achievement_id, species_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Gracz
-- ─────────────────────────────────────────────────────────────────────────────

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  tier smallint not null check (tier between 1 and 4),   -- liczba nagrodzonych stopni
  unlocked_at timestamptz not null default now(),        -- ostatni zdobyty stopień
  find_id uuid references public.finds (id) on delete set null,
  primary key (user_id, achievement_id)
);
create index user_achievements_recent_idx on public.user_achievements (user_id, unlocked_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Logika (lustro metricValue / evaluateAchievement z aplikacji)
-- ─────────────────────────────────────────────────────────────────────────────

-- Bieżąca wartość metryki osiągnięcia dla gracza.
create function public.achievement_value(p_user uuid, a public.achievements) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(case a.metric
    when 'species' then (
      select count(*) from public.user_species us join public.species s on s.id = us.species_id
       where us.user_id = p_user
         and (a.params ->> 'rarity' is null or s.rarity = (a.params ->> 'rarity')::public.rarity)
         and case a.params ->> 'edibility'
               when 'jadalne' then s.edibility = 'jadalny'
               when 'trujace' then s.edibility in ('trujacy', 'smiertelny')
               when 'smiertelne' then s.edibility = 'smiertelny'
               else true
             end)
    when 'set' then (
      select count(*) from public.achievement_set_species m
        join public.user_species us on us.species_id = m.species_id and us.user_id = p_user
       where m.achievement_id = a.id)
    when 'specimens' then (select sum(us.count) from public.user_species us where us.user_id = p_user)
    when 'max_of_species' then (select max(us.count) from public.user_species us where us.user_id = p_user)
    when 'species_with_count' then (
      select count(*) from public.user_species us
       where us.user_id = p_user and us.count >= (a.params ->> 'min')::int)
    when 'lookalike_pairs' then (
      select count(distinct least(l.species_id, l.lookalike_id) || '|' || greatest(l.species_id, l.lookalike_id))
        from public.species_lookalikes l
        join public.user_species a1 on a1.user_id = p_user and a1.species_id = l.species_id
        join public.user_species a2 on a2.user_id = p_user and a2.species_id = l.lookalike_id
       where l.lookalike_id is not null and l.lookalike_id <> l.species_id)
    when 'xxl_finds' then (
      select count(*) from public.finds f
       where f.user_id = p_user and f.status = 'claimed' and f.xxl and f.collected)
    when 'record' then (
      select case a.params ->> 'field' when 'best_cap_cm' then us.best_cap_cm when 'best_weight_g' then us.best_weight_g end
        from public.user_species us
       where us.user_id = p_user and us.species_id = a.params ->> 'species')
  end, 0)::numeric
$$;

-- Liczba osiągniętych stopni dla wartości.
create function public.achievement_reached_tier(p_achievement_id text, p_value numeric) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.achievement_tiers t where t.achievement_id = p_achievement_id and t.target <= p_value
$$;

-- Wewnętrzna: nagradza nowo osiągnięte stopnie (XP do księgi); zwraca [{id, tier, xp}] jak w aplikacji.
create function public.sync_achievements(p_user uuid, p_find_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.achievements;
  t public.achievement_tiers;
  v_value numeric;
  v_have int;
  v_reached int;
  v_gmina text;
  v_out jsonb := '[]';
begin
  if p_find_id is not null then
    select gmina_id into v_gmina from public.finds where id = p_find_id;
  end if;
  for a in select * from public.achievements where active order by sort loop
    v_value := public.achievement_value(p_user, a);
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

-- Wewnętrzna (seed / wdrożenie): zapisuje już osiągnięte stopnie jako nagrodzone, BEZ XP –
-- gracz z istniejącym atlasem nie dostaje jednorazowo setek XP (jak migracja v2 w aplikacji).
create function public.seed_achievements(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into public.user_achievements (user_id, achievement_id, tier)
  select p_user, a.id, r.tier
    from public.achievements a
    cross join lateral (select public.achievement_reached_tier(a.id, public.achievement_value(p_user, a)) as tier) r
   where a.active and r.tier > 0
  on conflict (user_id, achievement_id) do update set tier = greatest(public.user_achievements.tier, excluded.tier);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- RPC dla aplikacji (profil / „Osiągnięcia”): postęp zalogowanego gracza – tylko własny (atlas jest prywatny).
create function public.achievement_progress()
returns table (achievement_id text, value numeric, tier int, awarded_tier int, next_target numeric, next_xp int)
language sql stable security definer set search_path = public as $$
  select a.id,
         v.value,
         public.achievement_reached_tier(a.id, v.value),
         coalesce(ua.tier, 0)::int,
         n.target,
         n.xp
    from public.achievements a
    cross join lateral (select public.achievement_value((select auth.uid()), a) as value) v
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
-- claim_find: + osiągnięcia (reszta bez zmian względem 20261005120000_init.sql)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.claim_find(p_find_id uuid) returns jsonb
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
  v_achievements jsonb := '[]';
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

  -- Osiągnięcia z nowego stanu atlasu (XP do księgi od razu; aplikacja pokazuje kartę na ekranie Nagroda).
  v_achievements := public.sync_achievements(v_uid, f.id);

  if v_after.level > v_before.level then
    insert into public.posts (author_id, kind, gmina_id, payload, visible_from)
    values (v_uid, 'levelup', f.gmina_id, jsonb_build_object('level', v_after.level), now() + public.privacy_delay());
  end if;

  v_reward := jsonb_build_object(
    'xp', jsonb_build_object('lines', v_lines, 'total', v_total),
    'levelBefore', v_before.level, 'xpBefore', v_before.xp_in_level,
    'levelAfter', v_after.level, 'xpAfter', v_after.xp_in_level,
    'unlockedBadgeIds', to_jsonb(v_badges),
    'unlockedAchievements', v_achievements,
    'completedQuestIds', to_jsonb(v_quests),
    'completedChallengeIds', to_jsonb(v_challenges),
    'personalRecord', v_record
  );
  update public.finds set reward = v_reward where id = f.id;
  return v_reward;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS i uprawnienia (Supabase domyślnie nadaje anon/authenticated wszystko na nowych obiektach – odbieramy)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.achievements enable row level security;
alter table public.achievement_tiers enable row level security;
alter table public.achievement_set_species enable row level security;
alter table public.user_achievements enable row level security;

create policy "slownik: odczyt" on public.achievements for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.achievement_tiers for select to anon, authenticated using (true);
create policy "slownik: odczyt" on public.achievement_set_species for select to anon, authenticated using (true);
-- Zdobyte stopnie są publiczne jak odznaki (profil innych graczy); postęp (atlas) – tylko przez achievement_progress().
create policy "osiagniecia: odczyt" on public.user_achievements for select to authenticated using (true);

revoke all on public.achievements, public.achievement_tiers, public.achievement_set_species, public.user_achievements
  from anon, authenticated;
grant select on public.achievements, public.achievement_tiers, public.achievement_set_species to anon, authenticated;
grant select on public.user_achievements to authenticated;

revoke all on function
  public.achievement_value(uuid, public.achievements),
  public.achievement_reached_tier(text, numeric),
  public.sync_achievements(uuid, uuid),
  public.seed_achievements(uuid),
  public.achievement_progress()
  from public, anon, authenticated;
grant execute on function public.achievement_progress() to authenticated;
