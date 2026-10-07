import { useRef } from 'react';

import { useVoivodeship } from '@/hooks/useVoivodeship';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import type { ChanceHorizon, GminaChances, MushroomForecast, SpeciesMapPeriod } from '@/types';
import { localYmd } from '@/utils/forecast';
import { useAsync, type AsyncState } from './useAsync';

/**
 * Szanse na gatunki w gminie (StatsService.getSpeciesChances – model src/utils/chances.ts). Czeka na prognozę gminy
 * (`forecast` z useForecast / useGminaForecast), żeby procenty nie przeskakiwały; bez prognozy (offline, błąd) liczy
 * dla typowego dnia sezonu. Zbiory gminy serwis trzyma 10 min – przełączanie „Dziś / Ten tydzień” nie pyta serwera.
 */
export function useSpeciesChances(
  gminaId: string | null | undefined,
  forecast: Pick<AsyncState<MushroomForecast | undefined>, 'data' | 'loading' | 'error'>,
  horizon: ChanceHorizon = 'day',
) {
  const { stats } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  // Katalog gatunków po starcie (tryb Supabase – z bazy) zmienia model.
  const catalog = useCatalogStore((s) => s.species);
  const today = localYmd();
  const f = forecast.loading ? undefined : forecast.error ? null : (forecast.data ?? null);
  const ready = !!gminaId && f !== undefined;
  // Odświeżanie prognozy (np. po powrocie sieci) nie czyści szans – do nowego wyniku zostaje poprzedni.
  const last = useRef<GminaChances | undefined>(undefined);
  const state = useAsync(
    () =>
      ready
        ? stats
            .getSpeciesChances(gminaId!, today, {
              forecast: f ? { score: f.score, daysAfterRain: f.daysAfterRain } : null,
              horizon,
            })
            .then((r) => (last.current = r))
        : Promise.resolve(last.current),
    [stats, gminaId, today, horizon, ready, f?.score, f?.daysAfterRain, network, version, catalog],
  );
  // Inna gmina (np. nowy region) – nie pokazujemy szans poprzedniej.
  const data = state.data && state.data.gminaId === gminaId ? state.data : undefined;
  return { ...state, data, loading: state.loading || !ready };
}

/** Mapa gatunku w bieżącym województwie (ekran Gminy: wybrane / wykryte / domowe). Pamięć 10 min – w serwisie. */
export function useSpeciesMap(speciesId: string, period: SpeciesMapPeriod = 'season') {
  const { stats } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const { voivodeship } = useVoivodeship();
  const state = useAsync(() => stats.getSpeciesMap(speciesId, voivodeship, period), [stats, speciesId, voivodeship, period, network]);
  const data =
    state.data && state.data.speciesId === speciesId && state.data.voivodeship.toLowerCase() === voivodeship.toLowerCase()
      ? state.data
      : undefined;
  return { ...state, data, voivodeship };
}
