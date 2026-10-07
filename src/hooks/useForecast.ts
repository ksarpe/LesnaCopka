import { gminaIndex } from '@/geo';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import { weatherCell } from '@/utils/forecast';

/**
 * Prognoza grzybowa dla punktu. Klucz to kratka 0,1° (tyle trafia do API pogodowego), więc drobne ruchy GPS
 * nie pobierają prognozy od nowa. `gminaId` – tylko dla symulacji (prognoza gminy z panelu dev / makiety).
 */
export function useForecast(point: { lat: number; lon: number } | null | undefined, gminaId?: string) {
  const { weather } = useServices();
  const net = useSimStore((s) => s.networkEnabled);
  const source = useSimStore((s) => s.locationSource);
  const cell = point ? weatherCell(point.lat, point.lon) : null;
  return useAsync(
    () => (cell ? weather.getForecast({ lat: cell.lat, lon: cell.lon, gminaId }) : Promise.resolve(undefined)),
    [weather, cell?.key, gminaId, net, source],
  );
}

/** Prognoza dla gminy – punkt wewnątrz jej granic z indeksu PRG (ekran szczegółów gminy). */
export function useGminaForecast(gminaId: string) {
  const inner = useAsync(async () => (await gminaIndex()).byId.get(gminaId)?.inner ?? null, [gminaId]);
  const point = inner.data ? { lon: inner.data[0], lat: inner.data[1] } : null;
  const forecast = useForecast(point, gminaId);
  return { ...forecast, loading: inner.loading || forecast.loading };
}
