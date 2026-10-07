import { colors } from '@/theme/tokens';
import { fmtDistanceM } from '@/utils/format';
import { Pill } from './Pill';

export interface ForestInfo {
  /** Odległość do najbliższego lasu (m): 0 = w lesie, null = brak lasu w zasięgu. */
  distanceM: number | null;
  /** Zasięg przeszukanych danych (m) – przy mapie offline z brakami: do najbliższego brakującego kafla. */
  radiusM: number;
}

/** Poniżej tego zasięgu (mapa offline z brakami) pigułki „Brak lasu w promieniu…” nie pokazujemy. */
const MIN_SEARCH_M = 300;

/** „Jesteś w lesie” / „Las 400 m stąd” – odległość liczona z mapy okolicy (lasy z OSM). */
export function ForestPill({ info, loading }: { info?: ForestInfo; loading: boolean }) {
  if (!info) {
    return loading ? <Pill label="Szukam lasu…" icon="forest" bg={colors.chip} color={colors.muted} /> : null;
  }
  const d = info.distanceM;
  if (d === 0) return <Pill label="Jesteś w lesie" icon="forest" iconFilled />;
  if (d != null) return <Pill label={`Las ${fmtDistanceM(d)} stąd`} icon="forest" />;
  // Mapa offline z brakami tuż obok – „brak lasu w promieniu 50 m” nic by nie mówił.
  if (info.radiusM < MIN_SEARCH_M) return null;
  return (
    <Pill
      label={`Brak lasu w promieniu ${fmtDistanceM(info.radiusM)}`}
      icon="forest"
      bg={colors.chip}
      color={colors.muted}
    />
  );
}
