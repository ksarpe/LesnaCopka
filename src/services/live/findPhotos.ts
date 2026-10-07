/**
 * Zdjęcia znalezisk na urządzeniu: trwały zapis w katalogu dokumentów (iOS/Android), źródło dla <Image>,
 * pobranie zdjęcia z serwera (tryb Supabase, nowe urządzenie) i sprzątanie po porzuconych znaleziskach.
 * Web: zdjęcie to mały data URI w store (localStorage) – bez plików.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform, type ImageSourcePropType } from 'react-native';

import { isRemotePhoto, PHOTO_DIR, rerootPhotoUri } from '@/utils/findPhoto';

let documentUri: string | null = null;

/** URI katalogu dokumentów – liczony raz (miniatury rysują się często). */
function docUri(): string {
  if (documentUri == null) {
    try {
      documentUri = Paths.document.uri;
    } catch {
      documentUri = '';
    }
  }
  return documentUri;
}

/** Aktualna ścieżka zdjęcia (po zmianie kontenera aplikacji na iOS). */
export function resolveFindPhoto(uri: string): string {
  return Platform.OS === 'web' ? uri : rerootPhotoUri(uri, docUri());
}

/** Stałe obiekty źródeł – ekrany z animacjami (Nagroda) renderują się co klatkę, a <Image> nie przeładowuje obrazu. */
const sources = new Map<string, ImageSourcePropType>();

/**
 * Źródło dla <Image> / <Placeholder source> – brak zdjęcia = undefined (paski z makiety). Znacznik zdjęcia
 * z serwera (`sb-photo:`, web) też → undefined; ekrany używają hooka useFindPhotoSource, który go rozwiązuje.
 */
export function findPhotoSource(uri?: string): ImageSourcePropType | undefined {
  if (!uri || isRemotePhoto(uri)) return undefined;
  let src = sources.get(uri);
  if (!src) {
    if (sources.size >= 200) sources.clear();
    src = { uri: resolveFindPhoto(uri) };
    sources.set(uri, src);
  }
  return src;
}

/** Przenosi zdjęcie z cache do `dokumenty/finds/<name>` (przetrwa restart). Zwraca nowy URI. */
export async function persistFindPhoto(tmpUri: string, name: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, name);
  await new File(tmpUri).move(dest);
  return dest.uri;
}

/**
 * Tryb Supabase, nowe urządzenie / reinstalacja: zdjęcie znaleziska z serwera (podpisany adres) do
 * `dokumenty/finds/<findId>.jpg` – to samo miejsce co zdjęcia z aparatu. Zwraca URI pliku. Rzuca przy błędzie
 * (wywołujący spróbuje przy następnym pobraniu stanu). Tylko iOS/Android.
 */
export async function downloadFindPhoto(url: string, findId: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = await File.downloadFileAsync(url, new File(dir, `${findId}.jpg`), { idempotent: true });
  return file.uri;
}

/** Usuwa plik zdjęcia (best effort – brak pliku to nie błąd). Web: nie ma plików. */
export function deleteFindPhoto(uri?: string) {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const f = new File(resolveFindPhoto(uri));
    if (f.exists) f.delete();
  } catch {
    // plik już usunięty albo niedostępny
  }
}

/** Usuwa wszystkie zdjęcia znalezisk (reset stanu w panelu dev). */
export function clearFindPhotos() {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(Paths.document, PHOTO_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // best effort
  }
}

/** Plik tymczasowy (np. surowe zdjęcie z aparatu w cache) – usuwamy po przetworzeniu. */
export function deleteTempFile(uri?: string) {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // cache i tak czyści system
  }
}
