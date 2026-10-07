import { describe, expect, it } from '@jest/globals';

import { fmtDaysAgo, fmtMB, placeLabel } from '../format';

describe('fmtDaysAgo', () => {
  const NOW = new Date(2026, 9, 7, 9, 30).getTime();

  it('dni kalendarzowe (data YYYY-MM-DD albo czas ISO): dziś, wczoraj, dni, tygodnie, miesiące', () => {
    expect(fmtDaysAgo('2026-10-07', NOW)).toBe('dziś');
    expect(fmtDaysAgo('2026-10-06', NOW)).toBe('wczoraj');
    expect(fmtDaysAgo('2026-10-02', NOW)).toBe('5 dni temu');
    expect(fmtDaysAgo('2026-09-24', NOW)).toBe('13 dni temu');
    expect(fmtDaysAgo('2026-09-16', NOW)).toBe('3 tyg. temu');
    expect(fmtDaysAgo('2026-07-01', NOW)).toBe('3 mies. temu');
    // Wczoraj późnym wieczorem (czas lokalny) to nadal „wczoraj”, nie „przed 12 h”.
    expect(fmtDaysAgo(new Date(2026, 9, 6, 23, 50).toISOString(), NOW)).toBe('wczoraj');
  });

  it('data z przyszłości → dziś; śmieci → pusty tekst', () => {
    expect(fmtDaysAgo('2026-10-09', NOW)).toBe('dziś');
    expect(fmtDaysAgo('', NOW)).toBe('');
    expect(fmtDaysAgo('nie-data', NOW)).toBe('');
  });
});

describe('placeLabel', () => {
  it('powiat ziemski, miasto w powiecie, miasto na prawach powiatu, brak powiatu', () => {
    expect(placeLabel({ kind: 'wiejska', powiat: 'sokólski' })).toBe('powiat sokólski');
    expect(placeLabel({ kind: 'miejska', powiat: 'bielski' })).toBe('miasto · powiat bielski');
    expect(placeLabel({ kind: 'miejska', powiat: 'Białystok' })).toBe('miasto na prawach powiatu');
    expect(placeLabel({ kind: 'miejska' })).toBe('miasto');
    expect(placeLabel({ powiat: null })).toBe('gmina');
  });
});

describe('fmtMB', () => {
  it('MB dziesiętne jak w ustawieniach telefonu: przecinek do 10 MB, potem całe', () => {
    expect(fmtMB(0)).toBe('0 MB');
    expect(fmtMB(40_000)).toBe('< 0,1 MB');
    expect(fmtMB(625_000)).toBe('0,6 MB');
    expect(fmtMB(9_949_999)).toBe('9,9 MB');
    expect(fmtMB(12_400_000)).toBe('12 MB');
    expect(fmtMB(30_000_000)).toBe('30 MB');
  });
});
