/**
 * Generuje docs/species-catalog.csv z src/data/mock/species.ts – katalog do mapowania etykiet modelu rozpoznawania
 * i zbiorów testowych (src/data/speciesCsv.ts). Uruchom po każdej zmianie katalogu: npm run species:csv
 * (test src/data/__tests__/species.test.ts sprawdza, że plik jest aktualny)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { SPECIES } from '../src/data/mock/species';
import { buildSpeciesCsv } from '../src/data/speciesCsv';

const file = path.join(__dirname, '..', 'docs', 'species-catalog.csv');
writeFileSync(file, buildSpeciesCsv(SPECIES), 'utf8');
console.log(`zapisano ${path.relative(process.cwd(), file)} (${SPECIES.length} gatunków)`);
