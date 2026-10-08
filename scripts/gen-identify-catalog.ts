/**
 * Generuje supabase/functions/identify/catalog.ts – katalog gatunków dla Edge Function `identify` (prompt systemowy
 * i enum `speciesId` w schemacie odpowiedzi modelu) z src/data/mock/species.ts, tego samego źródła co aplikacja
 * i seed bazy. Edge Function nie może importować plików aplikacji (wdrażany jest tylko katalog funkcji).
 * Uruchom po każdej zmianie katalogu: npm run identify:catalog
 * (test src/services/live/__tests__/identifyContract.test.ts sprawdza, że plik jest aktualny)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { SPECIES } from '../src/data/mock/species';

const entries = SPECIES.map((s) => ({
  id: s.id,
  name: s.name,
  latin: s.latin,
  edibility: s.edibility,
  ...(s.clustered ? { clustered: true } : {}),
}));

const body = [
  '// WYGENEROWANE przez scripts/gen-identify-catalog.ts z src/data/mock/species.ts – nie edytuj ręcznie',
  '// (npm run identify:catalog). Katalog trafia do promptu systemowego i enum `speciesId` w schemacie odpowiedzi.',
  '// Bez importów (Deno wymaga rozszerzeń w ścieżkach, Metro / tsc aplikacji – nie); typ: IdentCatalogEntry z contract.ts.',
  '',
  `export const IDENT_CATALOG = ${JSON.stringify(entries, null, 2)} as const;`,
  '',
].join('\n');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'identify', 'catalog.ts');
writeFileSync(file, body, 'utf8');
console.log(`zapisano ${path.relative(process.cwd(), file)} (${entries.length} gatunków)`);
