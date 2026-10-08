import type { Species } from '@/types';

/**
 * Katalog gatunków jako CSV (docs/species-catalog.csv, `npm run species:csv`) – do mapowania etykiet własnego modelu
 * rozpoznawania i zbiorów testowych na atlas gry: `id` (identyfikator w grze i w odpowiedzi rozpoznawania), nazwa
 * polska i łacińska, klucz GBIF (synonimy łacińskie), jadalność, rzadkość w grze, ochrona.
 */
export const SPECIES_CSV_HEADER = ['atlas_no', 'id', 'name_pl', 'latin', 'gbif_key', 'edibility', 'rarity', 'protection'];

const cell = (v: string | number | undefined | null) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildSpeciesCsv(species: readonly Species[]): string {
  const rows = species.map((s, i) =>
    [i + 1, s.id, s.name, s.latin, s.gbifKey, s.edibility, s.rarity, s.protection ?? ''].map(cell).join(','),
  );
  return [SPECIES_CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}
