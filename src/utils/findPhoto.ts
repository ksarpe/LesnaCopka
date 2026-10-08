/**
 * Zdjęcia znalezisk – czyste funkcje (ścieżki plików, limit miejsca na webie, wybór zdjęcia gatunku).
 * Zapis i usuwanie plików: src/services/live/findPhotos.ts, zdjęcie z aparatu: src/services/live/camera.ts.
 */
import type { Find } from '@/types';

/** Podkatalog katalogu dokumentów aplikacji (iOS/Android) – zdjęcia przetrwają restart. */
export const PHOTO_DIR = 'finds';

/**
 * Bieżąca ścieżka pliku zdjęcia. Na iOS ścieżka kontenera aplikacji zmienia się np. po aktualizacji
 * (także Expo Go), więc plik `…/finds/<nazwa>` szukamy zawsze w aktualnym katalogu dokumentów.
 * Inne URI (data:, blob:, https:) zostają bez zmian.
 */
export function rerootPhotoUri(uri: string, documentUri: string): string {
  if (!uri.startsWith('file:') || !documentUri) return uri;
  const marker = `/${PHOTO_DIR}/`;
  const i = uri.lastIndexOf(marker);
  if (i < 0) return uri;
  const base = documentUri.endsWith('/') ? documentUri : `${documentUri}/`;
  return `${base}${PHOTO_DIR}/${uri.slice(i + marker.length)}`;
}

export const isDataUri = (uri?: string): uri is string => !!uri && uri.startsWith('data:');

/** Web: łączny limit zdjęć (data URI) zapisywanych w localStorage – ok. 30 zdjęć po ~40 KB. */
export const WEB_PHOTO_BUDGET = 1_200_000;

/** Web: maks. długość data URI jednego zdjęcia w localStorage (~120 KB) – aparat zmniejsza zdjęcie, aż się zmieści. */
export const WEB_PHOTO_MAX_CHARS = 120_000;

/* ───────────────────────── Zdjęcie na serwerze (tryb Supabase, web) ───────────────────────── */

/**
 * Web: zdjęcie znaleziska z serwera (`Find.photoPath` w prywatnym koszyku `scan-photos`), które nie zmieściło się
 * w budżecie localStorage, zostaje w `Find.photoUri` jako znacznik `sb-photo:<ścieżka>` – ekran zamienia go
 * na podpisany adres (src/hooks/useFindPhotoSource.ts). Telefon pobiera zdjęcia do plików, bez znaczników.
 */
export const REMOTE_PHOTO_PREFIX = 'sb-photo:';

export const remotePhotoUri = (path: string) => `${REMOTE_PHOTO_PREFIX}${path}`;

/** Ścieżka zdjęcia na serwerze ze znacznika; zwykły URI (plik, data:, blob:) → null. */
export function remotePhotoPath(uri?: string | null): string | null {
  return uri && uri.startsWith(REMOTE_PHOTO_PREFIX) ? uri.slice(REMOTE_PHOTO_PREFIX.length) || null : null;
}

export const isRemotePhoto = (uri?: string | null): boolean => remotePhotoPath(uri) != null;

/**
 * Web: gdy zdjęcia zapisane jako data URI przekraczają budżet, zdejmuje je z najstarszych znalezisk.
 * Zdjęcie, które jest też na serwerze (`photoPath`), zostaje znacznikiem `sb-photo:` (wczyta się z sieci),
 * pozostałe wracają do paskowanego placeholdera. Zwraca nową mapę albo null, gdy nic nie trzeba zmieniać.
 */
export function trimPhotoBudget(finds: Record<string, Find>, budget = WEB_PHOTO_BUDGET): Record<string, Find> | null {
  const withPhoto = Object.values(finds)
    .filter((f) => isDataUri(f.photoUri))
    .sort((a, b) => b.foundAt.localeCompare(a.foundAt));
  let total = 0;
  let out: Record<string, Find> | null = null;
  for (const f of withPhoto) {
    total += f.photoUri?.length ?? 0;
    if (total <= budget) continue;
    out ??= { ...finds };
    const { photoUri: _dropped, ...rest } = f;
    out[f.id] = f.photoPath ? { ...rest, photoUri: remotePhotoUri(f.photoPath) } : rest;
  }
  return out;
}

/** Długość data URI JPEG-a o `bytes` bajtach (budżet localStorage na webie). */
export const jpegDataUriLength = (bytes: number) => 'data:image/jpeg;base64,'.length + Math.ceil(bytes / 3) * 4;

/** Suma długości zdjęć zapisanych jako data URI (web). */
export function dataUriTotal(finds: Record<string, Find>): number {
  return Object.values(finds).reduce((s, f) => s + (isDataUri(f.photoUri) ? f.photoUri.length : 0), 0);
}

/** Najnowsze zdjęcie gracza danego gatunku (karta gatunku w atlasie); tylko odebrane znaleziska. */
export function latestSpeciesPhoto(finds: Record<string, Find>, speciesId: string): string | undefined {
  let best: Find | undefined;
  for (const f of Object.values(finds)) {
    if (f.speciesId !== speciesId || f.status !== 'claimed' || !f.photoUri) continue;
    if (!best || f.foundAt > best.foundAt) best = f;
  }
  return best?.photoUri;
}

/** Najnowsze zdjęcie każdego gatunku naraz (siatka atlasu) – te same zasady co `latestSpeciesPhoto`, jedno przejście. */
export function latestSpeciesPhotos(finds: Record<string, Find>): Record<string, string> {
  const best: Record<string, Find> = {};
  for (const f of Object.values(finds)) {
    if (f.status !== 'claimed' || !f.photoUri) continue;
    const cur = best[f.speciesId];
    if (!cur || f.foundAt > cur.foundAt) best[f.speciesId] = f;
  }
  const out: Record<string, string> = {};
  for (const id in best) out[id] = best[id].photoUri!;
  return out;
}
