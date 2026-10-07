/**
 * Web, tryb Supabase: zdjęcia znalezisk ze znacznikiem `sb-photo:<ścieżka>` (z serwera, poza budżetem localStorage)
 * → podpisane adresy z prywatnego koszyka `scan-photos`. Adresy żyją tylko w pamięci (godzinę), proszone zbiorczo
 * (jedno zapytanie na kilka miniatur) i odświeżane przed wygaśnięciem. Ekrany: src/hooks/useFindPhotoSource.ts.
 */
import { create } from 'zustand';

import { supabase } from './client';
import { createStorageApi, type StorageApi } from './storage';
import { BUCKETS, SIGNED_URL_TTL_S } from './storagePaths';

export interface RemotePhotoUrl {
  url: string;
  /** Epoch ms. */
  expiresAt: number;
}

export const useRemotePhotoUrls = create<{ urls: Record<string, RemotePhotoUrl> }>()(() => ({ urls: {} }));

/** Odświeżamy adres, gdy zostało mniej niż tyle ważności. */
export const REFRESH_BEFORE_MS = 5 * 60_000;
/** Po błędzie sieci – kolejna próba najwcześniej po tylu ms; brak obiektu na serwerze – dłużej. */
const RETRY_NETWORK_MS = 30_000;
const RETRY_MISSING_MS = 60_000;
const BATCH_MS = 50;

let api: StorageApi | null = null;
const storage = () => (api ??= createStorageApi(supabase!));

const wanted = new Set<string>();
const retryAfter = new Map<string, number>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/** Czy adres trzeba (ponownie) pobrać. */
export function needsRefresh(entry: RemotePhotoUrl | undefined, now = Date.now()): boolean {
  return !entry || entry.expiresAt - now <= REFRESH_BEFORE_MS;
}

/** Prośba o podpisany adres zdjęcia (zbiorczo, bez duplikatów; świeży adres – nic). */
export function requestRemotePhoto(path: string) {
  if (!supabase || !path) return;
  const now = Date.now();
  if (!needsRefresh(useRemotePhotoUrls.getState().urls[path], now)) return;
  if ((retryAfter.get(path) ?? 0) > now) return;
  wanted.add(path);
  batchTimer ??= setTimeout(() => void flush(), BATCH_MS);
}

async function flush() {
  batchTimer = null;
  const paths = [...wanted];
  wanted.clear();
  if (!paths.length) return;
  const { urls, missing, error } = await storage().signedUrls(BUCKETS.finds, paths, SIGNED_URL_TTL_S);
  const now = Date.now();
  if (error) {
    paths.forEach((p) => retryAfter.set(p, now + RETRY_NETWORK_MS));
    return;
  }
  missing.forEach((p) => retryAfter.set(p, now + RETRY_MISSING_MS));
  const fresh = Object.fromEntries(
    Object.entries(urls).map(([p, url]) => [p, { url, expiresAt: now + SIGNED_URL_TTL_S * 1000 }] as const),
  );
  if (Object.keys(fresh).length) useRemotePhotoUrls.setState((s) => ({ urls: { ...s.urls, ...fresh } }));
}

/** Testy / nowe konto: adresy innego gracza nie są już ważne. */
export function clearRemotePhotoUrls() {
  wanted.clear();
  retryAfter.clear();
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = null;
  useRemotePhotoUrls.setState({ urls: {} });
}
