/**
 * Szanse na gatunek na wyprawie – HEURYSTYKA (jak prognoza grzybowa w ./forecast.ts): ma dać się wytłumaczyć graczowi,
 * a nie przewidywać grzyby co do sztuki. Liczy ją telefon – mocki i Supabase dostarczają tylko dane wejściowe: zbiory
 * gatunków w gminie z ostatnich 14 dni (agregat po opóźnieniu prywatności, k-anonimowy – nigdy punkty znalezisk).
 *
 * Model (gmina × dzień):
 * - **λ** gatunku = oczekiwana liczba jego znalezisk na typowej ok. 3-godzinnej wyprawie = `bazowe znaleziska × udział`;
 *   szansa = 1 − e^(−λ) (co najmniej jedno znalezisko przy rozkładzie Poissona), obcięta do 1–95%.
 * - **bazowe znaleziska** = wg prognozy grzybowej (1/5 → 2, 2/5 → 4, 3/5 → 6,5, 4/5 → 9, 5/5 → 12; bez prognozy –
 *   typowy dzień 3/5) × aktywność sezonu (krzywe sezonu całego katalogu względem najlepszego miesiąca – zimą bliska 0)
 *   × lesistość gminy (×0,6 przy 5% lasów … ×1,15 od 50%).
 * - **udział** gatunku – wygładzenie bayesowskie (Dirichlet): `(znaleziska w gminie z 14 dni × trend sezonu
 *   + α × prior) × wilgoć`, znormalizowane do 1; α = 40 pseudo-znalezisk – bez danych decyduje prior, przy setkach
 *   znalezisk dane z gminy. **Prior** = sezon tego dnia (`seasonWeights` interpolowane między środkami miesięcy)
 *   × rzadkość (pospolity 100, rzadki 20, epicki 4, legendarny 1) × popularność w koszyku (jak generator aktywności na
 *   serwerze) × siedlisko (gatunki leśne częstsze w gminach lesistych, łąkowe i parkowe – w otwartych).
 *   Trend sezonu = sezon dziś / sezon tydzień temu (środek okna danych), 0,4–2,5 – kurki pod koniec sezonu słabną,
 *   choć w danych z 2 tygodni jeszcze ich sporo.
 * - **k-anonimowość**: serwer pomija gatunki z < 2 znalazcami (ich znaleziska są tylko w `total`) – te „ukryte”
 *   znaleziska rozkładamy na niewymienione gatunki proporcjonalnie do prioru.
 * - **wilgoć**: gatunki lubiące wilgoć (kurki, lejkowce, opieńki, koźlarze, mleczaje…) ×1,3 w 1–10 dni po deszczu,
 *   ×0,7 po 2 tygodniach bez deszczu.
 * - **„Ten tydzień”**: średnie λ z 7 kolejnych dni; prognoza dalej od dziś zbliża się do typowego dnia (3/5) –
 *   pogoda za kilka dni to niewiadoma.
 */
import type {
  ChanceHorizon,
  GminaChances,
  GminaSpeciesEvidence,
  Habitat,
  MushroomForecast,
  Rarity,
  Species,
  SpeciesChance,
} from '@/types';
import { addDays } from './forecast';

export type ChanceForecast = Pick<MushroomForecast, 'score' | 'daysAfterRain'>;
type SpeciesLike = Pick<Species, 'id' | 'rarity' | 'habitat' | 'seasonWeights' | 'habitats'>;

/** Okno danych z gminy (dni) – tyle prosi aplikacja serwer o zbiory gatunków. */
export const EVIDENCE_DAYS = 14;
export const CHANCE_MIN = 0.01;
export const CHANCE_MAX = 0.95;
/** Siła prioru w wygładzaniu (pseudo-znaleziska). */
export const PRIOR_STRENGTH = 40;
/** Prognoza „typowego dnia” – bez prognozy i dla dalszych dni tygodnia. */
export const TYPICAL_SCORE = 3;
/** Znaleziska na ok. 3-godzinnej wyprawie wg prognozy 1–5 (dzień w pełni sezonu). */
export const FINDS_BY_SCORE = [2, 4, 6.5, 9, 12] as const;
/** „Teraz w sezonie”: waga miesiąca co najmniej tyle (atlas, wykres sezonu). */
export const IN_SEASON = 0.5;
/** Lesistość przyjmowana, gdy gmina jej nie ma (średnia krajowa ~30%). */
export const DEFAULT_FOREST_PCT = 30;

/** Waga rzadkości na gatunek – jak generator aktywności na serwerze (dev_seed_voivodeship). */
export const RARITY_WEIGHT: Record<Rarity, number> = { pospolity: 100, rzadki: 20, epicki: 4, legendarny: 1 };

/**
 * Popularność w koszyku – mnożnik jak w generatorze aktywności (supabase/migrations/20261009100000_stats.sql):
 * podgrzybki, borowiki, kurki i maślaki zbiera się najczęściej; pozostałe pospolite ×0,3, inne rzadkości ×1.
 */
const ABUNDANCE: Record<string, number> = {
  'podgrzybek-brunatny': 8,
  'borowik-szlachetny': 12,
  'pieprznik-jadalny': 3,
  'maslak-zwyczajny': 2,
  'kozlarz-babka': 1.5,
  'opienka-miodowa': 1.2,
  'kozlarz-czerwony': 3,
  'mleczaj-rydz': 2,
  'czubajka-kania': 3,
};

export function abundanceOf(s: Pick<Species, 'id' | 'rarity'>): number {
  return ABUNDANCE[s.id] ?? (s.rarity === 'pospolity' ? 0.3 : 1);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/* ───────────────────────── Sezon ───────────────────────── */

export const MONTH_NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
] as const;
/** Inicjały miesięcy pod wykresem sezonu. */
export const MONTH_INITIALS = ['S', 'L', 'M', 'K', 'M', 'C', 'L', 'S', 'W', 'P', 'L', 'G'] as const;

/** Domyślne krzywe sezonu (I–XII) wg rzadkości – szczyt lipiec–październik, rzadsze gatunki węższe. */
const DEFAULT_SEASON: Record<Rarity, readonly number[]> = {
  pospolity: [0, 0, 0, 0.03, 0.1, 0.3, 0.6, 0.85, 1, 0.9, 0.4, 0.05],
  rzadki: [0, 0, 0, 0, 0.06, 0.25, 0.55, 0.85, 1, 0.8, 0.3, 0.02],
  epicki: [0, 0, 0, 0, 0.03, 0.15, 0.45, 0.8, 1, 0.7, 0.2, 0],
  legendarny: [0, 0, 0, 0, 0, 0.1, 0.35, 0.75, 1, 0.6, 0.15, 0],
};
/** Gatunki wiosenne bez danych sezonu (opis siedliska „Wiosną, …” – smardze, piestrzenice). */
const SPRING_SEASON: readonly number[] = [0, 0, 0.15, 0.8, 1, 0.3, 0.02, 0, 0, 0, 0, 0];

/** Krzywa sezonu gatunku (12 liczb 0..1): z katalogu albo domyślna (rzadkość, wiosna). */
export function seasonWeightsOf(s: Pick<Species, 'seasonWeights' | 'rarity' | 'habitat'>): readonly number[] {
  const w = s.seasonWeights;
  if (Array.isArray(w) && w.length === 12 && w.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    const max = Math.max(...w);
    if (max > 0) return w.map((x) => clamp(x, 0, 1));
  }
  if (/wiosn/i.test(s.habitat ?? '')) return SPRING_SEASON;
  return DEFAULT_SEASON[s.rarity] ?? DEFAULT_SEASON.pospolity;
}

function ymd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

/** Miesiąc (1–12) daty YYYY-MM-DD. */
export const monthOf = (date: string) => ymd(date).m;

/**
 * Waga sezonu w dniu `date` – interpolacja liniowa między środkami miesięcy (płynnie na przełomie miesiąca,
 * więc „Ten tydzień” i trend sezonu nie skaczą 1. dnia miesiąca).
 */
export function seasonAt(weights: readonly number[], date: string): number {
  const { y, m, d } = ymd(date);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pos = m - 1 + (d - 0.5) / dim - 0.5;
  const i0 = Math.floor(pos);
  const t = pos - i0;
  const a = weights[(i0 + 12) % 12] ?? 0;
  const b = weights[(i0 + 13) % 12] ?? 0;
  return a + (b - a) * t;
}

/** Czy gatunek jest „teraz w sezonie” (waga miesiąca ≥ 0,5). `month` 1–12. */
export function inSeason(s: Pick<Species, 'seasonWeights' | 'rarity' | 'habitat'>, month: number): boolean {
  return (seasonWeightsOf(s)[month - 1] ?? 0) >= IN_SEASON;
}

/**
 * Szczyt sezonu: najdłuższy ciągły (także przez przełom roku) zakres miesięcy z wagą ≥ 85% maksimum, zawierający
 * maksimum. Indeksy 0–11.
 */
export function peakRange(weights: readonly number[]): { from: number; to: number } {
  const max = Math.max(...weights);
  const top = weights.indexOf(max);
  const hot = (i: number) => (weights[(i + 12) % 12] ?? 0) >= max * 0.85;
  let from = top;
  let to = top;
  for (let k = 0; k < 11 && hot(from - 1) && (from - 1 + 12) % 12 !== to; k++) from = (from - 1 + 12) % 12;
  for (let k = 0; k < 11 && hot(to + 1) && (to + 1) % 12 !== from; k++) to = (to + 1) % 12;
  return { from, to };
}

/** „Szczyt: wrzesień–październik” → „wrzesień–październik” (jeden miesiąc → „wrzesień”). */
export function peakLabel(weights: readonly number[]): string {
  const { from, to } = peakRange(weights);
  return from === to ? MONTH_NAMES[from] : `${MONTH_NAMES[from]}–${MONTH_NAMES[to]}`;
}

export type SeasonPhase = 'peak' | 'start' | 'end' | 'in' | 'edge' | 'off';

/** Faza sezonu gatunku w dniu `date`: szczyt / początek / koniec / w sezonie / skraj / poza sezonem. */
export function seasonPhase(weights: readonly number[], date: string): SeasonPhase {
  const v = seasonAt(weights, date);
  const trend = seasonAt(weights, addDays(date, 14)) - seasonAt(weights, addDays(date, -14));
  if (v >= 0.85) return 'peak';
  if (v < 0.12) return 'off';
  if (v < 0.35) return 'edge';
  if (trend >= 0.15) return 'start';
  if (trend <= -0.15) return 'end';
  return 'in';
}

export const SEASON_PHASE_LABEL: Record<SeasonPhase, string> = {
  peak: 'Szczyt sezonu',
  start: 'Początek sezonu',
  end: 'Koniec sezonu',
  in: 'W sezonie',
  edge: 'Na skraju sezonu',
  off: 'Poza sezonem',
};

/* ───────────────────────── Siedlisko i lesistość ───────────────────────── */

export const HABITAT_LABEL: Record<Habitat, string> = {
  iglasty: 'Bory iglaste',
  lisciasty: 'Lasy liściaste',
  mieszany: 'Lasy mieszane',
  laka: 'Łąki i pastwiska',
  drewno: 'Na drewnie',
  torfowisko: 'Torfowiska',
  park: 'Parki i ogrody',
};

const FOREST_HABITATS: readonly Habitat[] = ['iglasty', 'lisciasty', 'mieszany', 'drewno', 'torfowisko'];
const isForest = (h: Habitat) => FOREST_HABITATS.includes(h);

/** Siedliska gatunku: z katalogu, a bez nich – z opisu siedliska („Bory sosnowe”, „Łąki i pobocza”). */
export function habitatsOf(s: Pick<Species, 'habitats' | 'habitat'>): Habitat[] {
  if (s.habitats?.length) return s.habitats;
  const t = (s.habitat ?? '').toLowerCase();
  const out: Habitat[] = [];
  const add = (h: Habitat) => {
    if (!out.includes(h)) out.push(h);
  };
  if (/łąk|pastwis|pobocz|polan/.test(t)) add('laka');
  if (/park|ogród|ogrod/.test(t)) add('park');
  if (/skraj|polan/.test(t)) add('mieszany');
  if (/pni|pień|drewn|korzeni/.test(t)) add('drewno');
  if (/torf/.test(t)) add('torfowisko');
  if (/liści|buk|bucz|dęb|dąb|dąbr|grab|łęg|osik|brzoz/.test(t)) add('lisciasty');
  if (/iglast|sosn|bor|świerk|bór/.test(t)) add('iglasty');
  if (/mieszan|ściółk/.test(t)) add('mieszany');
  return out.length ? out : ['mieszany'];
}

/** Udział siedlisk leśnych (pierwsze siedlisko liczy się podwójnie). */
function forestShare(habitats: Habitat[]): number {
  let f = 0;
  let all = 0;
  habitats.forEach((h, i) => {
    const w = i === 0 ? 2 : 1;
    all += w;
    if (isForest(h)) f += w;
  });
  return all ? f / all : 1;
}

/**
 * Dopasowanie siedliska do gminy (≈1 przy lesistości 30%): gatunki leśne rosną z lesistością (0,35–1,6),
 * łąkowe i parkowe – z udziałem terenów otwartych (0,3–1,4).
 */
export function habitatFit(habitats: Habitat[], forestPct: number | null | undefined): number {
  const f = clamp((forestPct ?? DEFAULT_FOREST_PCT) / 100, 0, 0.9);
  const forest = clamp(Math.pow(f / 0.3, 0.6), 0.35, 1.6);
  const open = clamp((1 - f) / 0.7, 0.3, 1.4);
  const share = forestShare(habitats);
  return share * forest + (1 - share) * open;
}

/** Mniej lasu – mniej grzybów na wyprawie: ×0,6 przy 5% lasów, ×0,91 przy 30%, ×1,15 od 50%. */
export function forestFactor(forestPct: number | null | undefined): number {
  return clamp(0.55 + ((forestPct ?? DEFAULT_FOREST_PCT) / 100) * 1.2, 0.6, 1.15);
}

/* ───────────────────────── Wilgoć ───────────────────────── */

/** Rodzaje lubiące wilgoć (po pierwszym członie id gatunku). */
const MOISTURE_GENERA = ['pieprznik', 'kurzawka', 'lejkowiec', 'opienka', 'czernidlak', 'lakowka', 'kozlarz', 'mleczaj'];

export const lovesMoisture = (speciesId: string) => MOISTURE_GENERA.includes(speciesId.split('-')[0]);

/** Mnożnik wilgoci: ×1,3 w 1–10 dni po deszczu, ×0,7 bez deszczu od 2 tygodni (tylko gatunki lubiące wilgoć). */
export function moistureFactor(speciesId: string, forecast: ChanceForecast | null | undefined): number {
  if (!forecast || !lovesMoisture(speciesId)) return 1;
  const d = forecast.daysAfterRain;
  if (d == null) return 0.7;
  return d >= 1 && d <= 10 ? 1.3 : 1;
}

/* ───────────────────────── Bazowe znaleziska ───────────────────────── */

/** Znaleziska na wyprawie dla prognozy 1–5 (ułamkowa – interpolacja). */
export function findsForScore(score: number): number {
  const s = clamp(score, 1, 5);
  const i = Math.min(3, Math.floor(s - 1));
  const t = s - 1 - i;
  return FINDS_BY_SCORE[i] + (FINDS_BY_SCORE[i + 1] - FINDS_BY_SCORE[i]) * t;
}

const potential = (s: SpeciesLike) => RARITY_WEIGHT[s.rarity] * abundanceOf(s);

/**
 * Aktywność sezonu 0..1: suma krzywych sezonu katalogu (ważona rzadkością i popularnością) w dniu `date`
 * względem najlepszego miesiąca. Wrzesień–październik ≈ 1, zima niska (~0,1: płomiennica, uszaki, trzęsaki, huby).
 */
export function seasonActivity(species: SpeciesLike[], date: string): number {
  let now = 0;
  const months = new Array<number>(12).fill(0);
  for (const s of species) {
    const w = seasonWeightsOf(s);
    const p = potential(s);
    now += p * seasonAt(w, date);
    for (let m = 0; m < 12; m++) months[m] += p * (w[m] ?? 0);
  }
  const max = Math.max(...months);
  return max > 0 ? clamp(now / max, 0, 1) : 0;
}

/** Prognoza dla dnia `d` od dziś: dalej od dziś coraz bliżej typowego dnia (3/5), od 4. dnia – typowy. */
export function projectedScore(score: number | null | undefined, d: number): number {
  if (score == null) return TYPICAL_SCORE;
  return score + (TYPICAL_SCORE - score) * Math.min(1, d / 4);
}

/**
 * Prognoza na dzień `d` od dziś (wilgoć): kolejne dni bez deszczu (nie znamy dalszych opadów), od 4. dnia – brak
 * prognozy (typowy dzień, bez mnożnika wilgoci).
 */
export function projectedForecast(forecast: ChanceForecast | null | undefined, d: number): ChanceForecast | null {
  if (!forecast || d >= 4) return null;
  const dar = forecast.daysAfterRain;
  return { score: projectedScore(forecast.score, d), daysAfterRain: dar == null || dar + d > 14 ? null : dar + d };
}

/** 1 − e^(−λ), obcięte do 1–95%. */
export function chanceFromExpected(expected: number): number {
  return clamp(1 - Math.exp(-Math.max(0, expected)), CHANCE_MIN, CHANCE_MAX);
}

/** „78%” */
export const fmtChance = (chance: number) => `${Math.round(chance * 100)}%`;

/* ───────────────────────── Model ───────────────────────── */

export interface ChanceInput {
  gminaId: string;
  /** Katalog gatunków (wszystkie aktywne). */
  species: Species[];
  /** Lesistość gminy w % (brak = 30%). */
  forestPct?: number | null;
  /** Zbiory gminy z ostatnich 14 dni (brak / total 0 = tylko prior). */
  evidence?: GminaSpeciesEvidence | null;
  /** YYYY-MM-DD – dzień wyprawy („Ten tydzień”: pierwszy z 7 dni). */
  date: string;
  /** Prognoza grzybowa gminy na `date` (brak = typowy dzień sezonu). */
  forecast?: ChanceForecast | null;
  horizon?: ChanceHorizon;
}

interface Prepared {
  s: Species;
  weights: readonly number[];
  habitats: Habitat[];
  fit: number;
  /** Prior bez sezonu: rzadkość × popularność × siedlisko. */
  base: number;
}

/** Znaleziska z danych gminy na gatunek: wymienione + „ukryte” (k-anonimowość) rozłożone wg prioru. */
function evidenceCounts(prep: Prepared[], evidence: GminaSpeciesEvidence | null | undefined, priorShare: number[]) {
  const counts = new Array<number>(prep.length).fill(0);
  const listed = new Set<number>();
  if (!evidence || evidence.total <= 0) return { counts, listed, n: 0 };
  const index = new Map(prep.map((p, i) => [p.s.id, i]));
  let listedSum = 0;
  for (const e of evidence.species) {
    const finds = Math.max(0, e.finds);
    listedSum += finds;
    const i = index.get(e.speciesId);
    if (i == null) continue;
    counts[i] += finds;
    listed.add(i);
  }
  const hidden = Math.max(0, evidence.total - listedSum);
  if (hidden > 0) {
    let rest = 0;
    prep.forEach((_, i) => {
      if (!listed.has(i)) rest += priorShare[i];
    });
    if (rest > 0) {
      prep.forEach((_, i) => {
        if (!listed.has(i)) counts[i] += (hidden * priorShare[i]) / rest;
      });
    }
  }
  return { counts, listed, n: counts.reduce((a, b) => a + b, 0) };
}

/** Prior (znormalizowany) na dzień `date`. Minimalny sezon 0,005 – zimą udziały nie dzielą przez zero. */
function priorShares(prep: Prepared[], date: string): number[] {
  const raw = prep.map((p) => p.base * Math.max(0.005, seasonAt(p.weights, date)));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => (sum > 0 ? x / sum : 1 / raw.length));
}

/** Udziały gatunków w znaleziskach na wyprawie w dniu `date` (suma 1). */
function shares(
  prep: Prepared[],
  date: string,
  forecast: ChanceForecast | null | undefined,
  counts: number[],
  evidenceDate: string,
): number[] {
  const prior = priorShares(prep, date);
  const w = prep.map((p, i) => {
    const trend = counts[i] > 0 ? clamp((seasonAt(p.weights, date) + 0.05) / (seasonAt(p.weights, evidenceDate) + 0.05), 0.4, 2.5) : 0;
    return (counts[i] * trend + PRIOR_STRENGTH * prior[i]) * moistureFactor(p.s.id, forecast);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (sum > 0 ? x / sum : 0));
}

/** Uzasadnienia gatunku – najważniejsze pierwsze. */
function reasonsFor(
  p: Prepared,
  i: number,
  ctx: { date: string; forecast: ChanceForecast | null | undefined; listed: Set<number>; evidenceRank: Map<number, number>; dataShare: number[] },
): string[] {
  const out: string[] = [];
  if (ctx.listed.has(i)) {
    const rank = ctx.evidenceRank.get(i) ?? 99;
    out.push(rank <= 5 && ctx.dataShare[i] >= 0.05 ? 'Często znajdowany w gminie w ostatnich 2 tyg.' : 'Znajdowany w gminie w ostatnich 2 tyg.');
  }
  out.push(SEASON_PHASE_LABEL[seasonPhase(p.weights, ctx.date)]);
  const moist = moistureFactor(p.s.id, ctx.forecast);
  if (moist > 1) out.push('Po deszczu – lubi wilgoć');
  else if (moist < 1) out.push('Za sucho – lubi wilgoć');
  const forestHeavy = forestShare(p.habitats) >= 0.5;
  if (p.fit >= 1.2) out.push(forestHeavy ? 'Dużo lasów w gminie' : 'Lubi łąki i parki – tu ich sporo');
  else if (p.fit <= 0.65) out.push(forestHeavy ? 'Mało lasów w gminie' : 'Woli łąki i parki');
  if (p.s.rarity === 'legendarny') out.push('Legenda – trafia się nielicznym');
  else if (p.s.rarity === 'epicki') out.push('Rzadko spotykany');
  return out;
}

/**
 * Szanse na wszystkie gatunki katalogu w gminie (model z nagłówka pliku). Czysta funkcja – te same wyniki
 * w mockach i w trybie Supabase.
 */
export function computeChances(input: ChanceInput): GminaChances {
  const { species, date, forecast } = input;
  const horizon: ChanceHorizon = input.horizon ?? 'day';
  const forestPct = input.forestPct ?? null;
  const prep: Prepared[] = species.map((s) => {
    const habitats = habitatsOf(s);
    const fit = habitatFit(habitats, forestPct);
    return { s, weights: seasonWeightsOf(s), habitats, fit, base: potential(s) * fit };
  });

  // Dane z gminy – okno 14 dni kończy się wczoraj (opóźnienie prywatności), środek ~tydzień temu.
  const evidenceDate = addDays(date, -Math.round(EVIDENCE_DAYS / 2));
  const { counts, listed, n } = evidenceCounts(prep, input.evidence, priorShares(prep, evidenceDate));
  const dataShare = counts.map((c) => (n > 0 ? c / n : 0));
  const evidenceRank = new Map(
    [...listed].sort((a, b) => counts[b] - counts[a]).map((i, k) => [i, k + 1] as const),
  );

  const days = horizon === 'week' ? 7 : 1;
  const expected = new Array<number>(prep.length).fill(0);
  let expectedFinds = 0;
  for (let d = 0; d < days; d++) {
    const day = addDays(date, d);
    const dayForecast = projectedForecast(forecast, d);
    const base = findsForScore(projectedScore(forecast?.score, d)) * seasonActivity(species, day) * forestFactor(forestPct);
    expectedFinds += base / days;
    const sh = shares(prep, day, dayForecast, counts, evidenceDate);
    sh.forEach((x, i) => {
      expected[i] += (base * x) / days;
    });
  }

  const out: SpeciesChance[] = prep.map((p, i) => ({
    speciesId: p.s.id,
    chance: chanceFromExpected(expected[i]),
    expected: expected[i],
    reasons: reasonsFor(p, i, { date, forecast, listed, evidenceRank, dataShare }),
    local: listed.has(i),
  }));
  out.sort((a, b) => b.expected - a.expected || a.speciesId.localeCompare(b.speciesId));

  return {
    gminaId: input.gminaId,
    date,
    horizon,
    expectedFinds,
    forecastScore: forecast?.score ?? null,
    evidenceTotal: input.evidence?.total ?? 0,
    species: out,
  };
}

/** Najbardziej prawdopodobne gatunki (opcjonalnie tylko spełniające `filter`). */
export function topChances(c: GminaChances, n: number, filter?: (speciesId: string) => boolean): SpeciesChance[] {
  return (filter ? c.species.filter((x) => filter(x.speciesId)) : c.species).slice(0, n);
}

/** Za mało grzybów, by pokazywać szanse (zima): oczekiwane znaleziska na wyprawie poniżej tylu. */
export const OFF_SEASON_FINDS = 0.6;

/** Szerokość znaku (px) czcionki 12 – szacunek, ile mieści się w jednej linii (etykieta pogrubiona jest szersza). */
const CHAR_W = 6.4;
const LABEL_CHAR_W = 6.9;

/**
 * Linijka „Najbardziej prawdopodobne tu: …” na Starcie – najdłuższy wariant mieszczący się w `width` px: pełna etykieta
 * i 3 gatunki → krótka („Szanse tu:”) i 3 → 2 → 1. Szerokość szacujemy ze znaków (Nunito Sans 12 px), bez pomiaru tekstu.
 */
export function fitChanceLine(items: string[], width: number): { label: string; text: string } {
  const variants: { label: string; n: number }[] = [
    { label: 'Najbardziej prawdopodobne tu: ', n: 3 },
    { label: 'Szanse tu: ', n: 3 },
    { label: 'Szanse tu: ', n: 2 },
    { label: 'Szanse tu: ', n: 1 },
  ];
  for (const v of variants) {
    const text = items.slice(0, v.n).join(' · ');
    if (v.label.length * LABEL_CHAR_W + text.length * CHAR_W <= width) return { label: v.label, text };
  }
  return { label: 'Szanse tu: ', text: items.slice(0, 1).join('') };
}
