/**
 * Narzędzia dev: symulowane obchodzenie grzyba dla skanu 3D (aparat „Symulacja” w panelu dev – komputer, web,
 * symulator bez czujników). Ścieżka aparatu w czasie: chwila celowania, obejście 300° (8 s), nisko przy ziemi,
 * z góry – ekran skanu przechodzi przez wszystkie podpowiedzi i kończy automatyczną analizą.
 */
import type { Direction } from '@/scan/orbit';

const AIM_MS = 800;
const ORBIT_MS = 8000;
const ORBIT_DEG = 300;
const LOW_MS = 1000;

export function simOrbitDirection(ms: number): Direction {
  if (ms < AIM_MS) return { az: 0, el: -40 };
  const t = ms - AIM_MS;
  if (t < ORBIT_MS) return { az: (ORBIT_DEG * t) / ORBIT_MS, el: -40 };
  if (t < ORBIT_MS + LOW_MS) return { az: ORBIT_DEG, el: -10 };
  return { az: ORBIT_DEG, el: -75 };
}
