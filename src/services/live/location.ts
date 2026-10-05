/**
 * Prawdziwa lokalizacja: GPS urządzenia (expo-location) + wykrycie gminy na urządzeniu (src/geo).
 * Współrzędne zostają w pamięci – nie są zapisywane ani wysyłane (mapa okolicy pobiera tylko kafle).
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { gminaFromMeta, gminaIndex } from '@/geo';
import { HYSTERESIS_M } from '@/geo/gminaIndex';
import type { GeoPosition, Gmina, Region } from '@/types';

import { ServiceError, type PermissionStatus } from '../types';

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
