/**
 * Generuje supabase/seed.sql ze słowników mocków (te same ID co w aplikacji).
 * Uruchom: npm run db:seed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BADGES, DAILY_QUESTS } from '../src/data/mock/game';
import { GMINY } from '../src/data/mock/gminy';
import type { GminaIndexFile } from '../src/geo/gminaIndex';
import { SPECIES } from '../src/data/mock/species';
import { BADGE_RULES } from '../src/utils/badges';

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

const out: string[] = [
  '-- WYGENEROWANE przez scripts/gen-seed.ts z src/data/mock – nie edytuj ręcznie.',
  '-- Kody TERYT z assets/geo/gminy-index.geo (npm run geo:build); granice (boundary) uzupełnia import PRG (GUGiK).',
  '',
];

// Kody TERYT z indeksu PRG (npm run geo:build) – te same slugi co w aplikacji.
const geoIndex = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', 'assets', 'geo', 'gminy-index.geo'), 'utf8'),
) as GminaIndexFile;
const terytById = new Map(geoIndex.gminy.map((row) => [row[1], row[0]]));

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

// Gatunki
out.push(
  'insert into public.species (id, atlas_no, name, latin, short_name, rarity, edibility, habitat, clustered, typical_cap_cm, typical_height_cm, typical_weight_g) values',
);
out.push(
  SPECIES.map(
    (s, i) =>
      `  (${q(s.id)}, ${i + 1}, ${q(s.name)}, ${q(s.latin)}, ${q(s.shortName)}, ${q(s.rarity)}, ${q(s.edibility)}, ${q(s.habitat)}, ${!!s.clustered}, ${s.typical.capCm}, ${s.typical.heightCm}, ${s.typical.weightG})`,
  ).join(',\n') + '\non conflict (id) do nothing;',
  '',
);

// Sobowtóry
const byName = new Map(SPECIES.map((s) => [s.name.toLowerCase().replace(/ \(.*\)$/, ''), s.id]));
const looks = SPECIES.filter((s) => s.lookalike);
out.push('insert into public.species_lookalikes (species_id, lookalike_name, lookalike_id, lookalike_edibility, tip) values');
out.push(
  looks
    .map((s) => {
      const l = s.lookalike!;
      return `  (${q(s.id)}, ${q(l.name)}, ${q(byName.get(l.name.toLowerCase()) ?? null)}, ${q(l.edibility)}, ${q(l.tip)})`;
    })
    .join(',\n') + '\non conflict do nothing;',
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

// Zadania dnia
out.push('insert into public.quest_templates (id, kind, title, icon, icon_filled, icon_bg, icon_color, xp, target, sort) values');
out.push(
  DAILY_QUESTS.map(
    (d, i) =>
      `  (${q(d.id)}, ${q(d.kind)}, ${q(d.title)}, ${q(d.icon)}, ${!!d.iconFilled}, ${q(d.iconBg)}, ${q(d.iconColor)}, ${d.xp}, ${d.target}, ${i})`,
  ).join(',\n') + '\non conflict (id) do nothing;',
  '',
);

// Wyzwanie z makiety (Supraśl → szmaciak)
out.push(
  'insert into public.gmina_challenges (gmina_id, species_id, title, description, xp, badge_id)',
  "select 'suprasl', 'szmaciak-galezisty', 'Znajdź szmaciaka gałęzistego', 'Tylko 4 osoby znalazły go tu w tym sezonie.', 500, 'lowca-legend'",
  "where not exists (select 1 from public.gmina_challenges where gmina_id = 'suprasl' and species_id = 'szmaciak-galezisty');",
  '',
);

const file = path.resolve(__dirname, '..', 'supabase', 'seed.sql');
writeFileSync(file, out.join('\n'), 'utf8');
console.log(`seed.sql: ${forests.length} kompleksów, ${GMINY.length} gmin, ${SPECIES.length} gatunków, ${looks.length} sobowtórów, ${BADGES.length} odznak, ${DAILY_QUESTS.length} zadań`);
