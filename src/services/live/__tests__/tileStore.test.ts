import { describe, expect, it, jest } from '@jest/globals';

import { createTileStore, memoryTileBackend, type TileBackend } from '../tileStore';

// Magazyn natywny (expo-file-system) zastępuje pamięć (jest.mock jest wynoszony przed importy) – testujemy logikę
// indeksu, LRU i uzgadniania z dyskiem.
jest.mock('../tileBackend', () => ({ openTileBackend: () => null }));

const bytes = (n: number) => new Uint8Array(n).fill(7);

function setup(over: { backend?: TileBackend; cap?: number; pinned?: ReadonlySet<string> | null } = {}) {
  let t = Date.UTC(2026, 9, 7, 8);
  const backend = over.backend ?? memoryTileBackend();
  const store = createTileStore({ open: () => backend, capBytes: over.cap ?? 1000, now: () => t, delayMs: 5 });
  store.setPinnedSource(() => (over.pinned === undefined ? new Set<string>() : over.pinned));
  return { store, backend, tick: (ms: number) => (t += ms), now: () => t };
}

describe('tileStore', () => {
  it('zapis, odczyt i rozmiary', async () => {
    const { store } = setup();
    await store.write('13/1/1', bytes(100));
    await store.write('13/1/2', bytes(0)); // pusty kafel (204) też jest zapisany
    expect(store.has('13/1/1')).toBe(true);
    expect(store.has('13/1/2')).toBe(true);
    expect((await store.read('13/1/1'))?.length).toBe(100);
    expect((await store.read('13/1/2'))?.length).toBe(0);
    expect(await store.read('13/9/9')).toBeNull();
    expect(store.bytesOf(['13/1/1', '13/1/2', '13/9/9'])).toBe(100);
    await store.flush();
  });

  it('indeks przetrwa restart (ten sam dysk, nowy proces)', async () => {
    const backend = memoryTileBackend();
    const a = setup({ backend });
    await a.store.write('13/1/1', bytes(100));
    a.tick(60_000);
    await a.store.read('13/1/1');
    await a.store.flush();
    const json = JSON.parse((await backend.readIndex())!);
    expect(json.v).toBe(1);
    expect(json.e['13/1/1'][0]).toBe(100);

    const b = setup({ backend });
    await b.store.ready();
    expect(b.store.has('13/1/1')).toBe(true);
    expect(b.store.usage()).toEqual({ pinnedBytes: 0, pinnedTiles: 0, cacheBytes: 100, cacheTiles: 1 });
  });

  it('uzgadnia indeks z dyskiem: plik bez wpisu dochodzi, wpis bez pliku znika', async () => {
    const backend = memoryTileBackend();
    await backend.put('13/5/5', bytes(40)); // np. zapis tuż przed zamknięciem aplikacji
    await backend.writeIndex(JSON.stringify({ v: 1, e: { '13/6/6': [30, 1, 1] } })); // plik usunięty poza aplikacją
    const { store } = setup({ backend });
    await store.ready();
    expect(store.has('13/5/5')).toBe(true);
    expect(store.has('13/6/6')).toBe(false);
    expect(store.bytesOf(['13/5/5'])).toBe(40);
    // Plik o nieznanej dacie zapisu – przy zasięgu odświeżymy.
    expect(store.isStale('13/5/5')).toBe(true);
  });

  it('LRU: ponad limit wypadają najdawniej używane kafle, przypięte zostają', async () => {
    const pinned = new Set(['13/0/0']);
    const { store, tick } = setup({ cap: 250, pinned });
    await store.write('13/0/0', bytes(500)); // obszar offline – nie liczy się do limitu
    tick(10);
    await store.write('13/1/1', bytes(100));
    tick(10);
    await store.write('13/1/2', bytes(100));
    tick(10);
    await store.read('13/1/1'); // świeżo użyty
    tick(10);
    await store.write('13/1/3', bytes(100));
    await store.flush();
    expect(store.has('13/0/0')).toBe(true);
    expect(store.has('13/1/1')).toBe(true);
    expect(store.has('13/1/2')).toBe(false);
    expect(store.has('13/1/3')).toBe(true);
    expect(store.usage()).toEqual({ pinnedBytes: 500, pinnedTiles: 1, cacheBytes: 200, cacheTiles: 2 });
  });

  it('bez wiedzy o przypiętych (obszary niewczytane) LRU nic nie usuwa', async () => {
    const { store } = setup({ cap: 50, pinned: null });
    await store.write('13/1/1', bytes(100));
    await store.write('13/1/2', bytes(100));
    await store.flush();
    expect(store.has('13/1/1')).toBe(true);
    expect(store.has('13/1/2')).toBe(true);
    expect(await store.clearCache()).toBe(0);
  });

  it('wyczyść pamięć podręczną: usuwa tylko kafle spoza obszarów', async () => {
    const { store, backend } = setup({ pinned: new Set(['13/0/0']) });
    await store.write('13/0/0', bytes(300));
    await store.write('13/1/1', bytes(100));
    await store.write('13/1/2', bytes(50));
    expect(await store.clearCache()).toBe(150);
    expect(await backend.keys()).toEqual(['13/0/0']);
    expect(store.usage().cacheBytes).toBe(0);
    await store.flush();
  });

  it('stary kafel z pamięci podręcznej do odświeżenia; przypięty – nigdy', async () => {
    const { store, tick } = setup({ pinned: new Set(['13/0/0']) });
    await store.write('13/0/0', bytes(10));
    await store.write('13/1/1', bytes(10));
    expect(store.isStale('13/1/1')).toBe(false);
    tick(31 * 86_400_000);
    expect(store.isStale('13/1/1')).toBe(true);
    expect(store.isStale('13/0/0')).toBe(false);
    await store.flush();
  });

  it('plik zniknął z dysku – odczyt zwraca null i wpis znika', async () => {
    const { store, backend } = setup();
    await store.write('13/1/1', bytes(10));
    await backend.remove(['13/1/1']);
    expect(await store.read('13/1/1')).toBeNull();
    expect(store.has('13/1/1')).toBe(false);
    await store.flush();
  });

  it('niedostępny magazyn (np. IndexedDB w trybie prywatnym) – działa w pamięci', async () => {
    const broken: TileBackend = {
      ...memoryTileBackend(),
      kind: 'indexeddb',
      readIndex: () => Promise.reject(new Error('blocked')),
    };
    const { store } = setup({ backend: broken });
    expect(await store.kind()).toBe('memory');
    await store.write('13/1/1', bytes(10));
    expect((await store.read('13/1/1'))?.length).toBe(10);
    await store.flush();
  });
});
