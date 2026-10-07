import type { Post, PostAuthor, PostComment } from '@/types';
import { hashString, mulberry32 } from '@/utils/random';

const MIN = 60_000;
const H = 60 * MIN;

/** Krótkie komentarze grzybiarzy – neutralne rodzajowo (autorami są różne osoby). */
const GENERIC = [
  'Piękne zbiory, gratulacje!',
  'Darz grzyb!',
  'Ale kosz! Zazdroszczę.',
  'U nas po deszczu też ruszyło, jutro idę.',
  'W Puszczy wysyp – potwierdzam, wczoraj było to samo.',
  'U nas sucho jak pieprz, same zajączki.',
  'Rano mgła, potem słońce – idealna pogoda na grzyby.',
  'Nie pytam gdzie, wiem, że i tak nie powiesz :)',
  'Szacun za dystans!',
  'Wybieram się w weekend, oby coś zostało.',
  'Zdrowe czy robaczywe?',
  'Suszyć czy marynować? :)',
  'Takie poranki to ja rozumiem.',
  'Ile z tego pójdzie na sos?',
  'Mój rekord w tym sezonie to połowa tego.',
  'Brawo, piękna robota!',
  'Też tam chodzę i pusto – masz nosa!',
  'Zabierz mnie następnym razem!',
  'Komary nie zjadły? :)',
  'Po takim deszczu musiało sypnąć.',
  'Kurki już są czy jeszcze za wcześnie?',
  'Pamiętajcie o sobowtórach, w tym roku dużo szatanów.',
  'Kosz pełny, a nogi pewnie czują każdy kilometr.',
  'No i mam motywację na jutro.',
];

/** Komentarze z nawiązaniem do okazu z wpisu. */
const HIGHLIGHT = [(hl: string) => `${hl}? Okaz życia!`, (hl: string) => `Ten okaz to bajka – ${hl.toLowerCase()}!`];

/** Komentarze znajomych pod wpisem gracza (pojawiają się, gdy wpis stanie się widoczny dla innych). */
const FOR_PLAYER = ['Gratulacje, piękna wyprawa!', 'Darz grzyb!', 'No proszę, i to bez nas :)', 'Następnym razem idziemy razem.', 'Ładny wynik, gratki!'];

/** Liczba komentarzy wpisu, którą trzeba wygenerować (pole `comments` mają tylko wyprawy). */
export function commentCount(post: Post): number {
  return post.kind === 'trip' ? post.comments : 0;
}

/**
 * Komentarze „z serwera” dla wpisu – deterministyczne (seed = id wpisu): dokładnie `count` sztuk,
 * autorzy z puli (bez autora wpisu, bez dwóch takich samych pod rząd), czasy rosnąco
 * między `visibleFrom` a `now` (pierwsze ~30 h życia wpisu).
 */
export function generateComments(post: Post, count: number, authors: PostAuthor[], now: number): PostComment[] {
  const pool = authors.filter((a) => a.id !== post.author.id);
  if (count <= 0 || pool.length === 0) return [];
  const rnd = mulberry32(hashString(`comments:${post.id}`));

  // Teksty: przetasowana pula (bez powtórek, dopóki starczy), okaz z wpisu na początku.
  const texts = [...GENERIC];
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  const hl = post.kind === 'trip' ? post.highlight?.text : undefined;
  if (hl) texts.splice(1, 0, HIGHLIGHT[Math.floor(rnd() * HIGHLIGHT.length)](hl));

  // Czasy: przyrosty o losowych wagach, rozłożone na dostępne okno.
  const start = Math.max(new Date(post.createdAt).getTime(), new Date(post.visibleFrom).getTime());
  const span = Math.max(count * MIN, Math.min(now - start, 30 * H) * 0.9);
  const weights = Array.from({ length: count }, () => 0.25 + rnd());
  const sum = weights.reduce((a, b) => a + b, 0);

  let last = -1;
  let acc = 0;
  return weights.map((w, i) => {
    acc += w;
    let idx = Math.floor(rnd() * pool.length);
    if (idx === last && pool.length > 1) idx = (idx + 1) % pool.length;
    last = idx;
    const at = Math.min(now - (count - i) * 1000, start + Math.round((acc / sum) * span));
    return {
      id: `c-${post.id}-${i}`,
      postId: post.id,
      author: pool[idx],
      text: texts[i % texts.length],
      createdAt: new Date(Math.max(start + 1000, at)).toISOString(),
    };
  });
}

/** Opóźnienia komentarzy znajomych pod wpisem gracza – liczone od chwili, gdy inni go zobaczą. */
const PLAYER_POST_DELAYS = [25 * MIN, 2 * H + 10 * MIN, 7 * H];

/**
 * Komentarze znajomych pod wpisem gracza, które do `now` „już padły” (1–3 na wpis, deterministycznie).
 * Wpis gracza jest niewidoczny dla innych przez 24 h – wcześniej nikt go nie skomentuje.
 */
export function dueFriendComments(post: Post, friends: PostAuthor[], now: number): PostComment[] {
  if (friends.length === 0) return [];
  const from = new Date(post.visibleFrom).getTime();
  const rnd = mulberry32(hashString(`player-post:${post.id}`));
  const n = 1 + Math.floor(rnd() * PLAYER_POST_DELAYS.length);
  const out: PostComment[] = [];
  for (let k = 0; k < n; k++) {
    const at = from + PLAYER_POST_DELAYS[k];
    const author = friends[Math.floor(rnd() * friends.length)];
    const text = FOR_PLAYER[Math.floor(rnd() * FOR_PLAYER.length)];
    if (at > now) break;
    out.push({ id: `c-${post.id}-f${k}`, postId: post.id, author, text, createdAt: new Date(at).toISOString() });
  }
  return out;
}
