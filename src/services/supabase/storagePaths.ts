/**
 * Supabase Storage – czysta część (bez React Native): koszyki, ścieżki obiektów, publiczne adresy, limity,
 * klasyfikacja błędów Storage i base64. Testy: ./__tests__/storagePaths.test.ts; skrypt integracyjny (node) też jej używa.
 *
 * Koszyki (kontrakt z docs/backend.md, polityki: pierwszy segment ścieżki = id gracza):
 * - `scan-photos` (prywatny) – zdjęcia znalezisk `{uid}/{findId}.jpg`, odczyt tylko przez podpisany adres;
 * - `post-media` (publiczny) – okładki wpisów `{uid}/{tripId}-{losowe8}.jpg` (adres nie do zgadnięcia);
 * - `avatars` (publiczny) – zdjęcia profilowe `{uid}/avatar-{znacznik czasu}.jpg`.
 * Wszystkie zdjęcia to JPEG-i przekodowane w telefonie (expo-image-manipulator – bez EXIF, bez GPS).
 */
import type { SyncError } from './syncRpc';

export const BUCKETS = {
  /** Prywatny – zdjęcia znalezisk. */
  finds: 'scan-photos',
  /** Publiczny – okładki wpisów w feedzie. */
  posts: 'post-media',
  /** Publiczny – zdjęcia profilowe. */
  avatars: 'avatars',
} as const;

export type StorageBucket = (typeof BUCKETS)[keyof typeof BUCKETS];

const BUCKET_IDS: readonly string[] = Object.values(BUCKETS);
export const isBucket = (v: unknown): v is StorageBucket => typeof v === 'string' && BUCKET_IDS.includes(v);

/** Limity koszyków na serwerze (bajty) – większego pliku nawet nie wysyłamy. */
export const BUCKET_LIMIT_BYTES: Record<StorageBucket, number> = {
  'scan-photos': 2 * 1024 * 1024,
  'post-media': 2 * 1024 * 1024,
  avatars: 512 * 1024,
};

export const PHOTO_CONTENT_TYPE = 'image/jpeg';

/** Ważność podpisanego adresu zdjęcia znaleziska (s) – w pamięci odświeżany przed końcem. */
export const SIGNED_URL_TTL_S = 3600;

/** Zdjęcie znaleziska (prywatne): `{uid}/{findId}.jpg` – jedno na znalezisko, ponowienie nadpisuje. */
export const findPhotoPath = (uid: string, findId: string) => `${uid}/${findId}.jpg`;

/** Okładka wpisu (publiczna): `{uid}/{tripId}-{nonce}.jpg` – nonce (8 znaków hex) sprawia, że adresu nie da się zgadnąć. */
export const coverPhotoPath = (uid: string, tripId: string, nonce: string) => `${uid}/${tripId}-${nonce}.jpg`;

/** Zdjęcie profilowe (publiczne): `{uid}/avatar-{ts}.jpg` – nowy plik przy każdej zmianie (inni nie widzą starego z cache). */
export const avatarPhotoPath = (uid: string, ts: number) => `${uid}/avatar-${Math.round(ts)}.jpg`;

/** 8 znaków hex z identyfikatora (uuid zdarzenia w kolejce) – stałe przy ponowieniach, losowe między wpisami. */
export function nonceFrom(id: string): string {
  const hex = id.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return (hex + '00000000').slice(0, 8);
}

/** Ścieżka w folderze gracza (pierwszy segment = uid) i bez sztuczek (`..`, pusty segment). */
export function isOwnPath(uid: string, path: string): boolean {
  const parts = path.split('/');
  return !!uid && parts.length >= 2 && parts[0] === uid && parts.every((p) => p !== '' && p !== '.' && p !== '..');
}

/** Adres projektu z .env.local (Expo wstawia EXPO_PUBLIC_* przy budowaniu) – ten sam, którego używa klient. */
const ENV_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/** Publiczny adres obiektu: `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>` (segmenty zakodowane). */
export function publicObjectUrl(bucket: StorageBucket, path: string, base = ENV_BASE): string {
  const root = base.replace(/\/+$/, '');
  const encoded = path
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${root}/storage/v1/object/public/${bucket}/${encoded}`;
}

/* ───────────────────────── Ścieżki z serwera ───────────────────────── */

export interface StorageRef {
  bucket: StorageBucket;
  path: string;
}

/**
 * Lista obiektów z serwera do usunięcia. Kontrakt `dev_reset_player().storagePaths`: obiekt
 * `{"scan-photos": [...], "post-media": [...], "avatars": [...]}` – ścieżki bez nazwy koszyka. Obronnie przyjmuje też
 * tablicę: `"<bucket>/<path>"`, `{bucket, path}` albo samą ścieżkę (`{uid}/…` – koszyk zgadujemy z nazwy pliku).
 */
export function parseStorageRefs(raw: unknown): StorageRef[] {
  const out: StorageRef[] = [];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.entries(raw as Record<string, unknown>).forEach(([bucket, paths]) => {
      if (!isBucket(bucket) || !Array.isArray(paths)) return;
      paths.forEach((path) => {
        if (typeof path === 'string' && path) out.push({ bucket, path });
      });
    });
    return out;
  }
  const list = Array.isArray(raw) ? raw : [];
  for (const x of list) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as { bucket?: unknown; bucket_id?: unknown; path?: unknown; name?: unknown };
      const bucket = o.bucket ?? o.bucket_id;
      const path = o.path ?? o.name;
      if (isBucket(bucket) && typeof path === 'string' && path) out.push({ bucket, path });
      continue;
    }
    if (typeof x !== 'string' || !x) continue;
    const i = x.indexOf('/');
    const head = i > 0 ? x.slice(0, i) : '';
    if (isBucket(head)) {
      if (x.length > i + 1) out.push({ bucket: head, path: x.slice(i + 1) });
      continue;
    }
    const name = x.split('/').pop() ?? '';
    // avatar-….jpg → avatars, <tripId>-<nonce 8 hex>.jpg → post-media, <findId>.jpg (uuid) → scan-photos.
    const bucket: StorageBucket = name.startsWith('avatar-')
      ? BUCKETS.avatars
      : /-[0-9a-f]{8}\.jpg$/i.test(name)
        ? BUCKETS.posts
        : BUCKETS.finds;
    out.push({ bucket, path: x });
  }
  return out;
}

/** Ścieżki pogrupowane po koszyku (jedno usuwanie na koszyk). */
export function groupByBucket(refs: StorageRef[]): Partial<Record<StorageBucket, string[]>> {
  const out: Partial<Record<StorageBucket, string[]>> = {};
  refs.forEach((r) => {
    const list = (out[r.bucket] ??= []);
    if (!list.includes(r.path)) list.push(r.path);
  });
  return out;
}

/* ───────────────────────── Błędy Storage ───────────────────────── */

/** Kod błędu Storage w SyncError – klasyfikację robi classifyError (./syncRpc.ts). */
export const STORAGE_ERROR_CODE = 'storage';
/** Brak koszyka (migracja Storage jeszcze niewgrana) – chwilowe, z limitem prób. */
export const STORAGE_UNAVAILABLE_CODE = 'storage_unavailable';

/**
 * Błąd z supabase-js Storage (`StorageApiError {message, status, statusCode}` / `StorageUnknownError`)
 * → SyncError. Kod HTTP bierzemy z `statusCode` (lokalny Storage zwraca go w treści), inaczej z `status`.
 * - brak odpowiedzi (sieć) → `code: ''`, `status: 0` (ponawiamy);
 * - wygasła sesja (JWT) → `status: 401` (sesja od nowa);
 * - 413 / 415 – plik za duży / nieobsługiwany format → trwały, czytelny komunikat;
 * - brak koszyka → `storage_unavailable` (ponawiamy z limitem prób);
 * - 5xx / 408 / 429 → `code: ''` (jak sieć), reszta (RLS, zła ścieżka) – trwały.
 */
export function storageSyncError(e: unknown): SyncError {
  const o = (e && typeof e === 'object' ? e : {}) as { message?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  const message = typeof o.message === 'string' && o.message ? o.message : String(e ?? 'Storage');
  const fromBody = Number(o.statusCode);
  const http = typeof o.status === 'number' ? o.status : Number(o.status);
  const status = Number.isFinite(fromBody) && fromBody >= 100 ? fromBody : Number.isFinite(http) ? http : 0;
  if (!status) return { message, code: '', status: 0 };
  if (/jwt|token.*expired|invalid.*signature|exp claim/i.test(message)) return { message, code: '', status: 401 };
  if (status === 413) return { message: 'zdjęcie za duże dla serwera (413)', code: STORAGE_ERROR_CODE, status, details: message };
  if (status === 415) return { message: 'nieobsługiwany format zdjęcia (415)', code: STORAGE_ERROR_CODE, status, details: message };
  if (/bucket not found/i.test(message)) {
    return { message: 'brak koszyka Storage na serwerze – wgraj migrację etapu 5', code: STORAGE_UNAVAILABLE_CODE, status, details: message };
  }
  if (status >= 500 || status === 408 || status === 429) return { message, code: '', status };
  return { message, code: STORAGE_ERROR_CODE, status };
}

/** Błąd „za duży plik” bez wysyłania (limit koszyka znany z kontraktu). */
export function tooLargeError(bucket: StorageBucket, bytes: number): SyncError {
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return {
    message: 'zdjęcie za duże dla serwera (413)',
    code: STORAGE_ERROR_CODE,
    status: 413,
    details: `${kb(bytes)} > limit ${bucket} ${kb(BUCKET_LIMIT_BYTES[bucket])}`,
  };
}
