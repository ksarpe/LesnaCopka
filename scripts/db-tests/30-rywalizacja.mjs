/**
 * Rywalizacja (supabase/migrations/20261015110000_rywalizacja.sql, docs/rywalizacja.md §2–§5, §7):
 * gatunki tygodnia (zgodność z algorytmem specyfikacji i z src/utils/contests.ts), warunki okazu, zgłaszanie /
 * zastępowanie / wycofanie, prywatność tablic, zgłoszenia społeczności i moderacja, polityka Storage, rozstrzygnięcie
 * z nagrodami i trofea, pojedynki (cały cykl, limity, farmy), ranking grzybiarzy, aktywność, uprawnienia, kształty
 * odpowiedzi (klucze jak w typach TS), narzędzia deweloperskie, czyszczenie i eksport.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';

export default async (t) => {
  const { db, app, ok, one, as, admin, call, errFull, mkUser, randomUUID, H, DAY, ISO_RE } = t;
  const keys = (o) => Object.keys(o ?? {}).sort().join(',');
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const rpcErr = (fn, ...args) => errFull(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args);
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
  const AUTHOR_KEYS = 'avatarPath,avatarPreset,handle,id,level,name,ringRarity';
  const CONTEST_KEYS = 'endsAt,entrants,id,kind,resultsAt,speciesId,startsAt,status,title';
  const ENTRY_KEYS =
    'author,capCm,contestId,findId,foundAt,gminaId,id,isMine,photoPath,rank,relativePct,score,speciesId,status,visibleFrom';
  const BOARD_KEYS = 'contest,entries,mine,scope,scopeId,scopeName,total';
  const ELIG_KEYS = 'contests,eligible,findId,prizeEligible,reason';
  const MATCH_KEYS = 'contest,currentBest,entered,projectedRank,score';
  const WEEK_KEYS = 'contests,leaders,mine,previousWeekStart,weekStart';
  const TROPHY_KEYS = 'awardedAt,capCm,contestId,contestTitle,id,place,scope,scopeName,speciesId,xp';
  const DUEL_KEYS = 'createdAt,days,endsAt,expiresAt,finishedAt,iAmChallenger,id,kind,me,opponent,outcome,startsAt,status,xp';
  const RANKING_KEYS = 'hidden,live,me,pendingXp,period,rows,scope,scopeId,scopeName,total';
  const ACTIVITY_KEYS = 'actor,createdAt,id,kind,meta,postId,refId,text';
  const addDaysYmd = (ymd, n) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const befriend = (a, b) =>
    db.query(`insert into friendships (user_id, friend_id, status) values ($1, $2, 'accepted') on conflict do nothing`, [a, b]);
  const putObject = (name) => db.query(`insert into storage.objects (bucket_id, name, owner) values ('scan-photos', $1, $2)`, [
    name, name.split('/')[0],
  ]);
  const canRead = async (uid, name) => {
    await as(uid);
    const n = Number((await one(`select count(*) n from storage.objects where bucket_id = 'scan-photos' and name = $1`, [name])).n);
    return n === 1;
  };

  await admin();
  const typ = Object.fromEntries(
    (await rows('select id, typical_cap_cm::float8 as c, clustered, protection from species')).map((r) => [r.id, r]),
  );
  const capOf = (sp, factor) => Math.round(typ[sp].c * factor * 10) / 10;
  const relOf = (sp, cap) => Math.round((cap * 1000) / typ[sp].c) / 10;

  // ───────────────────────── Gatunki tygodnia: SQL = algorytm ze specyfikacji (§2) ─────────────────────────
  // Stała lista kandydatów ze specyfikacji (kolejność rozstrzyga remisy); tylko gatunki z katalogu.
  const CANDIDATES = [
    'borowik-szlachetny', 'podgrzybek-brunatny', 'czubajka-kania', 'kozlarz-babka', 'kozlarz-czerwony', 'maslak-zwyczajny',
    'mleczaj-rydz', 'borowik-ceglastopory', 'kozlarz-pomaranczowozolty', 'borowik-usiatkowany', 'borowik-sosnowy',
    'czubajka-czerwieniejaca', 'purchawica-olbrzymia', 'sarniak-dachowkowaty', 'gaska-nieksztaltna', 'gasowka-fioletowawa',
    'zagiew-luskowata', 'pieczarka-polna', 'maslak-zolty', 'kozlarz-grabowy',
  ];
  const jsWeekSpecies = (weekStart) => {
    const month = Number(addDaysYmd(weekStart, 3).slice(5, 7));
    const byId = new Map(app.SPECIES.map((s) => [s.id, s]));
    const ranked = CANDIDATES.flatMap((id, i) => (byId.has(id) ? [{ id, i, w: byId.get(id).seasonWeights?.[month - 1] ?? 0 }] : []))
      .sort((a, b) => b.w - a.w || a.i - b.i);
    // Klasyki w sezonie (pierwsze 8 kandydatów, waga ≥ 0,5) – gdy co najmniej 4, pula tylko z nich; inaczej pierwsze 6.
    const classics = ranked.filter((x) => x.i < 8 && x.w >= 0.5);
    const pool = (classics.length >= 4 ? classics : ranked.slice(0, 6)).map((x) => x.id);
    const n = pool.length;
    if (n === 0) return [];
    const h = app.questHash(`${weekStart}:okaz`);
    const a = h % n;
    if (n === 1) return [pool[a]];
    return [pool[a], pool[(a + 1 + (Math.floor(h / n) % (n - 1))) % n]];
  };
  const mondayNear = (y, m, day) => {
    const d = new Date(Date.UTC(y, m, day));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const weeks = [];
  for (let m = 0; m < 15; m++) weeks.push(mondayNear(2026, m, 3 + ((m * 7) % 25)));
  weeks.push('2026-03-30', '2026-06-29', '2026-08-31', '2026-10-05', '2026-12-28');
  const sqlSpecies = {};
  for (const w of weeks) sqlSpecies[w] = (await one('select contest_week_species($1::date) s', [w])).s;
  const mism = weeks.filter((w) => JSON.stringify(sqlSpecies[w]) !== JSON.stringify(jsWeekSpecies(w)));
  ok(
    mism.length === 0 && weeks.every((w) => sqlSpecies[w].length === 2 && sqlSpecies[w][0] !== sqlSpecies[w][1]),
    `gatunki tygodnia: contest_week_species (SQL) = algorytm z docs/rywalizacja.md §2 (lista kandydatów, sezon) (${weeks.length} tygodni, wszystkie miesiące)`,
    mism.map((w) => ({ w, sql: sqlSpecies[w], js: jsWeekSpecies(w) })),
  );
  ok(new Set(weeks.map((w) => sqlSpecies[w].join())).size >= 10, 'gatunki tygodnia zmieniają się z tygodniem i sezonem');
  const control = {
    '2026-10-05': 'maslak-zwyczajny,czubajka-kania',
    '2026-07-06': 'kozlarz-czerwony,maslak-zwyczajny',
    '2026-01-05': 'kozlarz-babka,borowik-szlachetny',
    '2026-04-27': 'zagiew-luskowata,czubajka-kania',
  };
  const ctl = {};
  for (const w of Object.keys(control)) ctl[w] = (await one('select contest_week_species($1::date) s', [w])).s.join();
  ok(Object.entries(control).every(([w, exp]) => ctl[w] === exp), 'gatunki tygodnia: wartości kontrolne z docs/rywalizacja.md', ctl);
  ok(
    weeks.every((w) => sqlSpecies[w].every((sp) => CANDIDATES.includes(sp))) &&
      sqlSpecies['2026-10-05'].every((sp) => typ[sp] && !typ[sp].clustered && !typ[sp].protection),
    'gatunki tygodnia: zawsze z listy popularnych gatunków (§2)',
    sqlSpecies['2026-10-05'],
  );
  if (existsSync(path.join(t.root, 'src', 'utils', 'contests.ts'))) {
    const mod = await tsImport('../../src/utils/contests.ts', import.meta.url);
    if (typeof mod.contestSpeciesForWeek === 'function') {
      const norm = (r) => (r ?? []).map((x) => (typeof x === 'string' ? x : x.id));
      const bad = [];
      for (const w of weeks) {
        let got;
        try {
          got = norm(mod.contestSpeciesForWeek(w, app.SPECIES));
        } catch (e) {
          got = `błąd: ${e.message}`;
        }
        if (JSON.stringify(got) !== JSON.stringify(sqlSpecies[w])) bad.push({ w, app: got, sql: sqlSpecies[w] });
      }
      ok(bad.length === 0, 'gatunki tygodnia: src/utils/contests.ts (contestSpeciesForWeek) = SQL', bad);
    } else {
      console.log('· src/utils/contests.ts bez contestSpeciesForWeek – porównanie z aplikacją pominięte');
    }
  } else {
    console.log('· brak src/utils/contests.ts – porównanie z aplikacją pominięte');
  }

  // ───────────────────────── Tydzień walk, gracze ─────────────────────────
  const wk = await one(`select week_start(local_today())::text as w, warsaw_ts(week_start(local_today())) as ts`);
  const WEEK = wk.w;
  const weekTs = new Date(wk.ts).getTime();
  /** Chwila w bieżącym tygodniu (ułamek czasu od poniedziałku do teraz − 2 min). */
  const inWeek = (frac) => new Date(weekTs + Math.max(1000, (Date.now() - 120e3 - weekTs) * frac)).toISOString();
  const thisWeek = sqlSpecies[WEEK] ?? (await one('select contest_week_species($1::date) s', [WEEK])).s;
  const OTHER = ['borowik-szlachetny', 'podgrzybek-brunatny', 'czubajka-kania', 'maslak-zwyczajny'].find(
    (s) => !thisWeek.includes(s) && typ[s] && !typ[s].clustered && !typ[s].protection,
  );

  const K = await mkUser('rv.kasper', 'Kasper R', 'Kasper', 'suprasl');
  const L = await mkUser('rv.lena', 'Lena R', 'Lena', 'suprasl');
  const M = await mkUser('rv.marta', 'Marta R', 'Marta', 'michalowo');
  const N = await mkUser('rv.norbert', 'Norbert R', 'Norbert', 'suprasl');
  const O = await mkUser('rv.olga', 'Olga R', 'Olga', 'suprasl');
  const P = await mkUser('rv.piotr', 'Piotr R', 'Piotr', 'suprasl');
  const Q = await mkUser('rv.quba', 'Quba R', null, null);
  const S = await mkUser('rv.szymon', 'Szymon R', 'Szymon', 'suprasl');
  const REP = [];
  for (let i = 1; i <= 6; i++) REP.push(await mkUser(`rv.rep${i}`, `Rep ${i}`, null, 'krakow'));
  await befriend(K, M);
  await befriend(L, O);
  await db.query('insert into user_blocks (blocker_id, blocked_id) values ($1, $2)', [N, K]);
  await db.query('update profiles set show_in_rankings = false where id = $1', [O]);
  await db.query(`insert into player_standing (user_id, status, reason) values ($1, 'review', 'test')`, [P]);
  await db.query('update auth.users set is_anonymous = true where id = $1', [REP[2]]);
  // Zgłaszający liczą się do progu z kontem starszym niż contest_report_min_account_days (7 dni).
  await db.query(`update profiles set created_at = now() - interval '30 days' where id = any($1)`, [REP]);

  const sha = () => (randomUUID() + randomUUID()).replace(/-/g, '');
  /**
   * Znalezisko (jako admin): domyślnie odebrane, verified + size_verified, w tym tygodniu, widoczne od minuty,
   * z rozpoznaniem serwera, które wyznaczyło gminę (serverGmina: false – gmina tylko z telefonu, rozpoznanie bez gminy).
   */
  const mkFind = async (uid, o = {}) => {
    await admin();
    const sp = o.species ?? OTHER;
    const status = o.status ?? 'claimed';
    const foundAt = o.foundAt ?? inWeek(0.5);
    const verified = o.verified ?? true;
    const gmina = o.gmina ?? 'suprasl';
    const rec = verified
      ? (await one(
          `insert into recognitions (user_id, status, image_sha256, gmina_id, species_id, expires_at)
           values ($1, 'consumed', array[$2], $3, $4, now() + interval '1 day') returning id`,
          [uid, sha(), o.serverGmina === false ? null : gmina, sp],
        )).id
      : null;
    const r = await one(
      `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, weight_g, pieces,
                          verified, size_verified, found_at, created_at, claimed_at, visible_from, photo_path, recognition_id)
       values ($1, $2, $3, (select s.rarity from species s where s.id = $2), 0.95, $4, $5, $6, 300, $7, $8, $9, $10,
               coalesce($11, now()), $12, $13, $14, $15)
       returning id`,
      [
        uid, sp, gmina, o.collected ?? true, status, o.cap ?? capOf(sp, o.factor ?? 1.2), o.pieces ?? null,
        verified, o.sizeVerified ?? verified, foundAt, o.createdAt ?? null, status === 'claimed' ? foundAt : null,
        o.visibleFrom === undefined ? isoAgo(60e3) : o.visibleFrom, o.photo ? `${uid}/${o.photo}.jpg` : null, rec,
      ],
    );
    return r.id;
  };
  /** Okazy wpisane „wstecz” (testy rozstrzygnięcia): publiczne od znalezienia. */
  const backdateEntries = (weekStart) =>
    db.query(
      `update contest_entries e set created_at = e.found_at, shown_since = case when e.shown_since is not null then e.found_at end
        where e.contest_id in (select c.id from contests c where c.week_start = $1::date)`,
      [weekStart],
    );
  const entryOf = async (uid, contestId, status = null) => {
    await admin();
    return one(
      `select * from contest_entries where user_id = $1 and contest_id = $2 and ($3::text is null or status = $3)
        order by created_at desc limit 1`,
      [uid, contestId, status],
    );
  };

  // ───────────────────────── Walki tygodnia ─────────────────────────
  await as(K);
  const week = await call('get_contest_week');
  const [cOkaz, cA, cB] = week.contests;
  ok(
    keys(week) === WEEK_KEYS && week.weekStart === WEEK && week.contests.length === 3 && keys(cOkaz) === CONTEST_KEYS &&
      JSON.stringify(week.mine) === '{}' && keys(week.leaders) === [cOkaz.id, cA.id, cB.id].sort().join(','),
    'get_contest_week: kształt ContestWeek (3 walki, mine / leaders po id walki)',
    week,
  );
  ok(
    cOkaz.id === `${WEEK}:okaz` && cOkaz.kind === 'relative' && cOkaz.speciesId === null && cOkaz.title === 'Okaz tygodnia' &&
      cA.kind === 'species' && cA.speciesId === thisWeek[0] && cA.id === `${WEEK}:${thisWeek[0]}` && cB.speciesId === thisWeek[1] &&
      /^Największ[ay] /.test(cA.title) && week.contests.every((c) => c.status === 'open' && c.entrants === 0),
    'get_contest_week: „Okaz tygodnia” + dwa gatunki tygodnia (id {pon}:{gatunek}), status open',
    week.contests,
  );
  ok(
    cOkaz.startsAt === new Date(weekTs).toISOString() &&
      Math.abs(Date.parse(cOkaz.endsAt) - weekTs - 7 * DAY) <= H &&
      Date.parse(cOkaz.resultsAt) - Date.parse(cOkaz.endsAt) === 48 * H && ISO_RE.test(cOkaz.endsAt),
    'get_contest_week: pon 00:00 → nast. pon 00:00 (Europe/Warsaw), wyniki 48 h po końcu',
  );
  const again = await call('get_contest_week', WEEK);
  await admin();
  ok(
    again.contests.map((c) => c.id).join() === week.contests.map((c) => c.id).join() &&
      Number((await one('select count(*) n from contests where week_start = $1::date', [WEEK])).n) === 3,
    'ensure_contest_week: walki tworzone leniwie i raz',
  );
  await as(K);
  ok((await rpcErr('get_contest_week', addDaysYmd(WEEK, 7)))?.message === 'invalid_week', 'get_contest_week: przyszły tydzień → P0001 invalid_week');
  const spA = cA.speciesId;

  // ───────────────────────── Warunki okazu ─────────────────────────
  const clusteredSp = (await one(`select id from species where clustered and protection is null order by atlas_no limit 1`)).id;
  const protectedSp = (await one(`select id from species where protection is not null and not clustered order by atlas_no limit 1`)).id;
  const fPending = await mkFind(K, { status: 'pending' });
  const fCluster = await mkFind(K, { species: clusteredSp });
  const fProt = await mkFind(K, { species: protectedSp, collected: false });
  const fPieces = await mkFind(K, { pieces: 3 });
  const fUnver = await mkFind(K, { verified: false });
  const fNoSize = await mkFind(K, { sizeVerified: false, photo: 'nosize' });
  const fHuge = await mkFind(K, { factor: 2.6 });
  const fOld = await mkFind(K, { foundAt: isoAgo(15 * DAY), createdAt: isoAgo(15 * DAY) });
  const fA1 = await mkFind(K, { species: spA, factor: 1.3, photo: 'a1', foundAt: inWeek(0.3) });
  const fP = await mkFind(P, { species: spA, factor: 1.45, photo: 'p1' });
  const fL = await mkFind(L, { species: spA, factor: 1.2, photo: 'l1', foundAt: inWeek(0.5) });
  await as(K);
  const reasons = {};
  for (const [name, id] of Object.entries({ fPending, fCluster, fProt, fPieces, fUnver, fNoSize, fHuge, fOld })) {
    const r = await call('get_contest_eligibility', id);
    reasons[name] = r;
  }
  const noAll = Object.values(reasons).every((r) => r.eligible === false && r.contests.length === 0 && typeof r.reason === 'string' && keys(r) === ELIG_KEYS);
  ok(
    noAll &&
      reasons.fPending.reason.includes('odbierz') && reasons.fCluster.reason.includes('kępkach') &&
      reasons.fProt.reason.includes('chronione') && reasons.fPieces.reason.includes('pojedynczy') &&
      reasons.fUnver.reason.includes('rozpoznane przez serwer') && reasons.fNoSize.reason.includes('dłoń') &&
      reasons.fHuge.reason.includes('nieprawdopodobnie') && reasons.fOld.reason.includes('zamknięte'),
    'get_contest_eligibility: powód po polsku dla każdego warunku (odbiór, kępka, ochrona, sztuki, weryfikacja, skala, rozmiar, tydzień)',
    Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, v.reason])),
  );
  await admin();
  const hugeFlag = await one(`select severity, details from anti_cheat_flags where user_id = $1 and kind = 'contest_size' and ref_id = $2`, [K, fHuge]);
  ok(hugeFlag?.severity === 2 && Number(hugeFlag.details.factor) === 2.5, 'kapelusz > 2,5 × typowy → flaga 2 contest_size (do przeglądu)', hugeFlag);
  await as(P);
  const pElig = await call('get_contest_eligibility', fP);
  ok(pElig.eligible === false && pElig.reason.includes('weryfikacji'), 'gracz poza rywalizacją (player_standing review) → okaz nie walczy', pElig);
  await as(K);
  ok((await rpcErr('get_contest_eligibility', fL))?.message === 'find_not_found', 'cudze znalezisko → P0002 find_not_found');
  const e0 = await call('get_contest_eligibility', fA1);
  const capA1 = capOf(spA, 1.3);
  ok(
    e0.eligible && e0.reason === null && e0.prizeEligible === true && e0.findId === fA1 &&
      e0.contests.map((m) => m.contest.id).join() === [cOkaz.id, cA.id].join() &&
      e0.contests.every((m) => keys(m) === MATCH_KEYS && m.entered === false && m.currentBest === null &&
        keys(m.projectedRank) === 'gmina,polska,wojewodztwo' && m.projectedRank.polska === 1 && keys(m.contest) === CONTEST_KEYS) &&
      e0.contests[0].score === relOf(spA, capA1) && e0.contests[1].score === capA1,
    'get_contest_eligibility: okaz gatunku tygodnia walczy w „Okazie tygodnia” (%) i w swojej walce (cm), miejsce 1',
    e0,
  );

  // ───────────────────────── Zgłoszenie, zastąpienie, wycofanie ─────────────────────────
  const notElig = await rpcErr('enter_contest', fNoSize);
  ok(notElig?.code === 'P0001' && notElig.message === 'not_eligible' && notElig.detail.includes('dłoń'), 'enter_contest: nie spełnia warunków → P0001 not_eligible (detail – powód)', notElig);
  ok((await rpcErr('enter_contest', fOld))?.message === 'contest_closed', 'enter_contest: tydzień minął → P0001 contest_closed');
  const ent1 = await call('enter_contest', fA1);
  ok(ent1.eligible && ent1.contests.length === 2 && ent1.contests.every((m) => m.entered && m.currentBest === null), 'enter_contest: zgłoszony do obu pasujących walk', ent1);
  await call('enter_contest', fA1);
  await admin();
  const kEntries = async () =>
    rows(`select contest_id, find_id, status from contest_entries where user_id = $1 order by contest_id, created_at`, [K]);
  ok((await kEntries()).filter((e) => e.status === 'active').length === 2 && (await kEntries()).length === 2, 'enter_contest: ponowienie nie dubluje zgłoszeń');
  const fO2 = await mkFind(K, { factor: 1.6, photo: 'o2' });
  await as(K);
  const ent2 = await call('enter_contest', fO2);
  await admin();
  let ke = await kEntries();
  ok(
    ent2.contests.length === 1 && ent2.contests[0].contest.id === cOkaz.id &&
      ke.some((e) => e.contest_id === cOkaz.id && e.find_id === fO2 && e.status === 'active') &&
      ke.some((e) => e.contest_id === cOkaz.id && e.find_id === fA1 && e.status === 'withdrawn') &&
      ke.some((e) => e.contest_id === cA.id && e.find_id === fA1 && e.status === 'active'),
    'enter_contest: nowy okaz zastępuje poprzedni gracza w tej walce (stary – withdrawn), inne walki bez zmian',
    ke,
  );
  await as(K);
  const e1 = await call('get_contest_eligibility', fA1);
  ok(
    e1.contests[0].entered === false && e1.contests[0].currentBest === relOf(OTHER, capOf(OTHER, 1.6)) && e1.contests[1].entered === true,
    'get_contest_eligibility: currentBest – wynik innego zgłoszonego okazu gracza',
    e1.contests,
  );
  await call('withdraw_contest_entry', cA.id);
  await call('withdraw_contest_entry', cA.id);
  await admin();
  ke = await kEntries();
  ok(!ke.some((e) => e.contest_id === cA.id && e.status === 'active'), 'withdraw_contest_entry: okaz wycofany (ponowienie – bez błędu)');
  await as(K);
  ok((await rpcErr('withdraw_contest_entry', 'nie-ma-takiej'))?.message === 'contest_not_found', 'withdraw_contest_entry: nieznana walka → P0002');
  await call('enter_contest', fA1);
  await admin();
  ke = await kEntries();
  ok(
    ke.filter((e) => e.status === 'active').map((e) => `${e.contest_id}=${e.find_id}`).sort().join() ===
      [`${cA.id}=${fA1}`, `${cOkaz.id}=${fA1}`].sort().join(),
    'enter_contest po wycofaniu: okaz znów walczy (do wszystkich pasujących walk)',
    ke,
  );

  // ───────────────────────── Tablica: prywatność, remis, zasięgi ─────────────────────────
  await as(L);
  await call('enter_contest', fL);
  await admin();
  await db.query(`update finds set visible_from = now() + interval '20 hours' where id = $1`, [fA1]);
  const board = async (uid, contest, scope, scopeId = null) => {
    await as(uid);
    return call('get_contest_board', contest, scope, scopeId);
  };
  const who = (b) => b.entries.map((e) => `${e.author.handle}:${e.rank}`).join(',');
  let bL = await board(L, cA.id, 'polska');
  let bK = await board(K, cA.id, 'polska');
  ok(
    who(bL) === 'rv.lena:1' && bL.mine?.rank === 1 && bL.total === 1,
    'tablica: cudzy okaz przed visible_from niewidoczny (24 h opóźnienia)',
    bL,
  );
  ok(
    who(bK) === 'rv.kasper:null,rv.lena:1' && bK.entries[0].isMine && ISO_RE.test(bK.entries[0].visibleFrom) &&
      bK.mine.rank === null && bK.mine.visibleFrom === bK.entries[0].visibleFrom && bK.entries[1].visibleFrom === null,
    'tablica: własny okaz zawsze (rank null, visibleFrom – od kiedy widzą go inni)',
    bK,
  );
  await admin();
  await db.query(`update finds set visible_from = now() - interval '1 minute' where id = $1`, [fA1]);
  const fM = await mkFind(M, { species: spA, factor: 1.2, gmina: 'michalowo', foundAt: inWeek(0.4), photo: 'm1' });
  await as(M);
  await call('enter_contest', fM);
  bL = await board(L, cA.id, 'polska');
  ok(
    who(bL) === 'rv.kasper:1,rv.marta:2,rv.lena:3' && bL.entries[0].visibleFrom === null && bL.total === 3,
    'tablica: po visible_from okaz widać; remis – wcześniejszy found_at wyżej',
    who(bL),
  );
  ok(
    keys(bL) === BOARD_KEYS && keys(bL.contest) === CONTEST_KEYS && bL.entries.every((e) => keys(e) === ENTRY_KEYS && keys(e.author) === AUTHOR_KEYS) &&
      bL.scope === 'polska' && bL.scopeId === null && bL.scopeName === 'Polska' && bL.contest.entrants === 3 &&
      bL.entries[0].score === capA1 && bL.entries[0].relativePct === relOf(spA, capA1) && bL.entries[0].photoPath === `${K}/a1.jpg` &&
      bL.entries[0].gminaId === 'suprasl' && bL.entries[0].speciesId === spA && bL.entries[0].status === 'active' && ISO_RE.test(bL.entries[0].foundAt),
    'get_contest_board: kształt ContestBoard / ContestEntry (autor – surowe author_json, photoPath z koszyka)',
    bL.entries[0],
  );
  bK = await board(K, cA.id, 'gmina');
  ok(bK.scopeId === 'suprasl' && bK.scopeName === 'Gmina Supraśl' && who(bK) === 'rv.kasper:1,rv.lena:2', 'zasięg gmina: domyślnie gmina domowa gracza', bK);
  ok(who(await board(K, cA.id, 'gmina', 'michalowo')) === 'rv.marta:1', 'zasięg gmina: inna gmina po slugu');
  const bW = await board(K, cA.id, 'wojewodztwo', 'Podlaskie');
  ok(bW.scopeId === 'podlaskie' && bW.scopeName === 'podlaskie' && who(bW) === 'rv.kasper:1,rv.marta:2,rv.lena:3', 'zasięg województwo (nazwa bez wielkości liter)', bW);
  ok(who(await board(K, cA.id, 'znajomi')) === 'rv.kasper:1,rv.marta:2', 'zasięg znajomi: gracz + zaakceptowani znajomi');
  // Blokada w obie strony.
  const fN = await mkFind(N, { species: spA, factor: 1.5, photo: 'n1' });
  await as(N);
  await call('enter_contest', fN);
  ok(!who(await board(K, cA.id, 'polska')).includes('rv.norbert'), 'blokada: zablokowany przez gracza okaz znika z jego tablic');
  ok(!who(await board(N, cA.id, 'polska')).includes('rv.kasper'), 'blokada: działa w obie strony');
  ok(who(await board(L, cA.id, 'polska')).startsWith('rv.norbert:1,'), 'blokada: inni widzą oba okazy');
  // Ukryty w rankingach – tylko wśród znajomych.
  const fO = await mkFind(O, { species: spA, factor: 1.4, photo: 'o1' });
  await as(O);
  await call('enter_contest', fO);
  bL = await board(L, cA.id, 'polska');
  ok(!who(bL).includes('rv.olga') && who(bL) === 'rv.norbert:1,rv.kasper:2,rv.marta:3,rv.lena:4', 'ukryty (show_in_rankings = false): poza zasięgami publicznymi', who(bL));
  ok(who(await board(L, cA.id, 'znajomi')) === 'rv.olga:1,rv.lena:2', 'ukryty: znajomi widzą go na tablicy znajomych');
  const bO = await board(O, cA.id, 'polska');
  ok(bO.mine?.rank === null && bO.entries.some((e) => e.isMine && e.rank === null), 'ukryty: własny okaz w zasięgu publicznym bez miejsca (nie walczy)', bO.mine);
  ok((await board(O, cA.id, 'znajomi')).mine?.rank === 1, 'ukryty: wśród znajomych walczy');
  // Poza rywalizacją – widzi siebie, inni nie.
  await admin();
  await db.query('select contest_enter_find($1, $2)', [P, fP]);
  ok(!who(await board(L, cA.id, 'polska')).includes('rv.piotr'), 'poza rywalizacją: inni nie widzą okazu');
  const bP = await board(P, cA.id, 'polska');
  ok(bP.mine?.rank === null && bP.mine.isMine, 'poza rywalizacją: gracz widzi własny okaz (bez miejsca)', bP.mine);
  // Bez gminy domowej / błędy zasięgu.
  const bQ = await board(Q, cA.id, 'gmina');
  ok(bQ.entries.length === 0 && bQ.total === 0 && bQ.scopeId === null && bQ.scopeName === 'Twoja gmina' && bQ.mine === null, 'bez gminy domowej: pusta tablica „Twoja gmina”', bQ);
  ok((await board(Q, cA.id, 'wojewodztwo')).scopeName === 'Twoje województwo', 'bez gminy domowej: „Twoje województwo”');
  await as(K);
  ok((await rpcErr('get_contest_board', cA.id, 'swiat', null))?.message === 'invalid_scope', 'nieznany zasięg → P0001 invalid_scope');
  ok((await rpcErr('get_contest_board', cA.id, 'gmina', 'nie-ma-takiej'))?.message === 'gmina_not_found', 'nieznana gmina → P0002 gmina_not_found');
  ok((await rpcErr('get_contest_board', cA.id, 'wojewodztwo', 'atlantyda'))?.message === 'invalid_voivodeship', 'nieznane województwo → P0001 invalid_voivodeship');
  ok((await rpcErr('get_contest_board', `${WEEK}:nie-ma`, 'polska', null))?.code === 'P0002', 'nieznana walka → P0002 contest_not_found');
  // get_contest_week: mine, leaders, entrants.
  await as(K);
  const wK = await call('get_contest_week');
  ok(
    keys(wK.mine) === [cOkaz.id, cA.id].sort().join(',') && wK.mine[cA.id].rank === 2 && wK.mine[cA.id].isMine &&
      wK.leaders[cA.id]?.isMine === true && wK.leaders[cA.id].rank === 2 && wK.leaders[cB.id] === null &&
      wK.contests.find((c) => c.id === cA.id).entrants === 4,
    'get_contest_week: mine (miejsce globalne w województwie – zablokowany lider też się liczy), leaders (najlepszy widoczny), ' +
      'entrants – widoczne dla innych',
    { mine: wK.mine[cA.id]?.rank, leader: wK.leaders[cA.id]?.author?.handle, entrants: wK.contests.map((c) => c.entrants) },
  );
  await as(L);
  ok((await call('get_contest_week')).leaders[cA.id]?.author.handle === 'rv.norbert', 'get_contest_week: lider województwa z perspektywy innego gracza');

  // ───────────────────────── Zdjęcia: polityka Storage ─────────────────────────
  await admin();
  for (const n of [`${K}/a1.jpg`, `${K}/o2.jpg`, `${K}/nosize.jpg`, `${O}/o1.jpg`, `${P}/p1.jpg`, `${L}/l1.jpg`, `${M}/m1.jpg`]) await putObject(n);
  ok(await canRead(L, `${M}/m1.jpg`), 'Storage: zdjęcie okazu z innej gminy (zgłoszony, widoczny)');
  ok(await canRead(L, `${K}/a1.jpg`), 'Storage: inny gracz czyta zdjęcie zgłoszonego, widocznego okazu');
  ok(!(await canRead(L, `${K}/nosize.jpg`)), 'Storage: zdjęcie niezgłoszonego znaleziska – nie');
  ok(!(await canRead(L, `${K}/o2.jpg`)), 'Storage: zdjęcie wycofanego okazu – nie');
  ok(!(await canRead(N, `${K}/a1.jpg`)), 'Storage: blokada – nie');
  ok((await canRead(L, `${O}/o1.jpg`)) && !(await canRead(K, `${O}/o1.jpg`)), 'Storage: okaz ukrytego gracza – tylko jego znajomi');
  ok(!(await canRead(L, `${P}/p1.jpg`)), 'Storage: gracz poza rywalizacją – nie');
  ok(await canRead(K, `${K}/nosize.jpg`), 'Storage: własne zdjęcia jak dotąd');
  await admin();
  await db.query(`update finds set visible_from = now() + interval '1 hour' where id = $1`, [fA1]);
  ok(!(await canRead(L, `${K}/a1.jpg`)), 'Storage: przed visible_from – nie');
  await admin();
  await db.query(`update finds set visible_from = now() - interval '1 minute' where id = $1`, [fA1]);

  // ───────────────────────── Zgłoszenia społeczności i moderacja ─────────────────────────
  const eL = await entryOf(L, cA.id, 'active');
  const eK = await entryOf(K, cA.id, 'active');
  const eN = await entryOf(N, cA.id, 'active');
  const eM = await entryOf(M, cA.id, 'active');
  await as(K);
  ok((await rpcErr('report_contest_entry', eK.id, null))?.message === 'invalid_entry', 'report_contest_entry: własny okaz → P0001 invalid_entry');
  ok((await rpcErr('report_contest_entry', eN.id, null))?.code === 'P0002', 'report_contest_entry: okaz niewidoczny (blokada) → P0002 entry_not_found');
  ok((await rpcErr('report_contest_entry', eL.id, 'spam'))?.message === 'invalid_reason', 'report_contest_entry: powód spoza kodów → P0001 invalid_reason');
  for (const [r, reason] of [[REP[0], 'reproduction'], [REP[1], 'wrong_species'], [REP[0], 'other'], [REP[2], null]]) {
    await as(r);
    await call('report_contest_entry', eL.id, reason);
  }
  await admin();
  ok(
    (await rows('select reason from contest_reports where entry_id = $1 order by created_at', [eL.id])).map((x) => x.reason).join() ===
      'reproduction,wrong_species,other',
    'zgłoszenia: kody powodów (null = other), ponowienie nie zmienia zgłoszenia',
  );
  ok((await entryOf(L, cA.id)).status === 'active', 'zgłoszenia: 2 konta zabezpieczone + konto anonimowe (+ powtórka) – okaz nadal walczy');
  await as(REP[3]);
  await call('report_contest_entry', eL.id, null);
  ok((await entryOf(L, cA.id)).status === 'review', 'zgłoszenia: 3 różnych zgłaszających → okaz w weryfikacji (review)');
  ok(!who(await board(K, cA.id, 'polska')).includes('rv.lena'), 'review: okaz znika z tablic innych');
  const bLr = await board(L, cA.id, 'polska');
  ok(bLr.mine?.status === 'review' && bLr.mine.rank === null && (await call('get_contest_week')).mine[cA.id]?.status === 'review', 'review: autor widzi „w weryfikacji”', bLr.mine);
  ok((await rpcErr('withdraw_contest_entry', cA.id))?.message === 'entry_in_review', 'review: wycofanie → P0001 entry_in_review');
  const fL2 = await mkFind(L, { species: spA, factor: 1.25 });
  await as(L);
  const entL2 = await call('enter_contest', fL2);
  ok(
    entL2.contests.find((m) => m.contest.id === cOkaz.id)?.entered === true && entL2.contests.find((m) => m.contest.id === cA.id)?.entered === false &&
      (await entryOf(L, cA.id)).find_id === fL,
    'review: nowe zgłoszenie zastępuje okaz tylko w walkach, gdzie nie czeka na weryfikację',
  );
  const eLokaz = await entryOf(L, cOkaz.id, 'active');
  await db.query(`update contest_entries set status = 'review' where id = $1`, [eLokaz.id]);
  const fL3 = await mkFind(L, { species: spA, factor: 1.1 });
  await as(L);
  ok((await rpcErr('enter_contest', fL3))?.message === 'entry_in_review', 'review we wszystkich pasujących walkach → P0001 entry_in_review');
  await admin();
  await db.query(`update contest_entries set status = 'active' where id = $1`, [eLokaz.id]);
  await db.query(`update rivalry_params set v = 1 where k = 'contest_report_per_day'`);
  await as(REP[4]);
  await call('report_contest_entry', eK.id, null);
  const rl = await rpcErr('report_contest_entry', eM.id, null);
  ok(rl?.message === 'rate_limited' && /limit/i.test(rl.detail), 'report_contest_entry: dzienny limit → P0001 rate_limited', rl);
  await admin();
  await db.query(`update rivalry_params set v = 30 where k = 'contest_report_per_day'`);
  await as(K);
  ok((await rpcErr('admin_review_contest_entry', eL.id, true, null))?.message.includes('permission denied'), 'admin_review_contest_entry: klient nie wywoła (tylko service_role)');
  await admin();
  await db.exec('set role service_role');
  const appr = (await one('select admin_review_contest_entry($1, true, $2) r', [eL.id, 'Zdjęcie w porządku'])).r;
  const rej = (await one('select admin_review_contest_entry($1, false, $2) r', [eM.id, 'Zdjęcie ekranu'])).r;
  const rejAgain = await errFull('select admin_review_contest_entry($1, false, null)', [eM.id]);
  await admin();
  ok(appr.status === 'active' && (await entryOf(L, cA.id)).status === 'active' && (await entryOf(L, cA.id)).reviewed_at, 'moderacja: przywrócenie → okaz wraca na tablice', appr);
  ok(rej.status === 'rejected' && (await entryOf(M, cA.id)).status === 'rejected' && rejAgain?.message === 'invalid_entry', 'moderacja: odrzucenie (ponowne → P0001 invalid_entry)', rej);
  const fake = await one(`select severity from anti_cheat_flags where user_id = $1 and kind = 'contest_fake' and ref_id = $2`, [M, eM.id]);
  ok(fake?.severity === 3, 'moderacja: odrzucenie → flaga 3 contest_fake dla autora', fake);
  await as(REP[5]);
  await call('report_contest_entry', eL.id, null);
  ok((await entryOf(L, cA.id)).status === 'active', 'po przywróceniu liczą się tylko nowe zgłoszenia (1 < 3)');
  await as(M);
  ok((await call('get_contest_eligibility', fM)).reason?.includes('odrzucony'), 'odrzucony okaz nie walczy ponownie');
  ok(!(await canRead(L, `${M}/m1.jpg`)), 'Storage: zdjęcie odrzuconego okazu – nie');

  // ───────────────────────── Aktywność: wyprzedzenie w walce ─────────────────────────
  await as(K);
  ok(!(await call('get_activity')).some((x) => x.kind === 'contest_overtaken'), 'contest_overtaken: zablokowany, ukryty i spoza rywalizacji nie „wyprzedzają”');
  const sinceK = new Date().toISOString();
  const fS = await mkFind(S, { species: spA, factor: 1.6, visibleFrom: isoAgo(30 * 60e3) });
  await db.query('select contest_enter_find($1, $2)', [S, fS]);
  const eS = await entryOf(S, cA.id, 'active');
  const eK2 = await entryOf(K, cA.id, 'active');
  // Okaz wyprzedzającego „widoczny od dawna” (np. późno zamknięta wyprawa) – stary znacznik czasu nie może zgubić powiadomienia.
  await db.query(
    `update contest_entries o set created_at = k.created_at + interval '1 second', shown_since = k.created_at + interval '1 second'
       from contest_entries k where o.user_id = $1 and k.user_id = $2 and k.contest_id = o.contest_id and k.status = 'active'`,
    [S, K],
  );
  await as(K);
  const actK = await call('get_activity', sinceK, 50);
  const overAll = actK.filter((x) => x.kind === 'contest_overtaken');
  const over = overAll.find((x) => x.refId === cA.id);
  ok(
    over && over.id === `contest_overtaken:${eK2.id}:${eS.id}` && over.actor.id === S && keys(over) === ACTIVITY_KEYS &&
      over.meta.scope === 'wojewodztwo' && over.meta.rank === 3 && over.meta.title === cA.title && over.createdAt > sinceK &&
      overAll.length === 2 && overAll.every((x) => x.actor.id === S) && overAll.some((x) => x.refId === cOkaz.id),
    'get_activity: contest_overtaken – nowy wyprzedzający w województwie, czas pierwszej obserwacji (po since), meta.rank – ' +
      'nowe miejsce (globalne)',
    overAll,
  );
  const actK2 = (await call('get_activity')).filter((x) => x.kind === 'contest_overtaken');
  ok(
    actK2.length === 2 && actK2.find((x) => x.id === over.id)?.createdAt === over.createdAt && actK2.find((x) => x.id === over.id).meta.rank === 3,
    'contest_overtaken: ponowny odczyt – te same id, czas i miejsce (bez spamu)',
  );
  const fa = (await call('get_activity')).find((x) => x.kind === 'friend_accepted');
  ok(fa && fa.refId === null && fa.meta === null && keys(fa) === ACTIVITY_KEYS, 'get_activity: dotychczasowe rodzaje z refId = null, meta = null', fa);
  await as(N);
  ok(!(await call('get_activity')).some((x) => x.kind === 'contest_overtaken' && x.actor.id === K), 'get_activity: bez zdarzeń od graczy w blokadzie');

  // ───────────────────────── Rozstrzygnięcie: podia, progi uczestników, nagrody ─────────────────────────
  const W = addDaysYmd(WEEK, -14);
  await admin();
  const wTs = new Date((await one('select warsaw_ts($1::date) ts', [W])).ts).getTime();
  await db.query('select ensure_contest_week($1::date)', [W]);
  const wOkaz = `${W}:okaz`;
  const wSpecies = (await one('select contest_week_species($1::date) s', [W])).s;
  const FSP = ['borowik-szlachetny', 'podgrzybek-brunatny', 'czubajka-kania', 'maslak-zwyczajny'].find((x) => !wSpecies.includes(x));
  const plan = [
    // [nick, gmina, mnożnik kapelusza, godzina tygodnia]
    ['rv.f1', 'suprasl', 1.9, 30], ['rv.f2', 'suprasl', 1.7, 31], ['rv.f3', 'suprasl', 1.5, 20], ['rv.f4', 'suprasl', 1.5, 40],
    ['rv.f5', 'michalowo', 1.6, 33], ['rv.f6', 'michalowo', 1.2, 34], ['rv.f7', 'krakow', 2.0, 35], ['rv.f8', 'krakow', 1.4, 36],
    ['rv.f9', 'krakow', 1.3, 37], ['rv.f10', 'warszawa', 1.8, 38], ['rv.f11', 'warszawa', 2.4, 39], ['rv.f12', 'suprasl', 2.3, 41],
    ['rv.f13', 'suprasl', 2.2, 42], ['rv.f14', 'suprasl', 2.45, 43], ['rv.f15', 'suprasl', 2.42, 160],
  ];
  const F = {};
  const wResults = wTs + (7 * 24 + 48) * H;
  for (const [nick, gmina, factor, hour] of plan) {
    const uid = await mkUser(nick, nick.toUpperCase(), null, gmina);
    const at = new Date(wTs + hour * H).toISOString();
    const fid = await mkFind(uid, {
      species: FSP, gmina, factor, foundAt: at, createdAt: at,
      // f15: znaleziony w niedzielę, wyprawa trzymana otwarta – widoczny (najpóźniej 48 h po znalezieniu) < 24 h przed rozstrzygnięciem
      visibleFrom: new Date(nick === 'rv.f15' ? wResults - H : wTs + (hour + 24) * H).toISOString(),
    });
    await db.query('select contest_enter_find($1, $2)', [uid, fid]);
    F[nick] = uid;
  }
  await backdateEntries(W);
  // f14: ukryty przez cały tydzień, odsłonięty tuż przed rozstrzygnięciem (okaz publiczny za krótko przed results_at).
  await db.query(`update contest_entries set shown_since = $2 where user_id = $1`, [F['rv.f14'], new Date(wResults - 2 * H).toISOString()]);
  await db.query('update profiles set show_in_rankings = false where id = $1', [F['rv.f11']]);
  await db.query(`insert into player_standing (user_id, status) values ($1, 'review')`, [F['rv.f12']]);
  await db.query(`update contest_entries set status = 'review' where user_id = $1`, [F['rv.f13']]);
  await db.query('update auth.users set is_anonymous = true where id = $1', [F['rv.f8']]);
  ok((await one('select finalized_at from contests where id = $1', [wOkaz])).finalized_at === null, 'rozstrzygnięcie: przed odczytem walka czeka (leniwie)');
  await as(F['rv.f1']);
  const wWeek = await call('get_contest_week', W);
  ok(wWeek.contests.every((c) => c.status === 'final') && wWeek.weekStart === W, 'rozstrzygnięcie leniwe: odczyt po resultsAt → status final', wWeek.contests.map((c) => c.status));
  await admin();
  const awards = await rows(
    `select p.handle::text as h, a.scope, a.scope_id, a.scope_name, a.place, a.xp from contest_awards a join profiles p on p.id = a.user_id
      where a.contest_id = $1 order by a.scope, a.scope_id nulls first, a.place`,
    [wOkaz],
  );
  const aw = awards.map((a) => `${a.scope}:${a.scope_id ?? '-'}:${a.place}:${a.h}:${a.xp}`).join(' ');
  ok(
    aw ===
      [
        'gmina:krakow:1:rv.f7:0', 'gmina:krakow:2:rv.f8:0', 'gmina:krakow:3:rv.f9:30',
        'gmina:suprasl:1:rv.f1:0', 'gmina:suprasl:2:rv.f2:0', 'gmina:suprasl:3:rv.f3:30',
        'polska:-:1:rv.f7:500', 'polska:-:2:rv.f1:300', 'polska:-:3:rv.f10:150',
        'wojewodztwo:podlaskie:1:rv.f1:0', 'wojewodztwo:podlaskie:2:rv.f2:150', 'wojewodztwo:podlaskie:3:rv.f5:75',
      ].join(' '),
    'rozstrzygnięcie: podia z progami (gmina ≥ 3, woj. ≥ 5, Polska ≥ 10), remis – wcześniejszy found_at, najwyższa nagroda na gracza, ' +
      'konto anonimowe bez XP, bez ukrytych / poza rywalizacją / w weryfikacji; okaz odsłonięty albo widoczny dopiero tuż przed ' +
      'rozstrzygnięciem (< 24 h) nie walczy',
    awards,
  );
  ok(awards.find((a) => a.scope === 'gmina' && a.scope_id === 'suprasl').scope_name === 'Gmina Supraśl', 'trofeum: nazwa zasięgu');
  const cxp = await rows(
    `select p.handle::text as h, e.amount, e.gmina_id from xp_events e join profiles p on p.id = e.user_id
      where e.source = 'contest' and e.ref_id = $1 order by e.amount desc, p.handle`,
    [wOkaz],
  );
  ok(
    cxp.map((x) => `${x.h}:${x.amount}:${x.gmina_id}`).join() ===
      'rv.f7:500:krakow,rv.f1:300:suprasl,rv.f10:150:warszawa,rv.f2:150:suprasl,rv.f5:75:michalowo,rv.f3:30:suprasl,rv.f9:30:krakow',
    'rozstrzygnięcie: XP do księgi (źródło contest, ref = id walki, gmina okazu)',
    cxp,
  );
  ok((await one('select finalize_contest($1) n', [wOkaz])).n === 0, 'finalize_contest: idempotentne (druga próba – 0 trofeów)');
  await as(F['rv.f2']);
  await call('get_contest_week', W);
  await admin();
  ok(Number((await one(`select count(*) n from xp_events where source = 'contest' and ref_id = $1`, [wOkaz])).n) === 7, 'rozstrzygnięcie: ponowny odczyt nie wypłaca XP drugi raz');
  await as(F['rv.f1']);
  const tr = await call('get_trophies');
  ok(
    keys(tr) === 'bronze,gold,items,silver' && tr.gold === 2 && tr.silver === 1 && tr.bronze === 0 && tr.items.length === 3 &&
      tr.items.every((x) => keys(x) === TROPHY_KEYS && x.contestId === wOkaz && x.contestTitle === 'Okaz tygodnia' && x.speciesId === FSP && ISO_RE.test(x.awardedAt)) &&
      tr.items.find((x) => x.scope === 'polska').xp === 300 && tr.items.filter((x) => x.xp === 0).length === 2,
    'get_trophies: TrophyCase gracza (złoto / srebro / brąz, pozycje z XP – 0 przy niższej nagrodzie)',
    tr,
  );
  await as(F['rv.f2']);
  ok((await call('get_trophies', F['rv.f1'])).gold === 2, 'get_trophies(p_user): trofea innego grzybiarza');
  await admin();
  await db.query('update profiles set show_in_rankings = false where id = $1', [F['rv.f7']]);
  await as(F['rv.f2']);
  ok((await call('get_trophies', F['rv.f7'])).items.length === 0, 'get_trophies: ukryty gracz – trofea tylko dla znajomych');
  await as(F['rv.f1']);
  await call('block_user', F['rv.f2']);
  await as(F['rv.f2']);
  ok((await rpcErr('get_trophies', F['rv.f1']))?.code === 'P0002', 'get_trophies: blokada → P0002 user_not_found');
  await as(F['rv.f1']);
  const actF1 = (await call('get_activity')).filter((x) => x.kind === 'contest_award');
  ok(
    actF1.length === 3 && actF1.every((x) => x.refId === wOkaz && x.actor.id === F['rv.f1'] && keys(x.meta) === 'place,scope,scopeName,title,xp' && x.meta.title === 'Okaz tygodnia') &&
      actF1.find((x) => x.meta.scope === 'polska').meta.xp === 300,
    'get_activity: contest_award (actor = gracz, refId = id walki, meta {place, scope, scopeName, xp, title})',
    actF1,
  );
  await as(K);
  ok((await call('get_contest_week')).previousWeekStart === W, 'get_contest_week: previousWeekStart – ostatni rozstrzygnięty tydzień');
  // Status judging: tydzień minął, wyniki jeszcze nie.
  const W3 = addDaysYmd(WEEK, -28);
  await admin();
  await db.query('select ensure_contest_week($1::date)', [W3]);
  await db.query(`update contests set results_at = now() + interval '1 hour' where week_start = $1::date`, [W3]);
  await as(K);
  ok((await call('get_contest_week', W3)).contests.every((c) => c.status === 'judging'), 'status judging: po końcu tygodnia, przed resultsAt');
  await admin();
  await db.query(`update contests set results_at = now() - interval '1 minute' where week_start = $1::date`, [W3]);
  await as(K);
  ok((await call('get_contest_week', W3)).contests.every((c) => c.status === 'final'), 'status final po resultsAt (bez uczestników – bez trofeów)');
  ok((await call('get_contest_week')).previousWeekStart === W, 'previousWeekStart – tylko tydzień z finalistami (pusty nowszy pominięty)');

  // Tablica rozstrzygniętej walki = migawka: okaz, który stał się widoczny po rozstrzygnięciu, nie wskakuje na podium.
  await admin();
  const F16 = await mkUser('rv.f16', 'RV.F16', null, 'suprasl');
  const f16At = new Date(wTs + 50 * H).toISOString();
  const f16 = await mkFind(F16, { species: FSP, factor: 2.49, foundAt: f16At, createdAt: f16At });
  await db.query('select contest_enter_find($1, $2)', [F16, f16]);
  await as(K);
  const finalBoard = await call('get_contest_board', wOkaz, 'polska', null);
  ok(
    // f7 (1. miejsce) ukrył się po rozstrzygnięciu – znika z tablicy, miejsca innych bez zmian
    finalBoard.contest.status === 'final' && finalBoard.entries[0].author.handle === 'rv.f1' && finalBoard.entries[0].rank === 2 &&
      !finalBoard.entries.some((e) => e.author.id === F16) && finalBoard.contest.entrants === 10 &&
      finalBoard.entries.every((e, k) => k === 0 || e.rank > finalBoard.entries[k - 1].rank),
    'tablica rozstrzygniętej walki – migawka miejsc z rozstrzygnięcia (późny okaz poza tablicą)',
    finalBoard.entries.map((e) => `${e.author.handle}:${e.rank}`),
  );
  await as(F16);
  const finalOwn = await call('get_contest_board', wOkaz, 'polska', null);
  ok(finalOwn.mine?.rank === null && finalOwn.entries.find((e) => e.isMine)?.rank === null, 'późny okaz: autor widzi go bez miejsca');
  const doneEntry = await entryOf(F['rv.f5'], wOkaz, 'active');
  await as(F16);
  ok((await rpcErr('report_contest_entry', doneEntry.id, 'other'))?.message === 'contest_closed', 'zgłoszenie po rozstrzygnięciu → P0001 contest_closed');

  // Okaz z podium w weryfikacji wstrzymuje rozstrzygnięcie do decyzji moderatora (najwyżej contest_review_max_delay_h).
  const holdWeek = async (weekStart, prefix) => {
    await admin();
    await db.query('select ensure_contest_week($1::date)', [weekStart]);
    const ts = new Date((await one('select warsaw_ts($1::date) ts', [weekStart])).ts).getTime();
    const ids = [];
    for (const [k, factor] of [[1, 2.0], [2, 1.6], [3, 1.4], [4, 1.2]]) {
      const uid = await mkUser(`${prefix}${k}`, `${prefix}${k}`, null, 'hajnowka');
      const at = new Date(ts + (20 + k) * H).toISOString();
      const fid = await mkFind(uid, {
        species: FSP, gmina: 'hajnowka', factor, foundAt: at, createdAt: at, visibleFrom: new Date(ts + (44 + k) * H).toISOString(),
      });
      await db.query('select contest_enter_find($1, $2)', [uid, fid]);
      ids.push(uid);
    }
    await backdateEntries(weekStart);
    await db.query(`update contest_entries set status = 'review' where user_id = $1`, [ids[0]]);
    // Wyniki „przed chwilą” – w oknie oczekiwania na moderację (contest_review_max_delay_h).
    await db.query(`update contests set results_at = now() - interval '1 hour' where week_start = $1::date`, [weekStart]);
    return ids;
  };
  const W4 = addDaysYmd(WEEK, -35);
  const H4 = await holdWeek(W4, 'rv.hold');
  await as(H4[1]);
  ok(
    (await call('get_contest_week', W4)).contests.find((c) => c.id === `${W4}:okaz`).status === 'judging',
    'okaz z podium w weryfikacji – rozstrzygnięcie czeka (judging)',
  );
  await admin();
  ok((await one('select next_check_at from contests where id = $1', [`${W4}:okaz`])).next_check_at !== null, 'rozstrzygnięcie odłożone (next_check_at)');
  const holdEntry = (await entryOf(H4[0], `${W4}:okaz`)).id;
  await db.exec('set role service_role');
  await one('select admin_review_contest_entry($1, true, null) r', [holdEntry]);
  await as(H4[1]);
  await call('get_contest_week', W4);
  await admin();
  const holdAw = (
    await rows(
      `select p.handle::text as h, a.place, a.xp from contest_awards a join profiles p on p.id = a.user_id
        where a.contest_id = $1 and a.scope = 'gmina' order by a.place`,
      [`${W4}:okaz`],
    )
  ).map((x) => `${x.h}:${x.place}:${x.xp}`);
  ok(holdAw.join() === 'rv.hold1:1:100,rv.hold2:2:60,rv.hold3:3:30', 'po przywróceniu okazu walka rozstrzyga się z nim na podium', holdAw);
  const W5 = addDaysYmd(WEEK, -42);
  const H5 = await holdWeek(W5, 'rv.late');
  await db.query(`update contests set results_at = now() - interval '169 hours' where week_start = $1::date`, [W5]);
  await as(H5[1]);
  ok((await call('get_contest_week', W5)).contests.every((c) => c.status === 'final'), 'bez decyzji moderatora – rozstrzygnięcie po contest_review_max_delay_h');
  await admin();
  const lateAw = (
    await rows(
      `select p.handle::text as h, a.place from contest_awards a join profiles p on p.id = a.user_id
        where a.contest_id = $1 and a.scope = 'gmina' order by a.place`,
      [`${W5}:okaz`],
    )
  ).map((x) => `${x.h}:${x.place}`);
  ok(lateAw.join() === 'rv.late2:1,rv.late3:2,rv.late4:3', 'okaz wciąż w weryfikacji nie dostaje nagrody', lateAw);

  // Gmina tylko z telefonu (rozpoznanie bez gminy) – nie liczy się do podium gminy / województwa (farma pustej gminy).
  const W6 = addDaysYmd(WEEK, -49);
  await admin();
  await db.query('select ensure_contest_week($1::date)', [W6]);
  const w6Ts = new Date((await one('select warsaw_ts($1::date) ts', [W6])).ts).getTime();
  const farm = [];
  for (const k of [1, 2, 3]) {
    const uid = await mkUser(`rv.farm${k}`, `Farm ${k}`, null, 'gromadka');
    const at = new Date(w6Ts + (20 + k) * H).toISOString();
    const fid = await mkFind(uid, {
      species: FSP, gmina: 'gromadka', serverGmina: false, factor: 1 + k / 10, foundAt: at, createdAt: at,
      visibleFrom: new Date(w6Ts + (44 + k) * H).toISOString(),
    });
    await db.query('select contest_enter_find($1, $2)', [uid, fid]);
    farm.push(uid);
  }
  await backdateEntries(W6);
  await as(farm[0]);
  await call('get_contest_week', W6);
  await admin();
  ok(
    Number((await one('select count(*) n from contest_awards where contest_id = $1', [`${W6}:okaz`])).n) === 0,
    'gmina z telefonu (bez gminy z rozpoznania) – bez podium gminy, mimo 3 uczestników',
  );
  await as(farm[0]);
  const farmBoard = await call('get_contest_board', `${W6}:okaz`, 'gmina', 'gromadka');
  const farmPl = await call('get_contest_board', `${W6}:okaz`, 'polska', null);
  ok(
    farmBoard.total === 1 && farmBoard.mine?.rank === null && farmPl.entries.length === 3 && farmPl.mine?.rank !== null,
    'tablica gminy: okazy bez gminy z serwera nie walczą (Polska – tak)',
    { gmina: farmBoard.entries.map((e) => e.rank), polska: farmPl.entries.map((e) => e.rank) },
  );

  // Dolna granica tygodni: walki sprzed contest_history_weeks nie powstają.
  await as(K);
  ok((await rpcErr('get_contest_week', '1900-01-01'))?.message === 'contest_not_found', 'get_contest_week: tydzień sprzed historii → P0002 contest_not_found');
  ok((await rpcErr('get_contest_board', '1800-01-06:okaz', 'polska', null))?.message === 'contest_not_found', 'get_contest_board: walka sprzed historii → P0002');
  await admin();
  ok(Number((await one(`select count(*) n from contests where week_start < '2000-01-01'`)).n) === 0, 'dawne tygodnie nie tworzą walk');

  // ───────────────────────── Pojedynki ─────────────────────────
  await admin();
  const D = {};
  for (const n of ['da', 'db', 'dc', 'dd', 'de', 'df', 'dg', 'dh', 'di', 'dj', 'dk', 'dl', 'dm', 'dn', 'do', 'dp', 'dq', 'dx']) {
    D[n] = await mkUser(`rv.${n}`, `Duel ${n.toUpperCase()}`, null, 'suprasl');
  }
  for (const [a, b] of [
    ['da', 'db'], ['da', 'dc'], ['da', 'dd'], ['da', 'de'], ['da', 'df'], ['da', 'dg'], ['dc', 'dd'], ['dc', 'de'], ['de', 'dc'],
    ['dn', 'do'], ['dp', 'dq'], ['dh', 'di'], ['dj', 'dk'], ['dl', 'dm'], ['db', 'dc'],
  ]) {
    await befriend(D[a], D[b]);
  }
  await db.query('update auth.users set is_anonymous = true where id = $1', [D.dh]);
  const duelRow = async (id) => {
    await admin();
    return one('select * from duels where id = $1', [id]);
  };
  const setWindow = async (id, startsAgo, endsAgo) => {
    await admin();
    await db.query(
      `update duels set starts_at = now() - make_interval(secs => $2), ends_at = now() - make_interval(secs => $3) where id = $1`,
      [id, startsAgo / 1000, endsAgo / 1000],
    );
  };
  /** Znalezisko do pojedynku: found_at / created_at w ms temu. */
  const dFind = (uid, o) =>
    mkFind(uid, { ...o, foundAt: isoAgo(o.ago), createdAt: isoAgo(o.createdAgo ?? o.ago), visibleFrom: isoAgo(o.ago - 60e3) });

  await as(D.da);
  ok((await rpcErr('create_duel', randomUUID(), D.dx, 'count', 1))?.message === 'not_friends', 'create_duel: nie znajomi → P0001 not_friends');
  ok((await rpcErr('create_duel', randomUUID(), D.da, 'count', 1))?.message === 'invalid_user', 'create_duel: do siebie → P0001 invalid_user');
  ok((await rpcErr('create_duel', randomUUID(), D.db, 'fastest', 1))?.message === 'invalid_duel', 'create_duel: nieznany rodzaj → P0001 invalid_duel');
  ok((await rpcErr('create_duel', randomUUID(), D.db, 'count', 2))?.message === 'invalid_duel', 'create_duel: czas inny niż 1 / 3 / 7 dni → P0001 invalid_duel');
  const id1 = randomUUID();
  const d1 = await call('create_duel', id1, D.db, 'count', 1);
  ok(
    keys(d1) === DUEL_KEYS && d1.id === id1 && d1.status === 'pending' && d1.iAmChallenger && d1.kind === 'count' && d1.days === 1 &&
      Math.abs(Date.parse(d1.expiresAt) - Date.now() - 48 * H) < 60e3 && d1.startsAt === null && d1.endsAt === null &&
      d1.outcome === null && d1.xp === null && keys(d1.me) === 'best,score,user' && d1.me.user.id === D.da &&
      d1.opponent.user.id === D.db && keys(d1.opponent.user) === AUTHOR_KEYS && d1.me.score === 0 && d1.me.best === null,
    'create_duel: wyzwanie (Duel – pending, wygasa po 48 h)',
    d1,
  );
  ok((await call('create_duel', id1, D.db, 'species', 7)).kind === 'count', 'create_duel: ponowienie z tym samym id zwraca zapisany pojedynek');
  ok((await rpcErr('create_duel', randomUUID(), D.db, 'species', 3))?.message === 'duel_limit', 'create_duel: jeden pojedynek pary naraz → P0001 duel_limit');
  await as(D.dc);
  ok((await rpcErr('create_duel', id1, D.da, 'count', 1))?.message === 'duel_id_conflict', 'create_duel: cudze id → P0001 duel_id_conflict');
  await as(D.db);
  const ovB = await call('get_duels');
  ok(
    keys(ovB) === 'active,finished,incoming,outgoing,record' && ovB.incoming.map((x) => x.id).join() === id1 && !ovB.incoming[0].iAmChallenger &&
      ovB.incoming[0].me.user.id === D.db && keys(ovB.record) === 'draw,lost,won',
    'get_duels: wyzwanie u przeciwnika w „incoming”',
    ovB,
  );
  await as(D.da);
  ok((await call('get_duels')).outgoing.map((x) => x.id).join() === id1, 'get_duels: wyzwanie u wyzywającego w „outgoing”');
  ok((await rpcErr('respond_duel', id1, true))?.message === 'invalid_response', 'respond_duel: wyzywający → P0001 invalid_response');
  await as(D.db);
  const acc = await call('respond_duel', id1, true);
  ok(
    acc.status === 'active' && Math.abs(Date.parse(acc.startsAt) - Date.now()) < 60e3 && Date.parse(acc.endsAt) - Date.parse(acc.startsAt) === DAY &&
      acc.expiresAt === null && (await call('respond_duel', id1, true)).status === 'active',
    'respond_duel: przyjęcie startuje pojedynek od teraz na 1 dzień (ponowienie – bez zmian)',
    acc,
  );
  ok((await rpcErr('respond_duel', id1, false))?.message === 'duel_closed', 'respond_duel: odrzucenie po przyjęciu → P0001 duel_closed');
  await as(D.da);
  ok((await rpcErr('cancel_duel', id1))?.message === 'duel_closed', 'cancel_duel: aktywny → P0001 duel_closed');
  // Limity: 3 w toku, 5 wyzwań na dobę, przeciwnik z kompletem.
  const id2 = randomUUID();
  const id3 = randomUUID();
  await call('create_duel', id2, D.dc, 'species', 3);
  await call('create_duel', id3, D.dd, 'biggest', 7);
  const lim3 = await rpcErr('create_duel', randomUUID(), D.de, 'count', 1);
  ok(lim3?.message === 'duel_limit' && lim3.detail.includes('w toku'), 'create_duel: 3 aktywne + oczekujące → P0001 duel_limit', lim3);
  await call('cancel_duel', id3);
  await call('cancel_duel', id3);
  ok((await duelRow(id3)).status === 'cancelled', 'cancel_duel: anulowanie wyzwania (ponowienie – bez błędu)');
  await as(D.dd);
  ok((await rpcErr('cancel_duel', id2))?.code === 'P0002', 'cancel_duel: nie uczestnik → P0002 duel_not_found');
  await as(D.da);
  const id4 = randomUUID();
  await call('create_duel', id4, D.de, 'count', 1);
  await call('cancel_duel', id4);
  const id5 = randomUUID();
  await call('create_duel', id5, D.df, 'count', 1);
  await call('cancel_duel', id5);
  const limDay = await rpcErr('create_duel', randomUUID(), D.dg, 'count', 1);
  ok(limDay?.message === 'duel_limit' && limDay.detail.includes('wyzwań'), 'create_duel: 5 nowych wyzwań na dobę → P0001 duel_limit', limDay);
  ok((await call('create_duel', id5, D.df, 'count', 1)).id === id5, 'create_duel: ponowienie z tym samym id po wyczerpaniu limitu zwraca zapisany pojedynek');
  await admin();
  await db.query(`update rivalry_params set v = 1 where k = 'duel_max_open'`);
  await as(D.de);
  const limOpp = await rpcErr('create_duel', randomUUID(), D.dc, 'count', 1);
  await admin();
  await db.query(`update rivalry_params set v = 3 where k = 'duel_max_open'`);
  ok(limOpp?.message === 'duel_limit' && limOpp.detail.includes('Znajomy'), 'create_duel: przeciwnik z kompletem pojedynków → P0001 duel_limit', limOpp);
  // Odrzucenie i wygaśnięcie.
  await as(D.dc);
  ok((await call('respond_duel', id2, false)).status === 'declined', 'respond_duel: odrzucenie → declined');
  await as(D.da);
  const ovA = await call('get_duels');
  ok(
    ovA.finished.some((x) => x.id === id2 && x.status === 'declined' && ISO_RE.test(x.finishedAt)) &&
      ovA.finished.some((x) => x.id === id3 && x.status === 'cancelled') && ovA.active.map((x) => x.id).join() === id1,
    'get_duels: odrzucone i anulowane w „finished”, aktywny w „active”',
    ovA,
  );
  const id7 = randomUUID();
  await as(D.dc);
  await call('create_duel', id7, D.dd, 'count', 3);
  await admin();
  await db.query(`update duels set expires_at = now() - interval '1 minute' where id = $1`, [id7]);
  await as(D.dd);
  const ovD = await call('get_duels');
  ok(ovD.incoming.length === 0 && ovD.finished.some((x) => x.id === id7 && x.status === 'expired'), 'zaproszenie po 48 h → expired (leniwie)', ovD);

  // Wynik na żywo i rozstrzygnięcie (count): okno wg found_at, kolejka offline ≤ 6 h po końcu.
  await setWindow(id1, 30 * H, -1 * H);
  await dFind(D.da, { ago: 20 * H, species: 'borowik-szlachetny' });
  await dFind(D.da, { ago: 10 * H, species: 'podgrzybek-brunatny' });
  await dFind(D.da, { ago: 9 * H, species: 'muchomor-czerwony', collected: false });
  await dFind(D.da, { ago: 9 * H, verified: false });
  await dFind(D.da, { ago: 35 * H });
  await dFind(D.da, { ago: 8 * H, createdAgo: 0 });
  await dFind(D.db, { ago: 15 * H, species: 'czubajka-kania' });
  await as(D.da);
  const live = await call('get_duel', id1);
  ok(live.status === 'active' && live.me.score === 3 && live.opponent.score === 1 && live.me.best === null, 'pojedynek na żywo: liczą się odebrane, zebrane, zweryfikowane w oknie', live);
  await setWindow(id1, 30 * H, 7 * H);
  await as(D.da);
  const fin = await call('get_duel', id1);
  ok(
    fin.status === 'finished' && fin.me.score === 2 && fin.opponent.score === 1 && fin.outcome === 'won' && fin.xp === 100 && ISO_RE.test(fin.finishedAt),
    'rozstrzygnięcie po końcu + 6 h: znalezisko, które dotarło później niż 6 h po końcu, się nie liczy; wygrana +100 XP',
    fin,
  );
  await as(D.db);
  const finB = await call('get_duel', id1);
  ok(finB.outcome === 'lost' && finB.xp === 0 && (await call('get_duels')).record.lost === 1, 'przegrana: 0 XP, bilans w record');
  await admin();
  const dxp = await rows(`select user_id, amount from xp_events where source = 'duel' and ref_id = $1`, [id1]);
  ok(dxp.length === 1 && dxp[0].user_id === D.da && dxp[0].amount === 100, 'XP pojedynku w księdze (źródło duel, ref = id pojedynku)', dxp);
  // Para – 1 nagrodzony pojedynek na tydzień.
  const id8 = randomUUID();
  await as(D.db);
  await call('create_duel', id8, D.da, 'species', 1);
  await as(D.da);
  await call('respond_duel', id8, true);
  await setWindow(id8, 30 * H, 7 * H);
  await admin();
  await db.query('update duels set ends_at = (select ends_at from duels where id = $2) where id = $1', [id8, id1]);
  await as(D.da);
  const f8 = await call('get_duel', id8);
  ok(f8.status === 'finished' && f8.me.score === 3 && f8.opponent.score === 1 && f8.outcome === 'won' && f8.xp === 0, 'farma: para ma już nagrodzony pojedynek w tym tygodniu → 0 XP', f8);
  // Gracz – limit nagrodzonych pojedynków na tydzień (próg obniżony do 1).
  await admin();
  await db.query(`update rivalry_params set v = 1 where k = 'duel_rewarded_per_week'`);
  const id9 = randomUUID();
  const id10 = randomUUID();
  await as(D.dc);
  await call('create_duel', id9, D.dd, 'count', 1);
  await call('create_duel', id10, D.de, 'count', 1);
  await as(D.dd);
  await call('respond_duel', id9, true);
  await as(D.de);
  await call('respond_duel', id10, true);
  await setWindow(id9, 30 * H, 7 * H);
  await setWindow(id10, 30 * H, 7 * H);
  await db.query('update duels set ends_at = (select ends_at from duels where id = $2) where id = $1', [id10, id9]);
  await dFind(D.dc, { ago: 20 * H });
  await dFind(D.dc, { ago: 19 * H });
  await dFind(D.dd, { ago: 18 * H });
  await dFind(D.de, { ago: 18 * H });
  await as(D.dc);
  const ovC = await call('get_duels');
  const r9 = ovC.finished.find((x) => x.id === id9);
  const r10 = ovC.finished.find((x) => x.id === id10);
  ok(r9?.outcome === 'won' && r10?.outcome === 'won' && r9.xp + r10.xp === 100 && Math.min(r9.xp, r10.xp) === 0, 'farma: limit nagrodzonych pojedynków gracza na tydzień', { r9, r10 });
  await admin();
  await db.query(`update rivalry_params set v = 3 where k = 'duel_rewarded_per_week'`);
  // Wynik 0 po jednej stronie, remis, konto anonimowe.
  const play = async (a, b, kind, findsA, findsB) => {
    const id = randomUUID();
    await as(D[a]);
    await call('create_duel', id, D[b], kind, 1);
    await as(D[b]);
    await call('respond_duel', id, true);
    await setWindow(id, 30 * H, 7 * H);
    for (let i = 0; i < findsA; i++) await dFind(D[a], { ago: (20 - i) * H });
    for (let i = 0; i < findsB; i++) await dFind(D[b], { ago: (20 - i) * H });
    await as(D[a]);
    return call('get_duel', id);
  };
  const zero = await play('dn', 'do', 'count', 2, 0);
  ok(zero.outcome === 'won' && zero.xp === 0, 'bez nagrody, gdy przeciwnik ma wynik 0 (przeciw farmom)', zero);
  const draw = await play('dp', 'dq', 'count', 1, 1);
  await as(D.dq);
  const drawB = (await call('get_duels')).finished.find((x) => x.id === draw.id);
  ok(draw.outcome === 'draw' && draw.xp === 30 && drawB.outcome === 'draw' && drawB.xp === 30, 'remis: po 30 XP dla obu stron', { draw, drawB });
  const anon = await play('dh', 'di', 'count', 2, 1);
  ok(anon.outcome === 'won' && anon.xp === 0, 'konto anonimowe: wygrana bez nagrody', anon);
  // Aktywność pojedynków.
  await as(D.db);
  const actB = await call('get_activity');
  const inv = actB.find((x) => x.id === `duel_invite:${id1}`);
  const finAct = actB.find((x) => x.id === `duel_finished:${id1}`);
  ok(
    inv && inv.kind === 'duel_invite' && inv.actor.id === D.da && inv.refId === id1 && keys(inv.meta) === 'days,kind' &&
      inv.meta.kind === 'count' && inv.meta.days === 1 &&
      finAct && finAct.actor.id === D.da && finAct.meta.outcome === 'lost' && finAct.meta.xp === 0 && keys(inv) === ACTIVITY_KEYS,
    'get_activity: duel_invite (meta {kind, days}) i duel_finished (meta {outcome, xp}) u przeciwnika',
    { inv, finAct },
  );
  await as(D.da);
  const actA = await call('get_activity');
  ok(
    actA.some((x) => x.id === `duel_accepted:${id1}` && x.actor.id === D.db && x.meta.kind === 'count') &&
      actA.some((x) => x.id === `duel_finished:${id1}` && x.meta.outcome === 'won' && x.meta.xp === 100),
    'get_activity: duel_accepted i duel_finished u wyzywającego',
  );
  // Blokada w trakcie pojedynku.
  const idJ = randomUUID();
  await as(D.dj);
  await call('create_duel', idJ, D.dk, 'species', 3);
  await as(D.dk);
  await call('respond_duel', idJ, true);
  await call('block_user', D.dj);
  await as(D.dj);
  const ovJ = await call('get_duels');
  ok(ovJ.active.length === 0 && (await duelRow(idJ)).status === 'cancelled', 'blokada w trakcie → pojedynek anulowany (i znika z list)');
  await as(D.dj);
  ok((await rpcErr('get_duel', idJ))?.message === 'duel_not_found', 'get_duel: pojedynek z graczem w blokadzie → P0002 duel_not_found');
  ok((await rpcErr('create_duel', randomUUID(), D.dk, 'count', 1))?.message === 'not_friends', 'blokada: nie można wyzwać');
  // „Największy okaz”: najlepszy okaz i jego zdjęcie dla uczestnika.
  const idL = randomUUID();
  await as(D.dl);
  await call('create_duel', idL, D.dm, 'biggest', 3);
  await as(D.dm);
  await call('respond_duel', idL, true);
  await setWindow(idL, 10 * H, -60 * H);
  const mBest = await dFind(D.dm, { ago: 5 * H, species: 'borowik-szlachetny', factor: 1.8, photo: 'best' });
  await dFind(D.dm, { ago: 4 * H, species: 'borowik-szlachetny', factor: 1.1, photo: 'small' });
  await dFind(D.dm, { ago: 3 * H, species: 'borowik-szlachetny', factor: 2.0, sizeVerified: false, photo: 'nosz' });
  await putObject(`${D.dm}/best.jpg`);
  await putObject(`${D.dm}/small.jpg`);
  await as(D.dl);
  const big = await call('get_duel', idL);
  ok(
    big.opponent.score === relOf('borowik-szlachetny', capOf('borowik-szlachetny', 1.8)) && big.opponent.best?.findId === mBest &&
      keys(big.opponent.best) === 'capCm,findId,photoPath,relativePct,speciesId' && big.opponent.best.photoPath === `${D.dm}/best.jpg` &&
      big.me.score === 0 && big.me.best === null,
    'pojedynek „największy okaz”: wynik %, najlepszy okaz size_verified z gatunkiem, kapeluszem i zdjęciem',
    big.opponent,
  );
  ok((await canRead(D.dl, `${D.dm}/best.jpg`)) && !(await canRead(D.dl, `${D.dm}/small.jpg`)) && !(await canRead(D.dx, `${D.dm}/best.jpg`)),
    'Storage: uczestnik pojedynku czyta zdjęcie najlepszego okazu przeciwnika (tylko jego, inni – nie)');

  // ───────────────────────── Ranking grzybiarzy ─────────────────────────
  // Województwo bez żadnego XP w bazie (boty generatora z innych testów mają zweryfikowane znaleziska w podlaskim) –
  // zasięgi gminy / województwa da się sprawdzić dokładnie; w zasięgu Polski – wiersz gracza (me) i pendingXp.
  await admin();
  const seasonStart = new Date((await one(`select warsaw_ts(ranking_period_start('season')) ts`)).ts).getTime();
  const iso1 = await one(
    `select g.voivodeship as v, array_agg(g.id order by g.id) as ids from gminy g
      where not exists (select 1 from xp_events e join gminy g2 on g2.id = e.gmina_id where g2.voivodeship = g.voivodeship)
      group by g.voivodeship order by g.voivodeship limit 1`,
  );
  const [G1, G2] = iso1.ids;
  const VV = iso1.v;
  const RK = {};
  for (const [n, g] of [['ra', G1], ['rb', G2], ['rc', G2], ['rd', G1], ['re', G2], ['rg', G1], ['rh', null]]) {
    RK[n] = await mkUser(`rv.rk${n}`, `Rank ${n.toUpperCase()}`, null, g);
  }
  await befriend(RK.ra, RK.rb);
  await befriend(RK.rc, RK.ra);
  await db.query('update profiles set show_in_rankings = false where id = $1', [RK.rc]);
  await db.query(`insert into player_standing (user_id, status) values ($1, 'banned')`, [RK.rd]);
  await db.query('insert into user_blocks (blocker_id, blocked_id) values ($1, $2)', [RK.ra, RK.re]);
  const old = new Date(Math.max(seasonStart + H, Date.now() - 3 * DAY)).toISOString();
  const fresh = isoAgo(H);
  const xpEv = async (uid, source, amount, at, gmina = null, verified = true) => {
    let ref = 'test';
    if (source === 'find') ref = await mkFind(uid, { verified, foundAt: at, createdAt: at, gmina: gmina ?? 'suprasl' });
    await db.query('insert into xp_events (user_id, source, ref_id, gmina_id, amount, created_at) values ($1, $2, $3, $4, $5, $6)', [
      uid, source, ref, gmina, amount, at,
    ]);
  };
  await xpEv(RK.ra, 'find', 100, old, G1);
  await xpEv(RK.ra, 'find', 500, old, G1, false);
  await xpEv(RK.ra, 'achievement', 1000, old, G1);
  await xpEv(RK.ra, 'quest', 200, old, G1);
  await xpEv(RK.ra, 'challenge', 50, old, G1);
  await xpEv(RK.ra, 'contest', 300, old, G1);
  await xpEv(RK.ra, 'duel', 100, old);
  await xpEv(RK.ra, 'find', 40, fresh, G1);
  await xpEv(RK.rb, 'find', 600, old, G2);
  await xpEv(RK.rc, 'find', 700, old, G2);
  await xpEv(RK.rd, 'find', 900, old, G1);
  await xpEv(RK.re, 'find', 800, old, G2);
  await xpEv(RK.rg, 'find', 450, old, G1);
  const rk = async (uid, scope, period = 'season', scopeId = null) => {
    await as(uid);
    return call('get_player_ranking', scope, period, scopeId);
  };
  /** Wiersze: nick bez „rv.rk”, miejsce, XP; remisy (to samo XP) w kolejności nicków. */
  const rowsOf = (r) =>
    [...r.rows]
      .sort((a, b) => a.rank - b.rank || a.user.handle.localeCompare(b.user.handle))
      .map((x) => `${x.user.handle.replace('rv.rk', '')}:${x.rank}:${x.xp}`)
      .join(',');
  const pl = await rk(RK.ra, 'polska');
  ok(
    keys(pl) === RANKING_KEYS && pl.scope === 'polska' && pl.period === 'season' && pl.live === false && pl.scopeName === 'Polska' &&
      pl.scopeId === null && pl.me?.xp === 550 && pl.me.isMe && keys(pl.me) === 'isMe,rank,user,xp' && keys(pl.me.user) === AUTHOR_KEYS &&
      pl.pendingXp === 40 && pl.hidden === false && pl.total >= 3 && pl.rows.every((x, k) => k === 0 || x.rank >= pl.rows[k - 1].rank),
    'ranking Polska (sezon): find tylko verified + challenge + contest + duel, XP sprzed 24 h (pendingXp – świeże)',
    { me: pl.me, pendingXp: pl.pendingXp, total: pl.total },
  );
  const gm = await rk(RK.ra, 'gmina');
  ok(
    gm.scopeId === G1 && gm.scopeName.startsWith('Gmina ') && rowsOf(gm) === 'ra:1:450,rg:1:450' && gm.total === 2 && gm.me?.rank === 1 &&
      gm.pendingXp === 40,
    'ranking gminy (domyślnie gmina domowa): XP zdobyte w gminie (bez pojedynków – bez gminy), remis – to samo miejsce, bez poza rywalizacją',
    rowsOf(gm),
  );
  const wj = await rk(RK.ra, 'wojewodztwo');
  ok(
    wj.scopeId === VV && wj.scopeName === VV && rowsOf(wj) === 'rb:2:600,ra:3:450,rg:3:450' && wj.total === 3,
    'ranking województwa: XP w gminach województwa, bez ukrytych i poza rywalizacją; zablokowany znika z listy, miejsca globalne',
    rowsOf(wj),
  );
  ok(rowsOf(await rk(RK.rb, 'wojewodztwo', 'season', VV)) === 're:1:800,rb:2:600,ra:3:450,rg:3:450', 'blokada wyklucza tylko w parze (inni widzą obu)');
  ok(!(await rk(RK.re, 'wojewodztwo', 'season', VV)).rows.some((x) => x.user.id === RK.ra), 'blokada w rankingu działa w obie strony');
  const fr = await rk(RK.ra, 'znajomi');
  ok(
    fr.live === true && fr.scopeName === 'Znajomi' && fr.scopeId === null && rowsOf(fr) === 'rc:1:700,rb:2:600,ra:3:590' && fr.pendingXp === 0 &&
      fr.total === 3,
    'ranking znajomych: na żywo (także świeże XP), ukryty znajomy widoczny',
    rowsOf(fr),
  );
  const hid = await rk(RK.rc, 'polska');
  ok(hid.hidden === true && hid.me === null && !hid.rows.some((x) => x.user.id === RK.rc), 'ukryty: hidden = true, bez wiersza w zasięgach publicznych');
  ok((await rk(RK.rc, 'znajomi')).me?.xp === 700, 'ukryty: wśród znajomych jest');
  ok((await rk(RK.rd, 'polska')).me === null && (await rk(RK.rd, 'gmina')).me === null, 'poza rywalizacją: me = null');
  const wk2 = await rk(RK.ra, 'polska', 'week');
  ok(wk2.period === 'week' && keys(wk2) === RANKING_KEYS, 'ranking tygodnia: ten sam kształt (okres od poniedziałku)');
  const noHome = await rk(RK.rh, 'gmina');
  ok(noHome.rows.length === 0 && noHome.scopeName === 'Twoja gmina' && noHome.me === null && noHome.total === 0, 'ranking bez gminy domowej: pusty „Twoja gmina”');
  await as(RK.ra);
  ok((await rpcErr('get_player_ranking', 'polska', 'records', null))?.message === 'invalid_period', 'ranking: nieznany okres → P0001 invalid_period');
  ok((await rpcErr('get_player_ranking', 'kosmos', 'week', null))?.message === 'invalid_scope', 'ranking: nieznany zasięg → P0001 invalid_scope');
  const st = await call('get_rivalry_status');
  ok(keys(st) === 'accountSecured,showInRankings,standing' && st.showInRankings && st.standing === 'ok' && st.accountSecured, 'get_rivalry_status: RivalryStatus', st);
  await call('set_ranking_visibility', false);
  ok((await call('get_rivalry_status')).showInRankings === false && (await rk(RK.ra, 'polska')).hidden === true, 'set_ranking_visibility(false) → ukryty');
  ok(!(await rk(RK.rb, 'wojewodztwo', 'season', VV)).rows.some((x) => x.user.id === RK.ra), 'po ukryciu inni nie widzą gracza w rankingu');
  await as(RK.ra);
  await call('set_ranking_visibility', true);
  ok((await rpcErr('set_ranking_visibility', null))?.message === 'invalid_visibility', 'set_ranking_visibility(null) → P0001');
  await as(RK.rd);
  ok((await call('get_rivalry_status')).standing === 'review', "get_rivalry_status: 'banned' pokazywane jako 'review'");
  await as(REP[2]);
  ok((await call('get_rivalry_status')).accountSecured === false, 'get_rivalry_status: konto anonimowe – accountSecured = false');

  // ───────────────────────── Uszczelnienia po przeglądzie ─────────────────────────
  // Zbiorowe „poza rywalizacją” = competition_eligible (anty-złączenia zamiast funkcji na wiersz).
  await admin();
  const parity = await one(
    `select count(*) filter (where competition_eligible(p.id) = (p.id in (select u.user_id from rivalry_ineligible_users() u))) as bad,
            count(*) filter (where not competition_eligible(p.id)) as out
       from profiles p`,
  );
  ok(Number(parity.bad) === 0 && Number(parity.out) >= 3, 'rivalry_ineligible_users() = not competition_eligible() dla wszystkich graczy', parity);

  // Odsiew polityki Storage: ścieżki zdjęć rywalizacji w private.rivalry_photo_paths (wyzwalacze) = obie tabele.
  const pathsOk = await one(
    `select (select count(*) from private.rivalry_photo_paths) as n,
            (select count(*) from (select path from rivalry_public_photos union select path from rivalry_duel_photos) x) as m,
            (select count(*) from private.rivalry_photo_paths where path = $1) as rejected`,
    [`${M}/m1.jpg`],
  );
  ok(
    Number(pathsOk.n) === Number(pathsOk.m) && Number(pathsOk.n) > 0 && Number(pathsOk.rejected) === 0,
    'private.rivalry_photo_paths = ścieżki zdjęć rywalizacji (odrzucony okaz usunięty)',
    pathsOk,
  );

  // Limit nagrodzonych pojedynków z księgi duel_rewards – usunięcie danych przeciwnika go nie odnawia.
  await admin();
  for (const n of ['xa', 'xb', 'xc']) D[n] = await mkUser(`rv.${n}`, `Duel ${n.toUpperCase()}`, null, 'suprasl');
  await befriend(D.xa, D.xb);
  await befriend(D.xa, D.xc);
  await db.query(`update rivalry_params set v = 1 where k = 'duel_rewarded_per_week'`);
  const farm1 = await play('xa', 'xb', 'count', 2, 1);
  await admin();
  await db.query('select wipe_rivalry_data($1)', [D.xb]);
  const farm2 = await play('xa', 'xc', 'count', 2, 1);
  await admin();
  await db.query(`update rivalry_params set v = 3 where k = 'duel_rewarded_per_week'`);
  ok(
    farm1.xp === 100 && farm2.outcome === 'won' && farm2.xp === 0 &&
      Number((await one('select count(*) n from duel_rewards where user_id = $1', [D.xa])).n) === 1,
    'farma: usunięcie danych przeciwnika (jego pojedynki znikają) nie odnawia tygodniowego limitu nagród (księga duel_rewards)',
    { farm1: farm1.xp, farm2: farm2.xp },
  );

  // Zgłoszenia: do progu liczą się tylko konta zabezpieczone, w rywalizacji i starsze niż 7 dni.
  await admin();
  const Z = [];
  for (let i = 1; i <= 4; i++) Z.push(await mkUser(`rv.zgl${i}`, `Zgl ${i}`, null, 'krakow'));
  await db.query(`update profiles set created_at = now() - interval '30 days' where id = any($1)`, [Z.slice(1)]);
  await db.query(`insert into player_standing (user_id, status) values ($1, 'review')`, [Z[1]]);
  const eL2 = await entryOf(L, cA.id, 'active');
  for (const z of Z.slice(0, 3)) {
    await as(z);
    await call('report_contest_entry', eL2.id, 'reproduction');
  }
  ok((await entryOf(L, cA.id)).status === 'active', 'zgłoszenia świeżego konta i gracza poza rywalizacją nie liczą się do progu');
  await as(Z[3]);
  await call('report_contest_entry', eL2.id, 'reproduction');
  ok((await entryOf(L, cA.id)).status === 'review', 'trzeci liczony zgłaszający (od ostatniej moderacji) → weryfikacja');

  // Odsłonięcie / ukrycie: okno publiczności okazu liczy się od odsłonięcia.
  await admin();
  const shownOf = async () => (await entryOf(O, cA.id, 'active')).shown_since;
  const sh0 = await shownOf();
  await as(O);
  await call('set_ranking_visibility', true);
  const sh1 = await shownOf();
  await as(O);
  await call('set_ranking_visibility', false);
  const sh2 = await shownOf();
  ok(sh0 === null && sh1 !== null && sh2 === null, 'set_ranking_visibility: okaz ukrytego – shown_since po odsłonięciu, null po ukryciu', { sh0, sh1, sh2 });

  // Niezamknięta wyprawa (visible_from null): okaz widoczny najpóźniej 48 h po znalezieniu – stały termin dla autora.
  await admin();
  const V = await mkUser('rv.otwarta', 'Otwarta', null, 'suprasl');
  const fV = await mkFind(V, { species: spA, factor: 1.05, visibleFrom: null });
  const fVrow = await one('select created_at, found_at from finds where id = $1', [fV]);
  await as(V);
  await call('enter_contest', fV);
  const vb1 = (await call('get_contest_board', cA.id, 'polska', null)).mine;
  const vb2 = (await call('get_contest_board', cA.id, 'polska', null)).mine;
  ok(
    vb1.rank === null && vb1.visibleFrom === vb2.visibleFrom &&
      Date.parse(vb1.visibleFrom) === Math.max(new Date(fVrow.created_at).getTime(), new Date(fVrow.found_at).getTime()) + 48 * H,
    'okaz z niezamkniętej wyprawy: visibleFrom = znalezienie + 48 h (stały, nie przesuwa się)',
    vb1,
  );

  // ───────────────────────── Uprawnienia ─────────────────────────
  await as(K);
  const denied = [];
  for (const tbl of ['contests', 'contest_entries', 'contest_reports', 'contest_awards', 'duels', 'rivalry_params', 'duel_rewards',
    'rivalry_public_photos', 'rivalry_duel_photos', 'contest_overtakes']) {
    if (!(await errFull(`select * from ${tbl} limit 1`))?.message.includes('permission denied')) denied.push(tbl);
  }
  ok(denied.length === 0, 'klient nie czyta tabel rywalizacji wprost (tylko RPC)', denied);
  ok((await errFull('update profiles set show_in_rankings = false where id = $1', [K]))?.message.includes('permission denied'), 'klient nie zmieni show_in_rankings wprost (tylko RPC)');
  const internal = [
    ['finalize_contest', [cOkaz.id]], ['ensure_contest_week', [WEEK]], ['contest_enter_find', [K, fA1]], ['settle_duels', [K, true]],
    ['wipe_rivalry_data', [K]], ['export_rivalry_data', [K]], ['rivalry_bot_find', [K, OTHER, 'suprasl', new Date().toISOString(), 1]],
    ['contest_week_species', [WEEK]], ['finish_duel', [id1]],
  ];
  const leaks = [];
  for (const [fn, args] of internal) if (!(await rpcErr(fn, ...args))?.message.includes('permission denied')) leaks.push(fn);
  ok(leaks.length === 0, 'klient nie wywoła funkcji wewnętrznych rywalizacji', leaks);
  await admin();
  await db.exec('set role anon');
  const anonLeaks = [];
  for (const [fn, args] of [
    ['get_contest_week', []], ['get_contest_board', [cOkaz.id, 'polska', null]], ['get_duels', []], ['get_player_ranking', ['polska', 'week', null]],
    ['get_rivalry_status', []], ['dev_seed_rivalry', [null]],
  ]) {
    if (!(await rpcErr(fn, ...args))?.message.includes('permission denied')) anonLeaks.push(fn);
  }
  ok(anonLeaks.length === 0, 'anon nie wywoła żadnego RPC rywalizacji', anonLeaks);
  await admin();

  // ───────────────────────── Eksport i czyszczenie ─────────────────────────
  const exK = (await one('select export_rivalry_data($1) e', [K])).e;
  ok(
    keys(exK) === 'contestEntries,contestReports,duels,showInRankings,trophies' && exK.contestEntries.length >= 4 &&
      exK.contestReports.length === 0 && exK.showInRankings === true,
    'export_rivalry_data: okazy w walkach, zgłoszenia, trofea, pojedynki',
    keys(exK),
  );
  const exA = (await one('select export_rivalry_data($1) e', [D.da])).e;
  ok(exA.duels.length >= 5 && exA.duels.some((d) => d.opponentHandle === 'rv.db' && d.outcome === 'won' && d.xp === 100), 'export_rivalry_data: pojedynki z nickiem przeciwnika', exA.duels[0]);
  await db.query('select wipe_rivalry_data($1)', [D.da]);
  const exA2 = (await one('select export_rivalry_data($1) e', [D.da])).e;
  ok(
    exA2.duels.length === 0 && Number((await one('select count(*) n from duels where $1 in (challenger_id, opponent_id)', [D.da])).n) === 0,
    'wipe_rivalry_data: pojedynki gracza znikają',
  );
  await db.query('select wipe_rivalry_data($1)', [K]);
  ok(Number((await one('select count(*) n from contest_entries where user_id = $1', [K])).n) === 0, 'wipe_rivalry_data: okazy w walkach znikają');

  // ───────────────────────── Narzędzia deweloperskie ─────────────────────────
  const DV = await mkUser('rv.dev', 'Dev R', 'Dev', 'suprasl');
  await as(DV);
  const seed = await call('dev_seed_rivalry', null);
  ok(
    keys(seed) === 'grzybiarze,okazy,pojedynki,wojewodztwo,znajomi' &&
      seed.wojewodztwo === 'podlaskie' && seed.grzybiarze === 12 && seed.okazy >= 12 && seed.znajomi === 3 && seed.pojedynki === 2,
    'dev_seed_rivalry: 12 botów z okazami tygodnia, 3 boty-znajomi, wyzwanie bota i aktywny pojedynek',
    seed,
  );
  const seed2 = await call('dev_seed_rivalry', null);
  ok(seed2.grzybiarze === 12 && seed2.okazy === seed.okazy && seed2.pojedynki === 2, 'dev_seed_rivalry: ponowne wywołanie nie dubluje', seed2);
  const ovDV = await call('get_duels');
  ok(ovDV.incoming.length === 1 && ovDV.active.length === 1 && ovDV.active[0].opponent.score >= 3, 'dev_seed_rivalry: wyzwanie od bota i pojedynek z wynikiem bota', ovDV);
  const bDV = await call('get_contest_board', cOkaz.id, 'wojewodztwo', null);
  ok(bDV.entries.filter((e) => e.author.handle.startsWith('rb20.')).length >= 10 && bDV.entries.every((e) => e.rank !== null), 'dev_seed_rivalry: okazy botów na tablicy województwa (widoczne)');
  const fDV = await mkFind(DV, { species: spA, factor: 1.3 });
  await as(DV);
  await call('enter_contest', fDV);
  const friendBot = ovDV.incoming[0].opponent.user.id;
  const idDV = randomUUID();
  const thirdBot = (await call('get_friends')).friends.map((f) => f.id).find((id) => id !== friendBot && id !== ovDV.active[0].opponent.user.id);
  await call('create_duel', idDV, thirdBot, 'biggest', 1);
  const act = await call('dev_rivalry_act');
  ok(
    keys(act) === 'okazy,przyjęte,wyprzedzenia' && act['przyjęte'] === 1 && act.okazy >= 3 && act.wyprzedzenia >= 1,
    'dev_rivalry_act: bot przyjmuje wyzwanie, dokłada okazy w pojedynkach, wyprzedza gracza (klucze po polsku)',
    act,
  );
  ok((await call('get_activity')).some((x) => x.kind === 'contest_overtaken'), 'dev_rivalry_act: aktywność contest_overtaken');
  const finDev = await call('dev_finalize_rivalry');
  await admin();
  const prevAwards = Number(
    (await one(`select count(*) n from contest_awards a join contests c on c.id = a.contest_id where c.week_start = $1::date`, [addDaysYmd(WEEK, -7)])).n,
  );
  const prevOpen = Number((await one('select count(*) n from contests where week_start = $1::date and finalized_at is null', [addDaysYmd(WEEK, -7)])).n);
  ok(
    keys(finDev) === 'pojedynki,trofea,walki' && prevOpen === 0 && prevAwards >= 3 && finDev.pojedynki >= 2,
    'dev_finalize_rivalry: poprzedni tydzień rozstrzygnięty (podia botów), pojedynki gracza zakończone',
    { finDev, prevAwards, prevOpen },
  );
  await as(DV);
  ok((await call('get_duels')).active.length === 0, 'dev_finalize_rivalry: aktywne pojedynki gracza rozstrzygnięte');
  await admin();
  await db.query(`update app_config set value = 'false' where key = 'dev_tools'`);
  await as(DV);
  const off = await rpcErr('dev_seed_rivalry', null);
  await admin();
  await db.query(`update app_config set value = 'true' where key = 'dev_tools'`);
  ok(off?.message === 'dev_tools_disabled', 'dev_*: bez dev_tools → P0001 dev_tools_disabled');
  await admin();
};
