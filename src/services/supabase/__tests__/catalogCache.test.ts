/**
 * Słowniki w trybie Supabase: start bez czekania na sieć (katalog z telefonu albo mocki), świeży katalog z serwera
 * w tle – do pamięci telefonu i do useCatalogStore; błąd serwera nie blokuje i pozwala ponowić.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CatalogService } from '@/services/types';
import type { Badge, Quest, Species } from '@/types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const AsyncStorage = require('@react-native-async-storage/async-storage') as { clear: () => Promise<void>; setItem: jest.Mock };
const { CATALOG_CACHE_VERSION, cachedCatalog } = require('../catalogCache') as typeof import('../catalogCache');
const { useBackendStatus } = require('../status') as typeof import('../status');
const { useCatalogStore } = require('@/store/useCatalogStore') as typeof import('@/store/useCatalogStore');
const { STORAGE_KEYS } = require('@/store/storage') as typeof import('@/store/storage');
/* eslint-enable @typescript-eslint/no-require-imports */

const sp = (id: string, name = id) => ({ id, name }) as unknown as Species;
const MOCK = { species: [sp('mock')], badges: [] as Badge[], quests: [] as Quest[] };
const fallback: CatalogService = {
  getSpecies: async () => MOCK.species,
  getBadges: async () => MOCK.badges,
  getDailyQuests: async () => MOCK.quests,
  getGminy: async () => [],
  getTotalSpecies: async () => 120,
};
const SERVER = { species: [sp('borowik', 'Borowik')], badges: [] as Badge[], quests: [] as Quest[] };

/** Odpowiedź serwera na żądanie testu. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ticks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Jak app/_layout.tsx: store wczytany z serwisu (bez czekania na serwer). */
const load = (svc: CatalogService) => useCatalogStore.getState().load(svc);

beforeEach(async () => {
  await AsyncStorage.clear();
  AsyncStorage.setItem.mockClear();
  useCatalogStore.setState({ ready: false, species: [], speciesById: {}, badges: [], badgeById: {}, dailyQuests: [] });
  useBackendStatus.setState({ catalogSource: 'mock', error: null });
});

describe('cachedCatalog', () => {
  it('pierwsze uruchomienie: mocki od razu, katalog z serwera w tle → store i pamięć telefonu', async () => {
    const server = deferred<typeof SERVER>();
    const svc = cachedCatalog(() => server.promise, fallback);
    await load(svc); // serwer jeszcze nie odpowiedział
    expect(useCatalogStore.getState()).toMatchObject({ ready: true, species: MOCK.species });

    server.resolve(SERVER);
    await ticks();
    expect(useCatalogStore.getState().speciesById.borowik).toMatchObject({ name: 'Borowik' });
    expect(useBackendStatus.getState().catalogSource).toBe('supabase');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.catalog, JSON.stringify({ state: SERVER, version: CATALOG_CACHE_VERSION }));
  });

  it('kolejne uruchomienie: katalog z telefonu od razu; ten sam z serwera – bez zapisu i bez przerysowania', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify({ state: SERVER, version: CATALOG_CACHE_VERSION }));
    AsyncStorage.setItem.mockClear();
    const server = deferred<typeof SERVER>();
    const svc = cachedCatalog(() => server.promise, fallback);
    await load(svc);
    expect(useCatalogStore.getState().species).toEqual(SERVER.species);
    expect(useBackendStatus.getState().catalogSource).toBe('cache');

    const before = useCatalogStore.getState().species;
    server.resolve(JSON.parse(JSON.stringify(SERVER)));
    await ticks();
    expect(useCatalogStore.getState().species).toBe(before);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(useBackendStatus.getState().catalogSource).toBe('supabase');
  });

  it('zapis starszej wersji jest pomijany – start od mocków', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify({ state: SERVER, version: CATALOG_CACHE_VERSION - 1 }));
    const svc = cachedCatalog(() => new Promise(() => {}), fallback);
    await load(svc);
    expect(useCatalogStore.getState().species).toEqual(MOCK.species);
  });

  it('serwer nie odpowiada: start z telefonu, status „cache (fallback)”, ponowienie przez refresh()', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify({ state: SERVER, version: CATALOG_CACHE_VERSION }));
    const newer = { ...SERVER, species: [...SERVER.species, sp('kania', 'Kania')] };
    const fetch = jest
      .fn<() => Promise<typeof SERVER>>()
      .mockRejectedValueOnce(new Error('Brak odpowiedzi serwera (4 s)'))
      .mockResolvedValueOnce(newer);
    const svc = cachedCatalog(fetch, fallback);
    await load(svc);
    await ticks();
    expect(useCatalogStore.getState().species).toEqual(SERVER.species);
    expect(useBackendStatus.getState()).toMatchObject({ catalogSource: 'cache (fallback)', error: 'Brak odpowiedzi serwera (4 s)' });

    await svc.refresh(); // np. connect() po powrocie sieci
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useCatalogStore.getState().speciesById.kania).toMatchObject({ name: 'Kania' });
    await svc.refresh(); // udane pobranie – raz na sesję
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serwer odpowiada przed wczytaniem store’u – store dostaje świeży katalog', async () => {
    const svc = cachedCatalog(async () => SERVER, fallback);
    await svc.refresh();
    await load(svc);
    await ticks();
    expect(useCatalogStore.getState().species).toEqual(SERVER.species);
  });
});
