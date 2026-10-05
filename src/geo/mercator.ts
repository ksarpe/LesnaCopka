/** Web Mercator (kafle 256 px) – piksele „świata” na danym poziomie przybliżenia. */
export const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const RAD = Math.PI / 180;

export function lonLatToWorld(lon: number, lat: number, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(lat * RAD);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function metersPerPx(lat: number, zoom: number) {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (TILE_SIZE * 2 ** zoom);
}

/** Poziom przybliżenia (ułamkowy), przy którym piksel ma `mpp` metrów. */
export function zoomForMetersPerPx(lat: number, mpp: number) {
  return Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (TILE_SIZE * mpp));
}
