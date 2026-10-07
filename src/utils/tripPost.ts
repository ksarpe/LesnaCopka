/**
 * Własny wpis z wyprawy – wspólny dla mocka feedu i trybu Supabase (wpis „wysyłanie…”, zanim serwer go zwróci).
 * Czyste funkcje: dane wyprawy i znalezisk przychodzą z wywołującego.
 */
import type { Find, PostAuthor, Rarity, Trip, TripPost } from '@/types';

/** Opóźnienie prywatności: inni widzą wpis dopiero po 24 h (serwer: `privacy_delay()`). */
export const PRIVACY_DELAY_MS = 24 * 3600_000;

const RANK: Record<Rarity, number> = { pospolity: 0, rzadki: 1, epicki: 2, legendarny: 3 };

/** Tytuł wpisu (gracz jeszcze go nie edytuje). */
export function tripPostTitle(trip: Pick<Trip, 'distanceKm'>): string {
  return trip.distanceKm >= 5 ? 'Długa wyprawa po Puszczy' : 'Wyprawa po grzyby';
}

/** „410 g” / „2,3 kg”. */
export function fmtHighlightWeight(weightG: number): string {
  return weightG >= 1000 ? `${(weightG / 1000).toFixed(1).replace('.', ',')} kg` : `${weightG} g`;
}

/**
 * Etykieta najlepszego znaleziska na okładce: nazwa bez dopisku w nawiasie + waga
 * („Borowik szlachetny 410 g”); bez wagi – kapelusz („Czubajka kania 31 cm”).
 */
export function highlightText(speciesName: string, weightG?: number | null, capCm?: number | null): string {
  const name = speciesName.split(' (')[0].trim();
  if (weightG && weightG > 0) return `${name} ${fmtHighlightWeight(weightG)}`;
  if (capCm && capCm > 0) return `${name} ${String(capCm).replace('.', ',')} cm`;
  return name;
}

/** Najlepsze znalezisko: najrzadsze, przy remisie – z największym XP. */
export function bestFind(finds: Find[]): Find | undefined {
  return [...finds].sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || (b.xp?.total ?? 0) - (a.xp?.total ?? 0))[0];
}

/** Okładka wpisu: najlepsze znalezisko ze zdjęciem, a gdy go nie ma – pierwsze ze zdjęciem. */
export function coverFind(finds: Find[]): Find | undefined {
  const best = bestFind(finds);
  return best?.photoUri ? best : finds.find((f) => f.photoUri);
}

/** Odebrane znaleziska wyprawy (po kolei). */
export function claimedFindsOf(trip: Pick<Trip, 'findIds'>, finds: Record<string, Find | undefined>): Find[] {
  return trip.findIds.map((id) => finds[id]).filter((f): f is Find => !!f && f.status === 'claimed');
}

export interface OwnTripPostInput {
  id: string;
  trip: Trip;
  /** Odebrane znaleziska wyprawy (claimedFindsOf). */
  finds: Find[];
  author: PostAuthor;
  speciesName: (speciesId: string) => string | undefined;
  hideRoute: boolean;
  now: Date;
}

/** Wpis z wyprawy gracza tak, jak wygląda zaraz po publikacji (inni zobaczą go za 24 h). */
export function buildOwnTripPost({ id, trip, finds, author, speciesName, hideRoute, now }: OwnTripPostInput): TripPost {
  const collected = finds.filter((f) => f.collected);
  const best = bestFind(finds);
  const bestName = best ? speciesName(best.speciesId) : undefined;
  return {
    id,
    kind: 'trip',
    mine: true,
    author,
    gminaId: trip.gminaId,
    tripId: trip.id,
    createdAt: trip.endedAt ?? now.toISOString(),
    publishedAt: now.toISOString(),
    // Prywatność: inni zobaczą wpis dopiero po 24 h, nigdy na żywo.
    visibleFrom: new Date(now.getTime() + PRIVACY_DELAY_MS).toISOString(),
    scopes: ['friends', 'gmina'],
    title: tripPostTitle(trip),
    distanceKm: Math.round(trip.distanceKm * 10) / 10,
    durationMin: Math.round(trip.elapsedMs / 60000),
    mushrooms: collected.length,
    species: new Set(collected.map((f) => f.speciesId)).size,
    xp: trip.xp,
    routePrecision: hideRoute ? 'gmina' : 'approximate',
    highlight: best && bestName ? { rarity: best.rarity, text: highlightText(bestName, best.dimensions.weightG) } : undefined,
    // Okładka: najlepsze znalezisko ze zdjęciem (zdjęcie zostaje na telefonie – w API upload przy publikacji).
    coverFindId: coverFind(finds)?.id,
    reactions: 0,
    reacted: false,
    comments: 0,
  };
}
