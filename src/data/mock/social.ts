import type { CompactPost, Post, PostAuthor, Rarity, TripPost } from '@/types';
import { hashString, mulberry32 } from '@/utils/random';
import { AUTHORS } from './users';

/** Grzybiarz z puli mocków (bez flagi `friend` – tę ustala „serwer” z listy znajomych). */
export interface MockPlayer extends PostAuthor {
  fullName: string;
  handle: string;
  homeGminaId: string;
  tripsCount: number;
}

/** Pula grzybiarzy: autorzy wpisów z makiety + osoby do znalezienia w wyszukiwarce. */
export const PLAYERS: MockPlayer[] = [
  { ...AUTHORS.ola, fullName: 'Aleksandra Wiśniewska', handle: '@ola.w', homeGminaId: 'suprasl', tripsCount: 212 },
  { ...AUTHORS.marek, fullName: 'Marek Kowalczyk', handle: '@marek.k', homeGminaId: 'suprasl', tripsCount: 148 },
  { ...AUTHORS.bartek, fullName: 'Bartłomiej Zieliński', handle: '@bartek.z', homeGminaId: 'michalowo', tripsCount: 61 },
  { ...AUTHORS.ewa, fullName: 'Ewa Lewandowska', handle: '@ewa.las', homeGminaId: 'suprasl', tripsCount: 97 },
  { ...AUTHORS.kasia, fullName: 'Katarzyna Piotrowska', handle: '@kasia.p', homeGminaId: 'grodek', tripsCount: 73 },
  { ...AUTHORS.tomek, fullName: 'Tomasz Borowski', handle: '@tomek.b', homeGminaId: 'suprasl', tripsCount: 52 },
  { ...AUTHORS.grzybiarz, fullName: 'Paweł Grzybowski', handle: '@grzybiarz77', homeGminaId: 'suprasl', tripsCount: 34 },
  { id: 'u-zosia', name: 'Zosia_Kania', level: 22, ringRarity: 'epicki', fullName: 'Zofia Kamińska', handle: '@zosia.kania', homeGminaId: 'hajnowka', tripsCount: 133 },
  { id: 'u-jurek', name: 'Jurek_z_Puszczy', level: 31, ringRarity: 'legendarny', fullName: 'Jerzy Sokołowski', handle: '@jurek.puszcza', homeGminaId: 'bialowieza', tripsCount: 402 },
  { id: 'u-lukasz', name: 'Łukasz_Borowik', level: 16, ringRarity: 'rzadki', fullName: 'Łukasz Wójcik', handle: '@lukasz.borowik', homeGminaId: 'michalowo', tripsCount: 88 },
  { id: 'u-gosia', name: 'Gosia_Podgrzybek', level: 19, ringRarity: 'epicki', fullName: 'Małgorzata Jankowska', handle: '@gosia.pg', homeGminaId: 'grodek', tripsCount: 109 },
  { id: 'u-magda', name: 'MagdaLeśna', level: 13, ringRarity: 'pospolity', fullName: 'Magdalena Szymańska', handle: '@magda.lesna', homeGminaId: 'narewka', tripsCount: 47 },
  { id: 'u-ania', name: 'Ania.Rydz', level: 8, ringRarity: 'rzadki', fullName: 'Anna Rydzewska', handle: '@ania.rydz', homeGminaId: 'wasilkow', tripsCount: 21 },
  { id: 'u-piotrek', name: 'Piotrek_Kurka', level: 5, ringRarity: 'pospolity', fullName: 'Piotr Dąbrowski', handle: '@piotrek.kurka', homeGminaId: 'czarna-bialostocka', tripsCount: 12 },
  { id: 'u-wojtek', name: 'Wojtek.Sitarz', level: 3, ringRarity: 'pospolity', fullName: 'Wojciech Mazur', handle: '@wojtek.sitarz', homeGminaId: 'knyszyn', tripsCount: 6 },
];

export function playerById(id: string): MockPlayer | undefined {
  return PLAYERS.find((p) => p.id === id);
}

/**
 * Znajomi na starcie: autorzy wpisów z zakładki „Znajomi” w makiecie i z puli odświeżania.
 * Dzięki temu feed startowy jest 1:1 jak w makiecie (Ewa ma tam wpis tylko w „Moja gmina”).
 */
export const DEFAULT_FRIEND_IDS = ['u-ola', 'u-marek', 'u-bartek', 'u-ewa', 'u-kasia', 'u-tomek'];

export const toAuthor = (p: MockPlayer): PostAuthor => ({ id: p.id, name: p.name, level: p.level, ringRarity: p.ringRarity });

const H = 3600_000;
const D = 24 * H;

const TRIP_TITLES = [
  'Szybki obchód przed pracą',
  'Niedzielny spacer z koszykiem',
  'Podgrzybki po nocnym deszczu',
  'Kurki na skraju boru',
  'Rodzinne grzybobranie',
  'Mgła, mech i pełny kosz',
];

const HIGHLIGHTS: { rarity: Rarity; text: string }[] = [
  { rarity: 'rzadki', text: 'Borowik szlachetny 380 g' },
  { rarity: 'rzadki', text: 'Koźlarz czerwony 290 g' },
  { rarity: 'epicki', text: 'Czubajka kania 31 cm' },
  { rarity: 'rzadki', text: 'Pieprznik jadalny ×24' },
];

/**
 * Dwa wpisy nowo dodanego znajomego (wyprawa + krótki wpis) – deterministyczne dla danej osoby,
 * żeby po ponownym dodaniu wyglądały tak samo. Czas względem chwili dodania.
 */
export function friendPosts(player: MockPlayer, now: number): Post[] {
  const rnd = mulberry32(hashString(`friend:${player.id}`));
  const author = toAuthor(player);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const tripAge = 2 * H + Math.round(rnd() * 8 * H);
  const compactAge = D + Math.round(rnd() * 2 * D);
  const at = (age: number) => new Date(now - age).toISOString();
  const mushrooms = 4 + Math.floor(rnd() * 15);
  const trip: TripPost = {
    id: `p-${player.id}-f1`,
    kind: 'trip',
    author,
    gminaId: player.homeGminaId,
    createdAt: at(tripAge),
    publishedAt: at(tripAge),
    visibleFrom: at(tripAge - 1),
    scopes: ['friends', 'gmina'],
    title: pick(TRIP_TITLES),
    distanceKm: Math.round((2 + rnd() * 5) * 10) / 10,
    durationMin: 60 + Math.floor(rnd() * 140),
    mushrooms,
    species: 2 + Math.floor(rnd() * 4),
    xp: mushrooms * (70 + Math.floor(rnd() * 40)),
    routePrecision: rnd() < 0.5 ? 'approximate' : 'gmina',
    highlight: rnd() < 0.6 ? pick(HIGHLIGHTS) : undefined,
    reactions: 2 + Math.floor(rnd() * 28),
    reacted: false,
    comments: Math.floor(rnd() * 5),
  };
  const compactMushrooms = 3 + Math.floor(rnd() * 9);
  const compact: CompactPost = {
    id: `p-${player.id}-f2`,
    kind: 'compact',
    author,
    gminaId: player.homeGminaId,
    createdAt: at(compactAge),
    publishedAt: at(compactAge),
    visibleFrom: at(compactAge - 1),
    scopes: ['friends'],
    distanceKm: Math.round((1.5 + rnd() * 3) * 10) / 10,
    mushrooms: compactMushrooms,
    species: 1 + Math.floor(rnd() * 3),
    xp: compactMushrooms * 60,
    thumbs: [rnd() < 0.3 ? 'rzadki' : 'pospolity', 'pospolity', rnd() < 0.2 ? 'epicki' : 'pospolity'],
  };
  return [trip, compact];
}

/**
 * Wstawia wpisy wg daty: przed pierwszym starszym wpisem (lista startowa ma kolejność z makiety,
 * nie chronologiczną – nowe wpisy lądują możliwie wysoko, ale nie nad świeższymi).
 */
export function insertByDate(posts: Post[], add: Post[]): Post[] {
  const out = [...posts];
  for (const p of add) {
    const t = new Date(p.createdAt).getTime();
    const idx = out.findIndex((x) => new Date(x.createdAt).getTime() < t);
    if (idx < 0) out.push(p);
    else out.splice(idx, 0, p);
  }
  return out;
}
