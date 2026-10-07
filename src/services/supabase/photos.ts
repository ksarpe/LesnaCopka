/**
 * Zdjęcia w Supabase Storage (tylko tryb Supabase – w mockach nic się tu nie dzieje).
 *
 * Wysyłka (zdarzenia kolejki, wywołuje silnik ./sync.ts; bajty czytane dopiero teraz – kolejka trzyma odnośnik):
 * - `photo.find` – zdjęcie znaleziska → prywatny `scan-photos/{uid}/{findId}.jpg` → `set_find_photo`; ścieżka trafia
 *   do `Find.photoPath` (zdjęcie odtworzone z serwera nie jest wysyłane ponownie);
 * - `trip.publish` – okładka (najlepsze znalezisko ze zdjęciem) → publiczny `post-media/{uid}/{tripId}-{nonce}.jpg`,
 *   potem `publish_trip(…, p_cover_path)`; brak zdjęcia albo plik odrzucony przez serwer → publikacja bez okładki;
 * - `photo.avatar` – zdjęcie profilowe → publiczny `avatars/{uid}/avatar-{ts}.jpg` + `profiles.avatar_path`
 *   (motyw / brak → null) i sprzątanie starych plików gracza;
 * - `photo.delete` – usunięcie obiektów (np. zdjęcie porzuconego znaleziska).
 * Błąd sieci → ponowienie jak inne zdarzenia; plik za duży / zły format (413 / 415) i błędy biznesowe → zdarzenie
 * wypada z kolejki z czytelnym komunikatem (panel /dev).
 *
 * Odtwarzanie (nowe urządzenie / reinstalacja): znaleziska z `get_game_state` mają `photoPath` – telefon pobiera je
 * przez podpisany adres do `dokumenty/finds/`, web zapisuje mały data URI (budżet localStorage) albo znacznik
 * `sb-photo:` wczytywany z sieci (./remotePhotos.ts).
 */
import { Platform } from 'react-native';

import { resolveAvatarUri } from '@/services/live/avatarPhoto';
import { downloadFindPhoto, resolveFindPhoto } from '@/services/live/findPhotos';
import { fetchAsDataUri, readImageBytes } from '@/services/live/photoBytes';
import type { AvatarPhotoPayload, OutboxItem, StorageDeletePayload } from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { patchFromServer, useUserStore } from '@/store/useUserStore';
import type { Find } from '@/types';
import {
  dataUriTotal,
  remotePhotoPath,
  remotePhotoUri,
  trimPhotoBudget,
  WEB_PHOTO_BUDGET,
  WEB_PHOTO_MAX_CHARS,
} from '@/utils/findPhoto';
import { claimedFindsOf, coverFind } from '@/utils/tripPost';
import { supabase } from './client';
import { call, rpc, type PgResult, type Thenable } from './rpc';
import { backendStatus } from './status';
import { createStorageApi, type StorageApi } from './storage';
import {
  avatarPhotoPath,
  BUCKET_LIMIT_BYTES,
  BUCKETS,
  coverPhotoPath,
  findPhotoPath,
  groupByBucket,
  isBucket,
  isOwnPath,
  nonceFrom,
  parseStorageRefs,
  tooLargeError,
  type StorageBucket,
} from './storagePaths';
import { classifyError, errorMessage, rpcFor, type SyncError } from './syncRpc';

let api: StorageApi | null = null;
const storage = () => (api ??= createStorageApi(supabase!));

/** Wysłane w tej sesji (`bucket/ścieżka`) – ponowienie samego RPC nie wysyła zdjęcia drugi raz. */
const uploaded = new Set<string>();

async function uploadOnce(bucket: StorageBucket, path: string, bytes: Uint8Array): Promise<SyncError | null> {
  const key = `${bucket}/${path}`;
  if (uploaded.has(key)) return null;
  if (bytes.length > BUCKET_LIMIT_BYTES[bucket]) return tooLargeError(bucket, bytes.length);
  const err = await storage().upload(bucket, path, bytes);
  if (!err) uploaded.add(key);
  return err;
}

/** Best effort: obiekt, którego serwer nie potrzebuje (odrzucone RPC, porzucone znalezisko). */
async function dropObjects(bucket: StorageBucket, paths: string[]) {
  if (!paths.length) return;
  paths.forEach((p) => uploaded.delete(`${bucket}/${p}`));
  await storage().remove(bucket, paths);
}

/** Bajty zdjęcia znaleziska: plik (bieżący katalog dokumentów), data URI, blob:, a na webie też znacznik `sb-photo:`. */
async function findPhotoBytes(uri: string): Promise<Uint8Array | null> {
  const remote = remotePhotoPath(uri);
  if (!remote) return readImageBytes(resolveFindPhoto(uri));
  const { urls } = await storage().signedUrls(BUCKETS.finds, [remote], 120);
  return urls[remote] ? readImageBytes(urls[remote]) : null;
}

/** Uwaga do panelu /dev (bez przerywania kolejki). */
function note(message: string) {
  backendStatus().set({ error: message });
}

/* ───────────────────────── photo.find ───────────────────────── */

/** Zdjęcie znaleziska → `scan-photos` → `set_find_photo`. Kolejka FIFO: `find.submit` już doszedł. */
export async function sendFindPhoto(findId: string, uid: string): Promise<SyncError | null> {
  const find = useTripStore.getState().finds[findId];
  // Porzucone znalezisko, bez zdjęcia albo zdjęcie już na serwerze (wysłane, odtworzone) – nie ma czego wysyłać.
  if (!find?.photoUri || find.photoPath) return null;
  const bytes = await findPhotoBytes(find.photoUri);
  // Zdjęcia już nie ma (web: wygasły blob: po odświeżeniu strony) – zdarzenie bez znaczenia.
  if (!bytes) return null;
  const path = findPhotoPath(uid, findId);
  const up = await uploadOnce(BUCKETS.finds, path, bytes);
  if (up) return up;
  const r = await rpc('set_find_photo', { p_find_id: findId, p_path: path });
  if (r.error) {
    if (classifyError(r.error) === 'permanent') await dropObjects(BUCKETS.finds, [path]);
    return r.error;
  }
  const cur = useTripStore.getState().finds[findId];
  if (cur) useTripStore.getState().upsertFind({ ...cur, photoPath: path });
  // Porzucone w trakcie wysyłki (`find.discard` już w kolejce) – zdjęcie nie zostaje na serwerze.
  else await dropObjects(BUCKETS.finds, [path]);
  return null;
}

/* ───────────────────────── trip.publish (okładka) ───────────────────────── */

type CoverResult = { path: string | null } | { error: SyncError };

/** Okładka wpisu: najlepsze znalezisko wyprawy ze zdjęciem (ta sama reguła co własny wpis w feedzie). */
async function uploadCover(tripId: string, nonce: string, uid: string): Promise<CoverResult> {
  const { trips, finds } = useTripStore.getState();
  const trip = trips[tripId];
  const cover = trip ? coverFind(claimedFindsOf(trip, finds)) : undefined;
  if (!cover?.photoUri) return { path: null };
  const bytes = await findPhotoBytes(cover.photoUri);
  if (!bytes) return { path: null };
  const path = coverPhotoPath(uid, tripId, nonce);
  const err = await uploadOnce(BUCKETS.posts, path, bytes);
  if (!err) return { path };
  // Plik odrzucony (za duży, format, uprawnienia) – wpis i tak wychodzi, tylko bez zdjęcia.
  if (classifyError(err) === 'permanent') {
    note(`Okładka wpisu: ${errorMessage(err)} – publikacja bez okładki`);
    return { path: null };
  }
  return { error: err };
}

/**
 * `trip.publish`: okładka (jeśli jest) → `publish_trip(…, p_cover_path)`. Nonce ścieżki z id zdarzenia – ponowienie
 * nadpisuje ten sam plik. Serwer bez `p_cover_path` (stara migracja) albo odrzucona ścieżka → publikacja bez okładki.
 */
export async function sendPublish(item: Extract<OutboxItem, { type: 'trip.publish' }>, uid: string): Promise<SyncError | null> {
  const c = rpcFor(item)!;
  const cover = await uploadCover(item.payload.tripId, nonceFrom(item.id), uid);
  if ('error' in cover) return cover.error;
  if (!cover.path) return (await rpc(c.fn, c.params)).error;
  let r = await rpc(c.fn, { ...c.params, p_cover_path: cover.path });
  const coverRejected =
    !!r.error && (r.error.code === 'PGRST202' || (classifyError(r.error) === 'permanent' && /path|cover/i.test(r.error.message)));
  if (coverRejected) {
    note(`Okładka wpisu: ${errorMessage(r.error!)} – publikacja bez okładki`);
    await dropObjects(BUCKETS.posts, [cover.path]);
    r = await rpc(c.fn, c.params);
  } else if (r.error && classifyError(r.error) === 'permanent') {
    // Publikacja odrzucona (np. koniec wyprawy nie dotarł) – okładka nie jest potrzebna.
    await dropObjects(BUCKETS.posts, [cover.path]);
  } else if (!r.error) {
    // Wpis był już opublikowany z inną okładką (serwer jej nie podmienia) – nasz plik jest zbędny.
    const kept = coverPathOf(r.data);
    if (kept !== undefined && kept !== cover.path) await dropObjects(BUCKETS.posts, [cover.path]);
  }
  return r.error;
}

/** `payload.cover_path` z wiersza `posts` zwróconego przez `publish_trip` (undefined = nie wiadomo). */
function coverPathOf(data: unknown): string | null | undefined {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return undefined;
  const payload = (row as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object' || !('cover_path' in payload)) return undefined;
  const v = (payload as { cover_path?: unknown }).cover_path;
  return typeof v === 'string' ? v : null;
}

/* ───────────────────────── photo.avatar ───────────────────────── */

async function setAvatarPath(uid: string, path: string | null): Promise<SyncError | null> {
  const r = await call(() => supabase!.from('profiles').update({ avatar_path: path }).eq('id', uid) as unknown as Thenable<PgResult>);
  return r.error;
}

/** Sprzątanie: wszystkie pliki gracza w `avatars/{uid}` poza bieżącym (best effort). */
async function pruneServerAvatars(uid: string, keep: string | null) {
  const { paths, error } = await storage().list(BUCKETS.avatars, uid);
  if (error) return;
  await dropObjects(
    BUCKETS.avatars,
    paths.filter((p) => p !== keep),
  );
}

/** Ścieżka na serwerze zapamiętana przy bieżącym zdjęciu (nowe urządzenie / kolejna zmiana wiedzą, co jest wysłane). */
function rememberAvatarPath(uri: string, path: string) {
  const u = useUserStore.getState().user;
  const cur = u.avatar;
  if (cur?.kind === 'photo' && cur.uri === uri && cur.path !== path) patchFromServer({ user: { ...u, avatar: { ...cur, path } } });
}

/**
 * Zdjęcie profilowe: stan docelowy = bieżący avatar w profilu (zdarzenie w kolejce jest tylko jedno – najnowsze).
 * Zdjęcie → `avatars/{uid}/avatar-{ts}.jpg` + `profiles.avatar_path`; motyw / brak → `avatar_path = null`.
 * Potem stare pliki gracza w `avatars/` znikają (inni od razu widzą nowy adres).
 */
export async function sendAvatarPhoto(p: AvatarPhotoPayload, uid: string): Promise<SyncError | null> {
  const avatar = useUserStore.getState().user.avatar;
  if (avatar?.kind !== 'photo') {
    const err = await setAvatarPath(uid, null);
    if (err) return err;
    await pruneServerAvatars(uid, null);
    return null;
  }
  let path = avatar.path && isOwnPath(uid, avatar.path) ? avatar.path : null;
  const fresh = !path;
  if (!path) {
    const bytes = await readImageBytes(resolveAvatarUri(avatar.uri));
    // Pliku zdjęcia już nie ma – serwer zostaje przy swoim avatarze.
    if (!bytes) return null;
    path = avatarPhotoPath(uid, p.ts);
    const up = await uploadOnce(BUCKETS.avatars, path, bytes);
    if (up) return up;
  }
  const err = await setAvatarPath(uid, path);
  if (err) {
    if (fresh && classifyError(err) === 'permanent') await dropObjects(BUCKETS.avatars, [path]);
    return err;
  }
  rememberAvatarPath(avatar.uri, path);
  await pruneServerAvatars(uid, path);
  return null;
}

/* ───────────────────────── photo.delete ───────────────────────── */

export async function sendStorageDelete(p: StorageDeletePayload): Promise<SyncError | null> {
  if (!isBucket(p.bucket) || !p.paths.length) return null;
  p.paths.forEach((x) => uploaded.delete(`${p.bucket}/${x}`));
  return storage().remove(p.bucket, p.paths);
}

/**
 * Panel /dev („Nowy gracz”): pliki skasowanego gracza z `dev_reset_player().storagePaths` (zdjęcia znalezisk, okładki,
 * zdjęcie profilowe – serwer czyści `avatar_path`, SQL nie usuwa plików). Zwraca liczbę usuniętych albo null, gdy nic.
 */
export async function deleteServerObjects(raw: unknown): Promise<{ deleted: number; error: string | null } | null> {
  const refs = parseStorageRefs(raw);
  if (!refs.length) return null;
  const groups = groupByBucket(refs);
  let deleted = 0;
  let error: string | null = null;
  for (const [bucket, paths] of Object.entries(groups) as [StorageBucket, string[]][]) {
    paths.forEach((x) => uploaded.delete(`${bucket}/${x}`));
    const err = await storage().remove(bucket, paths);
    if (err) error = errorMessage(err);
    else deleted += paths.length;
  }
  return { deleted, error };
}

/* ───────────────────────── Odtwarzanie zdjęć z serwera ───────────────────────── */

/** Nieudane odtworzenie (brak obiektu, błąd pobrania) – kolejna próba najwcześniej po tylu ms. */
const RESTORE_RETRY_MS = 10 * 60_000;
/** Najwyżej tyle zdjęć na raz (okno serwera to ~30 wypraw). */
const RESTORE_BATCH = 30;
const restoreFailedAt = new Map<string, number>();
let restoring: Promise<number> | null = null;

/** Znaleziska z `photoPath` (zdjęcie na serwerze) bez zdjęcia w telefonie – od najnowszego. */
export function findsToRestore(finds: Record<string, Find>, now: number, failed: Map<string, number> = restoreFailedAt): Find[] {
  return Object.values(finds)
    .filter((f) => !!f.photoPath && !f.photoUri && now - (failed.get(f.id) ?? -Infinity) >= RESTORE_RETRY_MS)
    .sort((a, b) => b.foundAt.localeCompare(a.foundAt))
    .slice(0, RESTORE_BATCH);
}

/**
 * Zdjęcia znalezisk z serwera do telefonu (po przyjęciu stanu z serwera; w tle, nie rzuca). Zwraca liczbę odtworzonych.
 * Telefon: plik w `dokumenty/finds/`. Web: data URI, o ile mieści się w budżecie localStorage (najnowsze pierwsze),
 * inaczej znacznik `sb-photo:` (wczytywany z sieci przy wyświetleniu).
 */
export function restoreFindPhotos(now = Date.now()): Promise<number> {
  if (!supabase) return Promise.resolve(0);
  restoring ??= doRestore(now)
    .catch(() => 0)
    .finally(() => {
      restoring = null;
    });
  return restoring;
}

async function doRestore(now: number): Promise<number> {
  const todo = findsToRestore(useTripStore.getState().finds, now);
  if (!todo.length) return 0;
  const { urls, error } = await storage().signedUrls(
    BUCKETS.finds,
    todo.map((f) => f.photoPath!),
    600,
  );
  if (error) {
    todo.forEach((f) => restoreFailedAt.set(f.id, now));
    return 0;
  }
  const web = Platform.OS === 'web';
  let budget = web ? WEB_PHOTO_BUDGET - dataUriTotal(useTripStore.getState().finds) : 0;
  const restored = new Map<string, { path: string; uri: string }>();
  for (const f of todo) {
    const path = f.photoPath!;
    const url = urls[path];
    if (!url) {
      restoreFailedAt.set(f.id, now);
      continue;
    }
    if (web) {
      const data = budget > 0 ? await fetchAsDataUri(url, Math.min(WEB_PHOTO_MAX_CHARS, budget)) : 'too-big';
      if (data === null) {
        restoreFailedAt.set(f.id, now);
        continue;
      }
      const uri = data === 'too-big' ? remotePhotoUri(path) : data;
      if (data !== 'too-big') budget -= data.length;
      restored.set(f.id, { path, uri });
    } else {
      try {
        restored.set(f.id, { path, uri: await downloadFindPhoto(url, f.id) });
      } catch {
        restoreFailedAt.set(f.id, now);
      }
    }
  }
  if (!restored.size) return 0;
  // Stan mógł się zmienić w trakcie pobierania – zdjęcie dostaje tylko to samo znalezisko, wciąż bez zdjęcia.
  const ts = useTripStore.getState();
  let finds: Record<string, Find> = { ...ts.finds };
  let count = 0;
  restored.forEach(({ path, uri }, id) => {
    const cur = finds[id];
    if (!cur || cur.photoUri || cur.photoPath !== path) return;
    finds[id] = { ...cur, photoUri: uri };
    count += 1;
  });
  if (!count) return 0;
  if (web) finds = trimPhotoBudget(finds) ?? finds;
  ts.patch({ finds });
  return count;
}

/** Testy: czyści pamięć sesji (wysłane pliki, nieudane odtworzenia). */
export function resetPhotoSession() {
  uploaded.clear();
  restoreFailedAt.clear();
  restoring = null;
  api = null;
}
