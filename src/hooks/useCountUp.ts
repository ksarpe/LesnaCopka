import { useEffect, useState } from 'react';

/**
 * Licznik od 0 do `target` (ease-out), np. XP na ekranie Nagroda. Stan zmienia się co klatkę – używaj go w małym
 * komponencie-liściu (sam tekst liczby), nie w całym ekranie, inaczej co klatkę przerysowuje się wszystko.
 */
export function useCountUp(target: number, duration = 1100, delay = 250) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const t = setTimeout(() => {
      const step = (ts: number) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(Math.round(target * eased));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);
  return value;
}

/** Postęp 0 → 1 w czasie `duration` (ease liczy wywołujący), start po `delay` – np. licznik zsynchronizowany z paskiem. */
export function useTicker(duration: number, delay: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const timer = setTimeout(() => {
      const step = (ts: number) => {
        if (!start) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setT(p);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [duration, delay]);
  return t;
}
