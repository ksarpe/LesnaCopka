/**
 * Edycja profilu: walidacja pól (czyste funkcje) i wyszukiwanie gminy domowej po nazwie.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const BIO_MAX = 120;

/** Imię i nazwisko: pojedyncze spacje, bez spacji na brzegach. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Imię do powitania „Cześć, Kuba!” – pierwszy wyraz pełnej nazwy. */
export function firstNameOf(name: string): string {
  return cleanName(name).split(' ')[0] ?? '';
}

export function nameError(name: string): string | null {
  const n = cleanName(name);
  if (!n) return 'Podaj imię';
  if (n.length < NAME_MIN) return `Co najmniej ${NAME_MIN} znaki`;
  if (n.length > NAME_MAX) return `Najwyżej ${NAME_MAX} znaków`;
  return null;
}

/** Część nicku bez „@”, małymi literami (to, co gracz wpisuje w pole). */
export function handleBody(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

/** Nick zapisywany w profilu: zawsze z „@” na początku. */
export function normalizeHandle(input: string): string {
  return `@${handleBody(input)}`;
}

/** Nick: 3–20 znaków a–z, 0–9, kropka, podkreślnik; bez kropki na brzegach i dwóch kropek z rzędu. */
export function handleError(input: string): string | null {
  const body = handleBody(input);
  if (!body) return 'Podaj nick';
  if (/[^a-z0-9._]/.test(body)) return 'Tylko małe litery a–z (bez polskich znaków), cyfry, kropka i podkreślnik';
  if (body.length < HANDLE_MIN) return `Co najmniej ${HANDLE_MIN} znaki`;
  if (body.length > HANDLE_MAX) return `Najwyżej ${HANDLE_MAX} znaków`;
  if (body.startsWith('.') || body.endsWith('.')) return 'Nick nie może zaczynać się ani kończyć kropką';
  if (body.includes('..')) return 'Dwie kropki z rzędu nie są dozwolone';
  return null;
}

export function cleanBio(bio: string): string {
  // Najwyżej jedna pusta linia z rzędu, bez spacji na brzegach.
  return bio.replace(/\n{3,}/g, '\n\n').trim();
}

export function bioError(bio: string): string | null {
  return cleanBio(bio).length > BIO_MAX ? `Najwyżej ${BIO_MAX} znaków` : null;
}

const PL_FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Porównanie bez wielkości liter i polskich znaków („Suprasl” = „Supraśl”). Bez `normalize` – działa w Hermesie. */
export function foldPl(s: string): string {
  return s.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => PL_FOLD[c] ?? c);
}

/**
 * Wyszukiwanie gmin po nazwie: najpierw nazwy zaczynające się od zapytania, potem zawierające
 * (także po słowie: „mazowiecki” → „Wysokie Mazowieckie”), w obu grupach alfabetycznie.
 */
export function searchByName<T extends { name: string }>(items: readonly T[], query: string, limit = 40): T[] {
  const q = foldPl(query.trim());
  if (!q) return [];
  const starts: T[] = [];
  const contains: T[] = [];
  for (const it of items) {
    const n = foldPl(it.name);
    if (n.startsWith(q)) starts.push(it);
    else if (n.includes(q)) contains.push(it);
  }
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'pl');
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit);
}
