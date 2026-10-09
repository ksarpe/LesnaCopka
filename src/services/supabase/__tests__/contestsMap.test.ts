import { describe, expect, it } from '@jest/globals';

import {
  mapContest,
  mapContestBoard,
  mapContestEligibility,
  mapContestEntry,
  mapContestWeek,
  mapTrophyCase,
} from '../contestsMap';

const NAMES: Record<string, string> = { 'borowik-szlachetny': 'Borowik szlachetny', 'czubajka-kania': 'Czubajka kania' };
const ctx = { speciesName: (id: string) => NAMES[id] };

const author = (id: string, name: string) => ({
  id,
  handle: name.toLowerCase(),
  name,
  level: 12,
  avatarPreset: 'lis',
  ringRarity: 'rzadki',
});
const contest = (o: Record<string, unknown> = {}) => ({
  id: '2026-10-05:okaz',
  kind: 'relative',
  speciesId: null,
  title: 'Okaz tygodnia',
  startsAt: '2026-10-04T22:00:00Z',
  endsAt: '2026-10-11T22:00:00Z',
  resultsAt: '2026-10-13T22:00:00Z',
  status: 'open',
  entrants: 14,
  ...o,
});
const entry = (o: Record<string, unknown> = {}) => ({
  id: 'e1',
  contestId: '2026-10-05:okaz',
  findId: 'f1',
  author: author('u1', 'Ola_W'),
  speciesId: 'borowik-szlachetny',
  capCm: 21,
  relativePct: 175,
  score: 175,
  rank: 1,
  gminaId: 'suprasl',
  foundAt: '2026-10-06T08:00:00Z',
  photoPath: 'u1/f1.jpg',
  status: 'active',
  isMine: false,
  visibleFrom: null,
  ...o,
});

describe('mapContest', () => {
  it('walka z serwera; tytuł walki gatunku z katalogu (odmiana rodzaju)', () => {
    expect(mapContest(contest(), ctx)).toEqual({
      id: '2026-10-05:okaz',
      kind: 'relative',
      speciesId: null,
      title: 'Okaz tygodnia',
      startsAt: '2026-10-04T22:00:00Z',
      endsAt: '2026-10-11T22:00:00Z',
      resultsAt: '2026-10-13T22:00:00Z',
      status: 'open',
      entrants: 14,
    });
    const sp = mapContest(
      contest({
        id: '2026-10-05:czubajka-kania',
        kind: 'species',
        speciesId: 'czubajka-kania',
        title: 'Największy czubajka kania',
      }),
      ctx,
    );
    expect(sp.title).toBe('Największa czubajka kania');
    // Gatunek spoza katalogu – tytuł z serwera.
    expect(
      mapContest(contest({ id: '2026-10-05:inny', kind: 'species', speciesId: 'inny', title: 'Największy inny' }), ctx).title,
    ).toBe('Największy inny');
  });

  it('braki: rodzaj i gatunek z id, nieznany status → open, JSON w tekście', () => {
    const c = mapContest(JSON.stringify({ id: '2026-10-05:borowik-szlachetny', status: 'xxx', entrants: '3' }), ctx);
    expect(c).toMatchObject({
      kind: 'species',
      speciesId: 'borowik-szlachetny',
      title: 'Największy borowik szlachetny',
      status: 'open',
      entrants: 3,
    });
  });
});

describe('mapContestEntry / mapContestBoard', () => {
  it('okaz: autor jak w feedzie (nick z @, motyw avatara), ścieżka zdjęcia, status', () => {
    const e = mapContestEntry(entry({ status: 'review', rank: null, visibleFrom: '2026-10-07T08:00:00Z' }))!;
    expect(e.author).toEqual({
      id: 'u1',
      name: 'Ola_W',
      level: 12,
      ringRarity: 'rzadki',
      handle: '@ola_w',
      avatar: { kind: 'preset', id: 'lis' },
    });
    expect(e).toMatchObject({
      status: 'review',
      rank: null,
      visibleFrom: '2026-10-07T08:00:00Z',
      photoPath: 'u1/f1.jpg',
      score: 175,
    });
    expect(mapContestEntry({})).toBeNull();
    // Bez `score` – cm w walce gatunku, % w „Okazie tygodnia”.
    expect(mapContestEntry(entry({ score: undefined, contestId: '2026-10-05:borowik-szlachetny' }))!.score).toBe(21);
    expect(mapContestEntry(entry({ score: undefined }))!.score).toBe(175);
  });

  it('tablica: wpisy, mój okaz spoza listy, nazwa zasięgu; pusta odpowiedź – puste stany', () => {
    const b = mapContestBoard(
      {
        contest: contest(),
        scope: 'wojewodztwo',
        scopeId: 'podlaskie',
        scopeName: 'podlaskie',
        entries: [entry(), entry({ id: 'e2', rank: 2, score: 150, author: author('u2', 'Marek_K') })],
        mine: entry({ id: 'e9', rank: 61, isMine: false, author: author('me', 'Kuba') }),
        total: 61,
      },
      { contestId: '2026-10-05:okaz', scope: 'wojewodztwo' },
      ctx,
    );
    expect(b.entries.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(b.mine).toMatchObject({ id: 'e9', rank: 61, isMine: true });
    expect(b).toMatchObject({ scope: 'wojewodztwo', scopeId: 'podlaskie', scopeName: 'podlaskie', total: 61 });

    // Własny okaz – avatar gracza z telefonu (nowe zdjęcie przed synchronizacją), cudze – z serwera.
    const selfAvatar = { kind: 'photo' as const, uri: 'file:///avatar.jpg' };
    const own = mapContestBoard(
      {
        contest: contest(),
        scope: 'gmina',
        entries: [entry(), entry({ id: 'e9', isMine: true, author: author('me', 'Kuba') })],
        mine: entry({ id: 'e9', author: author('me', 'Kuba') }),
      },
      { contestId: '2026-10-05:okaz', scope: 'gmina' },
      { ...ctx, selfAvatar },
    );
    expect(own.mine?.author.avatar).toEqual(selfAvatar);
    expect(own.entries[1].author.avatar).toEqual(selfAvatar);
    expect(own.entries[0].author.avatar).toEqual({ kind: 'preset', id: 'lis' });

    const empty = mapContestBoard(null, { contestId: '2026-10-05:okaz', scope: 'gmina', scopeId: 'suprasl' });
    expect(empty).toMatchObject({
      entries: [],
      mine: null,
      total: 0,
      scope: 'gmina',
      scopeId: 'suprasl',
      scopeName: 'Twoja gmina',
    });
    expect(empty.contest.id).toBe('2026-10-05:okaz');
    expect(mapContestBoard({ scope: 'polska' }, { contestId: 'x', scope: 'polska' }).scopeName).toBe('Polska');
  });
});

describe('mapContestWeek', () => {
  it('walki, moje okazy, liderzy (null dla walk bez okazów), poprzedni tydzień', () => {
    const w = mapContestWeek(
      {
        weekStart: '2026-10-05',
        contests: [contest(), contest({ id: '2026-10-05:borowik-szlachetny', kind: 'species', speciesId: 'borowik-szlachetny' })],
        mine: { '2026-10-05:okaz': entry({ isMine: false, rank: 4 }) },
        leaders: { '2026-10-05:okaz': entry({ author: author('u7', 'Jurek') }) },
        previousWeekStart: '2026-09-28',
      },
      { ...ctx, selfAvatar: { kind: 'preset', id: 'sowa' } },
    );
    expect(w.contests.map((c) => c.title)).toEqual(['Okaz tygodnia', 'Największy borowik szlachetny']);
    expect(w.mine['2026-10-05:okaz']).toMatchObject({ rank: 4, isMine: true, author: { avatar: { kind: 'preset', id: 'sowa' } } });
    expect(w.leaders['2026-10-05:okaz']?.author.name).toBe('Jurek');
    expect(w.leaders['2026-10-05:okaz']?.author.avatar).toEqual({ kind: 'preset', id: 'lis' });
    expect(w.leaders['2026-10-05:borowik-szlachetny']).toBeNull();
    expect(w.previousWeekStart).toBe('2026-09-28');
    expect(mapContestWeek({})).toEqual({ weekStart: '', contests: [], mine: {}, leaders: {}, previousWeekStart: null });
  });
});

describe('mapContestEligibility', () => {
  it('pasujące walki z miejscem, które okaz by zajął', () => {
    const e = mapContestEligibility(
      {
        findId: 'f1',
        eligible: true,
        reason: null,
        prizeEligible: false,
        contests: [
          {
            contest: contest(),
            score: 175,
            projectedRank: { gmina: 1, wojewodztwo: 2, polska: 9 },
            entered: false,
            currentBest: 140.5,
          },
        ],
      },
      'f1',
      ctx,
    );
    expect(e).toMatchObject({ eligible: true, reason: null, prizeEligible: false });
    expect(e.contests[0]).toMatchObject({
      score: 175,
      projectedRank: { gmina: 1, wojewodztwo: 2, polska: 9 },
      entered: false,
      currentBest: 140.5,
    });
  });

  it('odmowa: powód po polsku, bez walk; brak powodu – ogólny', () => {
    expect(
      mapContestEligibility({ eligible: false, reason: 'Na zdjęciu zabrakło odniesienia skali', contests: [{}] }, 'f1'),
    ).toEqual({
      findId: 'f1',
      eligible: false,
      reason: 'Na zdjęciu zabrakło odniesienia skali',
      prizeEligible: true,
      contests: [],
    });
    expect(mapContestEligibility({}, 'f2').reason).toBe('Ten okaz nie może walczyć');
  });
});

describe('mapTrophyCase', () => {
  it('trofea: tytuł z katalogu, nieprawidłowe pozycje pominięte, liczniki nie mniejsze niż lista', () => {
    const t = mapTrophyCase(
      {
        gold: 3,
        silver: 0,
        bronze: 0,
        items: [
          {
            id: 't1',
            contestId: '2026-09-28:czubajka-kania',
            contestTitle: 'Największy czubajka kania',
            scope: 'gmina',
            scopeName: 'Gmina Supraśl',
            place: 1,
            speciesId: 'czubajka-kania',
            capCm: 31,
            xp: 100,
            awardedAt: '2026-10-06T22:00:00Z',
          },
          {
            id: 't2',
            contestId: '2026-09-28:okaz',
            contestTitle: 'Okaz tygodnia',
            scope: 'polska',
            scopeName: 'Polska',
            place: 2,
            speciesId: 'borowik-szlachetny',
            capCm: 21,
            xp: 0,
            awardedAt: '2026-10-06T22:00:00Z',
          },
          { id: 't3', contestId: '2026-09-28:okaz', scope: 'znajomi', place: 1 },
          { id: 't4', contestId: '2026-09-28:okaz', scope: 'gmina', place: 5 },
        ],
      },
      ctx,
    );
    expect(t.items.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(t.items[0].contestTitle).toBe('Największa czubajka kania');
    expect(t).toMatchObject({ gold: 3, silver: 1, bronze: 0 });
    expect(mapTrophyCase(null)).toEqual({ gold: 0, silver: 0, bronze: 0, items: [] });
  });
});
