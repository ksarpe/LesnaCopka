/**
 * Rzutowanie mapy okolicy (piksele świata Web Mercator na poziomie `map.zoom`) na kadr ekranu
 * i budowa ścieżek SVG. Wspólne dla karty „Wykryto region” i mapy pełnoekranowej – czyste funkcje.
 */
import type { AreaMap } from '@/types';

/** Punkt w pikselach świata albo ekranu. */
export interface XY {
  x: number;
  y: number;
}

/** Kadr: rozmiar (px ekranu), skala i punkt świata w środku kadru. */
export interface MapViewport {
  width: number;
  height: number;
  /** Metry na piksel ekranu. */
  mPerPx: number;
  /** Punkt świata (piksele na poziomie `map.zoom`) w środku kadru; domyślnie środek mapy. */
  center?: XY;
  /** Elementy leżące w całości dalej niż margines (px) od kadru są pomijane. */
  margin?: number;
}

/** Przekształcenie świat → ekran: x' = x · scale + ox, y' = y · scale + oy. */
export interface MapTransform {
  /** Piksele ekranu na piksel świata. */
  scale: number;
  ox: number;
  oy: number;
}

export interface ProjectedAreaMap extends MapTransform {
  forest: string;
  water: string;
  waterways: string;
  roads: string;
  tracks: string;
  boundary: string;
  /** Piksele ekranu na metr. */
  pxPerM: number;
}

export function viewportTransform(map: Pick<AreaMap, 'metersPerPx' | 'center'>, vp: MapViewport): MapTransform {
  const scale = map.metersPerPx / vp.mPerPx;
  const c = vp.center ?? map.center;
  return { scale, ox: vp.width / 2 - c.x * scale, oy: vp.height / 2 - c.y * scale };
}

export function projectPoint(t: MapTransform, p: XY): XY {
  return { x: p.x * t.scale + t.ox, y: p.y * t.scale + t.oy };
}

/** Odwrotność `projectPoint` – punkt świata pod pikselem ekranu. */
export function unprojectPoint(t: MapTransform, p: XY): XY {
  return { x: (p.x - t.ox) / t.scale, y: (p.y - t.oy) / t.scale };
}

/** Bboxy pierścieni w pikselach świata: [minX, minY, maxX, maxY] × n – liczone raz na listę (mapa się nie zmienia). */
const boxCache = new WeakMap<number[][], Float64Array>();

function ringBoxes(list: number[][]): Float64Array {
  let boxes = boxCache.get(list);
  if (boxes) return boxes;
  boxes = new Float64Array(list.length * 4);
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < minX) minX = p[i];
      if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 1] > maxY) maxY = p[i + 1];
    }
    boxes[4 * k] = minX;
    boxes[4 * k + 1] = minY;
    boxes[4 * k + 2] = maxX;
    boxes[4 * k + 3] = maxY;
  }
  boxCache.set(list, boxes);
  return boxes;
}

/**
 * Ścieżka SVG (współrzędne zaokrąglone do 0,1 px, bez powtórzonych punktów); pomija pierścienie i linie
 * całkowicie poza kadrem (+ margines).
 */
export function pathData(list: number[][], t: MapTransform, width: number, height: number, closed: boolean, margin = 8): string {
  const boxes = ringBoxes(list);
  const { scale: s, ox, oy } = t;
  let d = '';
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (p.length < 4) continue;
    if (
      boxes[4 * k + 2] * s + ox < -margin ||
      boxes[4 * k] * s + ox > width + margin ||
      boxes[4 * k + 3] * s + oy < -margin ||
      boxes[4 * k + 1] * s + oy > height + margin
    ) {
      continue;
    }
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
}

/** Wszystkie warstwy mapy okolicy jako ścieżki SVG w pikselach kadru. */
export function projectAreaMap(map: AreaMap, vp: MapViewport): ProjectedAreaMap {
  const t = viewportTransform(map, vp);
  const m = vp.margin ?? 8;
  const { width: w, height: h } = vp;
  return {
    ...t,
    forest: pathData(map.forest, t, w, h, true, m),
    water: pathData(map.water, t, w, h, true, m),
    waterways: pathData(map.waterways, t, w, h, false, m),
    roads: pathData(map.roads, t, w, h, false, m),
    tracks: pathData(map.tracks, t, w, h, false, m),
    boundary: pathData(map.boundary, t, w, h, true, m),
    pxPerM: 1 / vp.mPerPx,
  };
}
