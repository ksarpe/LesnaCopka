/**
 * Feed z serwera (RPC `get_feed`, `get_comments`, `search_users`, `get_activity`…) → typy aplikacji.
 * Czyste funkcje bez zależności od React Native (testy: ./__tests__/feedMap.test.ts). Parsowanie obronne:
 * brakujące pola dostają wartości neutralne, nieznane rodzaje wpisów / aktywności są pomijane.
 * Kontrakt (camelCase jsonb, `payload` wpisu w snake_case jak w bazie): docs/backend.md.
 */
import type {
  ActivityItem,
  ActivityKind,
  BlockedUser,
  FriendsOverview,
  FriendStatus,
  LevelUpPost,
  Post,
  PostAuthor,
  PostComment,
  PostScope,
  Rarity,
  RoutePrecision,
  SocialUser,
  TripPost,
  UserAvatar,
} from '@/types';
import { highlightText } from '@/utils/tripPost';
import { ServiceError, type ServiceErrorCode } from '../types';
import { BUCKETS, publicObjectUrl } from './storagePaths';
import { classifyError, type SyncError } from './syncRpc';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(num(v, NaN)) ? num(v) : null);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** Odpowiedź RPC: tablica, obiekt albo JSON w tekście. */
const parse = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};
const list = (raw: unknown): unknown[] => {
  const r = parse(raw);
  return Array.isArray(r) ? r : [];
};

const RARITIES: Rarity[] = ['pospolity', 'rzadki', 'epicki', 'legendarny'];
const FRIEND_STATUSES: FriendStatus[] = ['none', 'friends', 'outgoing', 'incoming'];
const ACTIVITY_KINDS: ActivityKind[] = [
  'reaction',
  'comment',
  'friend_request',
  'friend_accepted',
  // Rywalizacja (docs/rywalizacja.md §5).
  'duel_invite',
  'duel_accepted',
  'duel_finished',
  'contest_award',
  'contest_overtaken',
];
const SCOPES: PostScope[] = ['friends', 'gmina'];

/** Kontekst telefonu dla własnych wpisów: okładka ze zdjęcia znaleziska i avatar gracza. */
export interface PostMapContext {
  /** Znalezisko ze zdjęciem z tej wyprawy (Find.photoUri) – własny wpis pokazuje lokalne zdjęcie przed okładką z serwera. */
  coverFindId?: (tripId: string) => string | undefined;
  /** Avatar gracza (także zdjęcie) – do jego wpisów i komentarzy. */
  selfAvatar?: UserAvatar;
}

/* ───────────────────────── Autor, grzybiarz ───────────────────────── */

export function mapFriendStatus(raw: unknown): FriendStatus {
  const v = parse(raw);
  const s = isObj(v) ? (v.friendStatus ?? v.status) : Array.isArray(v) ? v[0] : v;
  return FRIEND_STATUSES.includes(s as FriendStatus) ? (s as FriendStatus) : 'none';
}

/**
 * `{id, handle, name, level, avatarPreset, avatarPath, ringRarity}` → PostAuthor (nick z „@”). Avatar: zdjęcie
 * (`avatarPath` → publiczny adres z koszyka `avatars`) ma pierwszeństwo przed motywem.
 */
export function mapAuthor(raw: unknown): PostAuthor {
  const a = isObj(raw) ? raw : {};
  const ring = str(a.ringRarity);
  const handle = str(a.handle).trim();
  const preset = strOrNull(a.avatarPreset);
  const photo = strOrNull(a.avatarPath);
  const author: PostAuthor = {
    id: str(a.id),
    name: str(a.name) || (handle ? handle.replace(/^@+/, '') : 'Grzybiarz'),
    level: Math.max(1, num(a.level, 1)),
    ringRarity: ring === 'primary' || RARITIES.includes(ring as Rarity) ? (ring as PostAuthor['ringRarity']) : 'pospolity',
  };
  if (handle) author.handle = handle.startsWith('@') ? handle : `@${handle}`;
  if (photo) author.avatar = { kind: 'photo', uri: publicObjectUrl(BUCKETS.avatars, photo) };
  else if (preset) author.avatar = { kind: 'preset', id: preset };
  return author;
}

/** Grzybiarz (autor + gmina, liczniki i relacja z graczem). */
export function mapSocialUser(raw: unknown): SocialUser | null {
  const u = parse(raw);
  if (!isObj(u) || !str(u.id)) return null;
  const author = mapAuthor(u);
  const friendStatus = mapFriendStatus(u.friendStatus);
  const user: SocialUser = {
    ...author,
    handle: author.handle ?? '',
    // Serwer nie udostępnia imienia i nazwiska innych – w UI zamiast niego nick.
    fullName: str(u.fullName),
    homeGminaId: str(u.homeGminaId),
    tripsCount: num(u.tripsCount),
    mushroomsCount: num(u.mushroomsCount),
    friendStatus,
    friend: friendStatus === 'friends',
  };
  const species = numOrNull(u.speciesCount);
  if (species != null) user.speciesCount = species;
  // Etap 6: czy gracz go zablokował.
  if (u.blocked === true) user.blocked = true;
  return user;
}

export function mapSocialUsers(raw: unknown): SocialUser[] {
  return list(raw)
    .map(mapSocialUser)
    .filter((u): u is SocialUser => !!u);
}

/** `get_blocked_users()` → zablokowani (autor + `blockedAt`), od ostatnio zablokowanego. */
export function mapBlockedUsers(raw: unknown): BlockedUser[] {
  return list(raw)
    .filter(isObj)
    .filter((u) => !!str(u.id))
    .map((u) => {
      const a = mapAuthor(u);
      return { ...a, handle: a.handle ?? '', blockedAt: str(u.blockedAt) };
    });
}

/** `get_friends()` → `{friends, incoming, outgoing}`. */
export function mapFriendsOverview(raw: unknown): FriendsOverview {
  const r = parse(raw);
  const o = isObj(r) ? r : Array.isArray(r) && isObj(r[0]) ? r[0] : {};
  return { friends: mapSocialUsers(o.friends), incoming: mapSocialUsers(o.incoming), outgoing: mapSocialUsers(o.outgoing) };
}

/* ───────────────────────── Wpisy ───────────────────────── */

/**
 * Wpis z serwera; własny dostaje okładkę z telefonu i avatar gracza. Okładka z serwera (`coverPath` → publiczny adres
 * z koszyka `post-media`) – dla wszystkich wpisów. Nieznany rodzaj → null.
 */
export function mapPost(raw: unknown, ctx: PostMapContext = {}): Post | null {
  const r = parse(raw);
  if (!isObj(r) || !str(r.id)) return null;
  const mine = r.mine === true;
  const author = mapAuthor(r.author);
  if (mine && ctx.selfAvatar) author.avatar = ctx.selfAvatar;
  const createdAt = str(r.createdAt);
  const p = isObj(r.payload) ? r.payload : isObj(parse(r.payload)) ? (parse(r.payload) as Obj) : {};
  const scopes = Array.isArray(r.scopes) ? r.scopes.filter((s): s is PostScope => SCOPES.includes(s as PostScope)) : [];
  const base = {
    id: str(r.id),
    author,
    gminaId: str(r.gminaId),
    createdAt,
    publishedAt: str(r.publishedAt) || createdAt,
    visibleFrom: str(r.visibleFrom) || createdAt,
    scopes: scopes.length ? scopes : (['friends', 'gmina'] as PostScope[]),
  };
  if (r.kind === 'levelup') {
    const post: LevelUpPost = { ...base, kind: 'levelup', level: Math.max(1, num(p.level, author.level)) };
    const badge = strOrNull(p.badge_name) ?? strOrNull(p.badgeName);
    if (badge) post.badgeName = badge;
    return post;
  }
  if (r.kind !== 'trip') return null;
  const tripId = strOrNull(r.tripId);
  const hl = isObj(p.highlight) ? p.highlight : null;
  const rarity = hl && RARITIES.includes(hl.rarity as Rarity) ? (hl.rarity as Rarity) : null;
  const post: TripPost = {
    ...base,
    kind: 'trip',
    title: str(p.title) || 'Wyprawa po grzyby',
    distanceKm: Math.round(num(p.distance_km) * 10) / 10,
    durationMin: Math.round(num(p.duration_min)),
    mushrooms: num(p.mushrooms),
    species: num(p.species),
    xp: num(p.xp),
    routePrecision: (r.routePrecision === 'approximate' ? 'approximate' : 'gmina') as RoutePrecision,
    reactions: num(r.reactions),
    reacted: r.reacted === true,
    comments: num(r.comments),
  };
  if (hl && rarity && str(hl.species)) {
    post.highlight = { rarity, text: highlightText(str(hl.species), numOrNull(hl.weight_g), numOrNull(hl.cap_cm)) };
  }
  if (tripId) post.tripId = tripId;
  const coverPath = strOrNull(r.coverPath) ?? strOrNull(p.cover_path);
  if (coverPath) post.coverUrl = publicObjectUrl(BUCKETS.posts, coverPath);
  if (mine) {
    post.mine = true;
    const cover = tripId ? ctx.coverFindId?.(tripId) : undefined;
    if (cover) post.coverFindId = cover;
  }
  return post;
}

export function mapPosts(raw: unknown, ctx: PostMapContext = {}): Post[] {
  return list(raw)
    .map((x) => mapPost(x, ctx))
    .filter((p): p is Post => !!p);
}

/** `toggle_reaction` – obiekt albo tablica z jednym wierszem (funkcja z parametrami OUT). */
export function mapReaction(raw: unknown): { reacted: boolean; reactions: number } {
  const r = parse(raw);
  const o = Array.isArray(r) ? r[0] : r;
  if (!isObj(o)) return { reacted: false, reactions: 0 };
  return { reacted: o.reacted === true, reactions: Math.max(0, num(o.reactions)) };
}

/* ───────────────────────── Komentarze ───────────────────────── */

export function mapComment(raw: unknown, ctx: PostMapContext = {}): PostComment | null {
  const c = parse(raw);
  if (!isObj(c) || !str(c.id)) return null;
  const mine = c.mine === true;
  const author = mapAuthor(c.author);
  if (mine && ctx.selfAvatar) author.avatar = ctx.selfAvatar;
  const comment: PostComment = { id: str(c.id), postId: str(c.postId), author, text: str(c.text), createdAt: str(c.createdAt) };
  if (mine) comment.mine = true;
  return comment;
}

export function mapComments(raw: unknown, ctx: PostMapContext = {}): PostComment[] {
  return list(raw)
    .map((x) => mapComment(x, ctx))
    .filter((c): c is PostComment => !!c)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/* ───────────────────────── Aktywność ───────────────────────── */

/** Aktywność (`get_activity`); rywalizacja dokłada `refId` (pojedynek / walka) i `meta` (jsonb – też jako tekst). */
export function mapActivity(raw: unknown): ActivityItem[] {
  return list(raw)
    .filter(isObj)
    .filter((a) => !!str(a.id) && ACTIVITY_KINDS.includes(a.kind as ActivityKind) && !!str(a.createdAt))
    .map((a) => {
      const item: ActivityItem = {
        id: str(a.id),
        kind: a.kind as ActivityKind,
        actor: mapAuthor(a.actor),
        postId: strOrNull(a.postId),
        text: strOrNull(a.text),
        createdAt: str(a.createdAt),
      };
      const refId = strOrNull(a.refId);
      const meta = parse(a.meta);
      if (refId) item.refId = refId;
      if (isObj(meta)) item.meta = meta;
      return item;
    });
}

/* ───────────────────────── Wpisy czekające w telefonie ───────────────────────── */

const ms = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * Feed z serwera + własne wpisy „wysyłanie…” z telefonu (na górze, najnowsze pierwsze). Wpis lokalny znika,
 * gdy serwer zwrócił wpis tej samej wyprawy (`confirmed` – do usunięcia z listy w telefonie). Zakres
 * „Moja gmina” pokazuje lokalny wpis tylko z gminy domowej (jak serwer).
 */
export function mergeLocalPosts(
  server: Post[],
  local: TripPost[],
  scope: PostScope,
  homeGminaId: string,
): { posts: Post[]; confirmed: string[] } {
  const serverTrips = new Set(server.flatMap((p) => (p.kind === 'trip' && p.tripId ? [p.tripId] : [])));
  const confirmed = local.flatMap((p) => (p.tripId && serverTrips.has(p.tripId) ? [p.tripId] : []));
  const pending = local
    .filter((p) => !(p.tripId && serverTrips.has(p.tripId)))
    .filter((p) => scope === 'friends' || p.gminaId === homeGminaId)
    .sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt));
  return { posts: [...pending, ...server], confirmed };
}

/* ───────────────────────── Błędy ───────────────────────── */

/** Stabilne kody błędów serwera (`raise exception '<kod>'`) → kod aplikacji i komunikat po polsku. */
const KNOWN: Record<string, [ServiceErrorCode, string]> = {
  post_not_found: ['NOT_FOUND', 'Ten wpis już nie istnieje'],
  comment_not_found: ['NOT_FOUND', 'Komentarz już nie istnieje'],
  user_not_found: ['NOT_FOUND', 'Nie znaleziono grzybiarza'],
  trip_not_found: ['NOT_FOUND', 'Nie znaleziono wyprawy'],
  invalid_comment: ['SERVER', 'Komentarz jest pusty albo za długi'],
  trip_not_finished: ['SERVER', 'Koniec wyprawy jeszcze nie dotarł na serwer – spróbuj za chwilę'],
  invalid_user: ['SERVER', 'Nie możesz zaprosić samego siebie'],
  comment_id_conflict: ['SERVER', 'Nie udało się zapisać komentarza – spróbuj ponownie'],
  invalid_reason: ['SERVER', 'Powód zgłoszenia jest za długi'],
  dev_tools_disabled: ['SERVER', 'Narzędzia dev są wyłączone na serwerze (app_config.dev_tools)'],
  // Etap 4 – rankingi i statystyki gmin.
  gmina_not_found: ['NOT_FOUND', 'Nie znaleziono gminy'],
  invalid_voivodeship: ['NOT_FOUND', 'Nieznane województwo'],
  challenge_inactive: ['SERVER', 'To wyzwanie gminy już się zakończyło'],
  // Etap 6 – blokowanie (zaproszenie między zablokowanymi).
  blocked: ['SERVER', 'Nie możecie zostać znajomymi – jedno z Was zablokowało drugie'],
};

/**
 * RPC rywalizacji (docs/rywalizacja.md §7): opis z serwera (`detail`, zdanie dla gracza) wygrywa z tekstami z KNOWN –
 * te są pisane pod feed i znajomych (np. `blocked` = „Nie możecie zostać znajomymi…”).
 */
const DETAIL_FIRST_RPC = new Set([
  'get_contest_week',
  'get_contest_board',
  'get_contest_eligibility',
  'enter_contest',
  'withdraw_contest_entry',
  'report_contest_entry',
  'get_trophies',
  'get_duels',
  'get_duel',
  'create_duel',
  'respond_duel',
  'cancel_duel',
  'get_player_ranking',
  'set_ranking_visibility',
  'get_rivalry_status',
]);
/** RPC z `p_duel_id uuid`: id spoza formatu (np. stary link z mocków) = 22P02 → „nie ma takiego pojedynku”. */
const DUEL_ID_RPC = new Set(['get_duel', 'respond_duel', 'cancel_duel']);

/**
 * Błąd wywołania RPC → ServiceError: sieć → NETWORK, P0002 → NOT_FOUND, reszta → SERVER (po polsku). Kody spoza
 * listy z polskim opisem z serwera (`detail` – np. rywalizacja: `not_friends`, `duel_limit`, `rate_limited`) → ten opis;
 * w RPC rywalizacji (`fn`) opis z serwera ma pierwszeństwo także przed listą.
 */
export function toServiceError(e: SyncError, fn?: string): ServiceError {
  const detail = e.details?.trim();
  const usableDetail = (e.code === 'P0001' || e.code === 'P0002') && !!detail && !detail.startsWith('retry_after=');
  const fromDetail = () => new ServiceError(e.code === 'P0002' ? 'NOT_FOUND' : 'SERVER', detail!);
  if (fn && DETAIL_FIRST_RPC.has(fn)) {
    if (usableDetail) return fromDetail();
    if (e.code === '22P02' && DUEL_ID_RPC.has(fn)) return new ServiceError('NOT_FOUND', 'Nie ma takiego pojedynku');
  }
  const exact = Object.prototype.hasOwnProperty.call(KNOWN, e.message) ? KNOWN[e.message] : undefined;
  if (exact) return new ServiceError(exact[0], exact[1]);
  if (usableDetail) return fromDetail();
  const key = Object.keys(KNOWN).find((k) => e.message.includes(k));
  if (key) return new ServiceError(KNOWN[key][0], KNOWN[key][1]);
  const kind = classifyError(e);
  if (kind === 'network' || kind === 'auth') return new ServiceError('NETWORK', 'Brak połączenia z serwerem');
  if (e.code === 'P0002') return new ServiceError('NOT_FOUND', 'Nie znaleziono');
  if (e.code === '42501') return new ServiceError('PERMISSION', 'Brak uprawnień do tej akcji');
  if (e.code === 'PGRST202') return new ServiceError('SERVER', 'Serwer nie ma jeszcze tej funkcji – wgraj najnowsze migracje');
  return new ServiceError('SERVER', 'Serwer nie przyjął żądania – spróbuj ponownie');
}
