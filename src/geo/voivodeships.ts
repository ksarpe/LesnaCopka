/**
 * Województwa i kontury gmin w pikselach – mapa cieplna województwa (ekran Gminy) i sylwetka
 * gminy (nagłówek szczegółów gminy). Granice z PRG są na urządzeniu, więc działa to offline.
 */
import type { Polygon } from './geometry';
import type { GminaIndex, GminaMeta } from './gminaIndex';
import { simplifyXY } from './track';

/** 16 województw: kod TERYT i nazwa (kolejność alfabetyczna). */
export const VOIVODESHIPS = [
  { teryt: '02', name: 'dolnośląskie' },
  { teryt: '04', name: 'kujawsko-pomorskie' },
  { teryt: '06', name: 'lubelskie' },
  { teryt: '08', name: 'lubuskie' },
  { teryt: '10', name: 'łódzkie' },
  { teryt: '12', name: 'małopolskie' },
  { teryt: '14', name: 'mazowieckie' },
  { teryt: '16', name: 'opolskie' },
  { teryt: '18', name: 'podkarpackie' },
  { teryt: '20', name: 'podlaskie' },
  { teryt: '22', name: 'pomorskie' },
  { teryt: '24', name: 'śląskie' },
  { teryt: '26', name: 'świętokrzyskie' },
  { teryt: '28', name: 'warmińsko-mazurskie' },
  { teryt: '30', name: 'wielkopolskie' },
  { teryt: '32', name: 'zachodniopomorskie' },
] as const;

/**
 * Województwo z makiety – ranking 1:1 z pliku. Mapa to już prawdziwe granice PRG (jak w innych
 * województwach); stopnie gmin z danymi gry pochodzą ze wzoru heatmapy 8×7 z makiety.
 */
export const DESIGN_VOIVODESHIP = 'podlaskie';

/** Prostokąt [x0, y0, x1, y1] (px). */
export type Box = [number, number, number, number];

/** Rzut równoodległościowy mapy: x = (lon − west)·kx·k, y = (north − lat)·k (px). */
export interface ShapesProjection {
  west: number;
  north: number;
  kx: number;
  k: number;
}

export interface GminaShape {
  id: string;
  name: string;
  /** Ścieżka SVG: pierścienie zewnętrzne i dziury (rysować z fillRule="evenodd"). */
  d: string;
  /** Punkt wewnętrzny gminy (px) – kotwica podpowiedzi i etykiety. */
  anchor: { x: number; y: number };
  /** Prostokąt otaczający kontur (px). */
  bbox: Box;
  /** Pole konturu (px²) – kolejność etykiet przy przybliżeniu. */
  area: number;
  /** Uproszczone wielokąty w px (pierścienie [x0, y0, …], pierwszy zewnętrzny) – trafienia palcem. */
  rings: Polygon[];
  /** Granice źródłowe (stopnie) – dokładniejszy obrys po przybliżeniu (`detailPath`). */
  source: Polygon[];
}

export interface ShapesMap {
  width: number;
  height: number;
  gminy: GminaShape[];
  proj: ShapesProjection;
}

type ShapeInput = { meta: Pick<GminaMeta, 'id' | 'name' | 'inner' | 'bbox'>; polys: Polygon[] };

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Pole pierścienia (wzór Gaussa, bez znaku). */
function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return Math.abs(a) / 2;
}

/**
 * Wielokąty (stopnie) → ścieżka SVG i wielokąty w px, uproszczone do `tolPx` (Douglas–Peucker),
 * współrzędne zaokrąglone do `round`.
 */
function trace(polys: readonly Polygon[], proj: ShapesProjection, tolPx: number, round: (v: number) => number) {
  const { west, north, kx, k } = proj;
  let d = '';
  const rings: Polygon[] = [];
  for (const poly of polys) {
    const out: number[][] = [];
    for (const ring of poly) {
      const m = Math.floor(ring.length / 2);
      if (m < 3) {
        // Zdegenerowany pierścień zewnętrzny = cały wielokąt pomijamy (dziura nie może zostać „zewnętrzną”).
        if (!out.length) break;
        continue;
      }
      const xs = new Array<number>(m + 1);
      const ys = new Array<number>(m + 1);
      for (let i = 0; i < m; i++) {
        xs[i] = (ring[2 * i] - west) * kx * k;
        ys[i] = (north - ring[2 * i + 1]) * k;
      }
      // Pierścień jako łamana zamknięta punktem startowym – DP zachowuje kształt całego obwodu.
      xs[m] = xs[0];
      ys[m] = ys[0];
      let idx = simplifyXY(xs, ys, tolPx);
      idx.pop();
      // Bardzo mała gmina (miasto w środku gminy wiejskiej) – bez upraszczania, żeby nie zniknęła.
      if (idx.length < 3) idx = Array.from({ length: m }, (_, i) => i);
      const flat: number[] = [];
      d += idx.map((j, t) => {
        const x = round(xs[j]);
        const y = round(ys[j]);
        flat.push(x, y);
        return `${t ? 'L' : 'M'}${x} ${y}`;
      }).join('') + 'Z';
      out.push(flat);
    }
    if (out.length) rings.push(out);
  }
  return { d, rings };
}

/**
 * Kontury w pikselach: rzut równoodległościowy (skala cos szerokości środka) dopasowany do
 * `width` × `maxHeight`, uproszczony do `tolPx`. Granice sąsiadów upraszczane osobno różnią się
 * o ułamek piksela – zakrywa to linia granic gmin (po przybliżeniu – `detailPath`).
 */
export function projectShapes(items: readonly ShapeInput[], width: number, maxHeight: number, tolPx = 0.6): ShapesMap {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { meta } of items) {
    west = Math.min(west, meta.bbox[0]);
    south = Math.min(south, meta.bbox[1]);
    east = Math.max(east, meta.bbox[2]);
    north = Math.max(north, meta.bbox[3]);
  }
  if (!items.length || !(east > west) || !(north > south)) {
    return { width: 0, height: 0, gminy: [], proj: { west: 0, north: 0, kx: 1, k: 1 } };
  }
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const k = Math.min(width / ((east - west) * kx), maxHeight / (north - south));
  const proj: ShapesProjection = { west, north, kx, k };

  const gminy = items.map(({ meta, polys }): GminaShape => {
    const { d, rings } = trace(polys, proj, tolPx, r1);
    const bbox: Box = [Infinity, Infinity, -Infinity, -Infinity];
    let area = 0;
    for (const poly of rings) {
      poly.forEach((ring, i) => {
        area += i ? -ringArea(ring) : ringArea(ring);
        for (let j = 0; j < ring.length; j += 2) {
          bbox[0] = Math.min(bbox[0], ring[j]);
          bbox[1] = Math.min(bbox[1], ring[j + 1]);
          bbox[2] = Math.max(bbox[2], ring[j]);
          bbox[3] = Math.max(bbox[3], ring[j + 1]);
        }
      });
    }
    const anchor = { x: r1((meta.inner[0] - west) * kx * k), y: r1((north - meta.inner[1]) * k) };
    // Gmina bez konturu (brak granic w paczce) – prostokąt w punkcie wewnętrznym.
    if (!(bbox[2] >= bbox[0])) bbox.splice(0, 4, anchor.x, anchor.y, anchor.x, anchor.y);
    return { id: meta.id, name: meta.name, d, anchor, bbox, area: Math.max(0, area), rings, source: polys };
  });
  return { width: r1((east - west) * kx * k), height: r1((north - south) * k), gminy, proj };
}

/**
 * Dokładniejszy obrys gminy do widoku przybliżonego: te same współrzędne (px mapy), mniejsza
 * tolerancja i dwa miejsca po przecinku – po przeskalowaniu przez viewBox granice zostają gładkie.
 */
export function detailPath(shape: Pick<GminaShape, 'source'>, proj: ShapesProjection, tolPx: number): string {
  return trace(shape.source, proj, tolPx, r2).d;
}

/** Gminy województwa z indeksu PRG (kolejność TERYT). */
export function gminyOf(index: GminaIndex, voivodeship: string): GminaMeta[] {
  return index.list.filter((m) => m.voivodeship === voivodeship);
}

/** Kontury wszystkich gmin województwa (wczytuje paczkę granic województwa). */
export async function voivodeshipShapes(index: GminaIndex, voivodeship: string, width: number, maxHeight: number): Promise<ShapesMap> {
  const metas = gminyOf(index, voivodeship);
  const items = await Promise.all(metas.map(async (meta) => ({ meta, polys: await index.geometry(meta.teryt) })));
  return projectShapes(items, width, maxHeight);
}

/** Sylwetka jednej gminy. */
export async function gminaShape(index: GminaIndex, id: string, width: number, maxHeight: number): Promise<ShapesMap | null> {
  const meta = index.byId.get(id);
  if (!meta) return null;
  return projectShapes([{ meta, polys: await index.geometry(meta.teryt) }], width, maxHeight, 0.4);
}
