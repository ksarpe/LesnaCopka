import { describe, expect, it } from '@jest/globals';

import {
  cameraDirection,
  initialOrbit,
  ORBIT,
  orbitCoverage,
  orbitHint,
  orbitStep,
  relativeAz,
  rotationFor,
  sectorOf,
  slotKey,
  viewSlot,
  type Direction,
  type OrbitState,
} from '../orbit';

const RAD = Math.PI / 180;
const STEP_MS = 66;

/** Próbki co 66 ms wzdłuż ścieżki kierunków aparatu (spokojny ruch, 20°/s). */
function run(s: OrbitState, path: Direction[], rateDps = 20): OrbitState {
  let t = s.lastT ?? 0;
  for (const d of path) {
    t += STEP_MS;
    s = orbitStep(s, { t, rotation: rotationFor(d), rateDps });
  }
  return s;
}

/** Ścieżka: azymut od `from` do `to` w `ms` przy stałej elewacji. */
function arc(from: number, to: number, el: number, ms: number): Direction[] {
  const n = Math.round(ms / STEP_MS);
  return Array.from({ length: n }, (_, i) => ({ az: from + ((to - from) * i) / Math.max(1, n - 1), el }));
}

const hold = (d: Direction, ms: number) => arc(d.az, d.az, d.el, ms);

describe('cameraDirection – kierunek tylnego aparatu z kątów W3C', () => {
  it('telefon płasko ekranem do góry → aparat prosto w dół', () => {
    expect(cameraDirection({ alpha: 0, beta: 0, gamma: 0 }).el).toBeCloseTo(-90, 5);
  });

  it('telefon w pionie → poziomo; obrót w lewo (alpha +90°) → azymut 270°', () => {
    const up = cameraDirection({ alpha: 0, beta: 90 * RAD, gamma: 0 });
    expect(up.el).toBeCloseTo(0, 5);
    expect(up.az).toBeCloseTo(0, 5);
    expect(cameraDirection({ alpha: 90 * RAD, beta: 90 * RAD, gamma: 0 }).az).toBeCloseTo(270, 5);
  });

  it('pochylony do tyłu za pion (iOS: beta ≤ 90°, gamma 180°) → aparat w górę', () => {
    expect(cameraDirection({ alpha: 0, beta: 60 * RAD, gamma: 180 * RAD }).el).toBeCloseTo(30, 5);
  });

  it('blokada przegubu w pionie: liczy się alpha + gamma, kierunek stabilny', () => {
    const a = cameraDirection({ alpha: 30 * RAD, beta: 90 * RAD, gamma: -30 * RAD });
    expect(a.az).toBeCloseTo(0, 5);
    expect(a.el).toBeCloseTo(0, 5);
  });

  it('rotationFor odwraca cameraDirection', () => {
    for (const d of [
      { az: 0, el: -40 },
      { az: 123, el: -75 },
      { az: 300, el: 10 },
      { az: 45, el: -5 },
    ]) {
      const back = cameraDirection(rotationFor(d));
      expect(back.az).toBeCloseTo(d.az, 5);
      expect(back.el).toBeCloseTo(d.el, 5);
    }
  });
});

describe('sektory obejścia', () => {
  it('sektor 0 = ±15° od startu, 12 sektorów po 30°', () => {
    expect(sectorOf(0)).toBe(0);
    expect(sectorOf(-10)).toBe(0);
    expect(sectorOf(350)).toBe(0);
    expect(sectorOf(14.9)).toBe(0);
    expect(sectorOf(15)).toBe(1);
    expect(sectorOf(344)).toBe(11);
    expect(sectorOf(180)).toBe(6);
  });
});

describe('orbitStep / orbitCoverage – postęp obchodzenia', () => {
  it('pełny skan: obejście 300°, potem przy ziemi i z góry → gotowe, podpowiedzi po kolei', () => {
    let s = run(initialOrbit(), hold({ az: 40, el: -40 }, 200));
    expect(orbitHint(s)).toBe('orbit');
    expect(relativeAz(s)).toBeCloseTo(0, 5);

    // Start na azymucie 40° – liczy się tylko obrót względem startu.
    s = run(s, arc(40, 340, -40, 10_000));
    let cov = orbitCoverage(s);
    expect(cov.covered).toBe(11);
    expect(cov.sectors[11]).toBe(false);
    expect(cov.top).toBe(false);
    expect(cov.progress).toBeCloseTo(ORBIT.weights.orbit, 5);
    expect(orbitHint(s, cov)).toBe('low');

    s = run(s, hold({ az: 300, el: -10 }, 700));
    cov = orbitCoverage(s);
    expect(cov.low).toBe(true);
    expect(orbitHint(s, cov)).toBe('top');

    s = run(s, hold({ az: 300, el: -80 }, 700));
    cov = orbitCoverage(s);
    expect(cov).toMatchObject({ top: true, low: true, done: true, progress: 1 });
    expect(orbitHint(s, cov)).toBe('done');
  });

  it('za mało obejścia: z góry i przy ziemi nie wystarczą – postęp < 1', () => {
    let s = run(initialOrbit(), arc(0, 90, -40, 3000));
    s = run(s, hold({ az: 90, el: -10 }, 700));
    s = run(s, hold({ az: 90, el: -80 }, 700));
    const cov = orbitCoverage(s);
    expect(cov.done).toBe(false);
    expect(cov.progress).toBeLessThan(1);
    expect(orbitHint(s, cov)).toBe('orbit');
  });

  it('machanie telefonem (360°/s) nie zalicza niczego i podpowiada „wolniej”', () => {
    const s = run(initialOrbit(), arc(0, 360, -40, 1000), 360);
    const cov = orbitCoverage(s);
    expect(cov.covered).toBe(0);
    expect(cov.progress).toBe(0);
    expect(s.startAz).toBeNull();
    expect(orbitHint(s, cov)).toBe('slow');
  });

  it('aparat w niebo – bez startu i zaliczeń', () => {
    const s = run(initialOrbit(), hold({ az: 0, el: 70 }, 1000));
    expect(s.startAz).toBeNull();
    expect(orbitCoverage(s).progress).toBe(0);
    expect(orbitHint(s)).toBe('start');
  });

  it('przerwa w próbkach (tło) nie zalicza sektora „za darmo”', () => {
    let s = orbitStep(initialOrbit(), { t: 0, rotation: rotationFor({ az: 0, el: -40 }), rateDps: 0 });
    s = orbitStep(s, { t: 5000, rotation: rotationFor({ az: 0, el: -40 }), rateDps: 0 });
    expect(s.sectorMs[0]).toBe(ORBIT.maxDtMs);
    expect(orbitCoverage(s).covered).toBe(0);
  });

  it('postęp rośnie płynnie i monotonicznie', () => {
    let s = initialOrbit();
    let prev = 0;
    for (const d of arc(0, 330, -40, 11_000)) {
      s = run(s, [d]);
      const p = orbitCoverage(s).progress;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(prev).toBeCloseTo(ORBIT.weights.orbit, 5);
  });
});

describe('viewSlot – kiedy zrobić ujęcie', () => {
  const none = () => false;

  it('z góry i przy ziemi mają pierwszeństwo, potem bok w bieżącym sektorze', () => {
    const top = run(initialOrbit(), hold({ az: 0, el: -70 }, 300));
    expect(viewSlot(top, none)).toEqual({ kind: 'top' });
    expect(viewSlot(top, (k) => k === 'top')).toEqual({ kind: 'side', sector: 0 });

    const low = run(initialOrbit(), hold({ az: 0, el: -10 }, 300));
    expect(viewSlot(low, none)).toEqual({ kind: 'low' });

    const side = run(run(initialOrbit(), hold({ az: 0, el: -40 }, 100)), hold({ az: 95, el: -40 }, 300));
    const slot = viewSlot(side, none);
    expect(slot).toEqual({ kind: 'side', sector: 3 });
    expect(viewSlot(side, (k) => k === slotKey(slot!))).toBeNull();
  });

  it('bez ujęcia przy szybkim ruchu, przed startem i prosto w dół poza pasem boku', () => {
    expect(viewSlot(initialOrbit(), none)).toBeNull();
    const fast = run(initialOrbit(), hold({ az: 0, el: -40 }, 300), ORBIT.captureRateDps + 1);
    expect(viewSlot(fast, none)).toBeNull();
    const down = run(initialOrbit(), hold({ az: 0, el: -85 }, 300));
    expect(viewSlot(down, (k) => k === 'top')).toBeNull();
  });
});
