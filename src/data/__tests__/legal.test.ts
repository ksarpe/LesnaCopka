import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  fmtLegalDate,
  LEGAL_DOCS,
  LEGAL_DRAFT_NOTICE,
  legalToMarkdown,
  POLITYKA_PRYWATNOSCI,
  REGULAMIN,
  splitBold,
  type LegalBlock,
  type LegalDoc,
} from '../legal';

/** Wszystkie teksty dokumentu (tytuły, akapity, punkty list, ramki). */
function texts(doc: LegalDoc): string[] {
  const block = (b: LegalBlock): string[] =>
    b.kind === 'p' ? [b.text] : b.kind === 'list' ? b.items : [b.title, ...(b.text ? [b.text] : []), ...(b.items ?? [])];
  return [doc.title, doc.fullTitle, ...doc.intro.flatMap(block), ...doc.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(block)])];
}
const all = (doc: LegalDoc) => texts(doc).join('\n');

describe('dokumenty prawne – struktura', () => {
  it('dwa dokumenty z unikalnymi id i plikami, datą i treścią', () => {
    expect(LEGAL_DOCS.map((d) => d.id)).toEqual(['regulamin', 'prywatnosc']);
    expect(new Set(LEGAL_DOCS.map((d) => d.file)).size).toBe(LEGAL_DOCS.length);
    for (const d of LEGAL_DOCS) {
      expect(d.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.sections.length).toBeGreaterThan(5);
      for (const s of d.sections) expect(s.blocks.length).toBeGreaterThan(0);
      for (const t of texts(d)) {
        expect(t.trim()).toBe(t);
        expect(t.length).toBeGreaterThan(0);
      }
      for (const b of [...d.intro, ...d.sections.flatMap((s) => s.blocks)]) {
        if (b.kind === 'list') expect(b.items.length).toBeGreaterThan(0);
        if (b.kind === 'box') expect(!!b.text || !!b.items?.length).toBe(true);
      }
    }
  });

  it('sekcje numerowane po kolei (§ 1… w regulaminie, 1.… w polityce)', () => {
    REGULAMIN.sections.forEach((s, i) => expect(s.title.startsWith(`§ ${i + 1}. `)).toBe(true));
    POLITYKA_PRYWATNOSCI.sections.forEach((s, i) => expect(s.title.startsWith(`${i + 1}. `)).toBe(true));
  });

  it('pogrubienia są sparowane', () => {
    for (const d of LEGAL_DOCS) for (const t of texts(d)) expect(t.split('**').length % 2).toBe(1);
  });

  it('szkic: placeholdery zamiast wymyślonych danych administratora', () => {
    for (const d of LEGAL_DOCS) {
      const txt = all(d);
      expect(txt).toContain('[nazwa administratora]');
      expect(txt).toContain('[adres e-mail kontaktowy]');
      expect(txt).toContain('[adres]');
      // Żadnego prawdziwego adresu e-mail ani strony administratora.
      expect(txt).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(txt).not.toMatch(/aknsoftware/i);
    }
  });
});

describe('dokumenty prawne – treść zgodna z działaniem aplikacji', () => {
  const reg = all(REGULAMIN);
  const pol = all(POLITYKA_PRYWATNOSCI);

  it('regulamin: bezpieczeństwo grzybów, wiek, zasady, zgłoszenia', () => {
    expect(reg).toContain('nigdy nie rozstrzyga o jadalności');
    expect(reg).toMatch(/grzyboznawc/);
    expect(reg).toContain('sanepid');
    expect(reg).toContain('112');
    expect(reg).toContain('16 lat');
    expect(reg).toMatch(/rezerwat/);
    expect(reg).toMatch(/nękanie/);
    expect(reg).toMatch(/cudzych miejsc grzybowych/);
    expect(reg).toContain('Zgłoś');
  });

  it('polityka: lokalizacja na telefonie, 24 h, zdjęcia, konto, podmioty, prawa', () => {
    expect(pol).toMatch(/offline/);
    expect(pol).toContain('tylko w pamięci');
    expect(pol).toContain('24 godzin');
    expect(pol).toContain('EXIF');
    expect(pol).toMatch(/prywatnym magazynie/);
    expect(pol).toMatch(/publiczne/);
    expect(pol).toMatch(/anonimowe/);
    expect(pol).toContain('Supabase');
    expect(pol).toContain('[region do wybrania');
    expect(pol).toContain('OpenFreeMap');
    expect(pol).toMatch(/numery kafli/);
    expect(pol).toMatch(/powiadomienia lokalne/);
    for (const art of ['art. 15', 'art. 16', 'art. 17', 'art. 18', 'art. 20', 'art. 21']) expect(pol).toContain(art);
    expect(pol).toContain('Prezesa Urzędu Ochrony Danych Osobowych');
    expect(pol).toContain('16 lat');
  });
});

describe('splitBold / fmtLegalDate', () => {
  it('dzieli tekst na pogrubione fragmenty', () => {
    expect(splitBold('zwykły')).toEqual([{ text: 'zwykły', bold: false }]);
    expect(splitBold('**Gmina** – opis')).toEqual([
      { text: 'Gmina', bold: true },
      { text: ' – opis', bold: false },
    ]);
    expect(splitBold('a **b** c **d**')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c ', bold: false },
      { text: 'd', bold: true },
    ]);
    // Niesparowane – bez pogrubienia.
    expect(splitBold('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
  });

  it('data po polsku', () => {
    expect(fmtLegalDate('2026-10-07')).toBe('7 października 2026');
    expect(fmtLegalDate('2027-01-31')).toBe('31 stycznia 2027');
  });
});

describe('docs/legal/*.md', () => {
  it('Markdown ma szkic, tytuł i wszystkie sekcje', () => {
    const md = legalToMarkdown(REGULAMIN);
    expect(md).toContain(`> **${LEGAL_DRAFT_NOTICE}**`);
    expect(md).toContain(`# ${REGULAMIN.fullTitle}`);
    for (const s of REGULAMIN.sections) expect(md).toContain(`## ${s.title}`);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('pliki są aktualne (npm run legal:md)', () => {
    for (const doc of LEGAL_DOCS) {
      const file = path.resolve(__dirname, '..', '..', '..', 'docs', 'legal', doc.file);
      // Git na Windows (autocrlf) może zamienić końce linii – porównujemy treść.
      const onDisk = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      expect(onDisk).toBe(legalToMarkdown(doc));
    }
  });
});
