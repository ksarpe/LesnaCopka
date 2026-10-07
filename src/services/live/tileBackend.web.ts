/**
 * Kafle mapy w przeglądarce: IndexedDB `grzyb-tiles` (magazyn `tiles`: klucz „13/x/y” → bajty, `meta`: indeks).
 * localStorage się nie nadaje (limit ~5 MB, tylko tekst). Bez IndexedDB (stare / prywatne przeglądarki) → null,
 * a tileStore zostaje przy pamięci – mapa działa, tylko obszary offline nie przetrwają zamknięcia karty.
 */
import type { TileBackend } from './tileStore';

const DB_NAME = 'grzyb-tiles';
const TILES = 'tiles';
const META = 'meta';

export function openTileBackend(): TileBackend | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = () =>
    (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(TILES)) d.createObjectStore(TILES);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB niedostępne'));
      // Otwarcie nie może zawiesić mapy (np. baza zablokowana przez inną kartę) – wtedy zostaje pamięć.
      setTimeout(() => reject(new Error('IndexedDB: brak odpowiedzi')), 4000);
    }));

  /** Jedna transakcja; wynik ostatniego żądania po jej zakończeniu (zapis jest wtedy trwały). */
  async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const d = await db();
    return new Promise<T | undefined>((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error('IndexedDB: błąd transakcji'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB: transakcja przerwana'));
    });
  }

  const toBytes = (v: unknown): Uint8Array | null =>
    v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;

  return {
    kind: 'indexeddb',
    get: async (key) => toBytes(await tx<unknown>(TILES, 'readonly', (s) => s.get(key))),
    async put(key, bytes) {
      // Kopia dokładnie tych bajtów – widok na większy bufor zapisałby cały bufor.
      const exact = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
      await tx(TILES, 'readwrite', (s) => s.put(exact, key));
    },
    async remove(keys) {
      if (!keys.length) return;
      await tx(TILES, 'readwrite', (s) => {
        for (const k of keys) s.delete(k);
      });
    },
    keys: async () => ((await tx<IDBValidKey[]>(TILES, 'readonly', (s) => s.getAllKeys())) ?? []).map(String),
    size: async (key) => toBytes(await tx<unknown>(TILES, 'readonly', (s) => s.get(key)))?.length ?? null,
    async readIndex() {
      const v = await tx<unknown>(META, 'readonly', (s) => s.get('index'));
      return typeof v === 'string' ? v : null;
    },
    async writeIndex(json) {
      await tx(META, 'readwrite', (s) => s.put(json, 'index'));
    },
  };
}
