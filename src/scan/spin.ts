/**
 * Podgląd 3D (src/components/Spin3D.tsx): krycie klatek obrotu dla kąta. Workletowe funkcje bez zależności – działają
 * na wątku UI (Reanimated) i w testach (src/scan/__tests__/spin.test.ts).
 */

/** Odległość kątowa 0–180°. */
export function angDist(a: number, b: number): number {
  'worklet';
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function smoothstep(e0: number, e1: number, x: number): number {
  'worklet';
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Krycie klatki `i` (azymuty `azs` rosnąco, warstwy w tej kolejności – większy indeks wyżej) dla kąta `angle`: liczą
 * się dwie klatki otaczające kąt (także przez 0°/360°). Bliższa jest pełna, dalsza przenika się z nią dopiero w pobliżu
 * połowy drogi (ostre ujęcia, bez „ducha” przez cały obrót). Wyższa z dwóch warstw dostaje krycie mieszania,
 * niższa – pełne, więc obraz nigdy nie prześwituje.
 */
export function frameOpacity(angle: number, azs: readonly number[], i: number): number {
  'worklet';
  const n = azs.length;
  if (n <= 1) return 1;
  const a = ((angle % 360) + 360) % 360;
  // Ostatnia klatka nie dalej niż kąt; przed pierwszą – ostatnia (przez 0°).
  let prev = n - 1;
  for (let k = 0; k < n; k++) if (azs[k] <= a) prev = k;
  const next = (prev + 1) % n;
  const gap = (((azs[next] - azs[prev]) % 360) + 360) % 360 || 360;
  const pos = ((((a - azs[prev]) % 360) + 360) % 360) / gap;
  const near = pos < 0.5 ? prev : next;
  const far = pos < 0.5 ? next : prev;
  const w = 0.5 * smoothstep(0.3, 0.5, Math.min(pos, 1 - pos));
  if (i === near) return near > far ? 1 - w : 1;
  if (i === far) return far > near ? w : 1;
  return 0;
}
