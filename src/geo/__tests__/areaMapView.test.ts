import { describe, expect, it } from '@jest/globals';

import {
  baseCanvas,
  clampT,
  hasDetail,
  homeView,
  MAX_ZOOM,
  MIN_ZOOM,
  sameView,
  viewCenter,
  zoomAt,
  type ViewState,
} from '../areaMapView';

/** Telefon w pionie (390 × 844), promień danych 4 km przy 9 m/px ≈ 444 px. */
const W = 390;
const H = 844;
const HW = W / 2;
const HH = H / 2;
const E = 4000 / 9;

/** Punkt ekranu startowego (q, względem środka) na ekranie bieżącym. */
const screen = (v: ViewState, q: { x: number; y: number }) => ({ x: v.tx + v.k * q.x, y: v.ty + v.k * q.y });
/** Odwrotność: punkt ekranu bieżącego (względem środka) w układzie ekranu startowego. */
const toStart = (v: ViewState, x: number, y: number) => ({ x: (x - v.tx) / v.k, y: (y - v.ty) / v.k });

describe('widok mapy okolicy – skala i przesunięcie', () => {
  it('clampT: środek kadru nie wyjeżdża poza promień danych', () => {
    // 1×: w poziomie zapas E − HW, w pionie ekran prawie tak wysoki jak dane.
    expect(clampT(1000, 1, HW, E)).toBeCloseTo(E - HW);
    expect(clampT(-1000, 1, HH, E)).toBeCloseTo(-(E - HH));
    // Ekran większy niż dane – bez przesuwania.
    expect(clampT(50, 1, 1000, E)).toBe(0);
    // 3× – zapas rośnie z przybliżeniem.
    expect(clampT(1e6, 3, HW, E)).toBeCloseTo(3 * E - HW);
  });

  it('zoomAt: punkt pod palcem zostaje w miejscu, skala w [MIN, MAX]', () => {
    const v0: ViewState = { k: 2, tx: 30, ty: -40 };
    const f = { x: 60, y: -120 };
    const q = toStart(v0, f.x, f.y);
    const v1 = zoomAt(v0, 1.5, f.x, f.y, HW, HH, E);
    expect(v1.k).toBe(3);
    const p = screen(v1, q);
    expect(p.x).toBeCloseTo(f.x);
    expect(p.y).toBeCloseTo(f.y);
    expect(zoomAt(v1, 100, 0, 0, HW, HH, E).k).toBe(MAX_ZOOM);
    expect(zoomAt(v1, 0.01, 0, 0, HW, HH, E).k).toBe(MIN_ZOOM);
  });

  it('homeView: pozycja na środku, przy brzegu danych – najbliżej, jak się da', () => {
    expect(homeView({ x: 20, y: -10 }, HW, HH, E)).toEqual({ k: 1, tx: -20, ty: 10 });
    const edge = homeView({ x: 400, y: 0 }, HW, HH, E);
    expect(edge.tx).toBeCloseTo(-(E - HW));
  });

  it('sameView: podpikselowa różnica nie wymaga rysowania od nowa', () => {
    const v: ViewState = { k: 2.5, tx: 100, ty: -50 };
    expect(sameView({ k: 2.5, tx: 100.3, ty: -50.2 }, v)).toBe(true);
    expect(sameView({ k: 2.5, tx: 101, ty: -50 }, v)).toBe(false);
    expect(sameView({ k: 2.51, tx: 100, ty: -50 }, v)).toBe(false);
  });

  it('hasDetail: przy 1× wystarcza podkład', () => {
    expect(hasDetail(MIN_ZOOM)).toBe(false);
    expect(hasDetail(1.0001)).toBe(false);
    expect(hasDetail(1.2)).toBe(true);
  });

  it('viewCenter: punkt świata w środku kadru zatwierdzonego widoku', () => {
    const center = { x: 1000, y: 2000 };
    const S = 1.3;
    expect(viewCenter({ k: 1, tx: 0, ty: 0 }, center, S)).toEqual(center);
    // Przesunięcie o +26 px ekranu przy 2× = środek kadru 10 px świata na lewo.
    const c = viewCenter({ k: 2, tx: 26, ty: -52 }, center, S);
    expect(c.x).toBeCloseTo(990);
    expect(c.y).toBeCloseTo(2020);
  });
});

describe('podkład mapy okolicy', () => {
  it('pokrywa cały promień danych, na pełnych pikselach', () => {
    const b = baseCanvas(W, H, E);
    expect(Number.isInteger(b.padX) && Number.isInteger(b.padY)).toBe(true);
    expect(b.width).toBe(W + 2 * b.padX);
    expect(b.height).toBe(H + 2 * b.padY);
    expect(b.width / 2).toBeGreaterThanOrEqual(E);
    expect(b.height / 2).toBeGreaterThanOrEqual(E);
    // Duże okno (web): ekran większy niż dane – płótno = ekran.
    expect(baseCanvas(1600, 1000, E)).toEqual({ padX: 0, padY: 0, width: 1600, height: 1000 });
  });

  it('żaden dozwolony kadr nie odsłania brzegu podkładu (gest bez rysowania od nowa)', () => {
    for (const [w, h] of [
      [W, H],
      [H, W],
      [1600, 1000],
      [800, 450],
    ]) {
      const hw = w / 2;
      const hh = h / 2;
      const b = baseCanvas(w, h, E);
      // Losowe (powtarzalne) gesty: przybliżenia wokół różnych punktów i przesunięcia do granic.
      let v: ViewState = homeView({ x: 0, y: 0 }, hw, hh, E);
      let seed = 7;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 400; i++) {
        if (rnd() < 0.5) {
          v = zoomAt(v, 0.3 + rnd() * 3, (rnd() - 0.5) * w, (rnd() - 0.5) * h, hw, hh, E);
        } else {
          v = { k: v.k, tx: clampT(v.tx + (rnd() - 0.5) * 4000, v.k, hw, E), ty: clampT(v.ty + (rnd() - 0.5) * 4000, v.k, hh, E) };
        }
        for (const [sx, sy] of [
          [-hw, -hh],
          [hw, hh],
          [-hw, hh],
          [hw, -hh],
        ]) {
          const q = toStart(v, sx, sy);
          expect(Math.abs(q.x)).toBeLessThanOrEqual(b.width / 2 + 1e-6);
          expect(Math.abs(q.y)).toBeLessThanOrEqual(b.height / 2 + 1e-6);
        }
      }
    }
  });
});
