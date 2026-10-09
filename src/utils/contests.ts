/**
 * Walki o okaz – czyste funkcje (docs/rywalizacja.md §2; testy: src/utils/__tests__/contests.test.ts).
 *
 * Tydzień walk: poniedziałek 00:00 – następny poniedziałek 00:00 w strefie Europe/Warsaw (niezależnie od strefy
 * telefonu). Co tydzień 3 walki: „Okaz tygodnia” (`{pon}:okaz`, kapelusz względem typowego w %) i dwa gatunki
 * tygodnia (`{pon}:{gatunek}`, kapelusz w cm). Gatunki tygodnia losujemy DOKŁADNIE jak serwer (SQL w migracji
 * rywalizacji – test zgodności w `npm run db:test`): ten sam hash (`questHash`), ta sama lista kandydatów i kolejność.
 */
import type { Contest, ContestEntry, ContestKind, ContestMatch, ContestScope, ContestStatus, Find, Species } from '@/types';
import { addDays } from './forecast';
import { remotePhotoUri } from './findPhoto';
import { plural } from './format';
import { questHash, weekStartKey } from './quests';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

/** Zasięgi z podium i nagrodami (znajomi – tylko tablica, bez nagród). */
export type PublicContestScope = Exclude<ContestScope, 'znajomi'>;
export const PUBLIC_CONTEST_SCOPES: readonly PublicContestScope[] = ['gmina', 'wojewodztwo', 'polska'];

/** Liczba gatunków w puli tygodnia poza sezonem klasyków (pierwsze 6 kandydatów wg wagi sezonu). */
export const CONTEST_SPECIES_POOL = 6;
/** Pierwsze 8 kandydatów to „klasyka” grzybiarzy (borowik, podgrzybek, kania, koźlarze, maślak, rydz, ceglastopory). */
export const CONTEST_CLASSIC_COUNT = 8;
/** Waga sezonu, od której klasyk jest „w sezonie”. */
export const CONTEST_IN_SEASON = 0.5;
/** Tyle klasyków w sezonie wystarcza, żeby pula była tylko z nich. */
export const CONTEST_CLASSIC_MIN = 4;
/** `find_cap_factor` serwera: kapelusz większy niż tyle × typowy – okaz nie walczy (flaga do przeglądu). */
export const FIND_CAP_FACTOR = 2.5;
/** `rivalry_queue_grace_h`: zgłoszenie okazu z minionego tygodnia jeszcze tyle godzin po jego końcu (kolejka offline). */
export const RIVALRY_QUEUE_GRACE_H = 6;
/** Opóźnienie prywatności (cudze okazy w zasięgach publicznych – po 24 h). */
export const PRIVACY_DELAY_H = 24;
/** Rozstrzygnięcie: koniec tygodnia + 48 h (24 h prywatności + czas na zgłoszenia). */
export const RESULTS_DELAY_H = 48;
/** Podium tylko przy tylu uczestnikach w zasięgu. */
export const CONTEST_MIN_ENTRANTS: Record<PublicContestScope, number> = { gmina: 3, wojewodztwo: 5, polska: 10 };
/** XP za 1. / 2. / 3. miejsce (gracz dostaje w jednej walce tylko najwyższą nagrodę). */
export const CONTEST_PRIZE_XP: Record<PublicContestScope, readonly [number, number, number]> = {
  polska: [500, 300, 150],
  wojewodztwo: [250, 150, 75],
  gmina: [100, 60, 30],
};

/* ───────────────────────── Czas (Europe/Warsaw) ───────────────────────── */

/** Ostatnia niedziela miesiąca, 01:00 UTC – zmiana czasu w UE. `month` 0–11. */
function lastSundayUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
}

/** Przesunięcie czasu Europe/Warsaw względem UTC (min): 120 latem (ostatnia nd marca – ostatnia nd października), 60 zimą. */
export function warsawOffsetMin(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayUtc(y, 2) && utcMs < lastSundayUtc(y, 9) ? 120 : 60;
}

/** Data kalendarzowa w Warszawie (YYYY-MM-DD) – także gdy telefon ma inną strefę. */
export function warsawYmd(d: Date = new Date()): string {
  const t = d.getTime();
  return new Date(t + warsawOffsetMin(t) * MIN).toISOString().slice(0, 10);
}

/** Północ dnia `ymd` w Warszawie (epoch ms). Zmiana czasu jest o 01:00 UTC, więc nigdy nie wypada w okolicy północy. */
export function warsawMidnight(ymd: string): number {
  const utc = Date.parse(`${ymd}T00:00:00Z`);
  return utc - warsawOffsetMin(utc - 90 * MIN) * MIN;
}

/** Poniedziałek tygodnia walk (YYYY-MM-DD) dla chwili `now`. */
export function contestWeekStart(now: Date | number = new Date()): string {
  return weekStartKey(warsawYmd(typeof now === 'number' ? new Date(now) : now));
}

export interface ContestWeekBounds {
  startsAt: string;
  endsAt: string;
  resultsAt: string;
}

/** Granice tygodnia walk: pon 00:00 → nast. pon 00:00 (Europe/Warsaw), wyniki 48 h później. */
export function contestWeekBounds(weekStart: string): ContestWeekBounds {
  const start = warsawMidnight(weekStart);
  const end = warsawMidnight(addDays(weekStart, 7));
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    resultsAt: new Date(end + RESULTS_DELAY_H * H).toISOString(),
  };
}

/** Status walki w chwili `now` (z samych dat – rozstrzygnięcie na serwerze jest leniwe, więc to tylko przybliżenie). */
export function contestStatusAt(c: Pick<Contest, 'endsAt' | 'resultsAt'>, now: number = Date.now()): ContestStatus {
  if (now < Date.parse(c.endsAt)) return 'open';
  return now < Date.parse(c.resultsAt) ? 'judging' : 'final';
}

/** Ostatnio rozstrzygnięty tydzień (wyniki po `resultsAt`) przed tygodniem `now`. */
export function lastResolvedWeek(now: number = Date.now()): string {
  const prev = addDays(contestWeekStart(now), -7);
  return now >= Date.parse(contestWeekBounds(prev).resultsAt) ? prev : addDays(prev, -7);
}

/* ───────────────────────── Gatunki tygodnia (lustro SQL) ───────────────────────── */

/**
 * Kandydaci na gatunki tygodnia – stała lista popularnych gatunków grzybiarzy. Kolejność ma znaczenie (rozstrzyga
 * remisy wagi sezonu) – ta sama w SQL. Wcześniej pula była z całego katalogu i w październiku wychodziły np. monetnica
 * maślana i gąska ziemistoblaszkowa.
 */
export const CONTEST_SPECIES_CANDIDATES: readonly string[] = [
  'borowik-szlachetny',
  'podgrzybek-brunatny',
  'czubajka-kania',
  'kozlarz-babka',
  'kozlarz-czerwony',
  'maslak-zwyczajny',
  'mleczaj-rydz',
  'borowik-ceglastopory',
  'kozlarz-pomaranczowozolty',
  'borowik-usiatkowany',
  'borowik-sosnowy',
  'czubajka-czerwieniejaca',
  'purchawica-olbrzymia',
  'sarniak-dachowkowaty',
  'gaska-nieksztaltna',
  'gasowka-fioletowawa',
  'zagiew-luskowata',
  'pieczarka-polna',
  'maslak-zolty',
  'kozlarz-grabowy',
];

/**
 * Pula gatunków tygodnia: kandydaci obecni w katalogu `species` z wagą sezonu w miesiącu (poniedziałek + 3 dni; brak
 * `seasonWeights` → 0), posortowani wg wagi malejąco, potem pozycja na liście kandydatów. Gdy co najmniej 4 klasyki
 * (pierwsze 8 kandydatów) mają wagę ≥ 0,5 – pula to tylko te klasyki (w sezonie walczy się o borowiki, podgrzybki,
 * kanie…); inaczej (wiosna, późna jesień, zima) – pierwsze 6 ze wszystkich kandydatów.
 */
export function contestSpeciesPool(weekStart: string, species: readonly Species[]): Species[] {
  const month = Number(addDays(weekStart, 3).slice(5, 7));
  const byId = new Map(species.map((s) => [s.id, s]));
  const ranked = CONTEST_SPECIES_CANDIDATES.flatMap((id, i) => {
    const s = byId.get(id);
    return s ? [{ s, i, w: s.seasonWeights?.[month - 1] ?? 0 }] : [];
  }).sort((a, b) => b.w - a.w || a.i - b.i);
  const classics = ranked.filter((x) => x.i < CONTEST_CLASSIC_COUNT && x.w >= CONTEST_IN_SEASON);
  return (classics.length >= CONTEST_CLASSIC_MIN ? classics : ranked.slice(0, CONTEST_SPECIES_POOL)).map(({ s }) => s);
}

/**
 * Dwa gatunki tygodnia: h = questHash(pon + ':okaz'), a = h mod n, b = (a + 1 + (⌊h / n⌋ mod (n − 1))) mod n
 * – zawsze różne.
 */
export function contestSpeciesForWeek(weekStart: string, species: readonly Species[]): [string, string] {
  const pool = contestSpeciesPool(weekStart, species);
  const n = pool.length;
  if (n < 2) throw new Error('Za mało gatunków do walk tygodnia');
  const h = questHash(`${weekStart}:okaz`);
  const a = h % n;
  const b = (a + 1 + (Math.floor(h / n) % (n - 1))) % n;
  return [pool[a].id, pool[b].id];
}

/* ───────────────────────── Id i tytuły ───────────────────────── */

export const RELATIVE_KEY = 'okaz';

/** `2026-10-05:okaz`, `2026-10-05:borowik-szlachetny`. */
export const contestId = (weekStart: string, key: string) => `${weekStart}:${key}`;

export interface ParsedContestId {
  weekStart: string;
  kind: ContestKind;
  speciesId: string | null;
}

/** Id walki → tydzień i rodzaj; null, gdy id nie ma postaci `YYYY-MM-DD:klucz`. */
export function parseContestId(id: string): ParsedContestId | null {
  const m = /^(\d{4}-\d{2}-\d{2}):(.+)$/.exec(id);
  if (!m) return null;
  return m[2] === RELATIVE_KEY
    ? { weekStart: m[1], kind: 'relative', speciesId: null }
    : { weekStart: m[1], kind: 'species', speciesId: m[2] };
}

/** Rzeczowniki rodzaju żeńskiego bez końcówki „-a” (pierwsze słowo nazwy gatunku). */
const FEMININE = new Set(['żagiew']);

/** „Największy borowik szlachetny”, „Największa czubajka kania” – rodzaj z pierwszego słowa nazwy. */
export function biggestTitle(speciesName: string): string {
  const name = speciesName.trim();
  const first = name.split(/\s+/)[0].toLowerCase();
  const adj = first.endsWith('a') || FEMININE.has(first) ? 'Największa' : 'Największy';
  return `${adj} ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
}

/** Tytuł walki: „Okaz tygodnia” albo „Największy {gatunek}”. */
export function contestTitle(kind: ContestKind, speciesName?: string | null): string {
  return kind === 'species' && speciesName ? biggestTitle(speciesName) : 'Okaz tygodnia';
}

/** Trzy walki tygodnia (bez liczby uczestników – tę dopisuje źródło danych). Status w chwili `now`. */
export function weekContests(weekStart: string, species: readonly Species[], now: number = Date.now()): Contest[] {
  const bounds = contestWeekBounds(weekStart);
  const status = contestStatusAt(bounds, now);
  const byId = new Map(species.map((s) => [s.id, s]));
  const base = { ...bounds, status, entrants: 0 };
  return [
    { ...base, id: contestId(weekStart, RELATIVE_KEY), kind: 'relative', speciesId: null, title: contestTitle('relative') },
    ...contestSpeciesForWeek(weekStart, species).map((id): Contest => ({
      ...base,
      id: contestId(weekStart, id),
      kind: 'species',
      speciesId: id,
      title: contestTitle('species', byId.get(id)?.name),
    })),
  ];
}

/* ───────────────────────── Wynik ───────────────────────── */

/** Zaokrąglenie do 1 miejsca po przecinku (jak `round(x, 1)` w SQL dla liczb dodatnich). */
export const round1 = (x: number) => Math.round(x * 10) / 10;

/** Kapelusz względem typowego dla gatunku (%), 1 miejsce po przecinku. */
export function relativePct(capCm: number, typicalCapCm: number): number {
  if (!(typicalCapCm > 0)) return 0;
  return Math.round((capCm * 1000) / typicalCapCm) / 10;
}

/** Wynik okazu w walce: cm kapelusza (gatunek tygodnia) albo % typowego („Okaz tygodnia”). */
export function contestScore(kind: ContestKind, capCm: number, typicalCapCm: number): number {
  return kind === 'species' ? round1(capCm) : relativePct(capCm, typicalCapCm);
}

type Scored = { score: number; foundAt: string };

/** Kolejność tablicy: wynik malejąco, przy remisie wcześniejsze znalezisko wyżej. */
export function compareEntries(a: Scored, b: Scored): number {
  return b.score - a.score || Date.parse(a.foundAt) - Date.parse(b.foundAt);
}

export function sortEntries<T extends Scored>(list: readonly T[]): T[] {
  return [...list].sort(compareEntries);
}

/** Miejsce, które zająłby wynik wśród `others` (lepsze wyniki i równe, ale znalezione wcześniej, są wyżej). */
export function rankAmong(entry: Scored, others: readonly Scored[]): number {
  const t = Date.parse(entry.foundAt);
  return 1 + others.filter((o) => o.score > entry.score || (o.score === entry.score && Date.parse(o.foundAt) < t)).length;
}

/** Podium zasięgu (do 3 najlepszych) – puste przy mniej niż `minEntrants` uczestnikach. */
export function podium<T extends Scored>(entries: readonly T[], minEntrants: number): T[] {
  return entries.length < minEntrants ? [] : sortEntries(entries).slice(0, 3);
}

export interface AwardCandidate extends Scored {
  userId: string;
  gminaId: string;
  voivodeship: string;
}

export interface ContestAward {
  userId: string;
  scope: PublicContestScope;
  /** Gmina (slug) / województwo (nazwa); null – Polska. */
  scopeId: string | null;
  place: 1 | 2 | 3;
  /** Nagroda – tylko najwyższa w walce, pozostałe podia z 0 XP (trofeum). */
  xp: number;
}

/**
 * Rozstrzygnięcie jednej walki: podia każdej gminy, każdego województwa i Polski (z minimalną liczbą uczestników),
 * XP – gracz dostaje tylko najwyższą nagrodę w tej walce. `entries` – najlepszy okaz każdego gracza (widoczny publicznie).
 */
export function contestAwards(entries: readonly AwardCandidate[]): ContestAward[] {
  const groups: { scope: PublicContestScope; scopeId: string | null; list: AwardCandidate[] }[] = [];
  const group = (scope: PublicContestScope, key: (e: AwardCandidate) => string | null) => {
    const by = new Map<string | null, AwardCandidate[]>();
    entries.forEach((e) => by.set(key(e), [...(by.get(key(e)) ?? []), e]));
    by.forEach((list, scopeId) => groups.push({ scope, scopeId, list }));
  };
  group('polska', () => null);
  group('wojewodztwo', (e) => e.voivodeship);
  group('gmina', (e) => e.gminaId);
  const awards: ContestAward[] = [];
  for (const g of groups) {
    podium(g.list, CONTEST_MIN_ENTRANTS[g.scope]).forEach((e, i) => {
      const place = (i + 1) as 1 | 2 | 3;
      awards.push({ userId: e.userId, scope: g.scope, scopeId: g.scopeId, place, xp: CONTEST_PRIZE_XP[g.scope][i] });
    });
  }
  // Jedna nagroda na gracza w walce – najwyższa (przy równych XP: szerszy zasięg, bo jest pierwszy na liście).
  const best = new Map<string, ContestAward>();
  awards.forEach((a) => {
    const cur = best.get(a.userId);
    if (!cur || a.xp > cur.xp) best.set(a.userId, a);
  });
  return awards.map((a) => (best.get(a.userId) === a ? a : { ...a, xp: 0 }));
}

const SCOPE_WEIGHT: Record<PublicContestScope, number> = { polska: 3, wojewodztwo: 2, gmina: 1 };

/**
 * Trofea jednej walki razem (Profil, ekran Rywalizacja): na wierzchu podium z nagrodą (albo najwyższy zasięg),
 * pozostałe podia tej walki w `also`. Kolejność walk jak na liście (najnowsze najpierw).
 */
export function groupTrophies<T extends { contestId: string; scope: PublicContestScope; place: number; xp: number }>(
  items: readonly T[],
): { top: T; also: T[] }[] {
  const groups = new Map<string, T[]>();
  items.forEach((t) => groups.set(t.contestId, [...(groups.get(t.contestId) ?? []), t]));
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.xp - a.xp || SCOPE_WEIGHT[b.scope] - SCOPE_WEIGHT[a.scope] || a.place - b.place);
    return { top: sorted[0], also: sorted.slice(1) };
  });
}

/* ───────────────────────── Kwalifikacja okazu ───────────────────────── */

export const CONTEST_REASONS = {
  unknownSpecies: 'Nie znamy tego gatunku – okaz nie może walczyć.',
  protected: 'Gatunek chroniony – zdjęcie zostaje w atlasie, ale okaz nie walczy.',
  clustered: 'Gatunki rosnące w kępkach liczymy w sztukach – nie walczą o okaz.',
  pieces: 'Na zdjęciu jest kilka grzybów – do walki zgłoś pojedynczy owocnik.',
  unclaimed: 'Najpierw odbierz znalezisko.',
  scale: 'Na zdjęciu zabrakło odniesienia skali – połóż obok dłoń albo monetę, a zmierzę kapelusz.',
  tooBig: 'Kapelusz jest nietypowo duży jak na ten gatunek – okaz czeka na sprawdzenie i nie walczy.',
  oldWeek: 'Walczą okazy z bieżącego tygodnia – ten jest z wcześniejszego.',
} as const;

/** Podpowiedź pod zdjęciem bez skali (ekran Nagroda). */
export const SCALE_HINT = 'Połóż obok dłoń albo monetę – zmierzę kapelusz i okaz zawalczy w Okazie tygodnia.';

export interface ContestCheck {
  ok: boolean;
  /** Powód po polsku, gdy nie. */
  reason: string | null;
  /** Tydzień walk, w którym okaz walczy. */
  weekStart: string | null;
  /** Brak odniesienia skali – da się to naprawić następnym zdjęciem. */
  missingScale?: boolean;
}

/**
 * Warunki okazu z telefonu (docs/rywalizacja.md §2) – bez `competition_eligible`, które zna tylko serwer: gatunek
 * bez ochrony i nie kępkowy, jeden owocnik, odebrane, rozmiar potwierdzony (`sizeVerified`), kapelusz ≤ 2,5 × typowy,
 * znalezione w bieżącym tygodniu (albo w minionym, do 6 h po jego końcu).
 */
export function contestCheck(
  find: Pick<Find, 'status' | 'sizeVerified' | 'dimensions' | 'foundAt'>,
  species: Pick<Species, 'clustered' | 'protection' | 'typical'> | undefined,
  opts: { now?: number; capFactor?: number; graceH?: number } = {},
): ContestCheck {
  const now = opts.now ?? Date.now();
  const fail = (reason: string, missingScale?: boolean): ContestCheck => ({ ok: false, reason, weekStart: null, missingScale });
  if (!species) return fail(CONTEST_REASONS.unknownSpecies);
  if (species.protection) return fail(CONTEST_REASONS.protected);
  if (species.clustered) return fail(CONTEST_REASONS.clustered);
  if ((find.dimensions.pieces ?? 1) > 1) return fail(CONTEST_REASONS.pieces);
  if (find.status !== 'claimed') return fail(CONTEST_REASONS.unclaimed);
  if (!find.sizeVerified) return fail(CONTEST_REASONS.scale, true);
  if (find.dimensions.capCm > (opts.capFactor ?? FIND_CAP_FACTOR) * species.typical.capCm) return fail(CONTEST_REASONS.tooBig);
  const current = contestWeekStart(now);
  const found = Date.parse(find.foundAt);
  // Zegar telefonu w przyszłości – okaz walczy w bieżącym tygodniu.
  const week = Number.isFinite(found) && found <= now ? contestWeekStart(found) : current;
  if (week !== current && now > Date.parse(contestWeekBounds(week).endsAt) + (opts.graceH ?? RIVALRY_QUEUE_GRACE_H) * H) {
    return fail(CONTEST_REASONS.oldWeek);
  }
  return { ok: true, reason: null, weekStart: week };
}

/** Walki tygodnia, do których pasuje okaz: zawsze „Okaz tygodnia”, walka gatunku – gdy to ten gatunek. */
export function matchingContests(speciesId: string, contests: readonly Contest[]): Contest[] {
  return contests.filter((c) => c.kind === 'relative' || c.speciesId === speciesId);
}

/* ───────────────────────── Formatowanie ───────────────────────── */

const decimal = (x: number) => {
  const r = round1(x);
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
};

/** „18,5 cm”, „12 cm”. */
export const fmtCm = (cm: number) => `${decimal(cm)} cm`;
/** „132%”, „132,4%”. */
export const fmtPct = (pct: number) => `${decimal(pct)}%`;

/** Wynik w walce: cm (gatunek tygodnia) albo % typowego („Okaz tygodnia”). */
export function fmtContestScore(kind: ContestKind, score: number): string {
  return kind === 'species' ? fmtCm(score) : fmtPct(score);
}

/** Pozostały czas: „2 dni 4 h”, „1 dzień”, „5 h 12 min”, „8 min”. */
export function fmtTimeLeft(ms: number): string {
  const left = Math.max(0, ms);
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / H);
  const m = Math.floor((left % H) / MIN);
  if (d >= 1) return `${d} ${plural(d, 'dzień', 'dni', 'dni')}${h ? ` ${h} h` : ''}`;
  if (h >= 1) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${Math.max(1, m)} min`;
}

/** Podpis czasu walki: „do końca 2 dni 4 h”, „wyniki za 1 dzień 3 h”, „wyniki wkrótce”, „wyniki ogłoszone”. */
export function contestCountdown(c: Pick<Contest, 'status' | 'endsAt' | 'resultsAt'>, now: number = Date.now()): string {
  if (c.status === 'final') return 'wyniki ogłoszone';
  const end = Date.parse(c.endsAt);
  const results = Date.parse(c.resultsAt);
  if (now < end) return `do końca ${fmtTimeLeft(end - now)}`;
  return now < results ? `wyniki za ${fmtTimeLeft(results - now)}` : 'wyniki wkrótce';
}

const MONTHS_GEN = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

/** Tydzień walk: „5–11 października”, „28 września – 4 października”. */
export function fmtWeekRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const [, m1, d1] = weekStart.split('-').map(Number);
  const [, m2, d2] = end.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MONTHS_GEN[m2 - 1]}` : `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]}`;
}

/** Kiedy inni zobaczą okaz (czas telefonu): „dziś o 18:30”, „jutro o 10:05”, „12 października o 9:00”. */
export function fmtVisibleFrom(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / DAY);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff <= 0) return `dziś o ${time}`;
  if (diff === 1) return `jutro o ${time}`;
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} o ${time}`;
}

/** Etykiety przełącznika zasięgu – „Woj.”, bo „Województwo” nie mieści się w czterech polach na 375 px (jak w rankingu). */
export const CONTEST_SCOPE_LABEL: Record<ContestScope, string> = {
  gmina: 'Gmina',
  wojewodztwo: 'Woj.',
  polska: 'Polska',
  znajomi: 'Znajomi',
};

/** „w gminie”, „w województwie”, „w Polsce”, „wśród znajomych”. */
export const CONTEST_SCOPE_IN: Record<ContestScope, string> = {
  gmina: 'w gminie',
  wojewodztwo: 'w województwie',
  polska: 'w Polsce',
  znajomi: 'wśród znajomych',
};

/** Najciekawsze miejsce okazu (podium w Polsce > w województwie > w gminie, inaczej województwo): „2. w województwie”. */
export function bestPlace(rank: ContestMatch['projectedRank']): { scope: PublicContestScope; rank: number; text: string } {
  const scope: PublicContestScope =
    rank.polska <= 3 ? 'polska' : rank.wojewodztwo <= 3 ? 'wojewodztwo' : rank.gmina <= 3 ? 'gmina' : 'wojewodztwo';
  return { scope, rank: rank[scope], text: `${rank[scope]}. ${CONTEST_SCOPE_IN[scope]}` };
}

/* ───────────────────────── Zdjęcie okazu ───────────────────────── */

/**
 * Zdjęcie okazu na tablicy: własne – lokalne zdjęcie z telefonu (`localPhotoUri`), potem zdjęcie z danych (mock),
 * a ze serwera – znacznik `sb-photo:` ścieżki w prywatnym `scan-photos` (podpisany adres pobiera useFindPhotoSource,
 * z pamięcią adresów). Brak – kafel ze znakiem grzyba.
 */
export function entryPhotoUri(entry: Pick<ContestEntry, 'photoUri' | 'photoPath'>, localPhotoUri?: string): string | undefined {
  return localPhotoUri ?? entry.photoUri ?? (entry.photoPath ? remotePhotoUri(entry.photoPath) : undefined);
}
