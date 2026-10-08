/**
 * Test schematu bez Dockera: Postgres 17 + PostGIS w WASM (PGlite).
 * Wgrywa supabase/migrations/*.sql + seed.sql na atrapy schematów auth/storage Supabase
 * i przechodzi pętlę z makiety: wyprawa → znalezisko → nagroda → publikacja → feed.
 * Uruchom: npm run db:test
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { postgis } from '@electric-sql/pglite-postgis';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

process.on('uncaughtException', (e) => {
  console.error('✗ błąd:', e.message, e.where ? `(${e.where})` : '');
  process.exit(1);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Definicje z aplikacji (jedno źródło prawdy): osiągnięcia, pula zadań i losowanie – parytet z SQL.
const app = {
  ...(await tsImport('../src/utils/achievements.ts', import.meta.url)),
  ...(await tsImport('../src/utils/quests.ts', import.meta.url)),
  ...(await tsImport('../src/utils/counters.ts', import.meta.url)),
  QUEST_POOL: (await tsImport('../src/data/mock/game.ts', import.meta.url)).QUEST_POOL,
};
const db = await PGlite.create({ extensions: { postgis, citext, unaccent } });

let passed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) {
    console.error('✗', msg, extra ?? '');
    process.exitCode = 1;
    throw new Error(msg);
  }
  passed += 1;
  console.log('✓', msg);
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (uid) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? '']);
  if (uid) await db.exec('set role authenticated');
};
const admin = () => as(null);
const fails = async (sql, params) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
};

// ── Atrapy Supabase: role, auth, storage ──
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; grant usage on schema extensions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), instance_id uuid, aud varchar(255), role varchar(255), email text,
    raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', is_anonymous boolean not null default false,
    created_at timestamptz, updated_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`);

// ── Migracje + seed ──
const migDir = path.join(root, 'supabase', 'migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(migDir, f), 'utf8'));
  console.log('· migracja', f);
}
await db.exec(readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'));
const counts = await one(
  `select (select count(*) from species) sp, (select count(*) from gminy) gm, (select count(*) from badges) b,
          (select count(*) from gminy where forest_region_id is not null and tile_row is not null) game,
          (select count(*) from gminy where teryt is not null and kind is not null and powiat is not null) prg`,
);
ok(
  Number(counts.sp) === 120 && Number(counts.gm) === 2479 && Number(counts.b) === 5 && Number(counts.game) === 38 && Number(counts.prg) === 2479,
  'seed: 120 gatunków, 2479 gmin z PRG (38 z danymi gry zachowane), 5 odznak',
  counts,
);
const supraslRow = await one(`select teryt, kind, powiat, forest_region_id, tile_row from gminy where id = 'suprasl'`);
ok(
  supraslRow.teryt === '2002093' && supraslRow.kind === 'miejsko-wiejska' && supraslRow.powiat === 'białostocki' &&
    supraslRow.forest_region_id === 'puszcza-knyszynska' && supraslRow.tile_row === 3,
  'seed: gmina gry ma dane PRG i zachowany kompleks leśny / pozycję na siatce',
  supraslRow,
);
await db.exec(readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'));
ok(Number((await one('select count(*) n from gminy')).n) === 2479, 'seed jest idempotentny (drugie wgranie)');
ok((await one('select dev_tools_enabled() e')).e === true, 'seed lokalny: dev_tools_enabled() = true');
const ach = await one(
  `select (select count(*) from achievements) a, (select count(*) from achievement_tiers) t,
          (select count(*) from achievement_set_species) m, (select count(*) from achievements where secret) s`,
);
const appTiers = app.ACHIEVEMENTS.reduce((a, d) => a + d.tiers.length, 0);
ok(
  Number(ach.a) === app.ACHIEVEMENTS.length && Number(ach.t) === appTiers && Number(ach.s) === app.ACHIEVEMENTS.filter((d) => d.secret).length &&
    Number(ach.m) > 0 && app.ACHIEVEMENTS.length >= 60 && appTiers >= 220,
  `seed: ${app.ACHIEVEMENTS.length} osiągnięć, ${appTiers} stopni – jak ACHIEVEMENTS w aplikacji`,
  ach,
);
// Zadania z makiety (Zeskanuj 5 · Znajdź rzadki · Przejdź 5 km) zamiast rotacji – dotychczasowe testy przepływu gry
// zakładają stałe zadania dnia. Rotację (quests_for) sprawdza sekcja „Progresja” na końcu (tryb wyłączony).
await db.query("select set_config('app.quests_design', 'on', false)");
// Tak samo słownik osiągnięć: dotychczasowe testy liczą XP z 24 osiągnięć sprzed progresji – nowe (wyprawy, odkrywca,
// pory roku, społeczność…) są tu nieaktywne i włącza je sekcja „Progresja”.
const LEGACY_ACHIEVEMENTS = [
  'kolekcjoner', 'smakosz', 'lowca-rzadkosci', 'epicka-kolekcja', 'legenda-lasu', 'wielka-trojka', 'borowiki-i-spolka',
  'pod-brzoza', 'krolewska-rodzina', 'kurki-i-rydze', 'lesne-dziwy', 'wiosenny-zwiadowca', 'muchomory', 'znam-wroga',
  'spotkanie-ze-smiercia', 'mistrz-sobowtorow', 'pelny-koszyk', 'specjalista', 'znawca', 'okazy-xxl', 'parasol',
  'kilogramowy-borowik', 'diabelski-borowik', 'biala-broda',
];
await db.query('update achievements set active = (id = any($1))', [LEGACY_ACHIEVEMENTS]);

// ── Poziomy (lustro utils/xp.ts) ──
const lv = await one('select * from level_from_total_xp(23140)');
ok(lv.level === 14 && lv.xp_in_level === 2340, 'level_from_total_xp(23140) = Lv 14, 2340 XP');

// ── Użytkownicy (trigger tworzy profil) ──
const kuba = (await one(`insert into auth.users (email, raw_user_meta_data) values ('kuba@example.com', '{"handle":"kuba.grzyb","full_name":"Kuba Nowak","first_name":"Kuba"}') returning id`)).id;
const ola = (await one(`insert into auth.users (email, raw_user_meta_data) values ('ola@example.com', '{"handle":"ola_w","full_name":"Ola W"}') returning id`)).id;
ok((await one('select handle from profiles where id = $1', [kuba])).handle === 'kuba.grzyb', 'nowe konto → profil');

// Stan startowy z makiety: Lv 14 · 2340/3000 · seria 3 dni · 9 borowików w Puszczy Knyszyńskiej.
await db.query(
  `update profiles set total_xp = 23140, level = 14, xp_in_level = 2340, streak_days = 3, last_active_date = local_today(),
          home_gmina_id = 'suprasl', total_distance_m = 196400 where id = $1`,
  [kuba],
);
await db.query(`update profiles set home_gmina_id = 'suprasl' where id = $1`, [ola]);
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, weight_g, claimed_at, found_at)
   select $1, 'borowik-szlachetny', 'suprasl', 'rzadki', 0.95, true, 'claimed', 12, 300, now() - interval '30 days', now() - interval '30 days'
     from generate_series(1, 9)`,
  [kuba],
);
await db.query(
  `insert into user_species (user_id, species_id, count, first_found_at, best_cap_cm, best_weight_g)
   values ($1, 'borowik-szlachetny', 14, now() - interval '1 year', 16, 520)`,
  [kuba],
);
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, xxl, collected, status, cap_cm, weight_g, claimed_at, found_at)
   select $1, 'podgrzybek-brunatny', 'michalowo', 'pospolity', 0.9, true, true, 'claimed', 15, 400, now() - interval '60 days', now() - interval '60 days'
     from generate_series(1, 3)`,
  [kuba],
);
await db.query('select seed_achievements($1)', [kuba]);
const seeded = (await db.query('select achievement_id, tier from user_achievements where user_id = $1 order by 1', [kuba])).rows;
ok(
  JSON.stringify(seeded) === JSON.stringify([{ achievement_id: 'okazy-xxl', tier: 1 }, { achievement_id: 'specjalista', tier: 1 }]) &&
    Number((await one(`select count(*) n from xp_events where user_id = $1`, [kuba])).n) === 0,
  'seed_achievements: zdobyte stopnie (Specjalista, Okazy XXL) bez wypłaty XP',
  seeded,
);

// ── Wyprawa ──
await as(kuba);
const trip = await one(`select * from start_trip('suprasl')`);
ok(trip.status === 'active', 'start_trip → aktywna wyprawa');
ok((await one(`select id from start_trip('suprasl')`)).id === trip.id, 'start_trip jest idempotentny (jedna aktywna wyprawa)');
ok((await one('select streak_days from profiles where id = $1', [kuba])).streak_days === 3, 'seria bez zmian (dziś już aktywny)');

// Edge Function (service role) zapisuje rozpoznanie jako oczekujące znalezisko.
await admin();
const find = (
  await one(
    `insert into finds (user_id, trip_id, species_id, gmina_id, rarity, confidence, xxl, cap_cm, height_cm, weight_g, age_days, collected)
     values ($1, $2, 'borowik-szlachetny', 'suprasl', 'rzadki', 0.96, true, 14, 17, 410, 5, true) returning id`,
    [kuba, trip.id],
  )
).id;

// ── „Odbierz nagrodę” ──
await as(kuba);
const reward = (await one('select claim_find($1) r', [find])).r;
ok(reward.xp.total === 250, 'claim_find: +250 XP (120 + 60 + 40 + 30) jak w makiecie', reward.xp);
ok(
  JSON.stringify(reward.xp.lines.map((l) => l.label)) ===
    JSON.stringify(['Bazowe XP (rzadki)', 'Okaz XXL ×1,5', 'Pierwszy borowik w gminie dziś', 'Seria 3 dni']),
  'claim_find: etykiety rozpiski zgodne z aplikacją',
);
ok(reward.levelBefore === 14 && reward.xpBefore === 2340 && reward.levelAfter === 14 && reward.xpAfter === 2590, 'claim_find: 2340 → 2590 / 3000');
ok(reward.unlockedBadgeIds.includes('krol-puszczy'), 'claim_find: odznaka „Król Puszczy” (10. borowik w Puszczy Knyszyńskiej)');
ok(reward.completedQuestIds.includes('q-rare-1'), 'claim_find: zadanie „Znajdź rzadki gatunek” ukończone');
ok(reward.personalRecord === false, 'claim_find: brak rekordu osobistego (14 cm < 16 cm)');
const prof = await one('select total_xp, level, xp_in_level, mushrooms_count from profiles where id = $1', [kuba]);
ok(prof.level === 14 && prof.xp_in_level === 2740, 'profil: 2740 XP (250 za grzyba + 150 za zadanie)', prof);
ok(JSON.stringify((await one('select claim_find($1) r', [find])).r) === JSON.stringify(reward), 'claim_find jest idempotentny');
ok(
  (await one(`select count from user_species where user_id = $1 and species_id = 'borowik-szlachetny'`, [kuba])).count === 15,
  'atlas: borowik ×15',
);
ok(
  Array.isArray(reward.unlockedAchievements) && reward.unlockedAchievements.length === 0,
  'claim_find: borowik z makiety nie odblokowuje osiągnięć (4. XXL, 15 borowików)',
);

// Gatunek trujący: tylko zdjęcie, nie do koszyka.
await admin();
const poison = (
  await one(
    `insert into finds (user_id, trip_id, species_id, gmina_id, rarity, confidence, cap_cm, weight_g, collected)
     values ($1, $2, 'muchomor-czerwony', 'suprasl', 'pospolity', 0.93, 13, 180, false) returning id`,
    [kuba, trip.id],
  )
).id;
const lowConf = (
  await one(
    `insert into finds (user_id, trip_id, species_id, gmina_id, rarity, confidence, collected)
     values ($1, $2, 'podgrzybek-brunatny', 'suprasl', 'pospolity', 0.48, true) returning id`,
    [kuba, trip.id],
  )
).id;
await as(kuba);
const pr = (await one('select claim_find($1) r', [poison])).r;
ok(pr.xp.total === 70 && pr.xp.lines[0].label.startsWith('Zdjęcie gatunku trującego'), 'trujący: ½ bazy + nowy gatunek = 70 XP', pr.xp);
ok((await fails('select claim_find($1)', [lowConf]))?.includes('low_confidence'), 'niska pewność (<60%) → brak nagrody');

// ── Osiągnięcia ──
// jsonb porządkuje klucze po swojemu – porównujemy pola, nie tekst JSON.
const unlocks = (list) => (list ?? []).map((x) => `${x.id}:${x.tier}:${x.xp}`).join(',');
ok(
  unlocks(pr.unlockedAchievements) === 'znam-wroga:1:50',
  'osiągnięcia: pierwszy gatunek trujący → „Znam wroga” (brąz, +50 XP)',
  pr.unlockedAchievements,
);
const achXp = await one(`select count(*) n, sum(amount) xp, max(ref_id) ref from xp_events where user_id = $1 and source = 'achievement'`, [kuba]);
ok(Number(achXp.n) === 1 && Number(achXp.xp) === 50 && achXp.ref === 'znam-wroga:1', 'osiągnięcia: XP w księdze (źródło achievement, ref „znam-wroga:1”)', achXp);
ok(JSON.stringify((await one('select claim_find($1) r', [poison])).r) === JSON.stringify(pr), 'osiągnięcia: claim_find nadal idempotentny');
ok(
  Number((await one(`select count(*) n from xp_events where user_id = $1 and source = 'achievement'`, [kuba])).n) === 1,
  'osiągnięcia: ponowny claim nie wypłaca XP drugi raz',
);
const progress = (await db.query('select * from achievement_progress()')).rows;
const pKolekcjoner = progress.find((r) => r.achievement_id === 'kolekcjoner');
const pWrog = progress.find((r) => r.achievement_id === 'znam-wroga');
ok(
  progress.length === 24 && Number(pKolekcjoner.value) === 2 && pKolekcjoner.tier === 0 && Number(pKolekcjoner.next_target) === 10 &&
    pWrog.tier === 1 && pWrog.awarded_tier === 1 && Number(pWrog.next_target) === 3,
  'achievement_progress(): postęp własny (Kolekcjoner 2/10, Znam wroga – brąz, dalej 3)',
);
ok((await fails(`insert into user_achievements (user_id, achievement_id, tier) values ($1, 'kolekcjoner', 4)`, [kuba]))?.includes('permission denied'), 'klient nie dopisze sobie osiągnięcia');
ok((await fails('select sync_achievements($1)', [kuba]))?.includes('permission denied'), 'klient nie wywoła sync_achievements');
ok((await fails('select seed_achievements($1)', [kuba]))?.includes('permission denied'), 'klient nie wywoła seed_achievements');
await as(null);
await db.exec('set role anon');
ok((await db.query('select * from achievements')).rows.length === app.ACHIEVEMENTS.length, 'anon czyta słownik osiągnięć');
ok((await fails('select * from achievement_progress()'))?.includes('permission denied'), 'anon nie ma achievement_progress()');
await as(kuba);

// ── RLS i uprawnienia ──
ok((await fails('update profiles set total_xp = 999999 where id = $1', [kuba]))?.includes('permission denied'), 'klient nie może zmienić sobie XP');
await db.query(`update profiles set display_name = 'Kuba N.' where id = $1`, [kuba]);
ok((await one('select display_name from profiles where id = $1', [kuba])).display_name === 'Kuba N.', 'klient może zmienić nazwę');
ok((await fails(`insert into xp_events (user_id, source, amount) values ($1, 'admin', 1000)`, [kuba]))?.includes('permission denied'), 'klient nie dopisze wpisu do księgi XP');
await as(ola);
ok((await db.query('select * from finds')).rows.length === 0, 'RLS: cudze znaleziska niewidoczne');
ok((await db.query('select * from trips')).rows.length === 0, 'RLS: cudze wyprawy niewidoczne');

// ── Dystans → zadanie „Przejdź 5 km” ──
// Etap 7 (anty-cheat): 5,2 km kilka sekund po starcie to > 50 km/h – nie liczy się. Wyprawa z makiety trwa już 30 min
// (5,2 km / 35 min z tolerancją ≈ 8,9 km/h – wiarygodnie).
await admin();
await db.query(`update trips set started_at = started_at - interval '30 minutes' where id = $1`, [trip.id]);
await as(kuba);
await one('select * from report_trip_progress($1, 5200)', [trip.id]);
const kmQuest = await one(`select progress, completed_at from user_quests where user_id = $1 and quest_id = 'q-km-5'`, [kuba]);
ok(Number(kmQuest.progress) === 5 && kmQuest.completed_at, 'report_trip_progress: 5,2 km → zadanie dystansu ukończone');

// ── Zakończenie: ślad prywatny, publiczna trasa uogólniona ──
const track = JSON.stringify({ type: 'LineString', coordinates: [[23.33, 53.21], [23.341, 53.215], [23.352, 53.219], [23.36, 53.226]] });
const done = await one('select * from finish_trip($1, 5200, 11520, $2)', [trip.id, track]);
ok(done.status === 'finished' && done.route_public, 'finish_trip: wyprawa zakończona, trasa uogólniona');
ok((await one('select visible_from from finds where id = $1', [find])).visible_from, 'finish_trip: znaleziska dostają visible_from');
await as(ola);
ok((await db.query('select * from trip_tracks')).rows.length === 0, 'RLS: surowy ślad GPS widzi tylko właściciel');

// ── Publikacja i feed ──
await as(kuba);
const post = await one(`select * from publish_trip($1, false, 'Poranny obchód po deszczu')`, [trip.id]);
ok(post.route_precision === 'approximate' && post.payload.highlight.species === 'Borowik szlachetny', 'publish_trip: wpis z przybliżoną trasą i najlepszym znaleziskiem');
ok(new Date(post.visible_from) > new Date(Date.now() + 23 * 3600e3), 'publish_trip: widoczny dla innych za 24 h');
// get_feed zwraca tablicę jsonb (etap 3) – sprawdzenia jak wcześniej.
const feed = async (scope, before, limit) =>
  (await one('select get_feed($1, $2, $3) f', [scope, before ?? null, limit ?? 20])).f;
const mine = await feed('gmina');
ok(mine.some((p) => p.id === post.id && p.mine), 'autor widzi swój wpis od razu');
await as(ola);
ok(!(await feed('gmina')).some((p) => p.id === post.id), 'inni nie widzą wpisu przed visible_from');
await admin();
await db.query(`update posts set visible_from = now() - interval '1 minute' where id = $1`, [post.id]);
await as(ola);
ok((await feed('gmina')).some((p) => p.id === post.id), 'po 24 h wpis widać w „Moja gmina”');
ok(!(await feed('friends')).some((p) => p.id === post.id), 'bez znajomości wpisu nie ma w „Znajomi”');
await db.query('insert into friendships (friend_id) values ($1)', [kuba]);
await as(kuba);
await db.query(`update friendships set status = 'accepted' where user_id = $1`, [ola]);
await as(ola);
ok((await feed('friends')).some((p) => p.id === post.id), 'po akceptacji znajomości wpis jest w „Znajomi”');
const r1 = await one('select * from toggle_reaction($1)', [post.id]);
const r2 = await one('select * from toggle_reaction($1)', [post.id]);
ok(r1.reacted === true && r1.reactions === 1 && r2.reacted === false && r2.reactions === 0, '„Darz grzyb!” działa jako przełącznik z licznikiem');

// ── Statystyki gminy (tylko agregaty, po visible_from) ──
await admin();
await db.query(`update finds set visible_from = now() - interval '1 hour', found_at = now() - interval '2 days' where id = $1`, [find]);
await as(ola);
const pct = await one(`select * from species_percentile('borowik-szlachetny', 'suprasl', 410)`);
ok(Number(pct.collected) === 1 && Number(pct.mushroomers) === 1, 'species_percentile: agregat z widocznych znalezisk', pct);
const recs = (await db.query(`select * from gmina_records('suprasl')`)).rows;
ok(recs.length === 1 && recs[0].species_name === 'Borowik szlachetny', 'gmina_records: rekord gminy');
await admin();
await db.exec(`update xp_events set created_at = now() - interval '25 hours'`);
await db.exec('select refresh_gmina_rankings()');
const rank = await one(`select * from gmina_rankings where period = 'season' and gmina_id = 'suprasl'`);
ok(rank && rank.rank === 1 && Number(rank.points) > 0, 'refresh_gmina_rankings: ranking sezonu', rank);

// ── GPS → gmina ──
await db.exec(`update gminy set boundary = extensions.st_multi(extensions.st_makeenvelope(23.2, 53.1, 23.5, 53.3, 4326)) where id = 'suprasl'`);
await as(kuba);
ok((await one('select gmina_at(23.33, 53.21) g')).g === 'suprasl', 'gmina_at: punkt GPS → Supraśl');

// ── LEVEL UP → wpis „awansował” ──
await admin();
await db.query(`update profiles set total_xp = 23700, level = 14, xp_in_level = 2900 where id = $1`, [ola]);
await as(ola);
const t2 = await one(`select * from start_trip('suprasl')`);
await admin();
const f2 = (
  await one(
    `insert into finds (user_id, trip_id, species_id, gmina_id, rarity, confidence, collected, cap_cm, weight_g)
     values ($1, $2, 'czubajka-kania', 'suprasl', 'epicki', 0.9, true, 24, 220) returning id`,
    [ola, t2.id],
  )
).id;
await as(ola);
const up = (await one('select claim_find($1) r', [f2])).r;
ok(up.levelAfter === 15 && up.levelBefore === 14, 'LEVEL UP: 14 → 15', up);
ok((await one(`select count(*) n from posts where author_id = $1 and kind = 'levelup'`, [ola])).n === 1, 'LEVEL UP tworzy wpis (z opóźnieniem)');
ok(
  up.unlockedAchievements.some((a) => a.id === 'epicka-kolekcja' && a.tier === 1 && a.xp === 100),
  'osiągnięcia: pierwszy gatunek epicki → „Epicka kolekcja” (brąz)',
  up.unlockedAchievements,
);

// ── Parytet z aplikacją: atlas startowy (START_ATLAS) → te same stopnie co w src/utils/achievements.ts ──
await admin();
const speciesTs = readFileSync(path.join(root, 'src', 'data', 'mock', 'species.ts'), 'utf8');
const startAtlas = [...speciesTs.match(/START_ATLAS[^=]*=\s*\{([\s\S]*?)\}/)[1].matchAll(/'([a-z-]+)':\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]);
const tester = (await one(`insert into auth.users (email, raw_user_meta_data) values ('test@example.com', '{"handle":"tester"}') returning id`)).id;
for (const [id, count] of startAtlas) {
  await db.query('insert into user_species (user_id, species_id, count, first_found_at) values ($1, $2, $3, now())', [tester, id, count]);
}
await db.query(`update user_species set best_cap_cm = 16, best_weight_g = 520 where user_id = $1 and species_id = 'borowik-szlachetny'`, [tester]);
await db.query(`update user_species set best_cap_cm = 27, best_weight_g = 240 where user_id = $1 and species_id = 'czubajka-kania'`, [tester]);
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, xxl, collected, status, claimed_at)
   select $1, 'podgrzybek-brunatny', 'suprasl', 'pospolity', 0.9, true, true, 'claimed', now() from generate_series(1, 3)`,
  [tester],
);
await as(tester);
const tp = (await db.query('select * from achievement_progress()')).rows;
const val = (id) => Number(tp.find((r) => r.achievement_id === id).value);
const earned = tp.reduce((a, r) => a + r.tier, 0);
ok(
  startAtlas.length === 23 && earned === 20 && val('pelny-koszyk') === 318 && val('specjalista') === 86 &&
    val('znawca') === 14 && val('mistrz-sobowtorow') === 3 && val('parasol') === 27,
  'parytet z aplikacją: atlas startowy → 20 / 48 stopni (318 okazów, max 86, 14 gatunków ×5, 3 pary sobowtórów)',
  { earned, n: startAtlas.length },
);

// =============================================================================
// Etap 2 – synchronizacja (outbox): idempotentne RPC z id i czasami z telefonu
// =============================================================================
const err = async (sql, params) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
};
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600e3;
const DAY = 24 * H;
const newUser = async (handle) =>
  (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${handle}@example.com`, JSON.stringify({ handle })])).id;
const startTrip = (gmina, id, startedAt) => one('select * from start_trip($1, $2, $3)', [gmina, id ?? null, startedAt ?? null]);
const submitSql = 'select * from submit_find($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)';
const submitArgs = (o) => [
  o.id,
  o.tripId ?? null,
  o.gminaId ?? 'gromadka',
  o.speciesId ?? 'borowik-szlachetny',
  o.rarity ?? 'rzadki',
  o.confidence ?? 0.96,
  o.xxl ?? false,
  o.dims === null ? null : JSON.stringify(o.dims ?? { cap_cm: 14, height_cm: 17, weight_g: 410, age_days: 5 }),
  JSON.stringify(o.candidates ?? [{ species_id: o.speciesId ?? 'borowik-szlachetny', confidence: o.confidence ?? 0.96 }]),
  o.parts ?? '{cap,underside,stem,base}',
  o.foundAt ?? iso(H),
];
const submit = (o) => one(submitSql, submitArgs(o));
const state = async () => (await one('select get_game_state() s')).s;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

await admin();
const sUser = await newUser('sync.tester');
const today = (await one(`select to_char(local_today(), 'YYYY-MM-DD') d`)).d;
await as(sUser);

// ── start_trip: id i czas z telefonu, idempotentność ──
const T1 = randomUUID();
const start1 = iso(3 * H);
const t1 = await startTrip('gromadka', T1, start1);
ok(
  t1.id === T1 && t1.status === 'active' && t1.gmina_id === 'gromadka' && t1.started_at.getTime() === Date.parse(start1),
  'start_trip: id i started_at z telefonu, gmina spoza mocków (PRG: Gromadka)',
);
const t1again = await startTrip('gromadka', T1, iso(0));
ok(t1again.id === T1 && t1again.started_at.getTime() === Date.parse(start1), 'start_trip z tym samym p_trip_id → ta sama wyprawa bez zmian');
ok((await startTrip('suprasl')).id === T1, 'start_trip bez p_trip_id → zwraca aktywną (stare zachowanie)');
const sProf1 = await one(
  `select streak_days, to_char(last_active_date, 'YYYY-MM-DD') d, to_char(($2::timestamptz at time zone 'Europe/Warsaw')::date, 'YYYY-MM-DD') expected
     from profiles where id = $1`,
  [sUser, start1],
);
ok(sProf1.streak_days === 1 && sProf1.d === sProf1.expected, 'start_trip: seria liczona z daty startu (Europe/Warsaw)', sProf1);

// ── submit_find: idempotentny, walidacja ──
const F1 = randomUUID();
const f1 = await submit({ id: F1, tripId: T1, xxl: true });
ok(
  f1.id === F1 && f1.status === 'pending' && f1.trip_id === T1 && f1.gmina_id === 'gromadka' && f1.collected &&
    Number(f1.cap_cm) === 14 && Number(f1.height_cm) === 17 && f1.weight_g === 410 && f1.age_days === 5 && f1.pieces === null,
  'submit_find: oczekujące znalezisko z wymiarami (FK do gminy z PRG)',
  f1,
);
const f1again = await submit({ id: F1, tripId: T1, speciesId: 'czubajka-kania', confidence: 0.5 });
const scanCount = await one(
  `select (select count(*) from scans where user_id = $1) s, (select count(*) from identifications i join scans s on s.id = i.scan_id where s.user_id = $1) i`,
  [sUser],
);
ok(
  f1again.species_id === 'borowik-szlachetny' && Number(f1again.confidence) === 0.96 && Number(scanCount.s) === 1 && Number(scanCount.i) === 1,
  'submit_find jest idempotentny (ten sam p_find_id → ten sam wiersz, bez nowego skanu)',
  scanCount,
);
const ident = await one(
  `select i.provider, i.model, i.species_id, i.candidates, i.dimensions, s.status, s.parts, s.trip_id
     from finds f join identifications i on i.id = f.identification_id join scans s on s.id = f.scan_id where f.id = $1`,
  [F1],
);
ok(
  ident.provider === 'client-sim' && ident.model === 'mock-v1' && ident.status === 'identified' && ident.trip_id === T1 &&
    ident.parts.length === 4 && ident.candidates[0].species_id === 'borowik-szlachetny' && ident.dimensions.weight_g === 410,
  'submit_find: zapisuje scans (identified) i identifications (client-sim / mock-v1)',
  ident,
);
const F2 = randomUUID();
const sf2 = await submit({ id: F2, tripId: T1, speciesId: 'muchomor-czerwony', rarity: 'pospolity', confidence: 0.93 });
ok(sf2.collected === false, 'submit_find: gatunek trujący → collected = false');
const F3 = randomUUID();
const f3 = await submit({ id: F3, tripId: randomUUID(), speciesId: 'pieprznik-jadalny', rarity: 'pospolity', confidence: 0.9 });
ok(f3.trip_id === null, 'submit_find: wyprawa nieznana serwerowi → trip_id = null');
const F4 = randomUUID();
const f4 = await submit({ id: F4, tripId: t2.id, speciesId: 'maslak-zwyczajny', rarity: 'pospolity', confidence: 0.9 });
ok(f4.trip_id === null, 'submit_find: cudza wyprawa → trip_id = null');
const invalid = [
  [{ speciesId: 'nie-ma-takiego' }, 'unknown_species'],
  [{ gminaId: 'nie-ma-takiej' }, 'unknown_gmina'],
  [{ confidence: 1.5 }, 'invalid_confidence'],
  [{ confidence: -0.1 }, 'invalid_confidence'],
  [{ dims: { cap_cm: 120, weight_g: 400 } }, 'invalid_dimensions'],
  [{ dims: { cap_cm: 12, weight_g: 20000 } }, 'invalid_dimensions'],
  [{ dims: { cap_cm: 3, weight_g: 900, pieces: 500 } }, 'invalid_dimensions'],
  [{ dims: { cap_cm: 'duży' } }, 'invalid_dimensions'],
  [{ foundAt: new Date(Date.now() + H).toISOString() }, 'invalid_found_at'],
  [{ foundAt: iso(20 * DAY) }, 'invalid_found_at'],
  [{ candidates: { species_id: 'x' } }, 'invalid_candidates'],
];
const invalidResults = [];
for (const [o, expected] of invalid) {
  const e = await err(submitSql, submitArgs({ id: randomUUID(), tripId: T1, ...o }));
  invalidResults.push(e && e.code === 'P0001' && e.message.includes(expected) ? 'ok' : `${expected}: ${JSON.stringify(e)}`);
}
ok(invalidResults.every((r) => r === 'ok'), 'submit_find: walidacja → P0001 (gatunek, gmina, pewność, wymiary, kandydaci, found_at)', invalidResults);
ok(
  Number((await one('select count(*) n from finds where user_id = $1', [sUser])).n) === 4,
  'submit_find: odrzucone wywołania nic nie zapisują',
);

// ── claim po submit: wyprawa podpinana automatycznie ──
const rF1 = (await one('select claim_find($1) r', [F1])).r;
const rF3 = (await one('select claim_find($1) r', [F3])).r;
const f3claimed = await one('select trip_id, status from finds where id = $1', [F3]);
ok(rF1.xp.total > 0 && rF3.xp.total > 0 && f3claimed.trip_id === T1 && f3claimed.status === 'claimed', 'claim_find po submit_find: znalezisko bez wyprawy dostaje aktywną', f3claimed);
await one('select * from report_trip_progress($1, 1500)', [T1]);

// ── start_trip z nowym p_trip_id: auto-zamknięcie poprzedniej wyprawy ──
const T2 = randomUUID();
const start2 = iso(H);
const t2s = await startTrip('gromadka', T2, start2);
const t1closed = await one('select * from trips where id = $1', [T1]);
const findsAfter = (await db.query('select id, status, trip_id, visible_from from finds where user_id = $1', [sUser])).rows;
const byId = Object.fromEntries(findsAfter.map((f) => [f.id, f]));
ok(
  t2s.id === T2 && t2s.status === 'active' && t1closed.status === 'finished' && t1closed.ended_at.getTime() === Date.parse(start2) &&
    t1closed.duration_s === 7200 && t1closed.distance_m === 1500,
  'start_trip: inna aktywna wyprawa zamykana (koniec = start nowej, czas 2 h)',
  t1closed,
);
ok(
  byId[F2].status === 'discarded' && byId[F1].visible_from && byId[F1].visible_from.getTime() === Date.parse(start2) + DAY &&
    byId[F4].status === 'pending' && byId[F4].trip_id === null,
  'auto-zamknięcie: oczekujące przepadają, odebrane dostają visible_from (+24 h)',
);
ok((await one('select trips_count from profiles where id = $1', [sUser])).trips_count === 1, 'auto-zamknięcie: licznik wypraw +1');

// ── report_trip_progress / finish_trip po zakończeniu ──
const lateProgress = await one('select * from report_trip_progress($1, 9999)', [T1]);
ok(lateProgress.id === T1 && lateProgress.distance_m === 1500 && lateProgress.status === 'finished', 'report_trip_progress po zakończeniu → wyprawa bez zmian, bez błędu');
const finishAgain = await one('select * from finish_trip($1, 8000, 999, null, $2)', [T1, iso(0)]);
ok(
  finishAgain.status === 'finished' && finishAgain.ended_at.getTime() === Date.parse(start2) && finishAgain.duration_s === 7200 && finishAgain.distance_m === 1500,
  'finish_trip na zakończonej wyprawie → zwraca ją bez zmian (idempotentne)',
);
const end2 = iso(H / 2);
const track2 = JSON.stringify({ type: 'LineString', coordinates: [[15.73, 51.4], [15.74, 51.405], [15.75, 51.41]] });
const t2done = await one('select * from finish_trip($1, 2500, 1800, $2, $3)', [T2, track2, end2]);
ok(
  t2done.status === 'finished' && t2done.ended_at.getTime() === Date.parse(end2) && t2done.duration_s === 1800 && t2done.distance_m === 2500 && t2done.route_public,
  'finish_trip z p_ended_at (offline): czas końca z telefonu, ślad i trasa uogólniona',
);
const t2twice = await one('select * from finish_trip($1, 9000, 1, null, null)', [T2]);
ok(t2twice.ended_at.getTime() === Date.parse(end2) && t2twice.distance_m === 2500 && t2twice.duration_s === 1800, 'finish_trip: ponowne wysłanie nic nie zmienia');
ok((await one('select trips_count from profiles where id = $1', [sUser])).trips_count === 2, 'finish_trip: licznik wypraw liczony raz');

// Czas startu z przyszłości → now(); koniec sprzed startu → przycięty do startu; uszkodzony ślad nie blokuje kolejki.
const T3 = randomUUID();
const before3 = Date.now();
const t3 = await startTrip('suprasl', T3, new Date(Date.now() + 2 * H).toISOString());
ok(t3.started_at.getTime() >= before3 - 1000 && t3.started_at.getTime() <= Date.now() + 1000, 'start_trip: started_at > now()+5 min → now()');
const t3done = await one('select * from finish_trip($1, 10, 60, $2, $3)', [T3, '{"type":"Point","coordinates":[1,2]', iso(5 * H)]);
ok(
  t3done.status === 'finished' && t3done.ended_at.getTime() === t3.started_at.getTime() && !t3done.route_public,
  'finish_trip: p_ended_at sprzed startu → = started_at; uszkodzony ślad pominięty',
);
ok((await err('select * from finish_trip($1, 1, 1)', [randomUUID()]))?.code === 'P0002', 'finish_trip: nieznana wyprawa → P0002');
ok((await err('select * from report_trip_progress($1, 1)', [randomUUID()]))?.code === 'P0002', 'report_trip_progress: nieznana wyprawa → P0002');

// ── discard_find ──
const F5 = randomUUID();
await submit({ id: F5, speciesId: 'kozlarz-babka', rarity: 'pospolity', confidence: 0.9 });
await one('select discard_find($1)', [F5]);
await one('select discard_find($1)', [F5]);
await one('select discard_find($1)', [F1]);
await one('select discard_find($1)', [randomUUID()]);
const disc = await one('select (select status from finds where id = $1) f5, (select status from finds where id = $2) f1', [F5, F1]);
ok(disc.f5 === 'discarded' && disc.f1 === 'claimed', 'discard_find: oczekujące → discarded; odebrane / nieznane / ponowne → bez zmian i bez błędu', disc);

// ── Seria dni: tylko do przodu (spóźniona synchronizacja jej nie cofa) ──
await admin();
const streakUser = await newUser('seria.tester');
await db.query(`update profiles set streak_days = 5, last_active_date = local_today() - 2 where id = $1`, [streakUser]);
await as(streakUser);
const streak = async () => (await one(`select streak_days s, to_char(last_active_date, 'YYYY-MM-DD') d from profiles where id = $1`, [streakUser]));
const SA = randomUUID();
const sa = await startTrip('suprasl', SA, iso(DAY));
const s1 = await streak();
await startTrip('suprasl', randomUUID(), iso(3 * DAY));
const s2 = await streak();
const saClosed = await one('select status, ended_at, duration_s from trips where id = $1', [SA]);
await startTrip('suprasl', randomUUID(), iso(0));
const s3 = await streak();
await admin();
await db.query(`update profiles set last_active_date = local_today() - 3 where id = $1`, [streakUser]);
await as(streakUser);
await startTrip('suprasl', randomUUID(), iso(0));
const s4 = await streak();
ok(s1.s === 6 && s2.s === 6 && s2.d === s1.d && s3.s === 7 && s3.d === today && s4.s === 1, 'seria: +1 dzień po dniu, spóźniony start sprzed ostatniej aktywności jej nie cofa, przerwa → 1', [s1, s2, s3, s4]);
ok(
  saClosed.status === 'finished' && saClosed.ended_at.getTime() === sa.started_at.getTime() && saClosed.duration_s === 0,
  'auto-zamknięcie wyprawy przez starszą (out-of-order): koniec przycięty do startu',
);

// ── get_game_state: kształt i tylko własne dane ──
await as(sUser);
const gs = await state();
const keys = (o) => Object.keys(o).sort().join(',');
ok(
  keys(gs) === 'achievements,atlas,badges,challenges,counters,finds,followedGminy,profile,quests,serverTime,trips,userId' && gs.userId === sUser && ISO_RE.test(gs.serverTime),
  'get_game_state: klucze najwyższego poziomu (etap 4: + challenges, followedGminy)',
  keys(gs),
);
const p = gs.profile;
ok(
  keys(p) ===
    'avatarPath,displayName,firstName,handle,homeGminaId,lastActiveDate,level,mushroomsCount,onboardedAt,streakDays,termsAcceptedAt,termsVersion,totalDistanceM,totalXp,tripsCount,xpInLevel' &&
    p.handle === 'sync.tester' && typeof p.totalXp === 'number' && typeof p.level === 'number' && typeof p.xpInLevel === 'number' &&
    typeof p.totalDistanceM === 'number' && p.totalDistanceM === 4010 && p.tripsCount === 3 && DAY_RE.test(p.lastActiveDate) && p.firstName === null &&
    p.termsVersion === null && p.termsAcceptedAt === null && p.onboardedAt === null,
  'get_game_state: profil (camelCase, liczby jako liczby; etap 5: + avatarPath; etap 6: + termsVersion, termsAcceptedAt, onboardedAt)',
  p,
);
ok(
  gs.atlas.length === 2 && gs.atlas.every((a) => keys(a) === 'bestCapCm,bestWeightG,count,firstFoundAt,speciesId' && typeof a.count === 'number' && ISO_RE.test(a.firstFoundAt)) &&
    gs.atlas.find((a) => a.speciesId === 'borowik-szlachetny').bestCapCm === 14,
  'get_game_state: atlas',
  gs.atlas,
);
ok(Array.isArray(gs.badges) && gs.badges.every((b) => typeof b === 'string') && typeof gs.achievements === 'object' && !Array.isArray(gs.achievements) &&
  Object.values(gs.achievements).every((v) => typeof v === 'number'), 'get_game_state: odznaki (tablica id) i osiągnięcia (id → stopień)');
ok(
  gs.quests.day === today && gs.quests.progress.length === 3 &&
    gs.quests.progress.every((q) => keys(q) === 'completed,progress,questId' && typeof q.progress === 'number' && typeof q.completed === 'boolean') &&
    gs.quests.progress.find((q) => q.questId === 'q-scan-5').progress === 2,
  'get_game_state: zadania dnia (wszystkie aktywne, postęp z dziś)',
  gs.quests,
);
const tripKeys = 'distanceM,durationS,endedAt,gminaId,hideRoute,id,startedAt,status,xp';
ok(
  gs.trips.length === 3 && gs.trips.map((t) => t.id).join() === [T3, T2, T1].join() &&
    gs.trips.every((t) => keys(t) === tripKeys && ISO_RE.test(t.startedAt) && ISO_RE.test(t.endedAt) && typeof t.distanceM === 'number' && typeof t.hideRoute === 'boolean') &&
    gs.trips[2].endedAt === start2 && gs.trips[2].durationS === 7200 && gs.trips[2].xp === rF1.xp.total + rF3.xp.total,
  'get_game_state: wyprawy (od najnowszej, czasy ISO jak Date.toISOString)',
  gs.trips,
);
const findKeys = 'ageDays,capCm,collected,confidence,foundAt,gminaId,heightCm,id,photoPath,pieces,rarity,reward,speciesId,status,tripId,weightG,xp,xxl';
const gf = Object.fromEntries(gs.finds.map((f) => [f.id, f]));
ok(
  keys(gs.finds[0]) === findKeys && gs.finds.length === 3 && gf[F1] && gf[F3] && gf[F4] && !gf[F2] && !gf[F5] &&
    gf[F1].status === 'claimed' && gf[F1].confidence === 0.96 && gf[F1].capCm === 14 && gf[F1].weightG === 410 && gf[F1].xxl === true &&
    gf[F1].xp === rF1.xp.total && gf[F1].reward.xp.total === rF1.xp.total && gf[F4].status === 'pending' && gf[F4].tripId === null &&
    gf[F4].reward === null && gf[F4].pieces === null,
  'get_game_state: znaleziska (oczekujące i odebrane, bez odrzuconych; reward jak z claim_find)',
  gs.finds.map((f) => [f.id === F1 ? 'F1' : f.id === F3 ? 'F3' : f.id === F4 ? 'F4' : f.id, f.status]),
);
await as(ola);
const olaState = await state();
ok(
  olaState.userId === ola && !olaState.trips.some((t) => [T1, T2, T3].includes(t.id)) && !olaState.finds.some((f) => [F1, F3, F4].includes(f.id)),
  'get_game_state: inny gracz widzi tylko swoje dane',
);
const freshUser = await (async () => {
  await admin();
  return newUser('nowy.gracz');
})();
await as(freshUser);
const fresh = await state();
ok(
  Array.isArray(fresh.atlas) && fresh.atlas.length === 0 && Array.isArray(fresh.badges) && fresh.badges.length === 0 &&
    JSON.stringify(fresh.achievements) === '{}' && fresh.trips.length === 0 && fresh.finds.length === 0 &&
    JSON.stringify(fresh.challenges) === '[]' && JSON.stringify(fresh.followedGminy) === '[]' &&
    fresh.profile.level === 1 && fresh.profile.lastActiveDate === null && fresh.quests.progress.every((q) => q.progress === 0 && !q.completed),
  'get_game_state: nowy gracz → puste tablice / obiekt (nigdy null)',
);

// ── Cudze dane przez nowe RPC ──
await as(ola);
const foreign = [
  (await err('select * from start_trip($1, $2, null)', ['suprasl', T1]))?.message.includes('trip_id_conflict'),
  (await err('select * from report_trip_progress($1, 99999)', [T2]))?.code === 'P0002',
  (await err('select * from finish_trip($1, 1, 1)', [T3]))?.code === 'P0002',
  (await err(submitSql, submitArgs({ id: F4, tripId: null })))?.message.includes('find_id_conflict'),
  (await err('select claim_find($1)', [F4]))?.code === 'P0002',
];
await one('select discard_find($1)', [F4]);
await as(sUser);
const untouched = await one(
  `select (select status from finds where id = $1) f4, (select distance_m from trips where id = $2) d2`,
  [F4, T2],
);
ok(
  foreign.every(Boolean) && untouched.f4 === 'pending' && untouched.d2 === 2500,
  'inny gracz nie zmieni cudzej wyprawy ani znaleziska (start/progress/finish/submit/claim/discard)',
  { foreign, untouched },
);
ok((await err('select close_trip($1, now())', [T2]))?.message.includes('permission denied'), 'klient nie wywoła close_trip');
ok((await err('select wipe_game_data($1)', [sUser]))?.message.includes('permission denied'), 'klient nie wywoła wipe_game_data');
ok((await err('select * from app_config'))?.message.includes('permission denied'), 'klient nie czyta app_config');
ok((await err(`insert into app_config (key, value) values ('dev_tools', 'true')`))?.message.includes('permission denied'), 'klient nie włączy sobie dev_tools');
await as(null);
await db.exec('set role anon');
ok((await err('select get_game_state()'))?.message.includes('permission denied'), 'anon nie ma get_game_state()');
ok((await err(`select * from start_trip('suprasl')`))?.message.includes('permission denied'), 'anon nie ma start_trip()');

// ── dev_import_state / dev_reset_player ──
await admin();
const k2 = await newUser('kuba2');
await db.exec(`update app_config set value = 'false' where key = 'dev_tools'`);
await as(k2);
const importBody = {
  profile: {
    displayName: 'Kuba Nowak', firstName: 'Kuba', handle: '@kuba2.grzyb', homeGminaId: 'suprasl',
    level: 14, xpInLevel: 2340, streakDays: 3, tripsCount: 42, mushroomsCount: 318,
  },
  atlas: startAtlas.map(([speciesId, count]) => ({
    speciesId,
    count,
    firstFoundAt: '2025-09-01T08:00:00.000Z',
    bestCapCm: speciesId === 'borowik-szlachetny' ? 16 : speciesId === 'czubajka-kania' ? 27 : null,
    bestWeightG: speciesId === 'borowik-szlachetny' ? 520 : speciesId === 'czubajka-kania' ? 240 : null,
  })).concat([{ speciesId: 'nie-ma-takiego', count: 1 }]),
  badges: ['ranny-ptaszek', 'km-100', 'seria-7', 'nie-ma-takiej'],
};
const disabledImport = await err('select dev_import_state($1)', [JSON.stringify(importBody)]);
const disabledReset = await err('select dev_reset_player()');
ok(
  disabledImport?.code === 'P0001' && disabledImport.message.includes('dev_tools_disabled') && disabledReset?.message.includes('dev_tools_disabled') &&
    (await one('select dev_tools_enabled() e')).e === false,
  'dev_import_state / dev_reset_player bez app_config.dev_tools → P0001 dev_tools_disabled',
);
await admin();
await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
await as(k2);
const imported = (await one('select dev_import_state($1) s', [JSON.stringify(importBody)])).s;
const ip = imported.profile;
ok(
  ip.level === 14 && ip.xpInLevel === 2340 && ip.totalXp === 23140 && ip.handle === 'kuba2.grzyb' && ip.displayName === 'Kuba Nowak' &&
    ip.firstName === 'Kuba' && ip.homeGminaId === 'suprasl' && ip.streakDays === 3 && ip.tripsCount === 42 && ip.mushroomsCount === 318 &&
    ip.lastActiveDate === today,
  'dev_import_state: profil – Lv 14 · 2340 XP (23 140 łącznie), nick bez „@”, liczniki, ostatnia aktywność = dziś',
  ip,
);
const borowikImported = imported.atlas.find((a) => a.speciesId === 'borowik-szlachetny');
ok(
  imported.atlas.length === 23 && borowikImported.count === 14 && borowikImported.bestCapCm === 16 && borowikImported.firstFoundAt === '2025-09-01T08:00:00.000Z' &&
    imported.badges.slice().sort().join() === 'km-100,ranny-ptaszek,seria-7',
  'dev_import_state: atlas (23 gatunki) i odznaki; nieznane id pominięte',
);
await admin();
const k2xp = (await db.query('select source, amount from xp_events where user_id = $1', [k2])).rows;
const xxlAt3 = (await one(`select achievement_reached_tier('okazy-xxl', 3) n`)).n;
const k2ach = await one('select coalesce(sum(tier), 0)::int n from user_achievements where user_id = $1', [k2]);
await as(k2);
const k2reached = (await db.query('select * from achievement_progress()')).rows;
const reachedSum = k2reached.reduce((a, r) => a + r.tier, 0);
const awardedSum = k2reached.reduce((a, r) => a + r.awarded_tier, 0);
ok(
  k2xp.length === 1 && k2xp[0].source === 'import' && k2xp[0].amount === 23140 &&
    k2ach.n === awardedSum && awardedSum === reachedSum && reachedSum === 20 - xxlAt3 &&
    Object.values(imported.achievements).reduce((a, b) => a + b, 0) === awardedSum,
  `dev_import_state: osiągnięcia z atlasu nagrodzone bez XP (${awardedSum} stopni), w księdze jeden wpis „import”`,
  { k2xp, awardedSum, reachedSum, xxlAt3 },
);

// Mock-loop na serwerze: import stanu z makiety → start → submit → claim = ta sama rozpiska 250 XP i „Król Puszczy”.
await admin();
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, cap_cm, weight_g, claimed_at, found_at)
   select $1, 'borowik-szlachetny', 'suprasl', 'rzadki', 0.95, true, 'claimed', 12, 300, now() - interval '30 days', now() - interval '30 days'
     from generate_series(1, 9)`,
  [k2],
);
await as(k2);
const TK = randomUUID();
await startTrip('suprasl', TK, iso(H));
const FK = randomUUID();
await submit({ id: FK, tripId: TK, gminaId: 'suprasl', xxl: true, foundAt: iso(H / 2) });
const rK = (await one('select claim_find($1) r', [FK])).r;
ok(
  rK.xp.total === 250 &&
    JSON.stringify(rK.xp.lines) === JSON.stringify(reward.xp.lines) &&
    rK.levelBefore === 14 && rK.xpBefore === 2340 && rK.levelAfter === 14 && rK.xpAfter === 2590 &&
    rK.unlockedBadgeIds.includes('krol-puszczy') && rK.completedQuestIds.includes('q-rare-1') && rK.personalRecord === false,
  'import + start_trip + submit_find + claim_find → 250 XP i „Król Puszczy” jak w pętli z makiety',
  rK,
);

// Import z poziomem 15 i XP ponad próg poziomu (przycięte), zajęty nick → zostaje obecny.
await as(freshUser);
const imp15 = (await one('select dev_import_state($1) s', [JSON.stringify({ profile: { level: 15, xpInLevel: 100, handle: '@kuba.grzyb' } })])).s;
const imp2 = (await one('select dev_import_state($1) s', [JSON.stringify({ profile: { level: 2, xpInLevel: 99999 } })])).s;
ok(
  imp15.profile.level === 15 && imp15.profile.xpInLevel === 100 && imp15.profile.totalXp === 23900 && imp15.profile.handle === 'nowy.gracz' &&
    imp2.profile.level === 2 && imp2.profile.xpInLevel === 599 && imp2.profile.totalXp === 999,
  'dev_import_state: krzywa poziomów (Lv 15 · 100 XP = 23 900), XP przycięte do progu, zajęty nick bez zmian',
  [imp15.profile, imp2.profile],
);

// Reset gracza
await as(k2);
const reset = (await one('select dev_reset_player() s')).s;
await admin();
const k2left = await one(
  `select (select count(*) from xp_events where user_id = $1) xp, (select count(*) from finds where user_id = $1) f,
          (select count(*) from scans where user_id = $1) s, (select count(*) from trips where user_id = $1) t,
          (select count(*) from user_quests where user_id = $1) q, (select count(*) from posts where author_id = $1) p`,
  [k2],
);
ok(
  reset.profile.level === 1 && reset.profile.xpInLevel === 0 && reset.profile.totalXp === 0 && reset.profile.streakDays === 0 &&
    reset.profile.tripsCount === 0 && reset.profile.mushroomsCount === 0 && reset.profile.totalDistanceM === 0 && reset.profile.lastActiveDate === null &&
    reset.profile.handle === 'kuba2.grzyb' && reset.profile.displayName === 'Kuba Nowak' && reset.profile.homeGminaId === 'suprasl' &&
    reset.atlas.length === 0 && reset.badges.length === 0 && JSON.stringify(reset.achievements) === '{}' && reset.trips.length === 0 && reset.finds.length === 0 &&
    Object.values(k2left).every((n) => Number(n) === 0),
  'dev_reset_player: świeży gracz Lv 1 (nick, imię i gmina domowa zostają), dane gry skasowane',
  { profile: reset.profile, k2left },
);
await admin();
ok(
  Number((await one('select count(*) n from finds where user_id = $1', [sUser])).n) === 5 &&
    Number((await one('select count(*) n from trips where user_id = $1', [sUser])).n) === 3,
  'dev_import_state / dev_reset_player nie ruszają danych innych graczy',
);

// =============================================================================
// Etap 3 – feed, znajomi, aktywność (jsonb camelCase), boty deweloperskie
// =============================================================================
const call = async (fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await one(`select ${fn}(${ph}) r`, args)).r;
};
const code = async (fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return err(`select ${fn}(${ph})`, args);
};
const ids = (list) => list.map((x) => x.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTHOR_KEYS = 'avatarPath,avatarPreset,handle,id,level,name,ringRarity';
// etap 6: + blocked (czy wywołujący zablokował tego gracza)
const SOCIAL_KEYS = 'avatarPath,avatarPreset,blocked,friendStatus,handle,homeGminaId,id,level,mushroomsCount,name,ringRarity,tripsCount';

await admin();
const mkUser = async (handle, name, firstName, gmina, trips = 0) => {
  const id = await newUser(handle);
  await db.query('update profiles set display_name = $2, first_name = $3, home_gmina_id = $4, trips_count = $5 where id = $1', [
    id, name, firstName, gmina, trips,
  ]);
  return id;
};
const A = await mkUser('anna.las', 'Anna Las', 'Anna', 'michalowo', 3);
const B = await mkUser('lukasz.test', 'Łukasz_Testowy', 'Łukasz', 'michalowo', 9);
const C = await mkUser('cezary.c', 'Cezary', 'Cezary', 'hajnowka', 1);
const D = await mkUser('dorota.d', 'Dorota', null, null, 0);
const E = await mkUser('edek.e', 'Edek', 'Edward', 'michalowo', 5);
// B: odebrane epicki + rzadki, oczekujące legendarne (nie liczy się do obwódki), 2 gatunki w atlasie.
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, claimed_at) values
     ($1, 'czubajka-kania', 'michalowo', 'epicki', 0.9, true, 'claimed', now()),
     ($1, 'borowik-szlachetny', 'michalowo', 'rzadki', 0.9, true, 'claimed', now()),
     ($1, 'szmaciak-galezisty', 'michalowo', 'legendarny', 0.9, true, 'pending', null)`,
  [B],
);
await db.query(
  `insert into user_species (user_id, species_id, count, first_found_at) values ($1, 'czubajka-kania', 1, now()), ($1, 'borowik-szlachetny', 1, now())`,
  [B],
);
const insPost = async (author, gmina, createdAgoH, visibleInH, deleted = false) =>
  (
    await one(
      `insert into posts (author_id, kind, gmina_id, payload, created_at, published_at, visible_from, deleted_at)
       values ($1, 'trip', $2, '{"title":"Test","distance_km":2.5,"route":null}', now() - make_interval(hours => $3),
               now() - make_interval(hours => $3), now() + make_interval(hours => $4), case when $5 then now() end) returning id`,
      [author, gmina, createdAgoH, visibleInH, deleted],
    )
  ).id;
const PB1 = await insPost(B, 'michalowo', 30, -6);
const PB2 = await insPost(B, 'michalowo', 1, 23);
const PB3 = await insPost(B, 'michalowo', 40, -16, true);
const PB4 = await insPost(B, 'suprasl', 50, -26);
const PC1 = await insPost(C, 'hajnowka', 20, -1);

// ── Profil: avatar ──
await as(A);
await db.query(`update profiles set avatar_preset = 'sowa' where id = $1`, [A]);
ok((await one('select avatar_preset a from profiles where id = $1', [A])).a === 'sowa', 'profil: klient ustawia avatar_preset (gotowy avatar)');
ok((await err(`update profiles set avatar_preset = 'Zły avatar!' where id = $1`, [A]))?.message.includes('check'), 'profil: avatar_preset spoza ^[a-z0-9-]{1,32}$ odrzucony');
ok((await err('update profiles set is_bot = true where id = $1', [A]))?.message.includes('permission denied'), 'profil: klient nie zmieni is_bot');

// ── publish_trip bez śladu GPS ──
const TA = randomUUID();
await startTrip('michalowo', TA, iso(2 * H));
await one('select * from finish_trip($1, 1200, 3600, null, null)', [TA]);
const pa = await one(`select * from publish_trip($1, false, 'Pierwsze podgrzybki')`, [TA]);
ok(
  pa.route_precision === 'gmina' && pa.payload.route === null && pa.payload.title === 'Pierwsze podgrzybki' && pa.payload.highlight === null &&
    new Date(pa.visible_from) > new Date(Date.now() + 23 * H),
  'publish_trip bez śladu GPS: route = null, precyzja „gmina”, widoczny za 24 h',
  pa,
);
ok((await one(`select * from publish_trip($1, true, 'inny tytuł')`, [TA])).id === pa.id, 'publish_trip: ponowne wywołanie → ten sam wpis');
const PA = pa.id;

// ── get_feed: zakresy, widoczność, kształt ──
const fA = await feed('friends');
ok(ids(fA).includes(PA) && !ids(fA).includes(PB1), 'get_feed friends: własny wpis od razu, cudzy bez znajomości – nie');
const gA = await feed('gmina');
ok(
  JSON.stringify(ids(gA).filter((id) => [PA, PB1, PB2, PB3, PB4, PC1].includes(id))) === JSON.stringify([PA, PB1]),
  'get_feed gmina: wpisy z gminy domowej od najnowszego; bez niewidocznych (24 h), usuniętych i z innych gmin',
  ids(gA),
);
const itA = gA.find((p) => p.id === PA);
const itB = gA.find((p) => p.id === PB1);
ok(
  keys(itA) === 'author,comments,coverPath,createdAt,gminaId,id,kind,mine,payload,publishedAt,reacted,reactions,routePrecision,tripId,visibleFrom' &&
    keys(itA.author) === AUTHOR_KEYS && itA.kind === 'trip' && itA.mine === true && itA.tripId === TA && itA.gminaId === 'michalowo' &&
    itA.routePrecision === 'gmina' && itA.reactions === 0 && itA.comments === 0 && itA.reacted === false && ISO_RE.test(itA.createdAt) &&
    ISO_RE.test(itA.publishedAt) && ISO_RE.test(itA.visibleFrom) && itA.payload.title === 'Pierwsze podgrzybki',
  'get_feed: kształt wpisu (camelCase, czasy ISO, payload jak zapisany)',
  itA,
);
ok(
  itA.author.id === A && itA.author.handle === 'anna.las' && itA.author.name === 'Anna Las' && itA.author.avatarPreset === 'sowa' &&
    itA.author.ringRarity === 'primary' && itB.author.ringRarity === 'epicki' && itB.author.name === 'Łukasz_Testowy' && itB.mine === false,
  'autor: nick bez „@”, nazwa, avatar; ringRarity = najrzadsze ODEBRANE znalezisko (oczekujące się nie liczy), brak → primary',
  [itA.author, itB.author],
);
const page1 = await feed('gmina', null, 1);
const page2 = await feed('gmina', page1[0].createdAt, 1);
ok(page1.length === 1 && page1[0].id === PA && page2.length === 1 && page2[0].id === PB1, 'get_feed: p_limit i stronicowanie p_before');
ok((await err(`select get_feed('wszystko')`))?.code === 'P0001', 'get_feed: nieznany zakres → P0001');
await as(D);
ok(JSON.stringify(await feed('gmina')) === '[]', 'get_feed gmina bez gminy domowej → []');
await as(B);
ok(!ids(await feed('gmina')).includes(PA), 'get_feed: cudzy wpis przed visible_from niewidoczny');
ok(ids(await feed('gmina')).includes(PB2), 'get_feed: własny wpis przed visible_from widoczny');

// ── get_post, reakcja na niewidoczny wpis ──
ok((await code('get_post', PA))?.code === 'P0002' && (await code('get_post', PB3))?.code === 'P0002', 'get_post: niewidoczny / usunięty (także własny) → P0002');
ok((await code('toggle_reaction', PA))?.code === 'P0002', 'toggle_reaction na niewidocznym wpisie → P0002');
ok(!!(await err('insert into post_reactions (post_id) values ($1)', [PA])), 'RLS: bezpośrednia reakcja na niewidoczny wpis odrzucona');
await as(A);
const gp = await call('get_post', PB1);
ok(gp.id === PB1 && gp.author.id === B && gp.mine === false, 'get_post: widoczny wpis');

// ── Znajomi: zaproszenie → akceptacja ──
ok((await call('send_friend_request', B)) === 'outgoing' && (await call('send_friend_request', B)) === 'outgoing', 'send_friend_request → outgoing (ponownie bez zmian)');
const aFriends0 = await call('get_friends');
ok(
  keys(aFriends0) === 'friends,incoming,outgoing' && aFriends0.outgoing.length === 1 && aFriends0.outgoing[0].id === B &&
    aFriends0.outgoing[0].friendStatus === 'outgoing' && keys(aFriends0.outgoing[0]) === SOCIAL_KEYS && aFriends0.friends.length === 0,
  'get_friends: wysłane zaproszenie w „outgoing” (social user)',
  aFriends0,
);
await as(B);
const bFriends0 = await call('get_friends');
ok(bFriends0.incoming.length === 1 && bFriends0.incoming[0].id === A && bFriends0.incoming[0].friendStatus === 'incoming', 'get_friends: zaproszony widzi je w „incoming”');
const bAct0 = await call('get_activity');
const reqItem = bAct0.find((x) => x.id === `friend_request:${A}`);
ok(
  reqItem && reqItem.kind === 'friend_request' && reqItem.actor.id === A && keys(reqItem.actor) === AUTHOR_KEYS && reqItem.postId === null &&
    reqItem.text === null && ISO_RE.test(reqItem.createdAt) && keys(reqItem) === 'actor,createdAt,id,kind,postId,text',
  'get_activity: zaproszenie (friend_request:<userId>)',
  reqItem,
);
// RLS: nikt nie zaakceptuje za zaproszonego.
await as(C);
const cUpd = await db.query(`update friendships set status = 'accepted' where user_id = $1 and friend_id = $2`, [A, B]);
const cSee = (await db.query('select * from friendships where user_id = $1', [A])).rows.length;
const cResp = await call('respond_friend_request', A, true);
await as(A);
const aUpd = await db.query(`update friendships set status = 'accepted' where user_id = $1 and friend_id = $2`, [A, B]);
await admin();
ok(
  cUpd.affectedRows === 0 && cSee === 0 && cResp === 'none' && aUpd.affectedRows === 0 &&
    (await one('select status from friendships where user_id = $1 and friend_id = $2', [A, B])).status === 'pending',
  'RLS: obcy ani zapraszający nie zaakceptują zaproszenia (UPDATE / respond_friend_request)',
);
await as(B);
ok((await call('respond_friend_request', A, true)) === 'friends', 'respond_friend_request(accept) → friends');
await admin();
ok(!!(await one('select accepted_at from friendships where user_id = $1 and friend_id = $2', [A, B])).accepted_at, 'akceptacja ustawia accepted_at');
await as(B);
ok(!!(await err('insert into friendships (friend_id) values ($1)', [A])), 'jedna relacja na parę (B→A przy istniejącym A→B odrzucone)');
await as(A);
ok((await call('send_friend_request', B)) === 'friends', 'send_friend_request do znajomego → friends');
const fA2 = ids(await feed('friends'));
ok(fA2.includes(PB1) && fA2.includes(PB4) && !fA2.includes(PB2) && !fA2.includes(PB3), 'get_feed friends po akceptacji: wpisy znajomego (widoczne, nieusunięte)');
// Wzajemne zaproszenie = akceptacja.
await as(C);
ok((await call('send_friend_request', A)) === 'outgoing', 'C zaprasza A → outgoing');
await as(A);
ok((await call('send_friend_request', C)) === 'friends', 'A zaprasza C, gdy C już zaprosił A → automatyczna akceptacja (friends)');
await admin();
ok(
  Number((await one('select count(*) n from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)', [A, C])).n) === 1,
  'wzajemne zaproszenie: jeden wiersz w friendships',
);
// Odrzucenie, anulowanie, usunięcie.
await as(D);
await call('send_friend_request', A);
await as(A);
ok((await call('respond_friend_request', D, false)) === 'none' && (await call('respond_friend_request', D, true)) === 'none', 'odrzucenie → none; odpowiedź bez zaproszenia → obecny status');
ok((await call('send_friend_request', D)) === 'outgoing', 'A zaprasza D');
await call('remove_friend', D);
await call('remove_friend', C);
ok((await call('get_user', D)).friendStatus === 'none' && (await call('get_user', C)).friendStatus === 'none', 'remove_friend: anuluje wysłane zaproszenie i usuwa znajomość');
ok((await code('send_friend_request', A))?.message.includes('invalid_user') && (await code('send_friend_request', randomUUID()))?.code === 'P0002', 'send_friend_request: do siebie → P0001 invalid_user, nieznany → P0002');

// ── Komentarze ──
await admin();
await db.query(`update posts set visible_from = now() - interval '1 minute' where id = $1`, [PA]);
await as(B);
const CID = randomUUID();
const c1 = await call('add_comment', PA, '  Darz grzyb!  ', CID);
const c1b = await call('add_comment', PA, 'inny tekst', CID);
ok(
  keys(c1) === 'author,createdAt,id,mine,postId,text' && c1.id === CID && c1.text === 'Darz grzyb!' && c1.mine === true && c1.postId === PA &&
    c1.author.id === B && keys(c1.author) === AUTHOR_KEYS && ISO_RE.test(c1.createdAt) && c1b.id === CID && c1b.text === 'Darz grzyb!',
  'add_comment: tekst obcięty, kształt komentarza; ponowienie z tym samym id → ten sam komentarz',
  c1,
);
await admin();
ok((await one('select comments_count n from posts where id = $1', [PA])).n === 1, 'add_comment idempotentny: licznik komentarzy 1');
await as(B);
const bad = [await code('add_comment', PA, '   '), await code('add_comment', PA, 'x'.repeat(281))];
ok(bad.every((e) => e?.code === 'P0001' && e.message.includes('invalid_comment')), 'add_comment: pusty / > 280 znaków → P0001 invalid_comment');
const c280 = await call('add_comment', PA, 'x'.repeat(280));
ok(c280.text.length === 280, 'add_comment: 280 znaków przechodzi');
await call('delete_comment', c280.id);
await as(C);
ok((await code('add_comment', PB2, 'hej'))?.code === 'P0002' && (await code('get_comments', PB2))?.code === 'P0002', 'add_comment / get_comments pod niewidocznym wpisem → P0002');
await as(A);
const c2 = await call('add_comment', PA, 'Dzięki! Jutro znowu idę.');
ok((await code('add_comment', PA, 'x', CID))?.message.includes('comment_id_conflict'), 'add_comment z cudzym p_comment_id → P0001 comment_id_conflict');
const cmA = await call('get_comments', PA);
ok(
  JSON.stringify(cmA.map((c) => [c.id, c.mine])) === JSON.stringify([[CID, false], [c2.id, true]]),
  'get_comments: od najstarszego, „mine” z perspektywy wywołującego',
  cmA,
);
await call('delete_comment', CID);
ok((await call('get_comments', PA)).length === 2, 'delete_comment: cudzy komentarz → nic');
await as(B);
await call('delete_comment', CID);
await call('delete_comment', CID);
await call('delete_comment', randomUUID());
await admin();
ok(
  !(await one('select 1 x from post_comments where id = $1', [CID])) && (await one('select comments_count n from posts where id = $1', [PA])).n === 1,
  'delete_comment: własny usunięty, ponownie / nieistniejący → bez błędu',
);

// ── Reakcje i aktywność ──
await sleep(5);
const since = (await one('select clock_timestamp() t')).t;
await sleep(5);
await as(B);
const rB = await one('select * from toggle_reaction($1)', [PA]);
const c3 = await call('add_comment', PA, 'Piękne zbiory, gratulacje!');
const cLong = await call('add_comment', PA, 'Długi komentarz o grzybach '.repeat(9));
await as(A);
const rA = await one('select * from toggle_reaction($1)', [PA]);
ok(rB.reacted === true && rB.reactions === 1 && rA.reacted === true && rA.reactions === 2, 'toggle_reaction po visible_from: działa (także autor)');
const act = await call('get_activity');
const actIds = ids(act);
const cItem = act.find((x) => x.id === `comment:${c3.id}`);
const longItem = act.find((x) => x.id === `comment:${cLong.id}`);
ok(
  actIds.includes(`reaction:${PA}:${B}`) && !actIds.includes(`reaction:${PA}:${A}`) && cItem?.kind === 'comment' && cItem.postId === PA &&
    cItem.text === 'Piękne zbiory, gratulacje!' && cItem.actor.id === B && !actIds.includes(`comment:${c2.id}`) &&
    actIds.includes(`friend_accepted:${B}`) && act.find((x) => x.id === `friend_accepted:${B}`).kind === 'friend_accepted',
  'get_activity: reakcje i komentarze innych pod moimi wpisami, przyjęte zaproszenie; bez moich własnych akcji',
  actIds,
);
ok(longItem.text.length === 120 && longItem.text.endsWith('…'), 'get_activity: treść komentarza skrócona do 120 znaków');
ok(act.every((x, i) => i === 0 || x.createdAt <= act[i - 1].createdAt), 'get_activity: od najnowszego');
const actSince = await call('get_activity', since, 50);
ok(
  ids(actSince).sort().join() === [`reaction:${PA}:${B}`, `comment:${c3.id}`, `comment:${cLong.id}`].sort().join(),
  'get_activity(p_since): tylko nowsze',
  ids(actSince),
);
ok((await call('get_activity', null, 1)).length === 1, 'get_activity: p_limit');

// ── Ukrywanie ──
await call('hide_post', PB1);
await call('hide_post', PB1);
ok(!ids(await feed('gmina')).includes(PB1) && !ids(await feed('friends')).includes(PB1), 'hide_post: wpis znika z feedu (idempotentnie)');
await call('hide_post', PB4);
const hidden = await call('get_hidden_posts');
ok(JSON.stringify(ids(hidden)) === JSON.stringify([PB4, PB1]) && hidden[0].author.id === B, 'get_hidden_posts: ukryte wpisy (od ostatnio ukrytego)');
await call('unhide_posts', [PB1]);
ok(ids(await feed('gmina')).includes(PB1) && JSON.stringify(ids(await call('get_hidden_posts'))) === JSON.stringify([PB4]), 'unhide_posts([id]): wpis wraca');
await call('unhide_posts', null);
ok((await call('get_hidden_posts')).length === 0, 'unhide_posts(null): wszystkie wracają');
ok((await code('hide_post', PB2))?.code === 'P0002', 'hide_post niewidocznego wpisu → P0002');
await call('hide_post', PB1);
ok((await db.query('select * from post_hides')).rows.length === 1, 'RLS: gracz widzi swoje ukryte wpisy');
await as(C);
ok((await db.query('select * from post_hides')).rows.length === 0, 'RLS: cudzych ukrytych wpisów nie widać');
ok((await err('insert into post_hides (user_id, post_id) values ($1, $2)', [C, PB1]))?.message.includes('permission denied'), 'post_hides: zapis tylko przez RPC');

// ── Zgłoszenia ──
await call('report_post', PA);
await call('report_post', PA);
await call('report_post', PA, c3.id, ' spam ');
await call('report_post', PA, c3.id, 'inny powód');
const badReports = [
  await code('report_post', PA, null, 'x'.repeat(501)),
  await code('report_post', PA, randomUUID(), null),
  await code('report_post', PB2, null, null),
];
await admin();
const reps = (await db.query('select comment_id, reason from post_reports where reporter_id = $1 order by created_at', [C])).rows;
ok(reps.length === 2 && reps[0].comment_id === null && reps[1].comment_id === c3.id && reps[1].reason === 'spam', 'report_post: idempotentny (wpis i komentarz osobno, powód obcięty)', reps);
ok(
  badReports[0]?.code === 'P0001' && badReports[0].message.includes('invalid_reason') && badReports[1]?.code === 'P0002' && badReports[2]?.code === 'P0002',
  'report_post: powód > 500 → P0001, komentarz spoza wpisu / niewidoczny wpis → P0002',
);
await as(C);
ok((await err('select * from post_reports'))?.message.includes('permission denied'), 'RLS: zgłoszeń nie czyta żaden klient');
ok((await err('insert into post_reports (post_id, reporter_id) values ($1, $2)', [PA, C]))?.message.includes('permission denied'), 'post_reports: zapis tylko przez RPC');

// ── Wyszukiwarka i profil ──
await as(A);
const sL = await call('search_users', 'lukasz');
ok(
  ids(sL).includes(B) && !ids(sL).includes(A) && keys(sL[0]) === SOCIAL_KEYS && sL.find((u) => u.id === B).friendStatus === 'friends',
  'search_users: „lukasz” znajduje „Łukasz” (bez polskich znaków), bez wywołującego, z friendStatus',
  sL,
);
ok(
  ids(await call('search_users', 'ŁUKASZ_test')).includes(B) && ids(await call('search_users', '@lukasz.t')).includes(B) &&
    !ids(await call('search_users', 'anna')).includes(A) && (await call('search_users', 'zzzz-nie-ma')).length === 0,
  'search_users: wielkość liter, „@” i separatory bez znaczenia',
);
const sugg = await call('search_users', '');
ok(sugg[0]?.id === E && !ids(sugg).includes(B) && !ids(sugg).includes(A) && sugg[0].homeGminaId === 'michalowo', 'search_users(""): propozycje – najpierw ta sama gmina, bez znajomych', sugg.map((u) => [u.handle, u.homeGminaId, u.tripsCount, u.friendStatus]));
ok((await call('search_users', '', 2)).length === 2, 'search_users: p_limit');
const uB = await call('get_user', B);
ok(
  keys(uB) === `${SOCIAL_KEYS},speciesCount`.split(',').sort().join() && uB.speciesCount === 2 && uB.tripsCount === 9 &&
    uB.homeGminaId === 'michalowo' && uB.friendStatus === 'friends' && uB.ringRarity === 'epicki' && uB.handle === 'lukasz.test',
  'get_user: social user + speciesCount',
  uB,
);
ok((await code('get_user', randomUUID()))?.code === 'P0002', 'get_user: nieznany → P0002 user_not_found');
ok((await call('get_user_by_handle', '@Lukasz.Test'))?.id === B && (await call('get_user_by_handle', 'nie.ma.takiego')) === null, 'get_user_by_handle: z „@”, bez wielkości liter; brak → null');

// ── Funkcje wewnętrzne i anon ──
const internal = [
  await err('select author_json($1)', [A]),
  await err('select social_user_json($1, $1)', [A]),
  await err('select friend_status($1, $1)', [A]),
  await err('select ring_rarity($1)', [A]),
  await err(`select fold_text('x')`),
  await err('select post_visible_to($1, $1)', [PA]),
  await err('select wipe_social_data($1)', [A]),
];
ok(internal.every((e) => e?.message.includes('permission denied')), 'klient nie wywoła funkcji wewnętrznych etapu 3');
await as(null);
await db.exec('set role anon');
ok(
  (await err(`select get_feed('friends')`))?.message.includes('permission denied') && (await err(`select search_users('a')`))?.message.includes('permission denied'),
  'anon nie ma get_feed() / search_users()',
);

// ── Boty deweloperskie ──
await admin();
await db.exec(`update app_config set value = 'false' where key = 'dev_tools'`);
await as(A);
ok(
  (await code('dev_seed_social'))?.message.includes('dev_tools_disabled') && (await code('dev_bots_act'))?.message.includes('dev_tools_disabled'),
  'dev_seed_social / dev_bots_act bez app_config.dev_tools → P0001 dev_tools_disabled',
);
await admin();
await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
await as(A);
const seed1 = await call('dev_seed_social');
await admin();
const botStats = await one(
  `select (select count(*) from profiles where is_bot) bots, (select count(*) from auth.users) users,
          (select count(*) from posts x join profiles p on p.id = x.author_id where p.is_bot) posts,
          (select count(*) from post_reactions r join profiles p on p.id = r.user_id where p.is_bot) reactions,
          (select count(*) from post_comments c join profiles p on p.id = c.author_id where p.is_bot) comments,
          (select count(*) from finds f join profiles p on p.id = f.user_id where p.is_bot and f.visible_from is not null) public_finds,
          (select count(*) from (select post_id, body from post_comments group by 1, 2 having count(*) > 1) d) dup_comments,
          (select bool_and(x.visible_from <= now() and x.created_at <= now() - interval '25 hours' and x.created_at >= now() - interval '6 days'
                           and x.trip_id is null and x.gmina_id = p.home_gmina_id)
             from posts x join profiles p on p.id = x.author_id where p.is_bot) posts_ok`,
);
ok(
  seed1.bots === 12 && Number(botStats.bots) === 12 && seed1.friends === 7 && seed1.incoming === 2 && seed1.posts === Number(botStats.posts) &&
    seed1.posts >= 12 && seed1.posts <= 36 && Number(botStats.reactions) >= 2 * seed1.posts,
  'dev_seed_social: 12 botów, 6 znajomych botów (+B), 2 zaproszenia, 1–3 wpisy na bota z reakcjami botów',
  { seed1, botStats },
);
ok(
  botStats.posts_ok === true && Number(botStats.public_finds) === 0 && Number(botStats.dup_comments) === 0,
  'dev_seed_social: wpisy sprzed 1–6 dni, już widoczne, w gminie bota, bez wyprawy; znaleziska botów poza statystykami; komentarze bez powtórek',
  botStats,
);
const olaBot = await one(`select p.*, (select count(*) from user_species us where us.user_id = p.id) sp from profiles p where handle = 'ola.w'`);
ok(
  olaBot.is_bot && olaBot.display_name === 'Ola_W' && olaBot.first_name === 'Aleksandra' && olaBot.level === 27 && olaBot.avatar_preset === 'bor' &&
    olaBot.home_gmina_id === 'suprasl' && olaBot.trips_count === 212 && Number(olaBot.sp) > 0,
  'dev_seed_social: bot Ola_W – poziom 27 (wpis import), avatar, gmina, liczniki, atlas',
);
await as(A);
const uOla = await call('get_user_by_handle', 'ola.w');
const uMarek = await call('get_user_by_handle', '@marek.k');
ok(
  uOla.ringRarity === 'legendarny' && uOla.friendStatus === 'friends' && uOla.level === 27 && uOla.avatarPreset === 'bor' && uOla.speciesCount > 0 &&
    uMarek.ringRarity === 'primary' && uMarek.friendStatus === 'friends',
  'boty: ringRarity z mocków (Ola legendarny, Marek primary), znajomi gracza',
);
const aFr = await call('get_friends');
ok(
  aFr.friends.length === 7 && ['Bartek', 'Ewa.las', 'Kasia_P', 'Marek_K', 'Ola_W', 'Tomek_B', 'Łukasz_Testowy'].every((n) => aFr.friends.some((u) => u.name === n)) &&
    aFr.incoming.map((u) => u.handle).sort().join() === 'lukasz.borowik,zosia.kania',
  'get_friends po dev_seed_social: 6 botów + B (wg nazwy), zaproszenia od Zosi i Łukasza',
  aFr.friends.map((u) => u.name),
);
const fBots = await feed('friends', null, 50);
const olaPost = fBots.find((p) => p.author.handle === 'ola.w' && p.payload.title === 'Poranny obchód po deszczu');
ok(
  olaPost && olaPost.payload.highlight.species === 'Szmaciak gałęzisty' && olaPost.payload.highlight.rarity === 'legendarny' &&
    olaPost.payload.route === null && olaPost.routePrecision === 'gmina' && olaPost.reactions >= 2 && olaPost.mine === false,
  'feed znajomych: wpisy botów (Ola_W z makiety) z reakcjami',
  olaPost,
);
ok(
  (await call('search_users', 'lukasz')).some((u) => u.handle === 'lukasz.borowik') && (await call('search_users', 'lesna')).some((u) => u.name === 'MagdaLeśna'),
  'search_users znajduje boty (bez polskich znaków)',
);
const seed2 = await call('dev_seed_social');
await admin();
ok(
  JSON.stringify(seed2) === JSON.stringify(seed1) && Number((await one('select count(*) n from auth.users')).n) === Number(botStats.users),
  'dev_seed_social idempotentny (te same boty, wpisy i relacje)',
  seed2,
);
await as(C);
const seedC = await call('dev_seed_social');
ok(seedC.bots === 12 && seedC.friends === 6 && seedC.incoming === 2 && seedC.posts === seed1.posts, 'dev_seed_social dla drugiego gracza: własne relacje, boty wspólne', seedC);

// dev_bots_act: przyjęcie zaproszenia, wpisy widoczne, reakcje i komentarze znajomych botów.
await admin();
const PA2 = await insPost(A, 'michalowo', 0, 24);
const jurek = (await one(`select id from profiles where handle = 'jurek.puszcza'`)).id;
await as(A);
ok((await call('send_friend_request', jurek)) === 'outgoing', 'A zaprasza bota Jurka');
const act1 = await call('dev_bots_act');
await admin();
const aPosts = await one(
  `select bool_and(visible_from <= now()) visible,
          (select count(*) from post_comments c join profiles p on p.id = c.author_id where p.is_bot and c.post_id in ($2, $3)) bot_comments,
          (select count(*) from (select post_id, body from post_comments where post_id in ($2, $3) group by 1, 2 having count(*) > 1) d) dups
     from posts where author_id = $1`,
  [A, PA, PA2],
);
ok(
  act1.accepted === 1 && act1.visible === 1 && act1.reactions >= 2 && act1.comments >= 2 && act1.requests === 0 && aPosts.visible === true &&
    Number(aPosts.bot_comments) === act1.comments && Number(aPosts.dups) === 0,
  'dev_bots_act: bot przyjmuje zaproszenie, wpisy gracza widoczne od razu, 2–3 znajomych botów reaguje i komentuje (bez powtórek)',
  { act1, aPosts },
);
await as(A);
const actBots = await call('get_activity');
ok(
  (await call('get_user', jurek)).friendStatus === 'friends' && actBots.some((x) => x.id === `friend_accepted:${jurek}`) &&
    actBots.some((x) => x.kind === 'reaction' && x.postId === PA2) && actBots.some((x) => x.kind === 'comment' && x.postId === PA2),
  'dev_bots_act → aktywność: przyjęte zaproszenie, reakcje i komentarze botów',
);
for (const u of aFr.incoming) await call('respond_friend_request', u.id, false);
const act2 = await call('dev_bots_act');
const inc2 = (await call('get_friends')).incoming;
ok(act2.requests === 1 && act2.accepted === 0 && inc2.length === 1 && inc2[0].friendStatus === 'incoming', 'dev_bots_act: bez oczekujących zaproszeń → nowe od bota spoza znajomych', act2);

// dev_reset_player kasuje też dane społecznościowe gracza.
await call('report_post', PB1);
await as(B);
const cOnB = await call('add_comment', PB1, 'Mój wpis, mój komentarz');
await as(A);
await call('add_comment', PB1, 'Komentarz A pod wpisem B');
await one('select * from toggle_reaction($1)', [PB1]);
await call('dev_reset_player');
await admin();
const aLeft = await one(
  `select (select count(*) from friendships where $1 in (user_id, friend_id)) fr, (select count(*) from post_hides where user_id = $1) h,
          (select count(*) from post_reports where reporter_id = $1) rp, (select count(*) from post_comments where author_id = $1) c,
          (select count(*) from post_reactions where user_id = $1) r, (select count(*) from posts where author_id = $1) p,
          (select avatar_preset from profiles where id = $1) av,
          (select count(*) from post_comments where id = $2) b_comment,
          (select count(*) from friendships where $3 in (user_id, friend_id)) c_friends`,
  [A, cOnB.id, C],
);
ok(
  Object.entries(aLeft).every(([k, v]) => (k === 'av' ? v === 'sowa' : k === 'b_comment' ? Number(v) === 1 : k === 'c_friends' ? Number(v) >= 6 : Number(v) === 0)),
  'dev_reset_player: znajomi, ukryte, zgłoszenia, komentarze i reakcje gracza skasowane (avatar i cudze dane zostają)',
  aLeft,
);

// =============================================================================
// Etap 4 – rankingi województw, statystyki gmin, wyzwania, obserwowanie, percentyl, generator aktywności
// =============================================================================
const RANK_KEYS = 'computedAt,heat,period,periodStart,rows,userContribution,userGminaId,voivodeship';
const ROW_KEYS = 'forest,gminaId,kind,mushroomers,name,points,powiat,rank,trend';
const STATS_KEYS = 'challenge,challengeAccepted,challengeCompleted,distribution,followed,gminaId,mushroomers,mushrooms,name,rank,records,species';
const CH_KEYS = 'badgeId,badgeName,description,endsAt,id,speciesId,title,xp';
const GS_CH_KEYS = 'acceptedAt,badgeId,badgeName,completedAt,description,endsAt,gminaId,id,speciesId,title,xp';
const PCT_KEYS = 'biggerCount,collected,gminaId,mushroomers,percentile,sizeRank,speciesId';
const ranking = (period, voiv) => call('get_ranking', period, voiv ?? null);
const byGmina = (rows) => Object.fromEntries(rows.map((r) => [r.gminaId, r]));
// jsonb porządkuje klucze po swojemu – obiekty porównujemy po posortowanych parach.
const entries = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

await admin();
const permCh = await one(
  `select count(*) n, count(distinct gmina_id) g, bool_and(badge_id = 'lowca-legend') b, bool_and(xp = 500) xp
     from gmina_challenges where ends_at is null`,
);
ok(
  Number(permCh.n) === 38 && Number(permCh.g) === 38 && permCh.b && permCh.xp,
  'seed: 38 stałych wyzwań gmin gry z makiety (bez końca, odznaka Łowca Legend, 500 XP)',
  permCh,
);

// Granice okresów z serwera (Europe/Warsaw). W poniedziałek (przed upływem 24 h tygodnia) nie ma jeszcze danych
// tygodnia starszych niż 24 h – wtedy sprawdzenia bieżącego tygodnia są pomijane; w pierwszych dniach stycznia – sezonu.
const per = await one(
  `select warsaw_ts(ranking_period_start('week')) w, warsaw_ts(ranking_period_start('season')) s, now() n,
          iso_ts(warsaw_ts(ranking_period_start('week') + 7)) next_week, to_char(ranking_period_start('week'), 'YYYY-MM-DD') wd,
          to_char(ranking_period_start('season'), 'YYYY-MM-DD') sd`,
);
const weekStart = per.w.getTime();
const seasonStart = per.s.getTime();
const nowMs = per.n.getTime();
const tsAt = (ms) => new Date(ms).toISOString();
const hasCurWeek = nowMs - DAY - weekStart > 2 * H;
const seasonOk = weekStart - 3 * DAY >= seasonStart;
const prevWeekTs = tsAt(weekStart - 3 * DAY);
const curWeekTs = hasCurWeek ? tsAt(weekStart + (nowMs - DAY - weekStart) / 2) : tsAt(weekStart - 2 * DAY);
const recentTs = tsAt(nowMs - H);
if (!hasCurWeek) console.log('· (początek tygodnia – sprawdzenia bieżącego tygodnia pominięte)');
if (!seasonOk) console.log('· (początek sezonu – sprawdzenia sezonu pominięte)');

const swk = (await db.query(`select id from gminy where voivodeship = 'świętokrzyskie' order by id limit 3`)).rows.map((r) => r.id);
const R1 = await newUser('rank.one');
const R2 = await newUser('rank.two');
const R3 = await newUser('rank.three');
const R4 = await newUser('rank.four');
await db.query(`update profiles set home_gmina_id = 'bierawa', display_name = 'Ola Testowa' where id = $1`, [R1]);
await db.query(`update profiles set home_gmina_id = 'dobrodzien', display_name = '  ' where id = $1`, [R2]);
const xpLog = [];
const addXp = async (user, gmina, amount, at, source = 'find') => {
  await db.query(`insert into xp_events (user_id, source, ref_id, gmina_id, amount, created_at) values ($1, $2, 'test', $3, $4, $5)`, [
    user, source, gmina, amount, at,
  ]);
  xpLog.push({ user, gmina, amount, at: Date.parse(at) });
};
// Poprzedni tydzień: bierawa 500 · dobrodzien 400 · chrzastowice 300 (miejsca 1–3).
await addXp(R1, 'bierawa', 500, prevWeekTs);
await addXp(R2, 'dobrodzien', 400, prevWeekTs);
await addXp(R3, 'chrzastowice', 300, prevWeekTs);
// Bieżący tydzień (> 24 h temu): dobrodzien 900 (2 graczy) · bierawa 600 · chrzastowice 200 · dobrzen-wielki 100 · dabrowa-opolski 50.
await addXp(R2, 'dobrodzien', 500, curWeekTs);
await addXp(R3, 'dobrodzien', 400, curWeekTs);
await addXp(R1, 'bierawa', 600, curWeekTs);
await addXp(R3, 'chrzastowice', 200, curWeekTs);
await addXp(R3, 'dobrzen-wielki', 100, curWeekTs);
await addXp(R3, 'dabrowa-opolski', 50, curWeekTs);
// Świętokrzyskie: 300 · 100 · 100 (remis).
await addXp(R3, swk[0], 300, curWeekTs);
await addXp(R3, swk[1], 100, curWeekTs);
await addXp(R3, swk[2], 100, curWeekTs);
// Ostatnia godzina (przed upływem opóźnienia prywatności): baborow 10 000 – poza rankingami, ale w „wkładzie” R1.
await addXp(R1, 'baborow', 10000, recentTs);
// XP bez gminy (import) – poza rankingami i „wkładem”.
await db.query(`insert into xp_events (user_id, source, ref_id, amount) values ($1, 'import', 'test', 777)`, [R1]);

// Znaleziska (statystyki gminy, rekordy, percentyl): Dobrodzień – widoczne od dnia po znalezieniu.
const addFind = (user, gmina, species, rarity, weight, o = {}) =>
  db.query(
    `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, weight_g, cap_cm, found_at, claimed_at, visible_from)
     values ($1, $2, $3, $4, 0.9, $5, 'claimed', $6, $7, $8, $8, $9)`,
    [user, species, gmina, rarity, o.collected ?? true, weight, o.cap ?? null, o.at ?? prevWeekTs, o.visibleFrom ?? tsAt(Date.parse(o.at ?? prevWeekTs) + DAY)],
  );
for (const w of [80, 100, 120]) await addFind(R1, 'dobrodzien', 'podgrzybek-brunatny', 'pospolity', w);
for (const w of [150, 200]) await addFind(R2, 'dobrodzien', 'podgrzybek-brunatny', 'pospolity', w);
for (const w of [300, 450, 520]) await addFind(R2, 'dobrodzien', 'borowik-szlachetny', 'rzadki', w, { cap: 14 });
for (const w of [60, 70]) await addFind(R2, 'dobrodzien', 'maslak-zwyczajny', 'pospolity', w);
await addFind(R2, 'dobrodzien', 'pieprznik-jadalny', 'pospolity', 90);
await addFind(R2, 'dobrodzien', 'kozlarz-babka', 'pospolity', 110);
await addFind(R1, 'dobrodzien', 'czubajka-kania', 'epicki', 260, { cap: 34 });
await addFind(R1, 'dobrodzien', 'muchomor-czerwony', 'pospolity', 150, { collected: false });
await addFind(R3, 'dobrodzien', 'borowik-szlachetny', 'rzadki', 9999, { visibleFrom: tsAt(nowMs + H) });
// Bierawa: rekordy sezonu (2 epickie + 1 legendarny).
for (const w of [60, 65]) await addFind(R1, 'bierawa', 'smardz-jadalny', 'epicki', w);
await addFind(R1, 'bierawa', 'szmaciak-galezisty', 'legendarny', 1500);

// ── get_ranking: kształt, województwo, odświeżanie przy odczycie ──
await db.exec('delete from gmina_rankings_refresh');
await as(R2);
const before1 = Date.now();
const wk = await ranking('week', 'opolskie');
ok(
  keys(wk) === RANK_KEYS && wk.period === 'week' && wk.voivodeship === 'opolskie' && wk.periodStart === per.wd && ISO_RE.test(wk.computedAt) &&
    Date.parse(wk.computedAt) >= before1 - 2000 && Array.isArray(wk.rows) && typeof wk.heat === 'object' && wk.userGminaId === 'dobrodzien',
  'get_ranking: kształt (camelCase), brak przeliczenia → przeliczone przy odczycie (computedAt = teraz)',
  { ...wk, rows: wk.rows.length },
);
if (hasCurWeek) {
  const w = byGmina(wk.rows);
  ok(
    JSON.stringify(wk.rows.map((r) => [r.gminaId, r.rank, r.points])) ===
      JSON.stringify([['dobrodzien', 1, 900], ['bierawa', 2, 600], ['chrzastowice', 3, 200], ['dobrzen-wielki', 4, 100], ['dabrowa-opolski', 5, 50]]) &&
      wk.rows.every((r) => keys(r) === ROW_KEYS) && w.dobrodzien.mushroomers === 2 && w.bierawa.mushroomers === 1,
    'get_ranking week: tylko gminy województwa z punktami, miejsca w województwie, grzybiarze = różni gracze',
    wk.rows,
  );
  ok(
    !w.baborow && !('baborow' in wk.heat),
    'get_ranking: XP młodsze niż 24 h nie liczy się w rankingu (prywatność)',
  );
  ok(
    w.dobrodzien.trend === 1 && w.bierawa.trend === -1 && w.chrzastowice.trend === 0 && w['dobrzen-wielki'].trend === null &&
      w['dabrowa-opolski'].trend === null,
    'get_ranking week: trend = miejsce sprzed tygodnia − obecne (awans +1, spadek −1, bez zmian 0, nowa gmina null)',
    wk.rows.map((r) => [r.gminaId, r.trend]),
  );
  ok(
    entries(wk.heat) === entries({ bierawa: 3, chrzastowice: 2, 'dabrowa-opolski': 1, dobrodzien: 4, 'dobrzen-wielki': 1 }),
    'get_ranking: heat 1–4 (górne 20% → 4 … dolne 40% → 1), gmin bez punktów brak',
    wk.heat,
  );
  const bier = w.bierawa;
  ok(bier.name === 'Bierawa' && bier.kind === 'wiejska' && bier.powiat === 'kędzierzyńsko-kozielski' && bier.forest === null, 'get_ranking: wiersz z nazwą, rodzajem i powiatem gminy (kompleks leśny null poza gminami gry)', bier);
  const sw = await ranking('week', 'świętokrzyskie');
  ok(
    JSON.stringify(sw.rows.map((r) => [r.gminaId, r.rank, r.points])) === JSON.stringify([[swk[0], 1, 300], [swk[1], 2, 100], [swk[2], 2, 100]]) &&
      sw.heat[swk[0]] === 4 && sw.heat[swk[1]] === 3 && sw.heat[swk[2]] === 3,
    'get_ranking: drugie województwo – miejsca od 1, remis = to samo miejsce (rank: 1, 2, 2), ta sama strefa mapy',
    sw.rows,
  );
  await admin();
  const nat = await one(
    `select rank, voivodeship_rank from gmina_rankings where period = 'week' and period_start = ranking_period_start('week') and gmina_id = $1`,
    [swk[0]],
  );
  ok(nat.rank > 1 && nat.voivodeship_rank === 1, 'gmina_rankings: miejsce w kraju (rank) i w województwie (voivodeship_rank)', nat);
  await as(R2);
}
await as(R1);
const r1Week = await ranking('week');
const sumXp = (user, from) => xpLog.filter((x) => x.user === user && x.at >= from).reduce((a, x) => a + x.amount, 0);
ok(
  r1Week.voivodeship === 'opolskie' && r1Week.userGminaId === 'bierawa' && r1Week.userContribution === sumXp(R1, weekStart) &&
    (nowMs - H < weekStart || r1Week.userContribution >= 10000),
  'get_ranking(p_voivodeship null): województwo gminy domowej; userContribution = własne XP z gminą od początku tygodnia (bez opóźnienia, bez importu)',
  { contribution: r1Week.userContribution, expected: sumXp(R1, weekStart) },
);
ok((await ranking('season')).userContribution === sumXp(R1, seasonStart), 'get_ranking season: userContribution od początku sezonu');
ok((await ranking('week', ' Opolskie ')).voivodeship === 'opolskie', 'get_ranking: województwo bez wielkości liter i spacji');
const badVoiv = await code('get_ranking', 'week', 'mazowsze');
ok(badVoiv?.code === 'P0001' && badVoiv.message.includes('invalid_voivodeship'), 'get_ranking: nieznane województwo → P0001 invalid_voivodeship');
await as(R4);
const r4Rank = await ranking('season');
ok(r4Rank.voivodeship === 'podlaskie' && r4Rank.userGminaId === null && r4Rank.userContribution === 0, 'get_ranking: gracz bez gminy domowej → podlaskie, userGminaId null');
if (seasonOk) {
  const sup = byGmina(r4Rank.rows).suprasl;
  ok(sup && sup.forest === 'Puszcza Knyszyńska' && sup.rank >= 1 && sup.trend === null, 'get_ranking season (podlaskie): gmina gry z kompleksem leśnym, trend null poza tygodniem', sup);
  const se = await ranking('season', 'opolskie');
  ok(
    JSON.stringify(se.rows.map((r) => [r.gminaId, r.rank, r.points, r.mushroomers])) ===
      JSON.stringify([['dobrodzien', 1, 1300, 2], ['bierawa', 2, 1100, 1], ['chrzastowice', 3, 500, 1], ['dobrzen-wielki', 4, 100, 1], ['dabrowa-opolski', 5, 50, 1]]) &&
      se.rows.every((r) => r.trend === null) && se.periodStart === per.sd,
    'get_ranking season: punkty z całego sezonu (bez ostatnich 24 h), trend null',
    se.rows,
  );
  const rec = await ranking('records', 'opolskie');
  ok(
    JSON.stringify(rec.rows.map((r) => [r.gminaId, r.rank, r.points, r.mushroomers])) === JSON.stringify([['bierawa', 1, 3, 1], ['dobrodzien', 2, 1, 2]]),
    'get_ranking records: liczba okazów epickich i legendarnych (widocznych), grzybiarze ze znaleziskami w gminie',
    rec.rows,
  );

  // Świeżość: kolejny odczyt w ciągu 15 min nie przelicza; po 15 min (albo w innym tygodniu) – przelicza.
  const fresh1 = await ranking('season', 'opolskie');
  await admin();
  await addXp(R3, 'chrzastowice', 5000, prevWeekTs);
  await as(R2);
  const fresh2 = await ranking('season', 'opolskie');
  ok(
    fresh2.computedAt === fresh1.computedAt && byGmina(fresh2.rows).chrzastowice.points === 500,
    'get_ranking: przeliczenie młodsze niż 15 min → bez ponownego liczenia (nowe XP jeszcze niewidoczne)',
  );
  await admin();
  await db.exec(`update gmina_rankings_refresh set computed_at = now() - interval '16 minutes'`);
  await as(R2);
  const fresh3 = await ranking('season', 'opolskie');
  ok(
    fresh3.computedAt !== fresh1.computedAt && fresh3.rows[0].gminaId === 'chrzastowice' && fresh3.rows[0].points === 5500,
    'get_ranking: przeliczenie starsze niż 15 min → przeliczane przy odczycie',
    fresh3.rows.slice(0, 2),
  );
  await admin();
  await db.exec(`update gmina_rankings_refresh set week_start = week_start - 7`);
  await as(R2);
  const fresh4 = await ranking('season', 'opolskie');
  await admin();
  ok(
    fresh4.computedAt !== fresh3.computedAt && (await one(`select week_start = ranking_period_start('week') ok from gmina_rankings_refresh`)).ok,
    'get_ranking: przeliczenie z innego tygodnia → przeliczane mimo świeżości',
  );
}

// ── get_gmina_stats ──
await as(R4);
ok((await code('get_gmina_stats', 'nie-ma-takiej'))?.code === 'P0002', 'get_gmina_stats: nieznana gmina → P0002 gmina_not_found');
const empty = await call('get_gmina_stats', 'cisek');
ok(
  keys(empty) === STATS_KEYS && empty.gminaId === 'cisek' && empty.name === 'Cisek' && empty.rank === null && empty.mushroomers === 0 &&
    empty.mushrooms === 0 && empty.species === 0 && JSON.stringify(empty.records) === '[]' && JSON.stringify(empty.distribution) === '[]' &&
    empty.challengeAccepted === false && empty.challengeCompleted === false && empty.followed === false,
  'get_gmina_stats: pusta gmina → zera, puste tablice, rank null',
  empty,
);
const ech = empty.challenge;
await admin();
const pospJadalne = (await db.query(`select id from species where edibility = 'jadalny' and rarity = 'pospolity'`)).rows.map((r) => r.id);
await as(R4);
ok(
  ech && keys(ech) === CH_KEYS && pospJadalne.includes(ech.speciesId) && ech.title.startsWith('Znajdź ') && ech.title.endsWith(' w tym tygodniu') &&
    ech.xp === 150 && ech.badgeId === null && ech.badgeName === null && ech.endsAt === per.next_week && ech.description.includes('nikt jeszcze'),
  'get_gmina_stats: gmina spoza gry → wyzwanie tygodniowe (pospolity jadalny, 150 XP, bez odznaki, do następnego poniedziałku)',
  ech,
);
const empty2 = await call('get_gmina_stats', 'cisek');
await admin();
const cisekCh = await one(`select count(*) n, min(week_start::text) w from gmina_challenges where gmina_id = 'cisek'`);
ok(empty2.challenge.id === ech.id && Number(cisekCh.n) === 1 && cisekCh.w === per.wd, 'ensure_weekly_challenge: to samo wyzwanie przy kolejnym odczycie w tym tygodniu (jeden wiersz)', cisekCh);

await as(R4);
const ds = await call('get_gmina_stats', 'dobrodzien');
if (seasonOk) {
  const foundOn = (await one(`select to_char(($1::timestamptz at time zone 'Europe/Warsaw')::date, 'YYYY-MM-DD') d`, [prevWeekTs])).d;
  ok(
    ds.mushroomers === 2 && ds.mushrooms === 13 && ds.species === 7 && ds.rank === (hasCurWeek ? 1 : null),
    'get_gmina_stats: grzybiarze, zebrane okazy, gatunki (z trującym zdjęciem) – tylko widoczne; rank = miejsce tygodnia w województwie',
    { mushroomers: ds.mushroomers, mushrooms: ds.mushrooms, species: ds.species, rank: ds.rank },
  );
  ok(
    JSON.stringify(ds.records.map((r) => [r.rarity, r.speciesName, r.weightG, r.capCm, r.author, r.foundOn])) ===
      JSON.stringify([
        ['epicki', 'Czubajka kania', 260, 34, 'Ola Testowa', foundOn],
        ['rzadki', 'Borowik szlachetny', 520, 14, 'rank.two', foundOn],
        ['pospolity', 'Podgrzybek brunatny', 200, null, 'rank.two', foundOn],
      ]),
    'get_gmina_stats: rekordy – najcięższy zebrany okaz w rzadkości (bez niewidocznych), autor = nazwa (pusta → nick), data',
    ds.records,
  );
  ok(
    ds.distribution.every((d) => keys(d) === 'name,pct') &&
      JSON.stringify(ds.distribution.map((d) => [d.name, d.pct])) ===
        JSON.stringify([['Podgrzybek brunatny', 38], ['Borowik szlachetny', 23], ['Maślak zwyczajny', 15], ['Czubajka kania', 8], ['Inne', 16]]),
    'get_gmina_stats: „Co tu się zbiera” – 4 gatunki + Inne (suma 100)',
    ds.distribution,
  );
  ok(
    ds.challenge.speciesId === 'podgrzybek-brunatny' && ds.challenge.title === 'Znajdź podgrzybka brunatnego w tym tygodniu' &&
      ds.challenge.description.includes('już 5 okazów') && ds.challenge.xp === 150,
    'wyzwanie tygodniowe: najczęściej zbierany jadalny gatunek gminy w sezonie (biernik w tytule)',
    ds.challenge,
  );
}
const sst = await call('get_gmina_stats', 'suprasl');
await admin();
const supCh = await one(`select count(*) n from gmina_challenges where gmina_id = 'suprasl'`);
ok(
  sst.challenge.speciesId === 'szmaciak-galezisty' && sst.challenge.title === 'Znajdź szmaciaka gałęzistego' && sst.challenge.xp === 500 &&
    sst.challenge.badgeId === 'lowca-legend' && sst.challenge.badgeName === 'Łowca Legend' && sst.challenge.endsAt === null && Number(supCh.n) === 1,
  'get_gmina_stats: gmina gry → stałe wyzwanie z makiety (bez końca, z odznaką); bez wyzwania tygodniowego',
  sst.challenge,
);

// ── accept_challenge → claim_find kończy wyzwanie → get_game_state ──
const ended = (
  await one(
    `insert into gmina_challenges (gmina_id, species_id, title, description, xp, starts_at, ends_at)
     values ('cisek', 'maslak-zwyczajny', 'Stare', 'Zakończone', 100, now() - interval '10 days', now() - interval '3 days') returning id`,
  )
).id;
const off = (
  await one(`insert into gmina_challenges (gmina_id, species_id, title, description, xp, active) values ('baborow', 'maslak-zwyczajny', 'Wył.', 'Nieaktywne', 100, false) returning id`)
).id;
await as(R4);
await call('accept_challenge', ech.id);
await call('accept_challenge', ech.id);
const inact = [await code('accept_challenge', ended), await code('accept_challenge', off)];
ok(
  inact.every((e) => e?.code === 'P0001' && e.message.includes('challenge_inactive')) && (await code('accept_challenge', randomUUID()))?.code === 'P0002',
  'accept_challenge: zakończone / nieaktywne → P0001 challenge_inactive, nieznane → P0002',
);
await call('accept_challenge', sst.challenge.id);
const acc = await call('get_gmina_stats', 'cisek');
await admin();
ok(
  acc.challengeAccepted && !acc.challengeCompleted && Number((await one('select count(*) n from user_challenges where user_id = $1', [R4])).n) === 2,
  'accept_challenge: idempotentne (jeden wiersz), get_gmina_stats → challengeAccepted',
);
await as(R4);
const TC = randomUUID();
await startTrip('cisek', TC, iso(H));
const FC = randomUUID();
await submit({ id: FC, tripId: TC, gminaId: 'cisek', speciesId: ech.speciesId, rarity: 'pospolity', confidence: 0.92, foundAt: iso(H / 2) });
const rc = (await one('select claim_find($1) r', [FC])).r;
await admin();
const chXp = await one(`select amount from xp_events where user_id = $1 and source = 'challenge' and ref_id = $2`, [R4, ech.id]);
await as(R4);
const done4 = await call('get_gmina_stats', 'cisek');
ok(
  rc.completedChallengeIds.includes(ech.id) && chXp?.amount === ech.xp && done4.challengeAccepted && done4.challengeCompleted,
  'claim_find kończy przyjęte wyzwanie tygodniowe (XP w księdze), get_gmina_stats → challengeCompleted',
  rc.completedChallengeIds,
);
await call('accept_challenge', ech.id);
ok(true, 'accept_challenge po ukończeniu → bez błędu');

// ── follow_gmina ──
await call('follow_gmina', 'cisek', true);
await call('follow_gmina', 'cisek', true);
await call('follow_gmina', 'suprasl', true);
ok((await call('get_gmina_stats', 'cisek')).followed === true, 'follow_gmina: get_gmina_stats → followed');
const gs4 = await state();
const g4 = Object.fromEntries(gs4.challenges.map((c) => [c.id, c]));
ok(
  gs4.challenges.length === 2 && gs4.challenges.every((c) => keys(c) === GS_CH_KEYS && ISO_RE.test(c.acceptedAt)) &&
    g4[ech.id].gminaId === 'cisek' && ISO_RE.test(g4[ech.id].completedAt) && g4[ech.id].badgeId === null && g4[ech.id].xp === ech.xp &&
    g4[ech.id].endsAt === per.next_week &&
    g4[sst.challenge.id].completedAt === null && g4[sst.challenge.id].badgeName === 'Łowca Legend' && g4[sst.challenge.id].gminaId === 'suprasl' &&
    g4[sst.challenge.id].endsAt === null,
  'get_game_state: challenges – przyjęte wyzwania (ukończone z completedAt, endsAt tygodniowego, stałe z odznaką i endsAt null)',
  gs4.challenges,
);
ok(JSON.stringify(gs4.followedGminy) === JSON.stringify(['cisek', 'suprasl']), 'get_game_state: followedGminy (idempotentne obserwowanie)', gs4.followedGminy);
await call('follow_gmina', 'cisek', false);
await call('follow_gmina', 'cisek', false);
ok(
  JSON.stringify((await state()).followedGminy) === JSON.stringify(['suprasl']) && (await call('get_gmina_stats', 'cisek')).followed === false,
  'follow_gmina(false): przestaje obserwować (idempotentnie)',
);
ok(
  (await code('follow_gmina', 'nie-ma-takiej', true))?.code === 'P0002' && (await code('follow_gmina', 'cisek', null))?.message.includes('invalid_follow'),
  'follow_gmina: nieznana gmina → P0002, p_follow null → P0001 invalid_follow',
);
// Przyjęte, nieukończone wyzwanie po końcu (np. przyjęte na innym telefonie) znika ze stanu gry.
await admin();
const soon = (
  await one(
    `insert into gmina_challenges (gmina_id, species_id, title, description, xp, starts_at, ends_at)
     values ('branice', 'maslak-zwyczajny', 'Krótkie', 'Kończy się zaraz', 120, now() - interval '1 day', now() + interval '1 day')
     returning id, iso_ts(ends_at) ends`,
  )
);
await as(R4);
await call('accept_challenge', soon.id);
const gsSoon = (await state()).challenges.find((c) => c.id === soon.id);
await admin();
await db.query(`update gmina_challenges set ends_at = now() - interval '1 minute' where id = $1`, [soon.id]);
await as(R4);
const gsExpired = await state();
ok(
  gsSoon?.endsAt === soon.ends && gsSoon.completedAt === null && !gsExpired.challenges.some((c) => c.id === soon.id) &&
    gsExpired.challenges.some((c) => c.id === ech.id) && gsExpired.challenges.some((c) => c.id === sst.challenge.id),
  'get_game_state: nieukończone wyzwanie po endsAt pominięte (ukończone i trwające zostają)',
  gsExpired.challenges.map((c) => [c.title, c.endsAt, c.completedAt]),
);
await admin();
await db.query(`update user_challenges set accepted_at = now() - interval '40 days' where user_id = $1`, [R4]);
await as(R4);
const gsOld = await state();
ok(
  gsOld.challenges.length === 1 && gsOld.challenges[0].id === sst.challenge.id,
  'get_game_state: przyjęte > 30 dni temu – tylko nieukończone, które wciąż trwają',
  gsOld.challenges.map((c) => c.id),
);

// ── get_species_percentile ──
if (seasonOk) {
  const p1 = await call('get_species_percentile', 'podgrzybek-brunatny', 'dobrodzien', 140);
  ok(
    keys(p1) === PCT_KEYS && p1.collected === 5 && p1.mushroomers === 2 && p1.biggerCount === 2 && p1.sizeRank === 3 && p1.percentile === 60,
    'get_species_percentile: 5 okazów, 2 większe → miejsce 3, większy niż 60%',
    p1,
  );
  const p2 = await call('get_species_percentile', 'podgrzybek-brunatny', 'dobrodzien', 500);
  const p3 = await call('get_species_percentile', 'borowik-szlachetny', 'dobrodzien', 500);
  ok(p2.sizeRank === 1 && p2.biggerCount === 0 && p2.percentile === 100 && p3.collected === 3 && p3.biggerCount === 1, 'get_species_percentile: największy okaz; niewidoczne znaleziska pominięte', [p2, p3]);
}
const p0 = await call('get_species_percentile', 'smardz-jadalny', 'cisek', 60);
ok(
  p0.collected === 0 && p0.mushroomers === 0 && p0.sizeRank === 1 && p0.biggerCount === 0 && p0.percentile === 100,
  'get_species_percentile: brak danych → collected 0 (stan „pierwszy okaz w gminie”), sizeRank 1, percentile 100',
  p0,
);
ok(
  (await code('get_species_percentile', 'nie-ma', 'cisek', 1))?.code === 'P0002' && (await code('get_species_percentile', 'smardz-jadalny', 'nie-ma', 1))?.code === 'P0002',
  'get_species_percentile: nieznany gatunek / gmina → P0002',
);

// ── Uprawnienia ──
const internal4 = [
  await err('select refresh_gmina_rankings()'),
  await err('select ensure_rankings_fresh()'),
  await err(`select ensure_weekly_challenge('cisek')`),
  await err(`select resolve_voivodeship('opolskie', $1)`, [R4]),
  await err(`select dev_seed_voivodeship('opolskie', 1)`),
  await err(`select dev_ensure_bot('x.bot', 'X', 'X')`),
  await err('select * from gmina_rankings_refresh'),
];
ok(internal4.every((e) => e?.message.includes('permission denied')), 'klient nie wywoła funkcji wewnętrznych etapu 4 i nie czyta gmina_rankings_refresh', internal4);
ok((await db.query('select voivodeship, voivodeship_rank from gmina_rankings limit 1')).rows.length === 1, 'gmina_rankings: nowe kolumny czytelne dla klientów');
await as(null);
await db.exec('set role anon');
ok(
  (await err(`select get_ranking('week')`))?.message.includes('permission denied') && (await err(`select get_gmina_stats('cisek')`))?.message.includes('permission denied'),
  'anon nie ma get_ranking() / get_gmina_stats()',
);

// ── Generator aktywności (dev) ──
await admin();
const R5 = await newUser('rank.five');
const lubGmina = (await one(`select id from gminy where voivodeship = 'lubuskie' order by id limit 1`)).id;
await db.query('update profiles set home_gmina_id = $2 where id = $1', [R5, lubGmina]);
await db.exec(`update app_config set value = 'false' where key = 'dev_tools'`);
await as(R5);
ok(
  (await code('dev_seed_activity'))?.message.includes('dev_tools_disabled') && (await code('dev_refresh_rankings'))?.message.includes('dev_tools_disabled'),
  'dev_seed_activity / dev_refresh_rankings bez app_config.dev_tools → P0001 dev_tools_disabled',
);
await admin();
await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
const realBefore = await one(
  `select (select count(*) from finds f join profiles p on p.id = f.user_id where not p.is_bot) f,
          (select coalesce(sum(e.amount), 0) from xp_events e join profiles p on p.id = e.user_id where not p.is_bot) xp`,
);
await as(R5);
const t0 = Date.now();
const gen = await one('select dev_seed_activity(null, 1) r').then((x) => x.r);
const genMs = Date.now() - t0;
await admin();
const botStats4 = await one(
  `select count(*) filter (where p.handle like 'bot08.%') lub, count(*) filter (where p.handle like 'bot20.%') pdl,
          bool_and(p.is_bot) all_bots, count(*) filter (where p.home_gmina_id is null) no_home
     from profiles p where p.handle like 'bot__.%'`,
);
const botFinds = await one(
  `select count(*) n,
          bool_and(f.status = 'claimed' and f.visible_from = f.found_at + interval '24 hours' and f.found_at > now() - interval '8 days'
                   and f.found_at <= now() and f.trip_id is not null) ok,
          count(*) filter (where s.rarity = 'pospolity') posp, count(*) filter (where s.rarity = 'rzadki') rz,
          count(*) filter (where f.found_at > now() - interval '24 hours') recent,
          (select count(*) from xp_events e join profiles p on p.id = e.user_id where p.handle like 'bot__.%' and e.source = 'find') xp_n,
          (select count(*) from xp_events e join finds f2 on f2.id::text = e.ref_id
            where e.created_at = f2.found_at and e.amount = f2.xp and e.gmina_id = f2.gmina_id and e.user_id = f2.user_id) xp_match,
          (select bool_and(p2.total_xp = (select coalesce(sum(e.amount), 0) from xp_events e where e.user_id = p2.id)
                           and p2.level = (level_from_total_xp(p2.total_xp)).level)
             from profiles p2 where p2.handle like 'bot__.%') totals_ok
     from finds f join profiles p on p.id = f.user_id join species s on s.id = f.species_id
    where p.handle like 'bot__.%'`,
);
ok(
  gen.voivodeship === 'lubuskie' && gen.bots === 60 && gen.finds > 0 && gen.gminy > 0 && gen.podlaskie?.bots === 60 &&
    Number(botStats4.lub) === 60 && Number(botStats4.pdl) === 60 && botStats4.all_bots && Number(botStats4.no_home) === 0,
  `dev_seed_activity(null): województwo gminy domowej (lubuskie) + podlaskie, po 60 cichych botów z gminą domową (${genMs} ms)`,
  { gen, botStats4 },
);
ok(
  botFinds.ok && Number(botFinds.n) === gen.finds + gen.podlaskie.finds && Number(botFinds.xp_n) === Number(botFinds.n) &&
    Number(botFinds.xp_match) >= Number(botFinds.n) && Number(botFinds.posp) > Number(botFinds.rz) && Number(botFinds.recent) > 0 &&
    botFinds.totals_ok === true,
  'dev_seed_activity: odebrane znaleziska z wyprawą, visible_from = znalezienie + 24 h, wpis XP (find) z czasem znaleziska; pospolite ≫ rzadkie; część z ostatnich 24 h; XP i poziom botów = księga (wyzwalacz wsadowy)',
  botFinds,
);
await as(R5);
const lubRank = await ranking('season', 'lubuskie');
ok(
  lubRank.rows.length > 0 && lubRank.rows[0].rank === 1 && lubRank.rows.every((r, i) => i === 0 || r.rank >= lubRank.rows[i - 1].rank) &&
    lubRank.rows.every((r) => r.points > 0 && r.mushroomers > 0) && Object.keys(lubRank.heat).length === lubRank.rows.length,
  `dev_seed_activity → ranking sezonu województwa (${lubRank.rows.length} gmin)`,
);
const gen2 = await call('dev_seed_activity', 'lubuskie', 1);
await admin();
const realAfter = await one(
  `select (select count(*) from finds f join profiles p on p.id = f.user_id where not p.is_bot) f,
          (select coalesce(sum(e.amount), 0) from xp_events e join profiles p on p.id = e.user_id where not p.is_bot) xp,
          (select count(*) from profiles where handle like 'bot__.%') bots`,
);
ok(
  gen2.bots === 60 && gen2.finds === 0 && gen2.podlaskie?.finds === 0 && Number(realAfter.bots) === 120 && realAfter.f === realBefore.f &&
    realAfter.xp === realBefore.xp,
  'dev_seed_activity ponownie (od razu): bez nowych botów i znalezisk (dopisuje tylko okres od poprzedniego wywołania); dane prawdziwych graczy bez zmian',
  { gen2, realBefore, realAfter },
);
const botFindsBefore = (await one(`select count(*) n from finds f join profiles p on p.id = f.user_id where p.is_bot`)).n;
await as(R5);
const ref = await call('dev_refresh_rankings');
await call('dev_reset_player');
await admin();
ok(
  ISO_RE.test(ref.computedAt) && ref.season >= lubRank.rows.length && typeof ref.week === 'number' && typeof ref.records === 'number' &&
    (await one(`select count(*) n from finds f join profiles p on p.id = f.user_id where p.is_bot`)).n === botFindsBefore,
  'dev_refresh_rankings: przelicza (liczby gmin w okresach); dev_reset_player nie rusza danych botów',
  ref,
);

// =============================================================================
// Etap 5 – zdjęcia w Storage: koszyki, polityki storage.objects (atrapa), ścieżki w bazie, avatarPath / coverPath /
// photoPath, listed (ciche boty poza wyszukiwarką), storagePaths w dev_reset_player
// =============================================================================
await admin();
const bucketRows = (await db.query('select id, public, file_size_limit, allowed_mime_types from storage.buckets')).rows;
const bk = Object.fromEntries(bucketRows.map((b) => [b.id, b]));
ok(
  bk['scan-photos'].public === false && Number(bk['scan-photos'].file_size_limit) === 2 * 1024 * 1024 &&
    bk['post-media'].public === true && Number(bk['post-media'].file_size_limit) === 2 * 1024 * 1024 &&
    bk.avatars.public === true && Number(bk.avatars.file_size_limit) === 512 * 1024 &&
    bucketRows.every((b) => b.allowed_mime_types.join() === 'image/jpeg,image/png,image/webp'),
  'koszyki: scan-photos prywatny 2 MB, post-media i avatars publiczne (2 MB / 512 KB), tylko jpeg / png / webp',
  bucketRows,
);
const storagePol = (await db.query(`select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1`)).rows;
ok(
  storagePol.map((p) => `${p.policyname}:${p.cmd}`).join() ===
    'zdjecia: odczyt wlasnych:SELECT,zdjecia: podmiana wlasnych:UPDATE,zdjecia: usuniecie wlasnych:DELETE,zdjecia: zapis wlasnych:INSERT',
  'storage.objects: 4 polityki (odczyt / zapis / podmiana / usunięcie we własnym folderze), stare zastąpione',
  storagePol,
);

const S1 = await newUser('foto.jeden');
const S2 = await newUser('foto.dwa');
await db.query(`update profiles set display_name = 'Foto Jeden' where id = $1`, [S1]);
const putObj = (bucket, name) => err('insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())', [bucket, name]);
await as(S1);
const ownPut = [await putObj('scan-photos', `${S1}/f1.jpg`), await putObj('post-media', `${S1}/t-abc.jpg`), await putObj('avatars', `${S1}/avatar-1.jpg`)];
const badPut = [
  await putObj('scan-photos', `${S2}/x.jpg`),
  await putObj('post-media', `${S2}/x.jpg`),
  await putObj('avatars', `${S2}/x.jpg`),
  await putObj('avatars', 'x.jpg'),
  await putObj('inny-koszyk', `${S1}/x.jpg`),
];
ok(
  ownPut.every((e) => e === null) && badPut.every((e) => e?.message.includes('row-level security')),
  'storage.objects (RLS): zapis tylko do własnego folderu w trzech koszykach; cudzy folder, katalog główny i inny koszyk – odrzucone',
  { ownPut, badPut },
);
await as(S2);
const s2Sees = (await db.query('select * from storage.objects')).rows.length;
const s2Upd = await db.query('update storage.objects set name = $1 where name = $2', [`${S2}/skradzione.jpg`, `${S1}/f1.jpg`]);
const s2Del = await db.query('delete from storage.objects where name like $1', [`${S1}/%`]);
await as(S1);
const s1Sees = (await db.query('select bucket_id from storage.objects order by 1')).rows.map((r) => r.bucket_id).join();
const s1Move = await err('update storage.objects set name = $1 where name = $2', [`${S2}/f1.jpg`, `${S1}/f1.jpg`]);
const s1Del = await db.query('delete from storage.objects where name = $1', [`${S1}/avatar-1.jpg`]);
ok(
  s2Sees === 0 && s2Upd.affectedRows === 0 && s2Del.affectedRows === 0 && s1Sees === 'avatars,post-media,scan-photos' &&
    s1Move?.message.includes('row-level security') && s1Del.affectedRows === 1,
  'storage.objects (RLS): cudzych plików nie widać, nie podmienisz ani nie usuniesz; własne tak, bez przenoszenia do cudzego folderu',
  { s2Sees, s1Sees, s1Move },
);

// ── set_find_photo ──
const TS = randomUUID();
await startTrip('suprasl', TS, iso(2 * H));
const FS = randomUUID();
await submit({ id: FS, tripId: TS, gminaId: 'suprasl', foundAt: iso(H) });
const findPhoto = `${S1}/${FS}.jpg`;
await call('set_find_photo', FS, findPhoto);
await call('set_find_photo', FS, findPhoto);
const gsPhoto = await state();
ok(
  gsPhoto.finds.find((f) => f.id === FS)?.photoPath === findPhoto && gsPhoto.finds.every((f) => 'photoPath' in f) && gsPhoto.profile.avatarPath === null,
  'set_find_photo: ścieżka → get_game_state finds[].photoPath (idempotentnie); profile.avatarPath null bez zdjęcia',
  gsPhoto.finds.map((f) => f.photoPath),
);
const okPaths = [`${S1}/finds/${FS}-a1.JPG`, `${S1}/${FS}.jpeg`, `${S1}/${FS}.png`, `${S1}/${FS}.webp`];
const okRes = [];
for (const pth of okPaths) okRes.push(await code('set_find_photo', FS, pth));
const badPaths = [
  `${S2}/${FS}.jpg`, `${FS}.jpg`, `${S1}/${FS}.gif`, `${S1}/${FS}`, `${S1}/../${S2}/x.jpg`, `${S1}/.ukryty.jpg`, `${S1}//x.jpg`,
  `scan-photos/${S1}/x.jpg`, `${S1}/x.jpg `, `${S1}/${'a'.repeat(300)}.jpg`, '',
];
const badRes = [];
for (const pth of badPaths) badRes.push(await code('set_find_photo', FS, pth));
ok(
  okRes.every((e) => e === null) && badRes.every((e) => e?.code === 'P0001' && e.message.includes('invalid_path')),
  'set_find_photo: podfoldery i .jpg/.jpeg/.png/.webp (bez wielkości liter) OK; cudzy folder, brak folderu, inne rozszerzenie, „..”, nazwa bucketa w ścieżce, > 300 znaków → P0001 invalid_path',
  badRes.map((e, i) => (e?.code === 'P0001' ? 'ok' : `${badPaths[i]}: ${JSON.stringify(e)}`)),
);
await call('set_find_photo', FS, null);
const clearedPhoto = (await state()).finds.find((f) => f.id === FS)?.photoPath;
await call('set_find_photo', FS, findPhoto);
await as(S2);
const foreignPhoto = [await code('set_find_photo', FS, `${S2}/${FS}.jpg`), await code('set_find_photo', randomUUID(), `${S2}/x.jpg`)];
await admin();
const stillPhoto = (await one('select photo_path from finds where id = $1', [FS])).photo_path;
const findCheck = await err('update finds set photo_path = $2 where id = $1', [FS, `${S2}/x.jpg`]);
ok(
  clearedPhoto === null && foreignPhoto.every((e) => e?.code === 'P0002' && e.message.includes('find_not_found')) && stillPhoto === findPhoto &&
    findCheck?.code === '23514' && findCheck.message.includes('finds_photo_path_check'),
  'set_find_photo: null czyści; cudze / nieznane znalezisko → P0002 find_not_found; CHECK w bazie pilnuje folderu właściciela',
  { foreignPhoto, findCheck },
);

// ── publish_trip z okładką, set_post_cover ──
await as(S1);
await one('select * from finish_trip($1, 1500, 3600, null, null)', [TS]);
const coverA = `${S1}/${TS}-k7f3q9.jpg`;
const badCover = await err('select * from publish_trip($1, false, $2, $3)', [TS, 'Z okładką', `${S2}/${TS}-x.jpg`]);
ok(
  badCover?.code === 'P0001' && badCover.message.includes('invalid_path') && (await one('select status from trips where id = $1', [TS])).status === 'finished',
  'publish_trip: okładka spoza folderu gracza → P0001 invalid_path (wyprawa nieopublikowana)',
);
const pc = await one('select * from publish_trip($1, false, $2, $3)', [TS, 'Z okładką', coverA]);
const pcAgain = await one('select * from publish_trip($1, false, null, $2)', [TS, `${S1}/${TS}-inna.jpg`]);
const pcTwoArgs = await one('select * from publish_trip($1, false)', [TS]);
ok(
  pc.payload.cover_path === coverA && pc.payload.title === 'Z okładką' && pcAgain.id === pc.id && pcAgain.payload.cover_path === coverA &&
    pcTwoArgs.id === pc.id && (await code('publish_trip', TS, false, null, `${S2}/x.jpg`))?.code === 'P0001',
  'publish_trip(…, p_cover_path): payload.cover_path; ponowna publikacja – ten sam wpis, istniejąca okładka bez zmian',
  pc.payload,
);
const TS2 = randomUUID();
await startTrip('suprasl', TS2, iso(H / 2));
await one('select * from finish_trip($1, 800, 1200, null, null)', [TS2]);
const pn = await one('select * from publish_trip($1, true, null)', [TS2]);
const coverB = `${S1}/${TS2}-z9.webp`;
const pn2 = await one('select * from publish_trip($1, true, null, $2)', [TS2, coverB]);
ok(
  'cover_path' in pn.payload && pn.payload.cover_path === null && pn2.id === pn.id && pn2.payload.cover_path === coverB && pn2.payload.title === pn.payload.title,
  'publish_trip bez okładki (stare 3 argumenty) → cover_path null; ponowna publikacja z okładką ją ustawia',
);
const gpS1 = await call('get_post', pc.id);
await call('set_post_cover', pn.id, `${S1}/${TS2}-nowa.png`);
const coverSet = (await call('get_post', pn.id)).coverPath;
await call('set_post_cover', pn.id, `${S1}/${TS2}-nowa.png`);
await call('set_post_cover', pn.id, null);
const coverCleared = await call('get_post', pn.id);
const coverErr = [
  await code('set_post_cover', pn.id, `${S2}/x.png`),
  await code('set_post_cover', pn.id, 'x.png'),
  await code('set_post_cover', randomUUID(), `${S1}/x.png`),
];
await as(S2);
coverErr.push(await code('set_post_cover', pn.id, `${S2}/x.png`));
await as(S1);
await db.query('update posts set deleted_at = now() where id = $1', [pn.id]);
coverErr.push(await code('set_post_cover', pn.id, `${S1}/x.png`));
ok(
  gpS1.coverPath === coverA && coverSet === `${S1}/${TS2}-nowa.png` && coverCleared.coverPath === null && coverCleared.payload.cover_path === null &&
    coverErr[0]?.code === 'P0001' && coverErr[1]?.code === 'P0001' && coverErr.slice(2).every((e) => e?.code === 'P0002' && e.message.includes('post_not_found')),
  'get_post → coverPath; set_post_cover: ustawia / podmienia / null czyści; zła ścieżka → P0001, cudzy / nieznany / usunięty wpis → P0002 (usunięcie wpisu przez klienta działa z CHECK)',
  coverErr,
);
await admin();
const postCheck = await err(`update posts set payload = payload || jsonb_build_object('cover_path', $2::text) where id = $1`, [pc.id, `${S2}/x.jpg`]);
const botPostId = (await one(`select x.id from posts x join profiles p on p.id = x.author_id where p.is_bot and x.visible_from <= now() limit 1`)).id;
ok(postCheck?.code === '23514' && postCheck.message.includes('posts_cover_path_check'), 'posts: CHECK – okładka tylko z folderu autora', postCheck);

// ── avatar_path (zwykły update profilu, CHECK) ──
await as(S1);
const avatar = `${S1}/avatar-q1w2.jpg`;
await db.query('update profiles set avatar_path = $2 where id = $1', [S1, avatar]);
const avBad = [
  await err('update profiles set avatar_path = $2 where id = $1', [S1, `${S2}/avatar.jpg`]),
  await err('update profiles set avatar_path = $2 where id = $1', [S1, `${S1}/avatar.gif`]),
  await err('update profiles set avatar_path = $2 where id = $1', [S1, 'avatar.jpg']),
  await err('update profiles set avatar_path = $2 where id = $1', [S1, `avatars/${S1}/avatar.jpg`]),
];
await db.query(`update profiles set display_name = 'Foto Jeden' where id = $1`, [S1]);
ok(
  avBad.every((e) => e?.code === '23514' && e.message.includes('profiles_avatar_path_check')) &&
    (await one('select avatar_path from profiles where id = $1', [S1])).avatar_path === avatar && (await state()).profile.avatarPath === avatar,
  'profiles.avatar_path: własny folder + rozszerzenie obrazu; cudzy folder / .gif / bez folderu / z nazwą koszyka → 23514 (CHECK); get_game_state → profile.avatarPath',
  avBad.map((e) => e?.code),
);
await db.query('update profiles set avatar_path = null where id = $1', [S1]);
await db.query('update profiles set avatar_path = $2 where id = $1', [S1, avatar]);

// avatarPath / coverPath we wszystkich odczytach etapu 3.
await admin();
await db.query(`update posts set visible_from = now() - interval '1 minute' where id = $1`, [pc.id]);
await as(S2);
await call('send_friend_request', S1);
const s2Out = (await call('get_friends')).outgoing.find((u) => u.id === S1);
await as(S1);
const s1In = (await call('get_friends')).incoming.find((u) => u.id === S2);
await call('respond_friend_request', S2, true);
await as(S2);
const s2Feed = (await feed('friends')).find((x) => x.id === pc.id);
const s2Post = await call('get_post', pc.id);
const s2User = await call('get_user', S1);
const s2ByHandle = await call('get_user_by_handle', '@foto.jeden');
const s2Search = (await call('search_users', 'foto jeden')).find((u) => u.id === S1);
const s2Friends = (await call('get_friends')).friends.find((u) => u.id === S1);
const s2Comment = await call('add_comment', pc.id, 'Piękna okładka!');
const botPost = await call('get_post', botPostId);
await as(S1);
const s1Comments = await call('get_comments', pc.id);
const s1Act = await call('get_activity');
ok(
  s2Out?.avatarPath === avatar && s1In && 'avatarPath' in s1In && s1In.avatarPath === null &&
    s2Feed?.coverPath === coverA && s2Feed.author.avatarPath === avatar && s2Post.coverPath === coverA && s2Post.author.avatarPath === avatar &&
    s2User.avatarPath === avatar && s2ByHandle?.avatarPath === avatar && s2Search?.avatarPath === avatar && s2Friends?.avatarPath === avatar &&
    s2Comment.author.avatarPath === null && s1Comments.find((c) => c.id === s2Comment.id)?.author.avatarPath === null &&
    s1Act.every((x) => 'avatarPath' in x.actor) && s1Act.some((x) => x.kind === 'comment' && x.actor.id === S2) &&
    botPost.coverPath === null && 'coverPath' in botPost && botPost.author.avatarPath === null,
  'avatarPath (autor / grzybiarz: feed, wpis, komentarze, wyszukiwarka, znajomi, get_user, get_user_by_handle, aktywność) i coverPath wpisu (null bez okładki)',
  { s2Feed: s2Feed && { coverPath: s2Feed.coverPath, author: s2Feed.author }, botPost: { coverPath: botPost.coverPath } },
);

// ── listed: ciche boty generatora poza wyszukiwarką ──
await admin();
const listedStats = await one(
  `select count(*) filter (where not listed) unlisted, count(*) filter (where handle ~ '^bot[0-9]{2}\\.') gen,
          count(*) filter (where is_bot and listed) social, bool_and(listed) filter (where not is_bot) real_listed,
          bool_and(not listed) filter (where handle ~ '^bot[0-9]{2}\\.') gen_unlisted
     from profiles`,
);
const quietBot = await one(`select id, handle from profiles where handle like 'bot20.%' order by handle limit 1`);
await as(S1);
const qSearch = await call('search_users', 'bot20', 50);
const annaSearch = await call('search_users', 'anna', 50);
const suggS1 = await call('search_users', '', 50);
const qUser = await call('get_user', quietBot.id);
const qByHandle = await call('get_user_by_handle', quietBot.handle);
ok(
  Number(listedStats.unlisted) === 120 && Number(listedStats.gen) === 120 && listedStats.gen_unlisted === true && Number(listedStats.social) === 12 &&
    listedStats.real_listed === true && qSearch.length === 0 && !annaSearch.some((u) => /^bot\d\d\./.test(u.handle)) &&
    suggS1.length > 0 && !suggS1.some((u) => /^bot\d\d\./.test(u.handle)) && suggS1.some((u) => u.handle === 'ola.w' || u.handle === 'jurek.puszcza') &&
    qUser.id === quietBot.id && 'avatarPath' in qUser && qByHandle?.id === quietBot.id,
  'listed: 120 cichych botów generatora (bot20.*, bot08.*) poza search_users (fraza i propozycje), boty społecznościowe i gracze widoczni; get_user / get_user_by_handle działają',
  { listedStats, qSearch: qSearch.length, sugg: suggS1.slice(0, 3).map((u) => u.handle) },
);
ok((await err('update profiles set listed = false where id = $1', [S1]))?.message.includes('permission denied'), 'profiles.listed: klient nie zmieni (tylko serwer)');

// ── dev_reset_player → storagePaths ──
await as(S1);
const resetS = await call('dev_reset_player');
const sp = resetS.storagePaths;
await admin();
const s1Left = await one(
  `select (select count(*) from finds where user_id = $1) f, (select count(*) from posts where author_id = $1) p,
          (select avatar_path from profiles where id = $1) av, (select display_name from profiles where id = $1) name`,
  [S1],
);
ok(
  keys(resetS) === 'achievements,atlas,badges,challenges,counters,finds,followedGminy,profile,quests,serverTime,storagePaths,trips,userId' &&
    keys(sp) === 'avatars,post-media,scan-photos' && JSON.stringify(sp['scan-photos']) === JSON.stringify([findPhoto]) &&
    JSON.stringify(sp['post-media']) === JSON.stringify([coverA]) && JSON.stringify(sp.avatars) === JSON.stringify([avatar]) &&
    resetS.profile.avatarPath === null && resetS.finds.length === 0 && Number(s1Left.f) === 0 && Number(s1Left.p) === 0 &&
    s1Left.av === null && s1Left.name === 'Foto Jeden',
  'dev_reset_player: wynik = get_game_state() + storagePaths {scan-photos, post-media, avatars} (pliki do usunięcia przez aplikację); avatar_path, zdjęcia i okładki skasowane z danymi',
  { sp, s1Left },
);
await as(S1);
const resetS2 = (await call('dev_reset_player')).storagePaths;
ok(
  JSON.stringify(resetS2['scan-photos']) === '[]' && JSON.stringify(resetS2['post-media']) === '[]' && JSON.stringify(resetS2.avatars) === '[]',
  'dev_reset_player ponownie: storagePaths – puste tablice (nigdy null)',
);

// ── Uprawnienia etapu 5 ──
ok((await err('select user_storage_paths($1)', [S1]))?.message.includes('permission denied'), 'klient nie wywoła user_storage_paths');
await admin();
ok(Number((await one(`select count(*) n from pg_proc where proname = 'publish_trip'`)).n) === 1, 'publish_trip: jedna wersja (stara 3-argumentowa usunięta)');
await as(null);
await db.exec('set role anon');
ok(
  (await err('select set_find_photo($1, null)', [FS]))?.message.includes('permission denied') &&
    (await err('select set_post_cover($1, null)', [pc.id]))?.message.includes('permission denied') &&
    (await err('select * from publish_trip($1, false, null, null)', [TS]))?.message.includes('permission denied'),
  'anon nie ma set_find_photo / set_post_cover / publish_trip',
);

// =============================================================================
// Etap 6 – konto: regulamin i onboarding, blokowanie (w obie strony), eksport danych (RODO), usunięcie konta
// =============================================================================
await admin();
const K1 = await mkUser('konto.jeden', 'Konto Jeden', 'Kamil', 'gromadka', 2);
const K2 = await mkUser('konto.dwa', 'Konto Dwa', 'Karol', 'gromadka', 4);
const K3 = await mkUser('konto.trzy', 'Konto Trzy', 'Kinga', 'gromadka', 1);

// ── Regulamin i onboarding ──
await as(K1);
const st0 = (await state()).profile;
await call('accept_terms', '  2026-10-06  ');
const st1 = (await state()).profile;
await sleep(5);
await call('accept_terms', '2026-10-06');
const st2 = (await state()).profile;
const badTerms = [
  await code('accept_terms', ''),
  await code('accept_terms', '   '),
  await code('accept_terms', 'x'.repeat(33)),
  await code('accept_terms', null),
];
ok(
  st0.termsVersion === null && st0.termsAcceptedAt === null && st0.onboardedAt === null && st1.termsVersion === '2026-10-06' &&
    ISO_RE.test(st1.termsAcceptedAt) && st2.termsAcceptedAt === st1.termsAcceptedAt &&
    badTerms.every((e) => e?.code === 'P0001' && e.message.includes('invalid_terms_version')),
  'accept_terms: wersja (obcięta) i czas w get_game_state; ta sama wersja ponownie → bez zmian; pusta / > 32 znaki / null → P0001 invalid_terms_version',
  { st1, badTerms },
);
await sleep(5);
await call('accept_terms', '2026-11-01');
const st3 = (await state()).profile;
const termsHist = (await db.query('select version from user_terms_acceptances order by accepted_at')).rows.map((r) => r.version);
await as(K2);
const termsHistK2 = (await db.query('select * from user_terms_acceptances')).rows.length;
ok(
  st3.termsVersion === '2026-11-01' && st3.termsAcceptedAt > st1.termsAcceptedAt && termsHist.join() === '2026-10-06,2026-11-01' && termsHistK2 === 0,
  'accept_terms: nowa wersja → profil z nową wersją i czasem, historia akceptacji (RLS: tylko własna)',
  { st3, termsHist },
);
await as(K1);
await call('complete_onboarding');
const ob1 = (await state()).profile.onboardedAt;
await sleep(5);
await call('complete_onboarding');
const ob2 = (await state()).profile.onboardedAt;
const directTerms = [
  await err(`update profiles set terms_version = 'hack' where id = $1`, [K1]),
  await err('update profiles set terms_accepted_at = now() where id = $1', [K1]),
  await err('update profiles set onboarded_at = null where id = $1', [K1]),
  await err('update profiles set deleted_at = now() where id = $1', [K1]),
  await err(`insert into user_terms_acceptances (user_id, version) values ($1, 'x')`, [K1]),
];
ok(
  ISO_RE.test(ob1) && ob2 === ob1 && directTerms.every((e) => e?.message.includes('permission denied')),
  'complete_onboarding: onboardedAt raz (idempotentne); klient nie zmieni terms_* / onboarded_at / deleted_at ani historii bezpośrednio',
  directTerms,
);

// ── Blokowanie: skutki w obie strony ──
await admin();
const P1 = await insPost(K1, 'gromadka', 3, -1);
const P2 = await insPost(K2, 'gromadka', 2, -1);
await as(K1);
await call('send_friend_request', K2);
await as(K2);
await call('respond_friend_request', K1, true);
const cK2onP1 = await call('add_comment', P1, 'Komentarz K2 pod wpisem K1');
await one('select * from toggle_reaction($1)', [P1]);
await as(K3);
const cK3onP1 = await call('add_comment', P1, 'Komentarz K3 pod wpisem K1');
const cK3onP2 = await call('add_comment', P2, 'Komentarz K3 pod wpisem K2');
await as(K1);
const cK1onP2 = await call('add_comment', P2, 'Komentarz K1 pod wpisem K2');
const pre = { gmina: ids(await feed('gmina')), friends: ids(await feed('friends')), act: ids(await call('get_activity')) };
ok(
  pre.gmina.includes(P2) && pre.friends.includes(P2) && pre.act.includes(`reaction:${P1}:${K2}`) && pre.act.includes(`comment:${cK2onP1.id}`) &&
    (await call('get_user', K2)).blocked === false,
  'blokady – stan przed: K1 i K2 znajomi, wpis K2 w feedzie K1, aktywność K2 u K1, get_user → blocked: false',
);
await call('block_user', K2);
await call('block_user', K2);
await admin();
const blk = await one(
  `select (select count(*) from user_blocks where blocker_id = $1 and blocked_id = $2) b,
          (select count(*) from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)) f`,
  [K1, K2],
);
ok(Number(blk.b) === 1 && Number(blk.f) === 0, 'block_user: jedna blokada (idempotentne), znajomość między graczami usunięta', blk);

// Blokujący (K1) nie widzi zablokowanego (K2).
await as(K1);
const viewK1 = {
  gmina: ids(await feed('gmina')),
  friends: ids(await feed('friends')),
  errs: [
    await code('get_post', P2),
    await code('add_comment', P2, 'hej'),
    await code('toggle_reaction', P2),
    await code('get_comments', P2),
    await code('hide_post', P2),
    await code('report_post', P2),
  ],
  ownComments: (await call('get_comments', P1)).map((c) => c.author.id),
  ownPost: await call('get_post', P1),
  act: ids(await call('get_activity')),
  friendList: (await call('get_friends')).friends.map((u) => u.id),
  user: await call('get_user', K2),
  byHandle: await call('get_user_by_handle', '@konto.dwa'),
  search: ids(await call('search_users', 'konto', 50)),
  sugg: ids(await call('search_users', '', 50)),
  request: await code('send_friend_request', K2),
  blockedList: await call('get_blocked_users'),
};
ok(
  !viewK1.gmina.includes(P2) && !viewK1.friends.includes(P2) && viewK1.errs.every((e) => e?.code === 'P0002' && e.message.includes('post_not_found')),
  'blokada: wpis zablokowanego znika z feedu (oba zakresy); get_post / add_comment / toggle_reaction / get_comments / hide_post / report_post → P0002',
  viewK1.errs,
);
ok(
  viewK1.ownComments.includes(K3) && !viewK1.ownComments.includes(K2) && viewK1.ownPost.comments === 1 &&
    !viewK1.act.includes(`reaction:${P1}:${K2}`) && !viewK1.act.includes(`comment:${cK2onP1.id}`) && viewK1.act.includes(`comment:${cK3onP1.id}`) &&
    !viewK1.friendList.includes(K2),
  'blokada: pod własnym wpisem bez komentarzy zablokowanego (także licznik „comments”), aktywność bez jego reakcji i komentarzy, nie ma go wśród znajomych',
  { ownPostComments: viewK1.ownPost.comments, act: viewK1.act },
);
ok(
  viewK1.user.blocked === true && viewK1.user.friendStatus === 'none' && viewK1.byHandle?.id === K2 && viewK1.byHandle.blocked === true &&
    !viewK1.search.includes(K2) && viewK1.search.includes(K3) && !viewK1.sugg.includes(K2) &&
    viewK1.request?.code === 'P0001' && viewK1.request.message.includes('blocked'),
  'blokada: get_user / get_user_by_handle zablokowanego → "blocked": true; poza wyszukiwarką (fraza i propozycje); send_friend_request → P0001 blocked',
  { user: viewK1.user, request: viewK1.request },
);
ok(
  viewK1.blockedList.length === 1 && viewK1.blockedList[0].id === K2 && viewK1.blockedList[0].blocked === true && ISO_RE.test(viewK1.blockedList[0].blockedAt) &&
    keys(viewK1.blockedList[0]) === `${AUTHOR_KEYS},blocked,blockedAt`.split(',').sort().join() && viewK1.blockedList[0].handle === 'konto.dwa',
  'get_blocked_users: autor (z avatarPath) + blocked, blockedAt',
  viewK1.blockedList,
);

// Zablokowany (K2) nie widzi blokującego (K1) – i nie wie wprost, że jest zablokowany.
await as(K2);
const viewK2 = {
  gmina: ids(await feed('gmina')),
  errs: [
    await code('get_post', P1),
    await code('add_comment', P1, 'hej'),
    await code('toggle_reaction', P1),
    await code('get_comments', P1),
  ],
  ownComments: (await call('get_comments', P2)).map((c) => c.author.id),
  user: await code('get_user', K1),
  byHandle: await call('get_user_by_handle', 'konto.jeden'),
  search: ids(await call('search_users', 'konto', 50)),
  sugg: ids(await call('search_users', '', 50)),
  request: await code('send_friend_request', K1),
  blockedList: await call('get_blocked_users'),
  blocksVisible: (await db.query('select * from user_blocks')).rows.length,
  blockInsert: await err('insert into user_blocks (blocker_id, blocked_id) values ($1, $2)', [K2, K1]),
  directFriend: await err('insert into friendships (friend_id) values ($1)', [K1]),
  directPost: (await db.query('select id from posts where id = $1', [P1])).rows.length,
  directComments: (await db.query('select id from post_comments where author_id = $1', [K1])).rows.length,
  directReactions: (await db.query('select post_id from post_reactions where user_id = $1', [K1])).rows.length,
};
await admin();
const directFriendRows = Number((await one('select count(*) n from friendships where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)', [K1, K2])).n);
ok(
  !viewK2.gmina.includes(P1) && viewK2.errs.every((e) => e?.code === 'P0002') && viewK2.ownComments.includes(K3) && !viewK2.ownComments.includes(K1),
  'blokada w drugą stronę: zablokowany nie widzi wpisów blokującego (feed, get_post, add_comment, toggle_reaction, get_comments → P0002), a pod swoim wpisem – jego komentarzy',
  viewK2.errs,
);
ok(
  viewK2.user?.code === 'P0002' && viewK2.user.message.includes('user_not_found') && viewK2.byHandle === null && !viewK2.search.includes(K1) && !viewK2.sugg.includes(K1) &&
    viewK2.request?.code === 'P0001' && viewK2.request.message.includes('blocked') && viewK2.blockedList.length === 0,
  'zablokowany: get_user blokującego → P0002 user_not_found, get_user_by_handle → null, poza wyszukiwarką, send_friend_request → P0001 blocked, get_blocked_users → []',
  { user: viewK2.user, request: viewK2.request },
);
ok(
  viewK2.blocksVisible === 0 && viewK2.blockInsert?.message.includes('permission denied') && viewK2.directFriend === null && directFriendRows === 0 &&
    viewK2.directPost === 0 && viewK2.directComments === 0 && viewK2.directReactions === 0,
  'RLS: zablokowany nie widzi cudzych blokad ani nie zapisze blokady wprost; bezpośredni INSERT do friendships – pominięty (bez relacji); posty / komentarze / reakcje blokującego niewidoczne także poza RPC',
  { blockInsert: viewK2.blockInsert, directFriend: viewK2.directFriend },
);

// Osoba trzecia widzi wszystko jak dotąd.
await as(K3);
const k3p1 = await call('get_post', P1);
const k3p2 = await call('get_comments', P2);
ok(
  k3p1.comments === 2 && k3p2.length === 2 && ids(await feed('gmina')).includes(P1) && ids(await feed('gmina')).includes(P2),
  'blokada nie zmienia widoku innych graczy (pełne komentarze i liczniki)',
);

// Błędy, blokada wzajemna, odblokowanie.
await as(K1);
const blockErrs = [await code('block_user', K1), await code('block_user', null), await code('block_user', randomUUID())];
ok(
  blockErrs[0]?.code === 'P0001' && blockErrs[0].message.includes('invalid_user') && blockErrs[1]?.code === 'P0001' && blockErrs[2]?.code === 'P0002',
  'block_user: siebie / null → P0001 invalid_user, nieznany → P0002 user_not_found',
  blockErrs,
);
await as(K2);
await call('block_user', K1);
const mutualUser = await call('get_user', K1);
await call('unblock_user', K1);
const afterOwnUnblock = await code('get_user', K1);
ok(
  mutualUser.blocked === true && afterOwnUnblock?.code === 'P0002',
  'blokada wzajemna: kto sam zablokował, widzi profil (blocked: true); po swoim odblokowaniu – znów P0002 (druga blokada trwa)',
);
await as(K1);
await call('unblock_user', K2);
await call('unblock_user', K2);
await call('unblock_user', randomUUID());
const unb = {
  gmina: ids(await feed('gmina')),
  user: await call('get_user', K2),
  comments: (await call('get_comments', P1)).map((c) => c.author.id),
  blocked: await call('get_blocked_users'),
  request: await call('send_friend_request', K2),
};
await as(K2);
const unbK2 = await call('get_user', K1);
ok(
  unb.gmina.includes(P2) && unb.user.blocked === false && unb.user.friendStatus === 'none' && unb.comments.includes(K2) && unb.blocked.length === 0 &&
    unb.request === 'outgoing' && unbK2.id === K1,
  'unblock_user (idempotentne): wpisy i komentarze wracają, znajomość nie wraca (nowe zaproszenie → outgoing), zablokowany znów widzi profil',
  unb,
);

// ── Eksport danych (RODO art. 15 / 20) ──
await as(K3);
await call('send_friend_request', K1);
await as(K1);
await call('respond_friend_request', K3, true);
await call('block_user', K2);                                            // usuwa też wysłane zaproszenie do K2
const TK1 = randomUUID();
await startTrip('gromadka', TK1, iso(3 * H));
const FK1 = randomUUID();
await submit({ id: FK1, tripId: TK1, gminaId: 'gromadka', foundAt: iso(2 * H) });
await call('claim_find', FK1);
await call('set_find_photo', FK1, `${K1}/${FK1}.jpg`);
const trackK1 = JSON.stringify({ type: 'LineString', coordinates: [[15.73, 51.4], [15.74, 51.405], [15.75, 51.41]] });
await one('select * from finish_trip($1, 2500, 3600, $2, null)', [TK1, trackK1]);
const postK1 = await one(`select * from publish_trip($1, false, 'Eksportowa wyprawa', $2)`, [TK1, `${K1}/${TK1}-okladka.jpg`]);
await call('follow_gmina', 'gromadka', true);
await db.query(`insert into push_tokens (token, platform) values ('ExponentPushToken[k1]', 'android')`);
await admin();
await db.query(`insert into find_locations (find_id, user_id, location, accuracy_m) values ($1, $2, 'SRID=4326;POINT(15.741 51.406)', 8)`, [FK1, K1]);
const P3 = await insPost(K3, 'gromadka', 2, -1);
await as(K1);
await call('hide_post', P3);
await call('report_post', P3, null, 'test');
await one('select * from toggle_reaction($1)', [P3]);
const exp = await call('export_my_data');
const expStr = JSON.stringify(exp);
const EXPORT_KEYS = [
  'account', 'achievements', 'atlas', 'badges', 'blocks', 'challenges', 'comments', 'exportedAt', 'finds', 'followedGminy', 'format',
  'friendships', 'hiddenPosts', 'posts', 'profile', 'pushTokens', 'quests', 'reactions', 'reports', 'scans', 'termsAcceptances', 'trips',
  'userId', 'xpLedger',
].join();
const expTrip = exp.trips.find((t) => t.id === TK1);
const expFind = exp.finds.find((f) => f.id === FK1);
const expIdent = exp.scans.flatMap((s) => s.identifications).find((i) => i.speciesId === 'borowik-szlachetny');
await admin();
const k1Db = await one(
  `select (select total_xp from profiles where id = $1) xp, (select count(*) from post_comments where author_id = $1) comments,
          (select count(*) from posts where author_id = $1) posts, (select count(*) from xp_events where user_id = $1) ledger`,
  [K1],
);
ok(
  keys(exp) === EXPORT_KEYS && exp.format === 'grzybobranie-export-v1' && ISO_RE.test(exp.exportedAt) && exp.userId === K1 &&
    exp.account.email === 'konto.jeden@example.com' && exp.account.isAnonymous === false &&
    keys(exp.account) === 'createdAt,email,emailConfirmedAt,isAnonymous,lastSignInAt' &&
    exp.profile.handle === 'konto.jeden' && exp.profile.termsVersion === '2026-11-01' && ISO_RE.test(exp.profile.onboardedAt) &&
    !('isBot' in exp.profile) && !('listed' in exp.profile) && exp.termsAcceptances.map((t) => t.version).join() === '2026-10-06,2026-11-01',
  'export_my_data: format v1, exportedAt, konto (e-mail, anonimowe?), profil bez pól wewnętrznych, historia regulaminu',
  { keys: keys(exp), account: exp.account },
);
ok(
  expTrip?.routePublic?.type === 'LineString' && expTrip.track?.type === 'LineString' && expTrip.track.coordinates.length === 3 &&
    expFind?.photoPath === `${K1}/${FK1}.jpg` && Math.abs(expFind.location.lon - 15.741) < 1e-9 && Math.abs(expFind.location.lat - 51.406) < 1e-9 &&
    expFind.location.accuracyM === 8 && expFind.status === 'claimed' && expIdent?.provider === 'client-sim' && !('raw' in expIdent) &&
    !('costUsd' in expIdent) && exp.xpLedger.length === Number(k1Db.ledger) &&
    exp.xpLedger.reduce((a, e) => a + e.amount, 0) === Number(k1Db.xp) && exp.atlas.some((a) => a.speciesId === 'borowik-szlachetny'),
  'export_my_data: wyprawy (routePublic + surowy ślad GPS), znaleziska (photoPath, dokładny punkt), skany z rozpoznaniami (bez raw / kosztu), księga XP = totalXp, atlas',
  { expTrip, expFind },
);
ok(
  exp.friendships.length === 1 && exp.friendships[0].handle === 'konto.trzy' && exp.friendships[0].status === 'friends' &&
    keys(exp.friendships[0]) === 'acceptedAt,createdAt,handle,status' && exp.blocks.map((b) => b.handle).join() === 'konto.dwa' &&
    exp.posts.length === Number(k1Db.posts) && exp.posts.some((p) => p.id === postK1.id && p.payload.title === 'Eksportowa wyprawa') &&
    exp.comments.length === Number(k1Db.comments) && exp.comments.some((c) => c.id === cK1onP2.id) &&
    exp.reactions.some((r) => r.postId === P3) && exp.hiddenPosts.some((h) => h.postId === P3) &&
    exp.reports.some((r) => r.postId === P3 && r.reason === 'test') && exp.followedGminy.some((g) => g.gminaId === 'gromadka') &&
    exp.pushTokens.some((t) => t.token === 'ExponentPushToken[k1]' && t.platform === 'android'),
  'export_my_data: znajomi i blokady (tylko nicki), własne wpisy z payload, komentarze, reakcje, ukryte, zgłoszenia, obserwowane gminy, tokeny push',
  { friendships: exp.friendships, blocks: exp.blocks },
);
ok(
  !expStr.includes(K2) && !expStr.includes(K3) && !expStr.includes('Komentarz K2 pod wpisem K1') && !expStr.includes('Komentarz K3 pod wpisem K1'),
  'export_my_data: bez danych innych graczy (ich id, treści ich komentarzy pod moimi wpisami) – tylko publiczne nicki',
);
await as(K2);
const exp2 = await call('export_my_data');
const exp2Str = JSON.stringify(exp2);
ok(
  exp2.userId === K2 && exp2.blocks.length === 0 && !exp2Str.includes(K1) && exp2.comments.every((c) => c.id !== cK1onP2.id) &&
    exp2.comments.some((c) => c.id === cK2onP1.id) && exp2.termsAcceptances.length === 0 && exp2.profile.termsVersion === null,
  'export_my_data innego gracza: tylko jego dane (bez informacji, kto go zablokował)',
);

// ── prepare_account_deletion ──
await as(K1);
const prep = await call('prepare_account_deletion');
await admin();
const prepDb = await one(
  `select (select count(*) from trips where user_id = $1) trips, (select count(*) from finds where user_id = $1 and status = 'claimed') finds,
          (select count(*) from posts where author_id = $1 and deleted_at is null) posts, (select count(*) from post_comments where author_id = $1) comments,
          (select count(*) from user_species where user_id = $1) species`,
  [K1],
);
ok(
  keys(prep) === 'counts,storagePaths' && keys(prep.storagePaths) === 'avatars,post-media,scan-photos' &&
    JSON.stringify(prep.storagePaths['scan-photos']) === JSON.stringify([`${K1}/${FK1}.jpg`]) &&
    JSON.stringify(prep.storagePaths['post-media']) === JSON.stringify([`${K1}/${TK1}-okladka.jpg`]) && JSON.stringify(prep.storagePaths.avatars) === '[]' &&
    keys(prep.counts) === 'comments,finds,friends,posts,species,trips' && prep.counts.trips === Number(prepDb.trips) &&
    prep.counts.finds === Number(prepDb.finds) && prep.counts.posts === Number(prepDb.posts) && prep.counts.comments === Number(prepDb.comments) &&
    prep.counts.species === Number(prepDb.species) && prep.counts.friends === 1,
  'prepare_account_deletion: storagePaths {scan-photos, post-media, avatars} (bez nazwy koszyka) + counts; nic nie kasuje',
  prep,
);

// ── delete_my_account: wszystkie dane + auth.users, inni gracze nietknięci ──
await as(K2);
await call('hide_post', P3);
await call('report_post', P2, cK3onP2.id, 'zgłoszenie komentarza K3');
await as(K3);
await call('accept_terms', '2026-11-01');
await call('block_user', K2);
await one('select * from toggle_reaction($1)', [P1]);
const TK3 = randomUUID();
await startTrip('gromadka', TK3, iso(2 * H));
const FK3 = randomUUID();
await submit({ id: FK3, tripId: TK3, gminaId: 'gromadka', speciesId: 'pieprznik-jadalny', rarity: 'pospolity', confidence: 0.9, foundAt: iso(H) });
await call('claim_find', FK3);
await one('select * from finish_trip($1, 1000, 1200, $2, null)', [TK3, trackK1]);
await db.query('update profiles set avatar_path = $2 where id = $1', [K3, `${K3}/avatar-x.jpg`]);
await call('follow_gmina', 'gromadka', true);
await db.query(`insert into push_tokens (token, platform) values ('ExponentPushToken[k3]', 'ios')`);
const prep3 = await call('prepare_account_deletion');
await admin();
const beforeDel = await one(
  `select (select comments_count from posts where id = $1) p1c, (select reactions_count from posts where id = $1) p1r,
          (select comments_count from posts where id = $2) p2c, (select count(*) from xp_events where user_id = $3) k3xp,
          (select count(*) from anti_cheat_flags where user_id = $3) k3flags`,
  [P1, P2, K3],
);
await as(K3);
const del3 = await call('delete_my_account');
await admin();
const countsFor = async (uid) =>
  one(
    `select (select count(*) from auth.users where id = $1) auth_user, (select count(*) from profiles where id = $1) profile,
            (select count(*) from trips where user_id = $1) trips, (select count(*) from trip_tracks where user_id = $1) tracks,
            (select count(*) from scans where user_id = $1) scans, (select count(*) from finds where user_id = $1) finds,
            (select count(*) from find_locations where user_id = $1) locations, (select count(*) from xp_events where user_id = $1) xp,
            (select count(*) from user_species where user_id = $1) atlas, (select count(*) from user_badges where user_id = $1) badges,
            (select count(*) from user_achievements where user_id = $1) achievements, (select count(*) from user_quests where user_id = $1) quests,
            (select count(*) from user_challenges where user_id = $1) challenges, (select count(*) from posts where author_id = $1) posts,
            (select count(*) from post_comments where author_id = $1) comments, (select count(*) from post_reactions where user_id = $1) reactions,
            (select count(*) from friendships where $1 in (user_id, friend_id)) friends,
            (select count(*) from user_blocks where $1 in (blocker_id, blocked_id)) blocks,
            (select count(*) from gmina_follows where user_id = $1) follows, (select count(*) from push_tokens where user_id = $1) push,
            (select count(*) from user_terms_acceptances where user_id = $1) terms, (select count(*) from post_hides where user_id = $1) hides,
            (select count(*) from post_reports where reporter_id = $1) reports,
            (select count(*) from anti_cheat_flags where user_id = $1) flags`,
    [uid],
  );
const left3 = await countsFor(K3);
const afterDel = await one(
  `select (select comments_count from posts where id = $1) p1c, (select reactions_count from posts where id = $1) p1r,
          (select comments_count from posts where id = $2) p2c, (select count(*) from post_hides where post_id = $3) p3_hides,
          (select count(*) from post_reports where comment_id = $4) k3_comment_reports, (select count(*) from posts where id = $3) p3,
          (select count(*) from profiles where id in ($5, $6)) others, (select count(*) from trips where user_id = $5) k1_trips`,
  [P1, P2, P3, cK3onP2.id, K1, K2],
);
ok(
  JSON.stringify(prep3.storagePaths.avatars) === JSON.stringify([`${K3}/avatar-x.jpg`]) && prep3.storagePaths['scan-photos'].length === 0 &&
    del3.deleted === true && del3.authUserDeleted === true && del3.next === null && del3.authError === null && Number(beforeDel.k3xp) > 0 &&
    Number(beforeDel.k3flags) > 0 && Object.values(left3).every((v) => Number(v) === 0),
  'delete_my_account: konto auth.users i profil usunięte, zero wierszy gracza we wszystkich tabelach (gra, ślady GPS, punkty, księga XP, wpisy, komentarze, reakcje, znajomi, blokady, obserwowane, push, regulamin, ukryte, zgłoszenia, flagi anty-cheatu – etap 7)',
  { del3, left3 },
);
ok(
  Number(afterDel.p1c) === Number(beforeDel.p1c) - 1 && Number(afterDel.p1r) === Number(beforeDel.p1r) - 1 &&
    Number(afterDel.p2c) === Number(beforeDel.p2c) - 1 && Number(afterDel.p3_hides) === 0 && Number(afterDel.k3_comment_reports) === 0 &&
    Number(afterDel.p3) === 0 && Number(afterDel.others) === 2 && Number(afterDel.k1_trips) === 1,
  'delete_my_account: jego komentarze i reakcje pod cudzymi wpisami znikają (liczniki), cudze ukrycia / zgłoszenia jego treści – też; inni gracze i ich dane zostają',
  { beforeDel, afterDel },
);
await as(K3);
const del3again = await call('delete_my_account');
const ghostState = await state();
await as(K1);
ok(
  del3again.authUserDeleted === true && ghostState.profile === null && (await call('get_friends')).friends.every((u) => u.id !== K3) &&
    (await code('get_user', K3))?.code === 'P0002',
  'delete_my_account ponownie (stary token) – bez błędu; po usunięciu brak profilu, znika ze znajomych i get_user → P0002',
);

// ── delete_my_account bez prawa do auth.users (jak w chmurze): dane skasowane, profil zanonimizowany, next = Edge Function ──
await admin();
await db.exec(`
  create function auth.test_deny_user_delete() returns trigger language plpgsql as $f$
  begin
    if current_setting('test.deny_auth_delete', true) = 'on' then
      raise exception 'permission denied for table users' using errcode = '42501';
    end if;
    return old;
  end $f$;
  create trigger test_deny_user_delete before delete on auth.users for each row execute function auth.test_deny_user_delete();
`);
const K4 = await mkUser('konto.cztery', 'Konto Cztery', 'Kuba', 'gromadka', 3);
await db.query(`select flag($1, 'test_flag', 1, null, '{}')`, [K4]);   // etap 7: wipe_account_data kasuje też flagi
await as(K4);
await call('accept_terms', '2026-11-01');
await call('complete_onboarding');
await db.query(`update profiles set avatar_path = $2, avatar_preset = 'sowa' where id = $1`, [K4, `${K4}/avatar-k4.jpg`]);
await call('add_comment', P1, 'Komentarz K4');
await call('send_friend_request', K1);
const TK4 = randomUUID();
await startTrip('gromadka', TK4, iso(H));
await submit({ id: randomUUID(), tripId: TK4, gminaId: 'gromadka' });
await db.query(`select set_config('test.deny_auth_delete', 'on', false)`);
const del4 = await call('delete_my_account');
const del4again = await call('delete_my_account');
await db.query(`select set_config('test.deny_auth_delete', 'off', false)`);
await admin();
const k4Profile = await one('select * from profiles where id = $1', [K4]);
const left4 = await countsFor(K4);
ok(
  del4.deleted === true && del4.authUserDeleted === false && del4.next === 'edge_function:delete-account' && del4.authError === '42501' &&
    del4again.authUserDeleted === false && Number(left4.auth_user) === 1 && Number(left4.profile) === 1 &&
    Object.entries(left4).every(([k, v]) => ['auth_user', 'profile'].includes(k) || Number(v) === 0),
  'delete_my_account bez prawa do auth.users (42501): dane skasowane, konto auth zostaje, wynik authUserDeleted: false, next: edge_function:delete-account (ponownie – to samo)',
  { del4, left4 },
);
ok(
  /^usuniety_[0-9a-f]{15}$/.test(k4Profile.handle) && k4Profile.display_name === 'Konto usunięte' && k4Profile.listed === false &&
    k4Profile.deleted_at && k4Profile.first_name === null && k4Profile.avatar_path === null && k4Profile.avatar_preset === null &&
    k4Profile.home_gmina_id === null && k4Profile.terms_version === null && k4Profile.onboarded_at === null && Number(k4Profile.total_xp) === 0,
  'fallback: profil zanonimizowany (usuniety_<id>, „Konto usunięte”, poza wyszukiwarką, deleted_at, bez avatara / gminy / regulaminu)',
  k4Profile,
);
await as(K1);
const k4Seen = {
  user: await code('get_user', K4),
  byHandle: await call('get_user_by_handle', k4Profile.handle),
  search: (await call('search_users', 'usuniety', 50)).length,
  request: await code('send_friend_request', K4),
  block: await code('block_user', K4),
};
ok(
  k4Seen.user?.code === 'P0002' && k4Seen.byHandle === null && k4Seen.search === 0 && k4Seen.request?.code === 'P0002' && k4Seen.block?.code === 'P0002',
  'fallback: konto w trakcie usuwania dla innych nie istnieje (get_user → P0002, get_user_by_handle → null, wyszukiwarka, zaproszenie, blokada → P0002)',
  k4Seen,
);
await admin();
await db.query('delete from auth.users where id = $1', [K4]);                // jak Edge Function: auth.admin.deleteUser
ok(Number((await one('select count(*) n from profiles where id = $1', [K4])).n) === 0, 'Edge Function (auth.admin.deleteUser) dokańcza: profil znika kaskadowo');
await db.exec('drop trigger test_deny_user_delete on auth.users; drop function auth.test_deny_user_delete()');

// ── dev_reset_player: kasuje też blokady gracza (regulamin zostaje) ──
await as(K1);
await call('dev_reset_player');
await admin();
const k1AfterReset = await one(
  'select (select count(*) from user_blocks where blocker_id = $1) blocks, (select terms_version from profiles where id = $1) terms', [K1],
);
ok(Number(k1AfterReset.blocks) === 0 && k1AfterReset.terms === '2026-11-01', 'dev_reset_player: blokady gracza skasowane, akceptacja regulaminu zostaje', k1AfterReset);

// ── Uprawnienia etapu 6 ──
await as(K1);
const internal6 = [
  await err('select is_blocked_pair($1, $2)', [K1, K2]),
  await err('select user_visible_to($1, $2)', [K1, K2]),
  await err('select wipe_account_data($1)', [K1]),
  await err('select friendships_block_guard()'),
];
ok(internal6.every((e) => e?.message.includes('permission denied')), 'klient nie wywoła funkcji wewnętrznych etapu 6 (is_blocked_pair, user_visible_to, wipe_account_data)', internal6);
await as(null);
await db.exec('set role anon');
const anon6 = [];
for (const sql of [
  `select accept_terms('x')`, 'select complete_onboarding()', 'select block_user(gen_random_uuid())', 'select unblock_user(gen_random_uuid())',
  'select get_blocked_users()', 'select export_my_data()', 'select prepare_account_deletion()', 'select delete_my_account()',
  'select * from user_blocks',
]) {
  anon6.push(await err(sql));
}
ok(anon6.every((e) => e?.message.includes('permission denied')), 'anon nie ma RPC etapu 6 ani tabeli user_blocks', anon6);

// =============================================================================
// Etap 7 – anty-cheat: limity (rate_limited), prawda serwera, flagi wiarygodności, dziennik bez dostępu dla klientów
// =============================================================================
const errFull = async (sql, params) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return { code: e.code, message: e.message, detail: e.detail, hint: e.hint };
  }
};
const flagsOf = async (uid) => {
  await admin();
  const rows = (await db.query('select kind, severity, ref_id, details, hits from anti_cheat_flags where user_id = $1 order by id', [uid])).rows;
  await as(uid);
  return rows;
};
const flagOf = (rows, kind, ref) => rows.find((f) => f.kind === kind && (ref === undefined || f.ref_id === ref));
const RETRY_RE = /^retry_after=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const retryAt = (e) => Date.parse(e?.hint?.slice('retry_after='.length) ?? '');
const podg = {
  speciesId: 'podgrzybek-brunatny', rarity: 'pospolity', confidence: 0.9, gminaId: 'suprasl',
  dims: { cap_cm: 9, height_cm: 10, weight_g: 120, age_days: 3 },
};

await admin();
await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
const earlierFlags = (await db.query('select kind, severity, count(*)::int n from anti_cheat_flags group by 1, 2 order by 1, 2')).rows;
console.log('· flagi z wcześniejszych sprawdzeń:', earlierFlags.map((r) => `${r.kind}/${r.severity}×${r.n}`).join(', ') || 'brak');
const botFlags = await one('select count(*)::int n from anti_cheat_flags f join profiles p on p.id = f.user_id where p.is_bot');
ok(botFlags.n === 0, 'anty-cheat: generatory deweloperskie (dev_seed_social, dev_bots_act, dev_seed_activity) działają bez limitów i bez flag');

// ── Zwykła gra: start 2 h temu → 3 znaleziska → odbiór → postęp → koniec (6,8 km) – zero flag ──
const N = await newUser('ac.normalny');
await as(N);
const TN = randomUUID();
await startTrip('suprasl', TN, iso(2 * H));
const nFinds = [
  { id: randomUUID(), tripId: TN, gminaId: 'suprasl', xxl: true, foundAt: iso(100 * 60e3) },     // borowik 410 g – XXL jak w makiecie
  { ...podg, id: randomUUID(), tripId: TN, dims: { cap_cm: 10, height_cm: 11, weight_g: 140, age_days: 3 }, foundAt: iso(70 * 60e3) },
  {
    id: randomUUID(), tripId: TN, gminaId: 'suprasl', speciesId: 'pieprznik-jadalny', rarity: 'pospolity', confidence: 0.9,
    dims: { cap_cm: 5, height_cm: 6, weight_g: 126, age_days: 2, pieces: 9 }, foundAt: iso(40 * 60e3),
  },
];
const nRewards = [];
for (const f of nFinds) {
  await submit(f);
  nRewards.push(await call('claim_find', f.id));
}
await one('select * from report_trip_progress($1, 4100)', [TN]);
const nDone = await one('select * from finish_trip($1, 6800, 6900, $2, null)', [TN, track2]);
const nFlags = await flagsOf(N);
const nState = await state();
ok(
  nFlags.length === 0 && nDone.status === 'finished' && nDone.distance_m === 6800 && nState.profile.totalDistanceM === 6800 &&
    nState.finds.find((f) => f.id === nFinds[0].id)?.xxl === true && nRewards[0].xp.lines.some((l) => l.label === 'Okaz XXL ×1,5'),
  'anty-cheat: zwykła wyprawa (start 2 h temu, 3 znaleziska z odbiorem, 6,8 km) – zero flag, cały dystans uznany, XXL 410 g zostaje',
  nFlags,
);

// ── submit_find: gęstość wg found_at (30 w dowolnym oknie 10 min), ponowienie, kolejka offline ──
await admin();
const RD1 = await newUser('ac.gestosc');
await as(RD1);
const base1 = Date.now() - 3 * H;
const burstIds = [];
for (let i = 0; i < 30; i += 1) {
  const id = randomUUID();
  burstIds.push(id);
  await submit({ ...podg, id, foundAt: new Date(base1 + i * 1000).toISOString() });
}
const over31 = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: new Date(base1 + 5 * 60e3).toISOString() }));
const retry1 = await submit({ ...podg, id: burstIds[0], foundAt: new Date(base1).toISOString() });
const after11 = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: new Date(base1 + 11 * 60e3).toISOString() }));
const r1Count = (await one('select count(*)::int n from finds where user_id = $1', [RD1])).n;
const r1Flags = await flagsOf(RD1);
ok(
  over31?.code === 'P0001' && over31.message.includes('rate_limited') && over31.detail?.includes('najwyżej 30 w ciągu 10 minut') && !over31.hint &&
    retry1.id === burstIds[0] && after11 === null && r1Count === 31 &&
    flagOf(r1Flags, 'rate_limited', 'submit_find')?.severity === 3 && flagOf(r1Flags, 'rate_limited', 'submit_find').details.limit === 30,
  'submit_find: 31. znalezisko w oknie 10 min (wg found_at) → P0001 rate_limited (opis po polsku); ponowienie tego samego id przechodzi; 11 min później – OK; wyczerpanie limitu → flaga rate_limited (3)',
  { over31, r1Count, r1Flags },
);
const base2 = Date.now() - 10 * H;
const offline = [];
for (let i = 0; i < 40; i += 1) {
  offline.push(await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: new Date(base2 + i * 60e3).toISOString() })));
}
ok(offline.every((e) => e === null), 'submit_find: zaległa kolejka offline – 40 znalezisk naraz, found_at co minutę → wszystkie przyjęte (≤ 10 w oknie 10 min)', offline.filter(Boolean));

// ── submit_find: 200 dziennie (czas serwera) + obejście tylko przy dev_tools ──
await admin();
const RD2 = await newUser('ac.dzienny');
await db.query(
  `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, found_at)
   select $1, 'podgrzybek-brunatny', 'suprasl', 'pospolity', 0.9, true, 'discarded', now() - make_interval(hours => g)
     from generate_series(1, 199) g`,
  [RD2],
);
await as(RD2);
const d200 = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: iso(30 * 60e3) }));
const d201 = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: iso(20 * 60e3) }));
const r2Flags = await flagsOf(RD2);
await db.query(`select set_config('app.anti_cheat_bypass', 'on', false)`);
const dBypass = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: iso(15 * 60e3) }));
await admin();
await db.exec(`update app_config set value = 'false' where key = 'dev_tools'`);
await as(RD2);
const dNoDev = await errFull(submitSql, submitArgs({ ...podg, id: randomUUID(), foundAt: iso(10 * 60e3) }));
await admin();
await db.exec(`update app_config set value = 'true' where key = 'dev_tools'`);
await db.query(`select set_config('app.anti_cheat_bypass', 'off', false)`);
ok(
  d200 === null && d201?.code === 'P0001' && d201.message.includes('rate_limited') && d201.detail?.includes('Dzienny limit znalezisk (200)') &&
    RETRY_RE.test(d201.hint ?? '') && retryAt(d201) > Date.now() && retryAt(d201) <= Date.now() + DAY + H &&
    flagOf(r2Flags, 'rate_limited', 'submit_find_day')?.severity === 3,
  'submit_find: 201. znalezisko doby (wg created_at) → P0001 rate_limited, hint retry_after = najbliższa północ (Europe/Warsaw); flaga rate_limited (3)',
  d201,
);
ok(
  dBypass === null && dNoDev?.message.includes('rate_limited'),
  'app.anti_cheat_bypass = on (sesja) wyłącza limity tylko przy dev_tools; bez dev_tools → nadal rate_limited',
  { dBypass, dNoDev },
);

// ── start_trip: 20 nowych wypraw dziennie ──
await admin();
const RT3 = await newUser('ac.wyprawy');
await as(RT3);
const r3Trips = [];
for (let i = 0; i < 20; i += 1) {
  const id = randomUUID();
  r3Trips.push(id);
  await startTrip('suprasl', id, null);
}
const t21 = await errFull('select * from start_trip($1, $2, null)', ['suprasl', randomUUID()]);
const t20again = await startTrip('suprasl', r3Trips[19], null);
const tActive = await startTrip('suprasl');
const r3Count = (await one('select count(*)::int n from trips where user_id = $1', [RT3])).n;
const r3Flags = await flagsOf(RT3);
ok(
  t21?.code === 'P0001' && t21.message.includes('rate_limited') && t21.detail?.includes('Dzienny limit nowych wypraw (20)') && RETRY_RE.test(t21.hint ?? '') &&
    t20again.id === r3Trips[19] && tActive.id === r3Trips[19] && r3Count === 20 && flagOf(r3Flags, 'rate_limited', 'start_trip')?.severity === 3,
  'start_trip: 21. nowa wyprawa doby → P0001 rate_limited; ponowienie z tym samym id i zwrot aktywnej przechodzą; flaga rate_limited (3)',
  { t21, r3Count },
);

// ── add_comment: 30 w 10 min (także bezpośredni INSERT) ──
await admin();
const RC = await newUser('ac.komentarze');
const PR = await insPost(N, 'suprasl', 30, -1);
await as(RC);
const cIds = [];
for (let i = 0; i < 30; i += 1) {
  const id = randomUUID();
  cIds.push(id);
  await call('add_comment', PR, `Komentarz ${i + 1}`, id);
}
const c31 = await errFull('select add_comment($1, $2, $3)', [PR, 'Komentarz 31', randomUUID()]);
const cRetry = await call('add_comment', PR, 'Komentarz 1', cIds[0]);
const cDirect = await errFull('insert into post_comments (post_id, body) values ($1, $2)', [PR, 'Bezpośrednio przez API']);
const rcCount = (await one('select count(*)::int n from post_comments where author_id = $1', [RC])).n;
const rcFlags = await flagsOf(RC);
ok(
  c31?.code === 'P0001' && c31.message.includes('rate_limited') && c31.detail?.includes('najwyżej 30 w ciągu 10 minut') &&
    RETRY_RE.test(c31.hint ?? '') && retryAt(c31) > Date.now() && retryAt(c31) <= Date.now() + 10 * 60e3 &&
    cRetry.id === cIds[0] && cDirect?.message.includes('rate_limited') && rcCount === 30 &&
    flagOf(rcFlags, 'rate_limited', 'add_comment')?.severity === 3,
  'add_comment: 31. komentarz w 10 min → P0001 rate_limited (retry_after ≤ 10 min); ponowienie z tym samym id przechodzi; bezpośredni INSERT też limitowany',
  { c31, cDirect, rcCount },
);

// ── send_friend_request: 50 nowych zaproszeń dziennie (także bezpośredni INSERT); akceptacja się nie liczy ──
await admin();
const RF = await newUser('ac.zaproszenia');
const targets = [];
for (let i = 0; i < 51; i += 1) targets.push(await newUser(`ac.cel${String(i).padStart(2, '0')}`));
await as(RF);
const sent = [];
for (let i = 0; i < 50; i += 1) sent.push(await call('send_friend_request', targets[i]));
const fr51 = await errFull('select send_friend_request($1)', [targets[50]]);
const frAgain = await call('send_friend_request', targets[0]);
const frDirect = await errFull('insert into friendships (friend_id) values ($1)', [targets[50]]);
await as(targets[50]);
const frIncoming = await call('send_friend_request', RF);
await as(RF);
const frAccept = await call('respond_friend_request', targets[50], true);
ok(
  sent.every((s) => s === 'outgoing') && fr51?.code === 'P0001' && fr51.message.includes('rate_limited') &&
    fr51.detail?.includes('Dzienny limit zaproszeń do znajomych (50)') && RETRY_RE.test(fr51.hint ?? '') && frAgain === 'outgoing' &&
    frDirect?.message.includes('rate_limited') && frIncoming === 'outgoing' && frAccept === 'friends' &&
    flagOf(await flagsOf(RF), 'rate_limited', 'send_friend_request')?.severity === 3,
  'send_friend_request: 51. zaproszenie doby → P0001 rate_limited; ponowne do zaproszonego – outgoing bez błędu; bezpośredni INSERT limitowany; zaproszenie OD innego i akceptacja przechodzą',
  { fr51, frDirect },
);

// ── report_post: 30 zgłoszeń dziennie ──
await admin();
const RR = await newUser('ac.zgloszenia');
const spam = (
  await db.query(`insert into post_comments (post_id, author_id, body) select $1, $2, 'Spam ' || g from generate_series(1, 31) g returning id`, [PR, N])
).rows.map((r) => r.id);
await as(RR);
for (let i = 0; i < 30; i += 1) await call('report_post', PR, spam[i], null);
const rep31 = await errFull('select report_post($1, $2, null)', [PR, spam[30]]);
const repAgain = await errFull('select report_post($1, $2, $3)', [PR, spam[0], 'jeszcze raz']);
await admin();
const rrCount = (await one('select count(*)::int n from post_reports where reporter_id = $1', [RR])).n;
await as(RR);
ok(
  rep31?.code === 'P0001' && rep31.message.includes('rate_limited') && rep31.detail?.includes('Dzienny limit zgłoszeń (30)') &&
    repAgain === null && rrCount === 30 && flagOf(await flagsOf(RR), 'rate_limited', 'report_post')?.severity === 3,
  'report_post: 31. zgłoszenie doby → P0001 rate_limited; ponowne zgłoszenie tego samego przechodzi (idempotentne)',
  { rep31, rrCount },
);

// ── Prędkość wyprawy: > 12 km/h → najwyżej 8 km/h, > 50 km/h → nic; „doganianie”; koniec wcześniejszy niż postęp ──
await admin();
const R7 = await newUser('ac.predkosc');
await as(R7);
const dist7 = async () => Number((await one('select total_distance_m d from profiles where id = $1', [R7])).d);
const TV1 = randomUUID();
await startTrip('suprasl', TV1, iso(H));
const v1 = await one('select * from report_trip_progress($1, 15000)', [TV1]);   // 15 km w 1 h (+5 min) ≈ 13,8 km/h
const v1dist = await dist7();
const v1quest = await one(`select completed_at from user_quests where user_id = $1 and quest_id = 'q-km-5'`, [R7]);
let r7Flags = await flagsOf(R7);
ok(
  v1.distance_m >= 8600 && v1.distance_m <= 8700 && v1dist === v1.distance_m && v1quest?.completed_at &&
    flagOf(r7Flags, 'trip_speed', TV1)?.severity === 2 && flagOf(r7Flags, 'trip_speed', TV1).details.countedM === v1.distance_m,
  'report_trip_progress: 15 km w godzinę (> 12 km/h) → uznane najwyżej 65 min × 8 km/h ≈ 8,67 km (wyprawa, profil, zadanie 5 km), flaga trip_speed (2)',
  { v1: v1.distance_m, v1dist, flag: flagOf(r7Flags, 'trip_speed', TV1) },
);
await admin();
await db.query(`update trips set started_at = started_at - interval '2 hours' where id = $1`, [TV1]);
await as(R7);
const v1b = await one('select * from report_trip_progress($1, 15000)', [TV1]);
ok(v1b.distance_m === 15000 && (await dist7()) === 15000, 'report_trip_progress: ten sam dystans po 3 h (≈ 4,9 km/h) → przycięty dystans „dogania” zgłoszony (profil +reszta)');
const TV2 = randomUUID();
await startTrip('suprasl', TV2, iso(10 * 60e3));
const v2 = await one('select * from report_trip_progress($1, 20000)', [TV2]);   // 20 km w 10 min (+5) = 80 km/h
const v2dist = await dist7();
const v2done = await one('select * from finish_trip($1, 30000, 600, null, $2)', [TV2, iso(5 * 60e3)]);
r7Flags = await flagsOf(R7);
ok(
  v2.distance_m === 0 && v2dist === 15000 && v2done.status === 'finished' && v2done.distance_m === 0 && (await dist7()) === 15000 &&
    flagOf(r7Flags, 'trip_speed_absurd', TV2)?.severity === 3 && flagOf(r7Flags, 'trip_speed_absurd', TV2).hits === 2,
  'prędkość > 50 km/h (postęp i finish_trip z p_ended_at) → przyrost nieliczony, wyprawa 0 m; flaga trip_speed_absurd (3) w jednym wierszu (hits 2)',
  { v2: v2.distance_m, v2done: v2done.distance_m, flag: flagOf(r7Flags, 'trip_speed_absurd', TV2) },
);
const TV3 = randomUUID();
const tv3Start = iso(3 * H);
await startTrip('suprasl', TV3, tv3Start);
await one('select * from report_trip_progress($1, 20000)', [TV3]);              // 20 km / 3 h – wiarygodne „do teraz”
const v3done = await one('select * from finish_trip($1, 20000, 1800, null, $2)', [TV3, new Date(Date.parse(tv3Start) + 30 * 60e3).toISOString()]);
const tv3Flag = flagOf(await flagsOf(R7), 'trip_speed', TV3);
ok(
  v3done.distance_m === 20000 && tv3Flag?.severity === 2 && tv3Flag.details.phase === 'finish',
  'finish_trip: dystans uznany wcześniej (kolejka offline), a wyprawa trwała 30 min → flaga trip_speed (2, phase finish); uznanego dystansu nie cofamy',
  tv3Flag,
);

// ── Znaleziska: prawda serwera (XXL, rzadkość) w nagrodzie, wymiary, czas poza wyprawą, to samo zdjęcie ──
await admin();
const R8 = await newUser('ac.okazy');
await as(R8);
const TO = randomUUID();
await startTrip('suprasl', TO, iso(2 * H));
const FX = randomUUID();
const fx = await submit({ id: FX, tripId: TO, gminaId: 'suprasl', xxl: true, dims: { cap_cm: 13, height_cm: 15, weight_g: 330, age_days: 3 }, foundAt: iso(H) });
const rx = await call('claim_find', FX);
const FR = randomUUID();
const frr = await submit({ ...podg, id: FR, tripId: TO, rarity: 'legendarny', foundAt: iso(50 * 60e3) });
const rr = await call('claim_find', FR);
const FUp = randomUUID();
const fUp = await submit({ ...podg, id: FUp, tripId: TO, rarity: 'rzadki', foundAt: iso(45 * 60e3) });
const FLow = randomUUID();
const fLow = await submit({ id: FLow, tripId: TO, gminaId: 'suprasl', rarity: 'pospolity', foundAt: iso(40 * 60e3) });
const FKx = randomUUID();
const fKx = await submit({
  id: FKx, tripId: TO, gminaId: 'suprasl', speciesId: 'pieprznik-jadalny', rarity: 'pospolity', confidence: 0.9, xxl: true,
  dims: { cap_cm: 6, height_cm: 6, weight_g: 240, age_days: 2, pieces: 12 }, foundAt: iso(25 * 60e3),
});
let r8Flags = await flagsOf(R8);
ok(
  fx.xxl === false && !rx.xp.lines.some((l) => l.label.startsWith('Okaz XXL')) && flagOf(r8Flags, 'xxl_corrected', FX)?.severity === 1 &&
    fKx.xxl === false && flagOf(r8Flags, 'xxl_corrected', FKx)?.details.clustered === true,
  'submit_find: XXL przy wadze < 1,25 × typowej (330 g borowik) albo dla kępki → xxl = false (prawda serwera), bez linii „Okaz XXL” w nagrodzie; flaga xxl_corrected (1)',
  { fx: fx.xxl, lines: rx.xp.lines },
);
ok(
  frr.rarity === 'rzadki' && rr.xp.lines[0].label === 'Bazowe XP (rzadki)' && rr.xp.lines[0].xp === 120 &&
    flagOf(r8Flags, 'rarity_clamped', FR)?.severity === 2 && flagOf(r8Flags, 'rarity_clamped', FR).details.reported === 'legendarny' &&
    fUp.rarity === 'rzadki' && !flagOf(r8Flags, 'rarity_clamped', FUp) && fLow.rarity === 'rzadki' && !flagOf(r8Flags, 'rarity_clamped', FLow),
  'submit_find: pospolity gatunek jako legendarny → rzadki (gatunek + 1), nagroda z bazy rzadkiego, flaga rarity_clamped (2); o stopień wyżej – bez zmian; niżej niż gatunek → rzadkość gatunku',
  { frr: frr.rarity, line: rr.xp.lines[0] },
);
const FW = randomUUID();
await submit({ id: FW, tripId: TO, gminaId: 'suprasl', dims: { cap_cm: 14, height_cm: 15, weight_g: 1000, age_days: 3 }, foundAt: iso(35 * 60e3) });
const FC2 = randomUUID();
await submit({ id: FC2, tripId: TO, gminaId: 'suprasl', dims: { cap_cm: 31, height_cm: 15, weight_g: 400, age_days: 3 }, foundAt: iso(30 * 60e3) });
const FO = randomUUID();
await submit({ ...podg, id: FO, tripId: TO, foundAt: iso(3 * H) });
const FIn = randomUUID();
await submit({ ...podg, id: FIn, tripId: TO, foundAt: iso(2 * H + 4 * 60e3) });
await call('set_find_photo', FX, `${R8}/${FX}.jpg`);
await call('set_find_photo', FR, `${R8}/${FX}.jpg`);
r8Flags = await flagsOf(R8);
ok(
  flagOf(r8Flags, 'find_size', FW)?.severity === 2 && flagOf(r8Flags, 'find_size', FC2)?.severity === 2 && !flagOf(r8Flags, 'find_size', FKx) &&
    !flagOf(r8Flags, 'find_size', FX),
  'submit_find: waga > 3 × typowej (1000 g borowik) albo kapelusz > 2,5 × typowego (31 cm) → flaga find_size (2); kępka liczona na sztukę – bez flagi',
);
ok(
  flagOf(r8Flags, 'find_outside_trip', FO)?.severity === 1 && !flagOf(r8Flags, 'find_outside_trip', FIn),
  'submit_find: found_at godzinę przed startem wyprawy → flaga find_outside_trip (1); 4 min przed startem – w tolerancji',
);
ok(
  flagOf(r8Flags, 'photo_reuse', FR)?.severity === 2 && flagOf(r8Flags, 'photo_reuse', FR).details.otherFindIds.includes(FX) &&
    !flagOf(r8Flags, 'photo_reuse', FX) && !flagOf(r8Flags, 'rare_burst'),
  'set_find_photo: to samo zdjęcie przy drugim znalezisku → flaga photo_reuse (2) (zapis bez zmian); 6 rzadkich w 30 min – bez rare_burst',
);

// ── Seria rzadkich okazów: 4 epickie w ± 30 min → rare_burst (2) ──
await admin();
const R9 = await newUser('ac.seria');
await as(R9);
const kania = { speciesId: 'czubajka-kania', rarity: 'epicki', confidence: 0.93, gminaId: 'suprasl', dims: { cap_cm: 24, height_cm: 28, weight_g: 230, age_days: 3 } };
for (let i = 0; i < 3; i += 1) await submit({ ...kania, id: randomUUID(), foundAt: iso((40 - i * 5) * 60e3) });
const r9before = await flagsOf(R9);
await submit({ ...kania, id: randomUUID(), foundAt: iso(20 * 60e3) });
const r9Flags = await flagsOf(R9);
ok(
  r9before.length === 0 && flagOf(r9Flags, 'rare_burst')?.severity === 2 && flagOf(r9Flags, 'rare_burst').details.epic === 4,
  'submit_find: 3 epickie w pół godziny – bez flagi, 4. → rare_burst (2)',
  r9Flags,
);

// ── claim_find: dzienny „miękki” limit XP ze znalezisk (5000) – nagroda bez zmian, tylko flaga ──
await admin();
const R10 = await newUser('ac.xp');
await db.query(`insert into xp_events (user_id, source, ref_id, gmina_id, amount) values ($1, 'find', 'test-xp', 'suprasl', 4800)`, [R10]);
await as(R10);
const TX = randomUUID();
await startTrip('suprasl', TX, iso(H));
const FX1 = randomUUID();
await submit({ ...podg, id: FX1, tripId: TX, foundAt: iso(40 * 60e3) });
const rx1 = await call('claim_find', FX1);
const xpBelow = flagOf(await flagsOf(R10), 'xp_daily_soft_cap');
const FX2 = randomUUID();
await submit({
  id: FX2, tripId: TX, gminaId: 'suprasl', speciesId: 'maslak-zwyczajny', rarity: 'pospolity', confidence: 0.9,
  dims: { cap_cm: 8, height_cm: 7, weight_g: 70, age_days: 2 }, foundAt: iso(30 * 60e3),
});
const rx2 = await call('claim_find', FX2);
const xpFlag = flagOf(await flagsOf(R10), 'xp_daily_soft_cap');
const rx2Ledger = await one(`select amount from xp_events where user_id = $1 and source = 'find' and ref_id = $2`, [R10, FX2]);
ok(
  rx1.xp.total === 130 && !xpBelow && rx2.xp.total === 130 && rx2Ledger?.amount === 130 && xpFlag?.severity === 2 &&
    Number(xpFlag.details.xpToday) === 5060,
  'claim_find: XP ze znalezisk dziś 4930 → bez flagi; 5060 (> 5000) → nagroda wypłacona bez zmian + flaga xp_daily_soft_cap (2)',
  xpFlag,
);

// ── Dziennik: brak dostępu dla klientów; moderacja przez service_role ──
await as(R8);
const acAccess = [
  await err('select * from anti_cheat_flags'),
  await err('select * from anti_cheat_summary'),
  await err('select * from admin_flags(10)'),
  await err(`select flag($1, 'x', 3, null, '{}')`, [R8]),
  await err(`select check_rate_limit($1, 'x', 0, 1, 'x', 'x', null)`, [R8]),
  await err(`insert into anti_cheat_flags (user_id, kind, severity) values ($1, 'x', 1)`, [R8]),
  await err(`select anti_cheat_param('xxl_factor')`),
  await err('select post_comments_rate_limit()'),
];
await as(null);
await db.exec('set role anon');
acAccess.push(await err('select * from anti_cheat_flags'), await err('select * from anti_cheat_summary'), await err('select * from admin_flags(10)'));
ok(
  acAccess.every((e) => e?.message.includes('permission denied')),
  'anty-cheat: klient (i anon) nie czyta ani nie zapisuje flag – tabela, widok, admin_flags, flag, check_rate_limit, progi, funkcje wyzwalaczy',
  acAccess,
);
await db.exec('reset role');
await db.exec('set role service_role');
const acSummary = (await db.query('select * from anti_cheat_summary where user_id = $1 order by kind, severity', [R7])).rows;
const acAdmin = (await db.query('select * from admin_flags(1000, 3)')).rows;
await db.exec('reset role');
ok(
  acSummary.some((s) => s.kind === 'trip_speed' && s.severity === 2 && Number(s.flags) === 2 && s.handle === 'ac.predkosc') &&
    acSummary.some((s) => s.kind === 'trip_speed_absurd' && s.severity === 3 && Number(s.hits) === 2) &&
    acAdmin.length > 0 && acAdmin.every((r) => r.severity === 3) && acAdmin.some((r) => r.kind === 'rate_limited' && r.user_id === RD1 && r.handle === 'ac.gestosc'),
  'moderacja (service_role): anti_cheat_summary (gracz × rodzaj × waga, flagi i powtórzenia z 7 dni), admin_flags(p_limit, p_min_severity)',
  { acSummary, n: acAdmin.length },
);

// ── Rozpoznawanie (Edge Function identify): 60 / 24 h, jedno naraz, tylko service_role, dziennik bez zdjęć ──
{
  const ID1 = await newUser('id.limit');
  const begin = (u) => one('select identify_begin($1) id', [u]);
  const finish = (id, u, status, model = null, tokens = [null, null, null, null]) =>
    db.query('select identify_finish($1, $2, $3, $4, $5, $6, $7, $8)', [id, u, status, model, ...tokens]);
  await db.exec('set role service_role');
  const c1 = (await begin(ID1)).id;
  const busy = await err('select identify_begin($1)', [ID1]);
  await finish(c1, ID1, 'ok', 'claude-opus-5-5', [6000, 140, 5800, 0]);
  const c2 = (await begin(ID1)).id;
  await finish(c2, ID1, 'failed');
  const badStatus = await err(`select identify_finish($1, $2, 'zgadnij')`, [c2, ID1]);
  await db.exec('reset role');
  // Okno 24 h: 58 udanych godzinę temu + c1 = 59; stare (25 h) i 'failed' się nie liczą.
  await db.query(
    `insert into identify_calls (user_id, started_at, finished_at, status)
     select $1::uuid, now() - interval '1 hour', now() - interval '1 hour', 'ok' from generate_series(1, 58)
     union all select $1::uuid, now() - interval '25 hours', now() - interval '25 hours', 'ok'`,
    [ID1],
  );
  await db.exec('set role service_role');
  const c60 = (await begin(ID1)).id;
  await finish(c60, ID1, 'refused', 'claude-opus-5-5');
  const over = await errFull('select identify_begin($1)', [ID1]);
  const usage = (await db.query('select * from identify_usage where model = $1', ['claude-opus-5-5'])).rows;
  await db.exec('reset role');
  const idRow = await one('select * from identify_calls where id = $1', [c1]);
  const idFlags = await flagsOf(ID1);
  ok(
    busy?.code === 'P0001' && busy.message.includes('rate_limited') && c2 > c1 && badStatus?.code === 'P0001' &&
      idRow.status === 'ok' && idRow.input_tokens === 6000 && idRow.cache_read_tokens === 5800 && idRow.finished_at &&
      over?.code === 'P0001' && over.message.includes('rate_limited') && over.detail?.includes('Dzienny limit rozpoznań (60)') &&
      RETRY_RE.test(over.hint ?? '') && flagOf(idFlags, 'rate_limited', 'identify')?.severity === 3 &&
      usage.some((u) => Number(u.ok) >= 1 && Number(u.refused) === 1 && Number(u.input_tokens) === 6000),
    'identify: drugie wywołanie w trakcie → rate_limited; 61. w 24 h → rate_limited (detail po polsku, retry_after), failed i starsze niż 24 h się nie liczą; tokeny w dzienniku i widoku identify_usage',
    { busy, over },
  );

  // Klient (i anon) nie widzi dziennika i nie woła funkcji – nie zresetuje sobie limitu.
  await as(ID1);
  const idAccess = [
    await err('select * from identify_calls'),
    await err('select * from identify_usage'),
    await err('select identify_begin($1)', [ID1]),
    await err(`select identify_finish(1, $1, 'ok')`, [ID1]),
    await err('insert into identify_calls (user_id) values ($1)', [ID1]),
  ];
  await as(null);
  await db.exec('set role anon');
  idAccess.push(await err('select * from identify_calls'), await err('select identify_begin($1)', [ID1]));
  await db.exec('reset role');
  ok(idAccess.every((e) => e?.message.includes('permission denied')), 'identify: klient i anon bez dostępu do dziennika i funkcji limitu', idAccess);

  // Dziennik: wiersze starsze niż 7 dni znikają przy kolejnym wywołaniu; wipe_account_data kasuje dziennik gracza.
  const ID2 = await newUser('id.wipe');
  await db.query(`insert into identify_calls (user_id, started_at, status) values ($1, now() - interval '8 days', 'ok')`, [ID2]);
  await db.exec('set role service_role');
  const c3 = (await begin(ID2)).id;
  await finish(c3, ID2, 'ok');
  await db.exec('reset role');
  const keptAfterCleanup = Number((await one('select count(*) n from identify_calls where user_id = $1', [ID2])).n);
  await db.query('select wipe_account_data($1)', [ID2]);
  const afterWipe = Number((await one('select count(*) n from identify_calls where user_id = $1', [ID2])).n);
  ok(keptAfterCleanup === 1 && afterWipe === 0, 'identify: dziennik żyje 7 dni; wipe_account_data (usunięcie konta) kasuje go', {
    keptAfterCleanup,
    afterWipe,
  });
}

// =============================================================================
// Etap 8 – szanse na gatunki (zbiory gminy z 14 dni) i mapa gatunku: tylko agregaty gmin, k-anonimowość (≥ 2
// znalazców gatunku, ≥ 3 znalazców i 5 znalezisk w gminie), opóźnienie prywatności (visible_from)
// =============================================================================
{
  const EV_KEYS = 'days,gminaId,species,total';
  const EV_SP_KEYS = 'finders,finds,speciesId';
  const MAP_KEYS = 'heat,period,speciesId,top,total,voivodeship';
  await admin();
  // Warmińsko-mazurskie – bez aktywności botów z generatorów (te działały w lubuskim i podlaskim) i bez innych znalezisk.
  const VW = 'warmińsko-mazurskie';
  const lub = (await db.query(`select id, name from gminy where voivodeship = $1 order by id limit 4`, [VW])).rows;
  const [G1, G2, G3, G4] = lub.map((r) => r.id);
  const nameOf = Object.fromEntries(lub.map((r) => [r.id, r.name]));
  const nowDb = (await one('select now() n')).n.getTime();
  const at = (msAgo) => tsAt(nowDb - msAgo);
  const E = [];
  for (let i = 1; i <= 5; i++) E.push(await newUser(`szanse.${i}`));
  const [E1, E2, E3, E4, E5] = E;
  await db.query(`update profiles set home_gmina_id = $2 where id = $1`, [E1, G1]);
  // Znalezisko odebrane; widoczne dla innych dzień po znalezieniu (jak koniec wyprawy + 24 h), chyba że podano inaczej.
  const addEv = async (user, gmina, species, foundAt, n = 1, visibleFrom) => {
    for (let i = 0; i < n; i++) {
      await db.query(
        `insert into finds (user_id, species_id, gmina_id, rarity, confidence, collected, status, weight_g, found_at, claimed_at, visible_from)
         select $1, s.id, $3, s.rarity, 0.9, s.edibility not in ('trujacy', 'smiertelny'), 'claimed', 100, $4, $4, $5
           from species s where s.id = $2`,
        [user, species, gmina, foundAt, visibleFrom ?? tsAt(Date.parse(foundAt) + DAY)],
      );
    }
  };
  // G1: podgrzybek 3 + 2 (2 znalazców) · borowik 4 (1 znalazca – tylko w total) · muchomor czerwony 1 + 1 (tylko zdjęcie)
  //     · kurka 1 + 1 sprzed 12 h (jeszcze niewidoczna) · maślak 1 + 1 sprzed 20 dni (poza oknem 14 dni).
  await addEv(E1, G1, 'podgrzybek-brunatny', at(3 * DAY), 3);
  await addEv(E2, G1, 'podgrzybek-brunatny', at(3 * DAY), 2);
  await addEv(E3, G1, 'borowik-szlachetny', at(4 * DAY), 4);
  await addEv(E2, G1, 'muchomor-czerwony', at(5 * DAY));
  await addEv(E3, G1, 'muchomor-czerwony', at(5 * DAY));
  await addEv(E1, G1, 'pieprznik-jadalny', at(12 * H));
  await addEv(E4, G1, 'pieprznik-jadalny', at(12 * H));
  await addEv(E1, G1, 'maslak-zwyczajny', at(20 * DAY));
  await addEv(E2, G1, 'maslak-zwyczajny', at(20 * DAY));
  // G2: tylko 2 znalazców (podgrzybek 4 + 3) – poniżej progu gminy; G3: podgrzybek 10 × jeden gracz;
  // G4: podgrzybek 3 + 2 sprzed 10 dni (w sezonie, poza tygodniem).
  await addEv(E1, G2, 'podgrzybek-brunatny', at(2 * DAY), 4);
  await addEv(E2, G2, 'podgrzybek-brunatny', at(2 * DAY), 3);
  await addEv(E3, G3, 'podgrzybek-brunatny', at(3 * DAY), 10);
  await addEv(E4, G4, 'podgrzybek-brunatny', at(10 * DAY), 3);
  await addEv(E5, G4, 'podgrzybek-brunatny', at(10 * DAY), 2);

  await as(E1);
  const e1 = await call('get_gmina_species_evidence', G1, 14);
  ok(
    keys(e1) === EV_KEYS && e1.gminaId === G1 && e1.days === 14 && e1.total === 11 &&
      e1.species.every((s) => keys(s) === EV_SP_KEYS) &&
      e1.species.map((s) => `${s.speciesId}:${s.finds}:${s.finders}`).join() === 'podgrzybek-brunatny:5:2,muchomor-czerwony:2:2',
    'get_gmina_species_evidence: gatunki z ≥ 2 znalazcami od najczęstszego (także trujące – tylko zdjęcie); gatunek jednego gracza tylko w total (11); niewidoczne i sprzed 14 dni pominięte',
    e1,
  );
  ok(!JSON.stringify(e1).includes(E1) && !JSON.stringify(e1).includes(E3), 'get_gmina_species_evidence: bez identyfikatorów graczy (same liczby)');
  const e28 = await call('get_gmina_species_evidence', G1, 100);
  const eDef = (await one('select get_gmina_species_evidence($1) r', [G1])).r;
  const e0 = await call('get_gmina_species_evidence', G1, 0);
  ok(
    e28.days === 28 && e28.total === 13 && e28.species.some((s) => s.speciesId === 'maslak-zwyczajny' && s.finds === 2) &&
      eDef.days === 14 && eDef.total === 11 && e0.days === 1 && e0.total === 0 && e0.species.length === 0,
    'get_gmina_species_evidence: okno domyślnie 14 dni, zakres 1–28 (100 → 28 z maślakiem sprzed 20 dni; 0 → 1 dzień – brak danych)',
    { e28, eDef, e0 },
  );
  const e2 = await call('get_gmina_species_evidence', G2, 14);
  ok(e2.total === 0 && e2.species.length === 0, 'get_gmina_species_evidence: gmina z 2 znalazcami (7 znalezisk) → brak danych (próg 3 znalazców)', e2);
  await admin();
  await addEv(E5, G2, 'czubajka-kania', at(2 * DAY));
  await as(E1);
  const e2b = await call('get_gmina_species_evidence', G2, 14);
  ok(
    e2b.total === 8 && e2b.species.length === 1 && e2b.species[0].speciesId === 'podgrzybek-brunatny' && e2b.species[0].finders === 2,
    'get_gmina_species_evidence: trzeci znalazca → dane gminy; jego jedyny gatunek (kania) tylko w total',
    e2b,
  );
  const e3 = await call('get_gmina_species_evidence', G3, 14);
  ok(e3.total === 0 && e3.species.length === 0, 'get_gmina_species_evidence: 10 znalezisk jednego gracza → brak danych', e3);
  // Opóźnienie prywatności: kurki sprzed 12 h stają się widoczne dopiero po visible_from.
  await admin();
  await db.query(`update finds set visible_from = now() - interval '1 minute' where gmina_id = $1 and species_id = 'pieprznik-jadalny'`, [G1]);
  await as(E1);
  const e1b = await call('get_gmina_species_evidence', G1, 14);
  ok(
    e1b.total === 13 && e1b.species.some((s) => s.speciesId === 'pieprznik-jadalny' && s.finds === 2 && s.finders === 2),
    'get_gmina_species_evidence: znaleziska wchodzą do danych dopiero po visible_from (opóźnienie prywatności)',
    e1b,
  );
  ok(
    (await code('get_gmina_species_evidence', 'nie-ma', 14))?.code === 'P0002',
    'get_gmina_species_evidence: nieznana gmina → P0002',
  );

  // ── get_species_map ──
  const seasonOk8 = nowDb - 11 * DAY >= seasonStart;
  const topStr = (m) => m.top.map((t) => `${t.gminaId}:${t.name}:${t.finds}`).join();
  const mWeek = await call('get_species_map', 'podgrzybek-brunatny', 'Warmińsko-Mazurskie', 'week');
  ok(
    keys(mWeek) === MAP_KEYS && mWeek.voivodeship === VW && mWeek.period === 'week' && mWeek.speciesId === 'podgrzybek-brunatny' &&
      entries(mWeek.heat) === entries({ [G2]: 4, [G1]: 2 }) && mWeek.total === 12 &&
      topStr(mWeek) === `${G2}:${nameOf[G2]}:7,${G1}:${nameOf[G1]}:5`,
    'get_species_map (tydzień): gminy z ≥ 2 znalazcami, stopnie 4 / 2, top z nazwami; gmina jednego gracza (10 okazów) i sprzed 10 dni pominięte; województwo bez wielkości liter',
    mWeek,
  );
  if (seasonOk8) {
    const mSeason = await call('get_species_map', 'podgrzybek-brunatny', null, 'season');
    await admin();
    const tie = (await db.query(`select id from gminy where id = any($1) order by name, id`, [[G1, G4]])).rows.map((r) => r.id);
    await as(E1);
    ok(
      mSeason.voivodeship === VW && mSeason.period === 'season' &&
        entries(mSeason.heat) === entries({ [G2]: 4, [G1]: 3, [G4]: 3 }) && mSeason.total === 17 &&
        mSeason.top.map((t) => t.gminaId).join() === [G2, ...tie].join() && !(G3 in mSeason.heat),
      'get_species_map (sezon): województwo gminy domowej (null), remis = ten sam stopień (5 i 5 → 3), suma tylko pokazanych gmin',
      mSeason,
    );
  }
  const mDefault = (await one(`select get_species_map('podgrzybek-brunatny', $1) r`, [VW])).r;
  const mEmpty = await call('get_species_map', 'szmaciak-galezisty', VW, 'season');
  ok(
    mDefault.period === 'season' && keys(mEmpty) === MAP_KEYS && entries(mEmpty.heat) === '[]' && mEmpty.top.length === 0 && mEmpty.total === 0,
    'get_species_map: okres domyślnie sezon; gatunek bez danych → pusta mapa ({}, [], 0)',
    { mDefault, mEmpty },
  );
  ok(!JSON.stringify(mWeek).includes(E1) && !JSON.stringify(mDefault).includes(E4), 'get_species_map: bez identyfikatorów graczy');
  const mapErrs = [
    await code('get_species_map', 'nie-ma', VW, 'season'),
    await code('get_species_map', 'podgrzybek-brunatny', 'nie-ma-takiego', 'season'),
    await code('get_species_map', 'podgrzybek-brunatny', VW, 'records'),
  ];
  ok(
    mapErrs[0]?.code === 'P0002' && mapErrs[1]?.code === 'P0001' && mapErrs[2]?.code === 'P0001' && mapErrs[2].message.includes('invalid_period'),
    'get_species_map: nieznany gatunek → P0002, województwo → P0001 invalid_voivodeship, okres → P0001 invalid_period',
    mapErrs,
  );

  // ── Uprawnienia ──
  await admin();
  ok(
    (await code('get_gmina_species_evidence', G1, 14))?.code === '28000' && (await code('get_species_map', 'podgrzybek-brunatny', VW, 'week'))?.code === '28000',
    'szanse / mapa gatunku: bez sesji → 28000',
  );
  await db.exec('set role anon');
  ok(
    (await err(`select get_gmina_species_evidence($1, 14)`, [G1]))?.message.includes('permission denied') &&
      (await err(`select get_species_map('podgrzybek-brunatny', $1, 'week')`, [VW]))?.message.includes('permission denied'),
    'anon nie ma get_gmina_species_evidence() / get_species_map()',
  );
  await db.exec('reset role');
}

// =============================================================================
// Katalog gatunków (20261013100000_species_content.sql + seed z src/data/mock/species.ts): treść i ochrona
// =============================================================================
{
  await admin();
  const cat = await one(
    `select count(*) n,
            count(*) filter (where array_length(season_weights, 1) = 12 and (select max(x) from unnest(season_weights) x) = 1) season,
            count(*) filter (where cardinality(habitats) > 0) habitats,
            count(*) filter (where length(description) > 20) described,
            count(*) filter (where protection = 'scisla') scisla, count(*) filter (where protection = 'czesciowa') czesciowa
       from species`,
  );
  const speciesSrc = readFileSync(path.join(root, 'src', 'data', 'mock', 'species.ts'), 'utf8');
  const appScisla = (speciesSrc.match(/protection: 'scisla'/g) ?? []).length;
  const appCzesciowa = (speciesSrc.match(/protection: 'czesciowa'/g) ?? []).length;
  ok(
    Number(cat.n) === 120 && Number(cat.season) === 120 && Number(cat.habitats) === 120 && Number(cat.described) === 120 &&
      Number(cat.scisla) === appScisla && Number(cat.czesciowa) === appCzesciowa && appScisla > 0 && appCzesciowa > 0,
    `katalog: 120 gatunków z sezonem (12 miesięcy, szczyt 1), siedliskami i opisem; ochrona jak w aplikacji (${appScisla} ścisła, ${appCzesciowa} częściowa)`,
    cat,
  );
  const looks = await one(
    `select count(*) n, count(distinct species_id) sp,
            count(*) filter (where sort = 0) main, count(*) filter (where sort > 0 and lookalike_id is not null) linked_extra,
            (select count(*) from (select species_id from species_lookalikes group by species_id having count(*) filter (where sort = 0) <> 1) x) bad
       from species_lookalikes`,
  );
  ok(
    Number(looks.n) > Number(looks.sp) && Number(looks.main) === Number(looks.sp) && Number(looks.bad) === 0 && Number(looks.linked_extra) === 0,
    'katalog: wiele sobowtórów na gatunek, dokładnie jeden główny (sort 0), lookalike_id tylko przy głównym',
    looks,
  );

  // ── Gatunek chroniony: tylko zdjęcie (submit_find → collected = false), XP jak utils/xp.ts ──
  const pUser = await newUser('chroniony.tester');
  await as(pUser);
  const PF = randomUUID();
  const pf = await submit({
    id: PF, gminaId: 'zakopane', speciesId: 'soplowka-jezowata', rarity: 'legendarny', confidence: 0.92,
    dims: { cap_cm: 18, height_cm: 14, weight_g: 550, age_days: 4 },
  });
  ok(pf.collected === false, 'submit_find: gatunek chroniony (soplówka jeżowata, ochrona ścisła) → collected = false', pf);
  const lineStr = (xp) => xp.lines.map((l) => `${l.label}:${l.xp}`).join('|');
  const pr1 = (await one('select claim_find($1) r', [PF])).r;
  ok(
    lineStr(pr1.xp) === 'Zdjęcie gatunku chronionego (½ bazy):400|Zostawiony w lesie – gatunek chroniony:30|Nowy gatunek w atlasie:50' &&
      pr1.xp.total === 480,
    'claim_find: chroniony → ½ bazy + „Zostawiony w lesie – gatunek chroniony” +30 + nowy gatunek (lustro computeFindXp)',
    pr1.xp,
  );
  const pr1again = (await one('select claim_find($1) r', [PF])).r;
  ok(lineStr(pr1again.xp) === lineStr(pr1.xp) && pr1again.xp.total === 480, 'claim_find chronionego jest idempotentny (zapisana nagroda)');
  // Chroniony i trujący (borowik szatański) – też tylko zdjęcie, etykieta „chronionego” i bonus.
  const PF2 = randomUUID();
  const pf2 = await submit({
    id: PF2, gminaId: 'zakopane', speciesId: 'borowik-szatanski', rarity: 'epicki', confidence: 0.9,
    dims: { cap_cm: 16, height_cm: 11, weight_g: 400, age_days: 3 },
  });
  const pr2 = (await one('select claim_find($1) r', [PF2])).r;
  ok(
    pf2.collected === false &&
      lineStr(pr2.xp) === 'Zdjęcie gatunku chronionego (½ bazy):150|Zostawiony w lesie – gatunek chroniony:30|Nowy gatunek w atlasie:50',
    'chroniony i trujący (borowik szatański): collected = false, ½ bazy + bonus chronionego',
    pr2.xp,
  );
  const pProf = await one('select mushrooms_count from profiles where id = $1', [pUser]);
  ok(pProf.mushrooms_count === 0, 'gatunki chronione nie trafiają do koszyka (mushrooms_count = 0)', pProf);
  await admin();
}

// =============================================================================
// Progresja (20261013110000_progression.sql): diamenty, nowe metryki (player_metrics), zadania rotacyjne
// dzienne + tygodniowe (quests_for ↔ src/utils/quests.ts), synchronizacja osiągnięć z wyzwalaczy
// =============================================================================
{
  await admin();
  // Pełny słownik (jak po seedzie) i prawdziwa rotacja zadań.
  await db.query('update achievements set active = true');
  await db.query("select set_config('app.quests_design', 'off', false)");

  // ── Słownik = definicje aplikacji ──
  const dbAch = Object.fromEntries((await db.query('select id, category::text, metric::text, secret, active from achievements')).rows.map((r) => [r.id, r]));
  const dbTiers = (await db.query('select achievement_id, tier, target::float8 target, xp, medal::text medal from achievement_tiers order by 1, 2')).rows;
  const sqlMetric = (m) =>
    m.kind === 'counter' ? app.counterSqlKey(m.counter) : ({ maxOfSpecies: 'max_of_species', speciesWithCount: 'species_with_count', lookalikePairs: 'lookalike_pairs', xxlFinds: 'xxl_finds' })[m.kind] ?? m.kind;
  const mismatch = app.ACHIEVEMENTS.filter((a) => {
    const r = dbAch[a.id];
    const t = dbTiers.filter((x) => x.achievement_id === a.id);
    return (
      !r || !r.active || r.category !== a.category || r.metric !== sqlMetric(a.metric) || r.secret !== !!a.secret ||
      t.length !== a.tiers.length ||
      t.some((x, i) => x.target !== a.tiers[i].target || x.xp !== a.tiers[i].xp || x.medal !== app.tierKind(a.tiers.length, i + 1))
    );
  });
  ok(mismatch.length === 0, 'progresja: słownik w bazie = ACHIEVEMENTS (kategoria, metryka, stopnie, XP, medal)', mismatch.map((a) => a.id));
  const diamonds = dbTiers.filter((t) => t.medal === 'diament');
  ok(
    diamonds.length === app.ACHIEVEMENTS.filter((a) => a.tiers.length === 5).length && diamonds.every((t) => t.tier === 5),
    `progresja: ${diamonds.length} stopni diamentowych (5. stopień)`,
  );
  const pool = (await db.query(`select id, kind::text, period::text, difficulty, params, xp, target::float8 target from quest_templates where active order by sort, id`)).rows;
  ok(
    pool.length === app.QUEST_POOL.length &&
      pool.every((q, i) => {
        const a = app.QUEST_POOL[i];
        return q.id === a.id && q.kind === app.questKindToSql(a.kind) && q.period === app.questPeriod(a) && q.difficulty === (a.difficulty ?? 1) &&
          q.xp === a.xp && q.target === a.target && (q.params.speciesId ?? null) === (a.speciesId ?? null) &&
          JSON.stringify(q.params.months ?? null) === JSON.stringify(a.months ?? null);
      }),
    `progresja: pula zadań w bazie = QUEST_POOL (${pool.length}, ${pool.filter((q) => q.period === 'weekly').length} tygodniowych; kolejność, parametry)`,
  );

  // ── Losowanie: ten sam hash i wynik co aplikacja ──
  ok(
    Number((await one(`select quest_hash('abc') h`)).h) === app.questHash('abc') && Number((await one(`select quest_hash('') h`)).h) === 7,
    `progresja: quest_hash = questHash z aplikacji (${app.questHash('abc')})`,
  );
  const wk = await one(`select week_start('2026-10-07')::text a, week_start('2026-10-05')::text b, week_start('2026-10-11')::text c`);
  ok(wk.a === '2026-10-05' && wk.b === '2026-10-05' && wk.c === '2026-10-05', 'progresja: tydzień od poniedziałku (week_start)', wk);
  const qUsers = ['00000000-0000-4000-8000-000000000001', '7f9c1e2a-0b1d-4c55-9a77-3e2f1d0c9b8a', randomUUID()];
  const qDays = ['2026-10-07', '2026-10-11', '2026-10-12', '2026-04-20', '2026-05-03', '2026-08-15', '2026-12-31', '2027-01-01'];
  const diffs = [];
  for (const u of qUsers) {
    for (const d of qDays) {
      const rows = (await db.query('select quest_id, period::text period from quests_for($1, $2) order by period, slot', [u, d])).rows;
      const sel = app.selectQuests(app.QUEST_POOL, u, d);
      const got = `${rows.filter((r) => r.period === 'daily').map((r) => r.quest_id)}|${rows.filter((r) => r.period === 'weekly').map((r) => r.quest_id)}`;
      const want = `${sel.daily.map((q) => q.id)}|${sel.weekly.map((q) => q.id)}`;
      if (got !== want) diffs.push({ u, d, got, want });
    }
  }
  ok(diffs.length === 0, `progresja: quests_for = selectQuests z aplikacji (${qUsers.length} graczy × ${qDays.length} dni, także sezonowe i granice tygodni)`, diffs);
  const q1 = (await db.query(`select quest_id, period::text period from quests_for($1, '2026-10-07') order by period, slot`, [qUsers[0]])).rows;
  const kindOf = Object.fromEntries(pool.map((q) => [q.id, q]));
  const dailyQ = q1.filter((r) => r.period === 'daily');
  const weeklyQ = q1.filter((r) => r.period === 'weekly');
  ok(
    dailyQ.length === 3 && weeklyQ.length === 3 && new Set(dailyQ.map((r) => kindOf[r.quest_id].kind)).size === 3 &&
      new Set(weeklyQ.map((r) => kindOf[r.quest_id].kind)).size === 3 && dailyQ.some((r) => kindOf[r.quest_id].difficulty === 1),
    'progresja: 3 dzienne (bez powtórzeń rodzaju, co najmniej jedno łatwe) + 3 tygodniowe',
    q1,
  );
  const sameWeek = await one(
    `select (select array_agg(quest_id order by slot) from quests_for($1, '2026-10-05') where period = 'weekly')::text a,
            (select array_agg(quest_id order by slot) from quests_for($1, '2026-10-11') where period = 'weekly')::text b`,
    [qUsers[1]],
  );
  ok(sameWeek.a === sameWeek.b, 'progresja: zadania tygodniowe te same od poniedziałku do niedzieli', sameWeek);
  await db.query("select set_config('app.quests_design', 'on', false)");
  const design = (await db.query(`select quest_id from quests_for($1, '2026-10-07') order by slot`, [qUsers[0]])).rows.map((r) => r.quest_id);
  await db.query("select set_config('app.quests_design', 'off', false)");
  ok(design.join() === 'q-scan-5,q-rare-1,q-km-5', 'progresja: tryb makiety (dev) – stałe zadania dnia, bez tygodniowych', design);
  await db.query(`update app_config set value = 'false' where key = 'dev_tools'`);
  await db.query("select set_config('app.quests_design', 'on', false)");
  const designOff = Number((await one(`select count(*) n from quests_for($1, '2026-10-07')`, [qUsers[0]])).n);
  await db.query("select set_config('app.quests_design', 'off', false)");
  await db.query(`update app_config set value = 'true' where key = 'dev_tools'`);
  ok(designOff === 6, 'progresja: tryb makiety działa tylko przy dev_tools (w chmurze zawsze rotacja)', designOff);

  // ── Nowy gracz: zadania (dzienne i tygodniowe) w prawdziwej grze ──
  // Pula zawężona na czas testu – losowanie zwróci dokładnie te zadania (po jednym rodzaju).
  const testPool = ['d-scan-3', 'd-epic-1', 'd-variety-3', 'w-trips-3', 'w-react-15', 'w-variety-10'];
  await db.query('update quest_templates set active = (id = any($1))', [testPool]);
  const P = await newUser('progres.tester');
  const R = await newUser('progres.reakcje');
  await db.query(`update profiles set home_gmina_id = 'suprasl' where id = any($1)`, [[P, R]]);
  await as(P);
  const gs0 = await state();
  ok(
    keys(gs0.quests) === 'daily,day,progress,week,weekly' && DAY_RE.test(gs0.quests.week) &&
      [...gs0.quests.daily].sort().join() === 'd-epic-1,d-scan-3,d-variety-3' &&
      gs0.quests.progress.map((q) => q.questId).join() === gs0.quests.daily.join() &&
      gs0.quests.weekly.map((q) => q.questId).sort().join() === 'w-react-15,w-trips-3,w-variety-10' &&
      gs0.quests.weekly.every((q) => q.progress === 0 && q.completed === false),
    'get_game_state: quests.daily (wylosowane), progress tylko wylosowanych, week + weekly (postęp tygodniowych)',
    gs0.quests,
  );
  ok(
    typeof gs0.counters === 'object' && gs0.counters.trips === 0 && Array.isArray(gs0.counters.gminy) && gs0.counters.gminy.length === 0 &&
      app.ACHIEVEMENTS.filter((a) => a.metric.kind === 'counter').every((a) => app.counterSqlKey(a.metric.counter) in gs0.counters) &&
      'seasons' in gs0.counters,
    'get_game_state: counters (player_metrics) – wszystkie metryki liczników z aplikacji',
    gs0.counters,
  );
  const PT = randomUUID();
  await startTrip('suprasl', PT, iso(2 * H));
  const claim = async (o) => {
    const id = randomUUID();
    await submit({ id, tripId: PT, gminaId: 'suprasl', foundAt: iso(H), ...o });
    return (await one('select claim_find($1) r', [id])).r;
  };
  await claim({ speciesId: 'podgrzybek-brunatny', rarity: 'pospolity', dims: { cap_cm: 9, height_cm: 9, weight_g: 100, age_days: 3 } });
  await claim({ speciesId: 'podgrzybek-brunatny', rarity: 'pospolity', dims: { cap_cm: 8, height_cm: 9, weight_g: 90, age_days: 3 } });
  const r3 = await claim({ speciesId: 'borowik-szlachetny', rarity: 'epicki', foundAt: iso(30 * 60e3) });
  const uq = async (u) =>
    Object.fromEntries(
      (await db.query(`select quest_id, progress::float8 p, completed_at is not null as done, day::text as day from user_quests where user_id = $1`, [u])).rows.map((r) => [
        r.quest_id,
        r,
      ]),
    );
  let pq = await uq(P);
  const todayStr = (await one('select local_today()::text d')).d;
  const weekStr = app.weekStartKey(todayStr);
  ok(
    pq['d-scan-3'].done && pq['d-scan-3'].p === 3 && pq['d-epic-1'].done && pq['d-variety-3'].p === 2 && !pq['d-variety-3'].done &&
      pq['w-variety-10'].p === 2 && pq['w-variety-10'].day === weekStr && pq['d-scan-3'].day === todayStr && !pq['w-trips-3'],
    'zadania: skany (claim_find), epicki i różne gatunki (wyzwalacz) – dzienne z dniem dzisiejszym, tygodniowe z poniedziałkiem',
    pq,
  );
  ok(
    r3.unlockedAchievements.some((u) => u.id === 'epickie-okazy' && u.tier === 1),
    'claim_find: nowe osiągnięcia w nagrodzie (Epickie okazy – brąz)',
    r3.unlockedAchievements,
  );
  const qxp = await one(`select count(*) n, sum(amount) xp from xp_events where user_id = $1 and source = 'quest'`, [P]);
  ok(Number(qxp.n) === 2 && Number(qxp.xp) === 60 + 300, 'zadania: XP za ukończone (Zeskanuj 3 +60, Epicki okaz +300)', qxp);
  await one('select * from finish_trip($1, $2, $3, null, $4)', [PT, 6000, 2 * 3600 - 60, iso(60e3)]);
  pq = await uq(P);
  ok(pq['w-trips-3']?.p === 1 && pq['w-trips-3'].day === weekStr, 'zadania: koniec wyprawy → „Zakończ 3 wyprawy” 1/3 (wyzwalacz trips)', pq['w-trips-3']);
  const gs1 = await state();
  const c1 = gs1.counters;
  ok(
    c1.trips === 1 && c1.max_trip_km === 6 && c1.max_trip_min === 119 && c1.epic_finds === 1 && c1.rare_finds === 1 &&
      c1.gminy.join() === 'suprasl' && c1.voivodeships.join() === 'podlaskie' && c1.forests.join() === 'Puszcza Knyszyńska' &&
      c1.away_finds === 0 && c1.same_species_run === 2 && c1.max_trip_finds === 3 && c1.active_days === 1 && c1.max_streak === 1 &&
      c1.daily_quests_done === 2 && c1.weekly_quests_done === 0 && c1.months.length >= 1 && c1.seasons >= 1 && Number(c1.total_km) === 6,
    'player_metrics: wyprawy, okazy, odkrywca, pory roku, seria i zadania jak liczniki aplikacji',
    c1,
  );
  ok(
    gs1.quests.weekly.find((q) => q.questId === 'w-trips-3')?.progress === 1 &&
      gs1.quests.progress.find((q) => q.questId === 'd-scan-3')?.completed === true,
    'get_game_state: postęp dzienny i tygodniowy z user_quests',
    gs1.quests,
  );
  // Osiągnięcia z wyzwalacza końca wyprawy: Puszcze i bory (1 kompleks), Długi marsz (6 km ≥ 5), Cały dzień w lesie (≥ 60 min).
  const pAch = Object.fromEntries((await db.query('select achievement_id, tier from user_achievements where user_id = $1', [P])).rows.map((r) => [r.achievement_id, r.tier]));
  ok(
    pAch['puszcze-i-bory'] === 1 && pAch['dlugi-marsz'] === 1 && pAch['caly-dzien-w-lesie'] === 1 && pAch['epickie-okazy'] === 1 && !pAch.wedrowiec,
    'sync na koniec wyprawy: Długi marsz, Cały dzień w lesie; z claim_find: Epickie okazy, Puszcze i bory',
    pAch,
  );

  // ── Reset dnia i tygodnia (dane z „wczoraj” i „zeszłego tygodnia” nie liczą się do bieżących zadań) ──
  await admin();
  await db.query(`update user_quests set day = day - 7 where user_id = $1 and quest_id like 'w-%'`, [P]);
  await db.query(`update user_quests set day = day - 1 where user_id = $1 and quest_id like 'd-%'`, [P]);
  await as(P);
  const gs2 = await state();
  ok(
    gs2.quests.weekly.every((q) => q.progress === 0 && !q.completed) && gs2.quests.progress.every((q) => q.progress === 0 && !q.completed) &&
      gs2.counters.daily_quests_done === 2,
    'reset: nowy dzień i nowy tydzień (poniedziałek) – zadania od zera, wykonane zostają w licznikach',
    gs2.quests,
  );

  // ── Publikacja → zadanie i Kronikarz; reakcje → zadanie dającego (bez nabijania) i osiągnięcie odbiorcy ──
  await admin();
  await db.query('update quest_templates set active = (id = any($1))', [[...testPool, 'w-publish-2'].filter((x) => x !== 'w-react-15')]);
  await as(P);
  const post = await one('select * from publish_trip($1, false)', [PT]);
  pq = await uq(P);
  ok(pq['w-publish-2']?.p === 1, 'publish_trip → „Opublikuj 2 wyprawy” 1/2 (wyzwalacz posts)', pq['w-publish-2']);
  ok(
    (await one(`select tier from user_achievements where user_id = $1 and achievement_id = 'kronikarz'`, [P]))?.tier === 1 &&
      Number((await one(`select count(*) n from xp_events where user_id = $1 and ref_id = 'kronikarz:1'`, [P])).n) === 1,
    'sync po publikacji: Kronikarz (brąz) z XP',
  );
  await admin();
  await db.query('update quest_templates set active = (id = any($1))', [testPool]);
  await db.query(`update posts set visible_from = now() - interval '1 minute' where author_id = $1`, [P]);
  // Drugi wpis P (bez wyprawy) – żeby R mógł zareagować na dwa różne.
  const post2 = (
    await one(
      `insert into posts (author_id, kind, gmina_id, payload, visible_from) values ($1, 'levelup', 'suprasl', '{"level": 2}', now() - interval '1 minute') returning id`,
      [P],
    )
  ).id;
  await as(R);
  await call('toggle_reaction', post.id);
  await call('toggle_reaction', post2);
  await call('toggle_reaction', post2); // cofnięcie
  await call('toggle_reaction', post2); // i ponowienie – nie nabija
  const rq = await uq(R);
  ok(rq['w-react-15']?.p === 2, 'zadanie reakcji: 2 różne wpisy (cofnięcie i ponowienie nie nabija)', rq['w-react-15']);
  await admin();
  const rm = (await one('select player_metrics($1) m', [R])).m;
  ok(rm.reactions_given === 2, 'player_metrics: reakcje dane (cudze wpisy)', rm.reactions_given);
  // Odbiorca: 10 reakcji różnych graczy (bezpośredni INSERT – ten sam wyzwalacz) → Ulubieniec lasu (brąz).
  // R dał już 2 reakcje (oba wpisy P) + 7 graczy = 9; dziesiąta – osobno.
  for (let i = 0; i < 7; i++) {
    await db.query('insert into post_reactions (post_id, user_id) values ($1, $2)', [post.id, await newUser(`progres.fan${i}`)]);
  }
  const before10 = await one(`select tier from user_achievements where user_id = $1 and achievement_id = 'ulubieniec-lasu'`, [P]);
  const fan10 = await newUser('progres.fan9');
  await db.query('insert into post_reactions (post_id, user_id) values ($1, $2)', [post2, fan10]);
  const after10 = await one(`select tier from user_achievements where user_id = $1 and achievement_id = 'ulubieniec-lasu'`, [P]);
  ok(!before10 && after10?.tier === 1, 'sync po reakcji (strona ODBIORCY): 10. reakcja → Ulubieniec lasu (brąz)', { before10, after10 });

  // ── Znajomi i komentarze: sync obu stron przy akceptacji, autora komentarza ──
  await as(P);
  await call('send_friend_request', R);
  ok(!(await one(`select 1 x from user_achievements where user_id = $1 and achievement_id = 'wataha'`, [P])), 'zaproszenie (pending) – jeszcze bez Leśnej watahy');
  await as(R);
  await call('respond_friend_request', P, true);
  const wat = (await db.query(`select user_id from user_achievements where achievement_id = 'wataha' and user_id = any($1)`, [[P, R]])).rows;
  ok(wat.length === 2, 'akceptacja zaproszenia → Leśna wataha (brąz) dla obu stron', wat);
  await call('add_comment', post.id, 'Piękne okazy!');
  await admin();
  ok((await one('select player_metrics($1) m', [R])).m.comments === 1, 'add_comment → licznik komentarzy (Gawędziarz)');

  // ── Diament: seria 365 dni → wszystkie 5 stopni, XP za każdy ──
  await admin();
  await db.query(`update profiles set streak_days = 365 where id = $1`, [P]);
  const unl = (await one('select sync_achievements($1) r', [P])).r;
  const seria = unl.filter((u) => u.id === 'seria-dni');
  ok(
    seria.map((u) => `${u.tier}:${u.xp}`).join() === app.ACHIEVEMENT_BY_ID['seria-dni'].tiers.map((t, i) => `${i + 1}:${t.xp}`).join() &&
      seria.at(-1).xp === 2500,
    'diament: seria 365 dni → wszystkie stopnie po kolei aż do diamentu (+2500 XP)',
    seria,
  );
  const dia = await one(
    `select ua.tier, t.medal::text medal, (select count(*) from xp_events e where e.user_id = $1 and e.ref_id = 'seria-dni:5') ev
       from user_achievements ua join achievement_tiers t on t.achievement_id = ua.achievement_id and t.tier = ua.tier
      where ua.user_id = $1 and ua.achievement_id = 'seria-dni'`,
    [P],
  );
  ok(dia.tier === 5 && dia.medal === 'diament' && Number(dia.ev) === 1, 'diament: user_achievements.tier = 5 (medal diament), wpis XP „seria-dni:5”', dia);
  ok((await one('select sync_achievements($1) r', [P])).r.length === 0, 'sync_achievements idempotentny (drugi raz nic)');

  // ── seed_achievements: nowe metryki istniejącego gracza bez XP ──
  const S = await newUser('progres.seed');
  await db.query(
    `insert into trips (user_id, gmina_id, status, started_at, ended_at, duration_s, distance_m)
     select $1, 'suprasl', 'finished', ((local_today() - g) + time '10:00') at time zone 'Europe/Warsaw',
            ((local_today() - g) + time '12:00') at time zone 'Europe/Warsaw', 7200, 5000
       from generate_series(1, 6) g`,
    [S],
  );
  await db.query('select seed_achievements($1)', [S]);
  const sa = Object.fromEntries((await db.query('select achievement_id, tier from user_achievements where user_id = $1', [S])).rows.map((r) => [r.achievement_id, r.tier]));
  ok(
    sa.wedrowiec === 1 && sa['seria-dni'] === 1 && sa['dlugi-marsz'] === 1 && sa['caly-dzien-w-lesie'] === 2 &&
      Number((await one(`select count(*) n from xp_events where user_id = $1`, [S])).n) === 0,
    'seed_achievements: 6 wypraw w 6 kolejnych dni → Wędrowiec, Seria, Długi marsz, Cały dzień (srebro) – bez XP',
    sa,
  );
  const ap = (await (async () => {
    await as(S);
    const rows = (await db.query('select * from achievement_progress()')).rows;
    await admin();
    return rows;
  })());
  ok(
    ap.length === app.ACHIEVEMENTS.length && Number(ap.find((r) => r.achievement_id === 'wedrowiec').value) === 6 &&
      Number(ap.find((r) => r.achievement_id === 'seria-dni').value) === 6 && Number(ap.find((r) => r.achievement_id === 'wedrowiec').next_target) === 15,
    'achievement_progress(): metryki liczników (Wędrowiec 6/15, Seria 6)',
  );

  // ── Uprawnienia: wszystko nowe wewnętrzne ──
  await as(P);
  ok(
    (await fails(`select * from quests_for($1)`, [P]))?.includes('permission denied') &&
      (await fails(`select player_metrics($1)`, [P]))?.includes('permission denied') &&
      (await fails(`select bump_quest($1, 'd-scan-3', 99, null)`, [P]))?.includes('permission denied'),
    'klient nie wywoła quests_for / player_metrics / bump_quest (wyniki tylko przez get_game_state)',
  );
  await admin();
  // Stan jak po seedzie (pula zadań, tryb makiety dla ewentualnych dalszych testów).
  await db.query(`update quest_templates set active = true where id = any($1)`, [app.QUEST_POOL.map((q) => q.id)]);
}

console.log(`\n${passed} sprawdzeń OK`);
