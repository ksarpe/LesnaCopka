import { describe, expect, it } from '@jest/globals';

import { angDist, frameOpacity } from '../spin';

const AZS = [0, 45, 90, 180, 270];

/** Kolor widoczny po złożeniu warstw (0..n-1, wyższy indeks na wierzchu): udział każdej klatki. */
function composite(angle: number, azs: readonly number[]): number[] {
  const share = azs.map(() => 0);
  let rest = 1;
  for (let i = azs.length - 1; i >= 0; i--) {
    const o = frameOpacity(angle, azs, i);
    share[i] = rest * o;
    rest *= 1 - o;
  }
  return share;
}

describe('frameOpacity – przenikanie klatek obrotu', () => {
  it('na azymucie klatki widać tylko ją', () => {
    for (const [i, az] of AZS.entries()) {
      const s = composite(az, AZS);
      expect(s[i]).toBeCloseTo(1, 6);
    }
  });

  it('daleko od połowy drogi – ostra klatka, w połowie – pół na pół z sąsiednią', () => {
    expect(composite(10, AZS)[0]).toBeCloseTo(1, 6);
    const mid = composite(22.5, AZS);
    expect(mid[0]).toBeCloseTo(0.5, 6);
    expect(mid[1]).toBeCloseTo(0.5, 6);
  });

  it('obraz nigdy nie prześwituje (udziały sumują się do 1) – także przez 0°/360° i dla kątów spoza 0–360', () => {
    for (let a = -400; a <= 800; a += 7.3) {
      const sum = composite(a, AZS).reduce((x, y) => x + y, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
    const wrap = composite(315, AZS);
    expect(wrap[0] + wrap[4]).toBeCloseTo(1, 6);
  });

  it('nierówne odstępy: miesza się z klatką po tej stronie kąta, nie z bliższą po drugiej', () => {
    const azs = [0, 30, 200];
    const s = composite(100, azs);
    expect(s[0]).toBe(0);
    expect(s[1]).toBeGreaterThan(0.5);
    expect(s[2]).toBeGreaterThan(0);
    expect(s[1] + s[2]).toBeCloseTo(1, 6);
  });

  it('jedna klatka – zawsze pełna; angDist liczy najkrótszą drogę', () => {
    expect(frameOpacity(123, [40], 0)).toBe(1);
    expect(angDist(350, 10)).toBe(20);
    expect(angDist(-90, 270)).toBe(0);
  });
});
