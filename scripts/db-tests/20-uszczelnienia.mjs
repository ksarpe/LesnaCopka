/**
 * Uszczelnienia anty-cheatu i prywatności (supabase/migrations/20261015103000_uszczelnienia.sql) – dla każdej luki z audytu:
 * atak sprzed naprawy już nie działa, uczciwy przepływ (także kolejka offline) działa.
 *  1. funkcje dev_* – EXECUTE tylko z seeda lokalnego (scripts/seed-dev.ts; wariant --cloud odbiera);
 *  2. wyprawy – start ≤ 12 h wstecz i bez nakładania, seria, wczesne starty, dystans (średnia, limity), czas trwania;
 *  3. wyzwania gmin – gmina domowa / obserwowana, limit aktywnych, zaliczenie zweryfikowanym znaleziskiem, limit dobowy;
 *  4. rankingi gmin – źródła XP, zweryfikowane znaleziska, gracze poza rywalizacją, rekordy;
 *  5. prywatność – profiles, odznaki, osiągnięcia, wpisy, komentarze / reakcje (blokady w schemacie private);
 *  6. spam – nazwa / imię, zarezerwowane nicki, tytuł wpisu, limit reakcji;
 *  7. porządki – stare funkcje, scans, wyrocznia blokad, PostgREST bez schematu private;
 *  8. rywalizacja – competition_eligible (incydenty, moderator, usunięte konto), automatyczne 'review', limit Auth.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';

export default async (t) => {
  const { db, root, ok, one, as, admin, err, errFull, call, code, newUser, mkUser, startTrip, submit, iso, H, DAY, sleep, randomUUID } = t;
  const flags = async (uid, back) => {
    await admin();
    const rows = (await db.query('select kind, severity, ref_id, details, hits from anti_cheat_flags where user_id = $1 order by id', [uid])).rows;
    if (back) await as(back);
    return rows;
  };
  const flagOf = (rows, kind) => rows.find((f) => f.kind === kind);
  const param = async (k, v) => {
    await admin();
    const old = Number((await one('select v from anti_cheat_params where k = $1', [k])).v);
    await db.query('update anti_cheat_params set v = $2 where k = $1', [k, v]);
    return old;
  };
  const localDay = async (ts) => (await one(`select to_char(($1::timestamptz at time zone 'Europe/Warsaw')::date, 'YYYY-MM-DD') d`, [ts])).d;
  const today = (await one(`select to_char(local_today(), 'YYYY-MM-DD') d`)).d;
  /** Znalezisko „po identify”: submit_find (dev) + verified jak z podpisanego rozpoznania. */
  const verifiedFind = async (uid, o) => {
    await as(uid);
    await submit(o);
    await admin();
    await db.query('update finds set verified = true where id = $1', [o.id]);
    await as(uid);
  };

  // ===========================================================================
  // 1. Funkcje dev_* – EXECUTE tylko z seeda lokalnego
  // ===========================================================================
  await admin();
  const devExec = async () =>
    Object.fromEntries(
      (
        await db.query(
          `select p.proname, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) a,
                  bool_or(has_function_privilege('anon', p.oid, 'execute')) n
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname like 'dev\\_%' group by p.proname`,
        )
      ).rows.map((r) => [r.proname, r]),
    );
  const localExec = await devExec();
  const RPC = ['dev_tools_enabled', 'dev_import_state', 'dev_reset_player', 'dev_seed_social', 'dev_bots_act', 'dev_seed_activity', 'dev_refresh_rankings'];
  ok(
    RPC.every((f) => localExec[f]?.a) && !localExec.dev_ensure_bot.a && !localExec.dev_seed_voivodeship.a &&
      Object.values(localExec).every((r) => !r.n),
    'dev_*: seed lokalny nadaje EXECUTE tylko RPC strzeżonym dev_tools_enabled() (+ samej dev_tools_enabled); pomocniki i anon – bez',
    localExec,
  );
  const { devToolsSeedSql } = await tsImport('../seed-dev.ts', import.meta.url);
  const cloudSql = devToolsSeedSql(true).join('\n');
  const localSql = devToolsSeedSql(false).join('\n');
  const seedFile = readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8').replace(/\r\n/g, '\n');
  ok(
    seedFile.includes(localSql) && !cloudSql.includes('grant ') && cloudSql.includes("'dev_tools', 'false'") &&
      cloudSql.includes('revoke all on function'),
    'gen-seed: seed.sql (lokalny) zawiera nadanie EXECUTE na dev_*, wariant --cloud – flagę false i odebranie EXECUTE',
  );
  // Chmura: seed --cloud (albo same migracje) + przypadkowe dev_tools = true → i tak brak dostępu.
  await db.exec(cloudSql);
  await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
  const cloudExec = await devExec();
  const DU = await newUser('usz.dev');
  await as(DU);
  const denied = [
    await err('select dev_tools_enabled()'),
    await err('select dev_reset_player()'),
    await err(`select dev_import_state('{}')`),
    await err('select dev_seed_social()'),
    await err('select dev_seed_activity(null, 1)'),
  ];
  await admin();
  ok(
    Object.values(cloudExec).every((r) => !r.a && !r.n) && denied.every((e) => e?.message.includes('permission denied')),
    'dev_*: chmura (seed --cloud / migracje bez seeda) – żadnego EXECUTE; nawet przy dev_tools = true RPC dev → permission denied',
    denied,
  );
  await db.exec(localSql);
  await as(DU);
  ok((await call('dev_tools_enabled')) === true, 'dev_*: seed lokalny przywraca EXECUTE (dev_tools_enabled() = true)');
  await admin();

  // ===========================================================================
  // 2. Wyprawy: czas serwera, seria, wczesne starty, dystans, czas trwania
  // ===========================================================================
  // ── Cofnięty start: najwyżej 12 h, seria nie rośnie od startów „sprzed N dni” ──
  const TA = await newUser('usz.wyprawy');
  await as(TA);
  const before = Date.now();
  const tBack = await startTrip('gromadka', randomUUID(), iso(60 * DAY));
  for (const d of [5, 4, 3, 2, 1]) await startTrip('gromadka', randomUUID(), iso(d * DAY));
  const pA = await one('select streak_days, to_char(last_active_date, $2) d from profiles where id = $1', [TA, 'YYYY-MM-DD']);
  const fA = await flags(TA, TA);
  const overlap = await one(
    `select count(*) n from (select started_at, lag(ended_at) over (order by started_at, created_at) prev from trips where user_id = $1) x
      where x.prev > x.started_at`,
    [TA],
  );
  ok(
    tBack.started_at.getTime() >= before - 12 * H - 2000 && flagOf(fA, 'trip_backdated')?.severity === 1 &&
      pA.streak_days === 1 && pA.d >= (await localDay(iso(12 * H))) && Number(overlap.n) === 0,
    'start_trip: start „sprzed 60 dni” → przycięty do 12 h wstecz (flaga trip_backdated 1); seria z 6 cofniętych startów = 1; wyprawy bez nakładania',
    { started: tBack.started_at, pA, overlap },
  );

  // ── Uczciwa kolejka offline (start 5 h temu, koniec 2 h temu, 3 h w lesie) – dane jak z telefonu, bez flag ──
  await admin();
  const TH = await newUser('usz.offline');
  await as(TH);
  const hStart = iso(5 * H);
  const hEnd = iso(2 * H);
  const tH = await startTrip('gromadka', randomUUID(), hStart);
  await one('select * from report_trip_progress($1, 4000)', [tH.id]);
  const tHdone = await one('select * from finish_trip($1, 6200, 10800, null, $2)', [tH.id, hEnd]);
  // Następna wyprawa – zegar telefonu 2 min „przed” końcem poprzedniej: przycięta do końca, bez flagi (tolerancja).
  const tH2 = await startTrip('gromadka', randomUUID(), new Date(Date.parse(hEnd) - 2 * 60e3).toISOString());
  const pH = await one('select streak_days, to_char(last_active_date, $2) d from profiles where id = $1', [TH, 'YYYY-MM-DD']);
  // Seria liczy dni startów: druga wyprawa zaczyna się o hEnd – w nocy (0–5 h czasu polskiego) to już inny dzień
  // niż start pierwszej, wtedy seria = 2.
  const hDays = (await localDay(hStart)) === (await localDay(hEnd)) ? 1 : 2;
  ok(
    tH.started_at.getTime() === Date.parse(hStart) && tHdone.ended_at.getTime() === Date.parse(hEnd) && tHdone.duration_s === 10800 &&
      tHdone.distance_m === 6200 && tH2.started_at.getTime() === Date.parse(hEnd) && (await flags(TH, TH)).length === 0 &&
      pH.streak_days === hDays && pH.d === (await localDay(hEnd)),
    'uczciwa kolejka offline: start 5 h temu, 6,2 km, 3 h, koniec 2 h temu – zapisane jak w telefonie, seria wg dnia startu, zero flag',
    { tHdone, pH },
  );

  // ── Czas trwania: z telefonu najwyżej koniec − start (krótszy – np. pauzy – zostaje) ──
  const tDur = await one('select * from finish_trip($1, 1000, 999999, null, $2)', [tH2.id, iso(H)]);
  const fH = await flags(TH, TH);
  ok(
    Math.abs(tDur.duration_s - 3600) <= 2 && tDur.duration_s === Math.round((tDur.ended_at - tDur.started_at) / 1000),
    'finish_trip: czas trwania 999 999 s → przycięty do końca − startu (1 h)',
    tDur.duration_s,
  );
  ok(flagOf(fH, 'trip_duration')?.severity === 1, 'czas trwania dłuższy niż koniec − start → flaga trip_duration (1)', fH);

  // ── Ślad GPS z telefonu ignorowany ──
  const tTrack = await startTrip('gromadka', randomUUID(), iso(30 * 60e3));
  const track = JSON.stringify({ type: 'LineString', coordinates: [[15.73, 51.4], [15.74, 51.405], [15.75, 51.41]] });
  const tTrackDone = await one('select * from finish_trip($1, 1500, 1500, $2, null)', [tTrack.id, track]);
  await admin();
  const tracks = await one('select count(*) n from trip_tracks where trip_id = $1', [tTrack.id]);
  ok(
    !tTrackDone.route_public && Number(tracks.n) === 0 && flagOf(await flags(TH), 'client_track_ignored')?.severity === 1,
    'finish_trip: ślad GPS z telefonu ignorowany (bez trasy publicznej i surowego śladu), flaga client_track_ignored (1)',
  );

  // ── Dystans: średnia długiej wyprawy, twardy limit wyprawy ──
  const TD = await newUser('usz.dystans');
  await as(TD);
  const tD = await startTrip('gromadka', randomUUID(), iso(DAY));                 // „24 h temu” → przycięte do 12 h
  const tDp = await one('select * from report_trip_progress($1, 100000)', [tD.id]);
  const fD = await flags(TD, TD);
  ok(
    tDp.distance_m === 40000 && Number((await one('select total_distance_m d from profiles where id = $1', [TD])).d) === 40000 &&
      flagOf(fD, 'trip_distance_avg')?.severity === 2 && flagOf(fD, 'trip_distance_cap')?.severity === 2 &&
      flagOf(fD, 'trip_backdated')?.severity === 1,
    'dystans: start „24 h temu” + 100 km (dawniej ≤ 12 km/h bez flagi) → start przycięty do 12 h, uznane 40 km (limit wyprawy); flagi trip_distance_avg i trip_distance_cap (2)',
    { distance: tDp.distance_m, fD },
  );
  await admin();
  const TV = await newUser('usz.srednia');
  await as(TV);
  const tV = await startTrip('gromadka', randomUUID(), iso(3 * H));
  const tVp = await one('select * from report_trip_progress($1, 30000)', [tV.id]);      // 30 km / 3 h ≈ 9,7 km/h
  ok(
    tVp.distance_m >= 23400 && tVp.distance_m <= 23600 && flagOf(await flags(TV, TV), 'trip_distance_avg')?.details.capM === tVp.distance_m,
    'dystans: 30 km w 3 h (< 12 km/h – dawniej bez flagi) → średnia: najwyżej 5 km + 6 km/h ≈ 23,5 km, flaga trip_distance_avg (2)',
    tVp.distance_m,
  );
  const tVok = await one('select * from finish_trip($1, 30000, null, null, null)', [tV.id]);
  ok(tVok.distance_m >= tVp.distance_m && tVok.distance_m <= 23700, 'dystans: finish_trip nie „dogania” ponad średnią');

  // ── Dystans: twardy limit doby (próg obniżony na czas testu) ──
  await admin();
  const TDay = await newUser('usz.doba');
  if ((await localDay(iso(45 * 60e3))) !== today) {
    console.log('· (tuż po północy – sprawdzenie limitu doby pominięte)');
  } else {
    const oldDay = await param('day_max_km', 3);
    await as(TDay);
    const d1 = await startTrip('gromadka', randomUUID(), iso(40 * 60e3));
    await one('select * from finish_trip($1, 2500, null, null, $2)', [d1.id, iso(20 * 60e3)]);
    const d2 = await startTrip('gromadka', randomUUID(), iso(20 * 60e3));
    const d2p = await one('select * from report_trip_progress($1, 2000)', [d2.id]);
    const fDay = await flags(TDay);
    await param('day_max_km', oldDay);
    ok(
      d2p.distance_m === 500 && flagOf(fDay, 'day_distance_cap')?.severity === 2 && flagOf(fDay, 'day_distance_cap').ref_id === today,
      'dystans: limit doby (tu 3 km) – suma wypraw rozpoczętych tego dnia; druga wyprawa uznana tylko do limitu, flaga day_distance_cap (2)',
      { d2: d2p.distance_m, fDay },
    );
  }

  // ── Wczesne starty: tylko potwierdzone przez serwer („Ranny ptaszek”, Skowronek) ──
  await admin();
  const TE = await newUser('usz.ptaszek');
  await as(TE);
  // Start „o 5:30” wysłany później niż 30 min po nim (zmodyfikowany klient / spóźniona kolejka) – nie jest wczesnym startem.
  const early = (
    await one(
      `select case when (local_today() + time '05:30') at time zone 'Europe/Warsaw' <= now() - interval '31 minutes'
                   then (local_today() + time '05:30') at time zone 'Europe/Warsaw'
                   else ((local_today() - 1) + time '05:30') at time zone 'Europe/Warsaw' end t`,
    )
  ).t;
  await startTrip('gromadka', randomUUID(), early.toISOString());
  await admin();
  const eBadges = await one(`select count(*) n from user_badges where user_id = $1 and badge_id = 'ranny-ptaszek'`, [TE]);
  const eMetrics = (await one('select player_metrics($1) m', [TE])).m;
  // Potwierdzony przez serwer (zarejestrowany 5 min po starcie o 5:30) – liczy się; ten sam start zarejestrowany 2 h później – nie.
  const TE2 = await newUser('usz.ptaszek.b');
  await db.query(
    `insert into trips (user_id, gmina_id, status, started_at, ended_at, duration_s, created_at)
     select $1, 'gromadka', 'finished', s, s + interval '1 hour', 3600, s + $2::interval
       from (select ((local_today() - 1) + time '05:30') at time zone 'Europe/Warsaw' s) x`,
    [TE2, '2 hours'],
  );
  const late = (await one('select evaluate_badges($1) b', [TE2])).b;
  const lateMetrics = (await one('select player_metrics($1) m', [TE2])).m;
  await db.query(
    `insert into trips (user_id, gmina_id, status, started_at, ended_at, duration_s, created_at)
     select $1, 'gromadka', 'finished', s, s + interval '1 hour', 3600, s + $2::interval
       from (select ((local_today() - 2) + time '05:30') at time zone 'Europe/Warsaw' s) x`,
    [TE2, '5 minutes'],
  );
  const confirmed = (await one('select evaluate_badges($1) b', [TE2])).b;
  const confMetrics = (await one('select player_metrics($1) m', [TE2])).m;
  ok(
    Number(eBadges.n) === 0 && eMetrics.early_trips === 0 && !late.includes('ranny-ptaszek') && lateMetrics.early_trips === 0 &&
      confirmed.includes('ranny-ptaszek') && confMetrics.early_trips === 1 && confMetrics.active_days === 2,
    'wczesny start: „5:30” z telefonu wysłany później niż 30 min po nim – bez „Rannego ptaszka” i Skowronka; potwierdzony przez serwer – liczy się',
    { eMetrics: eMetrics.early_trips, late, confirmed, confMetrics: confMetrics.early_trips },
  );

  // ===========================================================================
  // 3. Wyzwania gmin
  // ===========================================================================
  await admin();
  const ZG = (
    await db.query(
      `select id from gminy g where voivodeship = 'zachodniopomorskie'
          and not exists (select 1 from gmina_challenges c where c.gmina_id = g.id) order by id limit 6`,
    )
  ).rows.map((r) => r.id);
  const C1 = await mkUser('usz.wyzwania', 'Wyzwania Test', 'Wyzwania', ZG[0]);
  await as(C1);
  const ch = [];
  for (const g of ZG.slice(0, 5)) ch.push((await call('get_gmina_stats', g)).challenge);
  const notAllowed = await errFull('select accept_challenge($1)', [ch[1].id]);
  ok(
    notAllowed?.code === 'P0001' && notAllowed.message === 'challenge_not_allowed' && /obserwujesz/.test(notAllowed.detail),
    'accept_challenge: gmina spoza domowej i obserwowanych → P0001 challenge_not_allowed (opis po polsku)',
    notAllowed,
  );
  for (const g of ZG.slice(1, 5)) await call('follow_gmina', g, true);
  await call('accept_challenge', ch[0].id);                                     // gmina domowa
  await call('accept_challenge', ch[1].id);                                     // obserwowana
  await call('accept_challenge', ch[2].id);
  const limit = await errFull('select accept_challenge($1)', [ch[3].id]);
  await call('accept_challenge', ch[0].id);                                     // idempotentne – nie liczy się do limitu
  ok(
    limit?.code === 'P0001' && limit.message === 'challenge_limit' && /najwyżej 3/.test(limit.detail),
    'accept_challenge: gmina domowa i obserwowane – tak; 4. aktywne wyzwanie → P0001 challenge_limit; ponowienie przyjętego bez błędu',
    limit,
  );
  ok(
    (await err('insert into user_challenges (challenge_id) values ($1)', [ch[3].id]))?.message.includes('permission denied'),
    'user_challenges: bezpośredni INSERT odebrany (warunki przyjęcia tylko w accept_challenge)',
  );
  // Zaliczenie.
  const rarityOf = async (sp) => (await one('select rarity from species where id = $1', [sp])).rarity;
  const TC = await startTrip(ZG[0], randomUUID(), iso(2 * H));
  const findFor = async (c, gmina, o = {}) => ({
    id: randomUUID(), tripId: TC.id, gminaId: gmina, speciesId: c.speciesId, rarity: await rarityOf(c.speciesId), confidence: 0.93,
    dims: { cap_cm: 8, height_cm: 9, weight_g: 120, age_days: 3 }, foundAt: iso(60e3), ...o,
  });
  const fUnver = await findFor(ch[0], ZG[0]);
  await submit(fUnver);
  const rUnver = await call('claim_find', fUnver.id);
  const fBefore = await findFor(ch[0], ZG[0], { foundAt: iso(H) });           // znalezione godzinę PRZED przyjęciem
  await verifiedFind(C1, fBefore);
  const rBefore = await call('claim_find', fBefore.id);
  const fOk = await findFor(ch[0], ZG[0]);
  await verifiedFind(C1, fOk);
  const rOk = await call('claim_find', fOk.id);
  ok(
    !rUnver.completedChallengeIds.includes(ch[0].id) && !rBefore.completedChallengeIds.includes(ch[0].id) &&
      rOk.completedChallengeIds.includes(ch[0].id),
    'claim_find: wyzwanie zalicza tylko znalezisko zweryfikowane, znalezione po przyjęciu (niezweryfikowane / sprzed przyjęcia – nie)',
  );
  const f2 = await findFor(ch[1], ZG[1]);
  await verifiedFind(C1, f2);
  const r2 = await call('claim_find', f2.id);
  const f3 = await findFor(ch[2], ZG[2]);
  await verifiedFind(C1, f3);
  const r3 = await call('claim_find', f3.id);
  await admin();
  const chXp = await one(`select count(*) n, coalesce(sum(amount), 0) xp from xp_events where user_id = $1 and source = 'challenge'`, [C1]);
  const left = await one('select completed_at from user_challenges where user_id = $1 and challenge_id = $2', [C1, ch[2].id]);
  ok(
    r2.completedChallengeIds.includes(ch[1].id) && !r3.completedChallengeIds.includes(ch[2].id) && Number(chXp.n) === 2 &&
      Number(chXp.xp) === ch[0].xp + ch[1].xp && left.completed_at === null,
    'claim_find: najwyżej 2 ukończenia wyzwań na dobę – trzecie czeka (przyjęte, nieukończone)',
    { chXp, r3: r3.completedChallengeIds },
  );
  // Wyzwanie tygodniowe: „najczęściej zbierany gatunek” tylko ze zweryfikowanych znalezisk.
  const fakeGmina = ZG[5];
  await db.query(
    `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, found_at, claimed_at, visible_from)
     select $1, 'borowik-szlachetny', $2, 'rzadki', 0.9, true, 'claimed', now() - interval '3 days', now() - interval '3 days', now() - interval '1 day'
       from generate_series(1, 12)`,
    [C1, fakeGmina],
  );
  await as(C1);
  const fakeCh = (await call('get_gmina_stats', fakeGmina)).challenge;
  ok(
    fakeCh.speciesId !== 'borowik-szlachetny' && /nikt jeszcze/.test(fakeCh.description),
    'ensure_weekly_challenge: 12 niezweryfikowanych borowików nie wybiera gatunku wyzwania (zostaje pospolity z puli)',
    fakeCh,
  );

  // ===========================================================================
  // 4. Rankingi gmin: źródła XP, zweryfikowane znaleziska, gracze poza rywalizacją
  // ===========================================================================
  await admin();
  const at = new Date(Date.now() - 30 * H).toISOString();
  const seasonOk = (await one(`select $1::timestamptz >= warsaw_ts(ranking_period_start('season')) ok`, [at])).ok;
  if (!seasonOk) {
    console.log('· (początek sezonu – sprawdzenia rankingu sezonu pominięte)');
  } else {
    const LG = (await db.query(`select id from gminy where voivodeship = 'lubelskie' order by id limit 3`)).rows.map((r) => r.id);
    const RA = await mkUser('usz.ranking', 'Ranking A', 'A', LG[0]);
    const RX = await mkUser('usz.ranking.x', 'Ranking X', 'X', LG[1]);
    const mkFind = async (uid, gmina, rarity, verified) =>
      (
        await one(
          `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, found_at, claimed_at, visible_from, verified)
           values ($1, 'borowik-szlachetny', $2, $3, 0.9, true, 'claimed', $4, $4, now() - interval '1 hour', $5) returning id`,
          [uid, gmina, rarity, at, verified],
        )
      ).id;
    const xp = (uid, gmina, source, amount, ref) =>
      db.query(`insert into xp_events (user_id, source, ref_id, gmina_id, amount, created_at) values ($1, $2, $3, $4, $5, $6)`, [
        uid, source, ref ?? 'test', gmina, amount, at,
      ]);
    await xp(RA, LG[0], 'find', 100, await mkFind(RA, LG[0], 'rzadki', true));
    await xp(RA, LG[0], 'find', 1000, await mkFind(RA, LG[0], 'rzadki', false));
    for (const [src, n] of [['achievement', 500], ['quest', 400], ['import', 300], ['admin', 200], ['challenge', 50], ['contest', 30], ['duel', 20]]) {
      await xp(RA, LG[0], src, n);
    }
    // Rekordy: zweryfikowany epicki liczy się, niezweryfikowany – nie.
    await mkFind(RA, LG[2], 'epicki', true);
    await mkFind(RA, LG[2], 'legendarny', false);
    // Gracz poza rywalizacją (3 incydenty wagi 3): XP i rekordy poza rankingiem.
    for (const ref of ['a', 'b', 'c']) await db.query(`insert into anti_cheat_flags (user_id, kind, severity, ref_id) values ($1, 'test_cheat', 3, $2)`, [RX, ref]);
    await xp(RX, LG[1], 'challenge', 999);
    await mkFind(RX, LG[1], 'epicki', true);
    await db.exec('select refresh_gmina_rankings()');
    const rows = Object.fromEntries(
      (await db.query(`select period::text || ':' || gmina_id k, points from gmina_rankings where gmina_id = any($1) and period in ('season', 'records')`, [LG])).rows.map(
        (r) => [r.k, Number(r.points)],
      ),
    );
    ok(
      rows[`season:${LG[0]}`] === 200 && !(`season:${LG[1]}` in rows) && rows[`records:${LG[2]}`] === 1 && !(`records:${LG[1]}` in rows),
      'ranking gmin: tylko find (zweryfikowane) + challenge + contest + duel (bez osiągnięć, zadań, importu, admina); gracz poza rywalizacją pominięty; rekordy – zweryfikowane',
      rows,
    );
    await as(RA);
    const contrib = (await call('get_ranking', 'season', 'lubelskie')).userContribution;
    ok(contrib === 200, 'get_ranking: userContribution – te same źródła co ranking (200 zamiast 2600)', contrib);
    ok((await err('select * from ranking_xp_events(now() - interval $$1 day$$, now())'))?.message.includes('permission denied'), 'ranking_xp_events: wewnętrzna');
  }

  // ===========================================================================
  // 5. Prywatność
  // ===========================================================================
  await admin();
  const PA = await mkUser('usz.prywatny.a', 'Prywatny A', 'A', 'suprasl');
  const PB = await mkUser('usz.prywatny.b', 'Prywatny B', 'B', 'michalowo');
  await db.query(`insert into user_badges (user_id, badge_id) values ($1, 'km-100'), ($2, 'km-100')`, [PA, PB]);
  await db.query(`insert into user_achievements (user_id, achievement_id, tier) values ($1, 'kolekcjoner', 1), ($2, 'kolekcjoner', 1)`, [PA, PB]);
  const postOf = async (uid) =>
    (
      await one(
        `insert into posts (author_id, kind, gmina_id, payload, visible_from) values ($1, 'levelup', 'suprasl', '{"level": 5}', now() - interval '1 hour') returning id`,
        [uid],
      )
    ).id;
  const postA = await postOf(PA);
  const postB = await postOf(PB);
  await as(PB);
  await call('add_comment', postA, 'Komentarz B');
  await call('toggle_reaction', postA);
  await as(PA);
  const visible = {
    profiles: (await db.query('select id from profiles')).rows.map((r) => r.id),
    me: await one('select handle, level, total_xp from profiles where id = $1', [PA]),
    badgesB: (await db.query('select * from user_badges where user_id = $1', [PB])).rows.length,
    achB: (await db.query('select * from user_achievements where user_id = $1', [PB])).rows.length,
    ownBadges: (await db.query('select * from user_badges')).rows.length,
    postsB: (await db.query('select * from posts where author_id = $1', [PB])).rows.length,
    ownPosts: (await db.query('select * from posts')).rows.length,
    postBRpc: (await call('get_post', postB))?.id,
    comments: (await db.query('select * from post_comments where post_id = $1', [postA])).rows.length,
    reactions: (await db.query('select * from post_reactions where post_id = $1', [postA])).rows.length,
  };
  ok(
    JSON.stringify(visible.profiles) === JSON.stringify([PA]) && visible.me?.handle === 'usz.prywatny.a' && visible.me.total_xp !== undefined &&
      visible.badgesB === 0 && visible.achB === 0 && visible.ownBadges === 1 && visible.postsB === 0 && visible.ownPosts === 1 &&
      visible.postBRpc === postB && visible.comments === 1 && visible.reactions === 1,
    'RLS: wprost z tabel tylko własny profil (z total_xp – panel /dev), własne odznaki / osiągnięcia / wpisy; cudze przez RPC; komentarze i reakcje pod własnym wpisem',
    visible,
  );
  await db.query(`update profiles set display_name = 'Prywatny A2' where id = $1`, [PA]);
  ok((await one('select display_name from profiles where id = $1', [PA])).display_name === 'Prywatny A2', 'profiles: UPDATE własnego wiersza (aplikacja: sync profilu) działa');
  await call('block_user', PB);
  const afterBlock = {
    comments: (await db.query('select * from post_comments where post_id = $1', [postA])).rows.length,
    reactions: (await db.query('select * from post_reactions where post_id = $1', [postA])).rows.length,
    oracle: await err('select blocked_with_me($1)', [PB]),
  };
  await admin();
  const privacyAcl = await one(
    `select has_function_privilege('authenticated', 'public.blocked_with_me(uuid)', 'execute') pub,
            has_function_privilege('authenticated', 'private.blocked_with_me(uuid)', 'execute') priv,
            has_schema_privilege('anon', 'private', 'usage') anon_usage`,
  );
  const exposed = /^\s*schemas\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8'))?.[1] ?? '';
  ok(
    afterBlock.comments === 0 && afterBlock.reactions === 0 && afterBlock.oracle?.message.includes('permission denied') &&
      !privacyAcl.pub && privacyAcl.priv && !privacyAcl.anon_usage && exposed.includes('public') && !exposed.includes('private'),
    'blokady w RLS przez private.blocked_with_me (schemat poza PostgREST); public.blocked_with_me – bez EXECUTE (brak wyroczni blokad)',
    { afterBlock, privacyAcl, exposed },
  );

  // ===========================================================================
  // 6. Spam: nazwa, imię, nicki, tytuł wpisu, reakcje
  // ===========================================================================
  await as(PA);
  await db.query('update profiles set display_name = $2, first_name = $3 where id = $1', [PA, `  Jan\n\tKowalski   ${'x'.repeat(100)}`, '   ']);
  const nm = await one('select display_name, first_name from profiles where id = $1', [PA]);
  const reserved = [];
  for (const h of ['admin', 'admin_2', 'moderator.pl', 'grzybobranie', 'support.team', 'oficjalny']) {
    reserved.push((await err('update profiles set handle = $2 where id = $1', [PA, h]))?.code);
  }
  await db.query(`update profiles set handle = 'badminton.fan' where id = $1`, [PA]);
  ok(
    nm.display_name.length === 40 && nm.display_name.startsWith('Jan Kowalski x') && nm.first_name === null &&
      reserved.every((c) => c === '23505') && (await one('select handle from profiles where id = $1', [PA])).handle === 'badminton.fan',
    'profil: nazwa bez znaków sterujących i ≤ 40 znaków, puste imię → null; nicki zarezerwowane → 23505 (aplikacja: „nick zajęty”), zwykłe przechodzą',
    { nm, reserved },
  );
  await admin();
  const support = await newUser('support');
  ok(/^grzybiarz_[0-9a-f]{8}$/.test((await one('select handle from profiles where id = $1', [support])).handle), 'nowe konto z zarezerwowanym nickiem → nick zastępczy grzybiarz_…');
  // Tytuł wpisu.
  await as(PA);
  const tP = await startTrip('suprasl', randomUUID(), iso(H));
  await one('select * from finish_trip($1, 1000, 1800, null, null)', [tP.id]);
  const pub = await one('select * from publish_trip($1, false, $2)', [tP.id, `Tytuł\nz nową linią ${'ą'.repeat(300)}`]);
  ok(
    pub.payload.title.length === 80 && !pub.payload.title.includes('\n') && pub.route_precision === 'gmina' && pub.payload.route === null,
    'publish_trip: tytuł bez znaków sterujących, najwyżej 80 znaków; bez trasy (ślad z telefonu niezweryfikowany)',
    pub.payload.title.length,
  );
  // Reakcje: limit (próg obniżony na czas testu), także „włącz → wyłącz → włącz”.
  await admin();
  const RR = await newUser('usz.reakcje');
  const rPosts = [];
  for (let i = 0; i < 3; i++) rPosts.push(await postOf(PB));
  const oldR = await param('reaction_per_10min', 4);
  await as(RR);
  await call('toggle_reaction', rPosts[0]);
  await call('toggle_reaction', rPosts[0]);                                       // cofnięcie – się nie liczy
  await call('toggle_reaction', rPosts[0]);
  await call('toggle_reaction', rPosts[1]);
  await call('toggle_reaction', rPosts[1]);
  await call('toggle_reaction', rPosts[1]);                                       // 4. włączenie – ostatnie przyjęte
  const rl = await errFull('select toggle_reaction($1)', [rPosts[2]]);
  const directReact = await err('insert into post_reactions (post_id) values ($1)', [rPosts[2]]);
  await param('reaction_per_10min', oldR);
  ok(
    rl?.code === 'P0001' && rl.message === 'rate_limited' && /retry_after=/.test(rl.hint ?? '') && /Darz grzyb/.test(rl.detail) &&
      flagOf(await flags(RR), 'rate_limited')?.ref_id === 'toggle_reaction' && directReact?.message.includes('permission denied'),
    'toggle_reaction: limit włączeń (także przełączanie tam i z powrotem) → P0001 rate_limited z retry_after; bezpośredni INSERT reakcji odebrany',
    rl,
  );

  // ===========================================================================
  // 7. Porządki
  // ===========================================================================
  await admin();
  const gone = await one(
    `select to_regprocedure('public.species_percentile(text,text,int)') a, to_regprocedure('public.gmina_stats(text)') b,
            to_regprocedure('public.gmina_records(text,int)') c, to_regprocedure('public.gmina_species_share(text,int)') d`,
  );
  ok(Object.values(gone).every((v) => v === null), 'stare funkcje statystyk z init usunięte (species_percentile, gmina_stats, gmina_records, gmina_species_share)');
  await as(PA);
  const scans = [
    await err(`insert into scans (user_id, parts) values ($1, '{cap}')`, [PA]),
    await err(`update scans set parts = '{cap}' where user_id = $1`, [PA]),
  ];
  ok(scans.every((e) => e?.message.includes('permission denied')), 'scans: klient bez bezpośredniego INSERT / UPDATE (zapisuje tylko serwer)', scans);

  // ===========================================================================
  // 8. Status w rywalizacji
  // ===========================================================================
  await admin();
  const elig = async (u) => (await one('select competition_eligible($1) e', [u])).e;
  const standing = async (u) => one('select status, updated_by, until, reason from player_standing where user_id = $1', [u]);
  const E1 = await newUser('usz.status.a');
  const E2 = await newUser('usz.status.b');
  const E3 = await newUser('usz.status.c');
  const e1Before = await elig(E1);
  for (const ref of ['t1', 't2']) await db.query(`select flag($1, 'trip_speed_absurd', 3, $2)`, [E1, ref]);
  const e1Two = { e: await elig(E1), s: await standing(E1) };
  await db.query(`select flag($1, 'trip_speed_absurd', 3, 't3')`, [E1]);
  const e1Three = { e: await elig(E1), s: await standing(E1) };
  for (let i = 0; i < 5; i++) await db.query(`select flag($1, 'trip_speed_absurd', 3, 'jedna')`, [E2]);   // jeden incydent, hits 5
  for (const ref of ['submit_find', 'start_trip', 'add_comment']) await db.query(`select flag($1, 'rate_limited', 3, $2)`, [E3, ref]);
  ok(
    e1Before && e1Two.e && !e1Two.s && !e1Three.e && e1Three.s?.status === 'review' && e1Three.s.updated_by === 'auto:trip_speed_absurd' &&
      Math.abs(e1Three.s.until - (Date.now() + 30 * DAY)) < 60e3 && (await elig(E2)) && !(await standing(E2)) && (await elig(E3)),
    'flag(): 3. incydent wagi 3 w 30 dni → poza rywalizacją i player_standing „review” (auto, do +30 dni); powtórzenia jednej flagi i sam limit – nie',
    { e1Three, e2: await elig(E2) },
  );
  // Moderator: „ok” – stare incydenty przestają się liczyć; ręczny ban nie jest nadpisywany przez automat.
  await db.query(`update player_standing set status = 'ok', updated_by = 'moderator', updated_at = now(), until = null where user_id = $1`, [E1]);
  await sleep(5);
  await db.query(`select flag($1, 'trip_speed_absurd', 3, 't4')`, [E1]);
  const e1Ok = { e: await elig(E1), s: await standing(E1) };
  await db.query(`insert into player_standing (user_id, status, reason, updated_by) values ($1, 'banned', 'Ręcznie', 'moderator')`, [E2]);
  for (const ref of ['x1', 'x2', 'x3']) await db.query(`select flag($1, 'trip_speed_absurd', 3, $2)`, [E2, ref]);
  const e2Ban = await standing(E2);
  await db.query(`update profiles set deleted_at = now() where id = $1`, [E3]);
  ok(
    e1Ok.e && e1Ok.s.status === 'ok' && e2Ban.status === 'banned' && e2Ban.updated_by === 'moderator' && !(await elig(E2)) && !(await elig(E3)),
    'competition_eligible: po „ok” moderatora liczą się tylko nowe incydenty; ban moderatora zostaje; konto w usuwaniu – poza rywalizacją',
    { e1Ok, e2Ban },
  );
  // Limit anonimowych logowań (Supabase Auth, config.toml – lokalnie; w chmurze Dashboard → Auth → Rate Limits).
  const anonLimit = Number(/^\s*anonymous_users\s*=\s*(\d+)/m.exec(readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8'))?.[1]);
  ok(anonLimit > 0 && anonLimit <= 10, `config.toml: anonimowe logowania ≤ 10 / h z IP (jest ${anonLimit})`);
  await admin();
};
