/**
 * Wejście do danych geograficznych aplikacji: leniwie wczytywany indeks gmin (PRG)
 * i zamiana jego metadanych na model `Gmina`.
 */
import type { Gmina } from '@/types';

import { GMINY_INDEX_ASSET, GMINY_SHARD_ASSETS } from './assets.generated';
import { GminaIndex, type GminaIndexFile, type GminaMeta, type GminaShardFile } from './gminaIndex';
import { readAssetText } from './readAssetText';

let indexPromise: Promise<GminaIndex> | null = null;

/** Indeks gmin – wczytywany przy pierwszym użyciu (ok. 300 KB), paczki województw dopiero gdy trzeba. */
export function gminaIndex(): Promise<GminaIndex> {
  if (!indexPromise) {
    const p = readAssetText(GMINY_INDEX_ASSET).then(
      (txt) =>
        new GminaIndex(JSON.parse(txt) as GminaIndexFile, async (woj) => {
          const mod = GMINY_SHARD_ASSETS[woj];
          if (mod == null) return {};
          return JSON.parse(await readAssetText(mod)) as GminaShardFile;
        }),
    );
    p.catch(() => {
      indexPromise = null;
    });
    indexPromise = p;
  }
  return indexPromise;
}

/** Model aplikacji z metadanych PRG; dane gry (statystyki, kompleks leśny) bierze z `known`, jeśli jest. */
export function gminaFromMeta(meta: GminaMeta, known?: Gmina): Gmina {
  return {
    mushroomers: 0,
    ...known,
    id: meta.id,
    name: known?.name ?? meta.name,
    teryt: meta.teryt,
    kind: meta.kind,
    powiat: meta.powiat,
    voivodeship: meta.voivodeship,
    forestPct: meta.forestPct,
  };
}

/**
 * Metadane gmin o podanych slugach, których nie ma w `known` (np. wyprawy z gmin spoza danych gry
 * zapisane w AsyncStorage) – z samego indeksu, bez wczytywania granic.
 */
export async function missingGminy(ids: Iterable<string>, known: Record<string, Gmina>): Promise<Gmina[]> {
  const wanted = [...new Set(ids)].filter((id) => !known[id]);
  if (!wanted.length) return [];
  const index = await gminaIndex();
  return wanted.flatMap((id) => {
    const meta = index.byId.get(id);
    return meta ? [gminaFromMeta(meta)] : [];
  });
}

export type { GminaHit, GminaKind, GminaMeta } from './gminaIndex';
