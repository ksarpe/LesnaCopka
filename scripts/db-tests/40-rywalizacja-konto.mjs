/**
 * Dane gracza a rywalizacja i podpisane rozpoznanie (supabase/migrations/20261015120000_rywalizacja_konto.sql):
 * usunięcie konta czyści okazy w walkach, trofea, pojedynki, rozpoznania, dziennik limitów i status w rywalizacji;
 * eksport ma nowe sekcje „recognitions” i „rivalry”; reset deweloperski zaczyna od czystej rywalizacji.
 */
export default async (t) => {
  const { db, ok, one, as, admin, call, mkUser, mkRecognition, randomUUID } = t;
  const count = async (sql, params) => Number((await one(sql, params)).n);
  const week = (await one(`select to_char(public.week_start((now() at time zone 'Europe/Warsaw')::date), 'YYYY-MM-DD') d`)).d;

  /** Gracz z pełnym śladem rywalizacji: zgłoszony okaz, trofeum, pojedynek, rozpoznanie, wpis limitu, status. */
  const seedPlayer = async (handle) => {
    await admin();
    const uid = await mkUser(handle, handle, null, 'suprasl');
    const friend = await mkUser(`${handle}.f`, `${handle}.f`, null, 'suprasl');
    await db.query(`insert into friendships (user_id, friend_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [uid, friend]);
    const find = (
      await one(
        `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, weight_g,
                            verified, size_verified, found_at, claimed_at, visible_from)
         values ($1, 'borowik-szlachetny', 'suprasl', 'rzadki', 0.95, true, 'claimed', 16, 700, true, true, now() - interval '1 hour',
                 now() - interval '1 hour', now() - interval '1 minute')
         returning id`,
        [uid],
      )
    ).id;
    await as(uid);
    const elig = await call('enter_contest', find);
    await call('create_duel', randomUUID(), friend, 'count', 3);
    await admin();
    await db.query(
      `insert into contest_awards (contest_id, user_id, scope, scope_id, scope_name, place, species_id, cap_cm, score, xp, find_id)
       values ($1, $2, 'gmina', 'suprasl', 'Gmina Supraśl', 1, 'borowik-szlachetny', 16, 133.3, 0, $3)`,
      [`${week}:okaz`, uid, find],
    );
    await mkRecognition(uid, { photoPath: `${uid}/rec/${randomUUID()}.jpg` });
    await admin();
    await db.query(`insert into rate_events (user_id, action) values ($1, 'reaction')`, [uid]);
    await db.query(`insert into player_standing (user_id, status, reason) values ($1, 'review', 'test')`, [uid]);
    return { uid, friend, find, elig };
  };

  // ── Eksport ──
  const P = await seedPlayer('konto.eksport');
  ok(P.elig?.contests?.some((m) => m.entered), 'przygotowanie: okaz zgłoszony do walki tygodnia', P.elig);
  await as(P.uid);
  const exp = await call('export_my_data');
  ok(
    exp.format === 'grzybobranie-export-v1' && Array.isArray(exp.finds) && exp.finds.length === 1 && exp.recognitions != null &&
      exp.rivalry != null && JSON.stringify(exp.rivalry).includes(P.find) && JSON.stringify(exp.recognitions).length > 2,
    'export_my_data: dotychczasowe sekcje + „recognitions” i „rivalry” (zgłoszony okaz gracza)',
    { keys: Object.keys(exp), rivalry: exp.rivalry, recognitions: exp.recognitions },
  );
  ok(
    (await t.fails('select export_my_data_v1()'))?.includes('permission denied') &&
      (await t.fails('select export_rivalry_data($1)', [P.uid]))?.includes('permission denied'),
    'export_my_data_v1 / export_rivalry_data – wewnętrzne (klient woła tylko export_my_data)',
  );

  // ── Usunięcie konta (wipe_account_data) ──
  await admin();
  const before = await one(
    `select (select count(*) from contest_entries where user_id = $1) e, (select count(*) from duels where $1 in (challenger_id, opponent_id)) d,
            (select count(*) from recognitions where user_id = $1) r, (select count(*) from player_standing where user_id = $1) s`,
    [P.uid],
  );
  await db.query('select wipe_account_data($1)', [P.uid]);
  const after = await one(
    `select (select count(*) from contest_entries where user_id = $1) e, (select count(*) from contest_awards where user_id = $1) a,
            (select count(*) from duels where $1 in (challenger_id, opponent_id)) d, (select count(*) from recognitions where user_id = $1) r,
            (select count(*) from rate_events where user_id = $1) re, (select count(*) from player_standing where user_id = $1) s,
            (select count(*) from finds where user_id = $1) f`,
    [P.uid],
  );
  ok(
    Number(before.e) >= 1 && Number(before.d) === 1 && Number(before.r) === 1 && Number(before.s) === 1 &&
      Object.values(after).every((v) => Number(v) === 0),
    'wipe_account_data: okazy w walkach, trofea, pojedynki, rozpoznania, dziennik limitów i status w rywalizacji znikają',
    { before, after },
  );
  ok(
    (await count('select count(*) n from duels where $1 in (challenger_id, opponent_id)', [P.friend])) === 0 &&
      (await count('select count(*) n from profiles where id = $1', [P.friend])) === 1,
    'wipe_account_data: pojedynek znika też u przeciwnika (jego konto zostaje)',
  );

  // ── Reset deweloperski ──
  const R = await seedPlayer('konto.reset');
  await as(R.uid);
  const reset = await call('dev_reset_player');
  await admin();
  ok(
    reset?.storagePaths && (await count('select count(*) n from contest_entries where user_id = $1', [R.uid])) === 0 &&
      (await count('select count(*) n from duels where $1 in (challenger_id, opponent_id)', [R.uid])) === 0 &&
      (await count('select count(*) n from recognitions where user_id = $1', [R.uid])) === 0 &&
      JSON.stringify(reset.storagePaths).includes('/rec/'),
    'dev_reset_player: świeży gracz bez okazów w walkach, pojedynków i rozpoznań (zdjęcia rozpoznań w storagePaths)',
    reset?.storagePaths,
  );
};
