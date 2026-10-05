/**
 * Osiągnięcia – liczone z atlasu gatunków (+ licznik okazów XXL). Czyste funkcje:
 * postęp zawsze wynika z bieżącego stanu, a store pamięta tylko, które stopnie już nagrodzono (XP).
 *
 * Osiągnięcie ma 1–4 stopnie (brąz → srebro → złoto → platyna); „x / Y” w profilu liczy stopnie.
 */
import type { IconName } from '@/components/Icon';
import type { AchievementUnlock, AtlasEntry, Rarity, Species } from '@/types';
import { fmtWeight, plural } from './format';

export type AchievementCategory = 'kolekcja' | 'zestawy' | 'bezpieczenstwo' | 'okazy' | 'sekretne';

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; title: string; icon: IconName }[] = [
  { id: 'kolekcja', title: 'Kolekcja', icon: 'menu_book' },
  { id: 'zestawy', title: 'Zestawy gatunków', icon: 'collections_bookmark' },
  { id: 'bezpieczenstwo', title: 'Bezpieczeństwo', icon: 'health_and_safety' },
  { id: 'okazy', title: 'Okazy', icon: 'shopping_basket' },
  { id: 'sekretne', title: 'Sekretne', icon: 'question_mark' },
];

export type AchievementMetric =
  /** Gatunki w atlasie (opcjonalnie tylko o danej rzadkości / jadalne / trujące / śmiertelne). */
  | { kind: 'species'; rarity?: Rarity; edibility?: 'jadalne' | 'trujace' | 'smiertelne' }
  /** Ile gatunków z zestawu jest w atlasie. */
  | { kind: 'set'; ids: string[] }
  /** Suma okazów w atlasie (z fotografiami trujących). */
  | { kind: 'specimens' }
  /** Najwięcej okazów jednego gatunku. */
  | { kind: 'maxOfSpecies' }
  /** Gatunki znalezione co najmniej `min` razy. */
  | { kind: 'speciesWithCount'; min: number }
  /** Pary gatunek + jego sobowtór (z katalogu) – oba w atlasie. */
  | { kind: 'lookalikePairs' }
  | { kind: 'xxlFinds' }
  /** Rekord osobisty dla gatunku. */
  | { kind: 'record'; speciesId: string; field: 'bestCapCm' | 'bestWeightG' };

export interface AchievementTier {
  target: number;
  xp: number;
}

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  name: string;
  icon: IconName;
  metric: AchievementMetric;
  tiers: AchievementTier[];
  /** Cel stopnia, np. „Odkryj 25 gatunków”. */
  goal: (target: number) => string;
  /** Sposób wyświetlania wartości („23 / 25”, „520 g / 1 kg”). */
  format?: (value: number) => string;
  /** Do zdobycia ukryte jako „???”. */
  secret?: boolean;
}

export interface AchievementInput {
  atlas: Record<string, AtlasEntry>;
  species: Species[];
  counters: { xxlFinds: number };
}

export interface AchievementState {
  def: AchievementDef;
  value: number;
  /** Liczba zdobytych stopni (0 = zablokowane). */
  tier: number;
  /** Następny stopień albo null, gdy ukończone. */
  next: AchievementTier | null;
  /** Postęp do następnego stopnia 0..1 (1 = ukończone). */
  progress: number;
  done: boolean;
}

const n = (k: number, one: string, few: string, many: string) => `${k} ${plural(k, one, few, many)}`;
const species = (k: number) => n(k, 'gatunek', 'gatunki', 'gatunków');

/* ───────────────────────── Zestawy gatunków ───────────────────────── */

export const SETS = {
  wielkaTrojka: ['borowik-szlachetny', 'czubajka-kania', 'pieprznik-jadalny'],
  rurkowe: [
    'borowik-szlachetny',
    'podgrzybek-brunatny',
    'borowik-ceglastopory',
    'borowik-krolewski',
    'borowik-szatanski',
    'goryczak-zolciowy',
    'kozlarz-babka',
    'kozlarz-czerwony',
    'kozlarz-pomaranczowozolty',
    'maslak-zwyczajny',
    'maslak-sitarz',
  ],
  kozlarze: ['kozlarz-babka', 'kozlarz-czerwony', 'kozlarz-pomaranczowozolty'],
  borowiki: ['borowik-szlachetny', 'borowik-ceglastopory', 'borowik-krolewski', 'borowik-szatanski'],
  kurkiRydze: ['pieprznik-jadalny', 'lejkowiec-dety', 'mleczaj-rydz', 'mleczaj-smaczny', 'golabek-zielonawy'],
  naDrewnie: ['opienka-miodowa', 'siedzun-sosnowy', 'zagwica-listkowata', 'szmaciak-galezisty', 'soplowka-jezowata'],
  wiosna: ['smardz-jadalny', 'piestrzenica-kasztanowata'],
  muchomory: ['muchomor-czerwony', 'muchomor-plamisty', 'muchomor-zielonawy'],
} as const;

/* ───────────────────────── Definicje ───────────────────────── */

export const ACHIEVEMENTS: AchievementDef[] = [
  // Kolekcja
  {
    id: 'kolekcjoner',
    category: 'kolekcja',
    name: 'Kolekcjoner',
    icon: 'menu_book',
    metric: { kind: 'species' },
    tiers: [
      { target: 10, xp: 50 },
      { target: 25, xp: 100 },
      { target: 50, xp: 250 },
      { target: 100, xp: 500 },
    ],
    goal: (t) => `Odkryj ${species(t)} w atlasie`,
  },
  {
    id: 'smakosz',
    category: 'kolekcja',
    name: 'Smakosz',
    icon: 'restaurant',
    metric: { kind: 'species', edibility: 'jadalne' },
    tiers: [
      { target: 5, xp: 50 },
      { target: 15, xp: 100 },
      { target: 30, xp: 250 },
    ],
    goal: (t) => `Odkryj ${n(t, 'gatunek jadalny', 'gatunki jadalne', 'gatunków jadalnych')}`,
  },
  {
    id: 'lowca-rzadkosci',
    category: 'kolekcja',
    name: 'Łowca rzadkości',
    icon: 'diamond',
    metric: { kind: 'species', rarity: 'rzadki' },
    tiers: [
      { target: 3, xp: 75 },
      { target: 6, xp: 150 },
      { target: 10, xp: 300 },
    ],
    goal: (t) => `Odkryj ${n(t, 'gatunek rzadki', 'gatunki rzadkie', 'gatunków rzadkich')}`,
  },
  {
    id: 'epicka-kolekcja',
    category: 'kolekcja',
    name: 'Epicka kolekcja',
    icon: 'stars',
    metric: { kind: 'species', rarity: 'epicki' },
    tiers: [
      { target: 1, xp: 100 },
      { target: 3, xp: 250 },
      { target: 5, xp: 500 },
    ],
    goal: (t) => `Odkryj ${n(t, 'gatunek epicki', 'gatunki epickie', 'gatunków epickich')}`,
  },
  {
    id: 'legenda-lasu',
    category: 'kolekcja',
    name: 'Legenda lasu',
    icon: 'award_star',
    metric: { kind: 'species', rarity: 'legendarny' },
    tiers: [
      { target: 1, xp: 300 },
      { target: 3, xp: 1000 },
    ],
    goal: (t) => (t === 1 ? 'Odkryj gatunek legendarny' : `Odkryj ${n(t, 'legendę', 'legendy', 'legend')} lasu`),
  },

  // Zestawy
  set('wielka-trojka', 'Wielka trójka', 'workspace_premium', SETS.wielkaTrojka, 150, 'Borowik, kania i kurka w atlasie'),
  set('borowiki-i-spolka', 'Borowiki i spółka', 'forest', SETS.rurkowe, 400, 'Wszystkie grzyby rurkowe z katalogu'),
  set('pod-brzoza', 'Pod brzozą i osiką', 'landscape', SETS.kozlarze, 150, 'Trzy koźlarze: babka, czerwony i pomarańczowożółty'),
  set('krolewska-rodzina', 'Królewska rodzina', 'trophy', SETS.borowiki, 300, 'Cztery borowiki – od szlachetnego po szatańskiego'),
  set('kurki-i-rydze', 'Kurki, rydze i gołąbki', 'local_florist', SETS.kurkiRydze, 200, 'Pięć gatunków blaszkowych na patelnię'),
  set('lesne-dziwy', 'Leśne dziwy', 'filter_vintage', SETS.naDrewnie, 400, 'Grzyby z pni i korzeni – od opieńki po soplówkę'),
  set('wiosenny-zwiadowca', 'Wiosenny zwiadowca', 'spa', SETS.wiosna, 200, 'Smardz i piestrzenica – wiosenna para'),
  set('muchomory', 'Muchomory bez tajemnic', 'visibility', SETS.muchomory, 150, 'Sfotografuj trzy muchomory'),

  // Bezpieczeństwo
  {
    id: 'znam-wroga',
    category: 'bezpieczenstwo',
    name: 'Znam wroga',
    icon: 'shield',
    metric: { kind: 'species', edibility: 'trujace' },
    tiers: [
      { target: 1, xp: 50 },
      { target: 3, xp: 100 },
      { target: 6, xp: 250 },
    ],
    goal: (t) => `Sfotografuj ${n(t, 'gatunek trujący', 'gatunki trujące', 'gatunków trujących')}`,
  },
  {
    id: 'spotkanie-ze-smiercia',
    category: 'bezpieczenstwo',
    name: 'Spotkanie ze śmiercią',
    icon: 'skull',
    metric: { kind: 'species', edibility: 'smiertelne' },
    tiers: [
      { target: 1, xp: 100 },
      { target: 4, xp: 400 },
    ],
    goal: (t) =>
      t === 1 ? 'Sfotografuj gatunek śmiertelnie trujący' : `Sfotografuj ${n(t, 'gatunek', 'gatunki', 'gatunków')} śmiertelnie trujące`,
  },
  {
    id: 'mistrz-sobowtorow',
    category: 'bezpieczenstwo',
    name: 'Mistrz sobowtórów',
    icon: 'health_and_safety',
    metric: { kind: 'lookalikePairs' },
    tiers: [
      { target: 2, xp: 100 },
      { target: 5, xp: 300 },
    ],
    goal: (t) => `Odkryj ${n(t, 'parę', 'pary', 'par')}: gatunek i jego sobowtór`,
  },

  // Okazy
  {
    id: 'pelny-koszyk',
    category: 'okazy',
    name: 'Pełny koszyk',
    icon: 'shopping_basket',
    metric: { kind: 'specimens' },
    tiers: [
      { target: 100, xp: 50 },
      { target: 250, xp: 100 },
      { target: 500, xp: 250 },
      { target: 1000, xp: 500 },
    ],
    goal: (t) => `Zbierz ${n(t, 'okaz', 'okazy', 'okazów')} do atlasu`,
  },
  {
    id: 'specjalista',
    category: 'okazy',
    name: 'Specjalista',
    icon: 'school',
    metric: { kind: 'maxOfSpecies' },
    tiers: [
      { target: 10, xp: 50 },
      { target: 25, xp: 100 },
      { target: 50, xp: 200 },
      { target: 100, xp: 400 },
    ],
    goal: (t) => `Znajdź ${n(t, 'okaz', 'okazy', 'okazów')} jednego gatunku`,
  },
  {
    id: 'znawca',
    category: 'okazy',
    name: 'Znawca',
    icon: 'auto_stories',
    metric: { kind: 'speciesWithCount', min: 5 },
    tiers: [
      { target: 5, xp: 75 },
      { target: 10, xp: 150 },
      { target: 20, xp: 300 },
    ],
    goal: (t) => `Znajdź ${species(t)} co najmniej po 5 razy`,
  },
  {
    id: 'okazy-xxl',
    category: 'okazy',
    name: 'Okazy XXL',
    icon: 'egg',
    metric: { kind: 'xxlFinds' },
    tiers: [
      { target: 1, xp: 50 },
      { target: 5, xp: 150 },
      { target: 15, xp: 400 },
    ],
    goal: (t) => (t === 1 ? 'Znajdź okaz XXL' : `Znajdź ${n(t, 'okaz', 'okazy', 'okazów')} XXL`),
  },
  {
    id: 'parasol',
    category: 'okazy',
    name: 'Parasol',
    icon: 'straighten',
    metric: { kind: 'record', speciesId: 'czubajka-kania', field: 'bestCapCm' },
    tiers: [{ target: 30, xp: 200 }],
    goal: (t) => `Kania z kapeluszem co najmniej ${t} cm`,
    format: (v) => `${v} cm`,
  },
  {
    id: 'kilogramowy-borowik',
    category: 'okazy',
    name: 'Kilogramowy borowik',
    icon: 'scale',
    metric: { kind: 'record', speciesId: 'borowik-szlachetny', field: 'bestWeightG' },
    tiers: [{ target: 1000, xp: 300 }],
    goal: () => 'Borowik szlachetny ważący co najmniej 1 kg',
    format: (v) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', ',')} kg` : fmtWeight(v)),
  },

  // Sekretne
  {
    ...set('diabelski-borowik', 'Diabelski borowik', 'local_fire_department', ['borowik-szatanski'], 250, 'Sfotografuj borowika szatańskiego'),
    category: 'sekretne',
    secret: true,
  },
  {
    ...set('biala-broda', 'Biała broda', 'water_drop', ['soplowka-jezowata'], 400, 'Znajdź soplówkę jeżowatą'),
    category: 'sekretne',
    secret: true,
  },
];

function set(id: string, name: string, icon: IconName, ids: readonly string[], xp: number, goal: string): AchievementDef {
  return { id, category: 'zestawy', name, icon, metric: { kind: 'set', ids: [...ids] }, tiers: [{ target: ids.length, xp }], goal: () => goal };
}

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/* ───────────────────────── Obliczenia ───────────────────────── */

const POISON = new Set(['trujacy', 'smiertelny']);

/** „Pieprznik jadalny (kurka)” → „pieprznik jadalny” – klucz do łączenia sobowtórów z katalogiem. */
const nameKey = (name: string) => name.toLowerCase().replace(/ \(.*\)$/, '');

export function metricValue(m: AchievementMetric, input: AchievementInput): number {
  const { atlas, species: catalogList } = input;
  switch (m.kind) {
    case 'species':
      return catalogList.filter((s) => {
        if (!atlas[s.id]) return false;
        if (m.rarity && s.rarity !== m.rarity) return false;
        if (m.edibility === 'jadalne') return s.edibility === 'jadalny';
        if (m.edibility === 'trujace') return POISON.has(s.edibility);
        if (m.edibility === 'smiertelne') return s.edibility === 'smiertelny';
        return true;
      }).length;
    case 'set':
      return m.ids.filter((id) => !!atlas[id]).length;
    case 'specimens':
      return Object.values(atlas).reduce((a, e) => a + e.count, 0);
    case 'maxOfSpecies':
      return Object.values(atlas).reduce((a, e) => Math.max(a, e.count), 0);
    case 'speciesWithCount':
      return Object.values(atlas).filter((e) => e.count >= m.min).length;
    case 'lookalikePairs': {
      const byName = new Map(catalogList.map((s) => [nameKey(s.name), s.id]));
      const pairs = new Set<string>();
      for (const s of catalogList) {
        const other = s.lookalike ? byName.get(nameKey(s.lookalike.name)) : undefined;
        if (other && other !== s.id && atlas[s.id] && atlas[other]) pairs.add([s.id, other].sort().join('|'));
      }
      return pairs.size;
    }
    case 'xxlFinds':
      return input.counters.xxlFinds;
    case 'record':
      return atlas[m.speciesId]?.[m.field] ?? 0;
  }
}

export function evaluateAchievement(def: AchievementDef, input: AchievementInput): AchievementState {
  const value = metricValue(def.metric, input);
  const tier = def.tiers.filter((t) => value >= t.target).length;
  const next = def.tiers[tier] ?? null;
  const prevTarget = tier > 0 ? def.tiers[tier - 1].target : 0;
  const progress = next ? Math.max(0, Math.min(1, (value - prevTarget) / (next.target - prevTarget))) : 1;
  return { def, value, tier, next, progress, done: !next };
}

export function evaluateAchievements(input: AchievementInput): AchievementState[] {
  return ACHIEVEMENTS.map((d) => evaluateAchievement(d, input));
}

/** Stopnie osiągnięte teraz, a jeszcze nienagrodzone (`awarded` – liczba nagrodzonych stopni per id). */
export function newlyReached(awarded: Record<string, number>, states: AchievementState[]): AchievementUnlock[] {
  const out: AchievementUnlock[] = [];
  for (const s of states) {
    for (let t = (awarded[s.def.id] ?? 0) + 1; t <= s.tier; t++) out.push({ id: s.def.id, tier: t, xp: s.def.tiers[t - 1].xp });
  }
  return out;
}

/** Stan startowy bez nagród – wszystko, co już osiągnięte, liczy się jako nagrodzone. */
export function seedAwarded(input: AchievementInput): Record<string, number> {
  return Object.fromEntries(evaluateAchievements(input).filter((s) => s.tier > 0).map((s) => [s.def.id, s.tier]));
}

export function achievementSummary(states: AchievementState[]) {
  let earned = 0;
  let total = 0;
  let xp = 0;
  for (const s of states) {
    earned += s.tier;
    total += s.def.tiers.length;
    for (let t = 0; t < s.tier; t++) xp += s.def.tiers[t].xp;
  }
  return { earned, total, xp };
}

/** Do podglądu w profilu: najbliżej następnego stopnia (bez ukończonych i bez nieodkrytych sekretów). */
export function closestToNext(states: AchievementState[], count = 3): AchievementState[] {
  return states
    .filter((s) => !s.done && !(s.def.secret && s.tier === 0))
    .sort((a, b) => b.progress - a.progress || b.tier - a.tier)
    .slice(0, count);
}

/* ───────────────────────── Stopnie ───────────────────────── */

export type TierKind = 'braz' | 'srebro' | 'zloto' | 'platyna';

const TIER_SEQUENCES: Record<number, TierKind[]> = {
  1: ['zloto'],
  2: ['srebro', 'zloto'],
  3: ['braz', 'srebro', 'zloto'],
  4: ['braz', 'srebro', 'zloto', 'platyna'],
};

export const TIER_LABEL: Record<TierKind, string> = { braz: 'Brąz', srebro: 'Srebro', zloto: 'Złoto', platyna: 'Platyna' };

/** Rodzaj medalu dla stopnia `tier` (1-based) osiągnięcia z `count` stopniami. */
export function tierKind(count: number, tier: number): TierKind {
  const seq = TIER_SEQUENCES[count] ?? TIER_SEQUENCES[4];
  return seq[Math.max(0, Math.min(seq.length - 1, tier - 1))];
}

/** „23 / 25”, „520 g / 1 kg”. */
export function formatProgress(s: AchievementState): string {
  const target = s.next?.target ?? s.def.tiers[s.def.tiers.length - 1].target;
  const f = s.def.format ?? ((v: number) => String(v));
  return `${f(Math.min(s.value, target))} / ${f(target)}`;
}
