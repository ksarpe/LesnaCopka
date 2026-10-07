import { describe, expect, it, jest } from '@jest/globals';

import { initialUserState } from '@/store/useUserStore';
import type { Find, Trip } from '@/types';
import { buildLocalExport, EXPORT_FORMAT, exportFileName, mergeExport, photoRef, type LocalExportInput } from '../exportData';

// jest.mock jest wynoszony nad importy (babel-jest) – store'y dostają AsyncStorage z pamięci.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const NOW = new Date(2026, 9, 7, 9, 30);

const TRIP: Trip = {
  id: 't1',
  gminaId: 'suprasl',
  status: 'published',
  startedAt: '2026-10-06T06:00:00.000Z',
  endedAt: '2026-10-06T08:00:00.000Z',
  elapsedMs: 2 * 3600_000,
  segmentStartedAt: 0,
  distanceKm: 5.4321,
  findIds: ['f1'],
  xp: 290,
  hideRoute: true,
  postId: 'p1',
};

const FIND: Find = {
  id: 'f1',
  tripId: 't1',
  speciesId: 'borowik-szlachetny',
  gminaId: 'suprasl',
  rarity: 'rzadki',
  confidence: 0.94,
  xxl: true,
  dimensions: { capCm: 14, heightCm: 17, weightG: 410, ageDays: 5 },
  collected: true,
  status: 'claimed',
  foundAt: '2026-10-06T07:00:00.000Z',
  photoUri: 'file:///data/finds/f1.jpg',
  photoPath: 'uid/f1.jpg',
  xp: { lines: [{ label: 'Bazowe XP', xp: 250 }], total: 250 },
};

function input(over: Partial<LocalExportInput> = {}): LocalExportInput {
  const base = initialUserState();
  return {
    user: { ...base, user: { ...base.user, bio: 'Borowiki tylko z Puszczy', avatar: { kind: 'preset', id: 'sowa' } }, terms: { version: '2026-10-07', acceptedAt: '2026-10-07T08:00:00.000Z' } },
    trips: { t1: TRIP },
    finds: { f1: FIND, f2: { ...FIND, id: 'f2', photoUri: 'data:image/jpeg;base64,AAAA', photoPath: undefined, foundAt: '2026-10-06T06:30:00.000Z' } },
    settings: { hideRouteByDefault: true, notifications: { prefs: { streak: true, social: false }, reminderHour: 18 } },
    notifications: [{ kind: 'social', title: 'Ola zareagowała', body: 'Darz grzyb!', createdAt: '2026-10-07T07:00:00.000Z', read: false }],
    ...over,
  };
}

describe('eksport danych – część z telefonu', () => {
  it('profil z opisem i avatarem, regulamin, ustawienia i centrum powiadomień', () => {
    const local = buildLocalExport(input());
    expect(local.profile).toMatchObject({ name: 'Kuba Nowak', handle: '@kuba.grzyb', bio: 'Borowiki tylko z Puszczy', avatar: { kind: 'preset', id: 'sowa' } });
    expect(local.onboarding).toEqual({ completed: true, termsVersion: '2026-10-07', termsAcceptedAt: '2026-10-07T08:00:00.000Z' });
    expect(local.settings).toEqual({ hideRouteByDefault: true, notifications: { prefs: { streak: true, social: false }, reminderHour: 18 } });
    expect(local.notifications).toEqual([{ kind: 'social', title: 'Ola zareagowała', body: 'Darz grzyb!', createdAt: '2026-10-07T07:00:00.000Z', read: false }]);
    expect(local.game.atlas.length).toBeGreaterThan(5);
    expect(local).not.toHaveProperty('social');
  });

  it('wyprawy i znaleziska od najstarszych; zdjęcia jako ścieżki, data URI pominięte', () => {
    const local = buildLocalExport(input());
    expect(local.trips).toEqual([
      expect.objectContaining({ id: 't1', durationMin: 120, distanceKm: 5.432, published: true, hideRoute: true, findIds: ['f1'] }),
    ]);
    expect(local.finds.map((f) => f.id)).toEqual(['f2', 'f1']);
    expect(local.finds[1]).toMatchObject({ photo: 'file:///data/finds/f1.jpg', photoServerPath: 'uid/f1.jpg', xp: 250 });
    expect(local.finds[0].photo).toMatch(/pominięte/);
    expect(JSON.stringify(local)).not.toContain('base64');
    expect(photoRef(undefined)).toBeNull();
  });

  it('tryb mock: znajomi i zablokowani z telefonu', () => {
    const local = buildLocalExport(input({ social: { friends: ['@ola.w'], blocked: [{ handle: '@marek', name: 'Marek', blockedAt: '2026-10-07T06:00:00.000Z' }] } }));
    expect(local.social).toEqual({ friends: ['@ola.w'], blocked: [{ handle: '@marek', name: 'Marek', blockedAt: '2026-10-07T06:00:00.000Z' }] });
  });
});

describe('eksport danych – scalenie z serwerem', () => {
  const meta = { backend: 'supabase' as const, appVersion: '0.1.0', platform: 'ios' };

  it('Supabase: eksport z serwera bez zmian + `local` i `app`', () => {
    const server = { format: EXPORT_FORMAT, exportedAt: '2026-10-07T07:30:00.000Z', userId: 'uid', trips: [{ id: 't1' }], local: 'nadpisane' };
    const local = buildLocalExport(input());
    const out = mergeExport(server, local, meta, NOW) as Record<string, unknown>;
    expect(out.format).toBe(EXPORT_FORMAT);
    expect(out.userId).toBe('uid');
    expect(out.trips).toEqual([{ id: 't1' }]);
    expect(out.local).toBe(local);
    expect(out.app).toEqual({ version: '0.1.0', platform: 'ios', backend: 'supabase' });
  });

  it('mock: nagłówek formatu i sam `local`', () => {
    const local = buildLocalExport(input());
    const out = mergeExport(null, local, { ...meta, backend: 'mock' }, NOW) as Record<string, unknown>;
    expect(out).toMatchObject({ format: EXPORT_FORMAT, exportedAt: NOW.toISOString(), source: 'device', userId: local.profile.id });
    expect(out.local).toBe(local);
    // Plik da się zapisać i odczytać (JSON bez cykli).
    expect(JSON.parse(JSON.stringify(out)).local.profile.name).toBe('Kuba Nowak');
  });

  it('nazwa pliku z datą lokalną', () => {
    expect(exportFileName(NOW)).toBe('grzybobranie-eksport-2026-10-07.json');
  });
});
