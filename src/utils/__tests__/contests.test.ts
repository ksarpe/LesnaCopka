import { describe, expect, it } from '@jest/globals';

import { SPECIES } from '../../data/mock/species';
import type { Contest, Find, Species } from '../../types';
import {
  bestPlace,
  biggestTitle,
  CONTEST_REASONS,
  contestAwards,
  contestCheck,
  contestCountdown,
  contestId,
  contestScore,
  CONTEST_SPECIES_CANDIDATES,
  contestSpeciesForWeek,
  contestSpeciesPool,
  contestStatusAt,
  contestTitle,
  contestWeekBounds,
  contestWeekStart,
  entryPhotoUri,
  fmtContestScore,
  fmtCm,
  fmtPct,
  fmtTimeLeft,
  fmtVisibleFrom,
  fmtWeekRange,
  groupTrophies,
  lastResolvedWeek,
  matchingContests,
  parseContestId,
  podium,
  rankAmong,
  relativePct,
  sortEntries,
  warsawMidnight,
  warsawOffsetMin,
  warsawYmd,
  weekContests,
  type AwardCandidate,
} from '../contests';
import { questHash } from '../quests';

const H = 3_600_000;
const iso = (s: string) => new Date(s).getTime();

describe('czas Europe/Warsaw', () => {
  it('przesunięcie: zima +1 h, lato +2 h, zmiana w ostatnią niedzielę marca / października o 01:00 UTC', () => {
    expect(warsawOffsetMin(iso('2026-01-15T12:00:00Z'))).toBe(60);
    expect(warsawOffsetMin(iso('2026-07-15T12:00:00Z'))).toBe(120);
    expect(warsawOffsetMin(iso('2026-03-29T00:59:59Z'))).toBe(60);
    expect(warsawOffsetMin(iso('2026-03-29T01:00:00Z'))).toBe(120);
    expect(warsawOffsetMin(iso('2026-10-25T00:59:59Z'))).toBe(120);
    expect(warsawOffsetMin(iso('2026-10-25T01:00:00Z'))).toBe(60);
  });

  it('data w Warszawie niezależnie od strefy telefonu', () => {
    expect(warsawYmd(new Date('2026-10-11T21:59:00Z'))).toBe('2026-10-11');
    expect(warsawYmd(new Date('2026-10-11T22:00:00Z'))).toBe('2026-10-12');
    expect(warsawYmd(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(new Date(warsawMidnight('2026-10-12')).toISOString()).toBe('2026-10-11T22:00:00.000Z');
    expect(new Date(warsawMidnight('2026-11-02')).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });

  it('tydzień walk: poniedziałek 00:00 czasu polskiego', () => {
    expect(contestWeekStart(new Date('2026-10-11T21:59:00Z'))).toBe('2026-10-05'); // niedziela 23:59
    expect(contestWeekStart(new Date('2026-10-11T22:00:00Z'))).toBe('2026-10-12'); // poniedziałek 00:00
    expect(contestWeekStart(iso('2026-10-09T10:00:00Z'))).toBe('2026-10-05');
  });

  it('granice tygodnia (także tygodnia ze zmianą czasu) i wyniki 48 h po końcu', () => {
    expect(contestWeekBounds('2026-10-05')).toEqual({
      startsAt: '2026-10-04T22:00:00.000Z',
      endsAt: '2026-10-11T22:00:00.000Z',
      resultsAt: '2026-10-13T22:00:00.000Z',
    });
    // 25 października – powrót do czasu zimowego: tydzień ma 169 h.
    const b = contestWeekBounds('2026-10-19');
    expect(b.startsAt).toBe('2026-10-18T22:00:00.000Z');
    expect(b.endsAt).toBe('2026-10-25T23:00:00.000Z');
    expect((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / H).toBe(169);
    expect(contestWeekBounds('2026-03-23').endsAt).toBe('2026-03-29T22:00:00.000Z');
  });

  it('status walki z dat i ostatnio rozstrzygnięty tydzień', () => {
    const b = contestWeekBounds('2026-10-05');
    expect(contestStatusAt(b, iso('2026-10-09T10:00:00Z'))).toBe('open');
    expect(contestStatusAt(b, iso('2026-10-12T10:00:00Z'))).toBe('judging');
    expect(contestStatusAt(b, iso('2026-10-14T10:00:00Z'))).toBe('final');
    // Piątek – poprzedni tydzień już rozstrzygnięty; poniedziałek – jeszcze nie (wyniki w środę).
    expect(lastResolvedWeek(iso('2026-10-09T10:00:00Z'))).toBe('2026-09-28');
    expect(lastResolvedWeek(iso('2026-10-13T10:00:00Z'))).toBe('2026-09-28');
    expect(lastResolvedWeek(iso('2026-10-13T22:00:00Z'))).toBe('2026-10-05');
  });
});

describe('gatunki tygodnia (lustro SQL)', () => {
  const mk = (id: string, o: Partial<Species> = {}): Species => ({
    id,
    name: id,
    latin: id,
    shortName: id,
    rarity: 'pospolity',
    edibility: 'jadalny',
    habitat: 'Las',
    typical: { capCm: 8, heightCm: 8, weightG: 100 },
    ...o,
  });

  const oct = (v: number) => Array.from({ length: 12 }, (_, i) => (i === 9 ? v : 0));
  const C = CONTEST_SPECIES_CANDIDATES;

  it('pula: tylko stała lista kandydatów obecnych w katalogu; waga sezonu malejąco, potem pozycja na liście; 6 pierwszych', () => {
    expect(C).toHaveLength(20);
    expect(new Set(C).size).toBe(20);
    const list = [
      mk('spoza-listy', { seasonWeights: oct(1) }),
      mk(C[5], { seasonWeights: oct(0.5) }),
      mk(C[19], { seasonWeights: oct(1) }),
      mk(C[3], { seasonWeights: oct(1) }),
      mk(C[0]),
      ...[C[10], C[11], C[12], C[13]].map((id) => mk(id, { seasonWeights: oct(0.2) })),
    ];
    // Poniedziałek 2026-09-28 + 3 dni = 1 października → miesiąc 10. Remis wagi – pozycja na liście, nie w katalogu.
    expect(contestSpeciesPool('2026-09-28', list).map((s) => s.id)).toEqual([C[3], C[19], C[5], C[10], C[11], C[12]]);
    // Brak wag sezonu = 0 – trafia do puli dopiero, gdy brakuje lepszych.
    expect(contestSpeciesPool('2026-09-28', list.slice(0, 5)).map((s) => s.id)).toEqual([C[3], C[19], C[5], C[0]]);
  });

  it('miesiąc z poniedziałku + 3 dni (tydzień na przełomie miesięcy)', () => {
    const list = [
      mk(C[0], { seasonWeights: Array.from({ length: 12 }, (_, i) => (i === 8 ? 1 : 0)) }),
      mk(C[1], { seasonWeights: oct(1) }),
    ];
    expect(contestSpeciesPool('2026-09-28', list)[0].id).toBe(C[1]); // czwartek 1.10
    expect(contestSpeciesPool('2026-09-21', list)[0].id).toBe(C[0]);
  });

  it('kandydaci są w katalogu jako jadalne, nie kępkowe i bez ochrony', () => {
    C.forEach((id) => {
      const sp = SPECIES.find((x) => x.id === id);
      expect(sp).toMatchObject({ edibility: 'jadalny' });
      expect(sp?.clustered).toBeFalsy();
      expect(sp?.protection).toBeFalsy();
    });
  });

  it('a = h mod n, b = (a + 1 + (⌊h / n⌋ mod (n − 1))) mod n – dwa różne gatunki z puli', () => {
    for (const week of ['2026-10-05', '2026-09-28', '2026-03-30', '2026-01-05', '2026-07-06', '2027-05-17']) {
      const pool = contestSpeciesPool(week, SPECIES).map((s) => s.id);
      const n = pool.length;
      const h = questHash(`${week}:okaz`);
      const a = h % n;
      const b = (a + 1 + (Math.floor(h / n) % (n - 1))) % n;
      const [x, y] = contestSpeciesForWeek(week, SPECIES);
      expect([x, y]).toEqual([pool[a], pool[b]]);
      expect(x).not.toBe(y);
    }
  });

  it('wartości kontrolne dla katalogu (te same musi dać SQL)', () => {
    expect(contestSpeciesForWeek('2026-10-05', SPECIES)).toEqual(['maslak-zwyczajny', 'czubajka-kania']);
    expect(contestSpeciesForWeek('2026-07-06', SPECIES)).toEqual(['kozlarz-czerwony', 'maslak-zwyczajny']);
    expect(contestSpeciesForWeek('2026-01-05', SPECIES)).toEqual(['kozlarz-babka', 'borowik-szlachetny']);
    expect(contestSpeciesForWeek('2026-04-27', SPECIES)).toEqual(['zagiew-luskowata', 'czubajka-kania']);
  });

  it('w sezonie klasyków (≥ 4 z pierwszych 8 z wagą ≥ 0,5) pula jest tylko z nich; poza nim – pierwsze 6 kandydatów', () => {
    const classic = new Set(C.slice(0, 8));
    // Październik: borowik, podgrzybek, kania, koźlarz babka, maślak, rydz, ceglastopory – gąski poza pulą.
    const oct = contestSpeciesPool('2026-10-05', SPECIES).map((s) => s.id);
    expect(oct.every((id) => classic.has(id))).toBe(true);
    expect(oct).toHaveLength(7);
    expect(oct).not.toContain('gasowka-fioletowawa');
    // Koniec kwietnia: klasyków w sezonie brak – żagiew łuskowata z szerszej listy.
    const apr = contestSpeciesPool('2026-04-27', SPECIES).map((s) => s.id);
    expect(apr).toHaveLength(6);
    expect(apr[0]).toBe('zagiew-luskowata');
  });

  it('za mało gatunków – błąd zamiast dzielenia przez zero', () => {
    expect(() => contestSpeciesForWeek('2026-10-05', [mk(C[0], { seasonWeights: new Array(12).fill(1) })])).toThrow();
    expect(() => contestSpeciesForWeek('2026-10-05', [mk('spoza-listy'), mk('inny')])).toThrow();
  });
});

describe('id, tytuły, walki tygodnia', () => {
  it('id walki i jego rozbiór', () => {
    expect(contestId('2026-10-05', 'okaz')).toBe('2026-10-05:okaz');
    expect(parseContestId('2026-10-05:okaz')).toEqual({ weekStart: '2026-10-05', kind: 'relative', speciesId: null });
    expect(parseContestId('2026-10-05:borowik-szlachetny')).toEqual({
      weekStart: '2026-10-05',
      kind: 'species',
      speciesId: 'borowik-szlachetny',
    });
    expect(parseContestId('okaz')).toBeNull();
  });

  it('„Największy / Największa” z rodzaju pierwszego słowa nazwy, nazwa małą literą', () => {
    expect(biggestTitle('Borowik szlachetny')).toBe('Największy borowik szlachetny');
    expect(biggestTitle('Czubajka kania')).toBe('Największa czubajka kania');
    expect(biggestTitle('Żagiew łuskowata')).toBe('Największa żagiew łuskowata');
    // Z katalogu: tydzień 2026-04-27 ma walkę żagwi łuskowatej (rodzaj żeński).
    expect(weekContests('2026-04-27', SPECIES).map((c) => c.title)).toContain('Największa żagiew łuskowata');
    expect(biggestTitle('Gąska niekształtna')).toBe('Największa gąska niekształtna');
    expect(contestTitle('relative')).toBe('Okaz tygodnia');
    expect(contestTitle('species', 'Mleczaj rydz')).toBe('Największy mleczaj rydz');
  });

  it('każdy gatunek z puli ma poprawny przymiotnik (nazwy rodzaju żeńskiego kończą się na -a albo są na liście)', () => {
    const fem = new Set(['żagiew']);
    SPECIES.filter((s) => s.edibility === 'jadalny' && !s.clustered && !s.protection).forEach((s) => {
      const first = s.name.split(' ')[0].toLowerCase();
      const want = first.endsWith('a') || fem.has(first) ? 'Największa' : 'Największy';
      expect(biggestTitle(s.name).startsWith(want)).toBe(true);
    });
  });

  it('trzy walki tygodnia: okaz + dwa gatunki, granice i status', () => {
    const list = weekContests('2026-10-05', SPECIES, iso('2026-10-09T10:00:00Z'));
    expect(list.map((c) => c.id)).toEqual(['2026-10-05:okaz', '2026-10-05:maslak-zwyczajny', '2026-10-05:czubajka-kania']);
    expect(list[0]).toMatchObject({ kind: 'relative', speciesId: null, title: 'Okaz tygodnia', status: 'open' });
    expect(list[1]).toMatchObject({
      kind: 'species',
      title: 'Największy maślak zwyczajny',
      endsAt: '2026-10-11T22:00:00.000Z',
    });
  });
});

describe('wynik i kolejność', () => {
  it('cm z 1 miejscem po przecinku, % względem typowego kapelusza', () => {
    expect(contestScore('species', 18.46, 12)).toBe(18.5);
    expect(relativePct(15.9, 12)).toBe(132.5);
    expect(relativePct(18, 12)).toBe(150);
    expect(contestScore('relative', 10, 8)).toBe(125);
    expect(relativePct(10, 0)).toBe(0);
  });

  it('tablica: wynik malejąco, remis – wcześniejsze znalezisko wyżej; miejsce, które zająłby okaz', () => {
    const e = (score: number, foundAt: string) => ({ score, foundAt });
    const list = [e(120, '2026-10-06T10:00:00Z'), e(150, '2026-10-07T10:00:00Z'), e(120, '2026-10-05T10:00:00Z')];
    expect(sortEntries(list).map((x) => x.foundAt)).toEqual([
      '2026-10-07T10:00:00Z',
      '2026-10-05T10:00:00Z',
      '2026-10-06T10:00:00Z',
    ]);
    expect(rankAmong(e(130, '2026-10-08T10:00:00Z'), list)).toBe(2);
    expect(rankAmong(e(120, '2026-10-05T12:00:00Z'), list)).toBe(3);
    expect(rankAmong(e(200, '2026-10-08T10:00:00Z'), list)).toBe(1);
    expect(podium(list, 3)).toHaveLength(3);
    expect(podium(list, 5)).toEqual([]);
  });

  it('rozstrzygnięcie: podia z minimalną liczbą uczestników, jedna (najwyższa) nagroda gracza w walce', () => {
    const at = (i: number) => new Date(Date.UTC(2026, 9, 5, i)).toISOString();
    const entries: AwardCandidate[] = [
      // 12 graczy w Polsce, 6 w podlaskim (4 w Supraślu), 6 w małopolskim.
      ...Array.from({ length: 4 }, (_, i) => ({
        userId: `s${i}`,
        gminaId: 'suprasl',
        voivodeship: 'podlaskie',
        score: 200 - i,
        foundAt: at(i),
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        userId: `h${i}`,
        gminaId: 'hajnowka',
        voivodeship: 'podlaskie',
        score: 150 - i,
        foundAt: at(i),
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        userId: `k${i}`,
        gminaId: 'zakopane',
        voivodeship: 'małopolskie',
        score: 180 - i * 20,
        foundAt: at(i),
      })),
    ];
    const awards = contestAwards(entries);
    const of = (u: string) => awards.filter((a) => a.userId === u);
    // s0: 1. w Polsce (500), 1. w województwie i gminie – trofea bez XP.
    expect(of('s0')).toEqual(
      expect.arrayContaining([
        { userId: 's0', scope: 'polska', scopeId: null, place: 1, xp: 500 },
        { userId: 's0', scope: 'wojewodztwo', scopeId: 'podlaskie', place: 1, xp: 0 },
        { userId: 's0', scope: 'gmina', scopeId: 'suprasl', place: 1, xp: 0 },
      ]),
    );
    // k0 (180) – 3. w Polsce (150) i 1. w małopolskim (250): dostaje 250.
    expect(of('k0').find((a) => a.xp > 0)).toMatchObject({ scope: 'wojewodztwo', place: 1, xp: 250 });
    expect(of('k0').filter((a) => a.xp > 0)).toHaveLength(1);
    // Hajnówka: 2 uczestników < 3 – bez podium gminy.
    expect(awards.some((a) => a.scope === 'gmina' && a.scopeId === 'hajnowka')).toBe(false);
    // Zakopane: 6 – podium gminy.
    expect(awards.filter((a) => a.scope === 'gmina' && a.scopeId === 'zakopane')).toHaveLength(3);
  });

  it('trofea jednej walki razem: na wierzchu nagroda albo najwyższy zasięg', () => {
    const t = (contestId: string, scope: 'gmina' | 'wojewodztwo' | 'polska', place: number, xp: number) => ({
      contestId,
      scope,
      place,
      xp,
    });
    const groups = groupTrophies([
      t('a', 'polska', 3, 0),
      t('a', 'gmina', 1, 100),
      t('b', 'gmina', 2, 0),
      t('b', 'wojewodztwo', 3, 0),
      t('a', 'wojewodztwo', 2, 0),
    ]);
    expect(groups.map((g) => [g.top.contestId, g.top.scope, g.also.map((x) => x.scope)])).toEqual([
      ['a', 'gmina', ['polska', 'wojewodztwo']],
      ['b', 'wojewodztwo', ['gmina']],
    ]);
  });

  it('najciekawsze miejsce okazu', () => {
    expect(bestPlace({ gmina: 1, wojewodztwo: 2, polska: 14 }).text).toBe('2. w województwie');
    expect(bestPlace({ gmina: 1, wojewodztwo: 1, polska: 3 }).text).toBe('3. w Polsce');
    expect(bestPlace({ gmina: 2, wojewodztwo: 8, polska: 40 }).text).toBe('2. w gminie');
    expect(bestPlace({ gmina: 5, wojewodztwo: 12, polska: 40 }).text).toBe('12. w województwie');
  });
});

describe('kwalifikacja okazu', () => {
  const borowik = SPECIES.find((s) => s.id === 'borowik-szlachetny')!;
  const kurka = SPECIES.find((s) => s.clustered)!;
  const chroniony = SPECIES.find((s) => s.protection)!;
  const NOW = iso('2026-10-09T10:00:00Z');
  const find = (o: Partial<Find> = {}) => ({
    status: 'claimed' as const,
    sizeVerified: true,
    dimensions: { capCm: 18.5, heightCm: 17, weightG: 500, ageDays: 4 },
    foundAt: '2026-10-08T08:00:00Z',
    ...o,
  });

  it('okaz z tego tygodnia ze skalą walczy', () => {
    expect(contestCheck(find(), borowik, { now: NOW })).toEqual({ ok: true, reason: null, weekStart: '2026-10-05' });
  });

  it('powody odmowy po polsku', () => {
    expect(contestCheck(find({ sizeVerified: false }), borowik, { now: NOW })).toMatchObject({
      ok: false,
      reason: CONTEST_REASONS.scale,
      missingScale: true,
    });
    expect(contestCheck(find({ sizeVerified: undefined }), borowik, { now: NOW }).reason).toBe(CONTEST_REASONS.scale);
    expect(contestCheck(find(), kurka, { now: NOW }).reason).toBe(CONTEST_REASONS.clustered);
    expect(contestCheck(find(), chroniony, { now: NOW }).reason).toBe(CONTEST_REASONS.protected);
    expect(
      contestCheck(find({ dimensions: { capCm: 9, heightCm: 9, weightG: 200, ageDays: 2, pieces: 3 } }), borowik, { now: NOW })
        .reason,
    ).toBe(CONTEST_REASONS.pieces);
    expect(contestCheck(find({ status: 'pending' }), borowik, { now: NOW }).reason).toBe(CONTEST_REASONS.unclaimed);
    expect(contestCheck(find(), undefined, { now: NOW }).reason).toBe(CONTEST_REASONS.unknownSpecies);
  });

  it('kapelusz ponad 2,5 × typowy nie walczy (granica włącznie walczy)', () => {
    expect(
      contestCheck(find({ dimensions: { capCm: 30, heightCm: 17, weightG: 500, ageDays: 4 } }), borowik, { now: NOW }).ok,
    ).toBe(true);
    expect(
      contestCheck(find({ dimensions: { capCm: 30.1, heightCm: 17, weightG: 500, ageDays: 4 } }), borowik, { now: NOW }).reason,
    ).toBe(CONTEST_REASONS.tooBig);
  });

  it('okaz z minionego tygodnia – jeszcze 6 h po jego końcu (kolejka offline), potem nie', () => {
    const old = find({ foundAt: '2026-10-11T20:00:00Z' }); // niedziela 22:00
    expect(contestCheck(old, borowik, { now: iso('2026-10-12T03:00:00Z') })).toMatchObject({ ok: true, weekStart: '2026-10-05' });
    expect(contestCheck(old, borowik, { now: iso('2026-10-12T04:30:00Z') }).reason).toBe(CONTEST_REASONS.oldWeek);
    expect(contestCheck(find({ foundAt: '2026-09-30T10:00:00Z' }), borowik, { now: NOW }).reason).toBe(CONTEST_REASONS.oldWeek);
  });

  it('pasujące walki: zawsze „Okaz tygodnia”, walka gatunku tylko dla tego gatunku', () => {
    const list = weekContests('2026-10-05', SPECIES, NOW);
    expect(matchingContests('borowik-szlachetny', list).map((c) => c.id)).toEqual(['2026-10-05:okaz']);
    expect(matchingContests('czubajka-kania', list).map((c) => c.id)).toEqual([
      '2026-10-05:okaz',
      '2026-10-05:czubajka-kania',
    ]);
  });
});

describe('formatowanie', () => {
  it('wynik: „18,5 cm”, „12 cm”, „132%”, „132,4%”', () => {
    expect(fmtCm(18.5)).toBe('18,5 cm');
    expect(fmtCm(12)).toBe('12 cm');
    expect(fmtPct(132)).toBe('132%');
    expect(fmtPct(132.44)).toBe('132,4%');
    expect(fmtContestScore('species', 18.5)).toBe('18,5 cm');
    expect(fmtContestScore('relative', 150)).toBe('150%');
  });

  it('tydzień walk: „5–11 października”, na przełomie miesięcy obie nazwy', () => {
    expect(fmtWeekRange('2026-10-05')).toBe('5–11 października');
    expect(fmtWeekRange('2026-09-28')).toBe('28 września – 4 października');
    expect(fmtWeekRange('2026-12-28')).toBe('28 grudnia – 3 stycznia');
  });

  it('kiedy inni zobaczą okaz (czas telefonu)', () => {
    const now = new Date(2026, 9, 9, 15, 0).getTime();
    expect(fmtVisibleFrom(new Date(2026, 9, 9, 18, 30).toISOString(), now)).toBe('dziś o 18:30');
    expect(fmtVisibleFrom(new Date(2026, 9, 10, 9, 5).toISOString(), now)).toBe('jutro o 9:05');
    expect(fmtVisibleFrom(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe('12 października o 9:00');
    expect(fmtVisibleFrom('zły', now)).toBe('');
  });

  it('pozostały czas', () => {
    expect(fmtTimeLeft(2 * 24 * H + 4 * H + 5 * 60_000)).toBe('2 dni 4 h');
    expect(fmtTimeLeft(24 * H + 10 * 60_000)).toBe('1 dzień');
    expect(fmtTimeLeft(5 * 24 * H)).toBe('5 dni');
    expect(fmtTimeLeft(5 * H + 12 * 60_000)).toBe('5 h 12 min');
    expect(fmtTimeLeft(3 * H)).toBe('3 h');
    expect(fmtTimeLeft(8 * 60_000 + 30_000)).toBe('8 min');
    expect(fmtTimeLeft(10_000)).toBe('1 min');
    expect(fmtTimeLeft(-5)).toBe('1 min');
  });

  it('odliczanie walki: do końca, do wyników, wyniki', () => {
    const c: Pick<Contest, 'status' | 'endsAt' | 'resultsAt'> = { status: 'open', ...contestWeekBounds('2026-10-05') };
    expect(contestCountdown(c, iso('2026-10-09T18:00:00Z'))).toBe('do końca 2 dni 4 h');
    expect(contestCountdown({ ...c, status: 'judging' }, iso('2026-10-12T20:00:00Z'))).toBe('wyniki za 1 dzień 2 h');
    expect(contestCountdown({ ...c, status: 'judging' }, iso('2026-10-14T20:00:00Z'))).toBe('wyniki wkrótce');
    expect(contestCountdown({ ...c, status: 'final' }, iso('2026-10-14T20:00:00Z'))).toBe('wyniki ogłoszone');
  });

  it('zdjęcie okazu: lokalne, z mocka, ze ścieżki na serwerze (znacznik sb-photo:)', () => {
    expect(entryPhotoUri({ photoPath: 'u1/f1.jpg', photoUri: 'file:///a.jpg' }, 'file:///moje.jpg')).toBe('file:///moje.jpg');
    expect(entryPhotoUri({ photoPath: null, photoUri: 'file:///a.jpg' })).toBe('file:///a.jpg');
    expect(entryPhotoUri({ photoPath: 'u1/f1.jpg' })).toBe('sb-photo:u1/f1.jpg');
    expect(entryPhotoUri({ photoPath: null })).toBeUndefined();
  });
});
