import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

/** Treść zasobu (np. `.geo`) – na iOS/Androidzie pobranego do cache przez expo-asset. */
export async function readAssetText(mod: number): Promise<string> {
  const asset = Asset.fromModule(mod);
  if (!asset.localUri) await asset.downloadAsync();
  return new File(asset.localUri ?? asset.uri).text();
}
