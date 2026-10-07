import { DESIGN_VOIVODESHIP } from '@/geo/voivodeships';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useUserStore } from '@/store/useUserStore';
import { useVoivodeshipStore } from '@/store/useVoivodeshipStore';
import { useRegionStore } from './useRegion';

/**
 * Województwo ekranu Gminy: wybrane ręcznie, inaczej województwo wykrytej gminy, potem gminy
 * domowej, a w ostateczności podlaskie (heatmapa z makiety).
 */
export function useVoivodeship() {
  const picked = useVoivodeshipStore((s) => s.picked);
  const detected = useRegionStore((s) => s.region?.gmina.voivodeship) || null;
  const home = useUserStore((s) => s.user.homeGminaId);
  const homeVoivodeship = useCatalogStore((s) => s.gminaById[home]?.voivodeship) || null;
  return { voivodeship: picked ?? detected ?? homeVoivodeship ?? DESIGN_VOIVODESHIP, picked, detected };
}
