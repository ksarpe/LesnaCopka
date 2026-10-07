/**
 * Pamięć podręczna obietnic z czasem życia (szanse gatunków, mapa gatunku): równoległe wywołania z tym samym kluczem
 * czekają na jedno pobranie, błąd nie zostaje w pamięci (następne wywołanie pobiera od nowa), najstarsze wpisy
 * wypadają powyżej `max`.
 */
export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createTtlCache<T>(ttlMs: number, opts: { max?: number; now?: () => number } = {}): TtlCache<T> {
  const max = opts.max ?? 200;
  const now = opts.now ?? Date.now;
  const map = new Map<string, { at: number; p: Promise<T> }>();
  return {
    get(key, load) {
      const t = now();
      const hit = map.get(key);
      if (hit && t - hit.at >= 0 && t - hit.at < ttlMs) return hit.p;
      const p = load();
      map.delete(key);
      map.set(key, { at: t, p });
      while (map.size > max) map.delete(map.keys().next().value as string);
      p.catch(() => {
        if (map.get(key)?.p === p) map.delete(key);
      });
      return p;
    },
    clear() {
      map.clear();
    },
  };
}

/** Szanse i mapa gatunku: dane z serwera / mocków trzymamy 10 min. */
export const CHANCES_TTL_MS = 10 * 60_000;
