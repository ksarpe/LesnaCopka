/**
 * Widok mapy okolicy na pełnym ekranie (src/components/ZoomableAreaMap.tsx) – czyste funkcje: skala
 * i przesunięcie w granicach danych, widok startowy, podkład całej okolicy i kadr warstwy szczegółów.
 *
 * Układ: q' = t + k·q – q to punkt ekranu startowego (1×, piksele względem środka ekranu), q' – ten sam
 * punkt na ekranie bieżącym. Funkcje używane w gestach (wątek UI) mają dyrektywę 'worklet'.
 */
import type { XY } from './areaMapProjection';

/** Przybliżenie względem widoku startowego (~9 m/px): 1× = cała okolica, 6× ≈ 1,5 m/px. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

/** Stan widoku: przekształcenie ekranu startowego → bieżącego (q' = t + k·q). */
export interface ViewState {
  k: number;
  tx: number;
  ty: number;
}

/** Przesunięcie w granicach danych: środek kadru nie wyjeżdża poza pobrany promień (`extent`, px przy 1×). */
export function clampT(t: number, k: number, half: number, extent: number): number {
  'worklet';
  const m = Math.max(0, extent * k - half);
  return Math.min(m, Math.max(-m, t));
}

/** Przybliżenie o `f` wokół punktu (fx, fy) ekranu (względem środka) – punkt pod palcem zostaje na miejscu. */
export function zoomAt(v: ViewState, f: number, fx: number, fy: number, hw: number, hh: number, extent: number): ViewState {
  'worklet';
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * f));
  const r = k / v.k;
  return {
    k,
    tx: clampT(fx - r * (fx - v.tx), k, hw, extent),
    ty: clampT(fy - r * (fy - v.ty), k, hh, extent),
  };
}

/** Widok startowy: skala 1×, pozycja `q` (px przy 1×, względem środka okolicy) możliwie na środku ekranu. */
export function homeView(q: XY, hw: number, hh: number, extent: number): ViewState {
  return { k: MIN_ZOOM, tx: clampT(-q.x, MIN_ZOOM, hw, extent), ty: clampT(-q.y, MIN_ZOOM, hh, extent) };
}

/**
 * Ten sam obraz z dokładnością do pół piksela – nie ma po co rysować go od nowa (warstwy i tak składają
 * się dokładnie, różnica to podpikselowe przesunięcie gotowego obrazu).
 */
export function sameView(a: ViewState, b: ViewState): boolean {
  return Math.abs(a.k - b.k) <= 1e-4 * b.k && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
}

/** Warstwa szczegółów potrzebna tylko po przybliżeniu – przy 1× podkład jest już ostry. */
export function hasDetail(k: number): boolean {
  return k > MIN_ZOOM + 1e-3;
}

/** Płótno warstwy mapy: ekran + zakładka `padX` / `padY` z każdej strony (wyśrodkowane na ekranie). */
export interface CanvasBox {
  padX: number;
  padY: number;
  width: number;
  height: number;
}

/**
 * Podkład: płótno przy 1×, które pokrywa każdy dozwolony kadr przy każdej skali ≥ 1× – cały pobrany promień
 * (`extent`, px przy 1×), a gdy ekran jest większy od danych (duże okno na webie) – sam ekran. Dzięki temu
 * w trakcie gestu nigdy nie widać pustego brzegu i nie trzeba niczego rysować od nowa. Zakładki całkowite,
 * żeby płótno leżało na pełnych pikselach.
 */
export function baseCanvas(width: number, height: number, extent: number): CanvasBox {
  const padX = Math.max(0, Math.ceil(extent - width / 2));
  const padY = Math.max(0, Math.ceil(extent - height / 2));
  return { padX, padY, width: width + 2 * padX, height: height + 2 * padY };
}

/**
 * Środek kadru (piksele świata) warstwy narysowanej dla widoku `v`. `center` – środek okolicy (piksele
 * świata), `S` – piksele ekranu na piksel świata przy 1×.
 */
export function viewCenter(v: ViewState, center: XY, S: number): XY {
  return { x: center.x - v.tx / (S * v.k), y: center.y - v.ty / (S * v.k) };
}
