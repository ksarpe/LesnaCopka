/**
 * Kafle mapy okolicy na dysku telefonu – mapa działa w lesie bez zasięgu.
 *
 * Jeden magazyn surowych kafli MVT (bajty prosto z serwera), dwa rodzaje kafli:
 *  - **przypięte** – należą do obszaru offline pobranego przez gracza (src/store/useOfflineMapsStore.ts);
 *    nie liczą się do limitu i nie wypadają, znikają dopiero z usunięciem obszaru,
 *  - **pamięć podręczna** – zapisane przy okazji oglądania mapy; najdawniej używane wypadają po przekroczeniu
 *    CACHE_CAP_BYTES (LRU), „Wyczyść pamięć podręczną map” usuwa je wszystkie.
 * Który kafel jest przypięty, mówi store obszarów (setPinnedSource) – tu jest tylko indeks: rozmiar, ostatnie
 * użycie i data zapisu każdego kafla.
 *
 * Gdzie: iOS / Android – `dokumenty/tiles/13/x/y.pbf` + `dokumenty/tiles/index.json` (src/services/live/tileBackend.ts);
 * web – IndexedDB `grzyb-tiles` (tileBackend.web.ts); bez IndexedDB (np. tryb prywatny) – tylko pamięć do zamknięcia karty.
 */
import { selectEvictions, type CacheEntry } from '@/geo/tiles';

import { openTileBackend } from './tileBackend';

export interface TileBackend {
  /** file = system plików telefonu, indexeddb = przeglądarka, memory = bez trwałego zapisu. */
  readonly kind: 'file' | 'indexeddb' | 'memory';
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  /** Klucze wszystkich zapisanych kafli (uzgodnienie indeksu z dyskiem przy starcie). */
  keys(): Promise<string[]>;
  /** Rozmiar zapisanego kafla (B) albo null, gdy go nie ma. */
  size(key: string): Promise<number | null>;
  readIndex(): Promise<string | null>;
  writeIndex(json: string): Promise<void>;
}

/** Magazyn w pamięci: testy i web bez IndexedDB. */
export function memoryTileBackend(): TileBackend {
  const tiles = new Map<string, Uint8Array>();
  let index: string | null = null;
  return {
    kind: 'memory',
    get: async (key) => tiles.get(key) ?? null,
    put: async (key, bytes) => void tiles.set(key, bytes),
    remove: async (keys) => keys.forEach((k) => tiles.delete(k)),
    keys: async () => [...tiles.keys()],
    size: async (key) => tiles.get(key)?.length ?? null,
    readIndex: async () => index,
    writeIndex: async (json) => {
      index = json;
    },
  };
}

/** Limit pamięci podręcznej (kafle oglądane, spoza obszarów offline): ok. 1200 kafli lasów i wsi. */
export const CACHE_CAP_BYTES = 30_000_000;
/** Kafel z pamięci podręcznej starszy niż 30 dni: przy zasięgu pobieramy świeży (las wycięty, nowa droga). */
export const CACHE_MAX_AGE_MS = 30 * 86_400_000;

interface Entry {
  bytes: number;
  /** Ostatni odczyt / zapis (ms). */
  usedAt: number;
  /** Zapis z sieci (ms); 0 = nieznany (plik bez wpisu w indeksie). */
  savedAt: number;
}

/** Indeks na dysku: klucz → [bajty, użycie (s), zapis (s)]. */
interface IndexFile {
  v: 1;
  e: Record<string, [number, number, number]>;
}

export interface TileUsage {
  /** Kafle obszarów offline. */
  pinnedBytes: number;
  pinnedTiles: number;
  /** Pamięć podręczna (oglądane kafle). */
  cacheBytes: number;
  cacheTiles: number;
}

export interface TileStoreOptions {
  /** Magazyn (domyślnie: pliki na telefonie / IndexedDB na webie / pamięć). */
  open?: () => TileBackend | null;
  capBytes?: number;
  maxAgeMs?: number;
  now?: () => number;
  /** Opóźnienie zapisu indeksu i sprzątania LRU (ms) – zbiera wiele zapisów kafli w jeden. */
  delayMs?: number;
}

const EMPTY: ReadonlySet<string> = new Set();

export function createTileStore(opts: TileStoreOptions = {}) {
  const capBytes = opts.capBytes ?? CACHE_CAP_BYTES;
  const maxAgeMs = opts.maxAgeMs ?? CACHE_MAX_AGE_MS;
  const now = opts.now ?? Date.now;
  const delayMs = opts.delayMs ?? 1500;

  const entries = new Map<string, Entry>();
  let backend: TileBackend | null = null;
  let readyP: Promise<void> | null = null;
  /**
   * null = nie wiadomo, które kafle są przypięte (store obszarów jeszcze niewczytany / niepodłączony) – wtedy LRU
   * nic nie usuwa, żeby nie skasować kafli obszaru offline.
   */
  let pinnedSource: () => ReadonlySet<string> | null = () => null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let version = 0;
  const listeners = new Set<() => void>();

  const getBackend = () => (backend ??= (opts.open ?? openTileBackend)() ?? memoryTileBackend());
  const emit = () => {
    version++;
    listeners.forEach((l) => l());
  };

  async function init() {
    let b = getBackend();
    let raw: string | null = null;
    try {
      raw = await b.readIndex();
    } catch {
      // np. IndexedDB zablokowane w trybie prywatnym – zostaje pamięć
      backend = b = memoryTileBackend();
    }
    if (raw) {
      try {
        const file = JSON.parse(raw) as IndexFile;
        for (const [k, [bytes, used, saved]] of Object.entries(file.e ?? {})) {
          entries.set(k, { bytes, usedAt: used * 1000, savedAt: saved * 1000 });
        }
      } catch {
        // uszkodzony indeks – odbudujemy z dysku niżej
      }
    }
    // Indeks mógł nie zdążyć się zapisać (aplikacja zamknięta w trakcie) – prawdą jest dysk.
    try {
      const onDisk = new Set(await b.keys());
      for (const k of [...entries.keys()]) if (!onDisk.has(k)) entries.delete(k);
      for (const k of onDisk) {
        if (entries.has(k)) continue;
        const size = await b.size(k).catch(() => null);
        // Plik bez wpisu: najstarszy w LRU, data zapisu nieznana (odświeżymy przy zasięgu).
        if (size != null) entries.set(k, { bytes: size, usedAt: 0, savedAt: 0 });
      }
    } catch {
      // bez listy plików zostaje indeks
    }
    emit();
  }

  /** Indeks wczytany i uzgodniony z dyskiem (raz na uruchomienie). */
  function ready(): Promise<void> {
    return (readyP ??= init());
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  function serialize(): string {
    const e: IndexFile['e'] = {};
    for (const [k, v] of entries) e[k] = [v.bytes, Math.round(v.usedAt / 1000), Math.round(v.savedAt / 1000)];
    return JSON.stringify({ v: 1, e } satisfies IndexFile);
  }

  async function evict() {
    const pinned = pinnedSource();
    if (!pinned) return;
    const list: CacheEntry[] = [];
    for (const [key, e] of entries) list.push({ key, bytes: e.bytes, usedAt: e.usedAt });
    const victims = selectEvictions(list, pinned, capBytes);
    if (victims.length) await removeNow(victims);
  }

  async function removeNow(keys: readonly string[]) {
    if (!keys.length) return;
    await getBackend()
      .remove(keys)
      .catch(() => {});
    for (const k of keys) entries.delete(k);
  }

  /** Sprzątanie LRU i zapis indeksu teraz (normalnie po `delayMs` od ostatniej zmiany). */
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await ready();
    await evict();
    await getBackend()
      .writeIndex(serialize())
      .catch(() => {});
    emit();
  }

  return {
    ready,

    /** Rodzaj magazynu – „memory” znaczy, że mapy offline nie przetrwają zamknięcia (web bez IndexedDB). */
    async kind(): Promise<TileBackend['kind']> {
      await ready();
      return getBackend().kind;
    },

    /** Kafel z dysku albo null. Odczyt odświeża pozycję w LRU. */
    async read(key: string): Promise<Uint8Array | null> {
      await ready();
      const bytes = await getBackend()
        .get(key)
        .catch(() => null);
      const e = entries.get(key);
      if (!bytes) {
        if (e) {
          entries.delete(key);
          schedule();
        }
        return null;
      }
      if (e) e.usedAt = now();
      else entries.set(key, { bytes: bytes.length, usedAt: now(), savedAt: 0 });
      schedule();
      return bytes;
    },

    /** Zapis kafla pobranego z sieci (pamięć podręczna albo obszar offline – decyduje przypięcie). */
    async write(key: string, bytes: Uint8Array): Promise<void> {
      await ready();
      await getBackend().put(key, bytes);
      const t = now();
      entries.set(key, { bytes: bytes.length, usedAt: t, savedAt: t });
      schedule();
    },

    /** Czy kafel jest na dysku (po `ready()`). */
    has(key: string): boolean {
      return entries.has(key);
    },

    /** Kafel z pamięci podręcznej starszy niż limit – przy zasięgu warto pobrać świeży. Przypięte – nigdy. */
    isStale(key: string): boolean {
      const e = entries.get(key);
      if (!e) return false;
      const pinned = pinnedSource();
      return !!pinned && !pinned.has(key) && now() - e.savedAt > maxAgeMs;
    },

    /** Suma rozmiarów zapisanych kafli z listy (B). */
    bytesOf(keys: readonly string[]): number {
      let sum = 0;
      for (const k of keys) sum += entries.get(k)?.bytes ?? 0;
      return sum;
    },

    async remove(keys: readonly string[]): Promise<void> {
      await ready();
      await removeNow(keys);
      schedule();
      emit();
    },

    /** Usuwa całą pamięć podręczną (kafle spoza obszarów offline). Zwraca zwolnione bajty. */
    async clearCache(): Promise<number> {
      await ready();
      const pinned = pinnedSource();
      if (!pinned) return 0;
      const victims: string[] = [];
      let freed = 0;
      for (const [k, e] of entries) {
        if (pinned.has(k)) continue;
        victims.push(k);
        freed += e.bytes;
      }
      await removeNow(victims);
      schedule();
      emit();
      return freed;
    },

    usage(): TileUsage {
      const pinned = pinnedSource() ?? EMPTY;
      const u: TileUsage = { pinnedBytes: 0, pinnedTiles: 0, cacheBytes: 0, cacheTiles: 0 };
      for (const [k, e] of entries) {
        if (pinned.has(k)) {
          u.pinnedBytes += e.bytes;
          u.pinnedTiles++;
        } else {
          u.cacheBytes += e.bytes;
          u.cacheTiles++;
        }
      }
      return u;
    },

    /** Źródło kafli przypiętych (store obszarów offline); null = jeszcze nie wiadomo. */
    setPinnedSource(fn: () => ReadonlySet<string> | null) {
      pinnedSource = fn;
    },

    flush,

    /** Zmiany indeksu (ekran „Mapy offline” – zajęte miejsce). */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
  };
}

export type TileStore = ReturnType<typeof createTileStore>;

/** Magazyn kafli aplikacji (z13 – poziom mapy okolicy). */
export const tileStore: TileStore = createTileStore();
