import type { Gmina, GminaKind, GminaStats, Rarity, RankingPeriod, RankingRow } from '@/types';
import { fmtInt, fmtMushroomers, placeLabel } from '@/utils/format';
import { hashString, mulberry32 } from '@/utils/random';

/** Wzór heatmapy 8×7 z makiety ('S' = gmina użytkownika, cyfra = stopień heatmapy 1–4). */
export const HEAT_PATTERN = ['..1221..', '.123321.', '12344321', '.2344S32', '..23321.', '.12221..', '..111...'];

const KNYSZYNSKA = 'Puszcza Knyszyńska';
const BIALOWIESKA = 'Puszcza Białowieska';

/** Pięć gmin z pełnymi danymi (ranking z makiety) – pozycje na siatce (wiersz, kolumna). */
const CORE: Record<string, { name: string; forest: string; mushroomers: number; pos: [number, number] }> = {
  suprasl: { name: 'Supraśl', forest: KNYSZYNSKA, mushroomers: 1248, pos: [3, 5] },
  michalowo: { name: 'Michałowo', forest: KNYSZYNSKA, mushroomers: 982, pos: [3, 4] },
  hajnowka: { name: 'Hajnówka', forest: BIALOWIESKA, mushroomers: 1106, pos: [2, 4] },
  narewka: { name: 'Narewka', forest: BIALOWIESKA, mushroomers: 640, pos: [3, 3] },
  grodek: { name: 'Gródek', forest: KNYSZYNSKA, mushroomers: 571, pos: [2, 3] },
};

/** Przynależność do kompleksu leśnego (uproszczona – gmina może leżeć tylko częściowo w puszczy). */
const FOREST_BY_NAME: Record<string, string> = {
  Wasilków: KNYSZYNSKA,
  'Czarna Białostocka': KNYSZYNSKA,
  'Dobrzyniewo Duże': KNYSZYNSKA,
  Zabłudów: KNYSZYNSKA,
  Szudziałowo: KNYSZYNSKA,
  Sokółka: KNYSZYNSKA,
  Krynki: KNYSZYNSKA,
  Janów: KNYSZYNSKA,
  Knyszyn: KNYSZYNSKA,
  Białowieża: BIALOWIESKA,
  'Dubicze Cerkiewne': BIALOWIESKA,
  Czyże: BIALOWIESKA,
  Kleszczele: BIALOWIESKA,
  Czeremcha: BIALOWIESKA,
  Narew: BIALOWIESKA,
};
const OTHER_FOREST = 'Lasy Podlasia';

const OTHER_NAMES = [
  'Wasilków', 'Czarna Białostocka', 'Dobrzyniewo Duże', 'Choroszcz', 'Zabłudów', 'Juchnowiec Kościelny',
  'Białowieża', 'Dubicze Cerkiewne', 'Czyże', 'Kleszczele', 'Szudziałowo', 'Sokółka', 'Krynki', 'Janów',
  'Sidra', 'Korycin', 'Knyszyn', 'Tykocin', 'Łapy', 'Turośń Kościelna', 'Zawady', 'Narew', 'Boćki', 'Orla',
  'Wyszki', 'Brańsk', 'Bielsk Podlaski', 'Czeremcha', 'Milejczyce', 'Nurzec-Stacja', 'Siemiatycze', 'Drohiczyn',
  'Mielnik',
];

function slug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function buildGminy(): { list: Gmina[]; heatWeek: Record<string, number> } {
  const list: Gmina[] = [];
  const heatWeek: Record<string, number> = {};
  const byPos = new Map<string, string>();
  Object.entries(CORE).forEach(([id, g]) => byPos.set(g.pos.join(','), id));
  let other = 0;
  HEAT_PATTERN.forEach((row, r) => {
    row.split('').forEach((ch, c) => {
      if (ch === '.') return;
      const coreId = byPos.get(`${r},${c}`);
      const rnd = mulberry32(hashString(`${r}:${c}`));
      if (coreId) {
        const g = CORE[coreId];
        list.push({
          id: coreId,
          name: g.name,
          forest: g.forest,
          voivodeship: 'podlaskie',
          tile: { row: r, col: c },
          mushroomers: g.mushroomers,
          forecast: coreId === 'suprasl' ? { score: 4, daysAfterRain: 2 } : { score: 2 + Math.floor(rnd() * 4), daysAfterRain: 1 + Math.floor(rnd() * 4) },
        });
        heatWeek[coreId] = ch === 'S' ? 4 : Number(ch) - 1;
        return;
      }
      const name = OTHER_NAMES[other++ % OTHER_NAMES.length];
      const id = slug(name);
      list.push({
        id,
        name,
        forest: FOREST_BY_NAME[name] ?? OTHER_FOREST,
        voivodeship: 'podlaskie',
        tile: { row: r, col: c },
        mushroomers: 90 + Math.floor(rnd() * 520),
        forecast: { score: 1 + Math.floor(rnd() * 5), daysAfterRain: 1 + Math.floor(rnd() * 5) },
      });
      heatWeek[id] = Number(ch) - 1;
    });
  });
  return { list, heatWeek };
}

const built = buildGminy();
export const GMINY: Gmina[] = built.list;
/** Stopnie heatmapy (0–4) dla „Tydzień” – dokładnie wzór z makiety. */
export const HEAT_WEEK: Record<string, number> = built.heatWeek;

export const CORE_IDS = ['suprasl', 'michalowo', 'hajnowka', 'narewka', 'grodek'] as const;

type RankingSeed = { id: string; points: string; trend: number | null };
export const RANKINGS: Record<RankingPeriod, RankingSeed[]> = {
  week: [
    { id: 'suprasl', points: '18 420', trend: 1 },
    { id: 'michalowo', points: '15 870', trend: -1 },
    { id: 'hajnowka', points: '14 200', trend: null },
    { id: 'narewka', points: '11 950', trend: 2 },
    { id: 'grodek', points: '9 310', trend: -1 },
  ],
  season: [
    { id: 'hajnowka', points: '212 400', trend: 1 },
    { id: 'suprasl', points: '198 760', trend: -1 },
    { id: 'michalowo', points: '154 300', trend: null },
    { id: 'narewka', points: '120 880', trend: null },
    { id: 'grodek', points: '97 410', trend: 1 },
  ],
  records: [
    { id: 'suprasl', points: '42 rek.', trend: 3 },
    { id: 'hajnowka', points: '38 rek.', trend: null },
    { id: 'narewka', points: '29 rek.', trend: 1 },
    { id: 'michalowo', points: '24 rek.', trend: -2 },
    { id: 'grodek', points: '17 rek.', trend: -1 },
  ],
};

const SUPRASL_STATS: Omit<GminaStats, 'rank'> = {
  gminaId: 'suprasl',
  mushroomers: 1248,
  mushrooms: 9870,
  species: 54,
  records: [
    { rarity: 'legendarny', speciesName: 'Szmaciak gałęzisty', value: '2,3 kg', author: 'Ola_W', when: '12 dni temu' },
    { rarity: 'epicki', speciesName: 'Borowik szlachetny', value: '1,1 kg', author: 'Marek_K', when: '5 dni temu' },
    { rarity: 'rzadki', speciesName: 'Czubajka kania', value: '38 cm', author: 'Bartek', when: 'wczoraj' },
  ],
  distribution: [
    { name: 'Podgrzybek brunatny', pct: 38 },
    { name: 'Borowik szlachetny', pct: 21 },
    { name: 'Pieprznik jadalny', pct: 14 },
    { name: 'Maślak zwyczajny', pct: 9 },
    { name: 'Inne', pct: 18 },
  ],
  challenge: {
    id: 'suprasl-szmaciak',
    title: 'Znajdź szmaciaka gałęzistego',
    speciesId: 'szmaciak-galezisty',
    description: 'Tylko 4 osoby znalazły go tu w tym sezonie.',
    xp: 500,
    badgeId: 'lowca-legend',
    badgeName: 'Łowca Legend',
  },
};

const RECORD_POOL: { rarity: Rarity; speciesName: string; value: string }[] = [
  { rarity: 'legendarny', speciesName: 'Soplówka jeżowata', value: '1,4 kg' },
  { rarity: 'legendarny', speciesName: 'Szmaciak gałęzisty', value: '1,9 kg' },
  { rarity: 'epicki', speciesName: 'Żagwica listkowata', value: '2,1 kg' },
  { rarity: 'epicki', speciesName: 'Borowik szlachetny', value: '980 g' },
  { rarity: 'rzadki', speciesName: 'Czubajka kania', value: '34 cm' },
  { rarity: 'rzadki', speciesName: 'Koźlarz czerwony', value: '620 g' },
];
const AUTHORS = ['Ola_W', 'Marek_K', 'Bartek', 'Ewa.las', 'Grzybiarz77', 'Kasia_P', 'Tomek_B'];
const WHEN = ['wczoraj', '2 dni temu', '5 dni temu', '9 dni temu', '12 dni temu', '3 tyg. temu'];
const CHALLENGE_SPECIES = [
  { speciesId: 'szmaciak-galezisty', title: 'Znajdź szmaciaka gałęzistego', badgeId: 'lowca-legend', badgeName: 'Łowca Legend' },
  { speciesId: 'smardz-jadalny', title: 'Znajdź smardza jadalnego', badgeId: 'lowca-legend', badgeName: 'Łowca Legend' },
  { speciesId: 'soplowka-jezowata', title: 'Znajdź soplówkę jeżowatą', badgeId: 'lowca-legend', badgeName: 'Łowca Legend' },
];

/** Statystyki gminy – Supraśl 1:1 z makiety, reszta deterministycznie z seeda. */
export function buildGminaStats(gmina: Gmina, rank: number): GminaStats {
  if (gmina.id === 'suprasl') return { ...SUPRASL_STATS, rank };
  const rnd = mulberry32(hashString(gmina.id));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const recs = [...RECORD_POOL].sort(() => rnd() - 0.5).slice(0, 3);
  recs.sort((a, b) => order(b.rarity) - order(a.rarity));
  const a = 26 + Math.floor(rnd() * 16);
  const b = 12 + Math.floor(rnd() * 12);
  const c = 8 + Math.floor(rnd() * 8);
  const d = 4 + Math.floor(rnd() * 6);
  const ch = pick(CHALLENGE_SPECIES);
  return {
    gminaId: gmina.id,
    rank,
    mushroomers: gmina.mushroomers,
    mushrooms: Math.round(gmina.mushroomers * (6 + rnd() * 3)),
    species: 28 + Math.floor(rnd() * 30),
    records: recs.map((r) => ({ ...r, author: pick(AUTHORS), when: pick(WHEN) })),
    distribution: [
      { name: 'Podgrzybek brunatny', pct: a },
      { name: 'Borowik szlachetny', pct: b },
      { name: 'Pieprznik jadalny', pct: c },
      { name: 'Maślak zwyczajny', pct: d },
      { name: 'Inne', pct: 100 - a - b - c - d },
    ].sort((x, y) => (x.name === 'Inne' ? 1 : y.name === 'Inne' ? -1 : y.pct - x.pct)),
    challenge: {
      id: `${gmina.id}-${ch.speciesId}`,
      title: ch.title,
      speciesId: ch.speciesId,
      description: `Tylko ${2 + Math.floor(rnd() * 7)} osoby znalazły go tu w tym sezonie.`,
      xp: 500,
      badgeId: ch.badgeId,
      badgeName: ch.badgeName,
    },
  };
}

function order(r: Rarity) {
  return ['pospolity', 'rzadki', 'epicki', 'legendarny'].indexOf(r);
}

/* ───────────── Gminy spoza danych gry (dowolna gmina z PRG, inne województwa) ───────────── */

/** Liczba grzybiarzy dla gminy bez danych gry – deterministycznie; więcej w miastach i gminach lesistych. */
export function mockMushroomers(g: { id: string; kind?: GminaKind; forestPct?: number | null }): number {
  const rnd = mulberry32(hashString(`grzybiarze:${g.id}`));
  const base = g.kind === 'miejska' ? 160 + rnd() * 520 : 70 + rnd() * 380;
  return Math.round(base + (g.forestPct ?? 25) * (5 + rnd() * 7));
}

/**
 * Zbiory liczą się w gminie znaleziska – grzybiarze z miast jeżdżą do lasów,
 * więc punkty rosną z lesistością (ok. ×0,6 przy 5% lasów, ×1,4 przy 55%).
 */
function forestFactor(forestPct?: number | null) {
  return 0.5 + Math.min(80, Math.max(0, forestPct ?? 25)) / 60;
}

export interface VoivodeshipRanking {
  /** Wszystkie gminy województwa, od pierwszego miejsca. */
  rows: RankingRow[];
  /** Stopień mapy cieplnej 0–4 (kwintyle rankingu). */
  heat: Record<string, number>;
  mushroomers: Record<string, number>;
}

/**
 * Ranking województwa spoza makiety: punkty z liczby grzybiarzy, lesistości i seeda okresu
 * (tydzień ≈ 9–16 pkt na grzybiarza, sezon ≈ 110–190, rekordy ≈ grzybiarze / 45; × czynnik lesistości).
 */
export function buildVoivodeshipRanking(
  gminy: {
    id: string;
    name: string;
    kind?: GminaKind;
    powiat?: string;
    forest?: string;
    forestPct?: number | null;
    mushroomers: number;
  }[],
  period: RankingPeriod,
): VoivodeshipRanking {
  const scored = gminy.map((g) => {
    const rnd = mulberry32(hashString(`${period}:${g.id}`));
    const f = forestFactor(g.forestPct);
    const score =
      period === 'records'
        ? Math.max(1, Math.round((g.mushroomers / 45) * f + rnd() * 9))
        : Math.round(g.mushroomers * f * (period === 'week' ? 9 + rnd() * 7 : 110 + rnd() * 80));
    const trend = Math.round((rnd() - 0.5) * 6);
    return { g, score, trend: trend === 0 ? null : trend };
  });
  scored.sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name, 'pl'));
  const n = scored.length;
  const heat: Record<string, number> = {};
  const mushroomers: Record<string, number> = {};
  const rows: RankingRow[] = scored.map(({ g, score, trend }, i) => {
    heat[g.id] = Math.max(0, 4 - Math.floor((i / n) * 5));
    mushroomers[g.id] = g.mushroomers;
    return {
      gminaId: g.id,
      rank: i + 1,
      name: g.name,
      sub: `${g.forest ?? placeLabel(g)} · ${fmtMushroomers(g.mushroomers)}`,
      points: period === 'records' ? `${score} rek.` : fmtInt(score),
      trend,
    };
  });
  return { rows, heat, mushroomers };
}
