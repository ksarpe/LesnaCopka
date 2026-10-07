import { describe, expect, it } from '@jest/globals';

import type { AreaMap } from '@/types';

import { pathData, projectAreaMap, projectPoint, unprojectPoint, viewportTransform } from '../areaMapProjection';
import { buildForestGrid, pickTreeMarkers, rasterizeRings } from '../forestMarkers';
import { distanceToFilledRings, nearestPointOnFilledRings } from '../geometry';

/** Kwadrat [x0,y0]–[x1,y1] jako pierścień płaski (zgodnie z ruchem wskazówek przy osi y w dół). */
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];
/** Ten sam kwadrat w przeciwnym kierunku – dziura. */
const hole = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x0, y1, x1, y1, x1, y0];

function areaMap(over: Partial<AreaMap> = {}): AreaMap {
  return {
    zoom: 13,
    center: { x: 1000, y: 2000 },
    metersPerPx: 12,
    forest: [],
    water: [],
    waterways: [],
    roads: [],
    tracks: [],
    boundary: [],
    forestDistanceM: null,
    radiusM: 1600,
    attribution: '',
    ...over,
  };
}

/** Dawna implementacja karty (AreaMap.tsx przed refaktorem) – karta ma wyglądać identycznie. */
function legacyPaths(map: AreaMap, w: number, h: number, mPerPx: number) {
  const s = map.metersPerPx / mPerPx;
  const ox = w / 2 - map.center.x * s;
  const oy = h / 2 - map.center.y * s;
  const margin = 8;
  const toD = (list: number[][], closed: boolean) => {
    let d = '';
    for (const p of list) {
      if (p.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i] * s + ox;
        const y = p[i + 1] * s + oy;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < -margin || minX > w + margin || maxY < -margin || minY > h + margin) continue;
      let px = NaN;
      let py = NaN;
      for (let i = 0; i < p.length; i += 2) {
        const x = Math.round((p[i] * s + ox) * 10) / 10;
        const y = Math.round((p[i + 1] * s + oy) * 10) / 10;
        if (i > 0 && x === px && y === py) continue;
        d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
        px = x;
        py = y;
      }
      if (closed) d += 'Z';
    }
    return d;
  };
  return {
    forest: toD(map.forest, true),
    water: toD(map.water, true),
    waterways: toD(map.waterways, false),
    roads: toD(map.roads, false),
    tracks: toD(map.tracks, false),
    boundary: toD(map.boundary, true),
    pxPerM: 1 / mPerPx,
  };
}

describe('rzutowanie mapy okolicy', () => {
  // Pseudolosowe pierścienie i linie wokół środka – część poza kadrem karty.
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const ring = (n: number, spread: number) => {
    const cx = 1000 + (rnd() - 0.5) * spread;
    const cy = 2000 + (rnd() - 0.5) * spread;
    return Array.from({ length: n * 2 }, (_, i) => (i % 2 ? cy : cx) + (rnd() - 0.5) * 30);
  };
  const map = areaMap({
    forest: Array.from({ length: 40 }, () => ring(8, 600)),
    water: Array.from({ length: 10 }, () => ring(6, 400)),
    waterways: Array.from({ length: 10 }, () => ring(5, 400)),
    roads: Array.from({ length: 20 }, () => ring(4, 500)),
    tracks: Array.from({ length: 20 }, () => ring(3, 500)),
    boundary: [ring(30, 200), [1, 2]],
  });

  it('karta: ścieżki identyczne z dawną implementacją', () => {
    for (const [w, h, mpp] of [
      [350, 150, 9],
      [390, 170, 14.5],
      [1, 1, 9],
    ]) {
      const p = projectAreaMap(map, { width: w, height: h, mPerPx: mpp });
      const legacy = legacyPaths(map, w, h, mpp);
      expect({ ...legacy, pxPerM: p.pxPerM }).toEqual({
        forest: p.forest,
        water: p.water,
        waterways: p.waterways,
        roads: p.roads,
        tracks: p.tracks,
        boundary: p.boundary,
        pxPerM: 1 / mpp,
      });
    }
  });

  it('pomija elementy poza kadrem, ale nie te w marginesie', () => {
    const t = viewportTransform(areaMap(), { width: 100, height: 100, mPerPx: 12 });
    // Skala 1: kadr to x 950–1050, y 1950–2050.
    expect(pathData([square(1200, 2000, 1210, 2010)], t, 100, 100, true)).toBe('');
    expect(pathData([square(1053, 2000, 1060, 2010)], t, 100, 100, true)).toBe('M103 50L110 50L110 60L103 60Z');
    expect(pathData([[1000, 2000, 1000.04, 2000.04, 1010, 2000]], t, 100, 100, false)).toBe('M50 50L60 50');
  });

  it('środek kadru i skala; rzut odwrotny', () => {
    const m = areaMap();
    const t = viewportTransform(m, { width: 200, height: 100, mPerPx: 6, center: { x: 1100, y: 2000 } });
    expect(t.scale).toBe(2);
    expect(projectPoint(t, { x: 1100, y: 2000 })).toEqual({ x: 100, y: 50 });
    expect(projectPoint(t, { x: 1110, y: 1990 })).toEqual({ x: 120, y: 30 });
    const back = unprojectPoint(t, { x: 37, y: 81 });
    expect(projectPoint(t, back).x).toBeCloseTo(37, 9);
    expect(projectPoint(t, back).y).toBeCloseTo(81, 9);
  });
});

describe('najbliższy punkt lasu', () => {
  it('z zewnątrz – rzut na najbliższą krawędź', () => {
    const n = nearestPointOnFilledRings(15, 5, [square(0, 0, 10, 10)]);
    expect(n).toEqual({ x: 10, y: 5, d: 5, inside: false });
    const corner = nearestPointOnFilledRings(13, 14, [square(0, 0, 10, 10)])!;
    expect([corner.x, corner.y, corner.d]).toEqual([10, 10, 5]);
  });

  it('w środku – punkt wejściowy, d = 0; w dziurze – brzeg dziury', () => {
    expect(nearestPointOnFilledRings(3, 3, [square(0, 0, 10, 10)])).toEqual({ x: 3, y: 3, d: 0, inside: true });
    const n = nearestPointOnFilledRings(5, 4.5, [square(0, 0, 10, 10), hole(4, 4, 6, 6)])!;
    expect(n.inside).toBe(false);
    expect([n.x, n.y]).toEqual([5, 4]);
    expect(n.d).toBeCloseTo(0.5, 9);
  });

  it('szew kafli (zakładka) nie jest brzegiem lasu', () => {
    // Las 0–20 pocięty na kafle 0–10 i 10–20 z zakładką 2: szwy na x = 12 i x = 8 leżą w lesie.
    const rings = [square(0, 0, 12, 10), square(8, 0, 20, 10)];
    const n = nearestPointOnFilledRings(25, 5, rings)!;
    expect([n.x, n.y, n.d]).toEqual([20, 5, 5]);
    expect(nearestPointOnFilledRings(10, 5, rings)!.inside).toBe(true);
    expect(distanceToFilledRings(25, 5, rings)).toBe(5);
  });

  it('pusty zbiór', () => {
    expect(nearestPointOnFilledRings(1, 1, [])).toBeNull();
    expect(distanceToFilledRings(1, 1, [])).toBe(Infinity);
  });
});

describe('siatka lasu i znaczniki drzew', () => {
  const grid10 = { x0: 0, y0: 0, cell: 1, cols: 10, rows: 10 };

  it('rasteryzacja: środki komórek w środku pierścieni (nonzero, dziury)', () => {
    const m = rasterizeRings([square(2, 2, 8, 8), hole(4, 4, 6, 6)], grid10);
    const at = (c: number, r: number) => m[r * 10 + c];
    expect(at(2, 2)).toBe(1);
    expect(at(7, 7)).toBe(1);
    expect(at(1, 5)).toBe(0);
    expect(at(8, 5)).toBe(0);
    expect(at(4, 4)).toBe(0);
    expect(at(5, 5)).toBe(0);
    expect(m.reduce((a, v) => a + v, 0)).toBe(36 - 4);
  });

  it('kawałki lasu z sąsiednich kafli zlewają się w jeden płat', () => {
    const m = rasterizeRings([square(0, 0, 5.2, 10), square(4.8, 0, 10, 10)], grid10);
    expect(m.every((v) => v === 1)).toBe(true);
  });

  it('głębokość rośnie do środka, woda wycina las', () => {
    const g = buildForestGrid([square(0, 0, 20, 20)], {
      bounds: { minX: -2, minY: -2, maxX: 22, maxY: 22 },
      cell: 1,
      exclude: [square(14, 14, 18, 18)],
    });
    const d = (x: number, y: number) => g.depth[Math.floor(y - g.y0) * g.cols + Math.floor(x - g.x0)];
    expect(d(-1, -1)).toBe(0);
    expect(d(0.5, 10.5)).toBe(1);
    expect(d(5.5, 5.5)).toBeCloseTo(6, 5);
    expect(d(16.5, 16.5)).toBe(0);
    expect(d(15.5, 13.5)).toBe(1);
    expect(d(15.5, 12.5)).toBe(2);
  });

  it('znaczniki: najgłębsze najpierw, odstęp, nic w małym lesie i przy brzegu', () => {
    // Las 0–200 (duży) i 300–306 (mały) w pikselach świata; komórka 2.
    const g = buildForestGrid([square(0, 0, 200, 200), square(300, 0, 306, 6)], {
      bounds: { minX: -10, minY: -10, maxX: 320, maxY: 210 },
      cell: 2,
    });
    const opts = { spacingPx: 40, minDepthPx: 12 };
    const m = pickTreeMarkers(g, 1, opts);
    expect(m.length).toBeGreaterThan(10);
    // Pierwszy – w środku dużego lasu.
    expect(Math.abs(m[0].x - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(m[0].y - 100)).toBeLessThanOrEqual(2);
    for (let i = 0; i < m.length; i++) {
      expect(m[i].x).toBeLessThan(200);
      // Mieści się w lesie: co najmniej minDepth od brzegu (z tolerancją komórki).
      const edge = Math.min(m[i].x, m[i].y, 200 - m[i].x, 200 - m[i].y);
      expect(edge).toBeGreaterThanOrEqual(opts.minDepthPx - 2);
      for (let j = i + 1; j < m.length; j++) {
        expect(Math.hypot(m[i].x - m[j].x, m[i].y - m[j].y)).toBeGreaterThanOrEqual(opts.spacingPx);
      }
    }
    // Większe przybliżenie → więcej miejsca na ekranie → więcej znaczników (i mały las też dostaje swój).
    const zoomed = pickTreeMarkers(g, 4, opts);
    expect(zoomed.length).toBeGreaterThan(m.length);
    expect(zoomed.some((p) => p.x > 300)).toBe(true);
    expect(pickTreeMarkers(g, 4, opts)).toEqual(zoomed);
  });
});
