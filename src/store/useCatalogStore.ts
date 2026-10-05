import { create } from 'zustand';

import type { CatalogService } from '@/services/types';
import type { Badge, Gmina, Quest, Species } from '@/types';

interface CatalogState {
  ready: boolean;
  species: Species[];
  speciesById: Record<string, Species>;
  gminy: Gmina[];
  gminaById: Record<string, Gmina>;
  badges: Badge[];
  badgeById: Record<string, Badge>;
  dailyQuests: Quest[];
  totalSpecies: number;
  load: (svc: CatalogService) => Promise<void>;
  /** Dopisuje / uzupełnia gminę wykrytą z GPS (np. spoza danych gry). */
  upsertGmina: (g: Gmina) => void;
}

/** Słowniki (gatunki, gminy, odznaki, zadania) ładowane raz przez CatalogService przy starcie. */
export const useCatalogStore = create<CatalogState>()((set, get) => ({
  ready: false,
  species: [],
  speciesById: {},
  gminy: [],
  gminaById: {},
  badges: [],
  badgeById: {},
  dailyQuests: [],
  totalSpecies: 0,
  load: async (svc) => {
    const [species, gminy, badges, dailyQuests, totalSpecies] = await Promise.all([
      svc.getSpecies(),
      svc.getGminy(),
      svc.getBadges(),
      svc.getDailyQuests(),
      svc.getTotalSpecies(),
    ]);
    set({
      ready: true,
      species,
      speciesById: Object.fromEntries(species.map((s) => [s.id, s])),
      gminy,
      gminaById: Object.fromEntries(gminy.map((g) => [g.id, g])),
      badges,
      badgeById: Object.fromEntries(badges.map((b) => [b.id, b])),
      dailyQuests,
      totalSpecies,
    });
  },
  upsertGmina: (g) => {
    const prev = get().gminaById[g.id];
    if (prev && prev.teryt === g.teryt && prev.forestPct === g.forestPct && prev.powiat === g.powiat) return;
    const merged = { ...prev, ...g };
    const exists = get().gminy.some((x) => x.id === g.id);
    set({
      gminy: exists ? get().gminy.map((x) => (x.id === g.id ? merged : x)) : [...get().gminy, merged],
      gminaById: { ...get().gminaById, [g.id]: merged },
    });
  },
}));

export const catalog = () => useCatalogStore.getState();
