/**
 * „Pobierz moje dane” (RODO art. 15 / 20) – czyste funkcje: dane zapisane tylko w telefonie i scalenie ich
 * z eksportem z serwera (`export_my_data`, tryb Supabase). Testy: src/utils/__tests__/exportData.test.ts.
 *
 * Plik: `{...eksport z serwera, "local": {...}}`; tryb mock (bez serwera) – sam `local` z nagłówkiem formatu.
 * Zdjęcia zostają ścieżkami plików (na webie zdjęcie w pamięci przeglądarki to znacznik, nie treść).
 */
import type { AcceptedChallenge, UserState } from '@/store/useUserStore';
import type { Find, Trip, User } from '@/types';
import { isDataUri } from './findPhoto';

export const EXPORT_FORMAT = 'grzybobranie-export-v1';

type UserData = Omit<UserState, 'patch' | 'reset'>;

export interface LocalExportInput {
  user: Pick<
    UserData,
    'user' | 'atlas' | 'badges' | 'achievements' | 'counters' | 'challenges' | 'followedGminy' | 'lastActiveDate' | 'onboarded' | 'terms'
  >;
  trips: Record<string, Trip>;
  finds: Record<string, Find>;
  settings: { hideRouteByDefault: boolean; notifications: { prefs: Record<string, boolean>; reminderHour: number } };
  notifications: { kind: string; title: string; body: string; createdAt: string; read: boolean }[];
  /** Tryb mock: znajomi i zablokowani z „serwera” mocków (nicki). */
  social?: { friends: string[]; blocked: { handle: string; name: string; blockedAt: string }[] };
}

export interface ExportMeta {
  backend: 'supabase' | 'mock';
  appVersion: string;
  platform: string;
}

/** Zdjęcie znaleziska / avatara w eksporcie: ścieżka pliku; data URI (web) – tylko informacja, że jest. */
export function photoRef(uri: string | undefined): string | null {
  if (!uri) return null;
  return isDataUri(uri) ? 'zdjęcie zapisane w pamięci przeglądarki (data URI – pominięte)' : uri;
}

function avatarOf(user: User) {
  const a = user.avatar;
  if (!a) return null;
  return a.kind === 'preset' ? { kind: 'preset', id: a.id } : { kind: 'photo', file: photoRef(a.uri), serverPath: a.path ?? null };
}

const challengeOf = (c: AcceptedChallenge) => ({
  id: c.id,
  gminaId: c.gminaId,
  title: c.title,
  speciesId: c.speciesId,
  acceptedAt: c.acceptedAt,
  completedAt: c.completedAt ?? null,
});

/** Dane z telefonu (część „local” eksportu). */
export function buildLocalExport(input: LocalExportInput) {
  const u = input.user;
  const trips = Object.values(input.trips)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((t) => ({
      id: t.id,
      gminaId: t.gminaId,
      status: t.status,
      startedAt: t.startedAt,
      endedAt: t.endedAt ?? null,
      durationMin: Math.round(t.elapsedMs / 60000),
      distanceKm: Math.round(t.distanceKm * 1000) / 1000,
      xp: t.xp,
      hideRoute: t.hideRoute,
      published: t.status === 'published',
      findIds: [...t.findIds],
    }));
  const finds = Object.values(input.finds)
    .sort((a, b) => a.foundAt.localeCompare(b.foundAt))
    .map((f) => ({
      id: f.id,
      tripId: f.tripId,
      speciesId: f.speciesId,
      gminaId: f.gminaId,
      rarity: f.rarity,
      confidence: f.confidence,
      xxl: f.xxl,
      dimensions: { ...f.dimensions },
      collected: f.collected,
      status: f.status,
      foundAt: f.foundAt,
      xp: f.xp?.total ?? null,
      photo: photoRef(f.photoUri),
      photoServerPath: f.photoPath ?? null,
    }));
  return {
    about:
      'Dane zapisane na tym telefonie: profil (z opisem „O mnie”), ustawienia, centrum powiadomień, wyprawy i znaleziska ' +
      '(zdjęcia jako ścieżki plików). Ślad GPS wypraw nie jest zapisywany, więc go tu nie ma.',
    profile: {
      id: u.user.id,
      name: u.user.name,
      firstName: u.user.firstName,
      handle: u.user.handle,
      bio: u.user.bio ?? null,
      avatar: avatarOf(u.user),
      homeGminaId: u.user.homeGminaId,
      level: u.user.level,
      xpInLevel: u.user.xp,
      streakDays: u.user.streakDays,
      tripsCount: u.user.tripsCount,
      mushroomsCount: u.user.mushroomsCount,
      lastActiveDate: u.lastActiveDate || null,
    },
    onboarding: { completed: u.onboarded, termsVersion: u.terms?.version ?? null, termsAcceptedAt: u.terms?.acceptedAt ?? null },
    game: {
      atlas: Object.entries(u.atlas)
        .map(([speciesId, e]) => ({ speciesId, ...e }))
        .sort((a, b) => a.firstFoundAt.localeCompare(b.firstFoundAt)),
      badges: [...u.badges],
      achievements: { ...u.achievements },
      counters: { ...u.counters },
      challenges: u.challenges.map(challengeOf),
      followedGminy: [...u.followedGminy],
    },
    trips,
    finds,
    settings: {
      hideRouteByDefault: input.settings.hideRouteByDefault,
      notifications: { ...input.settings.notifications, prefs: { ...input.settings.notifications.prefs } },
    },
    notifications: input.notifications.map((n) => ({ kind: n.kind, title: n.title, body: n.body, createdAt: n.createdAt, read: n.read })),
    ...(input.social ? { social: { friends: [...input.social.friends], blocked: input.social.blocked.map((b) => ({ ...b })) } } : {}),
  };
}

export type LocalExport = ReturnType<typeof buildLocalExport>;

/**
 * Plik eksportu. Z serwerem: jego eksport (format, userId, account, profile, trips…) + `local` i `app`.
 * Bez serwera (mock): nagłówek formatu + `local`. Klucz `local` z serwera (gdyby był) nadpisujemy danymi telefonu.
 */
export function mergeExport(server: Record<string, unknown> | null, local: LocalExport, meta: ExportMeta, now: Date) {
  const app = { version: meta.appVersion, platform: meta.platform, backend: meta.backend };
  if (server) return { ...server, app, local };
  return {
    format: EXPORT_FORMAT,
    exportedAt: now.toISOString(),
    source: 'device',
    note: 'Tryb bez serwera – wszystkie dane są tylko na tym telefonie.',
    userId: local.profile.id,
    app,
    local,
  };
}

/** `grzybobranie-eksport-2026-10-07.json` (data lokalna). */
export function exportFileName(now: Date): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `grzybobranie-eksport-${d}.json`;
}
