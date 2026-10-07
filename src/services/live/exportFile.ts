/**
 * Zapis pliku eksportu danych (JSON) i przekazanie go graczowi: telefon – plik w cache + systemowe „Udostępnij”
 * (expo-sharing: zapis w Plikach, mail, Dysk…), web – pobranie przez przeglądarkę (Blob + <a download>).
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type ShareOutcome = 'shared' | 'downloaded' | 'saved';

/** `saved` – udostępnianie niedostępne (np. symulator bez aplikacji); plik został w cache pod `uri`. */
export async function shareJsonFile(
  name: string,
  json: string,
  dialogTitle: string,
): Promise<{ outcome: ShareOutcome; uri?: string }> {
  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { outcome: 'downloaded' };
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(json);
  if (!(await Sharing.isAvailableAsync())) return { outcome: 'saved', uri: file.uri };
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  return { outcome: 'shared', uri: file.uri };
}
