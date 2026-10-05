import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useSimStore } from '@/store/useSimStore';
import type { Region } from '@/types';

/** Promień pobieranej mapy okolicy (m) – karta ma ok. 3,2 × 1,4 km; las szukamy w tym zasięgu. */
export const AREA_RADIUS_M = 1600;

/** Mapa okolicy dla regionu. Środek zaokrąglony do ~10 m, żeby drobne wahania GPS nie pobierały mapy od nowa. */
export function useAreaMap(region: Region | null) {
  const { map } = useServices();
  const net = useSimStore((s) => s.networkEnabled);
  const lat = region ? Math.round(region.position.lat * 1e4) / 1e4 : null;
  const lon = region ? Math.round(region.position.lon * 1e4) / 1e4 : null;
  const teryt = region?.gmina.teryt;
  return useAsync(
    () =>
      lat == null || lon == null
        ? Promise.resolve(undefined)
        : map.getAreaMap({ lat, lon, radiusM: AREA_RADIUS_M, gminaTeryt: teryt }),
    [map, lat, lon, teryt, net],
  );
}
