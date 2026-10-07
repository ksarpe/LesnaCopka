/**
 * Osiągnięcia – liczone z atlasu gatunków i liczników gracza (src/utils/counters.ts). Czyste funkcje:
 * postęp zawsze wynika z bieżącego stanu, a store pamięta tylko, które stopnie już nagrodzono (XP).
 *
 * Osiągnięcie ma 1–5 stopni (brąz → srebro → złoto → platyna → diament); „x / Y” w profilu liczy stopnie.
 * Ta lista to jedno źródło prawdy: seed bazy (scripts/gen-seed.ts) tworzy z niej słownik `achievements` /
 * `achievement_tiers`, a serwer liczy te same metryki (`achievement_value` / `player_metrics` w SQL).
 *
 * Bilans XP (stopnie wg medalu, `XP_LADDERS`): brąz/srebro to pierwsze tygodnie gry, złoto – sezon,
 * platyna i diament – 1–3 sezony regularnego grzybiarza (≈ 50 wypraw, 300 km i 750 znalezisk na sezon).
 * Diament daje 1000–2500 XP (jak kilka dobrych wypraw), więc osiągnięcia to ok. ¼ XP, a nie główne źródło.
 */
import type { IconName } from '@/components/Icon';
import { SPECIES } from '@/data/mock/species';
import type { AchievementUnlock, AtlasEntry, Rarity, Species } from '@/types';
import { counterValue, seasonsCovered, type CounterKey, type PlayerCounters } from './counters';
import { fmtWeight, plural } from './format';

/* ───────────────────────── Stopnie ───────────────────────── */

export type TierKind = 'braz' | 'srebro' | 'zloto' | 'platyna' | 'diament';

const TIER_SEQUENCES: Record<number, TierKind[]> = {
  1: ['zloto'],
  2: ['srebro', 'zloto'],
  3: ['braz', 'srebro', 'zloto'],
  4: ['braz', 'srebro', 'zloto', 'platyna'],
  5: ['braz', 'srebro', 'zloto', 'platyna', 'diament'],
};

export const MEDAL_ORDER: TierKind[] = ['braz', 'srebro', 'zloto', 'platyna', 'diament'];

export const TIER_LABEL: Record<TierKind, string> = {
  braz: 'Brąz',
  srebro: 'Srebro',
  zloto: 'Złoto',
  platyna: 'Platyna',
  diament: 'Diament',
};

/** Rodzaj medalu dla stopnia `tier` (1-based) osiągnięcia z `count` stopniami. */
export function tierKind(count: number, tier: number): TierKind {
  const seq = TIER_SEQUENCES[count] ?? TIER_SEQUENCES[5];
  return seq[Math.max(0, Math.min(seq.length - 1, tier - 1))];
}

/**
 * Nagrody XP wg medalu (brąz, srebro, złoto, platyna, diament): S – lżejsze (społeczność, liczby),
 * M – standard, L – trudne / długie (seria, odkrywca, epickie okazy).
 */
export const XP_LADDERS = {
  S: [40, 100, 200, 500, 1000],
  M: [50, 125, 300, 750, 1500],
  L: [75, 200, 500, 1200, 2500],
} as const;
type Ladder = keyof typeof XP_LADDERS;

/** Stopnie z progów; XP z drabiny wg medalu (3 stopnie = brąz, srebro, złoto; 2 = srebro, złoto…). */
function ladder(targets: number[], l: Ladder): AchievementTier[] {
  return targets.map((target, i) => ({ target, xp: XP_LADDERS[l][MEDAL_ORDER.indexOf(tierKind(targets.length, i + 1))] }));
}

/* ───────────────────────── Kategorie i metryki ───────────────────────── */

export type AchievementCategory =
  | 'kolekcja'
  | 'zestawy'
  | 'bezpieczenstwo'
  | 'okazy'
  | 'wyprawy'
  | 'odkrywca'
  | 'sezony'
  | 'seria'
  | 'spolecznosc'
  | 'wyzwania'
  | 'sekretne';

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; title: string; icon: IconName }[] = [
  { id: 'kolekcja', title: 'Kolekcja', icon: 'menu_book' },
  { id: 'zestawy', title: 'Zestawy gatunków', icon: 'collections_bookmark' },
  { id: 'bezpieczenstwo', title: 'Bezpieczeństwo', icon: 'health_and_safety' },
  { id: 'okazy', title: 'Okazy', icon: 'shopping_basket' },
  { id: 'wyprawy', title: 'Wyprawy', icon: 'hiking' },
  { id: 'odkrywca', title: 'Odkrywca', icon: 'travel_explore' },
  { id: 'sezony', title: 'Pory roku', icon: 'calendar_month' },
  { id: 'seria', title: 'Seria', icon: 'local_fire_department' },
  { id: 'spolecznosc', title: 'Społeczność', icon: 'groups' },
  { id: 'wyzwania', title: 'Wyzwania', icon: 'flag' },
  { id: 'sekretne', title: 'Sekretne', icon: 'question_mark' },
];

export type AchievementMetric =
  /** Gatunki w atlasie (opcjonalnie tylko o danej rzadkości / jadalne / niejadalne / trujące / śmiertelne). */
  | { kind: 'species'; rarity?: Rarity; edibility?: 'jadalne' | 'niejadalne' | 'trujace' | 'smiertelne' }
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
  | { kind: 'record'; speciesId: string; field: 'bestCapCm' | 'bestWeightG' }
  /** Licznik gracza (src/utils/counters.ts); listy liczą się długością. W SQL: wartość enumu = klucz snake_case. */
  | { kind: 'counter'; counter: CounterKey }
  /** Pory roku ze znaleziskiem (z listy miesięcy). */
  | { kind: 'seasons' };

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
  /** Brakujące liczniki (stary zapis, testy) liczą się jako 0. */
  counters: Partial<PlayerCounters>;
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
const finds = (k: number) => n(k, 'grzyba', 'grzyby', 'grzybów');
const dec = (v: number) => String(Math.floor(v * 10) / 10).replace('.', ',');
const fmtMinutes = (m: number) => {
  const v = Math.floor(m);
  if (v < 60) return `${v} min`;
  return v % 60 ? `${Math.floor(v / 60)} h ${v % 60} min` : `${v / 60} h`;
};

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

/** Rodziny / grupy z katalogu (po rodzaju w id gatunku) – rosną same, gdy katalog się powiększa. */
const ids = (re: RegExp, filter: (s: Species) => boolean = () => true) =>
  SPECIES.filter((s) => re.test(s.id) && filter(s)).map((s) => s.id);
const RE_BOROWIKOWATE = /^(borowik|podgrzybek|kozlarz|goryczak|piaskowiec|krwiak|grzybowiec|zlotoborowik)-/;
const RE_RURKOWE = /^(borowik|podgrzybek|kozlarz|goryczak|piaskowiec|krwiak|grzybowiec|zlotoborowik|maslak)-/;

export const FAMILIES = {
  borowikowate: ids(RE_BOROWIKOWATE),
  golabkowate: ids(/^(golabek|mleczaj|chrzaszcz)-/),
  muchomory: ids(/^muchomor-/),
  maslaki: ids(/^maslak-/),
  gaski: ids(/^gaska-/),
  jadalneRurkowe: ids(RE_RURKOWE, (s) => s.edibility === 'jadalny'),
  trujace: SPECIES.filter((s) => s.edibility === 'trujacy' || s.edibility === 'smiertelny').map((s) => s.id),
};

/** Progi zestawu-rodziny: ¼, ½, ¾ i całość (bez powtórzeń). */
export function familyTargets(size: number): number[] {
  return [...new Set([Math.ceil(size / 4), Math.ceil(size / 2), Math.ceil((size * 3) / 4), size])].filter((t) => t > 0);
}

/* ───────────────────────── Definicje ───────────────────────── */

function set(id: string, name: string, icon: IconName, list: readonly string[], xp: number, goal: string): AchievementDef {
  return { id, category: 'zestawy', name, icon, metric: { kind: 'set', ids: [...list] }, tiers: [{ target: list.length, xp }], goal: () => goal };
}

/** Wielostopniowy zestaw-rodzina (od 4 gatunków w katalogu). */
function family(id: string, name: string, icon: IconName, list: readonly string[], many: string, gen: string): AchievementDef[] {
  if (list.length < 4) return [];
  const total = list.length;
  return [
    {
      id,
      category: 'zestawy',
      name,
      icon,
      metric: { kind: 'set', ids: [...list] },
      tiers: ladder(familyTargets(total), 'M'),
      goal: (t) => (t >= total ? `Wszystkie ${many} z katalogu (${total})` : `Odkryj ${t} z ${total} ${gen}`),
    },
  ];
}

function counter(
  id: string,
  category: AchievementCategory,
  name: string,
  icon: IconName,
  key: CounterKey,
  targets: number[],
  l: Ladder,
  goal: (t: number) => string,
  extra: Partial<Pick<AchievementDef, 'format' | 'secret'>> = {},
): AchievementDef {
  return { id, category, name, icon, metric: { kind: 'counter', counter: key }, tiers: ladder(targets, l), goal, ...extra };
}

/** Sekretne jednostopniowe (złoto) – XP wprost. */
function secret(id: string, name: string, icon: IconName, metric: AchievementMetric, target: number, xp: number, goal: string): AchievementDef {
  return { id, category: 'sekretne', name, icon, metric, tiers: [{ target, xp }], goal: () => goal, secret: true };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  /* ── Kolekcja ── */
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
      { target: 75, xp: 600 },
      { target: 100, xp: 1500 },
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
      { target: 45, xp: 600 },
      { target: 60, xp: 1200 },
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
      { target: 18, xp: 700 },
      { target: 25, xp: 1500 },
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
      { target: 8, xp: 1000 },
      { target: 12, xp: 2000 },
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
      { target: 2, xp: 600 },
      { target: 4, xp: 1000 },
      { target: 7, xp: 1500 },
      { target: 10, xp: 2500 },
    ],
    goal: (t) => (t === 1 ? 'Odkryj gatunek legendarny' : `Odkryj ${n(t, 'legendę', 'legendy', 'legend')} lasu`),
  },
  {
    id: 'nie-do-garnka',
    category: 'kolekcja',
    name: 'Nie do garnka',
    icon: 'science',
    metric: { kind: 'species', edibility: 'niejadalne' },
    tiers: ladder([1, 3, 6, 10, 15], 'S'),
    goal: (t) => `Odkryj ${n(t, 'gatunek niejadalny', 'gatunki niejadalne', 'gatunków niejadalnych')}`,
  },

  /* ── Zestawy ── */
  set('wielka-trojka', 'Wielka trójka', 'workspace_premium', SETS.wielkaTrojka, 150, 'Borowik, kania i kurka w atlasie'),
  set('borowiki-i-spolka', 'Borowiki i spółka', 'forest', SETS.rurkowe, 400, 'Jedenaście klasycznych grzybów rurkowych'),
  set('pod-brzoza', 'Pod brzozą i osiką', 'landscape', SETS.kozlarze, 150, 'Trzy koźlarze: babka, czerwony i pomarańczowożółty'),
  set('krolewska-rodzina', 'Królewska rodzina', 'trophy', SETS.borowiki, 300, 'Cztery borowiki – od szlachetnego po szatańskiego'),
  set('kurki-i-rydze', 'Kurki, rydze i gołąbki', 'local_florist', SETS.kurkiRydze, 200, 'Pięć gatunków blaszkowych na patelnię'),
  set('lesne-dziwy', 'Leśne dziwy', 'filter_vintage', SETS.naDrewnie, 400, 'Grzyby z pni i korzeni – od opieńki po soplówkę'),
  set('wiosenny-zwiadowca', 'Wiosenny zwiadowca', 'spa', SETS.wiosna, 200, 'Smardz i piestrzenica – wiosenna para'),
  set('muchomory', 'Muchomory bez tajemnic', 'visibility', SETS.muchomory, 150, 'Sfotografuj trzy muchomory'),
  ...family('borowikowate', 'Borowikowate', 'forest', FAMILIES.borowikowate, 'borowikowate', 'borowikowatych'),
  ...family('golabkowate', 'Gołąbkowate', 'local_florist', FAMILIES.golabkowate, 'gołąbkowate', 'gołąbkowatych'),
  ...family('rod-muchomorow', 'Ród muchomorów', 'visibility', FAMILIES.muchomory, 'muchomory', 'muchomorów'),
  ...family('maslaki', 'Maślaki', 'water_drop', FAMILIES.maslaki, 'maślaki', 'maślaków'),
  ...family('gaski', 'Gąski', 'grass', FAMILIES.gaski, 'gąski', 'gąsek'),
  ...(FAMILIES.jadalneRurkowe.length >= 4
    ? [
        set(
          'jadalne-rurkowe',
          'Rurkowe na patelnię',
          'restaurant',
          FAMILIES.jadalneRurkowe,
          1500,
          `Wszystkie jadalne grzyby rurkowe z katalogu (${FAMILIES.jadalneRurkowe.length})`,
        ),
      ]
    : []),

  /* ── Bezpieczeństwo ── */
  {
    id: 'znam-wroga',
    category: 'bezpieczenstwo',
    name: 'Znam wroga',
    icon: 'shield',
    metric: { kind: 'species', edibility: 'trujace' },
    tiers: [
      { target: 1, xp: 50 },
      { target: 3, xp: 100 },
      { target: 8, xp: 250 },
      { target: 15, xp: 600 },
      { target: 22, xp: 1200 },
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
      { target: 3, xp: 300 },
      { target: 5, xp: 600 },
      { target: 7, xp: 1200 },
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
      { target: 10, xp: 600 },
      { target: 20, xp: 1200 },
      { target: 35, xp: 2000 },
    ],
    goal: (t) => `Odkryj ${n(t, 'parę', 'pary', 'par')}: gatunek i jego sobowtór`,
  },
  counter('bezpieczne-zdjecia', 'bezpieczenstwo', 'Tylko zdjęcie', 'photo_camera', 'poisonPhotos', [5, 15, 40, 80, 150], 'M', (t) =>
    `Sfotografuj ${n(t, 'grzyba trującego', 'grzyby trujące', 'grzybów trujących')}`,
  ),
  ...(FAMILIES.trujace.length >= 2
    ? [
        {
          ...set(
            'atlas-trucizn',
            'Atlas trucizn',
            'dangerous',
            FAMILIES.trujace,
            2000,
            `Sfotografuj wszystkie trujące gatunki z katalogu (${FAMILIES.trujace.length})`,
          ),
          category: 'bezpieczenstwo' as const,
        },
      ]
    : []),

  /* ── Okazy ── */
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
      { target: 2000, xp: 1500 },
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
      { target: 200, xp: 1000 },
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
      { target: 35, xp: 700 },
      { target: 50, xp: 1500 },
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
      { target: 40, xp: 800 },
      { target: 80, xp: 1600 },
    ],
    goal: (t) => (t === 1 ? 'Znajdź okaz XXL' : `Znajdź ${n(t, 'okaz', 'okazy', 'okazów')} XXL`),
  },
  counter('rzadkie-okazy', 'okazy', 'Rzadkie okazy', 'diamond', 'rareFinds', [10, 40, 100, 250, 500], 'M', (t) =>
    `Znajdź ${n(t, 'okaz rzadki', 'okazy rzadkie', 'okazów rzadkich')} lub lepszych`,
  ),
  counter('epickie-okazy', 'okazy', 'Epickie okazy', 'stars', 'epicFinds', [1, 5, 15, 35, 70], 'L', (t) =>
    t === 1 ? 'Znajdź okaz epicki lub legendarny' : `Znajdź ${n(t, 'okaz epicki', 'okazy epickie', 'okazów epickich')} lub legendarnych`,
  ),
  counter('zlote-okazy', 'okazy', 'Złote okazy', 'award_star', 'legendaryFinds', [1, 3, 6, 12, 20], 'L', (t) =>
    t === 1 ? 'Znajdź okaz legendarny' : `Znajdź ${n(t, 'okaz legendarny', 'okazy legendarne', 'okazów legendarnych')}`,
  ),
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

  /* ── Wyprawy ── */
  counter('wedrowiec', 'wyprawy', 'Wędrowiec', 'hiking', 'trips', [5, 15, 40, 80, 150], 'M', (t) =>
    `Zakończ ${n(t, 'wyprawę', 'wyprawy', 'wypraw')}`,
  ),
  counter('lesne-kilometry', 'wyprawy', 'Leśne kilometry', 'route', 'totalKm', [25, 100, 250, 500, 1000], 'M', (t) => `Przejdź ${t} km na wyprawach`, {
    format: (v) => `${Math.floor(v)} km`,
  }),
  counter('dlugi-marsz', 'wyprawy', 'Długi marsz', 'directions_walk', 'maxTripKm', [5, 8, 12, 16, 25], 'M', (t) => `Przejdź ${t} km na jednej wyprawie`, {
    format: (v) => `${dec(v)} km`,
  }),
  counter('caly-dzien-w-lesie', 'wyprawy', 'Cały dzień w lesie', 'timer', 'maxTripMin', [60, 120, 180, 300, 480], 'M', (t) =>
    `Wyprawa trwająca co najmniej ${fmtMinutes(t)}`,
  {
    format: fmtMinutes,
  }),
  counter('skowronek', 'wyprawy', 'Skowronek', 'wb_twilight', 'earlyTrips', [1, 3, 10, 25, 50], 'L', (t) =>
    t === 1 ? 'Rozpocznij wyprawę przed 6:00' : `Rozpocznij ${n(t, 'wyprawę', 'wyprawy', 'wypraw')} przed 6:00`,
  ),
  counter('owocna-wyprawa', 'wyprawy', 'Owocna wyprawa', 'shopping_basket', 'maxTripFinds', [10, 20, 35, 50, 75], 'M', (t) =>
    `Odbierz ${n(t, 'znalezisko', 'znaleziska', 'znalezisk')} na jednej wyprawie`,
  ),

  /* ── Odkrywca ── */
  counter('odkrywca-gmin', 'odkrywca', 'Odkrywca gmin', 'pin_drop', 'gminy', [3, 8, 20, 40, 75], 'L', (t) => `Znajdź grzyby w ${t} gminach`),
  counter('krajoznawca', 'odkrywca', 'Krajoznawca', 'map', 'voivodeships', [2, 4, 8, 12, 16], 'L', (t) =>
    t >= 16 ? 'Znajdź grzyby we wszystkich 16 województwach' : `Znajdź grzyby w ${t} województwach`,
  ),
  counter('puszcze-i-bory', 'odkrywca', 'Puszcze i bory', 'park', 'forests', [1, 2, 3], 'L', (t) =>
    t === 1 ? 'Znajdź grzyby w kompleksie leśnym (np. Puszczy Knyszyńskiej)' : `Znajdź grzyby w ${t} kompleksach leśnych`,
  ),
  counter('w-gosciach', 'odkrywca', 'W gościach', 'explore', 'awayFinds', [10, 40, 100, 250, 500], 'M', (t) => `Znajdź ${finds(t)} poza gminą domową`),

  /* ── Pory roku ── */
  counter('grzybiarz-caloroczny', 'sezony', 'Grzybiarz całoroczny', 'calendar_month', 'months', [2, 4, 6, 9, 12], 'L', (t) =>
    t >= 12 ? 'Znajdź grzyby w każdym miesiącu roku' : `Znajdź grzyby w ${t} różnych miesiącach`,
  ),
  {
    id: 'cztery-pory-roku',
    category: 'sezony',
    name: 'Cztery pory roku',
    icon: 'eco',
    metric: { kind: 'seasons' },
    tiers: ladder([2, 3, 4], 'L'),
    goal: (t) => (t >= 4 ? 'Znajdź grzyby we wszystkich porach roku' : `Znajdź grzyby w ${t} porach roku`),
  },
  counter('wiosenne-grzyby', 'sezony', 'Wiosenne grzyby', 'spa', 'springFinds', [5, 20, 50, 100, 200], 'M', (t) => `Znajdź ${finds(t)} wiosną (marzec–maj)`),
  counter('letnie-grzybobranie', 'sezony', 'Letnie grzybobranie', 'wb_sunny', 'summerFinds', [10, 40, 100, 250, 500], 'M', (t) =>
    `Znajdź ${finds(t)} latem (czerwiec–sierpień)`,
  ),
  counter('zlota-jesien', 'sezony', 'Złota jesień', 'forest', 'autumnFinds', [25, 100, 300, 700, 1500], 'M', (t) =>
    `Znajdź ${finds(t)} jesienią (wrzesień–listopad)`,
  ),
  counter('zimowy-grzybiarz', 'sezony', 'Zimowy grzybiarz', 'ac_unit', 'winterFinds', [1, 5, 15, 30, 60], 'L', (t) =>
    t === 1 ? 'Znajdź grzyba zimą (grudzień–luty)' : `Znajdź ${finds(t)} zimą (grudzień–luty)`,
  ),

  /* ── Seria ── */
  counter('seria-dni', 'seria', 'Seria', 'local_fire_department', 'maxStreak', [3, 7, 30, 100, 365], 'L', (t) => `Bądź w lesie ${t} dni z rzędu`),
  counter('staly-bywalec', 'seria', 'Stały bywalec', 'event_repeat', 'activeDays', [10, 30, 75, 150, 300], 'M', (t) =>
    `Wybierz się do lasu w ${t} różnych dni`,
  ),

  /* ── Społeczność ── */
  counter('darz-grzyb', 'spolecznosc', 'Darz grzyb!', 'favorite', 'reactionsGiven', [10, 40, 100, 250, 500], 'S', (t) =>
    `Daj „Darz grzyb!” ${n(t, 'wyprawie', 'wyprawom', 'wyprawom')} innych`,
  ),
  counter('ulubieniec-lasu', 'spolecznosc', 'Ulubieniec lasu', 'thumb_up', 'reactionsReceived', [10, 40, 100, 250, 500], 'M', (t) =>
    `Zbierz ${n(t, 'reakcję', 'reakcje', 'reakcji')} „Darz grzyb!” pod swoimi wyprawami`,
  ),
  counter('gawedziarz', 'spolecznosc', 'Gawędziarz', 'chat_bubble', 'comments', [5, 20, 50, 120, 250], 'S', (t) =>
    `Napisz ${n(t, 'komentarz', 'komentarze', 'komentarzy')}`,
  ),
  counter('wataha', 'spolecznosc', 'Leśna wataha', 'group', 'friends', [1, 3, 8, 15, 30], 'S', (t) =>
    t === 1 ? 'Dodaj pierwszego znajomego' : `Miej ${n(t, 'znajomego', 'znajomych', 'znajomych')} w grze`,
  ),
  counter('kronikarz', 'spolecznosc', 'Kronikarz', 'ios_share', 'published', [1, 5, 15, 40, 80], 'M', (t) =>
    t === 1 ? 'Opublikuj wyprawę w feedzie' : `Opublikuj ${n(t, 'wyprawę', 'wyprawy', 'wypraw')} w feedzie`,
  ),

  /* ── Wyzwania ── */
  counter('wyzwania-gmin', 'wyzwania', 'Duma gminy', 'flag', 'challengesDone', [1, 3, 8, 20, 40], 'L', (t) =>
    t === 1 ? 'Ukończ wyzwanie gminy' : `Ukończ ${n(t, 'wyzwanie gminy', 'wyzwania gmin', 'wyzwań gmin')}`,
  ),
  counter('sumienny', 'wyzwania', 'Sumienny', 'task_alt', 'dailyQuestsDone', [10, 40, 100, 250, 500], 'M', (t) =>
    `Wykonaj ${n(t, 'zadanie dnia', 'zadania dnia', 'zadań dnia')}`,
  ),
  counter('tygodniowy-rytm', 'wyzwania', 'Tygodniowy rytm', 'event_repeat', 'weeklyQuestsDone', [3, 10, 25, 50, 100], 'L', (t) =>
    `Wykonaj ${n(t, 'zadanie tygodnia', 'zadania tygodnia', 'zadań tygodnia')}`,
  ),

  /* ── Sekretne ── */
  secret('diabelski-borowik', 'Diabelski borowik', 'local_fire_department', { kind: 'set', ids: ['borowik-szatanski'] }, 1, 250, 'Sfotografuj borowika szatańskiego'),
  secret('biala-broda', 'Biała broda', 'water_drop', { kind: 'set', ids: ['soplowka-jezowata'] }, 1, 400, 'Znajdź soplówkę jeżowatą'),
  secret('uparty-zbieracz', 'Uparty zbieracz', 'repeat', { kind: 'counter', counter: 'sameSpeciesRun' }, 3, 100, 'Znajdź ten sam gatunek trzy razy z rzędu'),
  secret('jedenasta-jedenascie', 'Jedenasta jedenaście', 'alarm', { kind: 'counter', counter: 'findsAt1111' }, 1, 111, 'Znajdź grzyba dokładnie o 11:11'),
  secret('piatek-trzynastego', 'Piątek trzynastego', 'skull', { kind: 'counter', counter: 'friday13Poison' }, 13, 313, 'Sfotografuj 13 grzybów trujących w piątki 13.'),
  secret('nocny-grzybiarz', 'Nocny grzybiarz', 'owl', { kind: 'counter', counter: 'nightFinds' }, 1, 200, 'Znajdź grzyba między 22:00 a 4:00'),
  secret('wigilijny-grzyb', 'Wigilijny grzyb', 'park', { kind: 'counter', counter: 'christmasFinds' }, 1, 240, 'Znajdź grzyba w Wigilię'),
];

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
        if (m.edibility === 'niejadalne') return s.edibility === 'niejadalny';
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
      return counterValue(input.counters, 'xxlFinds');
    case 'record':
      return atlas[m.speciesId]?.[m.field] ?? 0;
    case 'counter':
      return counterValue(input.counters, m.counter);
    case 'seasons':
      return seasonsCovered(input.counters.months ?? []);
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

/**
 * Migracja zapisu / nowe stopnie w słowniku: nagrodzone stopnie zostają, a wszystko, co gracz już osiągnął ponad nie,
 * liczy się jako nagrodzone BEZ XP (jak `seed_achievements` na serwerze) – nowe osiągnięcia nie zasypują XP na start.
 */
export function mergeSeedAwarded(awarded: Record<string, number>, input: AchievementInput): Record<string, number> {
  const out = { ...awarded };
  for (const s of evaluateAchievements(input)) {
    if (s.tier > (out[s.def.id] ?? 0)) out[s.def.id] = s.tier;
  }
  return out;
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

/** „23 / 25”, „520 g / 1 kg”. */
export function formatProgress(s: AchievementState): string {
  const target = s.next?.target ?? s.def.tiers[s.def.tiers.length - 1].target;
  const f = s.def.format ?? ((v: number) => String(v));
  return `${f(Math.min(s.value, target))} / ${f(target)}`;
}
