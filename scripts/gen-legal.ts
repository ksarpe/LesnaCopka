/**
 * Generuje docs/legal/*.md (regulamin, polityka prywatności) z src/data/legal.ts – tego samego źródła,
 * z którego aplikacja rysuje ekrany Ustawienia → Informacje prawne.
 * Uruchom: npm run legal:md   (test src/data/__tests__/legal.test.ts sprawdza, że pliki są aktualne)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LEGAL_DOCS, legalToMarkdown } from '../src/data/legal';

const dir = path.join(__dirname, '..', 'docs', 'legal');
mkdirSync(dir, { recursive: true });
for (const doc of LEGAL_DOCS) {
  const file = path.join(dir, doc.file);
  writeFileSync(file, legalToMarkdown(doc), 'utf8');
  console.log(`zapisano ${path.relative(process.cwd(), file)}`);
}
