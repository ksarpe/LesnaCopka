import { describe, expect, it } from '@jest/globals';

import { mapDuel, mapDuels, mapDuelsOverview, mapPlayerRanking, mapRivalryStatus } from '../duelsMap';

const author = (o: Record<string, unknown> = {}) => ({ id: 'u-ola', handle: 'ola.w', name: 'Ola_W', level: 18, avatarPreset: 'lis', ringRarity: 'rzadki', ...o });
const me = (o: Record<string, unknown> = {}) => author({ id: 'u-me', handle: 'kuba', name: 'Kuba', level: 14, ringRarity: 'primary', avatarPreset: null, ...o });

const rawDuel = (o: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'biggest',
  days: 3,
  status: 'active',
  iAmChallenger: true,
  createdAt: '2026-10-06T08:00:00.000Z',
  expiresAt: null,
  startsAt: '2026-10-06T09:00:00.000Z',
  endsAt: '2026-10-09T09:00:00.000Z',
  finishedAt: null,
  me: { user: me(), score: 118.3, best: { findId: 'f1', speciesId: 'borowik-szlachetny', capCm: 14.2, relativePct: 118.3, photoPath: 'u-me/f1.jpg' } },
  opponent: { user: author(), score: '139.6', best: { findId: 'f2', speciesId: 'czubajka-kania', capCm: 33.5, relativePct: 139.6, photoPath: null } },
  outcome: null,
  xp: null,
  ...o,
});

describe('pojedynek', () => {
  it('pełny kształt: strony z autorami jak w feedzie, najlepsze okazy, liczby z tekstu', () => {
    const d = mapDuel(rawDuel());
    expect(d).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'biggest',
      days: 3,
      status: 'active',
      iAmChallenger: true,
      endsAt: '2026-10-09T09:00:00.000Z',
      outcome: null,
      xp: null,
    });
    expect(d?.me.user).toMatchObject({ id: 'u-me', name: 'Kuba', handle: '@kuba', ringRarity: 'primary' });
    expect(d?.opponent.user).toMatchObject({ id: 'u-ola', handle: '@ola.w', avatar: { kind: 'preset', id: 'lis' } });
    expect(d?.opponent.score).toBe(139.6);
    expect(d?.me.best).toEqual({ findId: 'f1', speciesId: 'borowik-szlachetny', capCm: 14.2, relativePct: 118.3, photoPath: 'u-me/f1.jpg' });
    expect(d?.opponent.best?.photoPath).toBeNull();
  });

  it('strona gracza dostaje avatar z telefonu; wynik i XP po rozstrzygnięciu', () => {
    const photo = { kind: 'photo' as const, uri: 'file:///avatar.jpg' };
    const d = mapDuel(rawDuel({ status: 'finished', outcome: 'won', xp: 100, finishedAt: '2026-10-09T15:00:00Z' }), { selfAvatar: photo });
    expect(d?.me.user.avatar).toEqual(photo);
    expect(d?.opponent.user.avatar).toEqual({ kind: 'preset', id: 'lis' });
    expect(d).toMatchObject({ status: 'finished', outcome: 'won', xp: 100 });
  });

  it('obronnie: nieznany rodzaj / status – pominięty, brak `best` – null, dziwny czas – najbliższy dozwolony', () => {
    expect(mapDuel(rawDuel({ kind: 'weight' }))).toBeNull();
    expect(mapDuel(rawDuel({ status: 'paused' }))).toBeNull();
    expect(mapDuel({ kind: 'count' })).toBeNull();
    const d = mapDuel(JSON.stringify(rawDuel({ kind: 'count', days: 2, me: { user: me(), score: -3 }, opponent: null, outcome: 'meh' })));
    expect(d).toMatchObject({ kind: 'count', days: 1, outcome: null });
    expect(d?.me).toMatchObject({ score: 0, best: null });
    expect(d?.opponent.user.name).toBe('Grzybiarz');
    expect(mapDuels([rawDuel(), { id: 'x', kind: '?' }, null])).toHaveLength(1);
  });

  it('przegląd: listy i bilans (obiekt albo tablica z jednym wierszem)', () => {
    const o = mapDuelsOverview([
      {
        active: [rawDuel()],
        incoming: [rawDuel({ id: 'in', status: 'pending', iAmChallenger: false, expiresAt: '2026-10-08T08:00:00Z' })],
        outgoing: [],
        finished: [rawDuel({ id: 'f', status: 'finished', outcome: 'lost', xp: 0 })],
        record: { won: 3, lost: '2', draw: 1 },
      },
    ]);
    expect(o.active).toHaveLength(1);
    expect(o.incoming[0]).toMatchObject({ id: 'in', iAmChallenger: false, expiresAt: '2026-10-08T08:00:00Z' });
    expect(o.finished[0]).toMatchObject({ outcome: 'lost', xp: 0 });
    expect(o.record).toEqual({ won: 3, lost: 2, draw: 1 });
    expect(mapDuelsOverview(null)).toEqual({ active: [], incoming: [], outgoing: [], finished: [], record: { won: 0, lost: 0, draw: 0 } });
  });
});

describe('ranking grzybiarzy', () => {
  it('wiersze od pierwszego miejsca, wiersz gracza (także spoza listy), świeże punkty i ukrycie', () => {
    const r = mapPlayerRanking(
      {
        scope: 'gmina',
        scopeId: 'suprasl',
        scopeName: 'Gmina Supraśl',
        period: 'week',
        live: false,
        rows: [
          { rank: 2, user: author({ id: 'u-ewa', name: 'Ewa' }), xp: 900, isMe: false },
          { rank: 1, user: author(), xp: '1200', isMe: false },
          { rank: 3, user: { name: 'bez id' }, xp: 10 },
        ],
        me: { rank: 17, user: me(), xp: 240, isMe: true },
        pendingXp: 120,
        total: 64,
        hidden: false,
      },
      { scope: 'gmina', period: 'week' },
      { selfAvatar: { kind: 'preset', id: 'sowa' } },
    );
    expect(r.rows.map((x) => [x.rank, x.user.name, x.xp])).toEqual([
      [1, 'Ola_W', 1200],
      [2, 'Ewa', 900],
    ]);
    expect(r.me).toMatchObject({ rank: 17, xp: 240, isMe: true, user: { id: 'u-me', avatar: { kind: 'preset', id: 'sowa' } } });
    expect(r).toMatchObject({ scope: 'gmina', scopeId: 'suprasl', scopeName: 'Gmina Supraśl', live: false, pendingXp: 120, total: 64, hidden: false });
  });

  it('pusta odpowiedź – zasięg i okres z zapytania, znajomi na żywo, bez gracza', () => {
    const r = mapPlayerRanking(null, { scope: 'znajomi', period: 'season' });
    expect(r).toEqual({
      scope: 'znajomi',
      scopeId: null,
      scopeName: 'Znajomi',
      period: 'season',
      live: true,
      rows: [],
      me: null,
      pendingXp: 0,
      total: 0,
      hidden: false,
    });
    expect(mapPlayerRanking({ hidden: true, me: null }, { scope: 'polska', period: 'week' })).toMatchObject({ hidden: true, me: null, scopeName: 'Polska', live: false });
  });

  it('status rywalizacji: widoczność, weryfikacja, konto', () => {
    expect(mapRivalryStatus({ showInRankings: false, standing: 'review', accountSecured: true })).toEqual({
      showInRankings: false,
      standing: 'review',
      accountSecured: true,
    });
    expect(mapRivalryStatus([{ standing: 'banned' }])).toEqual({ showInRankings: true, standing: 'review', accountSecured: false });
    expect(mapRivalryStatus(null)).toEqual({ showInRankings: true, standing: 'ok', accountSecured: false });
  });
});
