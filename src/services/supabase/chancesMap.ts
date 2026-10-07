/**
 * Szanse i mapa gatunku z serwera (RPC `get_gmina_species_evidence`, `get_species_map`) → typy aplikacji. Czyste
 * funkcje (testy: ./__tests__/chancesMap.test.ts), parsowanie obronne jak ./statsMap.ts. Telefon pilnuje też
 * k-anonimowości: gatunek / gmina z mniej niż 2 znalazcami nie trafia do modelu ani na mapę, nawet gdyby serwer
 * (np. starsza wersja funkcji) go zwrócił. Kontrakt: docs/backend.md (etap 8).
 */
import type { GminaSpeciesEvidence, SpeciesMap, SpeciesMapPeriod } from '@/types';

/** Najmniej różnych znalazców gatunku w gminie, by pokazać go w danych (k-anonimowość). */
export const MIN_FINDERS = 2;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const int = (v: unknown, d = 0) => Math.max(0, Math.round(num(v, d)));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Odpowiedź RPC: obiekt, tablica z jednym wierszem albo JSON w tekście. */
const parse = (raw: unknown): Obj => {
  let r = raw;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as unknown;
    } catch {
      return {};
    }
  }
  if (Array.isArray(r)) r = r[0];
  return isObj(r) ? r : {};
};
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/**
 * `get_gmina_species_evidence` → GminaSpeciesEvidence. Gatunki od najczęstszego, tylko z ≥ 2 znalazcami;
 * `total` nie mniejszy niż suma listy. Pusta lista i `total = 0` → brak danych (model liczy z prioru).
 */
export function mapEvidence(raw: unknown, gminaId: string): GminaSpeciesEvidence {
  const o = parse(raw);
  const species = list(o.species)
    .filter((x) => str(x.speciesId))
    .map((x) => ({ speciesId: str(x.speciesId), finds: int(x.finds), finders: int(x.finders) }))
    .filter((x) => x.finds > 0 && x.finders >= MIN_FINDERS)
    .sort((a, b) => b.finds - a.finds || a.speciesId.localeCompare(b.speciesId));
  const listed = species.reduce((a, x) => a + x.finds, 0);
  return {
    gminaId: str(o.gminaId) || gminaId,
    days: Math.max(1, int(o.days, 14)),
    total: Math.max(listed, int(o.total)),
    species,
  };
}

const PERIODS: SpeciesMapPeriod[] = ['week', 'season'];

/** `get_species_map` → SpeciesMap: stopnie 1–4 (inne pominięte), do 5 gmin w „Najczęściej w”, suma znalezisk. */
export function mapSpeciesMap(
  raw: unknown,
  ids: { speciesId: string; voivodeship: string; period: SpeciesMapPeriod },
): SpeciesMap {
  const o = parse(raw);
  const heat: Record<string, number> = {};
  Object.entries(isObj(o.heat) ? o.heat : {}).forEach(([id, v]) => {
    const level = Math.round(num(v));
    if (id && level >= 1) heat[id] = Math.min(4, level);
  });
  const top = list(o.top)
    .filter((x) => str(x.gminaId))
    .map((x) => ({ gminaId: str(x.gminaId), name: str(x.name) || str(x.gminaId), finds: int(x.finds) }))
    .slice(0, 5);
  const period = PERIODS.includes(o.period as SpeciesMapPeriod) ? (o.period as SpeciesMapPeriod) : ids.period;
  return {
    speciesId: str(o.speciesId) || ids.speciesId,
    voivodeship: str(o.voivodeship) || ids.voivodeship,
    period,
    heat,
    top,
    total: Math.max(int(o.total), top.reduce((a, x) => a + x.finds, 0)),
  };
}
