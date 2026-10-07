/**
 * Przybliżanie mapy województwa (ekran Gminy) – czyste funkcje widoku: skala i przesunięcie,
 * cel przybliżenia dla gminy, trafienie palcem i rozmieszczenie etykiet bez kolizji.
 *
 * Układ: punkt mapy p (px konturów z `projectShapes`) ląduje na ekranie w s·p + t.
 * Funkcje używane w gestach (wątek UI) mają dyrektywę 'worklet'.
 */
import { distance2ToPath, pointInMultiPolygon, type Polygon } from './geometry';
import type { Box } from './voivodeships';

export type { Box };

export interface Zoom {
  s: number;
  tx: number;
  ty: number;
}

/** Okno mapy: rozmiar (px ekranu), zasięg treści (px mapy) i maksymalna skala. */
export interface MapViewport {
  w: number;
  h: number;
  content: Box;
  maxS: number;
}

function clampAxis(t: number, s: number, c0: number, c1: number, v: number): number {
  'worklet';
  const size = s * (c1 - c0);
  // Treść węższa niż okno – wyśrodkowana; szersza – nie odsłania pustego brzegu.
  if (size <= v) return (v - s * (c0 + c1)) / 2;
  return Math.min(0 - s * c0, Math.max(v - s * c1, t));
}

/** Skala w [1, maxS], przesunięcie tak, żeby mapa nie uciekała z okna. */
export function clampZoom(z: Zoom, vp: MapViewport): Zoom {
  'worklet';
  const s = Math.min(vp.maxS, Math.max(1, z.s));
  return {
    s,
    tx: clampAxis(z.tx, s, vp.content[0], vp.content[2], vp.w),
    ty: clampAxis(z.ty, s, vp.content[1], vp.content[3], vp.h),
  };
}

/** Pełny widok (skala 1, mapa wyśrodkowana). */
export function homeZoom(vp: MapViewport): Zoom {
  'worklet';
  return clampZoom({ s: 1, tx: 0, ty: 0 }, vp);
}

export function isZoomed(z: Zoom): boolean {
  'worklet';
  return z.s > 1.01;
}

/** Punkt ekranu → punkt mapy. */
export function toMap(z: Zoom, x: number, y: number): { x: number; y: number } {
  'worklet';
  return { x: (x - z.tx) / z.s, y: (y - z.ty) / z.s };
}

/** Widoczny fragment mapy (px mapy). */
export function visibleBox(z: Zoom, vp: Pick<MapViewport, 'w' | 'h'>): Box {
  return [-z.tx / z.s, -z.ty / z.s, (vp.w - z.tx) / z.s, (vp.h - z.ty) / z.s];
}

/** viewBox SVG o rozmiarze okna, który pokazuje mapę w skali s z przesunięciem t. */
export function viewBoxOf(z: Zoom, vp: Pick<MapViewport, 'w' | 'h'>): string {
  const f = (v: number) => Math.round(v * 1e4) / 1e4;
  return `${f(-z.tx / z.s)} ${f(-z.ty / z.s)} ${f(vp.w / z.s)} ${f(vp.h / z.s)}`;
}

/** Przybliżenie o `factor` z zachowaniem punktu ekranu (x, y) pod palcem / kursorem. */
export function zoomAt(z: Zoom, factor: number, x: number, y: number, vp: MapViewport): Zoom {
  'worklet';
  const s = Math.min(vp.maxS, Math.max(1, z.s * factor));
  const p = toMap(z, x, y);
  return clampZoom({ s, tx: x - s * p.x, ty: y - s * p.y }, vp);
}

export interface ZoomToBoxOptions {
  /** Jaką część okna ma zająć prostokąt gminy (domyślnie 45%). */
  fill?: number;
  /** Najmniejsza skala celu (duża gmina wiejska) – domyślnie 2,5. */
  minS?: number;
  /** Bieżąca skala, gdy mapa jest już przybliżona – zostaje, jeśli nie odbiega za bardzo od idealnej. */
  current?: number;
}

/**
 * Cel przybliżenia na gminę: prostokąt wypełnia ok. `fill` okna (skala w [minS, maxS] – maleńkie
 * gminy miejskie dostają maksimum), środek gminy na środku okna (w granicach mapy). Przy już
 * przybliżonej mapie skala zmienia się tylko, gdy odbiega od idealnej więcej niż 1,6×.
 */
export function zoomToBox(box: Box, vp: MapViewport, opts: ZoomToBoxOptions = {}): Zoom {
  const fill = opts.fill ?? 0.45;
  const minS = Math.min(opts.minS ?? 2.5, vp.maxS);
  const bw = Math.max(box[2] - box[0], 1e-3);
  const bh = Math.max(box[3] - box[1], 1e-3);
  const ideal = Math.min(vp.maxS, Math.max(minS, Math.min((vp.w * fill) / bw, (vp.h * fill) / bh)));
  const s = opts.current && opts.current > 1.01 ? Math.min(ideal * 1.6, Math.max(ideal / 1.6, opts.current)) : ideal;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return clampZoom({ s, tx: vp.w / 2 - s * cx, ty: vp.h / 2 - s * cy }, vp);
}

/**
 * Klatka animacji a → b (p ∈ [0, 1]): skala geometrycznie, a punkt mapy pod środkiem okna
 * przesuwa się tak, żeby ruch na ekranie był równomierny (szybki odjazd przy oddalaniu nie „skacze”).
 */
export function interpolateZoom(a: Zoom, b: Zoom, p: number, vp: Pick<MapViewport, 'w' | 'h'>): Zoom {
  'worklet';
  const r = b.s / a.s;
  const s = a.s * Math.pow(r, p);
  const w = Math.abs(r - 1) < 1e-4 ? p : (1 - Math.pow(r, -p)) / (1 - 1 / r);
  const ax = (vp.w / 2 - a.tx) / a.s;
  const ay = (vp.h / 2 - a.ty) / a.s;
  const mx = ax + ((vp.w / 2 - b.tx) / b.s - ax) * w;
  const my = ay + ((vp.h / 2 - b.ty) / b.s - ay) * w;
  return { s, tx: vp.w / 2 - s * mx, ty: vp.h / 2 - s * my };
}

/* ───────────────────────── Trafienie palcem ───────────────────────── */

export interface HitShape {
  id: string;
  bbox: Box;
  area: number;
  rings: Polygon[];
}

/**
 * Gmina pod punktem (px mapy); przy kilku trafieniach (nakładki z uproszczenia granic) – najmniejsza,
 * czyli miasto zamiast otaczającej je gminy wiejskiej. Pudło (granica, puste tło) → najbliższa gmina
 * w promieniu `maxDist`, dalej null.
 */
export function pickShape(shapes: readonly HitShape[], x: number, y: number, maxDist: number): string | null {
  let hit: HitShape | null = null;
  for (const g of shapes) {
    if (x < g.bbox[0] || x > g.bbox[2] || y < g.bbox[1] || y > g.bbox[3]) continue;
    if ((!hit || g.area < hit.area) && pointInMultiPolygon(x, y, g.rings)) hit = g;
  }
  if (hit) return hit.id;
  let best: string | null = null;
  let bestD2 = maxDist * maxDist;
  for (const g of shapes) {
    if (x < g.bbox[0] - maxDist || x > g.bbox[2] + maxDist || y < g.bbox[1] - maxDist || y > g.bbox[3] + maxDist) continue;
    for (const poly of g.rings) {
      for (const ring of poly) {
        const d2 = distance2ToPath(x, y, ring, true);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = g.id;
        }
      }
    }
  }
  return best;
}

/* ───────────────────────── Etykiety ───────────────────────── */

const NARROW = new Set('iljtfrI.,\'’ -()'.split(''));
const WIDE = new Set('mwMWŁĄĘ'.split(''));

/** Przybliżona szerokość napisu (Nunito Sans 800) – wystarcza do wykrywania kolizji. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    em += NARROW.has(ch) ? 0.32 : WIDE.has(ch) ? 0.86 : ch !== ch.toLowerCase() ? 0.7 : 0.57;
  }
  return em * size;
}

export interface LabelCandidate {
  id: string;
  /** Środek etykiety (px okna). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Większa = ważniejsza (np. pole gminy na ekranie). */
  priority: number;
  /** Zawsze pokazana (zaznaczona gmina) – rezerwuje miejsce przed pozostałymi. */
  force?: boolean;
}

export interface PlacedLabel {
  id: string;
  box: Box;
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
}

/**
 * Zachłanne rozmieszczenie etykiet: najpierw wymuszone, potem od najważniejszej; etykieta wychodząca
 * poza `bounds` albo nachodząca (z odstępem `gap`) na wcześniejszą / zarezerwowany obszar – pominięta.
 */
export function placeLabels(cands: readonly LabelCandidate[], bounds: Box, reserved: readonly Box[] = [], gap = 3): PlacedLabel[] {
  const order = [...cands].sort((a, b) => Number(!!b.force) - Number(!!a.force) || b.priority - a.priority);
  const taken: Box[] = [...reserved];
  const out: PlacedLabel[] = [];
  for (const c of order) {
    const box: Box = [c.x - c.w / 2, c.y - c.h / 2, c.x + c.w / 2, c.y + c.h / 2];
    if (!c.force) {
      if (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3]) continue;
      if (taken.some((t) => overlaps(t, box, gap))) continue;
    }
    taken.push(box);
    out.push({ id: c.id, box });
  }
  return out;
}
