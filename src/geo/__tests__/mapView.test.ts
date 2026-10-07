import { describe, expect, it } from '@jest/globals';

import {
  clampZoom,
  homeZoom,
  interpolateZoom,
  isZoomed,
  pickShape,
  placeLabels,
  textWidth,
  toMap,
  viewBoxOf,
  visibleBox,
  zoomAt,
  zoomToBox,
  type Box,
  type HitShape,
  type MapViewport,
  type Zoom,
} from '../mapView';

/** Okno 300×300, mapa 200×300 (jak podlaskie: węższa niż karta). */
const VP: MapViewport = { w: 300, h: 300, content: [0, 0, 200, 300], maxS: 10 };
const screen = (z: Zoom, x: number, y: number) => ({ x: z.s * x + z.tx, y: z.s * y + z.ty });

describe('widok mapy – skala i przesunięcie', () => {
  it('pełny widok: skala 1, mapa wyśrodkowana w poziomie', () => {
    expect(homeZoom(VP)).toEqual({ s: 1, tx: 50, ty: 0 });
    expect(isZoomed(homeZoom(VP))).toBe(false);
    expect(viewBoxOf(homeZoom(VP), VP)).toBe('-50 0 300 300');
  });

  it('clampZoom: skala w [1, max], mapa nie odsłania pustego brzegu', () => {
    expect(clampZoom({ s: 0.3, tx: 999, ty: 999 }, VP)).toEqual(homeZoom(VP));
    expect(clampZoom({ s: 50, tx: 0, ty: 0 }, VP).s).toBe(10);
    // 3×: mapa 600×900 – lewy brzeg nie wchodzi w okno, prawy nie odjeżdża.
    const z = clampZoom({ s: 3, tx: 100, ty: -5000 }, VP);
    expect(z.tx).toBe(0);
    expect(z.ty).toBe(300 - 900);
    const r = clampZoom({ s: 3, tx: -5000, ty: 50 }, VP);
    expect(r.tx).toBe(300 - 600);
    expect(r.ty).toBe(0);
    // 1,2×: szerokość 240 < 300 → nadal wyśrodkowana.
    expect(clampZoom({ s: 1.2, tx: -40, ty: 0 }, VP).tx).toBeCloseTo((300 - 240) / 2);
  });

  it('zoomAt: punkt pod palcem zostaje w miejscu', () => {
    const z0 = clampZoom({ s: 2, tx: -100, ty: -100 }, VP);
    const p = toMap(z0, 150, 120);
    const z1 = zoomAt(z0, 2, 150, 120, VP);
    expect(z1.s).toBe(4);
    const q = screen(z1, p.x, p.y);
    expect(q.x).toBeCloseTo(150);
    expect(q.y).toBeCloseTo(120);
    // Oddalenie poniżej 1 = pełny widok.
    expect(zoomAt(z1, 0.01, 10, 10, VP)).toEqual(homeZoom(VP));
  });

  it('visibleBox i viewBox opisują ten sam fragment', () => {
    const z: Zoom = { s: 4, tx: -200, ty: -400 };
    expect(visibleBox(z, VP)).toEqual([50, 100, 125, 175]);
    expect(viewBoxOf(z, VP)).toBe('50 100 75 75');
  });
});

describe('zoomToBox – cel przybliżenia na gminę', () => {
  it('gmina na środku okna, prostokąt zajmuje ~45% okna', () => {
    const box: Box = [80, 120, 110, 150];
    const z = zoomToBox(box, VP);
    expect(z.s).toBeCloseTo((300 * 0.45) / 30);
    const c = screen(z, 95, 135);
    expect(c.x).toBeCloseTo(150);
    expect(c.y).toBeCloseTo(150);
  });

  it('duża gmina – co najmniej 2,5×, maleńka – maksimum', () => {
    expect(zoomToBox([10, 10, 190, 290], VP).s).toBe(2.5);
    expect(zoomToBox([100, 100, 102, 101], VP).s).toBe(10);
  });

  it('gmina przy krawędzi – przesunięcie w granicach mapy', () => {
    const z = zoomToBox([0, 0, 20, 20], VP);
    expect(z).toEqual(clampZoom(z, VP));
    expect(z.tx).toBe(0);
    expect(z.ty).toBe(0);
  });

  it('w przybliżeniu skala zostaje, jeśli nie odbiega od idealnej więcej niż 1,6×', () => {
    const box: Box = [80, 120, 110, 150]; // idealnie 4,5×
    expect(zoomToBox(box, VP, { current: 4 }).s).toBe(4);
    expect(zoomToBox(box, VP, { current: 10 }).s).toBeCloseTo(4.5 * 1.6);
    expect(zoomToBox(box, VP, { current: 1.5 }).s).toBeCloseTo(4.5 / 1.6);
    // Pełny widok (1×) – zawsze skala idealna.
    expect(zoomToBox(box, VP, { current: 1 }).s).toBeCloseTo(4.5);
  });
});

describe('interpolateZoom – klatki animacji', () => {
  const a = homeZoom(VP);
  const b = zoomToBox([80, 120, 110, 150], VP);

  it('zaczyna i kończy dokładnie w celach', () => {
    expect(interpolateZoom(a, b, 0, VP)).toEqual(expect.objectContaining({ s: a.s }));
    const start = interpolateZoom(a, b, 0, VP);
    expect(start.tx).toBeCloseTo(a.tx);
    expect(start.ty).toBeCloseTo(a.ty);
    const end = interpolateZoom(a, b, 1, VP);
    expect(end.s).toBeCloseTo(b.s);
    expect(end.tx).toBeCloseTo(b.tx);
    expect(end.ty).toBeCloseTo(b.ty);
  });

  it('skala rośnie monotonicznie (geometrycznie), samo przesunięcie – liniowo', () => {
    let prev = 0;
    for (let p = 0; p <= 1.0001; p += 0.1) {
      const z = interpolateZoom(a, b, p, VP);
      expect(z.s).toBeGreaterThanOrEqual(prev);
      prev = z.s;
    }
    expect(interpolateZoom(a, b, 0.5, VP).s).toBeCloseTo(Math.sqrt(a.s * b.s));
    const p0: Zoom = { s: 3, tx: 0, ty: 0 };
    const p1: Zoom = { s: 3, tx: -300, ty: -60 };
    expect(interpolateZoom(p0, p1, 0.5, VP)).toEqual({ s: 3, tx: -150, ty: -30 });
  });
});

describe('pickShape – trafienie palcem', () => {
  // Gmina wiejska 0–100 z dziurą (miasto 40–60) i miasto w dziurze; obok gmina 100–200.
  const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
  const shapes: HitShape[] = [
    { id: 'wies', bbox: [0, 0, 100, 100], area: 9600, rings: [[square(0, 0, 100, 100), square(40, 40, 60, 60)]] },
    { id: 'miasto', bbox: [40, 40, 60, 60], area: 400, rings: [[square(40, 40, 60, 60)]] },
    { id: 'sasiad', bbox: [100, 0, 200, 100], area: 10000, rings: [[square(100, 0, 200, 100)]] },
  ];

  it('punkt w gminie, w mieście (dziura gminy wiejskiej) i u sąsiada', () => {
    expect(pickShape(shapes, 10, 10, 5)).toBe('wies');
    expect(pickShape(shapes, 50, 50, 5)).toBe('miasto');
    expect(pickShape(shapes, 150, 50, 5)).toBe('sasiad');
  });

  it('przy nakładce z uproszczenia wygrywa mniejsza gmina', () => {
    const overlap: HitShape[] = [
      { id: 'duza', bbox: [0, 0, 100, 100], area: 10000, rings: [[square(0, 0, 100, 100)]] },
      { id: 'mala', bbox: [90, 40, 120, 60], area: 600, rings: [[square(90, 40, 120, 60)]] },
    ];
    expect(pickShape(overlap, 95, 50, 5)).toBe('mala');
  });

  it('pudło: najbliższa gmina w promieniu, dalej nic', () => {
    expect(pickShape(shapes, 50, 108, 10)).toBe('wies');
    expect(pickShape(shapes, 196, 104, 10)).toBe('sasiad');
    expect(pickShape(shapes, 50, 130, 10)).toBeNull();
    expect(pickShape([], 0, 0, 10)).toBeNull();
  });
});

describe('etykiety', () => {
  it('textWidth: rośnie z długością, wąskie litery węższe', () => {
    expect(textWidth('Supraśl', 10)).toBeGreaterThan(30);
    expect(textWidth('Supraśl', 10)).toBeLessThan(55);
    expect(textWidth('Juchnowiec Kościelny', 10)).toBeGreaterThan(textWidth('Supraśl', 10));
    expect(textWidth('iiii', 10)).toBeLessThan(textWidth('mmmm', 10));
    expect(textWidth('', 10)).toBe(0);
  });

  it('placeLabels: ważniejsze najpierw, bez nakładania, w granicach okna', () => {
    const bounds: Box = [0, 0, 300, 300];
    const placed = placeLabels(
      [
        { id: 'mala', x: 110, y: 100, w: 60, h: 16, priority: 10 },
        { id: 'duza', x: 100, y: 100, w: 60, h: 16, priority: 99 },
        { id: 'obok', x: 100, y: 130, w: 60, h: 16, priority: 5 },
        { id: 'za-brzegiem', x: 290, y: 100, w: 60, h: 16, priority: 50 },
      ],
      bounds,
    );
    expect(placed.map((p) => p.id)).toEqual(['duza', 'obok']);
    expect(placed[0].box).toEqual([70, 92, 130, 108]);
  });

  it('placeLabels: zarezerwowane obszary i etykieta wymuszona', () => {
    const placed = placeLabels(
      [
        { id: 'pod-podpowiedzia', x: 100, y: 100, w: 60, h: 16, priority: 99 },
        { id: 'zaznaczona', x: 5, y: 100, w: 60, h: 16, priority: 1, force: true },
        { id: 'na-zaznaczonej', x: 20, y: 100, w: 30, h: 16, priority: 50 },
      ],
      [0, 0, 300, 300],
      [[80, 90, 200, 120]],
    );
    // Wymuszona – nawet poza oknem i przed ważniejszymi; pozostałe kolidują.
    expect(placed.map((p) => p.id)).toEqual(['zaznaczona']);
  });
});
