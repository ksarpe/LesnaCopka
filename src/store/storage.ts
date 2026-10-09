import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createJSONStorage, type PersistStorage } from 'zustand/middleware';

/** Wspólny storage dla zustand persist (AsyncStorage; na webie – localStorage). */
export const persistStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  user: 'grzyb.user.v1',
  trips: 'grzyb.trips.v1',
  sim: 'grzyb.sim.v1',
  mockDb: 'grzyb.mockdb.v1',
  /** „Serwer” mocków pojedynków i widoczności w rankingach (src/services/mock/duelsDb.ts). */
  mockDuels: 'grzyb.mockduels.v1',
  /** „Serwer” mocków walk o okaz – zgłoszone okazy gracza (src/services/mock/contestsDb.ts). */
  mockContests: 'grzyb.contests.v1',
  notifications: 'grzyb.notifications.v1',
  prefs: 'grzyb.prefs.v1',
  voivodeship: 'grzyb.voivodeship.v1',
  /** Kolejka zdarzeń gry do serwera (tylko tryb Supabase). */
  outbox: 'grzyb.outbox.v1',
  /** Obszary map offline (metadane; kafle – src/services/live/tileStore.ts). Nie czyści ich „Wyczyść dane”. */
  offlineMaps: 'grzyb.offlinemaps.v1',
  /** Ostatni katalog z serwera (gatunki, odznaki, zadania) – start bez czekania na sieć (tryb Supabase). */
  catalog: 'grzyb.catalog.v1',
} as const;

/* ───────────────────────── Leniwy zapis (dystans wyprawy) ───────────────────────── */

/** Zapis odłożony przez persistLazily trafia na dysk najpóźniej po tym czasie. */
export const LAZY_PERSIST_MS = 30_000;

let lazyDepth = 0;
const pending = new Map<string, () => Promise<unknown> | unknown>();
const pendingValues = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/**
 * Zmiany stanu w `fn` (np. dystans z GPS co ok. 5 m) zapisują się na dysk leniwie – najpóźniej po LAZY_PERSIST_MS,
 * przy przejściu aplikacji w tło i przy najbliższym zwykłym zapisie tego samego store'u (np. koniec wyprawy,
 * znalezisko, wypłata XP – zapis zawsze bierze cały bieżący stan). Stan w pamięci (UI, zadania, kolejka) zmienia się
 * od razu; po awarii giną najwyżej ostatnie sekundy. Działa tylko dla store'ów z `lazyPersistStorage`.
 */
export function persistLazily<T>(fn: () => T): T {
  lazyDepth += 1;
  try {
    return fn();
  } finally {
    lazyDepth -= 1;
  }
}

/** Zapisuje od razu wszystko, co czeka (tło aplikacji, zamknięcie karty, testy). */
export function flushPersist() {
  if (timer) clearTimeout(timer);
  timer = null;
  const writes = [...pending.values()];
  pending.clear();
  pendingValues.clear();
  // Synchronicznie – przy zamykaniu karty (web, localStorage) zapis musi zdążyć przed jej zniknięciem.
  writes.forEach((w) => {
    try {
      Promise.resolve(w()).catch(() => {});
    } catch {
      // jak zwykły zapis persist – błąd zapisu nie przerywa gry
    }
  });
}

/** Czy jakiś zapis czeka (panel /dev, testy). */
export const persistPending = () => pending.size > 0;

function listenForBackground() {
  if (listening) return;
  listening = true;
  // iOS / Android: aplikacja w tle może zostać zamknięta bez ostrzeżenia – zapisujemy przy każdym wyjściu z pierwszego planu.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') flushPersist();
  });
  // Web: zamknięcie / przeładowanie karty (AppState łapie tylko ukrycie strony).
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('pagehide', flushPersist);
}

/**
 * persistStorage z leniwym zapisem: zwykłe zapisy idą od razu (jak dotąd), zapisy z persistLazily czekają
 * (JSON całego store'u – na webie ze zdjęciami jako data URI – powstaje dopiero przy zapisie).
 */
function lazyStorage<S>(base: PersistStorage<S>): PersistStorage<S> {
  return {
    getItem: (name) => (pendingValues.has(name) ? (pendingValues.get(name) as ReturnType<typeof base.getItem>) : base.getItem(name)),
    setItem: (name, value) => {
      if (lazyDepth > 0) {
        pending.set(name, () => base.setItem(name, value));
        pendingValues.set(name, value);
        listenForBackground();
        timer ??= setTimeout(flushPersist, LAZY_PERSIST_MS);
        return;
      }
      // Zwykły zapis niesie cały bieżący stan – odłożony zapis tego store'u jest już nieaktualny.
      pending.delete(name);
      pendingValues.delete(name);
      return base.setItem(name, value);
    },
    removeItem: (name) => {
      pending.delete(name);
      pendingValues.delete(name);
      return base.removeItem(name);
    },
  };
}

/** Storage store'ów zapisywanych przy każdym odczycie GPS (wyprawy, gracz) – patrz persistLazily. */
export const lazyPersistStorage = persistStorage && lazyStorage(persistStorage);
