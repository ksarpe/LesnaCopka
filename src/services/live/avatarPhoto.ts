/**
 * Zdjęcie profilowe: aparat / galeria (expo-image-picker) → kwadrat 256×256 JPEG (expo-image-manipulator).
 * Na telefonie plik trafia do `documents/avatars/` (przetrwa restart, cache mógłby zniknąć),
 * na webie zapisujemy mały data URI (base64, < ~60 KB) bezpośrednio w profilu.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type AvatarSource = 'camera' | 'library';

export type PickAvatarResult =
  | { status: 'ok'; uri: string }
  | { status: 'canceled' }
  /** Brak zgody na aparat; canAskAgain = false → tylko ze Ustawień systemu. */
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'error'; message: string };

const SIZE = 256;
/** Limit data URI na webie (bajty obrazu) – profil leży w localStorage razem z resztą stanu. */
const WEB_MAX_BYTES = 60_000;
const DIR_NAME = 'avatars';

/** Aparat jest dostępny tylko na telefonie (na webie byłby to i tak wybór pliku). */
export const canUseCamera = Platform.OS !== 'web';

/**
 * Wybór zdjęcia i przygotowanie avatara. Galeria używa systemowego pickera (iOS PHPicker /
 * Android Photo Picker), który nie wymaga zgody na bibliotekę zdjęć – pytamy tylko o aparat.
 */
export async function pickAvatarPhoto(source: AvatarSource): Promise<PickAvatarResult> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { status: 'denied', canAskAgain: perm.canAskAgain };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      // Kadrowanie systemowe (iOS zawsze kwadrat); na webie go nie ma – przycinamy sami do środka.
      allowsEditing: Platform.OS !== 'web',
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
    };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets?.length) return { status: 'canceled' };
    return { status: 'ok', uri: await prepareAvatar(res.assets[0].uri) };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Środkowy kwadrat → 256×256 JPEG ~0.7. Zwraca trwały URI (telefon) albo data URI (web). */
async function prepareAvatar(uri: string): Promise<string> {
  // Najpierw wczytujemy obraz, żeby znać prawdziwe wymiary (po obrocie z EXIF).
  const base = await ImageManipulator.manipulate(uri).renderAsync();
  const square = (size: number) => {
    const ctx = ImageManipulator.manipulate(base);
    if (base.width !== base.height && base.width > 0 && base.height > 0) ctx.crop(centerSquare(base.width, base.height));
    return ctx.resize({ width: size, height: size }).renderAsync();
  };

  if (Platform.OS === 'web') {
    // Coraz mniejszy / mocniej skompresowany, aż zmieści się w limicie.
    const steps = [
      { size: SIZE, compress: 0.7 },
      { size: 192, compress: 0.6 },
      { size: 128, compress: 0.5 },
    ];
    for (const step of steps) {
      const saved = await (await square(step.size)).saveAsync({ compress: step.compress, format: SaveFormat.JPEG, base64: true });
      if (saved.base64 && saved.base64.length * 0.75 <= WEB_MAX_BYTES) return `data:image/jpeg;base64,${saved.base64}`;
    }
    throw new Error('Zdjęcie jest zbyt duże');
  }

  const saved = await (await square(SIZE)).saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const dir = new Directory(Paths.document, DIR_NAME);
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `avatar-${Date.now()}.jpg`);
  new File(saved.uri).moveSync(dest);
  return dest.uri;
}

function centerSquare(w: number, h: number) {
  const side = Math.min(w, h);
  return { originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side };
}

function fileName(uri: string) {
  return uri.split('/').pop() ?? '';
}

/**
 * URI zdjęcia z `documents/avatars/` po aktualizacji aplikacji: na iOS ścieżka kontenera
 * może się zmienić, więc odtwarzamy ją z bieżącego katalogu dokumentów i nazwy pliku.
 */
export function resolveAvatarUri(uri: string): string {
  if (Platform.OS === 'web' || !uri.startsWith('file:') || !uri.includes(`/${DIR_NAME}/`)) return uri;
  try {
    return new File(Paths.document, DIR_NAME, fileName(uri)).uri;
  } catch {
    return uri;
  }
}

/**
 * Sprzątanie `documents/avatars/`: usuwa wszystkie zdjęcia poza bieżącym (poprzednie avatary,
 * zdjęcia wybrane w edycji, ale niezapisane). Bez `keepUri` – usuwa wszystko (reset danych).
 */
export function pruneAvatarFiles(keepUri?: string) {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(Paths.document, DIR_NAME);
    if (!dir.exists) return;
    const keep = keepUri ? fileName(keepUri) : null;
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.name !== keep) {
        try {
          entry.delete();
        } catch {
          // Plik w użyciu / już usunięty – spróbujemy przy następnym sprzątaniu.
        }
      }
    }
  } catch {
    // Brak dostępu do systemu plików (np. testy) – nic do sprzątania.
  }
}
