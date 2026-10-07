import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import type { Region } from '@/types';

/** Promień pobieranej mapy okolicy (m) – karta ma ok. 3,2 × 1,4 km; las szukamy w tym zasięgu. */
export const AREA_RADIUS_M = 1600;
/**
 * Promień mapy pełnoekranowej (m): ekran telefonu przy ~9 m/px to ok. 3,5 × 7,6 km. Na z13 w Polsce
 * to 9–16 kafli (część wspólna z kartą – z pamięci podręcznej kafli).
 */
export const FULL_MAP_RADIUS_M = 4000;

/**
 * Mapa okolicy dla regionu. Środek zaokrąglony do ~10 m, żeby drobne wahania GPS nie pobierały mapy od nowa.
 * `radiusM` – zasięg pobieranych danych (domyślnie karta „Wykryto region”).
 */
export function useAreaMap(region: Region | null, radiusM: number = AREA_RADIUS_M) {
  const { map } = useServices();
  const net = useSimStore((s) => s.networkEnabled);
  const lat = region ? Math.round(region.position.lat * 1e4) / 1e4 : null;
  const lon = region ? Math.round(region.position.lon * 1e4) / 1e4 : null;
  const teryt = region?.gmina.teryt;
  return useAsync(
    () =>
      lat == null || lon == null
        ? Promise.resolve(undefined)
        : map.getAreaMap({ lat, lon, radiusM, gminaTeryt: teryt }),
    [map, lat, lon, teryt, net, radiusM],
  );
}
