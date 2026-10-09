import { describe, expect, it } from '@jest/globals';

import type { Duel, Find } from '@/types';
import {
  daysLabel,
  DUEL_GRACE_MS,
  duelOutcome,
  duelPhase,
  duelResultText,
  duelScoreShort,
  duelScoreText,
  duelShare,
  duelSideScore,
  duelTimeText,
  duelXp,
  fmtPct,
  fmtTimeLeft,
  pendingXpText,
  rankByXp,
  rankingTitle,
  recordText,
  relativePct,
  weekStartMs,
} from '../duels';

const H = 3_600_000;
const T0 = new Date('2026-10-06T08:00:00Z').getTime();

const species = {
  borowik: { typical: { capCm: 12, heightCm: 14, weightG: 320 } },
  kania: { typical: { capCm: 24, heightCm: 28, weightG: 220 } },
  kurka: { typical: { capCm: 5, heightCm: 6, weightG: 20 }, clustered: true },
  sromotnikowy: { typical: { capCm: 9, heightCm: 12, weightG: 80 } },
  chroniony: { typical: { capCm: 10, heightCm: 10, weightG: 100 }, protection: 'scisla' as const },
};

let seq = 0;
const find = (o: Partial<Find> & { speciesId: string }): Find => ({
  id: `f${++seq}`,
  tripId: null,
  gminaId: 'suprasl',
  rarity: 'pospolity',
  confidence: 0.9,
  xxl: false,
  dimensions: { capCm: 10, heightCm: 10, weightG: 100, ageDays: 2 },
  collected: true,
  status: 'claimed',
  foundAt: new Date(T0 + H).toISOString(),
  verified: true,
  sizeVerified: true,
  ...o,
});

const window = { from: T0, to: T0 + 24 * H, strict: true };

describe('wynik strony pojedynku', () => {
  it('count: zebrane do koszyka, zweryfikowane, w oknie i odebrane', () => {
    const finds = [
      find({ speciesId: 'borowik' }),
      find({ speciesId: 'borowik' }),
      find({ speciesId: 'sromotnikowy', collected: false }),
      find({ speciesId: 'kania', verified: false }),
      find({ speciesId: 'kania', status: 'pending' }),
      find({ speciesId: 'kania', foundAt: new Date(T0 - H).toISOString() }),
      find({ speciesId: 'kania', foundAt: new Date(T0 + 25 * H).toISOString() }),
    ];
    expect(duelSideScore('count', finds, species, window)).toEqual({ score: 2, best: null });
  });

  it('species: różne gatunki – także tylko sfotografowane (trujące)', () => {
    const finds = [find({ speciesId: 'borowik' }), find({ speciesId: 'borowik' }), find({ speciesId: 'sromotnikowy', collected: false })];
    expect(duelSideScore('species', finds, species, window).score).toBe(2);
  });

  it('biggest: kapelusz / typowy w %, tylko zmierzone przy skali, bez kępek i chronionych; remis – wcześniejszy', () => {
    const finds = [
      find({ speciesId: 'borowik', dimensions: { capCm: 18, heightCm: 15, weightG: 400, ageDays: 3 }, photoPath: 'u/f.jpg' }),
      find({ speciesId: 'kania', dimensions: { capCm: 36, heightCm: 30, weightG: 300, ageDays: 3 }, foundAt: new Date(T0 + 5 * H).toISOString() }),
      find({ speciesId: 'kania', dimensions: { capCm: 40, heightCm: 30, weightG: 300, ageDays: 3 }, sizeVerified: false }),
      find({ speciesId: 'kurka', dimensions: { capCm: 12, heightCm: 6, weightG: 20, ageDays: 1 } }),
      find({ speciesId: 'chroniony', dimensions: { capCm: 30, heightCm: 6, weightG: 20, ageDays: 1 } }),
      find({ speciesId: 'borowik', dimensions: { capCm: 30, heightCm: 6, weightG: 20, ageDays: 1, pieces: 3 } }),
    ];
    const r = duelSideScore('biggest', finds, species, window);
    expect(r.score).toBe(150);
    expect(r.best).toMatchObject({ speciesId: 'borowik', capCm: 18, relativePct: 150, photoPath: 'u/f.jpg' });
  });

  it('mocki (strict: false): brak flagi weryfikacji się liczy, jawne „false” – nie', () => {
    const finds = [find({ speciesId: 'borowik', verified: undefined, sizeVerified: undefined }), find({ speciesId: 'kania', verified: false, sizeVerified: false })];
    expect(duelSideScore('count', finds, species, { ...window, strict: false }).score).toBe(1);
    expect(duelSideScore('biggest', finds, species, { ...window, strict: false }).best?.speciesId).toBe('borowik');
    expect(duelSideScore('count', finds, species, window).score).toBe(0);
  });

  it('relativePct z jednym miejscem po przecinku; brak typowego – 0', () => {
    expect(relativePct(14.2, 12)).toBe(118.3);
    expect(relativePct(10, 0)).toBe(0);
  });
});

describe('rozstrzygnięcie i XP', () => {
  it('wynik: wygrana / przegrana / remis (wyniki równe po zaokrągleniu do 0,1 – remis)', () => {
    expect(duelOutcome(5, 3)).toBe('won');
    expect(duelOutcome(118.3, 139.6)).toBe('lost');
    expect(duelOutcome(7, 7)).toBe('draw');
    expect(duelOutcome(120.01, 120.04)).toBe('draw');
    expect(duelOutcome(120.04, 120.06)).toBe('lost');
  });

  it('XP: 100 / 30 / 0, tylko gdy oboje mają wynik, konta mogą odbierać nagrody i w limicie tygodnia', () => {
    const ok = { bothScored: true, eligible: true, rewardedThisWeek: 0, pairRewardedThisWeek: false };
    expect(duelXp('won', ok)).toBe(100);
    expect(duelXp('draw', ok)).toBe(30);
    expect(duelXp('lost', ok)).toBe(0);
    expect(duelXp('won', { ...ok, bothScored: false })).toBe(0);
    expect(duelXp('won', { ...ok, eligible: false })).toBe(0);
    expect(duelXp('won', { ...ok, rewardedThisWeek: 3 })).toBe(0);
    expect(duelXp('won', { ...ok, rewardedThisWeek: 2 })).toBe(100);
    expect(duelXp('draw', { ...ok, pairRewardedThisWeek: true })).toBe(0);
  });

  it('pasek wyników: udział gracza, 0 : 0 po równo', () => {
    expect(duelShare(3, 1)).toBe(0.75);
    expect(duelShare(0, 0)).toBe(0.5);
  });
});

const duel = (o: Partial<Duel>): Duel => ({
  id: 'd1',
  kind: 'count',
  days: 3,
  status: 'active',
  iAmChallenger: true,
  createdAt: new Date(T0 - H).toISOString(),
  expiresAt: null,
  startsAt: new Date(T0).toISOString(),
  endsAt: new Date(T0 + 72 * H).toISOString(),
  finishedAt: null,
  me: { user: { id: 'me', name: 'Kuba', level: 14, ringRarity: 'primary' }, score: 0, best: null },
  opponent: { user: { id: 'u-ola', name: 'Ola_W', level: 27, ringRarity: 'legendarny' }, score: 0, best: null },
  outcome: null,
  xp: null,
  ...o,
});

describe('fazy i teksty', () => {
  it('faza z czasu: zaproszenie w obie strony, trwa, liczenie wyników po końcu, wynik', () => {
    expect(duelPhase(duel({ status: 'pending', iAmChallenger: false }), T0)).toBe('incoming');
    expect(duelPhase(duel({ status: 'pending' }), T0)).toBe('outgoing');
    expect(duelPhase(duel({}), T0 + H)).toBe('active');
    expect(duelPhase(duel({}), T0 + 73 * H)).toBe('settling');
    expect(duelPhase(duel({ status: 'finished', outcome: 'won' }), T0)).toBe('won');
    expect(duelPhase(duel({ status: 'expired' }), T0)).toBe('expired');
  });

  it('czas: koniec, wygaśnięcie, wyniki po kolejce offline, zakończony', () => {
    expect(fmtTimeLeft(2 * 24 * H + 5 * H)).toBe('2 d 5 h');
    expect(fmtTimeLeft(5 * H + 12 * 60_000)).toBe('5 h 12 min');
    expect(fmtTimeLeft(30_000)).toBe('1 min');
    expect(duelTimeText(duel({}), T0 + 22 * H)).toBe('Koniec za 2 d 2 h');
    expect(duelTimeText(duel({ status: 'pending', expiresAt: new Date(T0 + 40 * H).toISOString() }), T0)).toBe('Wygasa za 1 d 16 h');
    expect(duelTimeText(duel({}), T0 + 72 * H + DUEL_GRACE_MS - 2 * H)).toBe('Wyniki za 2 h');
    const finishedAt = new Date(T0).toISOString();
    expect(duelTimeText(duel({ status: 'finished', outcome: 'won', finishedAt }), T0 + 24 * H + 3 * H)).toBe('Wygrana wczoraj');
  });

  it('wyniki i bilans po polsku', () => {
    expect(duelScoreShort('biggest', 152.4)).toBe('152,4%');
    expect(duelScoreShort('biggest', 0)).toBe('–');
    expect(duelScoreText('count', 12)).toBe('12 grzybów');
    expect(duelScoreText('species', 3)).toBe('3 gatunki');
    expect(duelScoreText('species', 1)).toBe('1 gatunek');
    expect(fmtPct(150)).toBe('150%');
    expect(daysLabel(1)).toBe('1 dzień');
    expect(daysLabel(7)).toBe('7 dni');
    expect(recordText({ won: 3, draw: 1, lost: 5 })).toBe('3 wygrane · 1 remis · 5 przegranych');
    expect(pendingXpText(1240)).toBe('+1 240 pkt wejdzie do rankingu jutro');
  });

  it('baner wyniku: XP albo dlaczego bez nagrody; pojedynek, który się nie odbył', () => {
    expect(duelResultText(duel({ status: 'finished', outcome: 'won', xp: 100 }))).toEqual({ title: 'Wygrana!', body: '+100 XP' });
    expect(duelResultText(duel({ status: 'finished', outcome: 'draw', xp: 0 }))?.body).toMatch(/^Bez XP\./);
    expect(duelResultText(duel({ status: 'finished', outcome: 'lost', xp: 0 }))?.title).toBe('Tym razem przegrana');
    expect(duelResultText(duel({ status: 'expired' }))?.title).toBe('Wyzwanie wygasło');
    expect(duelResultText(duel({}))).toBeNull();
  });
});

describe('ranking', () => {
  it('od największej liczby punktów, remis – alfabetycznie, bez punktów – poza listą', () => {
    const r = rankByXp([
      { name: 'Ola', xp: 300 },
      { name: 'Ewa', xp: 900 },
      { name: 'Ania', xp: 300 },
      { name: 'Zero', xp: 0 },
    ]);
    expect(r.map((x) => [x.rank, x.name])).toEqual([
      [1, 'Ewa'],
      [2, 'Ania'],
      [3, 'Ola'],
    ]);
  });

  it('nagłówek: województwo z nazwą, reszta jak z serwera', () => {
    expect(rankingTitle({ scope: 'wojewodztwo', scopeName: 'podlaskie' })).toBe('Województwo podlaskie');
    expect(rankingTitle({ scope: 'gmina', scopeName: 'Gmina Supraśl' })).toBe('Gmina Supraśl');
    expect(rankingTitle({ scope: 'wojewodztwo', scopeName: 'Twoje województwo' })).toBe('Twoje województwo');
  });

  it('tydzień od poniedziałku 00:00 Europe/Warsaw – niezależnie od strefy telefonu', () => {
    // Październik – czas letni (UTC+2): pon 5.10 00:00 w Warszawie = nd 4.10 22:00 UTC.
    const monday = Date.parse('2026-10-04T22:00:00Z');
    expect(weekStartMs(Date.parse('2026-10-08T15:30:00Z'))).toBe(monday);
    expect(weekStartMs(monday)).toBe(monday);
    expect(weekStartMs(monday - 1)).toBe(Date.parse('2026-09-27T22:00:00Z'));
    // Po zmianie czasu (UTC+1): pon 2.11 00:00 = nd 1.11 23:00 UTC.
    expect(weekStartMs(Date.parse('2026-11-04T12:00:00Z'))).toBe(Date.parse('2026-11-01T23:00:00Z'));
  });
});
