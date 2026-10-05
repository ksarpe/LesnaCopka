import { useMemo } from 'react';

import { useCatalogStore } from '@/store/useCatalogStore';
import { useUserStore } from '@/store/useUserStore';
import { achievementSummary, evaluateAchievements } from '@/utils/achievements';

/** Postęp wszystkich osiągnięć liczony na bieżąco z atlasu i liczników gracza. */
export function useAchievements() {
  const atlas = useUserStore((s) => s.atlas);
  const counters = useUserStore((s) => s.counters);
  const species = useCatalogStore((s) => s.species);
  return useMemo(() => {
    const states = evaluateAchievements({ atlas, species, counters });
    return { states, summary: achievementSummary(states) };
  }, [atlas, counters, species]);
}
