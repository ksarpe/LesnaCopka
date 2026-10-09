/**
 * Podpisane rozpoznanie (supabase/migrations/20261015100000_podpisane_rozpoznanie.sql):
 *  · Edge Function identify (symulowana – recognition_begin / recognition_finish jako service_role): skróty zdjęć,
 *    ponowienie bez modelu, cudzy obraz, reprodukcja, bezpiecznik sobowtórów, gmina z pozycji, limity kosztów;
 *  · submit_find z p_recognition_id: dane okazu z rekordu (telefon kłamie – bez skutku), jedno rozpoznanie = jedno
 *    znalezisko, odmowy (cudze, przeterminowane, reprodukcja, odrzucone), bez id tylko przy dev_tools;
 *  · rzadkość / waga / XXL z serwera (parytet z estimateDimensions), get_game_state, set_find_photo, Storage rec/,
 *    percentyl (zweryfikowane, k-anonimowość, progi wagi), rekordy gminy, sprzątanie, usunięcie konta, uprawnienia.
 */
import { tsImport } from 'tsx/esm/api';

export default async (t) => {
  const { db, app, ok, one, as, admin, err, errFull, call, newUser, mkUser, state, iso, H, DAY, ISO_RE, randomUUID } = t;
  const { submitArgs, submitRec, mkRecognition, sha } = t;
  const { estimateDimensions } = await tsImport('../../src/utils/identify.ts', import.meta.url);
  const { isXxl } = await tsImport('../../src/utils/xp.ts', import.meta.url);
  const keys = (o) => Object.keys(o).sort().join(',');
  const svc = async () => {
    await db.exec('reset role');
    await db.exec('set role service_role');
  };
  const begin = async (u, hashes, pos = {}) =>
    (await one('select recognition_begin($1, $2, $3, $4, $5) r', [u, hashes, pos.lat ?? null, pos.lon ?? null, pos.acc ?? null])).r;
  const finish = async (b, u, status, result, o = {}) =>
    (
      await one('select recognition_finish($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) r', [
        b.callId, u, b.recognitionId, status, o.charged ?? status !== 'failed', result ? JSON.stringify(result) : null,
        o.photoPath === undefined ? b.photoPath : o.photoPath, o.model ?? 'claude-opus-5-5', 6000, 150, 5800, 0,
      ])
    ).r;
  const recRow = async (id) => {
    await admin();
    return one('select * from recognitions where id = $1', [id]);
  };
  const MODEL = (o = {}) => ({
    reproduction: false,
    verdict: 'mushroom',
    reason: '',
    candidates: [
      { speciesId: 'borowik-szlachetny', confidence: 0.91 },
      { speciesId: 'goryczak-zolciowy', confidence: 0.06 },
    ],
    visibleParts: ['cap', 'stem', 'underside'],
    count: 1,
    scaleReference: 'hand',
    capCm: 15.5,
    heightCm: 17,
    maturity: 'mature',
    ...o,
  });
  const RESP_KEYS =
    'candidates,capCm,count,expiresAt,heightCm,maturity,reason,recognitionId,reproduction,scaleReference,sizeMeasured,verdict,visibleParts';
  const REPRO = 'To wygląda na zdjęcie ekranu albo wydruku – zrób zdjęcie prawdziwego grzyba.';

  await admin();
  await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
  const P = await mkUser('rec.gracz', 'Rec Gracz', 'Rec', 'suprasl');
  const Q = await mkUser('rec.inny', 'Rec Inny', 'Inny', 'suprasl');
  await db.query(`update profiles set created_at = now() - interval '2 days' where id = any($1)`, [[P, Q]]);
  // Granica testowa (seed nie ma granic PRG – gmina_at zwraca wtedy null): kwadrat wokół punktu 53,25 N 23,35 E.
  await db.exec(`update gminy set boundary = extensions.st_multi(extensions.st_makeenvelope(23.3::float8, 53.2::float8, 23.4::float8, 53.3::float8, 4326)) where id = 'suprasl'`);

  // ── Edge Function: początek, wynik, odpowiedź ──
  const [H1, H2] = [sha(), sha()];
  await svc();
  const b1 = await begin(P, [H1, H2], { lat: 53.25, lon: 23.35, acc: 12 });
  const fin1 = await finish(b1, P, 'ok', MODEL());
  const row1 = await recRow(b1.recognitionId);
  const call1 = await one('select * from identify_calls where id = $1', [b1.callId]);
  ok(
    keys(b1) === 'callId,photoPath,recognitionId,stalePaths' && b1.photoPath === `${P}/rec/${b1.recognitionId}.jpg` &&
      Array.isArray(b1.stalePaths) &&
      keys(fin1) === RESP_KEYS && fin1.recognitionId === b1.recognitionId && fin1.verdict === 'mushroom' && fin1.capCm === 15.5 &&
      fin1.heightCm === 17 && fin1.scaleReference === 'hand' && fin1.sizeMeasured === true && fin1.reproduction === false &&
      ISO_RE.test(fin1.expiresAt) && Math.abs(Date.parse(fin1.expiresAt) - Date.now() - 14 * DAY) < 60e3 &&
      fin1.candidates.length === 2 && fin1.candidates[0].speciesId === 'borowik-szlachetny',
    'recognition_begin → {callId, recognitionId, photoPath {uid}/rec/{id}.jpg}; recognition_finish → odpowiedź z recognitionId, sizeMeasured, expiresAt (14 dni – jak kolejka offline)',
    { b1, fin1 },
  );
  ok(
    row1.status === 'issued' && row1.user_id === P && row1.species_id === 'borowik-szlachetny' && Number(row1.confidence) === 0.91 &&
      row1.gmina_id === 'suprasl' && row1.views === 2 && row1.image_sha256.join() === [H1, H2].join() && row1.photo_path === b1.photoPath &&
      row1.model === 'claude-opus-5-5' && row1.scale_ref === 'hand' && Number(row1.cap_cm) === 15.5 &&
      call1.status === 'ok' && call1.charged === true && call1.input_tokens === 6000 &&
      Number((await one('select count(*) n from recognition_images where recognition_id = $1', [row1.id])).n) === 2,
    'rozpoznanie w bazie: issued, gmina z pozycji (gmina_at – współrzędnych brak w tabeli), skróty obu zdjęć, zdjęcie, model; dziennik kosztów (charged)',
    row1,
  );
  ok(
    !Object.keys(row1).some((k) => /lat|lon|accuracy|position/.test(k)),
    'rozpoznanie nie przechowuje współrzędnych (tylko gminę)',
    Object.keys(row1),
  );

  // Ponowienie (ten sam gracz, to samo zdjęcie) – zapisany wynik bez modelu i bez limitu.
  await svc();
  const callsBefore = Number((await one('select count(*) n from identify_calls where user_id = $1', [P])).n);
  const again = await begin(P, [H1, H2]);
  const callsAfter = Number((await one('select count(*) n from identify_calls where user_id = $1', [P])).n);
  ok(
    keys(again) === 'cached,stalePaths' && JSON.stringify(again.cached) === JSON.stringify(fin1) && callsAfter === callsBefore,
    'ponowienie tego samego zdjęcia (rozpoznanie ważne) → {cached: ta sama odpowiedź}, bez nowego wywołania (limit, koszt)',
    again,
  );
  // Ten sam obraz u innego gracza (zdjęcie główne albo ujęcie) / własne ujęcie jako nowe zdjęcie główne → odmowa.
  const reusedQ = await errFull('select recognition_begin($1, $2)', [Q, [H1]]);
  const reusedQ2 = await errFull('select recognition_begin($1, $2)', [Q, [sha(), H2]]);
  const reusedP = await errFull('select recognition_begin($1, $2)', [P, [H2]]);
  const badHash = await errFull('select recognition_begin($1, $2)', [P, ['abc']]);
  ok(
    reusedQ?.code === 'P0001' && reusedQ.message === 'image_reused' && reusedQ.detail === 'To zdjęcie jest już w grze – zrób własne zdjęcie grzyba.' &&
      reusedQ2?.message === 'image_reused' && reusedP?.message === 'image_reused' && reusedP.detail.includes('już rozpoznane') &&
      badHash?.message === 'invalid_hashes' &&
      Number((await one('select count(*) n from identify_calls where user_id = $1', [Q])).n) === 0,
    'ten sam obraz u innego gracza (główne albo ujęcie skanu) → P0001 image_reused (po polsku), bez wywołania modelu; zły skrót → invalid_hashes',
    { reusedQ, reusedQ2, reusedP },
  );

  // W toku → „jeszcze się analizuje”; błąd modelu → rozpoznanie znika (obraz wolny), wywołanie liczy się, gdy dotarło do modelu.
  const H3 = sha();
  const b3 = await begin(P, [H3]);
  const busy = await errFull('select recognition_begin($1, $2)', [P, [H3]]);
  const failed = await finish(b3, P, 'failed', null, { charged: true });
  const gone = Number((await one('select count(*) n from recognitions where id = $1', [b3.recognitionId])).n);
  const call3 = await one('select status, charged from identify_calls where id = $1', [b3.callId]);
  const b3b = await begin(P, [H3]);
  const rejected = await finish(b3b, P, 'ok', { ...MODEL(), verdict: 'not_mushroom', reason: 'Nie widzę tu grzyba – to wygląda na liść.' });
  const rej3 = await recRow(b3b.recognitionId);
  await svc();
  const cachedRej = await begin(P, [H3]);
  ok(
    busy?.message === 'rate_limited' && busy.detail.includes('jeszcze się analizuje') && failed === null && gone === 0 &&
      call3.status === 'failed' && call3.charged === true && rejected.verdict === 'not_mushroom' && rejected.recognitionId === null &&
      rejected.expiresAt === null && rejected.candidates.length === 0 && rejected.capCm === null && rej3.status === 'rejected' &&
      rej3.photo_path === null && cachedRej.cached?.verdict === 'not_mushroom',
    'w toku → rate_limited; failed → rozpoznanie usunięte (ponowienie możliwe), wywołanie charged; „nie grzyb” → rejected bez id i zdjęcia, ponowienie z zapisu',
    { busy, call3, rejected },
  );

  // Porzucone „pending” (funkcja ubita w trakcie) starsze niż recognition_pending_s nie blokują: recognition_begin je usuwa
  // (własne i cudze trzymające ten obraz), pliki – w stalePaths. Ścieżka zdjęcia jest w rekordzie od początku, więc w stanie
  // pending klient nie usunie pliku (rec_photo_released).
  const [HS, HQ] = [sha(), sha()];
  await admin();
  const stalePending = async (uid, hash) => {
    const row = await one(
      `insert into recognitions (user_id, status, image_sha256, expires_at, created_at)
       values ($1, 'pending', array[$2], now() + interval '14 days', now() - interval '10 minutes') returning id`,
      [uid, hash],
    );
    await db.query('insert into recognition_images (sha256, recognition_id, user_id) values ($1, $2, $3)', [hash, row.id, uid]);
    return row.id;
  };
  const staleP = await stalePending(P, HS);
  const staleQ = await stalePending(Q, HQ);
  await svc();
  const bS = await begin(P, [HS]);
  const pendRow = await recRow(bS.recognitionId);
  await db.query(`insert into storage.objects (bucket_id, name) values ('scan-photos', $1)`, [bS.photoPath]);
  await as(P);
  const delPending = await db.query(`delete from storage.objects where bucket_id = 'scan-photos' and name = $1`, [bS.photoPath]);
  await admin();
  await db.query(`delete from storage.objects where name = $1`, [bS.photoPath]);
  await svc();
  await finish(bS, P, 'failed', null, { charged: false });
  const bQ = await begin(P, [HQ]);
  await finish(bQ, P, 'failed', null, { charged: false });
  const staleLeft = Number((await one('select count(*) n from recognitions where id = any($1)', [[staleP, staleQ]])).n);
  ok(
    bS.stalePaths.includes(`${P}/rec/${staleP}.jpg`) && bQ.stalePaths.includes(`${Q}/rec/${staleQ}.jpg`) && staleLeft === 0 &&
      pendRow.status === 'pending' && pendRow.photo_path === bS.photoPath && delPending.affectedRows === 0,
    'porzucone pending (> recognition_pending_s) – usuwane w recognition_begin (własne i cudze z tym obrazem, ścieżki w stalePaths); zdjęcie w pending chronione przed klientem',
    { bS, bQ, pendRow: pendRow.photo_path },
  );

  // Reprodukcja, niska pewność, bezpiecznik sobowtórów, bez skali, gatunek spoza katalogu.
  await svc();
  const bR = await begin(P, [sha()]);
  const repro = await finish(bR, P, 'ok', MODEL({ reproduction: true }));
  const bL = await begin(P, [sha()]);
  const low = await finish(bL, P, 'ok', MODEL({ candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.5 }] }));
  const bD = await begin(P, [sha()]);
  const danger = await finish(bD, P, 'ok', MODEL({
    candidates: [
      { speciesId: 'czubajka-kania', confidence: 0.8 },
      { speciesId: 'muchomor-zielonawy', confidence: 0.2 },
    ],
  }));
  const bN = await begin(P, [sha()]);
  const noScale = await finish(bN, P, 'ok', MODEL({
    scaleReference: 'none',
    candidates: [
      { speciesId: 'wymyslony-gatunek', confidence: 0.99 },
      { speciesId: 'borowik-szlachetny', confidence: 0.9 },
    ],
  }));
  const [rR, rL, rD, rN] = [await recRow(bR.recognitionId), await recRow(bL.recognitionId), await recRow(bD.recognitionId), await recRow(bN.recognitionId)];
  ok(
    repro.verdict === 'unclear' && repro.reason === REPRO && repro.reproduction === true && repro.recognitionId === null &&
      repro.candidates.length === 0 && rR.status === 'rejected' && rR.reproduction === true && rR.photo_path === null,
    'reprodukcja (ekran / wydruk) → „unclear” z powodem po polsku, bez rozpoznania do użycia i bez zdjęcia',
    repro,
  );
  ok(
    low.recognitionId === null && rL.status === 'rejected' && Number(rL.confidence) === 0.5 &&
      danger.recognitionId === null && rD.status === 'rejected' && Number(rD.confidence) === 0.55 && danger.candidates[0].confidence === 0.8,
    'pewność < 60% → rejected; groźny sobowtór ≥ 15% przy jadalnym → pewność najwyżej 55% (jak safeConfidence w aplikacji) → rejected',
    { rL: rL.confidence, rD: rD.confidence },
  );
  ok(
    noScale.recognitionId === bN.recognitionId && noScale.capCm === null && noScale.heightCm === null && noScale.sizeMeasured === false &&
      noScale.candidates.length === 1 && rN.status === 'issued' && rN.species_id === 'borowik-szlachetny',
    'bez odniesienia skali → bez wymiarów (sizeMeasured false), gatunek spoza katalogu odfiltrowany – rozpoznanie ważne',
    noScale,
  );

  // ── submit_find z rozpoznaniem: telefon kłamie – dane z rekordu serwera ──
  await as(P);
  const F1 = randomUUID();
  const lie = {
    id: F1, recognitionId: b1.recognitionId, speciesId: 'czubajka-kania', rarity: 'legendarny', confidence: 1, xxl: false,
    gminaId: 'gromadka', dims: { cap_cm: 40, height_cm: 50, weight_g: 9999, age_days: 1 }, foundAt: iso(5 * DAY),
    candidates: [{ species_id: 'czubajka-kania', confidence: 1 }], parts: '{cap}',
  };
  const f1 = await submitRec(lie);
  const borowik = app.SPECIES.find((s) => s.id === 'borowik-szlachetny');
  const est = estimateDimensions(borowik, { capCm: 15.5, heightCm: 17, count: 1, maturity: 'mature' });
  const used1 = await recRow(b1.recognitionId);
  const ident1 = await one('select i.provider, i.model, s.parts from finds f join identifications i on i.id = f.identification_id join scans s on s.id = f.scan_id where f.id = $1', [F1]);
  ok(
    f1.species_id === 'borowik-szlachetny' && f1.rarity === 'rzadki' && Number(f1.confidence) === 0.91 && Number(f1.cap_cm) === 15.5 &&
      Number(f1.height_cm) === 17 && f1.weight_g === est.weightG && f1.xxl === isXxl(est.weightG, borowik.typical.weightG) && f1.xxl === true &&
      f1.age_days === 5 && f1.gmina_id === 'suprasl' && f1.found_at.getTime() === row1.created_at.getTime() &&
      f1.photo_path === b1.photoPath && f1.verified === true && f1.size_verified === true && f1.recognition_id === b1.recognitionId,
    `submit_find z rozpoznaniem: gatunek, rzadkość gatunku, pewność, wymiary (waga ${est.weightG} g jak estimateDimensions, XXL), gmina z serwera, czas rozpoznania, zdjęcie – verified + size_verified`,
    f1,
  );
  ok(
    used1.status === 'consumed' && used1.find_id === F1 && used1.consumed_at && ident1.provider === 'recognition' &&
      ident1.model === 'claude-opus-5-5' && ident1.parts.join() === 'cap,underside,stem',
    'rozpoznanie → consumed (find_id); identifications: provider „recognition”, model z rozpoznania; części z rozpoznania',
    { used1, ident1 },
  );
  await admin();
  const pFlags = (await db.query('select kind, severity, details from anti_cheat_flags where user_id = $1 and ref_id = $2', [P, F1])).rows;
  ok(
    pFlags.some((f) => f.kind === 'rarity_clamped' && f.severity === 2) &&
      pFlags.some((f) => f.kind === 'gmina_mismatch' && f.severity === 1 && f.details.reported === 'gromadka' && f.details.stored === 'suprasl'),
    'telefon zgłosił wyższą rzadkość i inną gminę → flagi rarity_clamped (2) i gmina_mismatch (1)',
    pFlags,
  );
  await as(P);
  const f1again = await submitRec({ ...lie, recognitionId: null });
  const second = await errFull('select * from submit_find($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [
    ...submitArgs({ id: randomUUID() }), b1.recognitionId,
  ]);
  ok(
    f1again.id === F1 && f1again.verified === true && second?.code === 'P0001' && second.message === 'recognition_used' &&
      second.detail.includes('już użyte'),
    'ponowienie z tym samym id znaleziska → ten sam wiersz; drugie znalezisko z tym samym rozpoznaniem → P0001 recognition_used',
    second,
  );
  const reward1 = await call('claim_find', F1);
  ok(
    reward1.xp.lines[0].label === 'Bazowe XP (rzadki)' && reward1.xp.lines.some((l) => l.label.startsWith('Okaz XXL')),
    'claim_find: XP z rzadkości gatunku i XXL policzonego na serwerze',
    reward1.xp.lines,
  );

  // Odmowy: cudze, przeterminowane, reprodukcja / odrzucone, nieznane.
  const sub = (uid, recId) =>
    errFull('select * from submit_find($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)', [...submitArgs({ id: randomUUID(), gminaId: 'suprasl' }), recId]);
  const recQ = await mkRecognition(Q);
  await as(P);
  const foreign = await sub(P, recQ);
  const recExp = await mkRecognition(P, { expiresAt: iso(H), createdAt: iso(73 * H) });
  const expired = await sub(P, recExp);
  const recExp2 = await mkRecognition(P, { status: 'expired' });
  const expired2 = await sub(P, recExp2);
  await as(P);
  const reproSub = await sub(P, bR.recognitionId);
  const lowSub = await sub(P, bL.recognitionId);
  const unknown = await sub(P, randomUUID());
  ok(
    foreign?.code === 'P0002' && foreign.message === 'recognition_not_found' && unknown?.code === 'P0002' &&
      expired?.code === 'P0001' && expired.message === 'recognition_expired' && expired.detail.includes('14 dni') &&
      expired2?.message === 'recognition_expired' &&
      reproSub?.message === 'recognition_rejected' && reproSub.detail.includes('ekranu albo wydruku') && lowSub?.message === 'recognition_rejected',
    'odmowy: cudze / nieznane rozpoznanie → P0002 recognition_not_found; po terminie → recognition_expired; reprodukcja / niska pewność → recognition_rejected (po polsku)',
    { foreign, expired, reproSub, lowSub },
  );

  // Bez skali – zweryfikowane, ale nie zmierzone; bez gminy z serwera – gmina z telefonu i flaga informacyjna.
  await as(P);
  const FN = randomUUID();
  const fN = await submitRec({ id: FN, recognitionId: bN.recognitionId, gminaId: 'gromadka', dims: { cap_cm: 30, height_cm: 30, weight_g: 2000, age_days: 2 } });
  const recNoG = await mkRecognition(P, { gminaId: null, speciesId: 'podgrzybek-brunatny', cap: 9 });
  const FG = randomUUID();
  const fG = await submitRec({ id: FG, recognitionId: recNoG, gminaId: 'gromadka' });
  await admin();
  const gFlag = await one(`select severity from anti_cheat_flags where user_id = $1 and kind = 'gmina_from_client' and ref_id = $2`, [P, FG]);
  ok(
    fN.verified === true && fN.size_verified === false && Number(fN.cap_cm) === 12 && fN.weight_g === 320 && fN.xxl === false &&
      fG.gmina_id === 'gromadka' && fG.verified === true && fG.size_verified === true && gFlag?.severity === 1,
    'bez odniesienia skali: verified, nie size_verified, wymiary typowe (12 cm, 320 g); bez gminy z serwera (brak granic PRG) → gmina z telefonu + flaga gmina_from_client (1)',
    { fN, fG: fG.gmina_id, gFlag },
  );

  // ── Bez rozpoznania: tylko dev_tools; rzadkość, waga, XXL z serwera ──
  await as(Q);
  const FD = randomUUID();
  const fD = await one('select * from submit_find($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', submitArgs({
    id: FD, gminaId: 'suprasl', speciesId: 'podgrzybek-brunatny', rarity: 'rzadki', xxl: true,
    dims: { cap_cm: 9, height_cm: 10, weight_g: 999, age_days: 3 },
  }));
  await admin();
  await db.exec(`update app_config set value = 'false' where key = 'dev_tools'`);
  await as(Q);
  const noDev = await errFull('select * from submit_find($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', submitArgs({ id: randomUUID(), gminaId: 'suprasl' }));
  const recQ2 = await mkRecognition(Q);
  const FQ = randomUUID();
  const fQ = await submitRec({ id: FQ, recognitionId: recQ2 });
  await admin();
  await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
  ok(
    fD.verified === false && fD.size_verified === false && fD.recognition_id === null && fD.rarity === 'pospolity' && fD.weight_g === 120 &&
      fD.xxl === false && noDev?.code === 'P0001' && noDev.message === 'recognition_required' && noDev.detail.includes('rozpoznania zdjęcia') &&
      fQ.verified === true,
    'bez rozpoznania: przy dev_tools – niezweryfikowane, rzadkość gatunku (+1 z telefonu ignorowane), waga z kapelusza (120 g), XXL z serwera; bez dev_tools → P0001 recognition_required; z rozpoznaniem działa',
    { fD, noDev },
  );

  // ── Stan gry: flagi znalezisk ──
  await as(P);
  const gs = await state();
  const g1 = gs.finds.find((f) => f.id === F1);
  const gN = gs.finds.find((f) => f.id === FN);
  await as(Q);
  const gD = (await state()).finds.find((f) => f.id === FD);
  ok(
    g1?.recognitionId === b1.recognitionId && g1.verified === true && g1.sizeVerified === true && g1.photoPath === b1.photoPath &&
      gN?.verified === true && gN.sizeVerified === false && gD?.recognitionId === null && gD.verified === false && gD.sizeVerified === false,
    'get_game_state: znaleziska z recognitionId, verified, sizeVerified (i zdjęciem z rozpoznania)',
    { g1, gN, gD },
  );

  // ── set_find_photo: zdjęcie z rozpoznania bez podmiany, rec/ zarezerwowany ──
  await as(P);
  const locked = await errFull('select set_find_photo($1, $2)', [F1, `${P}/${F1}.jpg`]);
  const lockedNull = await errFull('select set_find_photo($1, null)', [F1]);
  const same = await errFull('select set_find_photo($1, $2)', [F1, b1.photoPath]);
  await as(Q);
  const recPath = await errFull('select set_find_photo($1, $2)', [FD, `${Q}/rec/x.jpg`]);
  const okPath = await errFull('select set_find_photo($1, $2)', [FD, `${Q}/${FD}.jpg`]);
  ok(
    locked?.code === 'P0001' && locked.message === 'photo_locked' && lockedNull?.message === 'photo_locked' && same === null &&
      recPath?.message === 'invalid_path' && recPath.detail.includes('rec/') && okPath === null,
    'set_find_photo: znalezisko z rozpoznaniem → P0001 photo_locked (ta sama ścieżka – bez zmian); folder rec/ dla zwykłych znalezisk → invalid_path',
    { locked, recPath },
  );

  // ── Storage: klient nie zapisuje / nie podmienia rec/, usuwa tylko zwolnione pliki ──
  await admin();
  const orphan = `${P}/rec/${randomUUID()}.jpg`;
  await db.query(`insert into storage.objects (bucket_id, name) values ('scan-photos', $1), ('scan-photos', $2)`, [b1.photoPath, orphan]);
  await as(P);
  const insRec = await err(`insert into storage.objects (bucket_id, name) values ('scan-photos', $1)`, [`${P}/rec/nowe.jpg`]);
  const insOwn = await err(`insert into storage.objects (bucket_id, name) values ('scan-photos', $1)`, [`${P}/${randomUUID()}.jpg`]);
  const updRec = await db.query(`update storage.objects set name = name where bucket_id = 'scan-photos' and name = $1`, [b1.photoPath]);
  const delUsed = await db.query(`delete from storage.objects where bucket_id = 'scan-photos' and name = $1`, [b1.photoPath]);
  const delOrphan = await db.query(`delete from storage.objects where bucket_id = 'scan-photos' and name = $1`, [orphan]);
  const readOwn = (await db.query(`select name from storage.objects where name = $1`, [b1.photoPath])).rows.length;
  await as(Q);
  const delForeign = await db.query(`delete from storage.objects where bucket_id = 'scan-photos' and name = $1`, [b1.photoPath]);
  ok(
    insRec?.message.includes('row-level security') && insOwn === null && updRec.affectedRows === 0 && delUsed.affectedRows === 0 &&
      delOrphan.affectedRows === 1 && readOwn === 1 && delForeign.affectedRows === 0,
    'Storage scan-photos/{uid}/rec/: klient nie zapisuje i nie podmienia, nie usuwa pliku znaleziska; plik bez odwołań (po skasowaniu danych) usuwa; własny folder poza rec/ – jak dotąd',
    { insRec, upd: updRec.affectedRows, delUsed: delUsed.affectedRows, delOrphan: delOrphan.affectedRows },
  );

  // ── Uprawnienia: klient nie czyta i nie pisze rozpoznań, nie woła funkcji Edge Function ──
  await as(P);
  const denied = [
    await err('select * from recognitions'),
    await err('select * from recognition_images'),
    await err(`insert into recognitions (user_id, image_sha256, expires_at) values ($1, array[$2], now())`, [P, sha()]),
    await err('update recognitions set status = $1', ['issued']),
    await err('select recognition_begin($1, $2)', [P, [sha()]]),
    await err(`select recognition_finish(1, $1, $2, 'ok', true)`, [P, b1.recognitionId]),
    await err('select recognition_cleanup()'),
    await err('select identify_check_limits($1)', [P]),
    await err(`select find_dimensions('borowik-szlachetny', 14, null, null)`),
    await err('select export_recognitions($1)', [P]),
  ];
  await as(null);
  await db.exec('set role anon');
  denied.push(await err('select * from recognitions'), await err('select recognition_begin($1, $2)', [P, [sha()]]));
  await db.exec('reset role');
  ok(denied.every((e) => e?.message.includes('permission denied')), 'klient i anon: brak dostępu do recognitions / recognition_images i funkcji rozpoznania (tylko service_role)', denied);

  // ── Limity kosztów ──
  await admin();
  const L = await newUser('rec.limit');
  await db.query(`update profiles set created_at = now() - interval '2 days' where id = $1`, [L]);
  await db.query(
    `insert into identify_calls (user_id, started_at, finished_at, status, charged)
     select $1::uuid, now() - interval '1 hour', now() - interval '1 hour', 'ok', true from generate_series(1, 57)
     union all select $1::uuid, now() - interval '1 hour', now() - interval '1 hour', 'failed', true
     union all select $1::uuid, now() - interval '1 hour', now() - interval '1 hour', 'failed', false
     union all select $1::uuid, now() - interval '1 hour', now() - interval '1 hour', 'failed', null`,
    [L],
  );
  await svc();
  const bLim = await begin(L, [sha()]);              // 58 liczonych → 59.
  await finish(bLim, L, 'failed', null, { charged: true });
  const bLim2 = await begin(L, [sha()]);             // 59 → 60.
  await finish(bLim2, L, 'failed', null, { charged: false });
  const bLim3 = await begin(L, [sha()]);             // nieobciążone się nie liczą → wciąż 59 → 60.
  await finish(bLim3, L, 'ok', MODEL({ verdict: 'unclear', candidates: [] }));
  const over = await errFull('select recognition_begin($1, $2)', [L, [sha()]]);
  await admin();
  const N = await newUser('rec.nowy');
  await db.query(
    `insert into identify_calls (user_id, started_at, finished_at, status) select $1, now() - interval '1 hour', now() - interval '1 hour', 'ok' from generate_series(1, 20)`,
    [N],
  );
  await svc();
  const overNew = await errFull('select recognition_begin($1, $2)', [N, [sha()]]);
  await admin();
  const todayCalls = Number(
    (await one(`select count(*) n from identify_calls c where c.started_at >= warsaw_ts(local_today()) and (c.status is distinct from 'failed' or c.charged)`)).n,
  );
  await db.query(`update anti_cheat_params set v = $1 where k = 'identify_global_per_day'`, [todayCalls]);
  await svc();
  const overGlobal = await errFull('select recognition_begin($1, $2)', [Q, [sha()]]);
  await admin();
  await db.exec(`update anti_cheat_params set v = 3000 where k = 'identify_global_per_day'`);
  ok(
    over?.code === 'P0001' && over.message === 'rate_limited' && over.detail.includes('Dzienny limit rozpoznań (60)') &&
      overNew?.message === 'rate_limited' && overNew.detail.includes('Nowe konto') && overNew.detail.includes('20') &&
      overGlobal?.code === 'P0001' && overGlobal.message === 'service_busy' && overGlobal.detail.includes('spróbuj później albo jutro') &&
      /^retry_after=/.test(overGlobal.hint ?? ''),
    'limity: wywołanie, które dotarło do modelu (charged), liczy się także przy błędzie; konto < 24 h – 20 na dobę; globalny limit gry → P0001 service_busy',
    { over, overNew, overGlobal },
  );

  // ── Sprzątanie: przeterminowane → expired (zdjęcie do usunięcia), porzucone pending → usunięte ──
  const expPath = `${P}/rec/${randomUUID()}.jpg`;
  const recOld = await mkRecognition(P, { expiresAt: iso(H), createdAt: iso(73 * H), photoPath: expPath });
  await admin();
  const pend = await one(
    `insert into recognitions (user_id, status, image_sha256, expires_at, created_at) values ($1, 'pending', array[$2], now() + interval '14 days', now() - interval '1 hour') returning id`,
    [P, sha()],
  );
  const oldRejected = await one(
    `insert into recognitions (user_id, status, verdict, image_sha256, expires_at, created_at)
     values ($1, 'rejected', 'not_mushroom', array[$2], now(), now() - interval '31 days') returning id`,
    [P, sha()],
  );
  await svc();
  const cleaned = (await one('select recognition_cleanup(500) r')).r;
  const afterOld = await recRow(recOld);
  const afterPend = Number((await one('select count(*) n from recognitions where id = $1', [pend.id])).n);
  ok(
    cleaned.paths.includes(expPath) && cleaned.paths.includes(`${P}/rec/${pend.id}.jpg`) && afterOld.status === 'expired' &&
      afterOld.photo_path === null && afterOld.image_sha256.length === 1 && afterPend === 0 &&
      cleaned.paths.includes(`${P}/rec/${oldRejected.id}.jpg`) &&
      Number((await one('select count(*) n from recognitions where id = $1', [oldRejected.id])).n) === 0,
    'recognition_cleanup: po terminie → expired (skróty zostają, zdjęcie do usunięcia), porzucone pending i stare odrzucone → usunięte (+ ścieżki plików)',
    cleaned,
  );

  // ── Percentyl: zweryfikowane, k-anonimowość, progi wagi ──
  await admin();
  const G = (await one(`select id from gminy where id not in (select distinct gmina_id from finds) and voivodeship = 'lubuskie' order by id limit 1`)).id;
  const U = [await newUser('rec.p1'), await newUser('rec.p2'), await newUser('rec.p3')];
  const put = (u, w, o = {}) =>
    db.query(
      `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, weight_g, cap_cm, pieces, found_at, claimed_at,
                          visible_from, verified, size_verified)
       values ($1, $2, $3, 'pospolity', 0.9, true, 'claimed', $4, $5::numeric, $6, now(), now(),
               now() - interval '1 minute', $7, $7 and $5::numeric is not null)`,
      [u, o.species ?? 'maslak-zwyczajny', G, w, o.cap ?? null, o.pieces ?? null, o.verified ?? true],
    );
  await put(U[0], 50);
  await put(U[0], 60);
  await put(U[1], 70);
  await put(U[2], 100);
  await put(U[2], 5000, { verified: false });          // niezweryfikowany – poza porównaniem
  await as(Q);
  const pc4 = await call('get_species_percentile', 'maslak-zwyczajny', G, 80);
  await admin();
  await put(U[1], 81);
  await as(Q);
  const pc5 = await call('get_species_percentile', 'maslak-zwyczajny', G, 82);
  const pcHi = await call('get_species_percentile', 'maslak-zwyczajny', G, 9999);
  ok(
    pc4.comparable === false && pc4.collected === 0 && pc4.sizeRank === 1 && pc4.percentile === 100 &&
      pc5.comparable === true && pc5.collected === 5 && pc5.mushroomers === 3 && pc5.biggerCount === 1 && pc5.sizeRank === 2 &&
      pc5.percentile === 60 && pcHi.biggerCount === 0 && pcHi.percentile === 100,
    'percentyl: tylko zweryfikowane; < 5 okazów → brak porównania (kształt „brak danych”, comparable false); 81 g i 82 g w jednym progu (remis) → 1 większy, 60%',
    { pc4, pc5 },
  );

  // ── Rekordy gminy: tylko size_verified, bez kępek ──
  await admin();
  await put(U[0], 140, { cap: 9 });                                  // zmierzony – rekord
  await put(U[1], 300, { cap: 15, pieces: 3 });                      // kępka – nie
  await put(U[2], 400);                                              // niezmierzony – nie
  await as(Q);
  const st = await call('get_gmina_stats', G);
  ok(
    st.records.length === 1 && st.records[0].weightG === 140 && st.records[0].capCm === 9,
    'get_gmina_stats: rekord tylko z okazu zmierzonego (size_verified), pojedynczego – kępka i okaz bez pomiaru pominięte',
    st.records,
  );

  // ── Parytet wymiarów: find_dimensions (SQL) = estimateDimensions (aplikacja) ──
  await admin();
  const diffs = [];
  const sample = app.SPECIES.filter((_, i) => i % 9 === 0);
  for (const s of sample) {
    for (const [cap, height, count] of [[null, null, 1], [s.typical.capCm * 1.4, null, 1], [Math.round(s.typical.capCm * 0.6 * 2) / 2, 7, 1], [null, s.typical.heightCm * 1.5, 1], [s.typical.capCm, s.typical.heightCm, 6], [79, null, 1]]) {
      const capCm = cap == null ? null : Math.round(cap * 2) / 2;
      const heightCm = height == null ? null : Math.round(height * 2) / 2;
      const d = (await one('select find_dimensions($1, $2, $3, $4) d', [s.id, capCm, heightCm, count])).d;
      const e = estimateDimensions(s, { capCm, heightCm, count, maturity: 'mature' });
      const xxl = !s.clustered && isXxl(e.weightG, s.typical.weightG);
      if (d.weight_g !== e.weightG || (d.pieces ?? undefined) !== e.pieces || d.xxl !== xxl ||
          (capCm == null && Number(d.cap_cm) !== e.capCm) || (heightCm == null && Number(d.height_cm) !== e.heightCm)) {
        diffs.push({ id: s.id, capCm, heightCm, count, sql: d, app: { ...e, xxl } });
      }
    }
  }
  ok(diffs.length === 0, `find_dimensions = estimateDimensions z aplikacji (waga, sztuki, XXL, typowe wymiary; ${sample.length} gatunków × 6 przypadków)`, diffs.slice(0, 3));

  // ── Boty deweloperskie: znaleziska jak zweryfikowane ──
  const bot = (await one(`select id from profiles where is_bot order by id limit 1`))?.id;
  if (bot) {
    const bf = await one(
      `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, weight_g, cap_cm, found_at)
       values ($1, 'borowik-szlachetny', 'suprasl', 'rzadki', 0.9, true, 'discarded', 320, 12, now()) returning id, verified, size_verified`,
      [bot],
    );
    await db.query('delete from finds where id = $1', [bf.id]);
    const unverifiedBots = Number((await one(`select count(*) n from finds f join profiles p on p.id = f.user_id where p.is_bot and not f.verified`)).n);
    ok(bf.verified && bf.size_verified && unverifiedBots === 0, 'boty deweloperskie: nowe i dotychczasowe znaleziska zweryfikowane (dane testowe rankingów i rekordów)', bf);
  }

  // ── Eksport i usunięcie konta ──
  const exp = (await one('select export_recognitions($1) e', [P])).e;
  const paths = (await one('select user_storage_paths($1) p', [P])).p['scan-photos'];
  ok(
    Array.isArray(exp) && exp.length >= 5 && exp.some((r) => r.id === b1.recognitionId && r.findId === F1 && r.imageSha256.length === 2) &&
      paths.includes(b1.photoPath),
    'export_recognitions (do eksportu danych) i user_storage_paths ze zdjęciami rozpoznań',
    { n: exp.length },
  );
  await db.query('select wipe_account_data($1)', [P]);
  const left = await one(
    `select (select count(*) from recognitions where user_id = $1) r, (select count(*) from recognition_images where user_id = $1) i`,
    [P],
  );
  await svc();
  const freed = await begin(Q, [H1]);
  await finish(freed, Q, 'failed', null, { charged: false });
  ok(Number(left.r) === 0 && Number(left.i) === 0 && freed.recognitionId, 'wipe_account_data: rozpoznania i skróty zdjęć gracza znikają', left);

  await admin();
  await db.exec(`update gminy set boundary = null where id = 'suprasl'`);
};
