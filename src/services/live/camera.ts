/**
 * Prawdziwy aparat (expo-camera): zgoda systemowa, dostępność kamery i zdjęcie znaleziska zmniejszone
 * expo-image-manipulator (JPEG bez EXIF). To zdjęcie rozpoznaje Edge Function `identify` (./identify.ts) i ono
 * trafia do znaleziska. Bez zdjęcia nie ma rozpoznania (poza wymuszonym wynikiem z panelu dev).
 */
import { Camera, CameraView, type PermissionResponse } from 'expo-camera';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

import { WEB_PHOTO_MAX_CHARS } from '@/utils/findPhoto';
import { makeId } from '@/utils/random';

import type { PermissionStatus } from '../types';
import { deleteFindPhoto, deleteTempFile, persistFindPhoto } from './findPhotos';

function toStatus(p: PermissionResponse): PermissionStatus {
  if (p.granted) return 'granted';
  // Android pozwala zapytać ponownie po pierwszej odmowie.
  if (p.status === 'denied') return Platform.OS === 'android' && p.canAskAgain ? 'undetermined' : 'denied';
  return 'undetermined';
}

export const liveCamera = {
  /** Stan zgody bez promptu (web bez Permissions API → „nie pytano”). */
  async status(): Promise<PermissionStatus> {
    try {
      return toStatus(await Camera.getCameraPermissionsAsync());
    } catch {
      return 'undetermined';
    }
  },

  /** Systemowy prompt (web: prompt przeglądarki przez getUserMedia). */
  async request(): Promise<PermissionStatus> {
    const st = toStatus(await Camera.requestCameraPermissionsAsync());
    if (st !== 'granted' && Platform.OS === 'web') {
      // getUserMedia zawodzi też bez odmowy (np. kamera zajęta przez inną aplikację) – wtedy rozstrzyga
      // Permissions API, a podgląd sam przejdzie w tryb „niedostępny” (onMountError).
      const q = await Camera.getCameraPermissionsAsync().catch(() => null);
      if (q?.granted) return 'granted';
    }
    return st;
  },

  /**
   * „Otwórz ustawienia” po odmowie: ponowny prompt, gdy system jeszcze pozwala zapytać,
   * inaczej ustawienia aplikacji (iOS/Android). Web: tylko ponowna próba – instrukcję pokazuje ekran.
   */
  async recover(): Promise<PermissionStatus> {
    const cur = await Camera.getCameraPermissionsAsync().catch(() => null);
    if (cur?.granted) return 'granted';
    if (Platform.OS === 'web' || !cur || cur.canAskAgain) return liveCamera.request();
    await Linking.openSettings().catch(() => {});
    return toStatus(cur);
  },
};

/** Czy jest kamera. Web: wymaga getUserMedia (https albo localhost) i urządzenia wideo; natywnie – zawsze (symulator → onMountError). */
export async function isCameraAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web') return true;
  try {
    return await CameraView.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Zdjęcie natywnie: dłuższy bok 720 px, JPEG 0,6 (~60–120 KB w katalogu dokumentów). */
const NATIVE_PHOTO = { edge: 720, compress: 0.6 };
/** Web: data URI trafia do localStorage – mniejsze kroki, aż zmieści się w limicie. */
const WEB_PHOTO = [
  { edge: 480, compress: 0.5 },
  { edge: 360, compress: 0.4 },
];
/** Maks. długość data URI zapisywanego w localStorage (~120 KB). */
const WEB_MAX_CHARS = WEB_PHOTO_MAX_CHARS;

function revokeBlob(uri?: string) {
  if (uri?.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(uri);
}

function release(ref: ImageRef | null) {
  // Web: każdy wyrenderowany obraz ma własny adres blob: (pełny PNG) – zwalniamy go razem z obrazem.
  if (Platform.OS === 'web') revokeBlob((ref as { uri?: string } | null)?.uri);
  try {
    ref?.release();
  } catch {
    // już zwolniony
  }
}

/** Obraz z poprawioną orientacją, zmniejszony do `edge` px na dłuższym boku. */
async function shrink(uri: string, edge: number): Promise<ImageRef> {
  const full = await ImageManipulator.manipulate(uri).renderAsync();
  if (Math.max(full.width, full.height) <= edge) return full;
  try {
    const size = full.width >= full.height ? { width: edge } : { height: edge };
    return await ImageManipulator.manipulate(full).resize(size).renderAsync();
  } finally {
    release(full);
  }
}

async function nativePhoto(uri: string): Promise<string> {
  const ref = await shrink(uri, NATIVE_PHOTO.edge);
  try {
    const out = await ref.saveAsync({ compress: NATIVE_PHOTO.compress, format: SaveFormat.JPEG });
    return await persistFindPhoto(out.uri, `${makeId('photo')}.jpg`);
  } finally {
    release(ref);
    deleteTempFile(uri);
  }
}

async function webPhoto(uri: string): Promise<string | undefined> {
  let fallback: string | undefined;
  for (const step of WEB_PHOTO) {
    const ref = await shrink(uri, step.edge);
    try {
      const out = await ref.saveAsync({ compress: step.compress, format: SaveFormat.JPEG, base64: true });
      const data = out.base64 ? `data:image/jpeg;base64,${out.base64}` : undefined;
      if (data && data.length <= WEB_MAX_CHARS) {
        revokeBlob(out.uri);
        revokeBlob(fallback);
        return data;
      }
      revokeBlob(fallback);
      fallback = out.uri;
    } finally {
      release(ref);
    }
  }
  // Za duże do localStorage – zostaje adres blob: tylko na tę sesję (po odświeżeniu strony placeholder).
  return fallback;
}

async function shoot(camera: CameraView): Promise<string | undefined> {
  try {
    // skipProcessing pomijamy: na iOS i tak jest ignorowane, a na Androidzie gubi orientację (EXIF).
    const pic = await camera.takePictureAsync(
      Platform.OS === 'web' ? { quality: 0.85, imageType: 'jpg' } : { quality: 0.5 },
    );
    if (!pic?.uri) return undefined;
    return Platform.OS === 'web' ? await webPhoto(pic.uri) : await nativePhoto(pic.uri);
  } catch (e) {
    if (__DEV__) console.warn('[camera] nie udało się zrobić zdjęcia', e);
    return undefined;
  }
}

/** Dłużej nie czekamy na zdjęcie – ekran skanu pokazuje wtedy „nie udało się zrobić zdjęcia”. */
const CAPTURE_TIMEOUT_MS = 10_000;

/**
 * Zdjęcie znaleziska spustem skanu. Natywnie: plik w `dokumenty/finds/`, web: data URI.
 * Nigdy nie rzuca – bez zdjęcia (błąd, brak gotowości aparatu, timeout) zwraca undefined.
 */
export function captureFindPhoto(camera: CameraView): Promise<string | undefined> {
  const work = shoot(camera);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
      // Spóźnione zdjęcie nie trafi do znaleziska – sprzątamy plik.
      work.then((late) => deleteFindPhoto(late));
    }, CAPTURE_TIMEOUT_MS);
    work.then((uri) => {
      clearTimeout(timer);
      resolve(uri);
    });
  });
}

/**
 * TYLKO narzędzia dev (testy bez aparatu, np. komputer bez kamery): zdjęcie z galerii, przygotowane jak zdjęcie ze
 * spustu (ten sam rozmiar, JPEG bez EXIF, ten sam katalog). W wydaniu skan przyjmuje wyłącznie zdjęcie z aparatu
 * (anty-cheat) – ekran skanu nie pokazuje tej opcji bez DEV_TOOLS. 'canceled' = gracz zamknął wybór.
 */
export async function pickDevFindPhoto(): Promise<string | 'canceled' | undefined> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (res.canceled || !res.assets?.length) return 'canceled';
    const uri = res.assets[0].uri;
    return Platform.OS === 'web' ? await webPhoto(uri) : await nativePhoto(uri);
  } catch (e) {
    if (__DEV__) console.warn('[camera] nie udało się wczytać zdjęcia z galerii', e);
    return undefined;
  }
}
