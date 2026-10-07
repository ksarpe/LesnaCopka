-- ─────────────────────────────────────────────────────────────────────────────
-- Etap 8 – „gdzie i kiedy co znaleźć”: szanse na gatunki i mapa gatunku
-- ─────────────────────────────────────────────────────────────────────────────
-- Serwer daje WYŁĄCZNIE agregaty zbiorów na gminę – nigdy punkty znalezisk ani autorów. Model szans liczy aplikacja
-- (src/utils/chances.ts – sezon, rzadkość, lesistość, prognoza + te dane), więc mocki i Supabase dzielą ten sam kod.
--
-- Prywatność (jak reszta statystyk): tylko odebrane znaleziska (status 'claimed') po visible_from (koniec wyprawy +
-- privacy_delay() = 24 h). k-anonimowość:
--  · gatunek w zbiorach gminy / gmina na mapie gatunku – dopiero przy co najmniej 2 RÓŻNYCH znalazcach;
--  · zbiory gminy w ogóle – dopiero przy co najmniej 3 znalazcach i 5 znaleziskach w oknie (inaczej pusta odpowiedź:
--    jedna osoba w gminie nie zdradza, co i ile zebrała, ani że w ogóle tam była).
-- Znaleziska gatunków pominiętych (< 2 znalazców) są tylko w łącznym `total` zbiorów gminy (bez wskazania gatunku);
-- na mapie gatunku `total` to suma pokazanych gmin.
--
-- Migracja nie wymaga kolumn sezonu gatunków (season_weights / habitats – migracja katalogu 20261013100000) – działa
-- samodzielnie.

-- Mapa gatunku filtruje po gatunku i czasie (statystyki gmin mają indeks po gminie: finds_stats_idx).
create index if not exists finds_species_stats_idx on public.finds (species_id, found_at) where status = 'claimed';

-- Zbiory gatunków w gminie z ostatnich p_days dni (domyślnie 14, zakres 1–28) – wejście modelu szans.
--  · total – wszystkie widoczne znaleziska gminy w oknie (także gatunków pominiętych na liście),
--  · species – gatunki z ≥ 2 znalazcami: finds (znaleziska), finders (różni gracze), od najczęstszego;
--  · za mało danych (< 3 znalazców albo < 5 znalezisk) → total 0, species [].
-- Nieznana gmina → P0002 gmina_not_found; bez sesji → 28000.
create or replace function public.get_gmina_species_evidence(p_gmina_id text, p_days int default 14)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c_species_finders constant int := 2;   -- gatunek na liście: co najmniej tylu różnych znalazców
  c_gmina_finders constant int := 3;     -- zbiory gminy: co najmniej tylu znalazców w oknie…
  c_gmina_finds constant int := 5;       -- …i tyle znalezisk
  v_days int := least(greatest(coalesce(p_days, 14), 1), 28);
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 28));
  v_total bigint;
  v_finders bigint;
  v_species jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.gminy g where g.id = p_gmina_id) then
    raise exception 'gmina_not_found' using errcode = 'P0002';
  end if;

  select count(*), count(distinct f.user_id)
    into v_total, v_finders
    from public.finds f
   where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.visible_from <= now() and f.found_at >= v_from;

  if v_finders < c_gmina_finders or v_total < c_gmina_finds then
    return jsonb_build_object('gminaId', p_gmina_id, 'days', v_days, 'total', 0, 'species', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('speciesId', x.species_id, 'finds', x.n, 'finders', x.users)
                            order by x.n desc, x.species_id), '[]'::jsonb)
    into v_species
    from (
      select f.species_id, count(*) as n, count(distinct f.user_id) as users
        from public.finds f
       where f.gmina_id = p_gmina_id and f.status = 'claimed' and f.visible_from <= now() and f.found_at >= v_from
       group by f.species_id
      having count(distinct f.user_id) >= c_species_finders
    ) x;

  return jsonb_build_object('gminaId', p_gmina_id, 'days', v_days, 'total', v_total, 'species', v_species);
end $$;

-- Gdzie zbiera się gatunek: gminy województwa (p_voivodeship jak w get_ranking: null → województwo gminy domowej
-- gracza / podlaskie, bez wielkości liter, nieznane → P0001 invalid_voivodeship) w okresie p_period:
-- 'week' = ostatnie 7 dni, 'season' = od 1 stycznia (jak ranking sezonu); inny → P0001 invalid_period.
--  · heat – stopień 1–4 gmin z ≥ 2 znalazcami gatunku: 4 − ⌊4 · (miejsce − 1) / liczba gmin⌋, miejsce = rank()
--    po liczbie znalezisk (remis = ten sam stopień); gmin bez wpisu nie pokazujemy (brak danych albo < 2 znalazców),
--  · top – do 5 gmin z największą liczbą znalezisk {gminaId, name, finds},
--  · total – znaleziska gatunku w pokazanych gminach.
-- Nieznany gatunek → P0002 species_not_found; bez sesji → 28000.
create or replace function public.get_species_map(p_species_id text, p_voivodeship text default null, p_period text default 'season')
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c_gmina_finders constant int := 2;     -- gmina na mapie: co najmniej tylu różnych znalazców gatunku
  v_uid uuid := auth.uid();
  v_period text := lower(btrim(coalesce(p_period, 'season')));
  v_voiv text;
  v_from timestamptz;
  v_heat jsonb;
  v_top jsonb;
  v_total bigint;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.species s where s.id = p_species_id) then
    raise exception 'species_not_found' using errcode = 'P0002';
  end if;
  if v_period not in ('week', 'season') then
    raise exception 'invalid_period' using errcode = 'P0001',
      detail = format('Nieznany okres mapy „%s” (week, season)', p_period);
  end if;
  v_voiv := public.resolve_voivodeship(p_voivodeship, v_uid);
  v_from := case v_period
              when 'week' then now() - interval '7 days'
              else public.warsaw_ts(public.ranking_period_start('season'))
            end;

  with per as (
    select f.gmina_id, g.name, count(*) as n
      from public.finds f
      join public.gminy g on g.id = f.gmina_id
     where f.species_id = p_species_id and f.status = 'claimed' and f.visible_from <= now() and f.found_at >= v_from
       and g.voivodeship = v_voiv
     group by f.gmina_id, g.name
    having count(distinct f.user_id) >= c_gmina_finders
  ), ranked as (
    select per.*,
           rank() over (order by per.n desc) as rk,
           count(*) over () as cnt,
           row_number() over (order by per.n desc, per.name, per.gmina_id) as rn
      from per
  )
  select coalesce(jsonb_object_agg(r.gmina_id, 4 - floor(4.0 * (r.rk - 1) / r.cnt)::int), '{}'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('gminaId', r.gmina_id, 'name', r.name, 'finds', r.n) order by r.rn)
                    filter (where r.rn <= 5), '[]'::jsonb),
         coalesce(sum(r.n), 0)
    into v_heat, v_top, v_total
    from ranked r;

  return jsonb_build_object(
    'speciesId', p_species_id,
    'voivodeship', v_voiv,
    'period', v_period,
    'heat', v_heat,
    'top', v_top,
    'total', v_total
  );
end $$;

-- Uprawnienia: tylko zalogowani (także konta anonimowe aplikacji), anon bez dostępu.
revoke all on function
  public.get_gmina_species_evidence(text, int),
  public.get_species_map(text, text, text)
  from public, anon, authenticated;

grant execute on function
  public.get_gmina_species_evidence(text, int),
  public.get_species_map(text, text, text)
  to authenticated;
