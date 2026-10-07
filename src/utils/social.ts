/** Logika społecznościowa feedu (komentarze, wyszukiwanie znajomych, zaproszenia) – czyste funkcje. */
import { ServiceError } from '@/services/types';

/** Maksymalna długość komentarza (znaki). */
export const COMMENT_MAX = 280;

/** Od tylu znaków pokazujemy licznik pozostałych w polu komentarza. */
export const COMMENT_COUNTER_FROM = 240;

/**
 * Tekst komentarza gotowy do wysłania: bez spacji na brzegach, maks. jedna pusta linia
 * pod rząd, przycięty do COMMENT_MAX. Pusty → null (przycisk „Wyślij” nieaktywny).
 */
export function prepareComment(raw: string): string | null {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > COMMENT_MAX ? text.slice(0, COMMENT_MAX).trimEnd() : text;
}

/** Do porównań: małe litery, bez polskich znaków, separatory nicków (_ . - @) jako spacje. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[@_.\-\s]+/g, ' ')
    .trim();
}

/**
 * Czy grzybiarz pasuje do zapytania: każde słowo zapytania występuje w nicku, imieniu i nazwisku
 * albo handlu („lukasz bor” → „Łukasz_Borowik”; „ola w” → „Ola_W”).
 */
export function matchesUserQuery(user: { name: string; fullName: string; handle: string }, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return false;
  const hay = normalizeSearch(`${user.name} ${user.fullName} ${user.handle}`);
  const glued = hay.replace(/ /g, '');
  return q.split(' ').every((t) => hay.includes(t) || glued.includes(t));
}

/** Trafność wyniku: nick zaczynający się od zapytania > początek słowa > dowolne miejsce. */
export function matchRank(user: { name: string; fullName: string }, query: string): number {
  const q = normalizeSearch(query);
  const nick = normalizeSearch(user.name);
  if (nick.startsWith(q)) return 0;
  if (` ${nick} ${normalizeSearch(user.fullName)}`.includes(` ${q}`)) return 1;
  return 2;
}

export const INVITE_BASE_URL = 'https://grzybobranie.app/zaproszenie/';

/** Link zaproszenia z handla gracza („@kuba.grzyb” → …/zaproszenie/kuba.grzyb). */
export function inviteLink(handle: string): string {
  return INVITE_BASE_URL + encodeURIComponent(handle.replace(/^@/, '').trim());
}

/** Treść zaproszenia (bez linku – link doklejamy zależnie od platformy). */
export function inviteMessage(firstName: string, handle: string): string {
  return `${firstName} zaprasza Cię do Grzybobrania! Zbieraj grzyby, odkrywaj gatunki i walcz o punkty dla swojej gminy. Znajdziesz mnie jako ${handle}.`;
}

/** Własny wpis opublikowany w telefonie, którego serwer jeszcze nie potwierdził (tryb Supabase). */
export const LOCAL_POST_PREFIX = 'local:';

export const localPostId = (tripId: string) => `${LOCAL_POST_PREFIX}${tripId}`;

/** Wpis „wysyłanie…” – reakcje i komentarze dopiero po synchronizacji. */
export const isLocalPost = (postId: string) => postId.startsWith(LOCAL_POST_PREFIX);

/** Nick z linku zaproszenia / ścieżki (`@ola.w`, `ola.w`, `%40ola.w`) → `ola.w` (małe litery). */
export function handleFromInvite(raw: string): string {
  let h = raw;
  try {
    h = decodeURIComponent(raw);
  } catch {
    // zostaje surowy tekst
  }
  return h.trim().replace(/^@+/, '').toLowerCase();
}

/** Toast po nieudanej akcji: przy braku sieci `offline`, przy odmowie serwera – jego komunikat po polsku. */
export function failText(e: unknown, offline: string): string {
  return e instanceof ServiceError && e.code !== 'NETWORK' ? e.message : offline;
}

/** Komunikat dla wpisu, który jeszcze czeka na serwer. */
export const PENDING_POST_TEXT = 'Wpis jeszcze się wysyła – reakcje i komentarze po synchronizacji';
