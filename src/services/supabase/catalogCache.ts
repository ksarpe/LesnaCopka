/**
 * Słowniki w trybie Supabase bez czekania na sieć przy starcie: aplikacja rusza od ostatniego katalogu z serwera
 * zapisanego w telefonie, a przy pierwszym uruchomieniu – od katalogu z mocków (to seed bazy, scripts/gen-seed.ts).
 * Świeży katalog pobiera się w tle; jeśli różni się od tego, od którego ruszyliśmy, trafia do pamięci telefonu
 * i do useCatalogStore (ekrany przerysują się same). Gminy – zawsze z `fallback`; liczba gatunków w atlasie = długość
 * katalogu, od którego ruszyliśmy (serwer / pamięć telefonu), a bez niego – z `fallback`.
 */
import type { CatalogService } from '../types';
import { persistStorage, STORAGE_KEYS } from '@/store/storage';
import { useCatalogStore } from '@/store/useCatalogStore';
import type { Badge, Quest, Species } from '@/types';
import { backendStatus } from './status';

export interface CatalogData {
  species: Species[];
  badges: Badge[];
  quests: Quest[];
}

/** Wersja zapisu – zmiana kształtu `CatalogData` (np. nowe pola gatunku) = podbij, stary zapis zostanie pominięty. */
export const CATALOG_CACHE_VERSION = 1;

type Storage = NonNullable<typeof persistStorage>;

async function readCache(storage: Storage | undefined): Promise<CatalogData | null> {
  try {
    const v = await storage?.getItem(STORAGE_KEYS.catalog);
    const s = v?.state as Partial<CatalogData> | undefined;
    if (v?.version !== CATALOG_CACHE_VERSION || !s?.species?.length || !Array.isArray(s.badges) || !Array.isArray(s.quests)) return null;
    return s as CatalogData;
  } catch {
    return null; // uszkodzony zapis – jak pierwsze uruchomienie
  }
}

/** Nowszy katalog do store'u – od razu, a jeśli store jeszcze się nie wczytał, zaraz po jego wczytaniu. */
function applyWhenReady(data: CatalogData) {
  const apply = () => useCatalogStore.getState().applyCatalog({ species: data.species, badges: data.badges, dailyQuests: data.quests });
  if (useCatalogStore.getState().ready) {
    apply();
    return;
  }
  const off = useCatalogStore.subscribe((s) => {
    if (!s.ready) return;
    off();
    apply();
  });
}

export interface CachedCatalog extends CatalogService {
  /** Pobranie z serwera (raz na sesję; po błędzie – ponownie przy kolejnym wywołaniu, np. connect()). */
  refresh: () => Promise<CatalogData | null>;
}

export function cachedCatalog(
  fetchFresh: () => Promise<CatalogData>,
  fallback: CatalogService,
  storage: Storage | undefined = persistStorage,
): CachedCatalog {
  /** Katalog na start: z pamięci telefonu albo null (wtedy mocki). */
  let served: Promise<CatalogData | null> | null = null;
  /** Najnowszy z serwera w tej sesji. */
  let latest: CatalogData | null = null;
  let refreshing: Promise<CatalogData | null> | null = null;

  const refresh = () =>
    (refreshing ??= fetchFresh()
      .then(async (data) => {
        latest = data;
        backendStatus().set({ catalogSource: 'supabase' });
        const cached = await (served ?? readCache(storage));
        if (!cached || JSON.stringify(cached) !== JSON.stringify(data)) {
          Promise.resolve(storage?.setItem(STORAGE_KEYS.catalog, { state: data, version: CATALOG_CACHE_VERSION })).catch(() => {});
          applyWhenReady(data);
        }
        return data;
      })
      .catch(async (e) => {
        refreshing = null;
        const cached = await (served ?? Promise.resolve(null));
        if (!latest) {
          backendStatus().set({
            catalogSource: cached ? 'cache (fallback)' : 'mock (fallback)',
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return null;
      }));

  const start = () => {
    if (!served) {
      served = readCache(storage).then((c) => {
        if (c && !latest) backendStatus().set({ catalogSource: 'cache' });
        return c;
      });
      void refresh();
    }
    return served;
  };

  const current = async () => latest ?? (await start());
  return {
    refresh,
    getSpecies: async () => (await current())?.species ?? fallback.getSpecies(),
    getBadges: async () => (await current())?.badges ?? fallback.getBadges(),
    getDailyQuests: async () => (await current())?.quests ?? fallback.getDailyQuests(),
    getGminy: () => fallback.getGminy(),
    getTotalSpecies: async () => (await current())?.species.length || fallback.getTotalSpecies(),
  };
}
