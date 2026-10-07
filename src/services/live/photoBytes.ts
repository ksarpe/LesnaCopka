/**
 * Bajty zdjęcia do wysyłki na serwer (tryb Supabase) – czytane dopiero w chwili wysyłki z kolejki:
 * plik z katalogu dokumentów (iOS/Android – expo-file-system `File.bytes()`), data URI (web, base64) albo
 * blob: / http(s): (web – fetch). Zdjęcia są już przekodowanymi JPEG-ami bez EXIF (camera.ts, avatarPhoto.ts).
 *
 * Nigdy nie rzuca: brak pliku, wygasły blob: po odświeżeniu strony, błąd odczytu → null („nie ma zdjęcia”, nie błąd
 * sieci – zdarzenie nie utknie w kolejce na zawsze).
 */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { bytesToBase64, dataUriBytes } from '@/utils/bytes';
import { jpegDataUriLength } from '@/utils/findPhoto';

export async function readImageBytes(uri: string): Promise<Uint8Array | null> {
  try {
    if (uri.startsWith('data:')) return dataUriBytes(uri);
    if (uri.startsWith('file:')) {
      if (Platform.OS === 'web') return null;
      const file = new File(uri);
      if (!file.exists) return null;
      const bytes = await file.bytes();
      return bytes.length ? bytes : null;
    }
    if (/^(blob:|https?:)/i.test(uri)) {
      const res = await fetch(uri);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length ? bytes : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Web: zdjęcie z podpisanego adresu jako data URI do localStorage – albo `'too-big'`, gdy przekracza limit
 * jednego zdjęcia (wtedy zostaje znacznik i wczytywanie z sieci), albo null przy błędzie (spróbujemy później).
 */
export async function fetchAsDataUri(url: string, maxChars: number): Promise<string | 'too-big' | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return null;
    if (jpegDataUriLength(bytes.length) > maxChars) return 'too-big';
    return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}
