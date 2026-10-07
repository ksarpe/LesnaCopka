import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildVoivodeshipRanking, mockMushroomers } from '@/data/mock/gminy';
import { GminaIndex, type GminaIndexFile } from '../gminaIndex';
import { pointInMultiPolygon } from '../geometry';
import { detailPath, gminaShape, gminyOf, projectShapes, VOIVODESHIPS, voivodeshipShapes } from '../voivodeships';

function realIndex() {
  const dir = path.resolve(__dirname, '..', '..', '..', 'assets', 'geo');
  const file = JSON.parse(readFileSync(path.join(dir, 'gminy-index.geo'), 'utf8')) as GminaIndexFile;
  return new GminaIndex(file, async (woj) => JSON.parse(readFileSync(path.join(dir, `gminy-${woj}.geo`), 'utf8')));
}

describe('województwa', () => {
  const index = realIndex();

  it('lista 16 województw zgodna z PRG', () => {
    expect(VOIVODESHIPS).toHaveLength(16);
    expect(new Set(VOIVODESHIPS.map((v) => v.name))).toEqual(new Set(Object.values(index.file.woj)));
    VOIVODESHIPS.forEach((v) => expect(index.file.woj[v.teryt]).toBe(v.name));
  });

  it('każde województwo ma gminy z PRG', () => {
    const total = VOIVODESHIPS.reduce((n, v) => n + gminyOf(index, v.name).length, 0);
    expect(total).toBe(index.list.length);
    expect(gminyOf(index, 'mazowieckie').length).toBeGreaterThan(300);
  });

  it('kontury mazowieckiego mieszczą się w kadrze i są lekkie', async () => {
    const map = await voivodeshipShapes(index, 'mazowieckie', 318, 300);
    expect(map.gminy).toHaveLength(gminyOf(index, 'mazowieckie').length);
    expect(map.width).toBeLessThanOrEqual(318.05);
    expect(map.height).toBeLessThanOrEqual(300.05);
    expect(Math.max(map.width, map.height)).toBeGreaterThan(290);
    for (const g of map.gminy) {
      expect(g.d.startsWith('M')).toBe(true);
      expect(g.anchor.x).toBeGreaterThanOrEqual(0);
      expect(g.anchor.x).toBeLessThanOrEqual(map.width + 0.1);
      expect(g.anchor.y).toBeGreaterThanOrEqual(0);
      expect(g.anchor.y).toBeLessThanOrEqual(map.height + 0.1);
    }
    // Budżet renderowania SVG na telefonie: całe województwo < 200 KB ścieżek.
    const size = map.gminy.reduce((n, g) => n + g.d.length, 0);
    expect(size).toBeLessThan(200_000);
  });

  it('prostokąty, pola i wielokąty w px (przybliżanie, trafienia palcem)', async () => {
    const map = await voivodeshipShapes(index, 'podlaskie', 318, 300);
    expect(map.gminy).toHaveLength(gminyOf(index, 'podlaskie').length);
    for (const g of map.gminy) {
      const [x0, y0, x1, y1] = g.bbox;
      expect(x0).toBeGreaterThanOrEqual(-0.1);
      expect(y0).toBeGreaterThanOrEqual(-0.1);
      expect(x1).toBeLessThanOrEqual(map.width + 0.1);
      expect(y1).toBeLessThanOrEqual(map.height + 0.1);
      expect(g.area).toBeGreaterThan(0);
      expect(g.area).toBeLessThanOrEqual((x1 - x0) * (y1 - y0) + 0.01);
      // Punkt wewnętrzny leży w uproszczonym konturze (albo tuż przy nim – uproszczenie 0,6 px).
      expect(g.anchor.x).toBeGreaterThanOrEqual(x0 - 1);
      expect(g.anchor.x).toBeLessThanOrEqual(x1 + 1);
      expect(g.anchor.y).toBeGreaterThanOrEqual(y0 - 1);
      expect(g.anchor.y).toBeLessThanOrEqual(y1 + 1);
      expect(g.source.length).toBeGreaterThan(0);
    }
    const inside = map.gminy.filter((g) => pointInMultiPolygon(g.anchor.x, g.anchor.y, g.rings)).length;
    expect(inside / map.gminy.length).toBeGreaterThan(0.95);
    // Gminy z makiety mają te same slugi co PRG.
    expect(map.gminy.find((g) => g.id === 'suprasl')?.name).toBe('Supraśl');
    // Pola sumują się (w przybliżeniu) do pola województwa – bez dziur i podwójnych miast.
    const total = map.gminy.reduce((n, g) => n + g.area, 0);
    expect(total).toBeGreaterThan(map.width * map.height * 0.4);
    expect(total).toBeLessThan(map.width * map.height);
  });

  it('dokładniejszy obrys po przybliżeniu: więcej punktów, ten sam zasięg', async () => {
    const map = await voivodeshipShapes(index, 'podlaskie', 318, 300);
    const g = map.gminy.find((x) => x.id === 'suprasl')!;
    const fine = detailPath(g, map.proj, 0.05);
    const points = (d: string) => d.split(/[MLZ]/).filter(Boolean).length;
    expect(fine.startsWith('M')).toBe(true);
    expect(points(fine)).toBeGreaterThan(points(g.d) * 2);
    const xs = fine.match(/[ML](-?[\d.]+) /g)!.map((t) => Number(t.slice(1)));
    expect(Math.min(...xs)).toBeCloseTo(g.bbox[0], 0);
    expect(Math.max(...xs)).toBeCloseTo(g.bbox[2], 0);
  });

  it('sylwetka gminy', async () => {
    const s = await gminaShape(index, 'suprasl', 300, 120);
    expect(s?.gminy[0].d.length).toBeGreaterThan(50);
    expect(await gminaShape(index, 'nie-ma-takiej', 300, 120)).toBeNull();
  });

  it('pusty zbiór → pusta mapa', () => {
    expect(projectShapes([], 300, 300)).toMatchObject({ width: 0, height: 0, gminy: [] });
  });

  it('ranking województwa: wszystkie gminy, kolejne miejsca, kwintyle heatmapy', () => {
    const list = gminyOf(index, 'lubuskie').map((m) => ({ ...m, mushroomers: mockMushroomers(m) }));
    const r = buildVoivodeshipRanking(list, 'week');
    expect(r.rows).toHaveLength(list.length);
    expect(r.rows.map((x) => x.rank)).toEqual(list.map((_, i) => i + 1));
    expect(r.heat[r.rows[0].gminaId]).toBe(4);
    expect(r.heat[r.rows[r.rows.length - 1].gminaId]).toBe(0);
    expect(new Set(Object.values(r.heat))).toEqual(new Set([0, 1, 2, 3, 4]));
    // Powtarzalnie (seed z id gminy i okresu).
    expect(buildVoivodeshipRanking(list, 'week')).toEqual(r);
    expect(buildVoivodeshipRanking(list, 'records').rows[0].points).toMatch(/rek\.$/);
  });
});
