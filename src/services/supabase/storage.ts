/**
 * Operacje Supabase Storage z limitem czasu: wysłanie zdjęcia (bajty JPEG-a), usuwanie, podpisane adresy, lista
 * folderu. Klient jest wstrzykiwany (`createStorageApi(supabase)`), więc moduł nie zależy od React Native – używa go
 * też skrypt integracyjny w node. Nigdy nie rzuca: błąd wraca jako SyncError (klasyfikacja: ./storagePaths.ts
 * → ./syncRpc.ts – sieć / sesja / chwilowy / trwały).
 *
 * Bajty czyta wywołujący (telefon: expo-file-system `File.bytes()`, web: data URI / blob – src/services/live/photoBytes.ts)
 * dopiero w chwili wysyłki – kolejka trzyma tylko odnośnik do zdjęcia.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { exactBuffer } from '@/utils/bytes';
import { PHOTO_CONTENT_TYPE, SIGNED_URL_TTL_S, storageSyncError, type StorageBucket } from './storagePaths';
import type { SyncError } from './syncRpc';

/** Wysyłka zdjęcia (~60–150 KB) – dłużej niż zwykłe RPC (słaby zasięg w lesie). */
export const UPLOAD_TIMEOUT_MS = 30_000;
export const STORAGE_TIMEOUT_MS = 10_000;

/** Ścieżka obiektu jest stała dla danej treści (nowe zdjęcie = nowa nazwa), więc może leżeć w cache rok. */
const CACHE_CONTROL = '31536000';

export interface SignedUrls {
  /** ścieżka → podpisany adres */
  urls: Record<string, string>;
  /** Ścieżki, których serwer nie podpisał (brak obiektu / brak dostępu). */
  missing: string[];
  error: SyncError | null;
}

export interface StorageApi {
  /** Zdjęcie JPEG pod ścieżkę (upsert – ponowienie nadpisuje ten sam obiekt). */
  upload(bucket: StorageBucket, path: string, bytes: Uint8Array): Promise<SyncError | null>;
  /** Usuwa obiekty (brak obiektu to nie błąd). */
  remove(bucket: StorageBucket, paths: string[]): Promise<SyncError | null>;
  signedUrls(bucket: StorageBucket, paths: string[], ttlS?: number): Promise<SignedUrls>;
  /** Pełne ścieżki plików w folderze (np. `{uid}`) – sprzątanie starych avatarów. */
  list(bucket: StorageBucket, folder: string): Promise<{ paths: string[]; error: SyncError | null }>;
}

type StorageResult<T> = { data: T | null; error: unknown };

/** Operacja Storage z limitem czasu → dane albo SyncError. Nie rzuca. */
async function run<T>(op: () => PromiseLike<StorageResult<T>>, ms: number): Promise<{ data: T | null; error: SyncError | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Brak odpowiedzi serwera (${ms / 1000} s)`)), ms);
    });
    const res = await Promise.race([Promise.resolve(op()), timeout]);
    if (res.error) return { data: null, error: storageSyncError(res.error) };
    return { data: res.data, error: null };
  } catch (e) {
    // Wyjątek poza Storage (fetch, limit czasu) = brak odpowiedzi serwera → ponowienie.
    return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: '', status: 0 } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createStorageApi(client: SupabaseClient): StorageApi {
  const bucketOf = (b: StorageBucket) => client.storage.from(b);
  return {
    async upload(bucket, path, bytes) {
      const r = await run(
        () =>
          bucketOf(bucket).upload(path, exactBuffer(bytes), {
            contentType: PHOTO_CONTENT_TYPE,
            upsert: true,
            cacheControl: CACHE_CONTROL,
          }),
        UPLOAD_TIMEOUT_MS,
      );
      return r.error;
    },

    async remove(bucket, paths) {
      if (!paths.length) return null;
      const r = await run(() => bucketOf(bucket).remove(paths), STORAGE_TIMEOUT_MS);
      return r.error;
    },

    async signedUrls(bucket, paths, ttlS = SIGNED_URL_TTL_S) {
      if (!paths.length) return { urls: {}, missing: [], error: null };
      const r = await run(() => bucketOf(bucket).createSignedUrls(paths, ttlS), STORAGE_TIMEOUT_MS);
      if (r.error) return { urls: {}, missing: [], error: r.error };
      const urls: Record<string, string> = {};
      (r.data ?? []).forEach((d) => {
        if (d.path && d.signedUrl && !d.error) urls[d.path] = d.signedUrl;
      });
      return { urls, missing: paths.filter((p) => !urls[p]), error: null };
    },

    async list(bucket, folder) {
      const r = await run(() => bucketOf(bucket).list(folder, { limit: 100 }), STORAGE_TIMEOUT_MS);
      if (r.error) return { paths: [], error: r.error };
      // Lista zawiera też „foldery” (bez id) – zostawiamy tylko pliki.
      const paths = (r.data ?? []).filter((o) => o.id && o.name).map((o) => `${folder}/${o.name}`);
      return { paths, error: null };
    },
  };
}
