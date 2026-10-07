/**
 * Historia wypraw i dziennik znalezisk (app/wyprawy.tsx, app/znaleziska.tsx) – czyste funkcje: grupowanie po miesiącach,
 * sumy sezonu, filtry, wyszukiwanie i sortowanie znalezisk. Dane przychodzą z useTripStore (tryb Supabase: scalone
 * z serwerem), więc telefon może mieć mniej wypraw i grzybów niż liczniki profilu (missingCount).
 */
import type { Edibility, Find, Rarity, Species, Trip } from '@/types';
import { foldPl } from './profile';
import { bestFind, claimedFindsOf } from './tripPost';

const DAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

const MONTHS_TITLE = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

const RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

/** Czas ISO → ms; śmieci → 0 (na koniec listy „od najnowszych”). */
function ms(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Nagłówek miesiąca (czas lokalny): „Październik 2026”. */
export function monthTitle(d: Date): string {
  return `${MONTHS_TITLE[d.getMonth()]} ${d.getFullYear()}`;
}

export interface MonthSection<T> {
  /** „2026-10” – klucz sekcji listy. */
  key: string;
  title: string;
  data: T[];
}

/**
 * Grupy po miesiącach (czas lokalny) w kolejności wejścia – lista posortowana od najnowszych daje sekcje
 * od najnowszego miesiąca. Element bez poprawnej daty trafia do sekcji „Bez daty”.
 */
export function groupByMonth<T>(items: readonly T[], dateOf: (item: T) => string): MonthSection<T>[] {
  const out: MonthSection<T>[] = [];
  const byKey = new Map<string, MonthSection<T>>();
  for (const it of items) {
    const t = ms(dateOf(it));
    const d = new Date(t);
    const key = t ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'none';
    let section = byKey.get(key);
    if (!section) {
      section = { key, title: t ? monthTitle(d) : 'Bez daty', data: [] };
      byKey.set(key, section);
      out.push(section);
    }
    section.data.push(it);
  }
  return out;
}

/* ───────────────────────── Wyprawy ───────────────────────── */

/** Zakończone i opublikowane wyprawy (bez trwającej), od najnowszej. */
export function historyTrips(trips: Record<string, Trip>): Trip[] {
  return Object.values(trips)
    .filter((t) => t.status !== 'active')
    .sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
}

/** Początek i koniec wyprawy (bez `endedAt` – start + czas trwania). */
export function tripRange(trip: Pick<Trip, 'startedAt' | 'endedAt' | 'elapsedMs'>): { start: Date; end: Date } {
  const start = new Date(ms(trip.startedAt));
  const end = trip.endedAt ? new Date(ms(trip.endedAt)) : new Date(start.getTime() + trip.elapsedMs);
  return { start, end };
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Wiersz historii (miesiąc jest w nagłówku sekcji): „Sobota, 4.10 · 07:12–10:24”. */
export function fmtTripDay(start: Date, end: Date): string {
  return `${DAYS[start.getDay()]}, ${start.getDate()}.${String(start.getMonth() + 1).padStart(2, '0')} · ${clock(start)}–${clock(end)}`;
}

/** Sezon wyprawy = rok startu (czas lokalny). */
export const tripSeason = (trip: Pick<Trip, 'startedAt'>): number => new Date(ms(trip.startedAt)).getFullYear();

/** Sezony (lata) z wypraw, od najnowszego. */
export function tripSeasons(trips: readonly Pick<Trip, 'startedAt'>[]): number[] {
  return [...new Set(trips.map(tripSeason))].sort((a, b) => b - a);
}

/** Grzyby z wyprawy: odebrane znaleziska, które trafiły do koszyka (trujące „tylko zdjęcie” się nie liczą). */
export function tripMushrooms(trip: Pick<Trip, 'findIds'>, finds: Record<string, Find | undefined>): number {
  return claimedFindsOf(trip, finds).filter((f) => f.collected).length;
}

/** Wiersz historii: wyprawa + liczba grzybów i najlepsze znalezisko (miniatura). */
export interface TripRow {
  trip: Trip;
  mushrooms: number;
  best?: Find;
}

export function tripRows(trips: readonly Trip[], finds: Record<string, Find | undefined>): TripRow[] {
  return trips.map((trip) => {
    const claimed = claimedFindsOf(trip, finds);
    return { trip, mushrooms: claimed.filter((f) => f.collected).length, best: bestFind(claimed) };
  });
}

export interface TripTotals {
  trips: number;
  km: number;
  mushrooms: number;
  xp: number;
}

export function tripTotals(rows: readonly Pick<TripRow, 'trip' | 'mushrooms'>[]): TripTotals {
  return rows.reduce<TripTotals>(
    (s, r) => ({ trips: s.trips + 1, km: s.km + r.trip.distanceKm, mushrooms: s.mushrooms + r.mushrooms, xp: s.xp + r.trip.xp }),
    { trips: 0, km: 0, mushrooms: 0, xp: 0 },
  );
}

/**
 * Ile wypraw / grzybów z licznika profilu nie ma w telefonie (gracz demo, starsze wyprawy spoza okna serwera,
 * nowe urządzenie) – stopka „Starsze … nie są dostępne na tym urządzeniu”.
 */
export function missingCount(profileCount: number, localCount: number): number {
  return Math.max(0, Math.round(profileCount) - localCount);
}

/* ───────────────────────── Znaleziska ───────────────────────── */

export type FindFilter = 'all' | 'edible' | 'rare' | 'poison';
export type FindSort = 'newest' | 'biggest' | 'rarest';

export const FIND_FILTERS: { value: FindFilter; label: string }[] = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'edible', label: 'Jadalne' },
  { value: 'rare', label: 'Rzadkie+' },
  { value: 'poison', label: 'Trujące' },
];

export const FIND_SORTS: { value: FindSort; label: string }[] = [
  { value: 'newest', label: 'Najnowsze' },
  { value: 'biggest', label: 'Największe' },
  { value: 'rarest', label: 'Najrzadsze' },
];

export const isPoisonousEdibility = (e: Edibility | undefined) => e === 'trujacy' || e === 'smiertelny';

/** Odebrane znaleziska (bez czekających na Analizie), od najnowszego. */
export function claimedFinds(finds: Record<string, Find>): Find[] {
  return Object.values(finds)
    .filter((f) => f.status === 'claimed')
    .sort((a, b) => ms(b.foundAt) - ms(a.foundAt));
}

type SpeciesInfo = Pick<Species, 'name' | 'latin' | 'edibility'>;

/**
 * Czy gatunek pasuje do wyszukiwania: każde słowo zapytania w nazwie polskiej albo łacińskiej,
 * bez wielkości liter i polskich znaków („borowik szl” → „Borowik szlachetny”, „zolc” → „Goryczak żółciowy”).
 */
export function matchesSpecies(species: Pick<Species, 'name' | 'latin'> | undefined, query: string): boolean {
  const words = foldPl(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (!species) return false;
  const hay = foldPl(`${species.name} ${species.latin}`);
  return words.every((w) => hay.includes(w));
}

/**
 * Filtr dziennika: jadalne (gatunek jadalny), rzadkie+ (rzadkość od „rzadki”), trujące (trujące i śmiertelne –
 * „tylko zdjęcie”, także znaleziska oznaczone jako nie do koszyka) + wyszukiwanie po nazwie gatunku.
 */
export function filterFinds(
  finds: readonly Find[],
  filter: FindFilter,
  query: string,
  speciesOf: (speciesId: string) => SpeciesInfo | undefined,
): Find[] {
  return finds.filter((f) => {
    const sp = speciesOf(f.speciesId);
    if (filter === 'edible' && sp?.edibility !== 'jadalny') return false;
    if (filter === 'rare' && RANK[f.rarity] < RANK.rzadki) return false;
    if (filter === 'poison' && !(isPoisonousEdibility(sp?.edibility) || !f.collected)) return false;
    return matchesSpecies(sp, query);
  });
}

/** Sortowanie (nowa tablica): najnowsze; największe (waga, potem kapelusz); najrzadsze (rzadkość, potem najnowsze). */
export function sortFinds(finds: readonly Find[], sort: FindSort): Find[] {
  const newest = (a: Find, b: Find) => ms(b.foundAt) - ms(a.foundAt);
  const cmp: Record<FindSort, (a: Find, b: Find) => number> = {
    newest,
    biggest: (a, b) =>
      b.dimensions.weightG - a.dimensions.weightG || b.dimensions.capCm - a.dimensions.capCm || newest(a, b),
    rarest: (a, b) => RANK[b.rarity] - RANK[a.rarity] || newest(a, b),
  };
  return [...finds].sort(cmp[sort]);
}

export interface FindsSummary {
  /** Grzyby w koszyku (jak licznik profilu – bez trujących). */
  mushrooms: number;
  /** Różne gatunki (także trujące – jak atlas). */
  species: number;
  /** Trujące – tylko zdjęcie. */
  photoOnly: number;
  /** Znaleziska według rzadkości (wszystkie odebrane). */
  byRarity: Record<Rarity, number>;
}

export function findsSummary(finds: readonly Find[]): FindsSummary {
  const collected = finds.filter((f) => f.collected).length;
  const byRarity: Record<Rarity, number> = { pospolity: 0, rzadki: 0, epicki: 0, legendarny: 0 };
  finds.forEach((f) => byRarity[f.rarity]++);
  return {
    mushrooms: collected,
    species: new Set(finds.map((f) => f.speciesId)).size,
    photoOnly: finds.length - collected,
    byRarity,
  };
}
