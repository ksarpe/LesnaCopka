import { Asset } from 'expo-asset';

/** Treść zasobu (np. `.geo`) – na webie serwowanego pod adresem URL. */
export async function readAssetText(mod: number): Promise<string> {
  const res = await fetch(Asset.fromModule(mod).uri);
  if (!res.ok) throw new Error(`Nie udało się wczytać ${res.url} (${res.status})`);
  return res.text();
}
