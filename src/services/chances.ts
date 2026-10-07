/**
 * Wspólne dla mocków i Supabase przy `StatsService.getSpeciesChances`: serwisy dostarczają tylko zbiory gminy
 * (GminaSpeciesEvidence), a szanse liczy ten sam model w telefonie (src/utils/chances.ts) – z katalogu gatunków,
 * lesistości gminy (indeks PRG) i prognozy grzybowej podanej przez ekran.
 */
import { SPECIES } from '@/data/mock/species';
import { gminaIndex } from '@/geo';
import { useCatalogStore } from '@/store/useCatalogStore';
import type { ChanceHorizon, GminaChances, GminaSpeciesEvidence, Species } from '@/types';
import { computeChances, type ChanceForecast } from '@/utils/chances';
import { localYmd } from '@/utils/forecast';

/** Katalog gatunków (z CatalogService); przed załadowaniem – katalog z aplikacji. */
export function chanceSpecies(): Species[] {
  const s = useCatalogStore.getState().species;
  return s.length ? s : SPECIES;
}

/** Lesistość gminy: z katalogu (gmina wykryta / z serwera), inaczej z indeksu PRG; brak → null (model przyjmie 30%). */
export async function gminaForestPct(gminaId: string): Promise<number | null> {
  const known = useCatalogStore.getState().gminaById[gminaId]?.forestPct;
  if (known != null) return known;
  try {
    return (await gminaIndex()).byId.get(gminaId)?.forestPct ?? null;
  } catch {
    return null;
  }
}

export interface ChanceOptions {
  forecast?: ChanceForecast | null;
  horizon?: ChanceHorizon;
}

/** Szanse gminy z danych serwisu (zbiory z 14 dni) – model wspólny dla obu trybów. */
export async function buildChances(
  gminaId: string,
  evidence: GminaSpeciesEvidence | null,
  date: string | undefined,
  opts: ChanceOptions | undefined,
): Promise<GminaChances> {
  return computeChances({
    gminaId,
    species: chanceSpecies(),
    forestPct: await gminaForestPct(gminaId),
    evidence,
    date: date ?? localYmd(),
    forecast: opts?.forecast ? { score: opts.forecast.score, daysAfterRain: opts.forecast.daysAfterRain } : null,
    horizon: opts?.horizon ?? 'day',
  });
}
