import { useSimStore } from '@/store/useSimStore';
import { hashString, mulberry32, sleep } from '@/utils/random';
import { ServiceError } from '../types';

/**
 * Opóźnienie sieci 300–1500 ms (deterministyczne dla danego klucza). Wyłączona sieć
 * w panelu /dev → ServiceError('NETWORK'), jak przy prawdziwym braku połączenia.
 */
export async function net(key: string, min = 300, max = 1100) {
  const r = mulberry32(hashString(key + Date.now().toString().slice(0, -3)))();
  await sleep(min + Math.round(r * (max - min)));
  if (!useSimStore.getState().networkEnabled) throw new ServiceError('NETWORK', 'Brak połączenia z siecią');
}
