/**
 * Ujęcia skanu 3D: wybór zdjęcia głównego (okładka znaleziska), ujęć do rozpoznania i klatek podglądu 3D.
 * Czysta logika – testy: src/scan/__tests__/views.test.ts.
 */
import type { ScanView } from '@/types';

import { angDist } from './spin';

/** Najwięcej ujęć w jednym rozpoznaniu (główne + 3) – koszt i rozmiar żądania. */
export const MAX_IDENTIFY_VIEWS = 4;
/** Od tylu ujęć z boku podgląd 3D ma sens (mniej – zwykłe zdjęcie). */
export const MIN_SPIN_VIEWS = 3;

/** Ujęcia z boku po azymucie – klatki obrotu w podglądzie 3D. */
export function sideViews(views: readonly ScanView[] | undefined): ScanView[] {
  return (views ?? []).filter((v) => v.kind === 'side').sort((a, b) => a.az - b.az);
}

export const hasSpin = (views: readonly ScanView[] | undefined) => sideViews(views).length >= MIN_SPIN_VIEWS;

/**
 * Zdjęcie główne: pierwsze ujęcie z boku (start skanu – gracz celuje wtedy najstaranniej), bez boku – pierwsze
 * jakiekolwiek. Ujęcia są w kolejności robienia.
 */
export function heroView(views: readonly ScanView[]): ScanView | undefined {
  return views.find((v) => v.kind === 'side') ?? views[0];
}

/**
 * Ujęcia do rozpoznania (najwyżej 4, pierwsze = główne): główne, przy ziemi (spód kapelusza, trzon – klucz do
 * sobowtórów), z góry, a na końcu bok najdalej od głównego (druga strona owocnika).
 */
export function identifyViews(views: readonly ScanView[]): ScanView[] {
  const hero = heroView(views);
  if (!hero) return [];
  const out = [hero];
  const add = (v: ScanView | undefined) => {
    if (v && !out.includes(v) && out.length < MAX_IDENTIFY_VIEWS) out.push(v);
  };
  add(views.find((v) => v.kind === 'low'));
  add(views.find((v) => v.kind === 'top'));
  const sides = views.filter((v) => v.kind === 'side' && v !== hero);
  add(sides.sort((a, b) => angDist(b.az, hero.az) - angDist(a.az, hero.az))[0]);
  return out;
}
