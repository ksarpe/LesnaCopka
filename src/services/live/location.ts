/**
 * Prawdziwa lokalizacja: GPS urządzenia (expo-location) + wykrycie gminy na urządzeniu (src/geo).
 * Współrzędne zostają w pamięci – nie są zapisywane ani wysyłane (mapa okolicy pobiera tylko kafle).
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { gminaFromMeta, gminaIndex } from '@/geo';
import { HYSTERESIS_M } from '@/geo/gminaIndex';
import type { TrackPoint } from '@/geo/track';
import type { GeoPosition, Gmina, Region } from '@/types';

import { ServiceError, type PermissionStatus, type Unsubscribe } from '../types';

/** Ostatnia znana pozycja wystarczy, jeśli jest świeża i dokładna – karta pojawia się od razu. */
const LAST_KNOWN_MAX_AGE_MS = 60_000;
const LAST_KNOWN_ACCURACY_M = 100;
const POSITION_TIMEOUT_MS = 12_000;

function toStatus(p: Location.LocationPermissionResponse): PermissionStatus {
  if (p.granted) return 'granted';
  // Android pozwala zapytać ponownie po pierwszej odmowie.
  if (p.status === 'denied') return Platform.OS === 'android' && p.canAskAgain ? 'undetermined' : 'denied';
  return 'undetermined';
}

export const livePermissions = {
  async location(): Promise<PermissionStatus> {
    return toStatus(await Location.getForegroundPermissionsAsync());
  },
  async requestLocation(): Promise<PermissionStatus> {
    return toStatus(await Location.requestForegroundPermissionsAsync());
  },
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ServiceError('TIMEOUT', 'Nie udało się ustalić pozycji')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function toPosition(loc: Location.LocationObject): GeoPosition {
  return {
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    accuracyM: Math.round(loc.coords.accuracy ?? 100),
    at: new Date(loc.timestamp).toISOString(),
  };
}

/** Kod błędu przeglądarkowego Geolocation API (1 = odmowa, 2 = niedostępna, 3 = timeout). */
function geolocationCode(e: unknown): number | undefined {
  const c = (e as { code?: unknown })?.code;
  return typeof c === 'number' ? c : undefined;
}

export async function readDevicePosition(): Promise<GeoPosition> {
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new ServiceError('GPS_OFF', 'Lokalizacja jest wyłączona');
  }
  if ((await livePermissions.location()) !== 'granted') {
    throw new ServiceError('PERMISSION', 'Brak zgody na lokalizację');
  }
  const recent = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracy: LAST_KNOWN_ACCURACY_M,
  }).catch(() => null);
  if (recent) return toPosition(recent);
  try {
    return toPosition(
      await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), POSITION_TIMEOUT_MS),
    );
  } catch (e) {
    if (geolocationCode(e) === 1) throw new ServiceError('PERMISSION', 'Brak zgody na lokalizację');
    // Bez świeżego odczytu – lepsza starsza pozycja niż żadna (np. w gęstym lesie).
    const stale = await Location.getLastKnownPositionAsync().catch(() => null);
    if (stale) return toPosition(stale);
    throw e instanceof ServiceError ? e : new ServiceError('TIMEOUT', 'Nie udało się ustalić pozycji');
  }
}

/** Gmina dla pozycji (offline, granice PRG). `known` – dane gry dla gmin z katalogu. */
export async function regionAt(
  position: GeoPosition,
  opts: { source: Region['source']; previous?: Region | null; known: (id: string) => Gmina | undefined },
): Promise<Region> {
  const index = await gminaIndex();
  const hit = await index.locate(position.lon, position.lat, {
    accuracyM: position.accuracyM,
    previousTeryt: opts.previous?.gmina.teryt ?? null,
  });
  if (!hit) throw new ServiceError('OUT_OF_AREA', 'Ta lokalizacja jest poza Polską');
  return {
    gmina: gminaFromMeta(hit.gmina, opts.known(hit.gmina.id)),
    position,
    nearBorder: !hit.inside || hit.borderM <= Math.max(HYSTERESIS_M, position.accuracyM),
    source: opts.source,
  };
}

/* ───────────────────────── Śledzenie wyprawy ───────────────────────── */

/** Odczyt co ok. 5 m / 4 s – wystarcza do dystansu marszu, a GPS nie pracuje bez przerwy na maks. */
const WATCH_DISTANCE_M = 5;
const WATCH_INTERVAL_MS = 4000;
/**
 * iOS zaczyna obserwację od pozycji z pamięci podręcznej (ze starym znacznikiem czasu). Taki punkt jako
 * pierwszy w filtrze dałby fantomowy dystans (10 km sprzed 2 h = „marsz” 5 km/h) – odrzucamy odczyty
 * starsze niż start obserwacji albo niż 15 s.
 */
const MAX_FIX_AGE_MS = 15_000;

/**
 * Surowe odczyty GPS podczas wyprawy (tylko z aplikacją na pierwszym planie – zgoda „podczas używania”).
 * Filtrowanie szumu i liczenie dystansu: DistanceFilter (src/geo/track.ts). Brak zgody / wyłączony GPS
 * nie przerywa aplikacji – `onError` dostaje błąd, a dystans po prostu przestaje rosnąć.
 */
export function watchDevicePositions(onFix: (p: TrackPoint) => void, onError: (e: ServiceError) => void): Unsubscribe {
  let stopped = false;
  let stop: (() => void) | null = null;
  const startedAt = Date.now();
  const fail = (e: ServiceError) => {
    if (!stopped) onError(e);
  };
  const emit = (lat: number, lon: number, accuracy: number | null | undefined, t: number) => {
    if (stopped) return;
    if (t < startedAt - 1000 || Date.now() - t > MAX_FIX_AGE_MS) return;
    onFix({ lat, lon, accuracyM: accuracy ?? Infinity, t });
  };

  (async () => {
    if (!(await Location.hasServicesEnabledAsync())) throw new ServiceError('GPS_OFF', 'Lokalizacja jest wyłączona');
    if ((await livePermissions.location()) !== 'granted') throw new ServiceError('PERMISSION', 'Brak zgody na lokalizację');
    if (stopped) return;
    if (Platform.OS === 'web') {
      // Web: bezpośrednio Geolocation API – expo-location na webie gubi identyfikator obserwacji
      // i nie przekazuje błędów ani `enableHighAccuracy` do watchPosition.
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
      if (!geo) throw new ServiceError('GPS_OFF', 'Przeglądarka nie udostępnia lokalizacji');
      const id = geo.watchPosition(
        (pos) => emit(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.timestamp || Date.now()),
        (err) => {
          // 1 = odmowa; 2 (brak sygnału) i 3 (timeout) są chwilowe – obserwacja trwa dalej.
          if (err.code === 1) {
            geo.clearWatch(id);
            fail(new ServiceError('PERMISSION', 'Brak zgody na lokalizację'));
          }
        },
        { enableHighAccuracy: true, maximumAge: 3000 },
      );
      stop = () => geo.clearWatch(id);
      return;
    }
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: WATCH_DISTANCE_M, timeInterval: WATCH_INTERVAL_MS },
      (loc) => emit(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy, loc.timestamp),
      (reason) => fail(new ServiceError('GPS_OFF', String(reason))),
    );
    if (stopped) sub.remove();
    else stop = () => sub.remove();
  })().catch((e: unknown) => {
    if (geolocationCode(e) === 1) fail(new ServiceError('PERMISSION', 'Brak zgody na lokalizację'));
    else fail(e instanceof ServiceError ? e : new ServiceError('GPS_OFF', 'Nie udało się uruchomić GPS'));
  });

  return () => {
    stopped = true;
    stop?.();
    stop = null;
  };
}
