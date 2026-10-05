/**
 * Test schematu bez Dockera: Postgres 17 + PostGIS w WASM (PGlite).
 * Wgrywa supabase/migrations/*.sql + seed.sql na atrapy schematów auth/storage Supabase
 * i przechodzi pętlę z makiety: wyprawa → znalezisko → nagroda → publikacja → feed.
 * Uruchom: npm run db:test
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { postgis } from '@electric-sql/pglite-postgis';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('uncaughtException', (e) => {
  console.error('✗ błąd:', e.message, e.where ? `(${e.where})` : '');
  process.exit(1);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = await PGlite.create({ extensions: { postgis, citext } });

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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
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
const counts = await one(`select (select count(*) from species) sp, (select count(*) from gminy) gm, (select count(*) from badges) b`);
ok(Number(counts.sp) === 36 && Number(counts.gm) === 38 && Number(counts.b) === 5, 'seed: 36 gatunków, 38 gmin, 5 odznak');

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

// ── RLS i uprawnienia ──
ok((await fails('update profiles set total_xp = 999999 where id = $1', [kuba]))?.includes('permission denied'), 'klient nie może zmienić sobie XP');
await db.query(`update profiles set display_name = 'Kuba N.' where id = $1`, [kuba]);
ok((await one('select display_name from profiles where id = $1', [kuba])).display_name === 'Kuba N.', 'klient może zmienić nazwę');
ok((await fails(`insert into xp_events (user_id, source, amount) values ($1, 'admin', 1000)`, [kuba]))?.includes('permission denied'), 'klient nie dopisze wpisu do księgi XP');
await as(ola);
ok((await db.query('select * from finds')).rows.length === 0, 'RLS: cudze znaleziska niewidoczne');
ok((await db.query('select * from trips')).rows.length === 0, 'RLS: cudze wyprawy niewidoczne');

// ── Dystans → zadanie „Przejdź 5 km” ──
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
const mine = (await db.query(`select * from get_feed('gmina')`)).rows;
ok(mine.some((p) => p.id === post.id && p.mine), 'autor widzi swój wpis od razu');
await as(ola);
ok(!(await db.query(`select * from get_feed('gmina')`)).rows.some((p) => p.id === post.id), 'inni nie widzą wpisu przed visible_from');
await admin();
await db.query(`update posts set visible_from = now() - interval '1 minute' where id = $1`, [post.id]);
await as(ola);
ok((await db.query(`select * from get_feed('gmina')`)).rows.some((p) => p.id === post.id), 'po 24 h wpis widać w „Moja gmina”');
ok(!(await db.query(`select * from get_feed('friends')`)).rows.some((p) => p.id === post.id), 'bez znajomości wpisu nie ma w „Znajomi”');
await db.query('insert into friendships (friend_id) values ($1)', [kuba]);
await as(kuba);
await db.query(`update friendships set status = 'accepted' where user_id = $1`, [ola]);
await as(ola);
ok((await db.query(`select * from get_feed('friends')`)).rows.some((p) => p.id === post.id), 'po akceptacji znajomości wpis jest w „Znajomi”');
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

console.log(`\n${passed} sprawdzeń OK`);
