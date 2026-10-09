/**
 * Generuje supabase/seed.sql ze słowników mocków (te same ID co w aplikacji)
 * i wszystkich gmin z indeksu PRG (assets/geo/gminy-index.geo).
 * Uruchom: npm run db:seed            – seed lokalny (narzędzia deweloperskie: app_config.dev_tools = true i EXECUTE
 *                                       na RPC dev_* – migracje go nie nadają, patrz scripts/seed-dev.ts)
 *          npm run db:seed -- --cloud – seed do chmury (dev_tools = false, dev_* bez EXECUTE); potem wróć do lokalnego
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BADGES, QUEST_POOL } from '../src/data/mock/game';
import { buildGminaStats, GMINY } from '../src/data/mock/gminy';
import type { GminaIndexFile } from '../src/geo/gminaIndex';
import { SPECIES } from '../src/data/mock/species';
import { ACHIEVEMENTS, tierKind, type AchievementMetric } from '../src/utils/achievements';
import { BADGE_RULES } from '../src/utils/badges';
import { counterSqlKey } from '../src/utils/counters';
import { questKindToSql, questPeriod } from '../src/utils/quests';
import { devToolsSeedSql } from './seed-dev';

const q = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const CLOUD = process.argv.includes('--cloud');

const out: string[] = [
  `-- WYGENEROWANE przez scripts/gen-seed.ts${CLOUD ? ' --cloud' : ''} z src/data/mock – nie edytuj ręcznie.`,
  '-- Gminy z assets/geo/gminy-index.geo (PRG, npm run geo:build); granice (boundary) uzupełnia import PRG (GUGiK).',
  '',
];

// Kody TERYT z indeksu PRG (npm run geo:build) – te same slugi co w aplikacji.
const geoIndex = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'assets', 'geo', 'gminy-index.geo'), 'utf8'),
) as GminaIndexFile;
const terytById = new Map(geoIndex.gminy.map((row) => [row[1], row[0]]));
const KIND = { 1: 'miejska', 2: 'wiejska', 3: 'miejsko-wiejska' } as const;

// Narzędzia deweloperskie – tylko lokalnie (flaga + EXECUTE na RPC dev_*), w chmurze NIGDY: scripts/seed-dev.ts.
out.push(...devToolsSeedSql(CLOUD));

// Kompleksy leśne
const forests = [...new Set(GMINY.map((g) => g.forest).filter((f): f is string => !!f))];
out.push('insert into public.forest_regions (id, name) values');
out.push(forests.map((f) => `  (${q(slug(f))}, ${q(f)})`).join(',\n') + '\non conflict (id) do nothing;', '');

// Gminy
out.push('insert into public.gminy (id, teryt, name, voivodeship, forest_region_id, tile_row, tile_col) values');
out.push(
  GMINY.map(
    (g) =>
      `  (${q(g.id)}, ${q(terytById.get(g.id))}, ${q(g.name)}, ${q(g.voivodeship)}, ${q(g.forest ? slug(g.forest) : null)}, ${q(g.tile?.row)}, ${q(g.tile?.col)})`,
  ).join(',\n') + '\non conflict (id) do nothing;',
  '',
);

// Wszystkie gminy z PRG (wykrywanie z GPS w całej Polsce → FK wypraw i znalezisk). Upsert tylko kolumn z PRG –
// kompleks leśny, pozycja na siatce i granice gmin z danymi gry zostają.
out.push(
  `-- ${geoIndex.gminy.length} gmin z PRG (${geoIndex.source})`,
  'insert into public.gminy (id, teryt, name, voivodeship, powiat, kind, forest_pct) values',
);
out.push(
  geoIndex.gminy
    .map(
      ([teryt, id, name, kind, , , forestPct]) =>
        `  (${q(id)}, ${q(teryt)}, ${q(name)}, ${q(geoIndex.woj[teryt.slice(0, 2)])}, ${q(geoIndex.powiaty[teryt.slice(0, 4)] ?? null)}, ${q(KIND[kind])}, ${q(forestPct)})`,
    )
    .join(',\n') +
    '\non conflict (id) do update set teryt = excluded.teryt, name = excluded.name, voivodeship = excluded.voivodeship,' +
    '\n  powiat = excluded.powiat, kind = excluded.kind, forest_pct = excluded.forest_pct;',
  '',
);

// Gatunki (treść karty: sezon, siedliska, ochrona, opis – migracja 20261013100000_species_content.sql). Upsert treści –
// poprawki katalogu trafiają do bazy przy kolejnym seedzie; atlas_no (kolejność atlasu) tylko przy wstawieniu.
const sqlArray = (xs: readonly (string | number)[] | undefined, type: 'numeric' | 'text') =>
  xs?.length ? `array[${xs.map((x) => q(x)).join(', ')}]::${type}[]` : 'null';
out.push(
  'insert into public.species (id, atlas_no, name, latin, short_name, rarity, edibility, habitat, clustered, typical_cap_cm, typical_height_cm, typical_weight_g,',
  '  season_weights, habitats, protection, description) values',
);
out.push(
  SPECIES.map(
    (s, i) =>
      `  (${q(s.id)}, ${i + 1}, ${q(s.name)}, ${q(s.latin)}, ${q(s.shortName)}, ${q(s.rarity)}, ${q(s.edibility)}, ${q(s.habitat)}, ${!!s.clustered}, ${s.typical.capCm}, ${s.typical.heightCm}, ${s.typical.weightG},` +
      `\n   ${sqlArray(s.seasonWeights, 'numeric')}, ${sqlArray(s.habitats, 'text')}, ${q(s.protection ?? null)}, ${q(s.description ?? null)})`,
  ).join(',\n') +
    '\non conflict (id) do update set name = excluded.name, latin = excluded.latin, short_name = excluded.short_name,' +
    '\n  rarity = excluded.rarity, edibility = excluded.edibility, habitat = excluded.habitat, clustered = excluded.clustered,' +
    '\n  typical_cap_cm = excluded.typical_cap_cm, typical_height_cm = excluded.typical_height_cm, typical_weight_g = excluded.typical_weight_g,' +
    '\n  season_weights = excluded.season_weights, habitats = excluded.habitats, protection = excluded.protection, description = excluded.description;',
  '',
);

// Sobowtóry – wszystkie (Species.lookalikes; sort 0 = główny = Species.lookalike). lookalike_id tylko dla głównego:
// para do osiągnięcia „Mistrz sobowtórów” liczona jak w aplikacji (utils/achievements.ts – Species.lookalike).
const byName = new Map(SPECIES.map((s) => [s.name.toLowerCase().replace(/ \(.*\)$/, ''), s.id]));
const lookRows = SPECIES.flatMap((s) =>
  (s.lookalikes?.length ? s.lookalikes : s.lookalike ? [s.lookalike] : []).map((l, i) => ({ s, l, i })),
);
const looks = new Set(lookRows.map((r) => r.s.id));
out.push('insert into public.species_lookalikes (species_id, lookalike_name, lookalike_id, lookalike_edibility, tip, sort) values');
out.push(
  lookRows
    .map(
      ({ s, l, i }) =>
        `  (${q(s.id)}, ${q(l.name)}, ${q(i === 0 ? (byName.get(l.name.toLowerCase()) ?? null) : null)}, ${q(l.edibility)}, ${q(l.tip)}, ${i})`,
    )
    .join(',\n') +
    '\non conflict (species_id, lookalike_name) do update set lookalike_id = excluded.lookalike_id,' +
    '\n  lookalike_edibility = excluded.lookalike_edibility, tip = excluded.tip, sort = excluded.sort;',
  '-- Sobowtóry usunięte z katalogu (dla gatunków z katalogu seed jest źródłem prawdy listy sobowtórów).',
  'delete from public.species_lookalikes l',
  ` where l.species_id in (${SPECIES.map((s) => q(s.id)).join(', ')})`,
  `   and (l.species_id, l.lookalike_name) not in (${lookRows.map(({ s, l }) => `(${q(s.id)}, ${q(l.name)})`).join(', ')});`,
  '',
);

// Odznaki z regułami (src/utils/badges.ts → format reguł SQL)
const SQL_RULES: Record<string, object> = {
  'krol-puszczy': {
    type: 'species_in_region',
    species: 'borowik-szlachetny',
    region: 'puszcza-knyszynska',
    count: BADGE_RULES['krol-puszczy'].target,
  },
  'ranny-ptaszek': { type: 'early_bird', before: '06:00' },
  'km-100': { type: 'distance_km', km: BADGE_RULES['km-100'].target },
  'seria-7': { type: 'streak', days: BADGE_RULES['seria-7'].target },
  'lowca-legend': { type: 'rarity_find', rarity: 'legendarny', count: BADGE_RULES['lowca-legend'].target },
};
out.push('insert into public.badges (id, name, description, icon, color, icon_color, sort, rule) values');
out.push(
  BADGES.map(
    (b, i) =>
      `  (${q(b.id)}, ${q(b.name)}, ${q(b.description)}, ${q(b.icon)}, ${q(b.color)}, ${q(b.iconColor)}, ${i}, ${q(JSON.stringify(SQL_RULES[b.id] ?? { type: 'challenge' }))})`,
  ).join(',\n') + '\non conflict (id) do nothing;',
  '',
);

// Pula zadań (src/data/mock/game.ts → migracja 20261013110000_progression.sql): dzienne i tygodniowe, rodzaj w snake_case,
// parametry (gatunek, miesiące sezonu, minuty, godzina). `sort` = kolejność puli – od niej zależy losowanie quests_for(),
// identyczne z aplikacją (src/utils/quests.ts). Szablony spoza puli – nieaktywne.
const questParams = (d: (typeof QUEST_POOL)[number]) =>
  JSON.stringify({
    ...(d.speciesId && { speciesId: d.speciesId }),
    ...(d.months?.length && { months: d.months }),
    ...(d.minutes != null && { minutes: d.minutes }),
    ...(d.beforeHour != null && { beforeHour: d.beforeHour }),
  });
out.push(
  'insert into public.quest_templates (id, kind, title, icon, icon_filled, icon_bg, icon_color, xp, target, sort, period, difficulty, params, active) values',
);
out.push(
  QUEST_POOL.map(
    (d, i) =>
      `  (${q(d.id)}, ${q(questKindToSql(d.kind))}, ${q(d.title)}, ${q(d.icon)}, ${!!d.iconFilled}, ${q(d.iconBg)}, ${q(d.iconColor)}, ${d.xp}, ${d.target}, ${i}, ${q(questPeriod(d))}, ${d.difficulty ?? 1}, ${q(questParams(d))}, true)`,
  ).join(',\n') +
    '\non conflict (id) do update set kind = excluded.kind, title = excluded.title, icon = excluded.icon, icon_filled = excluded.icon_filled,' +
    '\n  icon_bg = excluded.icon_bg, icon_color = excluded.icon_color, xp = excluded.xp, target = excluded.target, sort = excluded.sort,' +
    '\n  period = excluded.period, difficulty = excluded.difficulty, params = excluded.params, active = true;',
  `update public.quest_templates set active = false where active and id <> all (array[${QUEST_POOL.map((d) => q(d.id)).join(', ')}]);`,
  '',
);

// Stałe wyzwania gmin gry z makiety (buildGminaStats: gatunek, tytuł, opis, XP, odznaka – jak w aplikacji), bez końca
// (ends_at null). Pozostałe gminy dostają wyzwanie tygodniowe na serwerze (ensure_weekly_challenge). Odznaka spoza
// słownika → null. Gmina, która ma już stałe wyzwanie, jest pomijana (seed idempotentny).
// Opis z makiety („Tylko N osoby znalazły go tu…”) z poprawną odmianą liczebnika i rodzaju gatunku.
const osoby = (n: number) =>
  n === 1 ? 'osoba znalazła' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'osoby znalazły' : 'osób znalazło';
const challengeText = (text: string, speciesId: string) => {
  const name = SPECIES.find((s) => s.id === speciesId)?.name ?? '';
  const pronoun = /a$/.test(name.split(' ')[0]) ? 'ją' : 'go';
  return text.replace(/^Tylko (\d+) osoby znalazły go tu/, (_, n: string) => `Tylko ${n} ${osoby(Number(n))} ${pronoun} tu`);
};
const challenges = GMINY.flatMap((g) => {
  const ch = buildGminaStats(g, 0).challenge;
  return ch ? [{ gminaId: g.id, ...ch, description: challengeText(ch.description, ch.speciesId) }] : [];
});
out.push(
  'insert into public.gmina_challenges (gmina_id, species_id, title, description, xp, badge_id)',
  'select v.gmina_id, v.species_id, v.title, v.description, v.xp, (select b.id from public.badges b where b.id = v.badge_id)',
  '  from (values',
  challenges
    .map((c) => `    (${q(c.gminaId)}, ${q(c.speciesId)}, ${q(c.title)}, ${q(c.description)}, ${c.xp}, ${q(c.badgeId)})`)
    .join(',\n'),
  '  ) v (gmina_id, species_id, title, description, xp, badge_id)',
  ' where not exists (select 1 from public.gmina_challenges c where c.gmina_id = v.gmina_id and c.ends_at is null);',
  '',
);

// Osiągnięcia (src/utils/achievements.ts → tabele z migracji 20261006100000_achievements.sql)
const FIELD = { bestCapCm: 'best_cap_cm', bestWeightG: 'best_weight_g' } as const;
function sqlMetric(m: AchievementMetric): { metric: string; params: object } {
  switch (m.kind) {
    case 'species':
      return { metric: 'species', params: { ...(m.rarity && { rarity: m.rarity }), ...(m.edibility && { edibility: m.edibility }) } };
    case 'set':
      return { metric: 'set', params: {} };
    case 'specimens':
      return { metric: 'specimens', params: {} };
    case 'maxOfSpecies':
      return { metric: 'max_of_species', params: {} };
    case 'speciesWithCount':
      return { metric: 'species_with_count', params: { min: m.min } };
    case 'lookalikePairs':
      return { metric: 'lookalike_pairs', params: {} };
    case 'xxlFinds':
      return { metric: 'xxl_finds', params: {} };
    case 'record':
      return { metric: 'record', params: { species: m.speciesId, field: FIELD[m.field] } };
    case 'counter':
      // Licznik gracza: wartość enumu = klucz `player_metrics()` (snake_case).
      return { metric: counterSqlKey(m.counter), params: {} };
    case 'seasons':
      return { metric: 'seasons', params: {} };
  }
}
out.push('insert into public.achievements (id, category, name, icon, metric, params, secret, sort) values');
out.push(
  ACHIEVEMENTS.map((a, i) => {
    const { metric, params } = sqlMetric(a.metric);
    return `  (${q(a.id)}, ${q(a.category)}, ${q(a.name)}, ${q(a.icon)}, ${q(metric)}, ${q(JSON.stringify(params))}, ${!!a.secret}, ${i})`;
  }).join(',\n') +
    '\non conflict (id) do update set category = excluded.category, name = excluded.name, icon = excluded.icon,' +
    '\n  metric = excluded.metric, params = excluded.params, secret = excluded.secret, sort = excluded.sort;',
  '',
);
const tiers = ACHIEVEMENTS.flatMap((a) =>
  a.tiers.map((t, i) => `  (${q(a.id)}, ${i + 1}, ${t.target}, ${t.xp}, ${q(tierKind(a.tiers.length, i + 1))}, ${q(a.goal(t.target))})`),
);
out.push('insert into public.achievement_tiers (achievement_id, tier, target, xp, medal, goal) values');
out.push(
  tiers.join(',\n') +
    '\non conflict (achievement_id, tier) do update set target = excluded.target, xp = excluded.xp, medal = excluded.medal, goal = excluded.goal;',
  // Stopnie ponad zdefiniowane w aplikacji (słownik zmniejszył się) – usuwane; osiągnięcia spoza listy – nieaktywne.
  'delete from public.achievement_tiers t using (values',
  ACHIEVEMENTS.map((a) => `  (${q(a.id)}, ${a.tiers.length})`).join(',\n'),
  ') v (id, n) where t.achievement_id = v.id and t.tier > v.n;',
  `update public.achievements set active = (id = any (array[${ACHIEVEMENTS.map((a) => q(a.id)).join(', ')}]));`,
  '',
);
// Zestawy: skład z aplikacji (rodziny rosną razem z katalogiem) – wpisy spoza zestawu usuwane.
const members = ACHIEVEMENTS.flatMap((a) => (a.metric.kind === 'set' ? a.metric.ids.map((id) => `  (${q(a.id)}, ${q(id)})`) : []));
out.push('insert into public.achievement_set_species (achievement_id, species_id) values');
out.push(members.join(',\n') + '\non conflict do nothing;');
out.push(
  'delete from public.achievement_set_species m where not exists (select 1 from (values',
  members.join(',\n'),
  ') v (achievement_id, species_id) where v.achievement_id = m.achievement_id and v.species_id = m.species_id);',
  '',
);
out.push(
  '-- Gracze z istniejącym atlasem: już osiągnięte stopnie bez wypłaty XP (przy pustej bazie nic nie robi).',
  'select public.seed_achievements(id) from public.profiles;',
  '',
);

const file = path.resolve(__dirname, '..', 'supabase', 'seed.sql');
writeFileSync(file, out.join('\n'), 'utf8');
console.log(
  `seed.sql${CLOUD ? ' (chmura, dev_tools = false)' : ' (lokalny, dev_tools = true)'}: ${forests.length} kompleksów, ${GMINY.length} gmin gry + ${geoIndex.gminy.length} z PRG, ${SPECIES.length} gatunków, ${lookRows.length} sobowtórów (${looks.size} gatunków), ${BADGES.length} odznak, ${QUEST_POOL.length} zadań (${QUEST_POOL.filter((x) => questPeriod(x) === 'weekly').length} tygodniowych), ${challenges.length} wyzwań gmin, ${ACHIEVEMENTS.length} osiągnięć (${tiers.length} stopni)`,
);
