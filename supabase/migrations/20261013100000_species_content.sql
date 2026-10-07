-- =============================================================================
-- Katalog gatunków: treść karty gatunku + ochrona gatunkowa
--
--  · species: season_weights (12 liczb I–XII, 0..1, szczyt = 1), habitats (siedliska: iglasty, lisciasty, mieszany,
--    laka, drewno, torfowisko, park), protection ('scisla' | 'czesciowa' – rozporządzenie Ministra Środowiska
--    z 9 października 2014 r. w sprawie ochrony gatunkowej grzybów, Dz.U. 2014 poz. 1408), description (już w init).
--    `add column if not exists` – te same kolumny dodaje model szans (20261013120000_chances.sql).
--  · species_lookalikes.sort – kolejność sobowtórów (0 = główny = Species.lookalike w aplikacji). Wiele wierszy na
--    gatunek było możliwe od init; lookalike_id seed ustawia tylko dla głównego (para do „Mistrza sobowtórów”, jak
--    utils/achievements.ts liczy Species.lookalike).
--  · submit_find: collected = nie trujący/śmiertelny I nie chroniony (gatunek chroniony – tylko zdjęcie).
--  · claim_find: rozpiska XP jak utils/xp.ts (computeFindXp): przy zdjęciu gatunku chronionego „Zdjęcie gatunku
--    chronionego (½ bazy)” + „Zostawiony w lesie – gatunek chroniony” +30. Reszta bez zmian (idempotentność: odebrane
--    znalezisko zwraca zapisaną nagrodę).
--  Treść (120 gatunków, sobowtóry) – supabase/seed.sql z src/data/mock/species.ts (npm run db:seed); źródła:
--  docs/species-sources.md.
-- =============================================================================

alter table public.species add column if not exists season_weights numeric[];
alter table public.species add column if not exists habitats text[];
alter table public.species add column if not exists protection text check (protection in ('scisla', 'czesciowa'));
alter table public.species add column if not exists description text;

comment on column public.species.season_weights is 'Względna częstość owocnikowania w miesiącach I–XII (12 liczb 0..1, szczyt = 1).';
comment on column public.species.habitats is 'Siedliska (pierwsze = najczęstsze): iglasty, lisciasty, mieszany, laka, drewno, torfowisko, park.';
comment on column public.species.protection is 'Ochrona gatunkowa (Dz.U. 2014 poz. 1408): scisla | czesciowa; null = niechroniony. Chroniony = tylko zdjęcie.';

-- Spójność treści (nazwane – nie dublują się przy ponownym wgraniu; null dozwolone).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'species_season_weights_check') then
    alter table public.species add constraint species_season_weights_check
      check (season_weights is null or (array_length(season_weights, 1) = 12 and 0 <= all (season_weights) and 1 >= all (season_weights)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'species_habitats_check') then
    alter table public.species add constraint species_habitats_check
      check (habitats is null or habitats <@ array['iglasty', 'lisciasty', 'mieszany', 'laka', 'drewno', 'torfowisko', 'park']);
  end if;
end $$;

alter table public.species_lookalikes add column if not exists sort smallint not null default 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- submit_find: jak w 20261012100000_anticheat.sql, collected = nie trujący i nie chroniony.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.submit_find(
  p_find_id uuid,
  p_trip_id uuid,
  p_gmina_id text,
  p_species_id text,
  p_rarity public.rarity,
  p_confidence numeric,
  p_xxl boolean,
  p_dimensions jsonb,
  p_candidates jsonb,
  p_parts text[],
  p_found_at timestamptz
)
returns public.finds
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  f public.finds;
  sp public.species;
  v_trip public.trips;
  v_trip_id uuid;
  v_scan_id uuid;
  v_ident_id uuid;
  v_found timestamptz := coalesce(p_found_at, now());
  v_candidates jsonb := coalesce(p_candidates, '[]');
  v_cap numeric;
  v_height numeric;
  v_weight int;
  v_age int;
  v_pieces int;
  v_dims jsonb;
  v_used bigint;
  v_rarity public.rarity;
  v_xxl boolean;
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

  select * into sp from public.species where id = p_species_id;
  if not found then
    raise exception 'unknown_species' using errcode = 'P0001', detail = format('Gatunek „%s” nie istnieje w katalogu', p_species_id);
  end if;
  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'unknown_gmina' using errcode = 'P0001', detail = format('Gmina „%s” nie istnieje w bazie', p_gmina_id);
  end if;
  if p_rarity is null then
    raise exception 'invalid_rarity' using errcode = 'P0001', detail = 'Brak rzadkości okazu';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid_confidence' using errcode = 'P0001',
      detail = format('Pewność rozpoznania musi być w zakresie 0–1 (jest %s)', coalesce(p_confidence::text, 'null'));
  end if;
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

  if v_found > now() + interval '5 minutes' or v_found < now() - interval '14 days' then
    raise exception 'invalid_found_at' using errcode = 'P0001',
      detail = format('Czas znaleziska %s poza zakresem (najwyżej 14 dni wstecz, 5 min w przód)', v_found);
  end if;
  v_found := least(v_found, now());

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
  -- Dziennie wg czasu serwera.
  select count(*) into v_used
    from public.finds x
   where x.user_id = v_uid and x.created_at >= public.warsaw_ts(public.local_today());
  perform public.check_rate_limit(
    v_uid, 'submit_find_day', v_used, public.anti_cheat_param('submit_find_per_day')::int, 'doba (czas serwera)',
    format('Dzienny limit znalezisk (%s) został wyczerpany. Spróbuj jutro.', public.anti_cheat_param('submit_find_per_day')),
    public.warsaw_ts(public.local_today() + 1));

  -- ── Prawda serwera: rzadkość i XXL ──
  v_rarity := p_rarity;
  if p_rarity < sp.rarity then
    v_rarity := sp.rarity;
  elsif public.rarity_rank(p_rarity) > public.rarity_rank(sp.rarity) + 1 then
    v_rarity := (enum_range(null::public.rarity))[public.rarity_rank(sp.rarity) + 2];
    perform public.flag(v_uid, 'rarity_clamped', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'speciesRarity', sp.rarity, 'reported', p_rarity, 'stored', v_rarity));
  end if;

  v_xxl := coalesce(p_xxl, false);
  if v_xxl and (sp.clustered or v_weight is null or v_weight < sp.typical_weight_g * public.anti_cheat_param('xxl_factor')) then
    v_xxl := false;
    perform public.flag(v_uid, 'xxl_corrected', 1, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'typicalWeightG', sp.typical_weight_g, 'clustered', sp.clustered));
  end if;

  -- ── Flagi wiarygodności ──
  v_piece_g := case when not sp.clustered then v_weight
                    when v_pieces > 0 then v_weight::numeric / v_pieces end;   -- kępka bez liczby sztuk – bez sprawdzenia wagi
  if v_piece_g > sp.typical_weight_g * public.anti_cheat_param('find_weight_factor')
     or v_cap > sp.typical_cap_cm * public.anti_cheat_param('find_cap_factor') then
    perform public.flag(v_uid, 'find_size', 2, p_find_id::text, jsonb_build_object(
      'speciesId', sp.id, 'weightG', v_weight, 'pieces', v_pieces, 'capCm', v_cap,
      'typicalWeightG', sp.typical_weight_g, 'typicalCapCm', sp.typical_cap_cm));
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

  v_dims := jsonb_strip_nulls(jsonb_build_object(
    'cap_cm', v_cap, 'height_cm', v_height, 'weight_g', v_weight, 'age_days', v_age, 'pieces', v_pieces));

  insert into public.scans (user_id, trip_id, status, parts)
  values (v_uid, v_trip_id, 'identified', coalesce(p_parts, '{}'))
  returning id into v_scan_id;

  insert into public.identifications (scan_id, provider, model, species_id, confidence, candidates, dimensions)
  values (v_scan_id, 'client-sim', 'mock-v1', sp.id, p_confidence, v_candidates, v_dims)
  returning id into v_ident_id;

  insert into public.finds (
    id, user_id, trip_id, scan_id, identification_id, species_id, gmina_id, rarity, confidence, xxl,
    cap_cm, height_cm, weight_g, age_days, pieces, collected, status, found_at
  )
  values (
    p_find_id, v_uid, v_trip_id, v_scan_id, v_ident_id, sp.id, p_gmina_id, v_rarity, p_confidence, v_xxl,
    v_cap, v_height, v_weight, v_age, v_pieces,
    sp.edibility not in ('trujacy', 'smiertelny') and sp.protection is null,   -- trujący albo chroniony → tylko zdjęcie
    'pending', v_found
  )
  returning * into f;

  -- Seria rzadkich okazów (łącznie z nowym; bez odrzuconych).
  if v_rarity >= 'rzadki' then
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
-- claim_find: jak w 20261012100000_anticheat.sql + linie XP gatunku chronionego (lustro utils/xp.ts).
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
  v_day_xp bigint;
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
    -- Gatunek chroniony (także chroniony i trujący) – etykieta „chronionego” + bonus za zostawienie w lesie.
    v_lines := v_lines || jsonb_build_object(
      'label', case when sp.protection is not null then 'Zdjęcie gatunku chronionego (½ bazy)' else 'Zdjęcie gatunku trującego (½ bazy)' end,
      'xp', round(v_base / 2.0)::int);
    if sp.protection is not null then
      v_lines := v_lines || jsonb_build_object('label', 'Zostawiony w lesie – gatunek chroniony', 'xp', 30);
    end if;
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

  -- Anty-cheat: XP ze znalezisk dziś (łącznie z tym) ponad „miękki” limit → flaga, nagroda bez zmian.
  select coalesce(sum(e.amount), 0) into v_day_xp
    from public.xp_events e
   where e.user_id = v_uid and e.source = 'find' and e.created_at >= public.warsaw_ts(public.local_today());
  if v_day_xp > public.anti_cheat_param('daily_find_xp_soft_cap') then
    perform public.flag(v_uid, 'xp_daily_soft_cap', 2, to_char(public.local_today(), 'YYYY-MM-DD'), jsonb_build_object(
      'xpToday', v_day_xp, 'softCap', public.anti_cheat_param('daily_find_xp_soft_cap'), 'lastFindId', f.id));
  end if;

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

-- Funkcje zmienione przez create or replace zachowują dotychczasowe uprawnienia.
